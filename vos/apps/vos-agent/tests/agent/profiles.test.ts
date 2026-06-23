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
    expect(await allowed(policy, "WebSearch")).toBe(true);
    expect(await allowed(policy, "mcp__vos-kb__kb_search")).toBe(true);
    expect(await allowed(policy, "Write")).toBe(false);
    expect(policy.canAdvertise?.(tool("mcp__vos-kb__kb_lookup")) ?? true).toBe(true);
  });

  test("only debug profile can use GDB MCP tools", async () => {
    const debugPolicy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "debug" }));
    const validatePolicy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "validate" }));

    expect(await allowed(debugPolicy, "mcp__gdb__gdb_command")).toBe(true);
    expect(debugPolicy.canAdvertise?.(tool("mcp__gdb__gdb_backtrace")) ?? true).toBe(true);
    expect(await allowed(validatePolicy, "mcp__gdb__gdb_command")).toBe(false);
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

async function allowed(policy: ReturnType<typeof createProfileToolPolicy>, name: string): Promise<boolean> {
  return (await policy.canExecute?.({ name, argumentsJson: "{}" }) ?? { allowed: true }).allowed;
}
