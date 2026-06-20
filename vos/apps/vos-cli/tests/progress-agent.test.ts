import { describe, expect, test } from "bun:test";
import {
  progressUpdateFromAgentEvent,
  PROGRESS_MCP_TOOL_NAME,
} from "../app/progress/agent.ts";

describe("vos-cli agent progress event mapping", () => {
  test("maps passive agent lifecycle events to terminal progress", () => {
    expect(progressUpdateFromAgentEvent({
      type: "assistant.message",
      toolCalls: [{ name: "Read" }, { name: "Grep" }],
    }, "agent generate")).toMatchObject({
      stage: "agent generate",
      message: "agent requested 2 tool calls",
    });

    expect(progressUpdateFromAgentEvent({
      type: "tool.call",
      name: "Read",
    }, "agent generate")).toMatchObject({
      message: "running Read",
    });

    expect(progressUpdateFromAgentEvent({
      type: "tool.result",
      name: "mcp__spec-index__lookup",
    }, "agent generate")).toMatchObject({
      message: "lookup done",
    });
  });

  test("maps explicit progress MCP reports when present", () => {
    expect(progressUpdateFromAgentEvent({
      type: "tool.call",
      name: PROGRESS_MCP_TOOL_NAME,
      arguments: JSON.stringify({
        stage: "agent",
        status: "running",
        message: "reading context",
        percent: 30,
      }),
    }, "agent generate")).toMatchObject({
      stage: "agent",
      status: "running",
      message: "reading context",
      percent: 30,
    });
  });
});
