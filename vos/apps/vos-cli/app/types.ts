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

export interface GlobalOptions {
  projectRoot: string;
  json: boolean;
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
  | "goal";

export interface BaseCommand {
  kind: string;
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

export interface AgentDebugCommand extends BaseCommand {
  kind: "agent_debug";
  logPath?: string;
}

export interface AgentLogCommand extends BaseCommand {
  kind: "agent_log";
  append: boolean;
  inputPath?: string;
}

export type CliCommand =
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
  | RunQemuCommand
  | TestCommand
  | VerifyCommand
  | TraceSyscallCommand
  | DebugExplainLogCommand
  | ReportGenerateCommand
  | SubmitPackCommand
  | AgentServeCommand
  | AgentContextCommand
  | AgentPlanCommand
  | AgentGenerateCommand
  | AgentApplyPatchCommand
  | AgentDebugCommand
  | AgentLogCommand
  | { kind: "help"; topic?: string };

export interface ParsedInvocation {
  global: GlobalOptions;
  command: CliCommand;
}
