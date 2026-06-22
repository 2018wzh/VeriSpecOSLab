import { existsSync } from "node:fs";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { mergeEffectivePolicy, assertCommandAllowed } from "vos-policy";
import type { AssertionPolicy, ToolWhitelist, PathScope } from "vos-policy";
import type { AICollaborationEntry, AICollaborationLog, AuthContext, CommandOutcome, CommandStatus, RunId, StageId } from "vos-core";

export interface ContextBundle {
  requested_scope: string;
  resolved_specs: string[];
  recent_evidence: Array<{ run_id: string; manifest: string }>;
  current_stage: StageId;
  allowed_paths: string[];
  allowed_path_sources: {
    policy_paths: number;
    spec_bound_paths: number;
    effective_paths: number;
  };
  recommended_commands: string[];
  visibility_scope: "public" | "agent-only";
  spec_snippets: Array<{ kind: string; summary: string; path?: string }>;
  policy_flags: string[];
  project_tree: string[];
}

export interface AgentSession {
  agent_session_id: string;
  agent_identity_id: string;
  role_prompt_id: string;
  capability_pack_id: string;
  visibility_scope: "public" | "agent-only";
  required_evidence?: Array<{ id: string; kind: string; path: string }>;
  required_stage?: StageId;
  created_at: string;
}

export interface AgentTaskRecord {
  task: string;
  related_specs: string[];
  changed_targets: string[];
  required_validations: string[];
  notes: string[];
}

export interface AgentTaskContext {
  session: AgentSession;
  policy?: AssertionPolicy;
  plan?: { plan_id: string; command_name: string };
  evidence_refs?: Array<{ id: string; kind: string; path: string }>;
  run_manifest?: unknown;
}

export interface CapabilityPack {
  id: string;
  tools: string[];
  profiles: string[];
}

export interface AgentRunnerClient {
  runTask(task: AgentTaskRecord, context: AgentTaskContext): Promise<CommandOutcome>;
}

export interface ContextAssembler {
  assemble(session: AgentSession): Promise<ContextBundle>;
}

export interface AgentSessionResolver {
  resolve(sessionId: string): Promise<AgentSession | undefined>;
}

export interface AgentAuditWriter {
  append(session: AgentSession, log: AICollaborationLog): Promise<void> | void;
}

export interface PatchGate {
  canApplyPatch(patchId: string, context: AgentTaskContext): Promise<boolean>;
}

export interface AgentTaskResult {
  outcome: CommandOutcome;
  runId: RunId;
  sessionId?: string;
}

export interface BuildContextBundleOptions {
  projectRoot: string;
  requestedScope?: string;
  policy?: AssertionPolicy;
  scope?: string;
  toolWhitelist?: ToolWhitelist;
  pathScope?: PathScope;
}

export async function buildContextBundle(options: BuildContextBundleOptions): Promise<ContextBundle> {
  const projectFile = path.join(options.projectRoot, ".vos", "project.yaml");
  if (!existsSync(projectFile)) {
    throw new Error("project configuration missing");
  }

  const specFile = path.join(options.projectRoot, ".vos", "runs");
  const recentEvidence = existsSync(specFile)
    ? await collectRecentEvidenceRefs(options.projectRoot)
    : [];

  const defaultAllowed = options.policy?.allowedPaths ?? ["src", "spec", "tests", ".vos"];
  const scope = options.pathScope === "agent-only" ? "agent-only" : "public";
  return {
    requested_scope: options.requestedScope ?? "agent",
    resolved_specs: [],
    recent_evidence: recentEvidence,
    current_stage: (options.scope as StageId) ?? "stage-unknown",
    allowed_paths: defaultAllowed,
    allowed_path_sources: {
      policy_paths: defaultAllowed.length,
      spec_bound_paths: 0,
      effective_paths: defaultAllowed.length,
    },
    recommended_commands: [
      "spec lint",
      "spec normalize",
      "arch derive-tests",
      "agent generate",
      "build",
      "test",
      "verify goal",
    ],
    visibility_scope: options.pathScope ?? "public",
    spec_snippets: options.scope
      ? [{ kind: "scope", summary: `scope:${options.scope}` }]
      : [],
    policy_flags: [
      `allowed_paths:${defaultAllowed.length}`,
      `scope:${scope}`,
    ],
    project_tree: await collectProjectTree(options.projectRoot),
  };
}

export async function runAgentTask(
  task: AgentTaskRecord,
  context: AgentTaskContext,
  runner?: AgentRunnerClient,
): Promise<AgentTaskResult> {
  const runId = `run-${Date.now().toString(36)}` as RunId;
  const outcome = runner
    ? await runner.runTask(task, context)
    : {
      run_id: runId,
      status: "ok" as CommandStatus,
      details: {
        task,
        session: context.session.agent_session_id,
      },
    };
  return { outcome, runId, sessionId: context.session.agent_session_id };
}

export async function recordAICollaboration(
  session: AgentSession,
  log: {
    session_id: string;
    task_kind: string;
    agent_profile: {
      prompt_id: string;
      system_prompt?: string;
      mode?: string;
      skills: string[];
      mcp_servers: string[];
      output_schema: string;
    };
    related_specs: string[];
    allowed_paths: string[];
    output_kind: string;
    patch_ref?: string;
    evidence_ref?: string;
    result: "accepted" | "rejected" | "pending" | "failed";
    created_at: string;
  },
  writer?: AgentAuditWriter,
): Promise<void> {
  const normalized: AICollaborationLog = {
    run_id: log.session_id as RunId,
    entries: [
      {
        entryType: log.result,
        summary: `agent:${log.task_kind}:${log.output_kind}`,
        createdAt: log.created_at,
      },
    ],
  };
  await writer?.append(session, normalized);
}

export function parseAgentJson(text: string): unknown | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) return undefined;
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return undefined;
    }
  }
}

export class InMemoryAgentSessionResolver implements AgentSessionResolver {
  private readonly sessions = new Map<string, AgentSession>();

  register(session: AgentSession): void {
    this.sessions.set(session.agent_session_id, session);
  }

  async resolve(sessionId: string): Promise<AgentSession | undefined> {
    return this.sessions.get(sessionId);
  }
}

export const simplePatchGate: PatchGate = {
  async canApplyPatch(_patchId: string) {
    return true;
  },
};

export function checkCommandAllowed(command: string[], policy: AssertionPolicy): boolean {
  return assertCommandAllowed(command, policy).allowed;
}

export function mergeSessionPolicy(local: AssertionPolicy, portal?: AssertionPolicy): AssertionPolicy {
  return mergeEffectivePolicy(local, portal);
}

export function resolveAuthContext(context: AuthContext): string {
  return context.portalUrl ?? "";
}

async function collectRecentEvidenceRefs(projectRoot: string): Promise<Array<{ run_id: string; manifest: string }>> {
  const runRoot = path.join(projectRoot, ".vos", "runs");
  if (!existsSync(runRoot)) return [];

  const dirs = await readdir(runRoot, { withFileTypes: true });
  const list = dirs.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (list.length === 0) return [];

  const out: Array<{ run_id: string; manifest: string }> = [];
  for (const entry of list.slice(0, 10)) {
    out.push({ run_id: entry, manifest: entry });
  }
  return out;
}

async function collectProjectTree(projectRoot: string): Promise<string[]> {
  const roots = [
    "Makefile",
    "CMakeLists.txt",
    "include",
    "kernel",
    "user",
    "src",
    "tests",
    "spec",
    ".vos/toolchain.json",
  ];

  const out: string[] = [];
  for (const entry of roots) {
    const absolute = path.join(projectRoot, entry);
    if (!existsSync(absolute)) continue;
    out.push(entry);
  }
  return out;
}

export function createRunTask(taskKind: string): AgentTaskRecord {
  return {
    task: taskKind,
    related_specs: [],
    changed_targets: [],
    required_validations: [],
    notes: [],
  };
}

export type {
  AgentSession,
  AgentTaskContext,
  AgentTaskRecord,
  AgentRunnerClient,
  AgentSessionResolver,
  CapabilityPack,
  ContextAssembler,
  PatchGate,
};

export interface ContextRecord {
  session: AgentSession;
  policy?: AssertionPolicy;
  task: AgentTaskRecord;
  entries: AICollaborationEntry[];
}
