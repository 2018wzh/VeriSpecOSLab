import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveToken } from "../app/auth/store.ts";
import { createVosHttpHandler } from "../app/server/http.ts";
import type { PortalClient } from "../app/auth/portal-client.ts";

const tmpRoots: string[] = [];
const previousAuthStore = process.env.VOS_AUTH_STORE;

afterEach(() => {
  if (previousAuthStore === undefined) {
    delete process.env.VOS_AUTH_STORE;
  } else {
    process.env.VOS_AUTH_STORE = previousAuthStore;
  }
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("vos serve HTTP façade", () => {
  test("creates a run and streams existing plus live events", async () => {
    const { projectRoot, portalUrl, portalClient } = await makePortalBoundProject();
    process.env.VOS_AUTH_STORE = join("/tmp", `vos-http-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    await saveToken({
      portalUrl,
      token: "ok-token",
      user: { id: "user-1", role: "student" },
    });
    const handler = createVosHttpHandler({
      projectRoot,
      portalUrl,
      projectId: "project-1",
      host: "127.0.0.1",
      port: randomPort(),
      portalClient,
    });

    {
      const create = await handler(new Request("http://vos.test/api/v1/vos/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "build",
          args: ["--dry-run"],
          requested_by: "runner",
        }),
      }));
      expect(create.status).toBe(202);
      const created = await create.json() as { run_id: string };
      expect(created.run_id).toBeTruthy();

      await waitForTerminal(handler, created.run_id);
      const events = await handler(new Request(`http://vos.test/api/v1/vos/runs/${created.run_id}/events`));
      const text = await events.text();
      expect(text).toContain("run_started");
      expect(text).toContain("run_finished");

      const status = await (await handler(new Request(`http://vos.test/api/v1/vos/runs/${created.run_id}`))).json() as { status: string };
      expect(["ok", "passed"]).toContain(status.status);
    }
  });

  test("cancels a long run and records cancelled status", async () => {
    const { projectRoot, portalUrl, portalClient } = await makePortalBoundProject({ longBuild: true });
    process.env.VOS_AUTH_STORE = join("/tmp", `vos-http-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    await saveToken({
      portalUrl,
      token: "ok-token",
      user: { id: "user-1", role: "student" },
    });
    const handler = createVosHttpHandler({
      projectRoot,
      portalUrl,
      projectId: "project-1",
      host: "127.0.0.1",
      port: randomPort(),
      portalClient,
    });

    {
      const create = await handler(new Request("http://vos.test/api/v1/vos/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "build",
          args: [],
          requested_by: "runner",
        }),
      }));
      const created = await create.json() as { run_id: string };
      await new Promise((resolve) => setTimeout(resolve, 50));

      const cancel = await handler(new Request(`http://vos.test/api/v1/vos/runs/${created.run_id}/cancel`, { method: "POST" }));
      expect(cancel.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const status = await (await handler(new Request(`http://vos.test/api/v1/vos/runs/${created.run_id}`))).json() as { status: string };
      expect(["cancelled", "timed_out"]).toContain(status.status);
    }
  });
});

async function makePortalBoundProject(options: { longBuild?: boolean } = {}): Promise<{
  projectRoot: string;
  portalUrl: string;
  portalClient: PortalClient;
}> {
  const root = join("/tmp", `vos-http-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tmpRoots.push(root);
  mkdirSync(join(root, ".vos"), { recursive: true });
  mkdirSync(join(root, "spec", "toolchain"), { recursive: true });
  writeFileSync(join(root, ".vos", "project.yaml"), [
    "project_id: project-1",
    "portal_url: http://portal.test",
    "spec_root: spec",
    "current_stage: boot",
    "",
  ].join("\n"));
  writeFileSync(join(root, ".vos", "policy.yaml"), [
    "allowed_commands:",
    "  - build",
    "allowed_paths:",
    "  - .vos",
    "  - spec",
    "visibility_scope: public",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "toolchain", "build.yaml"), [
    "allowed_output_path:",
    "  - .vos",
    "",
  ].join("\n"));
  if (options.longBuild) {
    const script = join(root, "slow-build.sh");
    writeFileSync(script, "#!/usr/bin/env sh\nsleep 5\n");
    chmodSync(script, 0o755);
    writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify({
      manifest_version: 2,
      files: [],
      build: { variants: [{ id: "baseline", commands: [{ name: "slow", command: [script], timeout_ms: 10_000 }], artifacts: [] }] },
      run: { profiles: [{ id: "default", command: "printf", args: ["ok"], artifacts: [] }], cases: [{ id: "smoke", profile: "default", success_regex: "ok" }] },
      test: { suites: [] },
    }, null, 2));
  } else {
    writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify({
      manifest_version: 2,
      files: [],
      build: { variants: [{ id: "baseline", commands: ["printf ok"], artifacts: [] }] },
      run: { profiles: [{ id: "default", command: "printf", args: ["ok"], artifacts: [] }], cases: [{ id: "smoke", profile: "default", success_regex: "ok" }] },
      test: { suites: [] },
    }, null, 2));
  }
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  const head = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  writeFileSync(join(root, ".vos", "commit-ledger.jsonl"), `${JSON.stringify({
    commit_sha: head,
    actor: "human",
    spec_refs: [],
    changed_targets: [],
    evidence_refs: [],
    created_at: new Date().toISOString(),
    collaboration_intent: "test runner checkout",
  })}\n`);

  return {
    projectRoot: root,
    portalUrl: "http://portal.test",
    portalClient: {
      async getMe(_portalUrl, token) {
        if (token !== "ok-token") throw new Error("unauthorized");
        return { id: "user-1", role: "student", username: "student" };
      },
      async getProjectPolicy(_portalUrl, projectId) {
        return {
          ref: "policy-1",
          projectId,
          allowedCommands: ["build"],
          allowedPaths: [".vos", "spec"],
          visibilityScope: "public",
        };
      },
    },
  };
}

function git(cwd: string, args: string[]): { stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function randomPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}

async function waitForTerminal(handler: (req: Request) => Promise<Response>, runId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const status = await (await handler(new Request(`http://vos.test/api/v1/vos/runs/${runId}`))).json() as { status: string };
    if (status.status !== "queued" && status.status !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("run did not finish");
}
