export interface PlanDraft {
  task: string;
  related_specs: string[];
  suspected_files: string[];
  required_validations: string[];
  notes: string[];
  spec_patch_required?: boolean;
}

export interface PatchProposal {
  task: string;
  patch: string;
  bound_clauses: string[];
  changed_paths: string[];
  changed_code_files: string[];
  output_kind: "unified_diff" | "file_changes";
  self_reported_risks: string[];
}

export interface DebugOutput {
  failure_class: string;
  summary: string;
  suspected_clauses: string[];
  related_specs: string[];
  suggested_next_commands: string[];
  suggested_next_agent_task?: string;
}

export interface AICollaborationLog {
  session_id: string;
  task_kind: string;
  agent_role: string;
  related_specs: string[];
  allowed_paths: string[];
  output_kind: string;
  patch_ref?: string;
  evidence_ref?: string;
  result: "accepted" | "rejected" | "pending" | "failed";
  fixed_prompt_id?: string;
  created_at: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlanDraft(value: unknown): PlanDraft {
  if (!isRecord(value)) throw new Error("agent output is not an object");
  if (typeof value.task !== "string") throw new Error("PlanDraft.task must be string");
  if (!Array.isArray(value.related_specs)) throw new Error("PlanDraft.related_specs must be array");
  if (!Array.isArray(value.suspected_files)) throw new Error("PlanDraft.suspected_files must be array");
  if (!Array.isArray(value.required_validations)) throw new Error("PlanDraft.required_validations must be array");
  if (!Array.isArray(value.notes)) throw new Error("PlanDraft.notes must be array");
  return {
    task: value.task,
    related_specs: value.related_specs.map(String),
    suspected_files: value.suspected_files.map(String),
    required_validations: value.required_validations.map(String),
    notes: value.notes.map(String),
    spec_patch_required: typeof value.spec_patch_required === "boolean" ? value.spec_patch_required : undefined,
  };
}

export function parsePatchProposal(value: unknown): PatchProposal {
  if (!isRecord(value)) throw new Error("agent output is not an object");
  if (typeof value.task !== "string") throw new Error("PatchProposal.task must be string");
  if (typeof value.patch !== "string") throw new Error("PatchProposal.patch must be string");
  if (!Array.isArray(value.bound_clauses)) throw new Error("PatchProposal.bound_clauses must be array");
  if (!Array.isArray(value.changed_paths)) throw new Error("PatchProposal.changed_paths must be array");
  if (!Array.isArray(value.changed_code_files)) throw new Error("PatchProposal.changed_code_files must be array");
  if (value.output_kind !== "unified_diff" && value.output_kind !== "file_changes") {
    throw new Error("PatchProposal.output_kind must be unified_diff or file_changes");
  }
  return {
    task: value.task,
    patch: value.patch,
    bound_clauses: value.bound_clauses.map(String),
    changed_paths: value.changed_paths.map(String),
    changed_code_files: value.changed_code_files.map(String),
    output_kind: value.output_kind,
    self_reported_risks: Array.isArray(value.self_reported_risks)
      ? value.self_reported_risks.map(String)
      : [],
  };
}

export function parseDebugOutput(value: unknown): DebugOutput {
  if (!isRecord(value)) throw new Error("agent output is not an object");
  if (typeof value.failure_class !== "string") throw new Error("DebugOutput.failure_class must be string");
  if (typeof value.summary !== "string") throw new Error("DebugOutput.summary must be string");
  if (!Array.isArray(value.suspected_clauses)) throw new Error("DebugOutput.suspected_clauses must be array");
  if (!Array.isArray(value.related_specs)) throw new Error("DebugOutput.related_specs must be array");
  if (!Array.isArray(value.suggested_next_commands)) throw new Error("DebugOutput.suggested_next_commands must be array");
  return {
    failure_class: value.failure_class,
    summary: value.summary,
    suspected_clauses: value.suspected_clauses.map(String),
    related_specs: value.related_specs.map(String),
    suggested_next_commands: value.suggested_next_commands.map(String),
    suggested_next_agent_task: typeof value.suggested_next_agent_task === "string"
      ? value.suggested_next_agent_task
      : undefined,
  };
}

