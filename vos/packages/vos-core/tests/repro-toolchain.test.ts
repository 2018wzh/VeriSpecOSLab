import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeCliInvocation } from "../src/main.ts";
import type { AgentTaskRequest } from "vos-agent/headless";

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
    expect(result.details?.suggested_next_commands).toContain('vos stage save --intent "record current stage state"');
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
    expect(readFileSync(join(projectRoot, "AGENTS.md"), "utf8")).toContain("Update this file when new public project conventions");

    await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "init",
    ], { print: false });
    expect(readFileSync(join(projectRoot, ".gitignore"), "utf8")).toBe("build/\n.vos/\n");
    expect(readFileSync(join(projectRoot, "AGENTS.md"), "utf8")).toContain("Update this file when new public project conventions");

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

  test("init does not overwrite an existing AGENTS.md", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    writeFileSync(join(projectRoot, "AGENTS.md"), "custom agent rules\n");

    const init = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "init",
    ], { print: false });

    expect(init.status).toBe("passed");
    expect(readFileSync(join(projectRoot, "AGENTS.md"), "utf8")).toBe("custom agent rules\n");
  });

  test("init default policy lists only supported verify scopes", async () => {
    const projectRoot = makeGitProject({ manifest: false, policy: false });

    const init = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "init",
    ], { print: false });

    expect(init.status).toBe("passed");
    const policy = readFileSync(join(projectRoot, ".vos", "policy.yaml"), "utf8");
    expect(policy).toContain("  - verify public");
    expect(policy).toContain("  - verify patch");
    expect(policy).toContain("  - verify full");
    expect(policy).toContain("  - verify invariant");
    expect(policy).toContain("  - verify fuzz");
    expect(policy).not.toContain("  - verify base");
    expect(policy).not.toContain("  - verify architecture");
    expect(policy).not.toContain("  - verify composition");
    expect(policy).not.toContain("  - verify goal");
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
    expect(result.message?.replace(/\\/g, "/")).toContain(".vos/toolchain.json");
    expect(existsSync(join(projectRoot, ".vos", "toolchain.json"))).toBe(false);
  });

  test("agent-assisted build generate gates draft, writes ledger, and creates a commit", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });
    let captured: AgentTaskRequest | undefined;
    const agentRunner = async (options: AgentTaskRequest) => {
      captured = options;
      const submitted = {
        files: [{
          path: "Makefile",
          content: "all:\n\tprintf generated\n",
        }],
        manifest: {
          manifest_version: 2,
          generator: { name: "vos-agent", version: "toolchain-draft-v1" },
          files: ["Makefile"],
          environment: { required_tools: [{ name: "true", command: "true", version_args: ["--version"], version_constraint: ">=0", kind: "utility" }] },
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
      };
      return {
        content: "ignored",
        events: acceptedSubmitEvents("toolchain_generation_draft.v1", submitted),
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
    expect(captured?.taskKind).toBe("toolchain_generate");
    expect(captured?.task).toContain("toolchain draft");
    expect(readFileSync(join(projectRoot, "Makefile"), "utf8")).toContain("printf generated");
    expect(JSON.parse(readFileSync(join(projectRoot, ".vos", "toolchain.json"), "utf8")).spec_hash).toBeTruthy();
    expect(readFileSync(join(projectRoot, ".vos", "commit-ledger.jsonl"), "utf8")).toContain("toolchain-generate");
    expect(git(projectRoot, ["log", "-1", "--pretty=%s"]).stdout.trim()).toBe("[vos][toolchain] Generate build system");
  });

  test("toolchain init writes a deterministic manifest from spec files", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "toolchain",
      "init",
    ], { print: false });

    expect(result.status).toBe("passed");
    const manifest = JSON.parse(readFileSync(join(projectRoot, ".vos", "toolchain.json"), "utf8"));
    expect(manifest.manifest_version).toBe(2);
    expect(manifest.environment.required_tools[0].command).toBe("true");
    expect(manifest.build.variants[0].commands[0].command).toEqual(["make", "all"]);
    expect(manifest.run.profiles[0].command).toBe("printf");
    expect(manifest.run.cases[0]).toMatchObject({ success_regex: "boot ok", exit_code: 0 });
  });

  test("build generate --no-agent reuses deterministic toolchain init", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "generate",
      "--no-agent",
    ], {
      print: false,
      agentRunner: async () => {
        throw new Error("agent should not be called");
      },
    });

    expect(result.status).toBe("passed");
    expect(readFileSync(join(projectRoot, "Makefile"), "utf8")).toContain("printf existing");
    expect(JSON.parse(readFileSync(join(projectRoot, ".vos", "toolchain.json"), "utf8")).generator.name).toBe("vos-deterministic");
  });

  test("stage save commits dirty worktree and records ledger", async () => {
    const projectRoot = makeGitProject({ manifest: true });
    writeFileSync(join(projectRoot, "Makefile"), "all:\n\tprintf changed\n");

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "stage",
      "save",
      "--intent",
      "save edited makefile",
    ], { print: false });

    expect(result.status).toBe("passed");
    expect(git(projectRoot, ["status", "--porcelain"]).stdout.trim()).toBe("");
    expect(git(projectRoot, ["log", "-1", "--pretty=%s"]).stdout.trim()).toBe("[vos][stage] Save stage state");
    expect(readFileSync(join(projectRoot, ".vos", "commit-ledger.jsonl"), "utf8")).toContain("save edited makefile");
  });

  test("agent plan records raw output when PlanDraft schema is invalid", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });
    const badPlan = JSON.stringify({
      task: { title: "inspect boot" },
      related_specs: [],
      suspected_files: [],
      required_validations: [],
      notes: [],
    });

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "agent",
      "plan",
      "--stage",
      "boot",
    ], {
      print: false,
      agentRunner: async () => ({
        content: "ignored",
        events: acceptedSubmitEvents("plan_draft.v1", JSON.parse(badPlan)),
      }),
    });

    expect(result.status).toBe("agent_output_error");
    expect(result.message).toContain("PlanDraft.task must be string");
    expect(readFileSync(join(projectRoot, ".vos", "runs", result.run_id, "artifacts", "agent", "agent-plan-raw.txt"), "utf8")).toBe(`${JSON.stringify(JSON.parse(badPlan), null, 2)}\n`);
  });

  test("build generate records raw output when files are not objects", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });
    const badDraft = JSON.stringify({
      files: ["Makefile"],
      manifest: {
        manifest_version: 2,
        files: ["Makefile"],
        environment: { required_tools: [{ name: "true", command: "true", version_args: ["--version"], version_constraint: ">=0", kind: "utility" }] },
        build: { variants: [{ id: "baseline", commands: ["make all"], artifacts: [] }] },
        run: { profiles: [{ id: "default", command: "printf", args: ["ok"], artifacts: [] }], cases: [{ id: "smoke", profile: "default", success_regex: "ok" }] },
        test: { suites: [] },
      },
      build_instructions: "bad files",
      spec_refs: ["spec/toolchain/build.yaml"],
      changed_targets: ["Makefile"],
    });

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "generate",
    ], {
      print: false,
      agentRunner: async () => ({
        content: "ignored",
        events: acceptedSubmitEvents("toolchain_generation_draft.v1", JSON.parse(badDraft)),
      }),
    });

    expect(result.status).toBe("agent_output_error");
    expect(result.message).toContain("toolchain draft file must be an object");
    expect(readFileSync(join(projectRoot, ".vos", "runs", result.run_id, "artifacts", "toolchain", "build-generate-raw.txt"), "utf8")).toBe(`${JSON.stringify(JSON.parse(badDraft), null, 2)}\n`);
  });

  test("build generate rejects drafts missing manifest required tools", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });
    const agentRunner = async () => {
      const submitted = {
        files: [{ path: "Makefile", content: "all:\n\ttrue\n" }],
        manifest: {
          manifest_version: 2,
          generator: { name: "vos-agent", version: "toolchain-draft-v1" },
          files: ["Makefile"],
          build: { variants: [{ id: "baseline", commands: ["make all"], artifacts: [] }] },
          run: { profiles: [{ id: "default", command: "printf", args: ["ok"], artifacts: [] }], cases: [{ id: "smoke", profile: "default", success_regex: "ok" }] },
          test: { suites: [] },
        },
        build_instructions: "missing tools",
        spec_refs: ["spec/toolchain/build.yaml"],
        changed_targets: ["Makefile"],
      };
      return {
        content: "ignored",
        events: acceptedSubmitEvents("toolchain_generation_draft.v1", submitted),
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
    ], { print: false, agentRunner });

    expect(result.status).toBe("agent_output_error");
    expect(result.message).toContain("toolchain environment.required_tools is required");
    expect(existsSync(join(projectRoot, "Makefile"))).toBe(true);
    expect(existsSync(join(projectRoot, ".vos", "toolchain.json"))).toBe(false);
  });

  test("build generate rejects drafts that write outside allowed_output_path", async () => {
    const projectRoot = makeGitProject({ manifest: false });
    await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });
    const agentRunner = async () => {
      const submitted = {
        files: [{ path: "scripts/build.sh", content: "echo bad\n" }],
        manifest: {
          manifest_version: 2,
          generator: { name: "vos-agent", version: "toolchain-draft-v1" },
          files: ["scripts/build.sh"],
          environment: { required_tools: [{ name: "true", command: "true", version_args: ["--version"], version_constraint: ">=0", kind: "utility" }] },
          build: { variants: [{ id: "baseline", commands: ["sh scripts/build.sh"], artifacts: [] }] },
          run: { profiles: [{ id: "default", command: "printf", args: ["ok"], artifacts: [] }], cases: [{ id: "smoke", profile: "default", success_regex: "ok" }] },
          test: { suites: [] },
        },
        build_instructions: "bad",
        spec_refs: ["spec/toolchain/build.yaml"],
        changed_targets: ["scripts/build.sh"],
      };
      return {
        content: "ignored",
        events: acceptedSubmitEvents("toolchain_generation_draft.v1", submitted),
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
    ], { print: false, agentRunner });

    expect(result.status).toBe("policy_blocked");
    expect(existsSync(join(projectRoot, "scripts", "build.sh"))).toBe(false);
  });
});

function acceptedSubmitEvents(schemaId: string, result: unknown): Array<Record<string, unknown>> {
  return [
    {
      type: "tool.call",
      name: "mcp__vos-progress__submit_result",
      id: "call_submit",
      arguments: JSON.stringify({ schema_id: schemaId, result }),
    },
    {
      type: "tool.result",
      name: "mcp__vos-progress__submit_result",
      id: "call_submit",
      content: JSON.stringify({
        type: "vos-result-submission",
        schema_id: schemaId,
        accepted: true,
      }),
    },
  ];
}

function makeGitProject(options: { manifest: boolean; policy?: boolean }): string {
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
  if (options.policy !== false) {
    writeFileSync(join(root, ".vos", "policy.yaml"), [
      "allowed_commands:",
      "  - build",
      "  - build generate",
      "  - agent plan",
      "  - ledger record",
      "allowed_paths:",
      "  - .vos",
      "  - spec",
      "  - Makefile",
      "visibility_scope: public",
      "",
    ].join("\n"));
  }
  writeFileSync(join(root, "spec", "toolchain", "toolchain.yaml"), "includes:\n  - build.yaml\n  - run.yaml\n");
  writeFileSync(join(root, "spec", "toolchain", "profile.yaml"), [
    "environment:",
    "  required_tools:",
    "    - true: \">=0\"",
    "  allowed_versions:",
    "    - true >= 0",
    "",
  ].join("\n"));
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
      environment: { required_tools: [{ name: "true", command: "true", version_args: ["--version"], version_constraint: ">=0", kind: "utility" }] },
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
