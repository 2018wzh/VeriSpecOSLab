export interface JsonObjectSchema {
  type: "object";
  properties: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export type JsonSchema =
  | JsonObjectSchema
  | { type: "array"; items: JsonSchema }
  | { type: "string"; enum?: string[] }
  | { type: "number" | "integer" | "boolean" }
  | { type: "object"; additionalProperties?: boolean }
  | { type: "any" };

export interface OutputSchemaDefinition {
  id: string;
  description: string;
  schema: JsonObjectSchema;
}

const stringArray = { type: "array", items: { type: "string" } } as const;
const stringObject = { type: "object", additionalProperties: true } as const;
const anyValue = { type: "any" } as const;

const schemas: Record<string, OutputSchemaDefinition> = {
  "gateway_decision.v1": {
    id: "gateway_decision.v1",
    description: "Routing or policy decision for a VOS task.",
    schema: objectSchema({
      decision: { type: "string" },
      rationale: { type: "string" },
    }, ["decision", "rationale"]),
  },
  "plan_draft.v1": {
    id: "plan_draft.v1",
    description: "VOS implementation plan draft.",
    schema: objectSchema({
      task: { type: "string" },
      related_specs: stringArray,
      suspected_files: stringArray,
      required_validations: stringArray,
      notes: stringArray,
      spec_patch_required: { type: "boolean" },
    }, ["task", "related_specs", "suspected_files", "required_validations", "notes"]),
  },
  "spec_revision_draft.v1": {
    id: "spec_revision_draft.v1",
    description: "Spec revision or design review draft.",
    schema: objectSchema({
      summary: { type: "string" },
      findings: { type: "array", items: stringObject },
    }, ["summary", "findings"]),
  },
  "spec_review.v1": {
    id: "spec_review.v1",
    description: "Advisory spec or architecture review.",
    schema: objectSchema({
      findings: {
        type: "array",
        items: objectSchema({
          severity: { type: "string", enum: ["info", "warning", "error", "blocker"] },
          message: { type: "string" },
          related_specs: stringArray,
          suggested_actions: stringArray,
        }, ["severity", "message", "related_specs", "suggested_actions"]),
      },
      summary: { type: "string" },
    }, ["findings", "summary"]),
  },
  "spec_compiler_output.v1": {
    id: "spec_compiler_output.v1",
    description: "Patch proposal grounded in VOS specs.",
    schema: objectSchema({
      task: { type: "string" },
      patch: { type: "string" },
      bound_clauses: stringArray,
      changed_paths: stringArray,
      changed_code_files: stringArray,
      output_kind: { type: "string", enum: ["unified_diff", "file_changes"] },
      self_reported_risks: stringArray,
    }, ["task", "patch", "bound_clauses", "changed_paths", "changed_code_files", "output_kind", "self_reported_risks"]),
  },
  "validator_feedback.v1": {
    id: "validator_feedback.v1",
    description: "Validation feedback for generated code or patches.",
    schema: objectSchema({
      status: { type: "string" },
      summary: { type: "string" },
      findings: { type: "array", items: stringObject },
      required_validations: stringArray,
    }, ["status", "summary", "findings", "required_validations"]),
  },
  "debug_output.v1": {
    id: "debug_output.v1",
    description: "Debug diagnosis and student-visible explanation.",
    schema: objectSchema({
      failure_class: { type: "string" },
      summary: { type: "string" },
      suspected_clauses: stringArray,
      related_specs: stringArray,
      suspected_concepts: stringArray,
      evidence_chain: { type: "array", items: stringObject },
      visualization_steps: { type: "array", items: stringObject },
      visualization_html: { type: "string" },
      trace_summary: { type: "string" },
      gdb_summary: { type: "string" },
      next_diagnostic_commands: stringArray,
      student_visible_limitations: stringArray,
      suggested_next_commands: stringArray,
      suggested_next_agent_task: { type: "string" },
    }, ["failure_class", "summary", "suspected_clauses", "related_specs", "next_diagnostic_commands", "visualization_html"]),
  },
  "debug_trace_plan.v1": {
    id: "debug_trace_plan.v1",
    description: "Runnable instrumentation plan for VOS debug trace validation.",
    schema: objectSchema({
      target: { type: "string" },
      instrumentation_patch: { type: "string" },
      cases: { type: "array", items: stringObject },
      coverage_notes: stringArray,
    }, ["target", "instrumentation_patch", "cases"]),
  },
  "behavior_test_plan.v1": {
    id: "behavior_test_plan.v1",
    description: "Generated or fuzz behavior TestPlan for VOS verification.",
    schema: objectSchema({
      cases: {
        type: "array",
        items: objectSchema({
          id: { type: "string" },
          obligation_id: { type: "string" },
          purpose: { type: "string" },
          carrier: { type: "string" },
          stimulus: anyValue,
          oracle: anyValue,
        }, ["id", "obligation_id"]),
      },
    }, ["cases"]),
  },
  "behavior_test_patch.v1": {
    id: "behavior_test_patch.v1",
    description: "Generated or fuzz behavior test patch for VOS verification.",
    schema: objectSchema({
      patch: { type: "string" },
      suites: {
        type: "array",
        items: objectSchema({
          name: { type: "string" },
          command: anyValue,
        }, ["name", "command"]),
      },
      cases: {
        type: "array",
        items: objectSchema({
          id: { type: "string" },
          obligation_id: { type: "string" },
          suite: { type: "string" },
          stdin: { type: "string" },
          success_regex: { type: "string" },
          failure_regex: { type: "string" },
          timeout_ms: { type: "number" },
        }, ["id", "obligation_id", "suite"]),
      },
    }, ["patch", "suites", "cases"]),
  },
  "knowledgebase_answer.v1": {
    id: "knowledgebase_answer.v1",
    description: "Student-facing knowledge-base answer with citations.",
    schema: objectSchema({
      answer: { type: "string" },
      stage_key: { type: "string" },
      design_goal_alignment: stringArray,
      citations: { type: "array", items: stringObject },
      suggested_next_steps: stringArray,
      allowed_snippets: stringArray,
    }, ["answer", "design_goal_alignment", "citations", "suggested_next_steps", "allowed_snippets"]),
  },
  "toolchain_generation_draft.v1": {
    id: "toolchain_generation_draft.v1",
    description: "Toolchain generation draft owned by VOS runtime gates.",
    schema: objectSchema({
      files: {
        type: "array",
        items: objectSchema({
          path: { type: "string" },
          content: { type: "string" },
        }, ["path", "content"]),
      },
      manifest: stringObject,
      build_instructions: { type: "string" },
      spec_refs: stringArray,
      changed_targets: stringArray,
    }, ["files", "manifest", "build_instructions", "spec_refs", "changed_targets"]),
  },
  "report_narrative.v1": {
    id: "report_narrative.v1",
    description: "Narrative summary for deterministic course reports.",
    schema: objectSchema({
      summary: { type: "string" },
      risks: stringArray,
      recommended_next_steps: stringArray,
      limitations: stringArray,
    }, ["summary", "risks", "recommended_next_steps", "limitations"]),
  },
  "reference_payload.v1": {
    id: "reference_payload.v1",
    description: "Reference lookup payload.",
    schema: objectSchema({
      summary: { type: "string" },
      references: { type: "array", items: stringObject },
    }, ["summary", "references"]),
  },
};

export function outputSchemaForId(id: string): OutputSchemaDefinition {
  const schema = schemas[id];
  if (!schema) {
    throw new Error(`unknown output schema "${id}"`);
  }
  return schema;
}

export function optionalOutputSchemaForId(id: string): OutputSchemaDefinition | undefined {
  return schemas[id];
}

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonObjectSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: true,
  };
}
