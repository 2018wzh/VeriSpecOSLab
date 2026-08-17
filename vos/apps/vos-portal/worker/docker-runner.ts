import Docker, { type Container } from "dockerode";
import type {
  CommitLedgerEntry,
  PolicySnapshot,
  PortalUserSummary,
} from "vos-core";

const LABEL_MANAGED = "edu.verispec.runner.managed";
const RUNNER_PORT = 8788;
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export interface DockerRunnerRequest {
  portalRunId: string;
  projectId: string;
  repositoryUrl: string;
  commitSha: string;
  stageKey: string;
  scope: string;
  policySnapshotRef: string;
  courseAdapter?: "xv6-spec" | "glenda-spec";
  actor: PortalUserSummary;
  commitLedger: CommitLedgerEntry;
  modelCredential?: {
    leaseId: string;
    provider: string;
    secret: string;
    expiresAt: string;
  };
}

export interface RunnerSession {
  endpoint: string;
  accessToken: string;
  imageId: string;
  containerId: string;
  diagnostics(): Promise<string[]>;
  cleanup(): Promise<void>;
}

interface RunnerLimits {
  cpus: number;
  memoryBytes: number;
  pids: number;
  diskBytes: number;
}

export class DockerRunnerRuntime {
  private readonly docker: Docker;
  private readonly image: string;
  private readonly checkoutNetwork: string;
  private readonly runnerNetwork: string;
  private readonly portalUrl: string;
  private readonly giteaToken: string;
  private readonly giteaHost: string;
  private readonly limits: RunnerLimits;

  constructor(options: {
    docker?: Docker;
    image: string;
    checkoutNetwork: string;
    runnerNetwork: string;
    portalUrl: string;
    giteaToken: string;
    giteaHost: string;
    limits: RunnerLimits;
  }) {
    this.docker = options.docker ?? new Docker();
    this.image = requiredImage(options.image);
    this.checkoutNetwork = requiredName(
      options.checkoutNetwork,
      "checkout network",
    );
    this.runnerNetwork = requiredName(options.runnerNetwork, "runner network");
    this.portalUrl = new URL(options.portalUrl).toString().replace(/\/$/, "");
    this.giteaToken = options.giteaToken;
    this.giteaHost = options.giteaHost;
    this.limits = options.limits;
  }

  static fromEnv(): DockerRunnerRuntime {
    const giteaUrl = new URL(required("VOS_GITEA_URL"));
    return new DockerRunnerRuntime({
      image: required("VOS_RUNNER_IMAGE"),
      checkoutNetwork: required("VOS_RUNNER_CHECKOUT_NETWORK"),
      runnerNetwork: required("VOS_RUNNER_NETWORK"),
      portalUrl: required("VOS_RUNNER_PORTAL_URL"),
      giteaToken: required("VOS_GITEA_TOKEN"),
      giteaHost: giteaUrl.host,
      limits: {
        cpus: boundedNumber("VOS_RUNNER_CPUS", 2, 0.25, 8),
        memoryBytes: boundedNumber(
          "VOS_RUNNER_MEMORY_BYTES",
          2 * 1024 ** 3,
          256 * 1024 ** 2,
          16 * 1024 ** 3,
        ),
        pids: boundedNumber("VOS_RUNNER_PIDS", 256, 32, 1024),
        diskBytes: boundedNumber(
          "VOS_RUNNER_DISK_BYTES",
          4 * 1024 ** 3,
          256 * 1024 ** 2,
          16 * 1024 ** 3,
        ),
      },
    });
  }

  async cleanupRun(portalRunId: string): Promise<number> {
    if (!NAME_PATTERN.test(portalRunId))
      throw new Error("runner cleanup contains an invalid run identifier");
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: [
          `${LABEL_MANAGED}=true`,
          `edu.verispec.runner.run_id=${portalRunId}`,
        ],
      },
    });
    for (const entry of containers) {
      const container = this.docker.getContainer(entry.Id);
      const inspected = await container.inspect();
      if (
        inspected.Config.Labels?.[LABEL_MANAGED] !== "true" ||
        inspected.Config.Labels?.["edu.verispec.runner.run_id"] !== portalRunId
      )
        throw new Error(
          "refusing to remove a runner with mismatched ownership labels",
        );
      await removeContainer(container);
    }
    return containers.length;
  }

  async start(request: DockerRunnerRequest): Promise<RunnerSession> {
    validateRequest(request);
    const repositoryUrl = this.validateRepositoryUrl(request.repositoryUrl);
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const runnerName = `vos-runner-${suffix}`;
    const accessToken = randomToken();
    const labels = {
      [LABEL_MANAGED]: "true",
      "edu.verispec.runner.run_id": request.portalRunId,
      "edu.verispec.runner.project_id": request.projectId,
    };
    const image = await this.docker.getImage(this.image).inspect();
    let runner: Container | undefined;
    try {
      runner = await this.docker.createContainer({
        name: runnerName,
        Image: this.image,
        Entrypoint: ["/bin/sh"],
        Cmd: [
          "-euc",
          "while [ ! -f /tmp/vos-runner-start ]; do sleep 0.1; done; exec bun run /opt/vos/apps/vos-cli/app/runner-server.ts",
        ],
        Env: mergeContainerEnvironment(image.Config?.Env, [
          `VOS_SERVE_ACCESS_TOKEN=${accessToken}`,
          "VOS_RUNNER_IDENTITY_FILE=/tmp/vos-runner/identity.json",
          `VOS_RUNNER_PORTAL_URL=${this.portalUrl}`,
          "VOS_RUNNER_INTERNAL_PORTAL=1",
          `VOS_RUNNER_PROJECT_ID=${request.projectId}`,
          `VOS_COURSE_STAGE_KEY=${request.stageKey}`,
          ...(request.courseAdapter
            ? [`VOS_COURSE_ADAPTER=${request.courseAdapter}`]
            : []),
          `VOS_RUNNER_PORT=${RUNNER_PORT}`,
          ...(request.modelCredential
            ? [
                "VOS_MODEL_CREDENTIAL_FILE=/tmp/vos-runner/model-credential.json",
              ]
            : []),
          "HOME=/tmp/runner-home",
        ]),
        Labels: labels,
        User: "10001:10001",
        WorkingDir: "/workspace/project",
        ExposedPorts: { [`${RUNNER_PORT}/tcp`]: {} },
        HostConfig: this.hostConfig(this.checkoutNetwork),
      });
      await runner.start();
      await execDetached(
        runner,
        [
          "/bin/sh",
          "-euc",
          'git -c http.extraHeader="Authorization: token $VOS_CHECKOUT_TOKEN" clone --no-checkout "$VOS_REPOSITORY_URL" /workspace/project; cd /workspace/project; git checkout --detach "$VOS_COMMIT_SHA"; test "$(git rev-parse HEAD)" = "$VOS_COMMIT_SHA"; git remote set-url origin "$VOS_REPOSITORY_URL"',
        ],
        [
          `VOS_REPOSITORY_URL=${repositoryUrl}`,
          `VOS_COMMIT_SHA=${request.commitSha}`,
          `VOS_CHECKOUT_TOKEN=${this.giteaToken}`,
        ],
      );
      await writeRunnerIdentity(runner, request);
      if (request.modelCredential)
        await writeRunnerCredential(
          runner,
          request.modelCredential,
          accessToken,
        );
      await this.docker
        .getNetwork(this.checkoutNetwork)
        .disconnect({ Container: runner.id, Force: true });
      await this.docker
        .getNetwork(this.runnerNetwork)
        .connect({ Container: runner.id });
      await execDetached(
        runner,
        ["/usr/bin/touch", "/tmp/vos-runner-start"],
        [],
      );
      const endpoint = `http://${runnerName}:${RUNNER_PORT}`;
      await waitHealthy(endpoint, accessToken, runner);
      let cleaned = false;
      return {
        endpoint,
        accessToken,
        imageId: image.Id,
        containerId: runner.id,
        diagnostics: async () => await runnerFiles(runner!),
        cleanup: async () => {
          if (cleaned) return;
          cleaned = true;
          await removeContainer(runner);
        },
      };
    } catch (error) {
      await removeContainer(runner).catch(() => undefined);
      throw error;
    }
  }

  private validateRepositoryUrl(raw: string): string {
    const url = new URL(raw);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.host !== this.giteaHost
    ) {
      throw new Error(
        "runner repository URL must target the configured Gitea origin",
      );
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url.pathname)
    ) {
      throw new Error(
        "runner repository URL contains credentials or an invalid repository path",
      );
    }
    return url.toString();
  }

  private hostConfig(
    network: string,
  ): Docker.ContainerCreateOptions["HostConfig"] {
    return {
      NetworkMode: network,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      CapAdd: [],
      // Docker applies its default seccomp profile when no override is supplied.
      SecurityOpt: ["no-new-privileges:true"],
      Privileged: false,
      PidsLimit: this.limits.pids,
      Memory: this.limits.memoryBytes,
      MemorySwap: this.limits.memoryBytes,
      NanoCpus: Math.floor(this.limits.cpus * 1_000_000_000),
      Tmpfs: {
        // Course checks compile short-lived host oracles under mktemp(1) and
        // execute them immediately. The container remains unprivileged,
        // capability-free, read-only outside tmpfs, and nosuid.
        "/tmp": "rw,exec,nosuid,size=256m,mode=1777",
        "/workspace/project": `rw,exec,nosuid,size=${this.limits.diskBytes},mode=0700,uid=10001,gid=10001`,
      },
      Init: true,
      AutoRemove: false,
    };
  }
}

export function mergeContainerEnvironment(
  imageEnvironment: string[] | undefined,
  runtimeEnvironment: string[],
): string[] {
  const merged = new Map<string, string>();
  for (const entry of [...(imageEnvironment ?? []), ...runtimeEnvironment]) {
    const separator = entry.indexOf("=");
    if (separator <= 0)
      throw new Error("runner environment contains an invalid entry");
    merged.set(entry.slice(0, separator), entry);
  }
  return [...merged.values()];
}

async function runnerFiles(container: Container): Promise<string[]> {
  const output = await execCapture(
    container,
    [
      "/bin/sh",
      "-euc",
      'find .vos/runs -maxdepth 4 -type f -print 2>/dev/null | LC_ALL=C sort | head -200; for file in .vos/runs/*/events.jsonl .vos/runs/*/manifest.json; do if [ -f "$file" ]; then printf \'\\n--- %s ---\\n\' "$file"; tail -n 100 "$file"; fi; done',
    ],
    [],
  );
  return output.slice(-12_000).split(/\r?\n/).filter(Boolean);
}

async function writeRunnerIdentity(
  container: Container,
  request: DockerRunnerRequest,
): Promise<void> {
  const visibility = request.scope === "public" ? "public" : "staff-only";
  const policy: PolicySnapshot = {
    ref: request.policySnapshotRef,
    projectId: request.projectId,
    allowedCommands: [
      request.scope === "public" ? "verify public" : "verify full",
    ],
    allowedPaths:
      request.courseAdapter === "glenda-spec"
        ? ["spec", "src", "kernel", "service", "xtask", "user", "tests", ".vos"]
        : ["spec", "src", "kernel", "user", "tests", ".vos"],
    visibilityScope: visibility,
    expiresAt: new Date(Date.now() + 45 * 60_000).toISOString(),
  };
  const identity = JSON.stringify({ user: request.actor, policy });
  const ledger = JSON.stringify(request.commitLedger);
  await execDetached(
    container,
    [
      "/bin/sh",
      "-euc",
      "mkdir -p /tmp/vos-runner /workspace/project/.vos; umask 077; printf '%s' \"$VOS_RUNNER_IDENTITY\" > /tmp/vos-runner/identity.json; printf '%s\\n' \"$VOS_COMMIT_LEDGER\" >> /workspace/project/.vos/commit-ledger.jsonl",
    ],
    [`VOS_RUNNER_IDENTITY=${identity}`, `VOS_COMMIT_LEDGER=${ledger}`],
  );
}

async function writeRunnerCredential(
  container: Container,
  credential: NonNullable<DockerRunnerRequest["modelCredential"]>,
  accessToken: string,
): Promise<void> {
  const remaining = Math.floor(
    (Date.parse(credential.expiresAt) - Date.now()) / 1000,
  );
  if (!Number.isFinite(remaining) || remaining < 30 || remaining > 900)
    throw new Error(
      "runner model credential lease is expired or exceeds the maximum lifetime",
    );
  const payload = JSON.stringify({
    version: "runner-model-credential.v1",
    lease_id: credential.leaseId,
    provider: credential.provider,
    secret: credential.secret,
    expires_at: credential.expiresAt,
  });
  const envelope = await encryptRunnerCredential(payload, accessToken);
  await execDetached(
    container,
    ["/bin/sh", "-euc", "mkdir -p /tmp/vos-runner; chmod 0700 /tmp/vos-runner"],
    [],
  );
  await execDetached(
    container,
    ["bun", "-e", RUNNER_CREDENTIAL_PROJECTION_SCRIPT],
    [`VOS_CREDENTIAL_ENVELOPE=${envelope}`],
  );
  await execDetached(
    container,
    [
      "/bin/sh",
      "-euc",
      'test "$(stat -c %a /tmp/vos-runner/model-credential.json)" = 600',
    ],
    [],
  );
  await execBackground(container, [
    "/bin/sh",
    "-euc",
    `sleep ${remaining}; rm -f /tmp/vos-runner/model-credential.json`,
  ]);
}

const RUNNER_CREDENTIAL_PROJECTION_SCRIPT = `
const encoded=process.env.VOS_CREDENTIAL_ENVELOPE;
const token=process.env.VOS_SERVE_ACCESS_TOKEN;
if(!encoded||!token)throw new Error("runner credential envelope or key is missing");
const envelope=JSON.parse(encoded);
const material=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
const key=await crypto.subtle.importKey("raw",material,{name:"AES-GCM"},false,["decrypt"]);
const clear=await crypto.subtle.decrypt({name:"AES-GCM",iv:Buffer.from(envelope.iv,"base64url")},key,Buffer.from(envelope.ciphertext,"base64url"));
process.umask(0o077);
await Bun.write("/tmp/vos-runner/model-credential.json",new Uint8Array(clear));
`;

async function encryptRunnerCredential(
  payload: string,
  accessToken: string,
): Promise<string> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(accessToken),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(payload),
  );
  return JSON.stringify({
    version: "runner-credential-envelope.v1",
    iv: Buffer.from(iv).toString("base64url"),
    ciphertext: Buffer.from(ciphertext).toString("base64url"),
  });
}

async function execDetached(
  container: Container,
  cmd: string[],
  env: string[],
): Promise<void> {
  await execCapture(container, cmd, env);
}

async function execCapture(
  container: Container,
  cmd: string[],
  env: string[],
): Promise<string> {
  const execution = await container.exec({
    Cmd: cmd,
    Env: env,
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await execution.start({ Detach: false, Tty: false });
  const output: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => output.push(Buffer.from(chunk)));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      stream.destroy();
      reject(new Error("runner setup command exceeded 120 seconds"));
    }, 120_000);
    const complete = () => {
      clearTimeout(timer);
      resolve();
    };
    stream.once("end", complete);
    stream.once("close", complete);
    stream.once("error", reject);
  });
  const result = await execution.inspect();
  const detail = Buffer.concat(output)
    .toString("utf8")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .slice(-4000);
  if (result.ExitCode !== 0) {
    throw new Error(
      `runner setup command failed with exit ${result.ExitCode}: ${detail}`,
    );
  }
  return detail;
}

async function execBackground(
  container: Container,
  cmd: string[],
): Promise<void> {
  const execution = await container.exec({
    Cmd: cmd,
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
  });
  await execution.start({ Detach: true });
}

async function waitHealthy(
  endpoint: string,
  token: string,
  container: Container,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = await container.inspect();
    if (!state.State.Running) {
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: 100,
      });
      throw new Error(
        `runner exited before readiness: ${logs.toString("utf8").slice(-4000)}`,
      );
    }
    const response = await fetch(`${endpoint}/api/v1/openapi.json`, {
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    if (response?.ok) return;
    await Bun.sleep(250);
  }
  throw new Error("runner did not become ready within 30 seconds");
}

async function removeContainer(
  container: Container | undefined,
): Promise<void> {
  if (!container) return;
  const inspect = await container.inspect().catch(() => undefined);
  if (!inspect) return;
  if (inspect.Config.Labels?.[LABEL_MANAGED] !== "true")
    throw new Error("refusing to remove an unmanaged container");
  if (inspect.State.Running)
    await container.stop({ t: 5 }).catch(() => undefined);
  await container.remove({ force: true, v: false });
}

function validateRequest(request: DockerRunnerRequest): void {
  if (
    !NAME_PATTERN.test(request.portalRunId) ||
    !NAME_PATTERN.test(request.projectId)
  )
    throw new Error("runner request contains an invalid identifier");
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(request.commitSha))
    throw new Error("runner requires a full immutable Git commit SHA");
  if (!request.policySnapshotRef || !request.stageKey)
    throw new Error("runner request is missing its stage or policy snapshot");
  if (
    request.commitLedger.commit_sha !== request.commitSha ||
    !request.commitLedger.run_id ||
    !request.commitLedger.collaboration_intent
  )
    throw new Error(
      "runner commit ledger does not match the requested immutable commit",
    );
}

function boundedNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value =
    process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredName(value: string, label: string): string {
  if (!NAME_PATTERN.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requiredImage(value: string): string {
  if (value.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9._/@:-]+$/.test(value))
    throw new Error("runner image reference is invalid");
  return value;
}

function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
