import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAgentTask } from "../app/headless.ts";
import type { SessionEvent } from "../app/session/types.ts";
import { ScriptedChatClient, textResponse, toolCallResponse } from "./helpers/stub-chat.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("headless profile tasks", () => {
  test("returns structured output captured by StructuredOutput tool", async () => {
    const projectRoot = makeRoot();
    const chat = new ScriptedChatClient([
      toolCallResponse([{
        name: "StructuredOutput",
        args: {
          summary: "Memory stage evidence is ready.",
          risks: [],
          recommended_next_steps: ["Submit the report."],
          limitations: [],
        },
      }]),
      textResponse("done"),
    ]);

    const result = await runAgentTask({
      projectRoot,
      taskKind: "report_narrative",
      requestedScope: "report.generate",
      task: "Summarize deterministic report evidence.",
      context: { requirements_passed: 1 },
      agentProfile: { mcpServers: [] },
      chat,
      model: "test-model",
    });

    expect(result.structuredOutput).toEqual({
      summary: "Memory stage evidence is ready.",
      risks: [],
      recommended_next_steps: ["Submit the report."],
      limitations: [],
    });
    expect(chat.requests[0].tools.map((tool) => tool.function.name)).toContain("StructuredOutput");
  });

  test("fails structured tasks when StructuredOutput is never accepted", async () => {
    const projectRoot = makeRoot();
    const chat = new ScriptedChatClient([textResponse(JSON.stringify({ summary: "not enough" }))]);

    await expect(runAgentTask({
      projectRoot,
      taskKind: "report_narrative",
      requestedScope: "report.generate",
      task: "Summarize deterministic report evidence.",
      agentProfile: { mcpServers: [] },
      chat,
      model: "test-model",
    })).rejects.toThrow(/StructuredOutput/);
  });

  test("allows headless tasks to skip StructuredOutput when disabled", async () => {
    const projectRoot = makeRoot();
    const chat = new ScriptedChatClient([textResponse("done")]);

    const result = await runAgentTask({
      projectRoot,
      taskKind: "report_narrative",
      requestedScope: "report.generate",
      task: "Summarize deterministic report evidence.",
      agentProfile: { mcpServers: [] },
      chat,
      model: "test-model",
      structuredOutput: false,
    });

    expect(result.content).toBe("done");
    expect(result.structuredOutput).toBeUndefined();
    expect(chat.requests[0].tools.map((tool) => tool.function.name)).not.toContain("StructuredOutput");
  });

  test("injects built-in project context MCP for spec and evidence profile intents", async () => {
    const projectRoot = makeRoot();
    mkdirSync(join(projectRoot, "spec"), { recursive: true });
    writeFileSync(join(projectRoot, "spec", "memory.yaml"), "stage: memory\n");
    const events: SessionEvent[] = [];
    const chat = new ScriptedChatClient([
      toolCallResponse([{
        name: "StructuredOutput",
        args: {
          task: "Plan memory validation.",
          related_specs: ["spec/memory.yaml"],
          suspected_files: [],
          required_validations: ["vos validate"],
          notes: [],
          spec_patch_required: false,
        },
      }]),
      textResponse("done"),
    ]);

    await runAgentTask({
      projectRoot,
      taskKind: "plan",
      requestedScope: "agent.plan",
      task: "Plan memory validation.",
      chat,
      model: "test-model",
      onEvent: (event) => {
        events.push(event);
      },
    });

    const created = events.find((event) => event.type === "thread.created");
    expect(created?.mcpServers).toContain("project-context");
    expect(created?.tools).toContain("mcp__project-context__spec_summary");
    expect(created?.tools).toContain("mcp__project-context__evidence_summary");
    expect(chat.requests[0].tools.map((tool) => tool.function.name)).toContain("mcp__project-context__spec_summary");
  });
});

function makeRoot(): string {
  const root = join("/tmp", `vos-agent-headless-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}
