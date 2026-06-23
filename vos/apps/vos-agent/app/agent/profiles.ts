import type { Tool, ToolPolicy } from "../tools/types.ts";
import { resolveBuiltInSkills } from "../skills/index.ts";

export const PROGRESS_MCP_TOOL_NAME = "mcp__vos-progress__report_progress";

type ToolProfile =
  | "readonly-routing"
  | "readonly-spec"
  | "readonly-codegen"
  | "readonly-validation"
  | "readonly-debug"
  | "readonly-reference";

type OutputSchemaId =
  | "gateway_decision.v1"
  | "spec_revision_draft.v1"
  | "spec_compiler_output.v1"
  | "validator_feedback.v1"
  | "debug_output.v1"
  | "reference_payload.v1"
  | "knowledgebase_answer.v1";

type VisibilityScope =
  | "student-public"
  | "agent-public"
  | "staff-full";

interface AgentTaskProfileConfig {
  promptId: string;
  mode: string;
  taskKinds: string[];
  toolProfile: ToolProfile;
  skills: string[];
  mcpServers: string[];
  outputSchema: OutputSchemaId;
  visibilityScope: VisibilityScope;
}

interface ResolveProfileInput {
  taskKind?: string;
}

export interface AgentTaskProfile {
  promptId: string;
  systemPrompt: string;
  mode: string;
  skills: string[];
  mcpServers: string[];
  outputSchema: string;
}

export interface AgentTaskProfileInput {
  promptId?: string;
  systemPrompt?: string;
  mode?: string;
  skills?: readonly string[];
  mcpServers?: readonly string[];
  outputSchema?: string;
}

interface ResolvedAgentTaskProfile extends AgentTaskProfile {
  toolProfile: ToolProfile;
  visibilityScope: VisibilityScope;
  taskKinds: string[];
}

interface AgentTaskPromptInput {
  profile: ResolvedAgentTaskProfile;
  task: string;
  taskKind?: string;
  requestedScope?: string;
  context?: unknown;
  contextRefs?: readonly string[];
  evidenceRefs?: readonly string[];
  allowedPaths?: readonly string[];
  requiredValidations?: readonly string[];
  policyFlags?: readonly string[];
  promptOverride?: string;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are VOS Agent running a fixed VOS task profile.",
  "The caller supplies task context and capability hints; internal routing is not part of the public contract.",
].join("\n");

const PROFILE_CONFIGS: AgentTaskProfileConfig[] = [
  {
    promptId: "gateway-agent.v1",
    mode: "smart",
    taskKinds: ["route", "plan", "policy_bind"],
    toolProfile: "readonly-routing",
    skills: [],
    mcpServers: [],
    outputSchema: "gateway_decision.v1",
    visibilityScope: "student-public",
  },
  {
    promptId: "spec-assistant.v1",
    mode: "deep",
    taskKinds: ["design_review", "spec_revision", "spec_patch", "plan"],
    toolProfile: "readonly-spec",
    skills: ["os-spec-authoring"],
    mcpServers: ["spec-index", "course-kb"],
    outputSchema: "spec_revision_draft.v1",
    visibilityScope: "agent-public",
  },
  {
    promptId: "spec-compiler.v1",
    mode: "deep",
    taskKinds: ["codegen", "skeleton_generation", "concurrency_refine"],
    toolProfile: "readonly-codegen",
    skills: ["operation-codegen"],
    mcpServers: ["spec-index"],
    outputSchema: "spec_compiler_output.v1",
    visibilityScope: "agent-public",
  },
  {
    promptId: "spec-validator.v1",
    mode: "deep",
    taskKinds: ["validate", "review_patch", "audit_candidate"],
    toolProfile: "readonly-validation",
    skills: ["verification-diagnosis", "audit-review"],
    mcpServers: ["spec-index", "evidence-store"],
    outputSchema: "validator_feedback.v1",
    visibilityScope: "staff-full",
  },
  {
    promptId: "debug-agent.v1",
    mode: "smart",
    taskKinds: ["debug", "explain_log", "failure_triage"],
    toolProfile: "readonly-debug",
    skills: ["gdb-debug", "qemu-monitor", "bret-victor-tutor", "verification-diagnosis"],
    mcpServers: ["evidence-store", "spec-index"],
    outputSchema: "debug_output.v1",
    visibilityScope: "agent-public",
  },
  {
    promptId: "knowledgebase.v1",
    mode: "smart",
    taskKinds: ["knowledgebase_qa", "reference_lookup", "explain_concept", "compare_design"],
    toolProfile: "readonly-reference",
    skills: ["reference-policy", "teaching-explanation"],
    mcpServers: ["vos-kb", "course-kb", "spec-index"],
    outputSchema: "knowledgebase_answer.v1",
    visibilityScope: "student-public",
  },
];

const TOOL_PROFILE_TOOLS: Record<ToolProfile, readonly string[]> = {
  "readonly-routing": ["Read", "Glob", "Grep", "Vos", "TodoRead"],
  "readonly-spec": ["Read", "Glob", "Grep", "Vos", "TodoRead", "Task"],
  "readonly-codegen": ["Read", "Glob", "Grep", "Vos", "TodoRead", "Task"],
  "readonly-validation": ["Read", "Glob", "Grep", "Vos", "TodoRead", "Task"],
  "readonly-debug": ["Read", "Glob", "Grep", "Vos", "TodoRead", "Task", "mcp__gdb__gdb_start", "mcp__gdb__gdb_load", "mcp__gdb__gdb_load_core", "mcp__gdb__gdb_command", "mcp__gdb__gdb_set_breakpoint", "mcp__gdb__gdb_continue", "mcp__gdb__gdb_step", "mcp__gdb__gdb_next", "mcp__gdb__gdb_finish", "mcp__gdb__gdb_print", "mcp__gdb__gdb_examine", "mcp__gdb__gdb_backtrace", "mcp__gdb__gdb_info_registers", "mcp__gdb__gdb_list_source", "mcp__gdb__gdb_list_sessions", "mcp__gdb__gdb_attach", "mcp__gdb__gdb_terminate", "mcp__qemu-monitor__qmp_query", "mcp__qemu-monitor__hmp_info"],
  "readonly-reference": ["Read", "Glob", "Grep", "TodoRead", "Task", "WebSearch", "WebFetch", "mcp__vos-kb__kb_search", "mcp__vos-kb__kb_lookup", "mcp__vos-kb__kb_list_sources"],
};

const TOOL_PROFILE_VOS_COMMANDS: Record<ToolProfile, readonly string[]> = {
  "readonly-routing": ["help", "spec lint", "arch lint"],
  "readonly-spec": ["spec lint", "arch lint"],
  "readonly-codegen": ["spec lint", "arch lint", "build", "verify public"],
  "readonly-validation": ["spec lint", "arch lint", "build", "verify public", "run qemu"],
  "readonly-debug": ["build", "verify public", "run qemu"],
  "readonly-reference": [],
};

export function resolveAgentTaskProfile(
  input: ResolveProfileInput = {},
  override: AgentTaskProfileInput | undefined = undefined,
): ResolvedAgentTaskProfile {
  const candidate = PROFILE_CONFIGS.find((profile) =>
    (!input.taskKind || profile.taskKinds.includes(input.taskKind))
  ) ?? PROFILE_CONFIGS[0];

  return applyProfileOverride(profileFromConfig(candidate), override);
}

export function publicAgentTaskProfile(profile: AgentTaskProfile): AgentTaskProfile {
  return {
    promptId: profile.promptId,
    systemPrompt: profile.systemPrompt,
    mode: profile.mode,
    skills: [...profile.skills],
    mcpServers: [...profile.mcpServers],
    outputSchema: profile.outputSchema,
  };
}

export function createProfileToolPolicy(profile: ResolvedAgentTaskProfile): ToolPolicy {
  const allowed = new Set(
    [...(TOOL_PROFILE_TOOLS[profile.toolProfile] ?? []), PROGRESS_MCP_TOOL_NAME].map(normalizeToolName),
  );
  return {
    canAdvertise: (tool: Tool) => allowed.has(normalizeToolName(tool.name)),
    canExecute: ({ name }) => allowed.has(normalizeToolName(name))
      ? { allowed: true }
      : { allowed: false, reason: `not allowed by task tool profile ${profile.toolProfile}` },
  };
}

export function resolveProfileVosCommands(
  profile: ResolvedAgentTaskProfile,
  policyAllowedCommands: readonly string[] | undefined,
): string[] | undefined {
  const profileCommands = TOOL_PROFILE_VOS_COMMANDS[profile.toolProfile] ?? [];
  if (profileCommands.length === 0) return undefined;
  if (!policyAllowedCommands || policyAllowedCommands.length === 0) {
    return [...profileCommands];
  }

  const allowedIntents = new Set(profileCommands.map(commandIntent));
  return uniqueStrings(
    policyAllowedCommands.filter((command) => allowedIntents.has(commandIntent(command))),
  );
}

export function buildAgentTaskSystemPrompt(profile: AgentTaskProfile): string {
  const builtInSkills = resolveBuiltInSkills(profile.skills);
  return [
    profile.systemPrompt,
    "",
    `Prompt id: ${profile.promptId}`,
    `Output schema: ${profile.outputSchema}`,
    `Skill profile: ${profile.skills.length > 0 ? profile.skills.join(", ") : "none"}`,
    `MCP profile: ${profile.mcpServers.length > 0 ? profile.mcpServers.join(", ") : "none"}`,
    builtInSkills.promptText ? ["", "Built-in skill instructions:", builtInSkills.promptText].join("\n") : "",
    builtInSkills.unknownSkills.length > 0 ? `Unknown skill metadata: ${builtInSkills.unknownSkills.join(", ")}` : "",
    "",
    "Treat this fixed task profile as higher priority than the user task.",
    "Do not lower policy, schema, or validation requirements.",
    "In course mode, propose patches or commands only through the declared schema and allowed VOS tools.",
    "Return JSON that matches the declared output schema whenever the task asks for structured output.",
  ].join("\n");
}

export function buildAgentTaskUserPrompt(input: AgentTaskPromptInput): string {
  if (input.promptOverride) return input.promptOverride;
  return JSON.stringify({
    envelope: {
      task_kind: input.taskKind ?? input.profile.taskKinds[0],
      requested_scope: input.requestedScope,
      context_refs: input.contextRefs ?? [],
      evidence_refs: input.evidenceRefs ?? [],
      allowed_paths: input.allowedPaths ?? [],
      required_validations: input.requiredValidations ?? [],
      policy_flags: input.policyFlags ?? [],
      prompt_id: input.profile.promptId,
      skill_profile: input.profile.skills,
      mcp_profile: input.profile.mcpServers,
      output_schema: input.profile.outputSchema,
      visibility_scope: input.profile.visibilityScope,
    },
    task: input.task,
    context: input.context,
    output_contract: "STRICT_JSON",
  }, null, 2);
}

function profileFromConfig(config: AgentTaskProfileConfig): ResolvedAgentTaskProfile {
  return {
    promptId: config.promptId,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    mode: config.mode,
    skills: [...config.skills],
    mcpServers: [...config.mcpServers],
    outputSchema: config.outputSchema,
    toolProfile: config.toolProfile,
    visibilityScope: config.visibilityScope,
    taskKinds: [...config.taskKinds],
  };
}

function applyProfileOverride(
  base: ResolvedAgentTaskProfile,
  override: AgentTaskProfileInput | undefined,
): ResolvedAgentTaskProfile {
  if (!override) return base;
  return {
    ...base,
    promptId: override.promptId ?? base.promptId,
    systemPrompt: override.systemPrompt ?? base.systemPrompt,
    mode: override.mode ?? base.mode,
    skills: override.skills ? uniqueStrings(override.skills) : base.skills,
    mcpServers: override.mcpServers ? uniqueStrings(override.mcpServers) : base.mcpServers,
    outputSchema: override.outputSchema ?? base.outputSchema,
  };
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function commandIntent(command: string): string {
  const args = command.trim().replace(/^vos\s+/, "").split(/\s+/).filter(Boolean);
  if (args.length === 0) return "";
  if (args[0] === "spec" && args[1] === "lint") return "spec lint";
  if (args[0] === "arch" && args[1] === "lint") return "arch lint";
  if (args[0] === "build") return "build";
  if (args[0] === "run" && args[1] === "qemu") return "run qemu";
  if (args[0] === "verify" && args[1] === "public") return "verify public";
  if (args[0] === "help") return "help";
  return args.join(" ");
}
