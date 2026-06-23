import { describe, expect, test } from "bun:test";
import {
  createTerminalRenderState,
  renderSessionEvent,
} from "../../app/terminal/tui.ts";

describe("terminal TUI renderer", () => {
  test("renders turn metadata without terminal-control coupling", () => {
    const state = createTerminalRenderState();

    const lines = renderSessionEvent({
      type: "thread.created",
      thread_id: "T-session",
      model: "test-model",
      mode: "smart",
      tools: ["Read", "Bash"],
      cwd: "/tmp/project",
    }, state).join("\n");

    expect(lines).toContain("thread: T-session (new)");
    expect(lines).toContain("mode: smart");
    expect(lines).toContain("model: test-model");
    expect(lines).toContain("cwd: /tmp/project");
    expect(lines).toContain("tools: Read, Bash");
  });

  test("tracks active tool calls and summarizes results", () => {
    const state = createTerminalRenderState();

    const call = renderSessionEvent({
      type: "tool.call",
      thread_id: "T-session",
      iteration: 1,
      id: "call-1",
      name: "Bash",
      arguments: JSON.stringify({ command: "printf hi" }),
    }, state).join("\n");

    expect(call).toContain("tool call: Bash");
    expect(call).toContain("active tools: Bash");

    const result = renderSessionEvent({
      type: "tool.result",
      thread_id: "T-session",
      iteration: 1,
      id: "call-1",
      name: "Bash",
      content: "hi\n",
    }, state).join("\n");

    expect(result).toContain("tool done: Bash");
    expect(result).toContain("result: hi");
    expect(result).not.toContain("active tools: Bash");
  });

  test("keeps active tool status when one of multiple calls finishes", () => {
    const state = createTerminalRenderState();

    renderSessionEvent({
      type: "tool.call",
      thread_id: "T-session",
      iteration: 1,
      id: "read-1",
      name: "Read",
      arguments: JSON.stringify({ file_path: "README.md" }),
    }, state);
    const secondCall = renderSessionEvent({
      type: "tool.call",
      thread_id: "T-session",
      iteration: 1,
      id: "bash-1",
      name: "Bash",
      arguments: JSON.stringify({ command: "bun test" }),
    }, state).join("\n");

    expect(secondCall).toContain("active tools: Read, Bash");

    const firstResult = renderSessionEvent({
      type: "tool.result",
      thread_id: "T-session",
      iteration: 1,
      id: "read-1",
      name: "Read",
      content: "# Stars",
    }, state).join("\n");

    expect(firstResult).toContain("tool done: Read");
    expect(firstResult).toContain("active tools: Bash");
  });

  test("renders the final assistant response without a release label", () => {
    const state = createTerminalRenderState();

    const lines = renderSessionEvent({
      type: "done",
      thread_id: "T-session",
      content: "final answer",
    }, state).join("\n");

    expect(lines).not.toContain("assistant:");
    expect(lines).toContain("final answer");
  });

  test("renders model usage summaries", () => {
    const state = createTerminalRenderState();

    const lines = renderSessionEvent({
      type: "model.usage",
      thread_id: "T-session",
      iteration: 1,
      model: "sonnet4.6",
      provider: "anthropic",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      contextWindowTokens: 200000,
      contextWindowUsage: 0.005,
      estimatedCostUsd: 0.006,
    }, state).join("\n");

    expect(lines).toContain("usage: sonnet4.6");
    expect(lines).toContain("1000 in");
    expect(lines).toContain("0.5% of 200000 context");
    expect(lines).toContain("est. $0.006000");
  });

  test("renders assistant labels when debug labels are enabled", () => {
    const state = createTerminalRenderState({ debugLabels: true });

    const lines = renderSessionEvent({
      type: "done",
      thread_id: "T-session",
      content: "final answer",
    }, state).join("\n");

    expect(lines).toContain("assistant:");
    expect(lines).toContain("final answer");
  });
});
