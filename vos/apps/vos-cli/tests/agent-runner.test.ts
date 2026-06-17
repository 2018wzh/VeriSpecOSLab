import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAgentEnv,
  runAgentWithPrompt,
} from "../app/agent/runner.ts";
import { buildContextBundle, loadAgentAllowedPaths } from "../app/agent/context.ts";
import { executeCommand } from "../app/main.ts";
import { EvidenceWriter } from "../app/evidence/index.ts";
import type { HeadlessAgentOptions } from "vos-agent/headless";
import type { AgentTaskRequest } from "vos-agent/headless";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("vos-cli package agent runner", () => {
  test("calls vos-agent headless package API through injectable runner", async () => {
    const projectRoot = makeProject();
    let captured: HeadlessAgentOptions | undefined;
    const runner = async (options: HeadlessAgentOptions) => {
      captured = options;
      return {
        content: "{\"task\":\"demo\",\"related_specs\":[],\"suspected_files\":[],\"required_validations\":[],\"notes\":[]}",
        events: [],
      };
    };

    const result = await runAgentWithPrompt({
      projectRoot,
      taskPrompt: "hello from vos-cli",
      courseMode: true,
      allowedVosCommands: ["build"],
      runner,
    });

    expect(result.exitCode).toBe(0);
    expect(result.resultText).toContain("\"task\"");
    expect(captured?.projectRoot).toBe(projectRoot);
    expect(captured?.prompt).toBe("hello from vos-cli");
    expect(captured?.courseMode).toBe(true);
    expect(captured?.allowedVosCommands).toEqual(["build"]);
    expect(Object.keys(captured ?? {})).not.toContain("binary");
  });

  test("uses profile-based task runner when no legacy runner is injected", async () => {
    const projectRoot = makeProject();
    let captured: AgentTaskRequest | undefined;
    const taskRunner = async (options: AgentTaskRequest) => {
      captured = options;
      return {
        content: "{\"ok\":true}",
        structuredOutput: { ok: true },
        events: [],
      };
    };

    const result = await runAgentWithPrompt({
      projectRoot,
      taskPrompt: "debug this log",
      taskKind: "debug",
      courseMode: true,
      allowedVosCommands: ["build"],
      taskRunner,
    });

    expect(result.exitCode).toBe(0);
    expect(result.parsedResult).toEqual({ ok: true });
    expect(captured?.task).toBe("debug this log");
    expect(captured?.promptOverride).toBe("debug this log");
    expect(Object.keys(captured ?? {})).not.toContain("roleId");
    expect(captured?.taskKind).toBe("debug");
    expect(captured?.courseMode).toBe(true);
    expect(captured?.allowedVosCommands).toEqual(["build"]);
  });

  test("executes agent plan through command-level fake package runner", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "spec"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: runner-test",
      "spec_root: spec",
      "current_stage: syscall",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, "spec", "syscall.yaml"), "stage: syscall\n");
    writeFileSync(join(projectRoot, ".vos", "policy.yaml"), [
      "allowed_paths:",
      "  - spec",
      "allowed_commands:",
      "  - build --dry-run",
      "  - agent serve",
      "",
    ].join("\n"));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "plan"],
      args: ["agent", "plan"],
    });
    let captured: HeadlessAgentOptions | undefined;
    const runner = async (options: HeadlessAgentOptions) => {
      captured = options;
      return {
        content: JSON.stringify({
          task: "inspect syscall",
          related_specs: [],
          suspected_files: [],
          required_validations: [],
          notes: ["offline fake runner"],
        }),
        events: [],
      };
    };

    const result = await executeCommand({
      kind: "agent_plan",
      task: "inspect syscall",
      scope: undefined,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
    });

    expect(result.status).toBe("passed");
    expect(captured?.courseMode).toBe(true);
    expect(captured?.allowedVosCommands).toEqual(["build --dry-run"]);
    expect(captured && "binary" in captured).toBe(false);
    expect(captured?.prompt).not.toContain(["agent", "role"].join("_"));
  });

  test("maps xv6 DeepSeek config to OpenAI-compatible agent env", () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, ".vos", "config.toml"), [
      "spec_root = \"spec\"",
      "",
      "[agent]",
      "provider = \"deepseek\"",
      "model = \"deepseek-v4-pro\"",
      "base_url = \"https://api.deepseek.com/v1\"",
      "",
      "[agent.auth]",
      "env = \"DEEPSEEK_API_KEY\"",
      "",
    ].join("\n"));

    const result = buildAgentEnv({
      projectRoot,
      env: {
        DEEPSEEK_API_KEY: "test-key",
      } as NodeJS.ProcessEnv,
    });

    expect(result.model).toBe("deepseek-v4-pro");
    expect(result.env.OPENAI_API_KEY).toBe("test-key");
    expect(result.env.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(result.env.SMART_MODEL).toBe("deepseek-v4-pro");
  });

  test("maps examples/xv6-spec DeepSeek config to OpenAI-compatible agent env", () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, ".vos", "config.toml"), [
      "spec_root = \"spec\"",
      "",
      "[agent]",
      "provider = \"deepseek\"",
      "model = \"deepseek-v4-pro\"",
      "base_url = \"https://api.deepseek.com/v1\"",
      "timeout_secs = 600",
      "[agent.auth]",
      "env = \"DEEPSEEK_API_KEY\"",
      "",
    ].join("\n"));

    const result = buildAgentEnv({
      projectRoot,
      env: {
        DEEPSEEK_API_KEY: "xv6-key",
      } as NodeJS.ProcessEnv,
    });

    expect(result.model).toBe("deepseek-v4-pro");
    expect(result.env.OPENAI_API_KEY).toBe("xv6-key");
    expect(result.env.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(result.env.SMART_MODEL).toBe("deepseek-v4-pro");
  });

  test("parses TOML config with section tables and inline comments", () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, ".vos", "config.toml"), [
      "# inline comments are supported",
      "spec_root = \"spec\" # keep compatibility with legacy projects",
      "",
      "[agent]",
      "provider = 'deepseek'",
      "model = \"deepseek-chat-2025\"",
      "base_url = 'https://api.deepseek.com/v1'",
      "",
      "[agent.auth]",
      "env = \"DEEPSEEK_API_KEY\"",
      "",
    ].join("\n"));

    const result = buildAgentEnv({
      projectRoot,
      env: {
        DEEPSEEK_API_KEY: "test-key",
      } as NodeJS.ProcessEnv,
    });

    expect(result.model).toBe("deepseek-chat-2025");
    expect(result.env.OPENAI_API_KEY).toBe("test-key");
    expect(result.env.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
  });

  test("prefixes Anthropic config model for routed package agent env", () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, ".vos", "config.toml"), [
      "[agent]",
      "provider = \"anthropic\"",
      "model = \"claude-sonnet-4-5\"",
      "base_url = \"https://api.anthropic.example\"",
      "",
      "[agent.auth]",
      "env = \"COURSE_ANTHROPIC_KEY\"",
      "",
    ].join("\n"));

    const result = buildAgentEnv({
      projectRoot,
      env: {
        COURSE_ANTHROPIC_KEY: "test-key",
        OPENAI_API_KEY: "also-present",
      } as NodeJS.ProcessEnv,
    });

    expect(result.model).toBe("anthropic:claude-sonnet-4-5");
    expect(result.env.ANTHROPIC_API_KEY).toBe("test-key");
    expect(result.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.example");
    expect(result.env.SMART_MODEL).toBe("anthropic:claude-sonnet-4-5");
  });

  test("extends policy paths with spec-bound editable files from normalized cache", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, ".vos", "cache", "normalized"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "policy.yaml"), [
      "allowed_paths:",
      "  - spec",
      "  - .vos",
      "  - Makefile",
      "visibility_scope: public",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "cache", "normalized", "bundle.json"), JSON.stringify({
      operations: [{
        llm_codegen: {
          editable_region: {
            file: "kernel/boot.c",
          },
        },
      }, {
        llm_codegen: {
          editable_region: {
            file: "include/types.h",
          },
        },
      }],
    }));

    const allowedPaths = await loadAgentAllowedPaths(projectRoot);

    expect(allowedPaths).toContain("spec");
    expect(allowedPaths).toContain("Makefile");
    expect(allowedPaths).toContain("kernel/boot.c");
    expect(allowedPaths).toContain("include/types.h");
  });

  test("context bundle reports spec-bound allowlist sources", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, ".vos", "cache", "normalized"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: local-project",
      "spec_root: spec",
      "current_stage: syscall",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "policy.yaml"), [
      "allowed_paths:",
      "  - spec",
      "  - .vos",
      "visibility_scope: public",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "cache", "normalized", "bundle.json"), JSON.stringify({
      operations: [{
        llm_codegen: {
          editable_region: {
            file: "kernel/syscall.c",
          },
        },
      }],
    }));

    const bundle = await buildContextBundle({
      projectRoot,
      requestedScope: "agent.generate",
    });

    expect(bundle.allowed_paths).toContain("kernel/syscall.c");
    expect(bundle.allowed_path_sources).toEqual({
      policy_paths: 2,
      spec_bound_paths: 1,
      effective_paths: 3,
    });
    expect(bundle.policy_flags).toContain("spec_bound_allowed_paths:1");
    expect(bundle.policy_flags).toContain("effective_allowed_paths:3");
  });

  test("policy directory prefixes cover spec-bound child files", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, ".vos", "cache", "normalized"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: local-project",
      "spec_root: spec",
      "current_stage: syscall",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "policy.yaml"), [
      "allowed_paths:",
      "  - spec",
      "  - .vos",
      "  - kernel",
      "visibility_scope: public",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "cache", "normalized", "bundle.json"), JSON.stringify({
      operations: [{
        llm_codegen: {
          editable_region: {
            file: "kernel/syscall.c",
          },
        },
      }],
    }));

    const bundle = await buildContextBundle({
      projectRoot,
      requestedScope: "agent.generate",
    });

    expect(bundle.allowed_paths).toEqual(["spec", ".vos", "kernel"]);
    expect(bundle.allowed_path_sources).toEqual({
      policy_paths: 3,
      spec_bound_paths: 0,
      effective_paths: 3,
    });
  });

  test("agent subcommands keep package runner in course mode without binary options", () => {
    const source = readFileSync(new URL("../app/main.ts", import.meta.url), "utf8");
    expect(source.match(/courseMode: true/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source.match(/allowedVosCommands: await loadAgentAllowedCommands/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("isAllowedModelVosCommand");
    expect(source).toContain("!normalized.startsWith(\"agent \")");
    expect(source).toContain("applyValidationSummary");
    expect(source).toContain("buildRequested");
    expect(source).toContain("runRequested");
    expect(source).not.toContain("VOS_AGENT_BINARY");
    expect(source).not.toContain("binary:");
  });

  test("agent generate defaults to current stage and writes apply artifact for every apply", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, ".vos", "cache", "normalized"), { recursive: true });
    mkdirSync(join(projectRoot, "spec", "stages"), { recursive: true });
    mkdirSync(join(projectRoot, "spec", "toolchain"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: runner-generate-test",
      "spec_root: spec",
      "current_stage: syscall",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, "spec", "stages", "syscall.yaml"), "stage: syscall\n");
    writeFileSync(join(projectRoot, ".vos", "policy.yaml"), [
      "allowed_paths:",
      "  - spec",
      "  - .vos",
      "  - Makefile",
      "allowed_commands:",
      "  - build",
      "  - run qemu",
      "  - verify public",
      "visibility_scope: public",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, "Makefile"), "all:\n\ttrue\n");
    writeFileSync(join(projectRoot, "spec", "toolchain", "toolchain.yaml"), "includes:\n  - build.yaml\n  - run.yaml\n");
    writeFileSync(join(projectRoot, "spec", "toolchain", "build.yaml"), "build:\n  allowed_output_path:\n    - Makefile\n");
    writeFileSync(join(projectRoot, "spec", "toolchain", "run.yaml"), [
      "run:",
      "  emulator: qemu-system-riscv64",
      "  machine: virt",
      "  kernel_arg: -kernel",
      "  success_signal: XV6_BOOT_OK",
      "  timeout_secs: 1",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "toolchain.json"), JSON.stringify({
      files: ["Makefile"],
      build: {
        commands: ["make all"],
        artifacts: ["build/kernel.bin"],
      },
      run: {
        command: "sh",
        args: ["-c", "echo XV6_BOOT_OK", "-kernel", "build/kernel.bin"],
        successSignal: "XV6_BOOT_OK",
        artifact: "build/kernel.bin",
        timeout_ms: 1000,
      },
    }, null, 2));

    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "generate"],
      args: ["agent", "generate"],
    });

      const runner = async () => ({
      content: JSON.stringify({
        task: "apply default stage plan",
        patch: [
          "diff --git a/Makefile b/Makefile",
          "--- a/Makefile",
          "+++ b/Makefile",
          "@@ -1,2 +1,3 @@",
          " all:",
          "\ttrue",
          "+\t@echo syscall",
        ].join("\n"),
        bound_clauses: ["spec/stages/syscall.yaml"],
        changed_paths: ["Makefile"],
        changed_code_files: ["Makefile"],
        output_kind: "unified_diff",
        self_reported_risks: [],
      }),
      events: [],
    });

    const result = await executeCommand({
      kind: "agent_generate",
      target: undefined,
      task: undefined,
      apply: true,
      build: false,
      run: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
    });

    expect(result.status).toBe("passed");
    expect(result.details.applyStatus).toBe("ok");
    expect(result.details.proposal?.task).toBe("apply default stage plan");
    const applyArtifact = join(evidence.run_root, "artifacts", "agent", "agent-generate-apply.json");
    expect(existsSync(applyArtifact)).toBe(true);
    const applyArtifactText = readFileSync(applyArtifact, "utf8");
    expect(applyArtifactText).toContain("\"status\":\"ok\"");
    expect(readFileSync(join(projectRoot, "Makefile"), "utf8")).toContain("@echo syscall");
  });
});

function makeProject(): string {
  const root = join("/tmp", `vos-cli-runner-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, ".vos"), { recursive: true });
  tmpRoots.push(root);
  return root;
}
