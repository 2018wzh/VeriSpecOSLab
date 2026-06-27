import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAgentEnv,
  runAgentInteractiveTask,
  runAgentWithPrompt,
  startAgentReadonlyDisplay,
} from "../src/agent/runner.ts";
import {
  buildAgentBehaviorTestPatchPrompt,
  buildAgentBehaviorTestPlanPrompt,
  buildAgentDebugPrompt,
  buildAgentGeneratePrompt,
  buildAgentPlanPrompt,
  buildToolchainGeneratePrompt,
} from "../src/agent/prompt.ts";
import { buildContextBundle, loadAgentAllowedPaths } from "../src/agent/context.ts";
import { parseDebugOutput } from "../src/agent/schemas.ts";
import { executeCommand } from "../src/main.ts";
import { EvidenceWriter } from "../src/evidence/index.ts";
import type { AgentTaskRequest } from "vos-agent/headless";
import type { InteractiveAgentTaskOptions } from "vos-agent/headless";
import type { ReadonlyAgentDisplayHandle, ReadonlyAgentDisplayOptions } from "vos-agent/headless";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("vos-cli package agent runner", () => {
  test("calls vos-agent task package API through injectable runner", async () => {
    const projectRoot = makeProject();
    let captured: AgentTaskRequest | undefined;
    const runner = async (options: AgentTaskRequest) => {
      captured = options;
      return {
        content: "{\"task\":\"demo\",\"related_specs\":[],\"suspected_files\":[],\"required_validations\":[],\"notes\":[]}",
        structuredOutput: { task: "demo", related_specs: [], suspected_files: [], required_validations: [], notes: [] },
        events: [],
      };
    };

    const result = await runAgentWithPrompt({
      projectRoot,
      taskPrompt: "hello from vos-cli",
      courseMode: true,
      allowedVosCommands: ["build"],
      taskRunner: runner,
    });

    expect(result.exitCode).toBe(0);
    expect(result.parsedResult).toMatchObject({ task: "demo" });
    expect(captured?.projectRoot).toBe(projectRoot);
    expect(captured?.task).toBe("hello from vos-cli");
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
    expect(Object.keys(captured ?? {})).not.toContain("promptOverride");
    expect(Object.keys(captured ?? {})).not.toContain("roleId");
    expect(captured?.taskKind).toBe("debug");
    expect(captured?.courseMode).toBe(true);
    expect(captured?.allowedVosCommands).toEqual(["build"]);
  });

  test("calls vos-agent interactive package API through injectable runner", async () => {
    const projectRoot = makeProject();
    let captured: InteractiveAgentTaskOptions | undefined;
    const runner = async (options: InteractiveAgentTaskOptions) => {
      captured = options;
    };

    await runAgentInteractiveTask({
      projectRoot,
      taskKind: "debug",
      requestedScope: "agent.debug",
      allowedVosCommands: ["build"],
      extraMcpServers: [{ name: "progress", command: "progress-mcp" }],
      runner,
    });

    expect(captured?.projectRoot).toBe(projectRoot);
    expect(captured?.taskKind).toBe("debug");
    expect(captured?.requestedScope).toBe("agent.debug");
    expect(captured?.allowedVosCommands).toEqual(["build"]);
    expect(captured?.extraMcpServers?.map((server) => server.name)).toEqual(["progress"]);
    expect(captured && "binary" in captured).toBe(false);
  });

  test("calls vos-agent readonly display package API through injectable starter", () => {
    const projectRoot = makeProject();
    let captured: ReadonlyAgentDisplayOptions | undefined;
    const handle = makeReadonlyDisplay();

    const result = startAgentReadonlyDisplay({
      projectRoot,
      title: "agent plan -i",
      starter: (options) => {
        captured = options;
        return handle;
      },
    });
    result.progress({ stage: "agent plan", status: "running", message: "waiting" });
    result.close();

    expect(captured?.projectRoot).toBe(projectRoot);
    expect(captured?.title).toBe("agent plan -i");
    expect(handle.progresses).toContainEqual(expect.objectContaining({ stage: "agent plan" }));
    expect(handle.closed).toBe(true);
  });

  test("executes empty agent debug through command-level interactive runner", async () => {
    const projectRoot = makeProject();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "debug"],
      args: ["agent", "debug"],
    });
    let captured: InteractiveAgentTaskOptions | undefined;
    const interactiveAgentRunner = async (options: InteractiveAgentTaskOptions) => {
      captured = options;
    };

    const result = await executeCommand({
      kind: "agent_debug",
      logPath: undefined,
      runId: undefined,
      keepWorktree: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      interactiveAgentRunner,
    });

    expect(result.status).toBe("passed");
    expect(result.details).toMatchObject({ interactive: true, profile: "debug" });
    expect(captured?.taskKind).toBe("debug");
    expect(captured?.initialTask).toBeUndefined();
  });

  test("agent plan readonly display receives progress and agent events", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "spec"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: display-plan-test",
      "spec_root: spec",
      "current_stage: syscall",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, "spec", "syscall.yaml"), "stage: syscall\n");
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "plan", "-i"],
      args: ["agent", "plan", "-i"],
    });
    const display = makeReadonlyDisplay();
    const runner = async (options: AgentTaskRequest) => {
      await options.onEvent?.({
        type: "assistant.message",
        thread_id: "T-display",
        iteration: 1,
        content: "planning",
        toolCalls: [],
      });
      return {
        content: JSON.stringify({
          task: "inspect syscall",
          related_specs: [],
          suspected_files: [],
          required_validations: [],
          notes: ["display fake runner"],
        }),
        structuredOutput: {
          task: "inspect syscall",
          related_specs: [],
          suspected_files: [],
          required_validations: [],
          notes: ["display fake runner"],
        },
        events: [],
      };
    };

    const result = await executeCommand({
      kind: "agent_plan",
      task: "inspect syscall",
      scope: undefined,
      display: true,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
      readonlyDisplay: display,
    });

    expect(result.status).toBe("passed");
    expect(display.progresses.map((item) => item.stage)).toContain("agent plan");
    expect(display.events.map((event) => event.type)).toContain("assistant.message");
  });

  test("agent context readonly display does not call the model", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "spec"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: display-context-test",
      "spec_root: spec",
      "current_stage: memory",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, "spec", "memory.yaml"), "stage: memory\n");
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "context", "-i"],
      args: ["agent", "context", "-i"],
    });
    const display = makeReadonlyDisplay();

    const result = await executeCommand({
      kind: "agent_context",
      scope: undefined,
      display: true,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      readonlyDisplay: display,
      agentRunner: async () => {
        throw new Error("agent context should not call the model");
      },
    });

    expect(result.status).toBe("passed");
    expect(display.progresses.map((item) => item.stage)).toContain("agent context");
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
    let captured: AgentTaskRequest | undefined;
    const runner = async (options: AgentTaskRequest) => {
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
    expect(captured?.task).toBe("inspect syscall");
    expect(captured?.taskKind).toBe("plan");
    expect(Object.keys(captured ?? {})).not.toContain("prompt");
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

  test("agent generate prompt requires verify suites and mappings for build/run", () => {
    const prompt = buildAgentGeneratePrompt({
      bundle: {
        resolved_specs: ["spec/verification/public-matrix.yaml"],
        recent_evidence: [],
        allowed_paths: ["Makefile", ".vos/toolchain.json", "kernel", "user"],
        policy_flags: ["visibility:public"],
        project_tree: ["spec/verification/public-matrix.yaml", "spec/modules/kernel/memory/tests.yaml"],
        readonly_context: [{
          path: "kernel/defs.h",
          content: "typedef uint64 pte_t;\ntypedef uint64 *pagetable_t;\n",
          truncated: false,
        }],
      },
      task: "generate xv6 memory stage",
      buildRequested: true,
      runRequested: true,
    });

    expect(prompt).toContain("VERIFY CONTRACT");
    expect(prompt).toContain("Do not return an empty patch");
    expect(prompt).toContain("readonly_context contains current file contents");
    expect(prompt).toContain("typedef uint64 *pagetable_t");
    expect(prompt).toContain("use Read or Grep to inspect every existing file you will modify");
    expect(prompt).toContain("read at least .vos/toolchain.json, Makefile, kernel/main.c");
    expect(prompt).toContain("keep start.c jumping to main()");
    expect(prompt).toContain("do not replace that path with kernel_main()");
    expect(prompt).toContain("qemu uses -bios none");
    expect(prompt).toContain("do not put SBI ecall console_putchar/shutdown calls on the boot path");
    expect(prompt).toContain("treat it as a read-only runtime contract");
    expect(prompt).toContain("do not create, replace, rewrite, or simplify it");
    expect(prompt).toContain("Follow the existing header layout from project_tree");
    expect(prompt).toContain("manifest_version 2");
    expect(prompt).toContain("object-form test.suites");
    expect(prompt).toContain("verify.full");
    expect(prompt).toContain("verify.invariant");
    expect(prompt).toContain("verify.fuzz");
    expect(prompt).toContain("XV6_BOOT_OK");
    expect(prompt).toContain("staff-visible external mapping");
    expect(prompt).toContain("Read and follow applicable AGENTS.md before planning or patching");
    expect(prompt).toContain("must include a minimal AGENTS.md patch");
  });

  test("agent plan prompt spells out the exact PlanDraft JSON contract", () => {
    const prompt = buildAgentPlanPrompt({
      bundle: {
        resolved_specs: ["spec/architecture/timeline.yaml"],
        recent_evidence: [],
        allowed_paths: ["spec", "kernel"],
        policy_flags: ["visibility:public"],
      },
      requestedScope: "boot",
      task: "plan boot stage",
    });

    expect(prompt).toContain("PLAN OUTPUT CONTRACT");
    expect(prompt).toContain("task: string");
    expect(prompt).toContain("related_specs: string[]");
    expect(prompt).toContain("suspected_files: string[]");
    expect(prompt).toContain("required_validations: string[]");
    expect(prompt).toContain("notes: string[]");
    expect(prompt).toContain("spec_patch_required?: boolean");
    expect(prompt).toContain("\"task\": \"plan boot stage\"");
    expect(prompt).toContain("If the plan introduces durable public project conventions");
    expect(prompt).toContain("include AGENTS.md in suspected_files or notes");
  });

  test("toolchain generate prompt spells out object-form files and manifest v2", () => {
    const prompt = buildToolchainGeneratePrompt({
      toolchainIndex: { includes: ["build.yaml"] },
      buildSpec: { build: { allowed_output_path: ["Makefile"] } },
      environment: { required_tools: [{ name: "make" }] },
      allowedOutputPaths: ["Makefile"],
    });

    expect(prompt).toContain("TOOLCHAIN OUTPUT CONTRACT");
    expect(prompt).toContain("files: Array<{ path: string; content: string }>");
    expect(prompt).toContain("\"files\": [{ \"path\": \"Makefile\", \"content\":");
    expect(prompt).toContain("manifest_version: 2");
    expect(prompt).toContain("environment.required_tools");
    expect(prompt).toContain("build.variants");
    expect(prompt).toContain("run.profiles");
    expect(prompt).toContain("run.cases");
    expect(prompt).toContain("test.suites");
    expect(prompt).toContain("manifest.files must exactly reference paths present in files[].path");
    expect(prompt).toContain("When AGENTS.md is an allowed output path");
    expect(prompt).toContain("Do not exceed allowedOutputPaths just to update AGENTS.md");
  });

  test("agent debug prompt explains verify behavior evidence", () => {
    const prompt = buildAgentDebugPrompt({
      logText: "failed fuzz with artifacts/verify-behavior/fuzz-cases/case-1/result.json",
      logRef: ".vos/runs/run-1/artifacts/verify-behavior/fuzz-cases/case-1/result.json",
    });

    expect(prompt).toContain("DEBUG OUTPUT CONTRACT");
    expect(prompt).toContain("verify-behavior");
    expect(prompt).toContain("Read and respect applicable AGENTS.md");
    expect(prompt).toContain("do not modify AGENTS.md");
    expect(prompt).not.toContain("verify-trace");
  });

  test("behavior test prompts only update AGENTS.md for durable test conventions", () => {
    const planPrompt = buildAgentBehaviorTestPlanPrompt({
      scope: "kernel/memory",
      phase: "generated",
      obligations: ["kalloc_alignment"],
      suites: [],
      projectTree: ["AGENTS.md", "tests/public/verify.sh"],
    });
    const patchPrompt = buildAgentBehaviorTestPatchPrompt({
      scope: "kernel/memory",
      phase: "fuzz",
      testPlan: { cases: [] },
      projectTree: ["AGENTS.md", "tests/public/verify.sh"],
    });

    expect(planPrompt).toContain("If the TestPlan implies a durable test command");
    expect(patchPrompt).toContain("Only update AGENTS.md for durable test entrypoints");
    expect(patchPrompt).toContain("Do not update AGENTS.md for temporary verification cases");
  });

  test("agent debug schema accepts evidence chains and visualization steps", () => {
    const parsed = parseDebugOutput({
      failure_class: "verification_failure",
      summary: "Allocator evidence failed after public verify.",
      suspected_clauses: ["kernel/memory.kalloc"],
      related_specs: ["spec/modules/kernel/memory/ops/kalloc.yaml"],
      suspected_concepts: ["free-list ownership"],
      evidence_chain: [{
        label: "public verify",
        artifact: ".vos/runs/run-1/manifest.json",
        observation: "page allocator case failed",
      }],
      visualization_steps: [{
        phase: "oracle",
        description: "Public oracle observed a repeated page.",
      }],
      trace_summary: "trace observed allocator reuse",
      gdb_summary: "gdb stopped in kalloc",
      visualization_html: "<!doctype html><html><body><script>const states=[];</script><input id=\"scrubber\"></body></html>",
      next_diagnostic_commands: ["vos agent debug --run run-1 --keep-worktree"],
      student_visible_limitations: ["full instrumentation diff withheld"],
    });

    expect(parsed.evidence_chain[0]?.label).toBe("public verify");
    expect(parsed.suspected_concepts).toEqual(["free-list ownership"]);
    expect(parsed.visualization_steps[0]?.phase).toBe("oracle");
    expect(parsed.trace_summary).toBe("trace observed allocator reuse");
    expect(parsed.gdb_summary).toBe("gdb stopped in kalloc");
    expect(parsed.visualization_html).toContain("states=[]");
    expect(parsed.next_diagnostic_commands).toEqual(["vos agent debug --run run-1 --keep-worktree"]);
  });

  test("agent debug run reads failed run evidence and writes debug artifacts", async () => {
    const projectRoot = makeProject();
    const runRoot = join(projectRoot, ".vos", "runs", "failed-run");
    mkdirSync(join(runRoot, "artifacts", "run", "boot-smoke"), { recursive: true });
    writeFileSync(join(runRoot, "artifacts", "run", "boot-smoke", "serial.log"), "panic: allocator reused page\n");
    writeFileSync(join(runRoot, "manifest.json"), JSON.stringify({
      run_id: "failed-run",
      command: ["verify", "public"],
      status: "validation_failed",
      artifacts: [{ kind: "trace", path: ".vos/runs/failed-run/artifacts/run/boot-smoke/serial.log", summary: "qemu serial log" }],
      evidence_refs: [],
    }, null, 2));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "debug", "--run", "failed-run"],
      args: [],
    });
    let captured: AgentTaskRequest | undefined;
    const runner = async (options: AgentTaskRequest) => {
      captured = options;
      return {
        content: JSON.stringify({
          failure_class: "verification_failure",
          summary: "Allocator evidence failed.",
          suspected_clauses: ["kernel/memory.kalloc"],
          related_specs: ["spec/modules/kernel/memory/ops/kalloc.yaml"],
          suspected_concepts: ["free-list ownership"],
          evidence_chain: [{ label: "qemu serial log", artifact: ".vos/runs/failed-run/artifacts/run/boot-smoke/serial.log", observation: "panic" }],
          visualization_steps: [{ phase: "panic", description: "The allocator reused a page." }],
          visualization_html: [
            "<!doctype html>",
            "<html><body>",
            "<main data-agent-generated=\"true\">",
            "<section>Spec / Code from agent</section>",
            "<section>Verify / Trace Timeline from agent</section>",
            "<section>GDB State from agent</section>",
            "<input id=\"scrubber\" type=\"range\">",
            "<script>// states[]\nconst states=[{phase:'panic'}];</script>",
            "</main>",
            "</body></html>",
          ].join(""),
          trace_summary: "trace not observed",
          gdb_summary: "gdb reached kalloc",
          next_diagnostic_commands: ["vos verify public"],
          student_visible_limitations: ["full instrumentation diff withheld"],
        }),
        events: [],
      };
    };

    const result = await executeCommand({
      kind: "agent_debug",
      runId: "failed-run",
      keepWorktree: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
    });

    expect(result.status).toBe("passed");
    expect(JSON.stringify(captured?.context)).toContain("failed-run");
    expect(JSON.stringify(captured?.context)).toContain("panic: allocator reused page");
    expect(captured?.taskKind).toBe("debug");
    expect(Object.keys(captured ?? {})).not.toContain("prompt");
    expect(result.details.artifact).toMatch(/agent-debug\/debug\.json$/);
    expect(result.details.visualization).toMatch(/agent-debug\/visualization\.html$/);
    expect(result.details.gdb_summary).toMatch(/agent-debug\/gdb\/summary\.json$/);
    expect(result.details.adapter_contract).toMatch(/agent-debug\/gdb\/adapter-contract\.json$/);
    const adapter = JSON.parse(readFileSync(join(projectRoot, result.details.adapter_contract as string), "utf8"));
    expect(adapter.qmp_endpoint).toMatch(/^unix:/);
    expect(adapter.hmp_endpoint).toMatch(/^unix:/);
    expect(adapter.qemu_args.join(" ")).toContain("-qmp");
    expect(adapter.qemu_args.join(" ")).toContain("-monitor");
    expect(adapter.monitor_forbidden_commands).toContain("system_reset");
    const visualization = readFileSync(join(projectRoot, result.details.visualization as string), "utf8");
    expect(visualization).toContain("scrubber");
    expect(visualization).toContain("states[]");
    expect(visualization).toContain("data-agent-generated");
    expect(visualization).not.toContain("VOS Debug Visualization");
    const markdown = readFileSync(join(projectRoot, result.details.report as string), "utf8");
    expect(markdown).not.toContain("diff --git");
  });

  test("agent debug run rejects missing agent visualization html", async () => {
    const projectRoot = makeProject();
    const runRoot = join(projectRoot, ".vos", "runs", "failed-run");
    mkdirSync(join(runRoot, "artifacts", "run", "boot-smoke"), { recursive: true });
    writeFileSync(join(runRoot, "artifacts", "run", "boot-smoke", "serial.log"), "panic: allocator reused page\n");
    writeFileSync(join(runRoot, "manifest.json"), JSON.stringify({
      run_id: "failed-run",
      command: ["verify", "public"],
      status: "validation_failed",
      artifacts: [{ kind: "trace", path: ".vos/runs/failed-run/artifacts/run/boot-smoke/serial.log", summary: "qemu serial log" }],
      evidence_refs: [],
    }, null, 2));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "debug", "--run", "failed-run"],
      args: [],
    });

    const badContent = JSON.stringify({
      failure_class: "verification_failure",
      summary: "Allocator evidence failed.",
      suspected_clauses: [],
      related_specs: [],
      evidence_chain: [],
      visualization_steps: [],
      next_diagnostic_commands: [],
      student_visible_limitations: [],
    });
    let schemaError: unknown;
    try {
      await executeCommand({
        kind: "agent_debug",
        runId: "failed-run",
        keepWorktree: false,
      }, {
        projectRoot,
        global: { projectRoot, json: false },
        evidence,
        agentRunner: async () => ({
          content: badContent,
          events: [],
        }),
      });
    } catch (error) {
      schemaError = error;
    }
    expect(schemaError).toBeTruthy();
    expect((schemaError as Error).message).toContain("debug_output.v1");
    const details = (schemaError as { details?: Record<string, unknown> }).details;
    expect(details?.schema).toBe("debug_output.v1");
    expect(String(details?.schema_error)).toContain("visualization_html");
    expect(details?.raw_artifact).toBe("agent-debug/agent-debug-raw.txt");
    expect(readFileSync(join(evidence.run_root, "artifacts", "agent-debug", "agent-debug-raw.txt"), "utf8")).toBe(badContent);
  });

  test("agent debug without inputs starts the interactive debug profile", async () => {
    const projectRoot = makeProject();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "debug"],
      args: [],
    });
    let captured: InteractiveAgentTaskOptions | undefined;

    const result = await executeCommand({
      kind: "agent_debug",
      keepWorktree: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      interactiveAgentRunner: async (options) => {
        captured = options;
      },
    });

    expect(result.status).toBe("passed");
    expect(result.details).toMatchObject({ interactive: true, profile: "debug" });
    expect(captured?.taskKind).toBe("debug");
    expect(captured?.initialTask).toBeUndefined();
  });

  test("agent debug run writes GDB failure evidence when MCP setup fails", async () => {
    const projectRoot = makeProject();
    const runRoot = join(projectRoot, ".vos", "runs", "failed-run");
    mkdirSync(join(runRoot, "artifacts", "run", "boot-smoke"), { recursive: true });
    writeFileSync(join(runRoot, "artifacts", "run", "boot-smoke", "serial.log"), "panic: trap\n");
    writeFileSync(join(runRoot, "manifest.json"), JSON.stringify({
      run_id: "failed-run",
      command: ["verify", "public"],
      status: "validation_failed",
      artifacts: [{ kind: "trace", path: ".vos/runs/failed-run/artifacts/run/boot-smoke/serial.log", summary: "qemu serial log" }],
      evidence_refs: [],
    }, null, 2));
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "debug", "--run", "failed-run"],
      args: [],
    });

    const result = await executeCommand({
      kind: "agent_debug",
      runId: "failed-run",
      keepWorktree: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: async () => {
        throw new Error("failed to start MCP server gdb");
      },
    });

    expect(result.status).toBe("failed");
    expect(result.details.gdb_failure).toMatch(/agent-debug\/gdb\/failure\.json$/);
    expect(readFileSync(join(projectRoot, result.details.gdb_failure as string), "utf8")).toContain("failed to start MCP server gdb");
  });

  test("failed public verify points to agent debug run command", async () => {
    const projectRoot = makeProject();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["verify", "public"],
      args: [],
    });

    const result = await executeCommand({
      kind: "verify",
      scope: "public",
      dryRun: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
    });

    expect(result.status).toBe("validation_failed");
    expect(result.details.debug).toEqual({
      run_id: evidence.run_id,
      command: `vos agent debug --run ${evidence.run_id}`,
    });
  });

  test("behavior test prompts split planning from patch generation", () => {
    const planPrompt = buildAgentBehaviorTestPlanPrompt({
      scope: "fuzz",
      phase: "fuzz",
      obligations: ["kalloc_race"],
      suites: ["grind"],
      projectTree: ["user/grind.c", "kernel/kalloc.c"],
    });
    const patchPrompt = buildAgentBehaviorTestPatchPrompt({
      scope: "fuzz",
      phase: "fuzz",
      testPlan: { cases: [{ id: "race", obligation_id: "kalloc_race" }] },
      projectTree: ["user/grind.c", "kernel/kalloc.c"],
    });

    expect(planPrompt).toContain("TestPlan JSON");
    expect(planPrompt).toContain("generated/fuzz obligations");
    expect(planPrompt).toContain("user-space behavior");
    expect(planPrompt).toContain("stdin");
    expect(planPrompt).toContain("stdout/exit/timeout oracle");
    expect(planPrompt).not.toContain("patch must");
    expect(patchPrompt).toContain("validated TestPlan");
    expect(patchPrompt).toContain("git apply --check");
    expect(patchPrompt).toContain("Do not modify spec/");
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

  test("context bundle extends local effective policy with spec-bound paths", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, ".vos", "cache", "normalized"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: local-project",
      "spec_root: spec",
      "current_stage: boot",
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
        id: "kernel/boot.entry",
        module: "kernel/boot",
        operation: "entry",
        codegen: {
          targets: [{
            path: "kernel/entry.S",
          }],
        },
      }],
    }));
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    writeFileSync(join(projectRoot, "kernel", "entry.S"), ".section .text.entry\n.globl _entry\n_entry:\n");

    const bundle = await buildContextBundle({
      projectRoot,
      requestedScope: "agent.generate",
      effectivePolicy: {
        source: "local",
        allowedCommands: ["agent generate"],
        allowedPaths: ["spec", ".vos"],
        visibilityScope: "public",
      },
    });

    expect(bundle.allowed_paths).toContain("kernel/entry.S");
    expect(bundle.allowed_path_sources).toEqual({
      policy_paths: 2,
      spec_bound_paths: 1,
      effective_paths: 3,
    });
    expect(bundle.readonly_context).toEqual([{
      path: "kernel/entry.S",
      content: ".section .text.entry\n.globl _entry\n_entry:\n",
      truncated: false,
    }]);
  });

  test("context bundle includes root AGENTS.md for live agent guidance", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "spec"), { recursive: true });
    writeFileSync(join(projectRoot, "AGENTS.md"), "project agent rules\n");
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: local-project",
      "spec_root: spec",
      "current_stage: boot",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "policy.yaml"), [
      "allowed_paths:",
      "  - spec",
      "  - .vos",
      "visibility_scope: public",
      "",
    ].join("\n"));

    const bundle = await buildContextBundle({
      projectRoot,
      requestedScope: "agent.context",
    });

    expect(bundle.project_tree).toContain("AGENTS.md");
    expect(bundle.readonly_context).toContainEqual({
      path: "AGENTS.md",
      content: "project agent rules\n",
      truncated: false,
    });
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

  test("extends policy paths with codegen target paths from spec yaml", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "spec", "modules", "kernel", "boot", "ops"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "policy.yaml"), [
      "allowed_paths:",
      "  - spec",
      "  - .vos",
      "visibility_scope: public",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: codegen-path-test",
      "spec_root: spec",
      "current_stage: boot",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, "spec", "modules", "kernel", "boot", "ops", "boot_banner.yaml"), [
      "id: kernel/boot.boot_banner",
      "codegen:",
      "  targets:",
      "    - kind: symbol",
      "      path: kernel/boot.c",
      "      symbols: [main]",
      "    - kind: header",
      "      path: include/defs.h",
      "",
    ].join("\n"));

    const allowedPaths = await loadAgentAllowedPaths(projectRoot);

    expect(allowedPaths).toContain("kernel/boot.c");
    expect(allowedPaths).toContain("include/defs.h");
  });

  test("agent subcommands keep package runner in course mode without binary options", () => {
    const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
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
      manifest_version: 2,
      files: ["Makefile"],
      environment: { required_tools: [{ name: "true", command: "true", version_args: ["--version"], version_constraint: ">=0", kind: "utility" }] },
      build: { variants: [{ id: "baseline", commands: ["make all"], artifacts: ["build/kernel.bin"] }] },
      run: {
        profiles: [{ id: "default", command: "sh", args: ["-c", "echo XV6_BOOT_OK", "-kernel", "build/kernel.bin"], artifacts: ["build/kernel.bin"], timeout_ms: 1000 }],
        cases: [{ id: "smoke", profile: "default", success_regex: "XV6_BOOT_OK", timeout_ms: 1000 }],
      },
      test: { suites: [] },
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
      display: true,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
      readonlyDisplay: makeReadonlyDisplay(),
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

  test("agent generate apply uses resolved spec-bound local paths", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, ".vos", "cache", "normalized"), { recursive: true });
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: runner-test",
      "spec_root: spec",
      "current_stage: boot",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "policy.yaml"), [
      "allowed_paths:",
      "  - spec",
      "  - .vos",
      "allowed_commands:",
      "  - agent generate",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "cache", "normalized", "bundle.json"), JSON.stringify({
      operations: [{
        id: "kernel/boot.entry",
        module: "kernel/boot",
        operation: "entry",
        codegen: {
          targets: [{
            path: "kernel/entry.S",
          }],
        },
      }],
    }));
    writeFileSync(join(projectRoot, "kernel", "entry.S"), [
      ".globl entry",
      "entry:",
      "  ret",
      "",
    ].join("\n"));

    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "generate"],
      args: ["agent", "generate"],
    });
    let captured: AgentTaskRequest | undefined;
    const runner = async (options: AgentTaskRequest) => {
      captured = options;
      return {
      content: JSON.stringify({
        task: "patch entry",
        patch: [
          "diff --git a/kernel/entry.S b/kernel/entry.S",
          "--- a/kernel/entry.S",
          "+++ b/kernel/entry.S",
          "@@ -1,3 +1,4 @@",
          " .globl entry",
          " entry:",
          "+  nop",
          "   ret",
        ].join("\n"),
        bound_clauses: ["kernel/boot.entry"],
        changed_paths: ["kernel/entry.S"],
        changed_code_files: ["kernel/entry.S"],
        output_kind: "unified_diff",
        self_reported_risks: [],
      }),
      events: [],
      };
    };

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
      effectivePolicy: {
        source: "local",
        allowedCommands: ["agent generate"],
        allowedPaths: ["spec", ".vos"],
        visibilityScope: "public",
      },
    });

    expect(result.status).toBe("passed");
    expect(result.details.applyStatus).toBe("ok");
    expect(captured?.allowedPaths).toContain("kernel/entry.S");
    expect(readFileSync(join(projectRoot, "kernel", "entry.S"), "utf8")).toContain("nop");
  });

  test("agent ask injects vos-kb MCP and validates knowledgebase answers", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "spec"), { recursive: true });
    writeFileSync(join(projectRoot, "manual.md"), "allocator ownership invariant\n");
    const embeddingServer = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.json() as { input: string[] };
        return Response.json({
          data: body.input.map((text) => ({
            embedding: [
              text.toLowerCase().includes("allocator") ? 1 : 0,
              text.toLowerCase().includes("ownership") ? 1 : 0,
              0,
            ],
          })),
        });
      },
    });
    writeFileSync(join(projectRoot, ".vos", "config.toml"), [
      "[kb.embedding]",
      "provider = \"openai-compatible\"",
      "model = \"fake\"",
      `base_url = "http://127.0.0.1:${embeddingServer.port}"`,
      "",
      "[kb.embedding.auth]",
      "env = \"EMBEDDING_API_KEY\"",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".env"), "EMBEDDING_API_KEY=test-key\n");
    writeFileSync(join(projectRoot, ".vos", "project.yaml"), [
      "project_id: runner-test",
      "spec_root: spec",
      "current_stage: memory",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".vos", "policy.yaml"), [
      "allowed_paths:",
      "  - spec",
      "  - .vos",
      "  - manual.md",
      "allowed_commands:",
      "  - agent ask",
      "",
    ].join("\n"));
    const addEvidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["kb", "add"],
      args: ["kb", "add"],
    });
    await executeCommand({
      kind: "kb_add",
      source: "manual.md",
      sourceKind: "course",
      stage: "memory",
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence: addEvidence,
    });

    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "ask"],
      args: ["agent", "ask"],
    });
    let captured: AgentTaskRequest | undefined;
    const runner = async (options: AgentTaskRequest) => {
      captured = options;
      return {
        content: JSON.stringify({
          answer: "Keep page ownership explicit.",
          stage_key: "memory",
          design_goal_alignment: ["allocator invariant"],
          citations: [{ source_id: "kb-any", title: "Memory Manual" }],
          suggested_next_steps: ["run vos verify public --stage memory"],
          allowed_snippets: [],
        }),
        events: [],
      };
    };

    const result = await executeCommand({
      kind: "agent_ask",
      question: "How should I design allocator ownership?",
      scope: "memory",
      interactive: false,
    }, {
      projectRoot,
      global: { projectRoot, json: false },
      evidence,
      agentRunner: runner,
    });

    expect(result.status).toBe("passed");
    expect(captured?.extraMcpServers?.map((server) => server.name)).toContain("vos-kb");
    expect(result.details.answer).toMatchObject({ answer: "Keep page ownership explicit." });

    const badEvidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["agent", "ask"],
      args: ["agent", "ask"],
    });
    const badContent = JSON.stringify({ answer: "missing arrays" });
    const badRunner = async () => ({ content: badContent, events: [] });
    let schemaError: unknown;
    try {
      await executeCommand({
      kind: "agent_ask",
      question: "bad schema?",
      scope: "memory",
      interactive: false,
      }, {
        projectRoot,
        global: { projectRoot, json: false },
        evidence: badEvidence,
        agentRunner: badRunner,
      });
    } catch (error) {
      schemaError = error;
    }
    expect(schemaError).toBeTruthy();
    expect((schemaError as Error).message).toContain("knowledgebase_answer.v1");
    const details = (schemaError as { details?: Record<string, unknown> }).details;
    expect(details?.schema).toBe("knowledgebase_answer.v1");
    expect(String(details?.schema_error)).toContain("design_goal_alignment");
    expect(details?.raw_artifact).toBe("agent/agent-ask-raw.txt");
    expect(readFileSync(join(badEvidence.run_root, "artifacts", "agent", "agent-ask-raw.txt"), "utf8")).toBe(badContent);
    await embeddingServer.stop(true);
  });
});

function makeProject(): string {
  const root = join("/tmp", `vos-cli-runner-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, ".vos"), { recursive: true });
  tmpRoots.push(root);
  return root;
}

function makeReadonlyDisplay(): ReadonlyAgentDisplayHandle & {
  commands: string[];
  errors: string[];
  progresses: Array<{ stage: string; status?: string; message?: string }>;
  events: Array<{ type: string }>;
  closed: boolean;
} {
  return {
    commands: [],
    errors: [],
    progresses: [],
    events: [],
    closed: false,
    command(message: string): void {
      this.commands.push(message);
    },
    error(message: string): void {
      this.errors.push(message);
    },
    progress(update: { stage: string; status?: string; message?: string }): void {
      this.progresses.push(update);
    },
    onSessionEvent(event: { type: string }): void {
      this.events.push(event);
    },
    close(): void {
      this.closed = true;
    },
  };
}
