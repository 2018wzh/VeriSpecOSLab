import { describe, expect, test } from "bun:test";
import {
  createProfileToolPolicy,
  publicAgentTaskProfile,
  resolveAgentTaskProfile,
} from "../../app/agent/profiles.ts";
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
});

async function allowed(policy: ReturnType<typeof createProfileToolPolicy>, name: string): Promise<boolean> {
  return (await policy.canExecute?.({ name, argumentsJson: "{}" }) ?? { allowed: true }).allowed;
}
