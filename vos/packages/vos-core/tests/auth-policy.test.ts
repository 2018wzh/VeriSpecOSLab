import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAuthStore, removeToken, saveToken } from "../src/auth/store.ts";
import type { PortalClient } from "../src/auth/portal-client.ts";
import { executePortalPipeline } from "../src/main.ts";
import { mergeEffectivePolicy } from "../src/policy/effective-policy.ts";

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

describe("frozen Portal auth and policy internals", () => {
  test("stores Portal tokens outside the project and encrypts them at rest", async () => {
    const projectRoot = makeProject();
    const storePath = makeTempPath("vos-auth", ".json");
    process.env.VOS_AUTH_STORE = storePath;

    await saveToken({
      portalUrl: "https://portal.example",
      token: "secret-token",
      user: { id: "user-1", role: "student", username: "student" },
    });

    const store = await loadAuthStore();
    expect(store.portals["https://portal.example"]?.token).toBe("secret-token");
    expect(readFileSync(storePath, "utf8")).not.toContain("secret-token");
    expect(JSON.parse(readFileSync(storePath, "utf8")).algorithm).toBe("aes-256-gcm");
    expect(readFileSync(join(projectRoot, ".vos", "project.yaml"), "utf8")).not.toContain("secret-token");

    await removeToken("https://portal.example");
    expect((await loadAuthStore()).portals["https://portal.example"]).toBeUndefined();
    expect(existsSync(storePath)).toBe(false);
    expect(existsSync(`${storePath}.key`)).toBe(false);
  });

  test("does not create credential artifacts when removing a missing token", async () => {
    const storePath = makeTempPath("vos-auth-missing", ".json");
    process.env.VOS_AUTH_STORE = storePath;

    expect(await removeToken("https://portal.example")).toBe(false);
    expect(existsSync(storePath)).toBe(false);
    expect(existsSync(`${storePath}.key`)).toBe(false);
  });

  test("fails fast when the encrypted credential store is corrupted", async () => {
    const storePath = makeTempPath("vos-auth-corrupt", ".json");
    process.env.VOS_AUTH_STORE = storePath;
    await saveToken({ portalUrl: "https://portal.example", token: "secret-token" });
    const envelope = JSON.parse(readFileSync(storePath, "utf8")) as { ciphertext: string };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;
    writeFileSync(storePath, JSON.stringify(envelope));

    await expect(loadAuthStore()).rejects.toThrow("credential store is corrupted");
  });

  test("local policy can only narrow Portal policy", () => {
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

  test("downloads only authorized artifacts and reports verified local paths", async () => {
    const projectRoot = await makeAuthorizedPortalProject();
    const bytes = new TextEncoder().encode("verified evidence\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const portalClient: PortalClient = {
      async getMe() {
        return { id: "user-1" };
      },
      async getProjectPolicy() {
        throw new Error("not used");
      },
      async getEvidence() {
        return {
          version: "evidence-bundle.v1",
          run: pipelineSummary("run-1", "project-1"),
          evidence: [],
          artifacts: [{
            id: "artifact-1",
            uri: "s3://private/artifact-1",
            sha256,
            size_bytes: bytes.byteLength,
            content_type: "text/plain",
            visibility: "public",
            label: "report.txt",
          }],
        };
      },
      async downloadArtifact(_url, token, artifact, destination) {
        expect(token).toBe("valid-token");
        expect(artifact.sha256).toBe(sha256);
        writeFileSync(destination, bytes);
        return { size_bytes: bytes.byteLength, sha256 };
      },
    };

    const result = await executePortalPipeline(
      { kind: "portal_pipeline", action: "download", runId: "run-1", scope: "public", outDir: "downloads" },
      portalContext(projectRoot, portalClient),
    );
    expect(result.status).toBe("passed");
    expect(result.details?.verified).toBe(true);
    expect(readFileSync(join(projectRoot, "downloads", "artifact-1-report.txt"), "utf8")).toBe("verified evidence\n");
  });

  test("returns immutable run reproduction metadata", async () => {
    const projectRoot = await makeAuthorizedPortalProject();
    const portalClient: PortalClient = {
      async getMe() {
        return { id: "user-1" };
      },
      async getProjectPolicy() {
        throw new Error("not used");
      },
      async getReproduction() {
        return {
          version: "run-reproduction.v1",
          run_id: "run-1",
          project_id: "project-1",
          commit_sha: "a".repeat(40),
          stage_key: "boot",
          scope: "public",
          policy_snapshot_ref: "policy-1",
          command: { program: "vos", arguments: ["verify", "public"] },
          artifacts: [],
          created_at: "2026-01-01T00:00:00.000Z",
        };
      },
    };

    const result = await executePortalPipeline(
      { kind: "portal_pipeline", action: "reproduce", runId: "run-1", scope: "public" },
      portalContext(projectRoot, portalClient),
    );
    expect(result.status).toBe("passed");
    expect((result.details?.reproduction as { policy_snapshot_ref: string }).policy_snapshot_ref).toBe("policy-1");
  });

  test("rejects pipeline resources from a different accessible Portal project", async () => {
    const projectRoot = await makeAuthorizedPortalProject();
    const portalClient: PortalClient = {
      async getMe() {
        return { id: "user-1" };
      },
      async getProjectPolicy() {
        throw new Error("not used");
      },
      async getPipeline() {
        return pipelineSummary("run-other", "project-2");
      },
    };

    await expect(executePortalPipeline(
      { kind: "portal_pipeline", action: "status", runId: "run-other", scope: "public" },
      portalContext(projectRoot, portalClient),
    )).rejects.toThrow("different project");
  });
});

function makeTempPath(prefix: string, suffix = ""): string {
  const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}${suffix}`);
  tmpRoots.push(path, `${path}.key`);
  return path;
}

function makeProject(): string {
  const root = makeTempPath("vos-auth-policy");
  mkdirSync(join(root, ".vos"), { recursive: true });
  writeFileSync(join(root, ".vos", "project.yaml"), [
    "project_id: project-1",
    "portal_url: https://portal.example",
    "spec_root: spec",
    "current_stage: boot",
    "",
  ].join("\n"));
  return root;
}

async function makeAuthorizedPortalProject(): Promise<string> {
  const root = makeProject();
  process.env.VOS_AUTH_STORE = makeTempPath("vos-auth", ".json");
  await saveToken({ portalUrl: "https://portal.example", token: "valid-token" });
  return root;
}

function portalContext(projectRoot: string, portalClient: PortalClient) {
  return {
    projectRoot,
    global: {} as never,
    evidence: {} as never,
    portalClient,
  };
}

function pipelineSummary(id: string, projectId: string) {
  return {
    version: "pipeline-summary.v1" as const,
    id,
    project_id: projectId,
    commit_sha: "a".repeat(40),
    stage_key: "boot",
    status: "passed" as const,
    passed: 1,
    total: 1,
    public_message: "passed",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}
