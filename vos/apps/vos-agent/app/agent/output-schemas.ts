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
  "doctor_diagnosis.v1": {
    id: "doctor_diagnosis.v1",
    description: "Spec-derived host tool diagnosis backed by executed Bash probe evidence.",
    schema: strictObjectSchema({
      summary: { type: "string" },
      tools: {
        type: "array",
        items: strictObjectSchema({
          program: { type: "string" },
          purpose: { type: "string" },
          required: { type: "boolean" },
          status: { type: "string", enum: ["installed", "missing", "failed"] },
          spec_refs: stringArray,
          probe_ids: stringArray,
          suggestions: stringArray,
        }, ["program", "purpose", "required", "status", "spec_refs", "probe_ids", "suggestions"]),
      },
      limitations: stringArray,
    }, ["summary", "tools", "limitations"]),
  },
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
  "student_verification_review.v1": {
    id: "student_verification_review.v1",
    description: "Read-only review of deterministic student verification and stable Spec ID coverage.",
    schema: strictObjectSchema({
      deterministic_status: { type: "string", enum: ["passed", "validation_failed", "policy_blocked", "failed", "timed_out"] },
      summary: { type: "string" },
      findings: {
        type: "array",
        items: strictObjectSchema({
          severity: { type: "string", enum: ["blocker", "warning", "info"] },
          message: { type: "string" },
          evidence: stringArray,
          spec_ids: stringArray,
          suggested_action: { type: "string" },
        }, ["severity", "message", "evidence", "spec_ids", "suggested_action"]),
      },
      coverage_gaps: {
        type: "array",
        items: strictObjectSchema({
          spec_id: { type: "string" },
          reason: { type: "string" },
          expected_targets: stringArray,
        }, ["spec_id", "reason", "expected_targets"]),
      },
    }, ["deterministic_status", "summary", "findings", "coverage_gaps"]),
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
      citations: {
        type: "array",
        items: strictObjectSchema({
          source_id: { type: "string" },
          title: { type: "string" },
          object_ref: { type: "string" },
          chunk_id: { type: "string" },
        }, ["source_id", "title"]),
      },
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
  "student_implementation_result.v1": {
    id: "student_implementation_result.v1",
    description: "Student implementation validation result returned after worktree checks.",
    schema: objectSchema({
      status: { type: "string", enum: ["passed", "failed", "blocked", "partial"] },
      changed_paths: stringArray,
      validations: stringArray,
      summary: { type: "string" },
      diagnostics: stringArray,
      test_targets: {
        type: "array",
        items: objectSchema({
          id: { type: "string" },
          kind: { type: "string", enum: ["public", "contract", "fuzz", "trace"] },
          program: { type: "string" },
          args: stringArray,
          cwd: { type: "string" },
          env: stringArray,
          timeout: { type: "integer" },
          verifies: stringArray,
          artifacts: stringArray,
          seed: { type: "integer" },
          cases: { type: "integer" },
          reproduction_artifact: { type: "string" },
          workload: { type: "string" },
          oracle: { type: "string" },
        }, ["id", "kind", "program", "args", "cwd", "env", "timeout", "verifies", "artifacts"]),
      },
      hidden_tests: {
        type: "array",
        items: objectSchema({
          id: { type: "string" },
          path: { type: "string" },
          content: { type: "string" },
          program: { type: "string" },
          args: stringArray,
          cwd: { type: "string" },
          env: stringArray,
          timeout: { type: "integer" },
          verifies: stringArray,
          seed: { type: "integer" },
        }, ["id", "path", "content", "program", "args", "cwd", "env", "timeout", "verifies", "seed"]),
      },
    }, ["status", "test_targets", "hidden_tests"]),
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

export function validateOutputSemantics(id: string, value: unknown): string[] {
  if (id !== "student_implementation_result.v1" || !value || typeof value !== "object" || Array.isArray(value)) return [];
  const result = value as Record<string, unknown>;
  if (result.status !== "passed") {
    return ["result.status must be passed; keep working in the same Agent thread and resubmit after the implementation and tests succeed"];
  }
  const targets = Array.isArray(result.test_targets) ? result.test_targets : [];
  const hidden = Array.isArray(result.hidden_tests) ? result.hidden_tests : [];
  const errors: string[] = [];
  for (const kind of ["public", "contract", "fuzz", "trace"]) {
    if (!targets.some((target) => isRecord(target) && target.kind === kind)) {
      errors.push(`result.test_targets must contain a ${kind} target`);
    }
  }
  if (hidden.length === 0) errors.push("result.hidden_tests must contain at least one hidden test");
  const ids = new Set<string>();
  targets.forEach((target, index) => {
    if (!isRecord(target)) return;
    if (typeof target.id === "string") {
      if (ids.has(target.id)) errors.push(`result.test_targets[${index}].id must be unique`);
      ids.add(target.id);
    }
    if (target.kind === "fuzz") {
      if (!Number.isInteger(target.seed) || Number(target.seed) < 0) errors.push(`result.test_targets[${index}].seed must be a nonnegative integer`);
      if (!Number.isInteger(target.cases) || Number(target.cases) <= 0) errors.push(`result.test_targets[${index}].cases must be a positive integer`);
      if (typeof target.reproduction_artifact !== "string" || !target.reproduction_artifact.trim()) errors.push(`result.test_targets[${index}].reproduction_artifact is required`);
    }
    if (target.kind === "trace") {
      if (typeof target.workload !== "string" || !target.workload.trim()) errors.push(`result.test_targets[${index}].workload is required`);
      if (typeof target.oracle !== "string" || !target.oracle.trim()) errors.push(`result.test_targets[${index}].oracle is required`);
      if (!Array.isArray(target.artifacts) || target.artifacts.length === 0) errors.push(`result.test_targets[${index}].artifacts must contain at least one path`);
    }
  });
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function strictObjectSchema(
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonObjectSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}
