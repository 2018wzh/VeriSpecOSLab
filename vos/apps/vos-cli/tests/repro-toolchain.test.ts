import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeCliInvocation } from "../app/main.ts";
import type { HeadlessAgentOptions } from "vos-agent/headless";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("reproducibility gate and agent-assisted toolchain generation", () => {
  test("blocks controlled build when current HEAD has no ledger entry", async () => {
    const projectRoot = makeGitProject({ manifest: true });

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "--dry-run",
    ], { print: false });

    expect(result.status).toBe("policy_blocked");
    expect(result.message).toContain("ledger_missing");
  });

  test("blocks non-build controlled project commands when current HEAD has no ledger entry", async () => {
    const projectRoot = makeGitProject({ manifest: true });

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "spec",
      "lint",
    ], { print: false });

    expect(result.status).toBe("policy_blocked");
    expect(result.message).toContain("ledger_missing");
  });

  test("init records current HEAD and allows build with generated manifest", async () => {
    const projectRoot = makeGitProject({ manifest: true });
    writeFileSync(join(projectRoot, ".gitignore"), "build/\n");

    const init = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "init",
    ], { print: false });
    expect(init.status).toBe("passed");
    expect(readFileSync(join(projectRoot, ".vos", "commit-ledger.jsonl"), "utf8")).toContain("\"actor\":\"human\"");
    expect(readFileSync(join(projectRoot, ".gitignore"), "utf8")).toBe("build/\n.vos/\n");

    await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "init",
    ], { print: false });
    expect(readFileSync(join(projectRoot, ".gitignore"), "utf8")).toBe("build/\n.vos/\n");

    const build = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "--dry-run",
    ], { print: false });

    expect(build.status).toBe("ok");
    const manifest = JSON.parse(readFileSync(join(projectRoot, ".vos", "runs", build.run_id, "manifest.json"), "utf8"));
    expect(manifest.git_rev).toBeTruthy();
    expect(manifest.ledger_ref).toContain(".vos/commit-ledger.jsonl#");
    expect(manifest.spec_hash).toBeTruthy();
    expect(manifest.input_files).toContain(".vos/toolchain.json");
    expect(manifest.input_files).toContain("Makefile");
    expect(manifest.output_files).toContain("build/kernel.bin");
  });

  test("build fails instead of auto-materializing a legacy manifest", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "--dry-run",
    ], { print: false });

    expect(result.status).toBe("failed");
    expect(result.message).toContain(".vos/toolchain.json");
    expect(existsSync(join(projectRoot, ".vos", "toolchain.json"))).toBe(false);
  });

  test("agent-assisted build generate gates draft, writes ledger, and creates a commit", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });
    let captured: HeadlessAgentOptions | undefined;
    const agentRunner = async (options: HeadlessAgentOptions) => {
      captured = options;
      return {
        content: JSON.stringify({
          files: [{
            path: "Makefile",
            content: "all:\n\tprintf generated\n",
          }],
          manifest: {
            manifest_version: 2,
            generator: { name: "vos-agent", version: "toolchain-draft-v1" },
            files: ["Makefile"],
            build: { variants: [{ id: "baseline", commands: ["make all"], artifacts: ["build/kernel.bin"] }] },
            run: {
              profiles: [{ id: "default", command: "printf", args: ["boot ok"], artifacts: ["build/kernel.bin"], timeout_secs: 1 }],
              cases: [{ id: "smoke", profile: "default", success_regex: "boot ok" }],
            },
            test: { suites: [] },
          },
          build_instructions: "Run `vos build` after generation.",
          spec_refs: ["spec/toolchain/build.yaml"],
          changed_targets: ["Makefile", ".vos/toolchain.json"],
        }),
        events: [],
      };
    };

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "generate",
      "--agent-session",
      "session-1",
    ], { print: false, agentRunner });

    expect(result.status).toBe("passed");
    expect(captured?.courseMode).toBe(true);
    expect(captured?.prompt).toContain("toolchain draft");
    expect(readFileSync(join(projectRoot, "Makefile"), "utf8")).toContain("printf generated");
    expect(JSON.parse(readFileSync(join(projectRoot, ".vos", "toolchain.json"), "utf8")).spec_hash).toBeTruthy();
    expect(readFileSync(join(projectRoot, ".vos", "commit-ledger.jsonl"), "utf8")).toContain("toolchain-generate");
    expect(git(projectRoot, ["log", "-1", "--pretty=%s"]).stdout.trim()).toBe("[vos][toolchain] Generate build system");
  });

  test("build generate rejects drafts that write outside allowed_output_path", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });
    const agentRunner = async () => ({
      content: JSON.stringify({
        files: [{ path: "scripts/build.sh", content: "echo bad\n" }],
        manifest: {
          manifest_version: 2,
          generator: { name: "vos-agent", version: "toolchain-draft-v1" },
          files: ["scripts/build.sh"],
          build: { variants: [{ id: "baseline", commands: ["sh scripts/build.sh"], artifacts: [] }] },
          run: { profiles: [{ id: "default", command: "printf", args: ["ok"], artifacts: [] }], cases: [{ id: "smoke", profile: "default", success_regex: "ok" }] },
          test: { suites: [] },
        },
        build_instructions: "bad",
        spec_refs: ["spec/toolchain/build.yaml"],
        changed_targets: ["scripts/build.sh"],
      }),
      events: [],
    });

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "generate",
    ], { print: false, agentRunner });

    expect(result.status).toBe("policy_blocked");
    expect(existsSync(join(projectRoot, "scripts", "build.sh"))).toBe(false);
  });
});

function makeGitProject(options: { manifest: boolean }): string {
  const root = join("/tmp", `vos-repro-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tmpRoots.push(root);
  mkdirSync(join(root, ".vos"), { recursive: true });
  mkdirSync(join(root, "spec", "toolchain"), { recursive: true });
  writeFileSync(join(root, ".vos", "project.yaml"), [
    "project_id: local-project",
    "spec_root: spec",
    "current_stage: boot",
    "",
  ].join("\n"));
  writeFileSync(join(root, ".vos", "policy.yaml"), [
    "allowed_commands:",
    "  - build",
    "  - build generate",
    "  - ledger record",
    "allowed_paths:",
    "  - .vos",
    "  - spec",
    "  - Makefile",
    "visibility_scope: public",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "toolchain", "toolchain.yaml"), "includes:\n  - build.yaml\n  - run.yaml\n");
  writeFileSync(join(root, "spec", "toolchain", "build.yaml"), [
    "build:",
    "  allowed_output_path:",
    "    - Makefile",
    "  generated_artifacts:",
    "    - build/kernel.bin",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "toolchain", "run.yaml"), [
    "run:",
    "  command: printf",
    "  success_signal: boot ok",
    "  artifact: build/kernel.bin",
    "  timeout_secs: 1",
    "",
  ].join("\n"));
  writeFileSync(join(root, "Makefile"), "all:\n\tprintf existing\n");
  if (options.manifest) {
    writeFileSync(join(root, ".vos", "toolchain.json"), JSON.stringify({
      manifest_version: 2,
      generator: { name: "test", version: "1" },
      files: ["Makefile"],
      build: { variants: [{ id: "baseline", commands: ["make all"], artifacts: ["build/kernel.bin"] }] },
      run: { profiles: [{ id: "default", command: "printf", args: ["boot ok"], artifacts: ["build/kernel.bin"] }], cases: [{ id: "smoke", profile: "default", success_regex: "boot ok" }] },
      test: { suites: [] },
    }, null, 2));
  }
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  return root;
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
