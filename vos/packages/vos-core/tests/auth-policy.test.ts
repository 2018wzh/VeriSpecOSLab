import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAuthStore, removeToken, saveToken } from "../src/auth/store.ts";
import { mergeEffectivePolicy } from "../src/policy/effective-policy.ts";
import { executeCliInvocation } from "../src/main.ts";
import type { PortalClient } from "../src/auth/portal-client.ts";

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

describe("vos-cli auth store and policy gate", () => {
  test("stores portal tokens outside the project directory", async () => {
    const projectRoot = makeProject();
    const storePath = join("/tmp", `vos-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    process.env.VOS_AUTH_STORE = storePath;

    await saveToken({
      portalUrl: "https://portal.example",
      token: "secret-token",
      user: { id: "user-1", role: "student", username: "student" },
    });

    const store = await loadAuthStore();
    expect(store.portals["https://portal.example"]?.token).toBe("secret-token");
    expect(readFileSync(storePath, "utf8")).toContain("secret-token");
    expect(readFileSync(join(projectRoot, ".vos", "project.yaml"), "utf8")).not.toContain("secret-token");

    await removeToken("https://portal.example");
    expect((await loadAuthStore()).portals["https://portal.example"]).toBeUndefined();
  });

  test("local policy can only narrow portal policy", () => {
    const effective = mergeEffectivePolicy({
      portal: {
        ref: "policy-1",
        projectId: "project-1",
        allowedCommands: ["build", "verify public"],
        allowedPaths: ["spec", "src", ".vos"],
        visibilityScope: "agent-only",
      },
      local: {
        allowed_commands: ["verify public", "run qemu"],
        allowed_paths: ["src/kernel", "tests"],
        visibility_scope: "public",
      },
    });

    expect(effective.allowedCommands).toEqual(["verify public"]);
    expect(effective.allowedPaths).toEqual(["src/kernel"]);
    expect(effective.visibilityScope).toBe("agent-only");
  });

  test("blocks portal-bound project commands when not logged in", async () => {
    const projectRoot = makeProject({ portalUrl: "http://127.0.0.1:1", projectId: "project-1" });
    process.env.VOS_AUTH_STORE = join(projectRoot, "auth.json");

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "--dry-run",
    ], {
      print: false,
    });

    expect(result.status).toBe("policy_blocked");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not_logged_in");
    const manifest = readFileSync(join(projectRoot, ".vos", "runs", result.run_id, "manifest.json"), "utf8");
    expect(manifest).toContain("\"auth_verdict\": \"denied\"");
  });

  test("login validates token online before writing auth store", async () => {
    const projectRoot = makeProject();
    process.env.VOS_AUTH_STORE = join(projectRoot, "auth.json");
    const portalClient: PortalClient = {
      async getMe(_portalUrl, token) {
        if (token !== "valid-token") throw new Error("unauthorized");
        return { id: "user-1", role: "student", username: "student" };
      },
      async getProjectPolicy() {
        throw new Error("not used");
      },
    };

    const failed = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "login",
      "--portal-url",
      "https://portal.example",
      "--token",
      "bad-token",
    ], { print: false, portalClient });
    expect(failed.status).toBe("policy_blocked");
    expect((await loadAuthStore()).portals["https://portal.example"]).toBeUndefined();

    const ok = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "login",
      "--portal-url",
      "https://portal.example",
      "--token",
      "valid-token",
    ], { print: false, portalClient });
    expect(ok.status).toBe("passed");
    const entry = (await loadAuthStore()).portals["https://portal.example"];
    expect(entry?.token).toBe("valid-token");
    expect(entry?.user?.id).toBe("user-1");
  });

  test("whoami performs an online policy check for portal-bound projects", async () => {
    const projectRoot = makeProject({ portalUrl: "https://portal.example", projectId: "project-1" });
    process.env.VOS_AUTH_STORE = join(projectRoot, "auth.json");
    await saveToken({ portalUrl: "https://portal.example", token: "valid-token" });
    const portalClient: PortalClient = {
      async getMe() {
        return { id: "user-1", role: "student", username: "student" };
      },
      async getProjectPolicy(_portalUrl, projectId) {
        return {
          ref: "policy-1",
          projectId,
          allowedCommands: ["build"],
          allowedPaths: [".vos", "spec"],
          visibilityScope: "agent-only",
        };
      },
    };

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "whoami",
    ], { print: false, portalClient });

    expect(result.status).toBe("passed");
    expect(result.details?.authenticated).toBe(true);
    expect(result.details?.policy_status).toBe("online");
    expect(result.details?.policy_snapshot_ref).toBe("policy-1");
  });

  test("portal policy with empty allowed commands denies project commands", async () => {
    const projectRoot = makeProject({ portalUrl: "https://portal.example", projectId: "project-1" });
    process.env.VOS_AUTH_STORE = join(projectRoot, "auth.json");
    await saveToken({ portalUrl: "https://portal.example", token: "valid-token" });
    const portalClient: PortalClient = {
      async getMe() {
        return { id: "user-1", role: "student" };
      },
      async getProjectPolicy(_portalUrl, projectId) {
        return {
          ref: "policy-empty",
          projectId,
          allowedCommands: [],
          allowedPaths: [".vos", "spec"],
          visibilityScope: "public",
        };
      },
    };

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "--dry-run",
    ], { print: false, portalClient });

    expect(result.status).toBe("policy_blocked");
    expect(result.message).toContain("command_denied");
  });

  test("agent context uses effective portal policy for paths and visibility", async () => {
    const projectRoot = makeProject({ portalUrl: "https://portal.example", projectId: "project-1" });
    process.env.VOS_AUTH_STORE = join("/tmp", `vos-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    await makeLedgerReady(projectRoot);
    await saveToken({ portalUrl: "https://portal.example", token: "valid-token" });
    const portalClient: PortalClient = {
      async getMe() {
        return { id: "user-1", role: "student" };
      },
      async getProjectPolicy(_portalUrl, projectId) {
        return {
          ref: "policy-agent",
          projectId,
          allowedCommands: ["agent context"],
          allowedPaths: ["spec"],
          visibilityScope: "agent-only",
        };
      },
    };

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "agent",
      "context",
    ], { print: false, portalClient });

    expect(result.status).toBe("passed");
    expect(result.details?.allowed_paths).toEqual(["spec"]);
    expect(result.details?.visibility_scope).toBe("agent-only");
    expect(result.details?.allowed_commands).toEqual(["agent context"]);
  });
});

function makeProject(options: { portalUrl?: string; projectId?: string } = {}): string {
  const root = join("/tmp", `vos-auth-policy-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tmpRoots.push(root);
  mkdirSync(join(root, ".vos"), { recursive: true });
  mkdirSync(join(root, "spec", "toolchain"), { recursive: true });
  writeFileSync(join(root, ".vos", "project.yaml"), [
    `project_id: ${options.projectId ?? "local-project"}`,
    options.portalUrl ? `portal_url: ${options.portalUrl}` : undefined,
    "spec_root: spec",
    "current_stage: boot",
    "",
  ].filter(Boolean).join("\n"));
  writeFileSync(join(root, ".vos", "policy.yaml"), [
    "allowed_commands:",
    "  - build",
    "  - verify public",
    "  - agent context",
    "allowed_paths:",
    "  - spec",
    "  - .vos",
    "visibility_scope: public",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "toolchain", "build.yaml"), "allowed_output_path:\n  - .vos\n");
  return root;
}

async function makeLedgerReady(projectRoot: string): Promise<void> {
  git(projectRoot, ["init"]);
  git(projectRoot, ["config", "user.email", "test@example.com"]);
  git(projectRoot, ["config", "user.name", "Test User"]);
  git(projectRoot, ["add", "."]);
  git(projectRoot, ["commit", "-m", "initial"]);
  await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });
}

function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
}
