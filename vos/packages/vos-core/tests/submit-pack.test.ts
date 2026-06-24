import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as tar from "tar";
import { executeCliInvocation } from "../src/main.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("submit pack", () => {
  test("creates reproducible tarball without build products or untracked files", async () => {
    const projectRoot = makeSubmitProject();
    writeFileSync(join(projectRoot, "untracked-secret.c"), "int secret;\n");

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "submit",
      "pack",
    ], { print: false });

    expect(result.status).toBe("passed");
    const packPath = join(projectRoot, result.details?.pack_path as string);
    expect(existsSync(packPath)).toBe(true);
    const entries = await tarEntries(packPath);
    expect(entries).toContain("repo/kernel/main.c");
    expect(entries).toContain("repo/spec/reports/stage-boot-report.md");
    expect(entries).toContain("metadata/vos/toolchain.json");
    expect(entries).toContain("submit-manifest.json");
    expect(entries.some((entry) => entry.startsWith("repo/build/"))).toBe(false);
    expect(entries.some((entry) => /\.(bin|elf|img)$/.test(entry))).toBe(false);
    expect(entries).not.toContain("repo/untracked-secret.c");
    const manifest = JSON.parse(readFileSync(join(projectRoot, result.details?.manifest_path as string), "utf8"));
    expect(manifest.image_included).toBe(false);
    expect(manifest.rebuild_required).toBe(true);
    expect(manifest.toolchain_environment.required_tools[0].name).toBe("true");
  });

  test("fails when toolchain environment is missing", async () => {
    const projectRoot = makeSubmitProject({ environment: false });
    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "submit",
      "pack",
    ], { print: false });
    expect(result.status).toBe("failed");
    expect(result.message).toContain("invalid toolchain manifest v2");
  });

  test("fails on ordinary untracked files before packing", async () => {
    const projectRoot = makeSubmitProject();
    writeFileSync(join(projectRoot, "dirty.c"), "int dirty;\n");
    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "submit",
      "pack",
    ], { print: false });
    expect(result.status).toBe("policy_blocked");
    expect(result.message).toContain("dirty_worktree");
  });
});

function makeSubmitProject(options: { environment?: boolean } = {}): string {
  const root = join("/tmp", `vos-submit-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  mkdirSync(join(root, ".vos", "index"), { recursive: true });
  mkdirSync(join(root, ".vos", "runs", "build-run"), { recursive: true });
  mkdirSync(join(root, "kernel"), { recursive: true });
  mkdirSync(join(root, "build"), { recursive: true });
  mkdirSync(join(root, "spec", "reports"), { recursive: true });
  mkdirSync(join(root, "tests", "public"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), ".vos/\nuntracked-secret.c\n");
  writeFileSync(join(root, "Makefile"), "all:\n\ttrue\n");
  writeFileSync(join(root, "kernel", "main.c"), "int main(void) { return 0; }\n");
  writeFileSync(join(root, "build", "kernel.bin"), "binary\n");
  writeFileSync(join(root, "fs.img"), "image\n");
  writeFileSync(join(root, "spec", "reports", "stage-boot-report.md"), "# Boot Report\n");
  writeFileSync(join(root, "tests", "public", "verify.sh"), "#!/usr/bin/env sh\ntrue\n");
  writeFileSync(join(root, ".vos", "project.yaml"), "project_id: submit-test\nspec_root: spec\ncurrent_stage: boot\n");
  writeFileSync(join(root, ".vos", "policy.yaml"), "allowed_commands:\n  - submit pack\nallowed_paths:\n  - .\nvisibility_scope: public\n");
  writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify({
    manifest_version: 2,
    files: ["Makefile"],
    ...(options.environment === false ? {} : {
      environment: { required_tools: [{ name: "true", command: "true", version_args: ["--version"], version_constraint: ">=0", kind: "utility" }] },
    }),
    build: { variants: [{ id: "baseline", commands: ["true"], artifacts: ["build/kernel.bin"] }] },
    run: { profiles: [{ id: "default", command: "true", args: [], artifacts: [] }], cases: [{ id: "smoke", profile: "default" }] },
    test: { suites: [] },
  }, null, 2));
  writeFileSync(join(root, ".vos", "index", "evidence.json"), JSON.stringify({
    version: 1,
    runs: [{ run_id: "build-run", command: ["build"], status: "ok", manifest: ".vos/runs/build-run/manifest.json", started_at: "2026-06-23T00:00:00.000Z", finished_at: "2026-06-23T00:00:01.000Z" }],
  }, null, 2));
  writeFileSync(join(root, ".vos", "runs", "build-run", "manifest.json"), JSON.stringify({ run_id: "build-run", status: "ok" }, null, 2));
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "VOS Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  writeFileSync(join(root, ".vos", "commit-ledger.jsonl"), `${JSON.stringify({
    commit_sha: head,
    actor: "human",
    spec_refs: [],
    changed_targets: [],
    evidence_refs: [],
    created_at: "2026-06-23T00:00:00.000Z",
    collaboration_intent: "submit fixture",
  })}\n`);
  return root;
}

async function tarEntries(file: string): Promise<string[]> {
  const entries: string[] = [];
  await tar.t({ file, onentry: (entry) => entries.push(entry.path) });
  return entries;
}

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  return proc.stdout.toString();
}
