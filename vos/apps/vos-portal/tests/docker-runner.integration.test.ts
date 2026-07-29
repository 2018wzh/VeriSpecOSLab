import Docker from "dockerode";
import { afterAll, describe, expect, test } from "bun:test";
import { DockerRunnerRuntime } from "../worker/docker-runner.ts";

const enabled = process.env.VOS_TEST_DOCKER_RUNNER === "1";
const suite = enabled ? describe : describe.skip;
const createdRepositories: string[] = [];

suite("Docker runner isolation", () => {
  afterAll(async () => {
    const base = required("VOS_GITEA_URL").replace(/\/$/, "");
    const token = required("VOS_GITEA_TOKEN");
    for (const repository of createdRepositories) {
      await fetch(`${base}/api/v1/repos/${repository}`, {
        method: "DELETE",
        headers: { authorization: `token ${token}` },
      });
    }
  });

  test("checks out only through Gitea and starts a bounded, no-egress, authenticated job", async () => {
    const gitea = required("VOS_GITEA_URL").replace(/\/$/, "");
    const token = required("VOS_GITEA_TOKEN");
    const meResponse = await fetch(`${gitea}/api/v1/user`, {
      headers: { authorization: `token ${token}` },
    });
    expect(meResponse.ok).toBe(true);
    const me = (await meResponse.json()) as { login: string };
    const name = `runner-isolation-${crypto.randomUUID().slice(0, 8)}`;
    const createResponse = await fetch(`${gitea}/api/v1/user/repos`, {
      method: "POST",
      headers: {
        authorization: `token ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        private: true,
        auto_init: true,
        default_branch: "main",
        readme: "Default",
      }),
    });
    expect(createResponse.status).toBe(201);
    const repository = (await createResponse.json()) as { default_branch: string };
    createdRepositories.push(`${me.login}/${name}`);
    const branchResponse = await fetch(
      `${gitea}/api/v1/repos/${encodeURIComponent(me.login)}/${encodeURIComponent(name)}/branches/${encodeURIComponent(repository.default_branch)}`,
      { headers: { authorization: `token ${token}` } },
    );
    expect(branchResponse.ok).toBe(true);
    const branch = (await branchResponse.json()) as { commit: { id: string } };

    const runtime = DockerRunnerRuntime.fromEnv();
    const modelSecret=`runner-secret-${crypto.randomUUID()}`;
    const session = await runtime.start({
      portalRunId: `run-${crypto.randomUUID()}`,
      projectId: `project-${crypto.randomUUID()}`,
      repositoryUrl: `${gitea}/${me.login}/${name}.git`,
      commitSha: branch.commit.id,
      stageKey: "memory",
      scope: "public",
      policySnapshotRef: "policy-test-v1",
      actor: { id: "runner-test-user", username: "runner-test", role: "student" },
      commitLedger: { commit_sha:branch.commit.id,actor:"human",run_id:"gitea-runner-isolation",spec_refs:[],changed_targets:[],evidence_refs:[],collaboration_intent:"signed Gitea isolation fixture push",created_at:new Date().toISOString() },
      modelCredential:{leaseId:`lease-${crypto.randomUUID()}`,provider:"test-provider",secret:modelSecret,expiresAt:new Date(Date.now()+120_000).toISOString()},
    });
    const docker = new Docker();
    const container = docker.getContainer(session.containerId);
    try {
      const inspect = await container.inspect();
      expect(inspect.Config.User).toBe("10001:10001");
      expect(inspect.HostConfig.ReadonlyRootfs).toBe(true);
      expect(inspect.HostConfig.Privileged).toBe(false);
      expect(inspect.HostConfig.CapDrop).toContain("ALL");
      expect(inspect.HostConfig.SecurityOpt).toContain("no-new-privileges:true");
      expect(inspect.HostConfig.SecurityOpt).not.toContain("seccomp=unconfined");
      expect(Object.keys(inspect.NetworkSettings.Networks)).toContain(required("VOS_RUNNER_NETWORK"));
      expect(Object.keys(inspect.NetworkSettings.Networks)).not.toContain(required("VOS_RUNNER_CHECKOUT_NETWORK"));
      expect(inspect.HostConfig.Memory).toBeGreaterThanOrEqual(256 * 1024 ** 2);
      expect(inspect.HostConfig.PidsLimit).toBeGreaterThanOrEqual(32);
      expect(JSON.stringify(inspect.Config.Env)).not.toContain(modelSecret);
      expect(inspect.Config.Env).toContain("VOS_MODEL_CREDENTIAL_FILE=/tmp/vos-runner/model-credential.json");

      const projectedLedger = await container.exec({
        Cmd: ["/bin/sh", "-euc", `test -f /tmp/vos-runner/identity.json; test ! -e .vos/runner-identity.json; grep -F '${branch.commit.id}' .vos/commit-ledger.jsonl >/dev/null`],
        AttachStdout: true,
        AttachStderr: true,
      });
      const projectedStream = await projectedLedger.start({});
      await new Promise<void>((resolve, reject) => { projectedStream.resume(); projectedStream.once("end", resolve); projectedStream.once("error", reject); });
      expect((await projectedLedger.inspect()).ExitCode).toBe(0);
      const projectedCredential=await container.exec({Cmd:["bun","-e","const value=await Bun.file('/tmp/vos-runner/model-credential.json').json();if(value.version!=='runner-model-credential.v1'||value.provider!=='test-provider'||typeof value.secret!=='string'||value.secret.length<16)process.exit(1);"],AttachStdout:true,AttachStderr:true});
      const credentialStream=await projectedCredential.start({});
      await new Promise<void>((resolve,reject)=>{credentialStream.resume();credentialStream.once("end",resolve);credentialStream.once("error",reject);});
      expect((await projectedCredential.inspect()).ExitCode).toBe(0);

      const unauthenticated = await fetch(`${session.endpoint}/api/v1/openapi.json`);
      expect(unauthenticated.status).toBe(401);
      const authenticated = await fetch(`${session.endpoint}/api/v1/openapi.json`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(authenticated.status).toBe(200);

      const noEgress = await container.exec({
        Cmd: ["bun", "-e", "await fetch('https://example.com',{signal:AbortSignal.timeout(3000)});"],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await noEgress.start({});
      await new Promise<void>((resolve, reject) => {
        stream.resume();
        stream.once("end", resolve);
        stream.once("error", reject);
      });
      expect((await noEgress.inspect()).ExitCode).not.toBe(0);
    } finally {
      await session.cleanup();
    }
    await expect(container.inspect()).rejects.toThrow();
  }, 120_000);
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
