import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeCliInvocation } from "../src/main.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("student v2 initialization and reproducibility gates", () => {
  test("doctor reports an actionable error before initialization without creating files", async () => {
    const projectRoot = makeRoot();
    const result = await invoke(projectRoot, "doctor");

    expect(result.status).toBe("validation_failed");
    expect(result.details?.missing).toContain("vos.yaml");
    expect(result.details?.suggested_next_commands).toEqual(["vos init"]);
    expect(existsSync(join(projectRoot, "vos.yaml"))).toBe(false);
    expect(existsSync(join(projectRoot, ".vos"))).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "project.yaml"))).toBe(false);
  });

  test("init creates only the five-family student projection and commits it", async () => {
    const projectRoot = makeRoot();
    const result = await withGitIdentity(() => invoke(projectRoot, "init"));

    expect(result.status).toBe("passed");
    expect(existsSync(join(projectRoot, ".git"))).toBe(true);
    expect(existsSync(join(projectRoot, "vos.yaml"))).toBe(true);
    expect(existsSync(join(projectRoot, "spec", "design.yaml"))).toBe(true);
    expect(existsSync(join(projectRoot, "spec", "modules", "toolchain.yaml"))).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "project.yaml"))).toBe(false);
    expect(existsSync(join(projectRoot, ".vos", "policy.yaml"))).toBe(false);
    expect(git(projectRoot, ["log", "-1", "--pretty=%s"]).trim()).toBe("[vos][init] Initialize VOS project");
    expect(git(projectRoot, ["status", "--porcelain", "--untracked-files=all"]).trim()).toBe("");
  });

  test("init is idempotent and never overwrites a student-authored projection", async () => {
    const projectRoot = makeRoot();
    await withGitIdentity(async () => {
      expect((await invoke(projectRoot, "init")).status).toBe("passed");
      const design = readFileSync(join(projectRoot, "spec", "design.yaml"), "utf8");
      writeFileSync(join(projectRoot, "spec", "design.yaml"), `${design}# student note\n`);
      const second = await invoke(projectRoot, "init");
      expect(second.status).toBe("passed");
      expect(readFileSync(join(projectRoot, "spec", "design.yaml"), "utf8")).toContain("# student note");
      expect(git(projectRoot, ["status", "--porcelain"]).trim()).toContain("spec/design.yaml");
    });
  });

  test("init fails closed when Git identity is unavailable", async () => {
    const projectRoot = makeRoot();
    const result = await withoutGitIdentity(() => invoke(projectRoot, "init"));

    expect(result.status).toBe("policy_blocked");
    expect(result.message).toContain("git identity is required");
    expect(gitMaybe(projectRoot, ["rev-parse", "--verify", "HEAD"]).ok).toBe(false);
  });

  test("legacy student command aliases are rejected after v2 initialization", async () => {
    const projectRoot = makeRoot();
    await withGitIdentity(async () => {
      expect((await invoke(projectRoot, "init")).status).toBe("passed");
      for (const args of [["build", "generate"], ["toolchain", "init"], ["agent", "plan"]]) {
        await expect(invoke(projectRoot, ...args)).rejects.toThrow("removed");
      }
    });
  });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "vos-student-repro-"));
  roots.push(root);
  return root;
}

function invoke(projectRoot: string, ...args: string[]) {
  return executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", ...args], { print: false });
}

async function withGitIdentity<T>(fn: () => Promise<T>): Promise<T> {
  const keys = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.GIT_AUTHOR_NAME = "VOS Student Test";
  process.env.GIT_AUTHOR_EMAIL = "student@example.invalid";
  process.env.GIT_COMMITTER_NAME = "VOS Student Test";
  process.env.GIT_COMMITTER_EMAIL = "student@example.invalid";
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withoutGitIdentity<T>(fn: () => Promise<T>): Promise<T> {
  const isolatedConfigHome = mkdtempSync(join(tmpdir(), "vos-empty-git-config-"));
  roots.push(isolatedConfigHome);
  const previous = new Map<string, string | undefined>([
    ["GIT_AUTHOR_NAME", process.env.GIT_AUTHOR_NAME],
    ["GIT_AUTHOR_EMAIL", process.env.GIT_AUTHOR_EMAIL],
    ["GIT_COMMITTER_NAME", process.env.GIT_COMMITTER_NAME],
    ["GIT_COMMITTER_EMAIL", process.env.GIT_COMMITTER_EMAIL],
    ["GIT_CONFIG_GLOBAL", process.env.GIT_CONFIG_GLOBAL],
    ["GIT_CONFIG_NOSYSTEM", process.env.GIT_CONFIG_NOSYSTEM],
  ]);
  delete process.env.GIT_AUTHOR_NAME;
  delete process.env.GIT_AUTHOR_EMAIL;
  delete process.env.GIT_COMMITTER_NAME;
  delete process.env.GIT_COMMITTER_EMAIL;
  process.env.GIT_CONFIG_GLOBAL = join(isolatedConfigHome, "config");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString());
  return result.stdout.toString();
}

function gitMaybe(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
