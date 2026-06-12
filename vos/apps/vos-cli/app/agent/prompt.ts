export const FIXED_PROMPT_IDS = {
  specCompanion: "spec-companion.v1",
  specCompiler: "spec-compiler.v1",
  specAssistant: "spec-assistant.v1",
  debugAgent: "debug-agent.v1",
  specValidator: "spec-validator.v1",
} as const;

export type AgentRole = keyof typeof FIXED_PROMPT_IDS;

export interface PromptEnvelope {
  agent_role: AgentRole;
  task_kind: string;
  requested_scope: string;
  spec_bindings: string[];
  context_bundle_ref: string;
  evidence_refs: string[];
  allowed_paths: string[];
  required_validations: string[];
  policy_flags: string[];
  fixed_prompt_id: string;
}

export interface WrappedPrompt {
  envelope: PromptEnvelope;
  task?: string;
  instructions: string;
}

export function buildPromptEnvelope(args: {
  role: AgentRole;
  taskKind: string;
  requestedScope: string;
  specBindings: string[];
  contextBundleRef: string;
  evidenceRefs: string[];
  allowedPaths: string[];
  requiredValidations: string[];
  policyFlags: string[];
  task?: string;
}): WrappedPrompt {
  const fixedPromptId = FIXED_PROMPT_IDS[args.role];
  const envelope: PromptEnvelope = {
    agent_role: args.role,
    task_kind: args.taskKind,
    requested_scope: args.requestedScope,
    spec_bindings: args.specBindings,
    context_bundle_ref: args.contextBundleRef,
    evidence_refs: args.evidenceRefs,
    allowed_paths: args.allowedPaths,
    required_validations: args.requiredValidations,
    policy_flags: args.policyFlags,
    fixed_prompt_id: fixedPromptId,
  };

  const instructions = [
    `You are a deterministic code assistant for a VOS runtime.`,
    `Use the schema contract exactly.`,
    `Do not execute commands.`,
    `Return JSON only.`,
    `Role: ${args.role}`,
    `Task kind: ${args.taskKind}`,
    `Allowed paths: ${args.allowedPaths.join(", ")}`,
    args.task ? `Task: ${args.task}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    envelope,
    task: args.task,
    instructions,
  };
}

export function formatPrompt(wrapped: WrappedPrompt): string {
  return JSON.stringify({
    envelope: wrapped.envelope,
    task: wrapped.task,
    instructions: wrapped.instructions,
    output_contract: "STRICT_JSON",
  }, null, 2);
}

