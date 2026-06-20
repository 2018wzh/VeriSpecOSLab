import { describe, expect, test } from "bun:test";
import {
  createProfileToolPolicy,
  PROGRESS_MCP_TOOL_NAME,
  resolveAgentTaskProfile,
} from "../../app/agent/profiles.ts";
import type { Tool } from "../../app/tools/types.ts";

function fakeTool(name: string): Tool {
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
    execute: () => "ok",
  };
}

describe("agent progress tool policy", () => {
  test("allows only the progress MCP tool in addition to profile tools", async () => {
    const policy = createProfileToolPolicy(resolveAgentTaskProfile({ taskKind: "codegen" }));
    expect(policy.canAdvertise?.(fakeTool(PROGRESS_MCP_TOOL_NAME))).toBe(true);
    expect(policy.canAdvertise?.(fakeTool("mcp__other__tool"))).toBe(false);
    expect(await policy.canExecute?.({
      name: PROGRESS_MCP_TOOL_NAME,
      argumentsJson: "{}",
    })).toEqual({ allowed: true });
    expect(await policy.canExecute?.({
      name: "mcp__other__tool",
      argumentsJson: "{}",
    })).toEqual({
      allowed: false,
      reason: "not allowed by task tool profile readonly-codegen",
    });
  });
});
