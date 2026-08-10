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

  test("requires canonical knowledge-base citation fields", async () => {
    const state: { value?: unknown } = {};
    const tool = createStructuredOutputTool({
      schema: outputSchemaForId("knowledgebase_answer.v1"),
      onStructuredOutput: (value) => {
        state.value = value;
      },
    });
    const base = {
      answer: "Compare the design trade-offs.",
      design_goal_alignment: [],
      suggested_next_steps: [],
      allowed_snippets: [],
    };

    const invalid = await tool.execute(JSON.stringify({
      ...base,
      citations: [{ ref: "kb-course", role: "background" }],
    }));
    expect(invalid).toContain("citations[0].source_id is required");
    expect(invalid).toContain("citations[0].title is required");
    expect(state.value).toBeUndefined();

    const validCitation = { source_id: "kb-course", title: "Course notes", chunk_id: "chunk-1" };
    const valid = await tool.execute(JSON.stringify({ ...base, citations: [validCitation] }));
    expect(valid).toContain("accepted");
    expect(state.value).toMatchObject({ citations: [validCitation] });
  });
});
