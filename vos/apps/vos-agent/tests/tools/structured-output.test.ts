import { describe, expect, test } from "bun:test";
import { createStructuredOutputTool } from "../../app/tools/structured-output.ts";
import { outputSchemaForId } from "../../app/agent/output-schemas.ts";

describe("StructuredOutput tool", () => {
  test("captures schema-valid structured output", async () => {
    const state: { value?: unknown } = {};
    const tool = createStructuredOutputTool({
      schema: outputSchemaForId("report_narrative.v1"),
      onStructuredOutput: (value) => {
        state.value = value;
      },
    });

    const result = await tool.execute(JSON.stringify({
      summary: "Evidence is ready.",
      risks: [],
      recommended_next_steps: ["Submit the report."],
      limitations: [],
    }));

    expect(result).toContain("accepted");
    expect(state.value).toEqual({
      summary: "Evidence is ready.",
      risks: [],
      recommended_next_steps: ["Submit the report."],
      limitations: [],
    });
  });

  test("returns validation errors without capturing invalid output", async () => {
    const state: { value?: unknown } = {};
    const tool = createStructuredOutputTool({
      schema: outputSchemaForId("knowledgebase_answer.v1"),
      onStructuredOutput: (value) => {
        state.value = value;
      },
    });

    const result = await tool.execute(JSON.stringify({ answer: "missing required arrays" }));

    expect(result).toContain("Error validating StructuredOutput");
    expect(result).toContain("design_goal_alignment");
    expect(state.value).toBeUndefined();
  });
});
