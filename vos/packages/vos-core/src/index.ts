export type RunId = `run-${string}`;
export type SpecId = `spec-${string}`;
export type PatchId = `patch-${string}`;
export type StageId = `stage-${string}`;

export interface EvidenceRef {
  id: string;
  kind: string;
  path: string;
}

export type CommandStatus =
  | "passed"
  | "ok"
  | "partial"
  | "agent_output_error"
  | "planned"
  | "not_implemented"
  | "policy_blocked"
  | "validation_failed"
  | "cancelled"
  | "timed_out"
  | "failed";

export interface CommandOutcome {
  run_id: RunId;
  status: CommandStatus;
  message?: string;
  code?: number;
  details?: Record<string, unknown>;
}

export interface RunArtifact {
  kind: string;
  path: string;
  size?: number;
  sha256?: string;
  summary?: string;
}

export interface RunManifest {
  run_id: RunId;
  command: string[];
  status: CommandStatus;
  started_at: string;
  finished_at: string;
  artifacts: RunArtifact[];
  evidence_refs: EvidenceRef[];
  project_root: string;
  project_id?: string;
  user_id?: string;
}

export interface RunEvent {
  run_id: RunId;
  ts: string;
  type:
  | "run_started"
  | "node_started"
  | "stdout_line"
  | "stderr_line"
  | "progress"
  | "node_finished"
  | "run_finished"
  | "run_cancelled";
  node_id?: string;
  visibility?: "public" | "agent-only" | "staff-only";
  payload?: Record<string, unknown>;
}

export interface AuthContext {
  verdict: "allowed" | "denied" | "not_required";
  reason?: string;
  portalUrl?: string;
  projectId?: string;
  user?: {
    id?: string;
    role?: string;
    username?: string;
    email?: string;
  };
  checkedAt?: string;
  policySnapshot?: {
    ref: string;
    projectId: string;
    allowedCommands: string[];
    allowedPaths: string[];
    visibilityScope: "public" | "agent-only";
  };
}

export interface AICollaborationEntry {
  entryType: string;
  summary: string;
  createdAt: string;
}

export interface AICollaborationLog {
  run_id: RunId;
  entries: AICollaborationEntry[];
}

export interface VosError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class CoreError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(error: VosError) {
    super(error.message);
    this.name = "CoreError";
    this.code = error.code;
    this.details = error.details;
  }
}

export {
  COMMAND_VERSION,
} from "./version.ts";
export {
  detectUpdateTarget,
  performSelfUpdate,
  maybeCheckForUpdate,
} from "./update.ts";
export {
  commandToArray,
  executeCliInvocation,
  executeCommand,
  executeVosCommand,
  isVosCommand,
  printCliError,
  printHelp,
  startAgentServer,
} from "./main.ts";
export type { ExecuteVosCommandOptions } from "./main.ts";
export { parseArgs } from "./cli.ts";
export { CliError, AgentOutputError } from "./errors.ts";
export { EvidenceWriter } from "./evidence/index.ts";
export { runProgressMcpServer } from "./progress/mcp-server.ts";
export {
  appendAgentProgressInstructions,
  createProgressMcpServerConfig,
  progressUpdateFromAgentEvent,
  PROGRESS_MCP_SERVER_NAME,
  PROGRESS_MCP_TOOL_NAME,
} from "./progress/agent.ts";
export {
  assertCommandAllowed,
  mergeEffectivePolicy,
} from "./policy/effective-policy.ts";
export { createKbEmbedder } from "./kb/embedding.ts";
export type {
  BaseCommandResult,
  CliCommand,
  EffectivePolicy,
  GlobalOptions,
  ParsedInvocation,
  ProgressMode,
  RunAuthContext,
  VerifyScope,
  VosCommand,
} from "./types.ts";
export type {
  CommandProgress,
  ProgressEnvironment,
  ProgressStatus,
  ProgressUpdate,
} from "./progress/types.ts";
export type {
  CommandOutcome as CoreCommandOutcome,
  ExecContext,
  ExecuteCliOptions,
} from "./bootstrap.ts";
export type { RunEvent as CoreRunEvent } from "./evidence/events.ts";
export type { PortalClient } from "./auth/portal-client.ts";
