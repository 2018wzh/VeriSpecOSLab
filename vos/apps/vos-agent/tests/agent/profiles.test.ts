import { describe, expect, test } from "bun:test";
import {
  buildAgentTaskSystemPrompt,
  createProfileToolPolicy,
  publicAgentTaskProfile,
  resolveAgentTaskProfile,
} from "../../app/agent/profiles.ts";
import { resolveBuiltInSkills } from "../../app/skills/index.ts";
import type { Tool } from "../../app/tools/types.ts";

function tool(name: string): Tool {
  return {
    name,
    schema: {
      type: "function",
      function: {
        name,
        description: "",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    execute: () => "",
  };
}

describe("agent task profiles", () => {
  const cliTaskKinds = [
    "plan",
    "design_review",
    "spec_revision",
    "codegen",
    "skeleton_generation",
    "validate",
    "review_patch",
    "debug",
    "debug_trace",
    "failure_triage",
    "knowledgebase_qa",
    "explain_concept",
    "toolchain_generate",
    "report_narrative",
    "spec_review",
    "arch_review",
  ];

  test("routes every VOS CLI agent task kind to an explicit profile", () => {
    const expected: Record<string, string> = {
      plan: "plan_draft.v1",
      design_review: "spec_review.v1",
      spec_revision: "spec_revision_draft.v1",
      codegen: "spec_compiler_output.v1",
      skeleton_generation: "spec_compiler_output.v1",
      validate: "validator_feedback.v1",
      review_patch: "validator_feedback.v1",
      debug: "debug_output.v1",
      debug_trace: "debug_trace_plan.v1",
      failure_triage: "debug_output.v1",
      knowledgebase_qa: "knowledgebase_answer.v1",
      explain_concept: "knowledgebase_answer.v1",
      toolchain_generate: "toolchain_generation_draft.v1",
      report_narrative: "report_narrative.v1",
      spec_review: "spec_review.v1",
      arch_review: "spec_review.v1",
    };

    for (const [taskKind, outputSchema] of Object.entries(expected)) {
      const profile = resolveAgentTaskProfile({ taskKind });
      expect(profile.promptId).not.toBe("gateway-agent.v1");
      expect(profile.outputSchema).toBe(outputSchema);
    }
  });

  test("structured profiles instruct models to return through StructuredOutput", () => {
    const prompt = buildAgentTaskSystemPrompt(resolveAgentTaskProfile({ taskKind: "report_narrative" }));

    expect(prompt).toContain("StructuredOutput");
    expect(prompt).toContain("if validation fails, fix the shape and call it again");
    expect(prompt).toContain("report_narrative.v1");
  });

  test("interactive profile prompts do not require StructuredOutput", () => {
    const prompt = buildAgentTaskSystemPrompt(
      resolveAgentTaskProfile({ taskKind: "knowledgebase_qa" }),
      { structuredOutput: false },
    );

    expect(prompt).not.toContain("You MUST call StructuredOutput");
    expect(prompt).toContain("answer conversationally");
  });

  test("routes interactive student Q&A to knowledgebase.v1", () => {
    const profile = resolveAgentTaskProfile({ taskKind: "knowledgebase_qa" });
    const publicProfile = publicAgentTaskProfile(profile);

    expect(publicProfile.promptId).toBe("knowledgebase.v1");
    expect(publicProfile.mcpServers).toContain("vos-kb");
    expect(publicProfile.outputSchema).toBe("knowledgebase_answer.v1");
  });

  test("knowledgebase profile can use readonly files, MCP KB tools, and web references", async () => {
    const policy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "knowledgebase_qa" }));

    expect(await allowed(policy, "Read")).toBe(true);
    expect(await allowed(policy, "Task")).toBe(true);
    expect(await allowed(policy, "WebSearch")).toBe(true);
    expect(await allowed(policy, "mcp__vos-kb__kb_search")).toBe(true);
    expect(await allowed(policy, "mcp__project-context__spec_summary")).toBe(true);
    expect(await allowed(policy, "Write")).toBe(false);
    expect(policy.canAdvertise?.(tool("mcp__vos-kb__kb_lookup")) ?? true).toBe(true);
    expect(policy.canAdvertise?.(tool("mcp__project-context__evidence_summary")) ?? true).toBe(true);
  });

  test("spec and evidence profiles can use readonly project context MCP tools", async () => {
    const planPolicy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "plan" }));
    const validatePolicy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "validate" }));

    expect(await allowed(planPolicy, "mcp__project-context__spec_summary")).toBe(true);
    expect(await allowed(planPolicy, "mcp__project-context__evidence_summary")).toBe(true);
    expect(await allowed(validatePolicy, "mcp__project-context__spec_summary")).toBe(true);
    expect(await allowed(validatePolicy, "mcp__project-context__evidence_summary")).toBe(true);
  });

  test("only debug profile can use GDB MCP tools", async () => {
    const debugPolicy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "debug" }));
    const validatePolicy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "validate" }));

    expect(await allowed(debugPolicy, "mcp__gdb__gdb_command")).toBe(true);
    expect(debugPolicy.canAdvertise?.(tool("mcp__gdb__gdb_backtrace")) ?? true).toBe(true);
    expect(await allowed(validatePolicy, "mcp__gdb__gdb_command")).toBe(false);
  });

  test("debug profile blocks dangerous raw GDB commands", async () => {
    const policy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "debug" }));

    expect(await allowed(policy, "mcp__gdb__gdb_command", { command: "info threads" })).toBe(true);
    expect(await allowed(policy, "mcp__gdb__gdb_command", { command: "bt" })).toBe(true);
    expect(await allowed(policy, "mcp__gdb__gdb_command", { command: "shell rm -rf /tmp/nope" })).toBe(false);
    expect(await allowed(policy, "mcp__gdb__gdb_command", { command: "source /tmp/script.gdb" })).toBe(false);
    expect(await allowed(policy, "mcp__gdb__gdb_command", { command: "python print(1)" })).toBe(false);
  });

  test("only debug profile can use QEMU monitor MCP tools", async () => {
    const debugPolicy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "debug" }));
    const validatePolicy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "validate" }));

    expect(await allowed(debugPolicy, "mcp__qemu-monitor__qmp_query")).toBe(true);
    expect(debugPolicy.canAdvertise?.(tool("mcp__qemu-monitor__hmp_info")) ?? true).toBe(true);
    expect(await allowed(validatePolicy, "mcp__qemu-monitor__qmp_query")).toBe(false);
  });

  test("debug profile includes built-in debug teaching skills", () => {
    const profile = resolveAgentTaskProfile({ taskKind: "debug" });
    const prompt = buildAgentTaskSystemPrompt(profile);

    expect(profile.skills).toContain("gdb-debug");
    expect(profile.skills).toContain("qemu-monitor");
    expect(profile.skills).toContain("bret-victor-tutor");
    expect(prompt).toContain("Interactive GDB Debugging via MCP");
    expect(prompt).toContain("QEMU Monitor Debugging via MCP");
    expect(prompt).toContain("Monitor Preflight");
    expect(prompt).toContain("QMP vs HMP Selection");
    expect(prompt).toContain("Readonly Investigation Sequence");
    expect(prompt).toContain("query-memory-devices");
    expect(prompt).toContain("info mtree");
    expect(prompt).toContain("Correlate With GDB, Trace, And Specs");
    expect(prompt).toContain("Failure Handling");
    expect(prompt).toContain("Bret Victor Tutor");
    expect(prompt).toContain("Remote Adapter Contract");
    expect(prompt).toContain("Phase 1: Setup");
    expect(prompt).toContain("Phase 2: Initial Reconnaissance");
    expect(prompt).toContain("Path C: Memory Corruption");
    expect(prompt).toContain("Topology Classification");
    expect(prompt).toContain("Use gdb_attach Only For Local PIDs");
    expect(prompt).toContain("QEMU-Specific Mismatch");
    expect(prompt).toContain("The golden rule");
    expect(prompt).toContain("Step 1 - Concept Classification");
    expect(prompt).toContain("Step 7 - State Object Schema");
    expect(prompt).toContain("Quality Checklist");
    expect(prompt).toContain("Anti-patterns");
    expect(prompt).toContain("Do NOT use for: QEMU system emulation or kernel debugging");
    expect(prompt).not.toContain(".tmp/skills");
  });

  test("all profile skills resolve to built-in teaching instructions", () => {
    for (const taskKind of cliTaskKinds) {
      const profile = resolveAgentTaskProfile({ taskKind });
      const resolved = resolveBuiltInSkills(profile.skills);

      expect(resolved.unknownSkills).toEqual([]);
    }
  });

  test("specialized profile skills describe toolchain, evidence, and instrumentation boundaries", () => {
    const traceProfile = resolveAgentTaskProfile({ taskKind: "debug_trace" });
    const toolchainPrompt = buildAgentTaskSystemPrompt(resolveAgentTaskProfile({ taskKind: "toolchain_generate" }));
    const reportPrompt = buildAgentTaskSystemPrompt(resolveAgentTaskProfile({ taskKind: "report_narrative" }));
    const tracePrompt = buildAgentTaskSystemPrompt(traceProfile);

    expect(traceProfile.skills).toContain("instrumentation-testing");
    expect(toolchainPrompt).toContain("ToolchainSpec semantic build contract");
    expect(reportPrompt).toContain("Do not change pass/fail facts");
    expect(tracePrompt).toContain("VOS_TRACE");
    expect(tracePrompt).toContain("serial output");
    expect(tracePrompt).toContain("repair");
  });

  test("non-debug teaching skills add boundaries without MCP expansion", () => {
    const resolved = resolveBuiltInSkills([
      "os-spec-authoring",
      "audit-review",
      "operation-codegen",
      "reference-policy",
      "teaching-explanation",
    ]);

    expect(resolved.promptText).toContain("Architecture -> Module -> Operation -> SpecPatch");
    expect(resolved.promptText).toContain("risk flags");
    expect(resolved.promptText).toContain("allowed paths");
    expect(resolved.promptText).toContain("citation");
    expect(resolved.promptText).toContain("design goal");
    expect(resolved.mcpServers).toEqual([]);
    expect(resolved.allowedToolNames).toEqual([]);
  });

  test("profile prompts include task-specific teaching boundaries", () => {
    const codegenPrompt = buildAgentTaskSystemPrompt(resolveAgentTaskProfile({ taskKind: "toolchain_generate" }));
    const kbPrompt = buildAgentTaskSystemPrompt(resolveAgentTaskProfile({ taskKind: "knowledgebase_qa" }));

    expect(codegenPrompt).toContain("ToolchainSpec semantic build contract");
    expect(codegenPrompt).toContain("allowed_output_path");
    expect(codegenPrompt).toContain("deterministic gates");
    expect(kbPrompt).toContain("source refs");
    expect(kbPrompt).toContain("hidden or staff-only material");
  });

  test("built-in skill registry resolves prompts and GDB MCP hints", () => {
    const resolved = resolveBuiltInSkills(["gdb-debug", "qemu-monitor", "bret-victor-tutor", "unknown-skill"]);

    expect(resolved.promptText).toContain("target remote");
    expect(resolved.promptText).toContain("query-status");
    expect(resolved.promptText).toContain("states[]");
    expect(resolved.mcpServers.map((server) => server.name)).toEqual(["gdb", "qemu-monitor"]);
    expect(resolved.allowedToolNames).toContain("mcp__gdb__gdb_command");
    expect(resolved.allowedToolNames).toContain("mcp__qemu-monitor__qmp_query");
    expect(resolved.unknownSkills).toEqual(["unknown-skill"]);
  });
});

async function allowed(
  policy: ReturnType<typeof createProfileToolPolicy>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<boolean> {
  return (await policy.canExecute?.({ name, argumentsJson: JSON.stringify(args) }) ?? { allowed: true }).allowed;
}
