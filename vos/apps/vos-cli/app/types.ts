import type { EvidenceRef, RunArtifact } from "./evidence/manifest.ts";

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

export interface CommandPayload {
  kind?: string;
  [key: string]: unknown;
}

export interface BaseCommandResult {
  ok: boolean;
  run_id: string;
  command: string[];
  status: CommandStatus;
  artifacts: RunArtifact[];
  payload?: CommandPayload;
  details?: Record<string, unknown>;
  evidence_refs: EvidenceRef[];
  started_at: string;
  finished_at: string;
  message?: string;
}

export type ProgressMode = "auto" | "always" | "never";

export interface GlobalOptions {
  projectRoot: string;
  json: boolean;
  progress: ProgressMode;
  agentSession?: string;
  reportPath?: string;
  evidenceDir?: string;
}

export type VerifyScope =
  | "public"
  | "patch"
  | "full"
  | "invariant"
  | "fuzz"
  | "base"
  | "architecture"
  | "composition"
  | "goal"
  | "trace";

export interface BaseCommand {
  kind: string;
}

export interface LoginCommand extends BaseCommand {
  kind: "login";
  portalUrl: string;
  token?: string;
  tokenStdin: boolean;
}

export interface LogoutCommand extends BaseCommand {
  kind: "logout";
  portalUrl?: string;
}

export interface WhoamiCommand extends BaseCommand {
  kind: "whoami";
  portalUrl?: string;
}

export interface ServeCommand extends BaseCommand {
  kind: "serve";
  portalUrl: string;
  projectId: string;
  host?: string;
  port?: number;
}

export interface InitCommand extends BaseCommand {
  kind: "init";
}

export interface DoctorCommand extends BaseCommand {
  kind: "doctor";
}

export interface StageShowCommand extends BaseCommand {
  kind: "stage_show";
}

export interface ToolchainLintCommand extends BaseCommand {
  kind: "toolchain_lint";
}

export interface SpecLintCommand extends BaseCommand {
  kind: "spec_lint";
  path?: string;
}

export interface SpecNormalizeCommand extends BaseCommand {
  kind: "spec_normalize";
}

export interface SpecCheckConsistencyCommand extends BaseCommand {
  kind: "spec_check_consistency";
}

export interface SpecPatchLintCommand extends BaseCommand {
  kind: "spec_patch_lint";
  patchPath?: string;
}

export interface SpecPatchApplyCommand extends BaseCommand {
  kind: "spec_patch_apply";
  patchPath?: string;
  inputFromStdin?: boolean;
}

export interface ArchLintCommand extends BaseCommand {
  kind: "arch_lint";
  path?: string;
}

export interface ArchComposeCommand extends BaseCommand {
  kind: "arch_compose";
  path?: string;
}

export interface ArchDeriveTestsCommand extends BaseCommand {
  kind: "arch_derive_tests";
  path?: string;
}

export interface BuildCommand extends BaseCommand {
  kind: "build";
  dryRun: boolean;
  toolchainPath?: string;
}

export interface BuildGenerateCommand extends BaseCommand {
  kind: "build_generate";
  agentSession?: string;
}

export interface RunQemuCommand extends BaseCommand {
  kind: "run_qemu";
  dryRun: boolean;
  timeoutMs?: number;
  readyPattern?: string;
}

export interface TestCommand extends BaseCommand {
  kind: "test";
  suites: string[];
  dryRun: boolean;
}

export interface VerifyCommand extends BaseCommand {
  kind: "verify";
  scope: VerifyScope;
  target?: string;
  dryRun: boolean;
  patchFile?: string;
  keepWorktree?: boolean;
  staffPolicy?: string;
}

export interface TraceSyscallCommand extends BaseCommand {
  kind: "trace_syscall";
  timeoutMs?: number;
  dryRun: boolean;
}

export interface DebugExplainLogCommand extends BaseCommand {
  kind: "debug_explain_log";
  logPath?: string;
}

export interface ReportGenerateCommand extends BaseCommand {
  kind: "report_generate";
}

export interface SubmitPackCommand extends BaseCommand {
  kind: "submit_pack";
}

export interface LedgerRecordCommand extends BaseCommand {
  kind: "ledger_record";
  actor: "human" | "agent";
  intent: string;
  specRefs: string[];
  changedTargets: string[];
}

export interface AgentServeCommand extends BaseCommand {
  kind: "agent_serve";
  host?: string;
  port?: number;
}

export interface AgentContextCommand extends BaseCommand {
  kind: "agent_context";
  scope?: string;
}

export interface AgentPlanCommand extends BaseCommand {
  kind: "agent_plan";
  task?: string;
  scope?: string;
}

export interface AgentGenerateCommand extends BaseCommand {
  kind: "agent_generate";
  task?: string;
  target?: string;
  apply: boolean;
  build: boolean;
  run: boolean;
}

export interface AgentApplyPatchCommand extends BaseCommand {
  kind: "agent_apply_patch";
  patchFile?: string;
  requireSpec: boolean;
  runValidation: boolean;
}

export interface AgentValidateGeneratedCommand extends BaseCommand {
  kind: "agent_validate_generated";
  target: string;
  patchFile?: string;
  keepWorktree: boolean;
}

export interface AgentDebugCommand extends BaseCommand {
  kind: "agent_debug";
  logPath?: string;
}

export interface AgentLogCommand extends BaseCommand {
  kind: "agent_log";
  append: boolean;
  inputPath?: string;
}

export interface AgentReviewSpecCommand extends BaseCommand {
  kind: "agent_review_spec";
  target?: string;
}

export interface AgentAskCommand extends BaseCommand {
  kind: "agent_ask";
  question: string;
  scope?: string;
}

export interface KbAddCommand extends BaseCommand {
  kind: "kb_add";
  source: string;
  sourceKind: "course" | "project" | "external";
  stage?: string;
  title?: string;
  recursive?: boolean;
  manifestPath?: string;
}

export interface KbListCommand extends BaseCommand {
  kind: "kb_list";
}

export interface KbSearchCommand extends BaseCommand {
  kind: "kb_search";
  query: string;
}

export interface KbRemoveCommand extends BaseCommand {
  kind: "kb_remove";
  id: string;
}

export interface KbClearCommand extends BaseCommand {
  kind: "kb_clear";
}

export interface KbExportManifestCommand extends BaseCommand {
  kind: "kb_export_manifest";
  outPath?: string;
}

export interface KbImportManifestCommand extends BaseCommand {
  kind: "kb_import_manifest";
  manifestPath: string;
}

export type CliCommand =
  | LoginCommand
  | LogoutCommand
  | WhoamiCommand
  | ServeCommand
  | InitCommand
  | DoctorCommand
  | StageShowCommand
  | ToolchainLintCommand
  | SpecLintCommand
  | SpecNormalizeCommand
  | SpecCheckConsistencyCommand
  | SpecPatchLintCommand
  | SpecPatchApplyCommand
  | ArchLintCommand
  | ArchComposeCommand
  | ArchDeriveTestsCommand
  | BuildCommand
  | BuildGenerateCommand
  | RunQemuCommand
  | TestCommand
  | VerifyCommand
  | TraceSyscallCommand
  | DebugExplainLogCommand
  | ReportGenerateCommand
  | SubmitPackCommand
  | LedgerRecordCommand
  | AgentServeCommand
  | AgentContextCommand
  | AgentPlanCommand
  | AgentGenerateCommand
  | AgentApplyPatchCommand
  | AgentValidateGeneratedCommand
  | AgentDebugCommand
  | AgentLogCommand
  | AgentReviewSpecCommand
  | AgentAskCommand
  | KbAddCommand
  | KbListCommand
  | KbSearchCommand
  | KbRemoveCommand
  | KbClearCommand
  | KbExportManifestCommand
  | KbImportManifestCommand
  | { kind: "help"; topic?: string };

export interface ParsedInvocation {
  global: GlobalOptions;
  command: CliCommand;
}

export type AuthVerdict = "allowed" | "denied" | "not_required";

export interface PortalUserSummary {
  id: string;
  role?: string;
  username?: string;
  email?: string;
}

export interface PolicySnapshot {
  ref: string;
  projectId: string;
  allowedCommands: string[];
  allowedPaths: string[];
  visibilityScope: "public" | "agent-only" | "staff-only";
}

export interface EffectivePolicy {
  source: "local" | "portal";
  snapshotRef?: string;
  allowedCommands: string[];
  allowedPaths: string[];
  visibilityScope: "public" | "agent-only" | "staff-only";
}

export interface RunAuthContext {
  verdict: AuthVerdict;
  reason?: string;
  portalUrl?: string;
  projectId?: string;
  user?: PortalUserSummary;
  policySnapshot?: PolicySnapshot;
  checkedAt?: string;
}

export interface ToolchainGenerationDraft {
  files: Array<{ path: string; content: string }>;
  manifest: Record<string, unknown>;
  build_instructions: string;
  spec_refs: string[];
  changed_targets: string[];
}

export interface CommitLedgerEntry {
  commit_sha: string;
  parent_sha?: string;
  actor: "human" | "agent";
  agent_session_id?: string;
  run_id?: string;
  spec_refs: string[];
  changed_targets: string[];
  evidence_refs: EvidenceRef[];
  created_at: string;
  collaboration_intent: string;
}

export interface ReproducibilityVerdict {
  ok: boolean;
  reason?: "not_git_repo" | "dirty_worktree" | "ledger_missing" | "head_missing";
  commitSha?: string;
  parentSha?: string;
  ledgerRef?: string;
}

export interface EvidenceIndex {
  version: 1;
  runs: Array<{
    run_id: string;
    command: string[];
    status: CommandStatus;
    manifest: string;
    started_at: string;
    finished_at: string;
  }>;
}

export interface VosHttpRun {
  id: string;
  status: CommandStatus | "queued" | "running";
  command: string[];
  requestedBy: string;
  reason?: string;
  agentSessionId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: BaseCommandResult;
  error?: string;
}
