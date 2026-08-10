#!/usr/bin/env bun

import { parseArgs } from "./cli.ts";
import type {
  AgentApplyPatchCommand,
  AgentEmbeddingProviderName,
  AgentContextCommand,
  AgentDebugCommand,
  AgentGenerateCommand,
  AgentLogCommand,
  AgentPlanCommand,
  AgentServeCommand,
  AgentValidateGeneratedCommand,
  AgentAskCommand,
  AgentConfigCommand,
  AgentImplementCommand,
  AgentVerifyCommand,
  AgentProviderName,
  AgentReviewCommand,
  ArchComposeCommand,
  ArchDeriveTestsCommand,
  ArchLintCommand,
  BaseCommandResult,
  BuildGenerateCommand,
  BuildCommand,
  CliCommand,
  CommandStatus,
  DebugExplainLogCommand,
  DoctorCommand,
  EffectivePolicy,
  InitCommand,
  LoginCommand,
  LedgerRecordCommand,
  LogoutCommand,
  KbAddCommand,
  KbClearCommand,
  KbExportManifestCommand,
  KbImportManifestCommand,
  KbRemoveCommand,
  KbSearchCommand,
  ReportGenerateCommand,
  RunQemuCommand,
  RunHardwareCommand,
  ParsedInvocation,
  PortalPipelineCommand,
  ProjectBindCommand,
  RunAuthContext,
  ServeCommand,
  StageSaveCommand,
  StageShowCommand,
  SpecCheckConsistencyCommand,
  SpecLintCommand,
  SpecNormalizeCommand,
  SpecPatchApplyCommand,
  SpecPatchLintCommand,
  SubmitPackCommand,
  TestCommand,
  ToolchainLintCommand,
  ToolchainInitCommand,
  TraceSyscallCommand,
  ToolchainGenerationDraft,
  VosCommand,
  VerifyCommand,
  WhoamiCommand,
} from "./types.ts";
import { CliError, AgentOutputError } from "./errors.ts";
import { EvidenceWriter } from "./evidence/index.ts";
import type { CommandOutcome, ExecContext, ExecuteCliOptions } from "./bootstrap.ts";
import { collectStringListByKey, parseTopLevelYaml } from "./utils/yaml.ts";
import { readProjectEnv, withProjectEnv } from "./utils/dotenv.ts";
import { executeCommand } from "./dispatch.ts";
import {
  ensureDefaultProjectConfig,
  loadPolicyConfig,
  loadTimeline,
  loadProjectConfig,
  currentStageForProject,
} from "./utils/project.ts";
import { appendLogEntry, readLogEntries } from "./agent/helpers.ts";
import { mkdir, readFile, readdir, writeFile, rm, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { isWindows } from "vos-platform";
import { renderOutput } from "./output.ts";
import { createCommandProgress } from "./progress/index.ts";
import type { CommandProgress, ProgressUpdate } from "./progress/types.ts";
import { runProgressMcpServer } from "./progress/mcp-server.ts";
import {
  createProgressMcpServerConfig,
  progressUpdateFromAgentEvent,
} from "./progress/agent.ts";
import { runBuildCommand } from "./runtime/build.ts";
import { probeRequiredTools } from "./runtime/environment.ts";
import { createSubmitPack } from "./submit/pack.ts";
import { createStudentSubmitPack } from "./submit/student.ts";
import { runQemuCommand } from "./runtime/qemu.ts";
import { runTestCommand } from "./runtime/test.ts";
import { runVerifyCommand, type BehaviorTestRunner } from "./runtime/verify.ts";
import { loadToolchainManifest, parseToolchainManifest, type RequiredToolV2, type ToolchainManifestV2 } from "./runtime/manifest.ts";
import {
  buildDebugTraceInput,
  ensureCleanGitWorktree,
  runAgentDebugTrace,
  type DebugTraceInput,
} from "./runtime/debug-trace.ts";
import { resolveToolchainManifestPath } from "./runtime/toolchain-manifest.ts";
import { HardwareRunner, HostRunner, ManifestRunner, QemuRunner, readStudentManifest, runStructuredStudentCommand } from "./runtime/student-runner.ts";
import { runCommand } from "./runtime/executor.ts";
import { buildContextBundle, loadAgentAllowedPaths } from "./agent/context.ts";
import {
  AGENTS_READONLY_GUIDANCE_PROMPT,
  buildAgentDebugPrompt,
  buildAgentGeneratePrompt,
  buildAgentPlanPrompt,
  buildToolchainGeneratePrompt,
  resolvePromptProfileEnvelope,
} from "./agent/prompt.ts";
import {
  runAgentWithPrompt,
  runInteractiveAgentWithPrompt,
  runAgentInteractiveTask,
  startAgentReadonlyDisplay,
  startAgentServer,
  type HeadlessAgentTaskRunner,
  type InteractiveAgentTaskRunner,
  type ReadonlyAgentDisplayHandle,
  type ReadonlyAgentDisplayStarter,
} from "./agent/runner.ts";
import { isRecord, parseDebugOutput, parseKnowledgebaseAnswer, parsePatchProposal, parsePlanDraft } from "./agent/schemas.ts";
import { applyPatchText, readPatchFromStdin } from "./agent/apply-patch.ts";
import { createKbEmbedder, kbEmbeddingEnv } from "./kb/embedding.ts";
import {
  AGENT_EMBEDDING_PROVIDER_NAMES,
  AGENT_PROVIDER_DEFAULTS,
  AGENT_PROVIDER_NAMES,
  DEFAULT_EMBEDDING_MODEL,
  checkAgentConfig,
  defaultEmbeddingAuthEnv,
  defaultEmbeddingBaseUrl,
  defaultEmbeddingProvider,
  readAgentConfig,
  resetAgentConfig,
  writeAgentConfig,
  type ProviderConfig,
} from "./agent/config.ts";
import { defaultPortalClient, type PortalClient } from "./auth/portal-client.ts";
import { getToken, normalizePortalUrl, removeToken, saveToken, updateStoredUser } from "./auth/store.ts";
import { assertCommandAllowed, mergeEffectivePolicy } from "./policy/effective-policy.ts";
import type { RunEvent } from "./evidence/events.ts";
import {
  appendLedgerEntry,
  assertReproducible,
  checkReproducibility,
  currentHead,
  ensureHeadLedgerEntry,
  git,
  parentSha,
} from "./repro/ledger.ts";
import { generateCourseReport } from "./report/generate.ts";
import {
  buildNormalizedSpecBundle,
  composeArchitecture,
  deriveTestMatrix,
  hasBlockingDiagnostics,
  parseAgentSpecReview,
  resolveSpecPatch,
  selectPatchVerificationChecks,
  type AgentSpecReview,
  type NormalizedSpecBundle,
  type PatchImpactReport,
  type SpecDiagnostic,
  type SpecPatchRecord,
  parseProjectManifest,
} from "vos-spec";
import { moduleMatches } from "vos-spec";
import {
  addKbSource,
  clearKbSources,
  exportKbManifest,
  importKbManifest,
  listKbSources,
  removeKbSource,
  searchKb,
} from "vos-kb";
import { COMMAND_VERSION } from "./version.ts";
const DEBUG_TRACE_AGENT_ATTEMPTS = 3;

async function main(): Promise<void> {
  try {
    if (process.argv[2] === "internal" && process.argv[3] === "progress-mcp") {
      await runProgressMcpServer();
      return;
    }

    const parsed = parseArgs(process.argv);
    if (parsed.command.kind === "help") {
      process.exitCode = printHelp(parsed.command.topic) ? 0 : 1;
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    const result = await executeCliInvocation(process.argv, {
      print: true,
      signal: controller.signal,
    });
    process.exitCode = isSuccessStatus(result.status) ? 0 : 1;
  } catch (error) {
    printCliError(error, process.argv);
    process.exitCode = 1;
  }
}

export async function executeCliInvocation(
  argv: string[],
  options: ExecuteCliOptions = {},
): Promise<BaseCommandResult> {
  const parsed = parseArgs(argv);
  if (parsed.command.kind === "help") {
    throw new CliError("help output is not available through executeCliInvocation", "failed");
  }
  if (parsed.command.kind === "serve") {
    throw new CliError("serve must be started through startVosHttpServer", "failed");
  }

  const projectRoot = path.resolve(parsed.global.projectRoot);
  return await withProjectEnv(projectRoot, async () => {
    if (parsed.command.kind !== "init" && !existsSync(path.join(projectRoot, "vos.yaml")) && isLegacyProject(projectRoot)) {
      await ensureDefaultProjectConfig(projectRoot);
    }
    const progress = createCommandProgress({
      mode: parsed.global.progress,
      json: parsed.global.json,
    });
    const command = commandToArray(parsed.command);
    const auth = await resolveAuthContext({
      projectRoot,
      command: parsed.command,
      commandArray: command,
      serveBinding: options.serveBinding,
      portalClient: options.portalClient ?? defaultPortalClient,
    });
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: parsed.global.evidenceDir ?? ".vos",
      command,
      args: argv.slice(2),
      auth: auth.auth,
      agentSessionId: parsed.global.agentSession,
      onEvent: options.onEvent,
      gitRev: currentHead(projectRoot),
      parentSha: parentSha(projectRoot),
    });
    const readonlyDisplay = startReadonlyDisplayForCommand(
      parsed.command,
      projectRoot,
      options.readonlyDisplayStarter,
    );
    progress.start(commandLabel(parsed.command), "starting");

    try {
      assertStudentCommandSurface(projectRoot, parsed.command);
      if (auth.blocked) {
        throw new CliError(`policy_blocked: ${auth.auth.reason ?? "policy_blocked"}`, "policy_blocked", {
          reason: auth.auth.reason,
        });
      }
      const repro = await resolveReproducibilityContext(projectRoot, parsed.command);
      const runMetadata = await collectRunMetadata(projectRoot, parsed.command);
      await evidence.setReproducibility({
        gitRev: repro.commitSha,
        parentSha: repro.parentSha,
        ledgerRef: repro.ledgerRef,
        ...runMetadata,
      });
      progress.update({ stage: commandLabel(parsed.command), status: "running", message: "running" });
      const outcome = await executeCommand(parsed.command, {
        projectRoot,
        global: parsed.global,
        evidence,
        progress,
        auth: auth.auth,
        effectivePolicy: auth.effectivePolicy,
        signal: options.signal,
        agentRunner: options.agentRunner,
        interactiveAgentRunner: options.interactiveAgentRunner,
        readonlyDisplay,
        portalClient: options.portalClient ?? defaultPortalClient,
      });
      if (options.signal?.aborted) {
        throw new CliError("cancelled", "cancelled", { reason: "cancelled" });
      }
      const finalOutput = await finalizeRun({
        parsed,
        evidence,
        outcome,
        progress,
        readonlyDisplay,
      });
      if (options.print ?? true) {
        printResult(finalOutput as unknown as Record<string, unknown>, parsed.global.json, parsed.global.verbose);
      }
      return finalOutput;
    } catch (error) {
      const status = options.signal?.aborted ? "cancelled" : classifyErrorStatus(error);
      const message = error instanceof Error ? error.message : "unknown error";
      readonlyDisplay?.error(message);
      readonlyDisplay?.close();
      const manifest = await evidence.finalize(status, { message });
      const finalOutput: BaseCommandResult = {
        ok: false,
        run_id: evidence.run_id,
        command: manifest.command,
        status,
        artifacts: manifest.artifacts,
        evidence_refs: manifest.evidence_refs,
        started_at: manifest.started_at,
        finished_at: manifest.finished_at,
        message,
        details: {
          error: true,
          ...(error instanceof CliError ? error.details ?? {} : {}),
        },
      };
      if (parsed.global.reportPath) {
        await writeFile(parsed.global.reportPath, `${JSON.stringify(finalOutput, null, 2)}\n`);
      }
      progress.finish(status, message);
      if (options.print ?? true) {
        printResult(finalOutput as unknown as Record<string, unknown>, parsed.global.json, parsed.global.verbose);
      }
      return finalOutput;
    }
  });
}

function assertStudentCommandSurface(projectRoot: string, command: CliCommand): void {
  if (isLegacyProject(projectRoot)) return;
  const removed = new Set<CliCommand["kind"]>([
    "stage_show", "stage_save", "toolchain_lint", "toolchain_init", "spec_normalize",
    "spec_check_consistency", "spec_patch_lint", "spec_patch_apply", "arch_lint", "arch_compose",
    "arch_derive_tests", "test", "trace_syscall", "debug_explain_log", "build_generate", "agent_serve",
    "agent_context", "agent_plan", "agent_generate", "agent_apply_patch", "agent_validate_generated",
    "agent_log",
  ]);
  const studentCommands = new Set<CliCommand["kind"]>([
    "init", "doctor", "spec_lint", "agent_config", "agent_implement", "agent_debug",
    "agent_verify", "agent_ask", "agent_review", "build", "run_qemu", "run_hardware", "verify",
    "report_generate", "submit_pack", "kb_add", "kb_list", "kb_search", "kb_remove", "kb_clear",
    "kb_export_manifest", "kb_import_manifest",
  ]);
  const hasStudentManifest = existsSync(path.join(projectRoot, "vos.yaml"));
  if (removed.has(command.kind)) {
    throw new CliError(`command removed from the student v2 surface: ${commandToArray(command).join(" ")}; use the documented student workflow`, "validation_failed", {
      reason: "student_command_removed",
      suggested_next_commands: ["vos agent config", "vos spec lint", "vos agent ask \"your question\"", "vos agent review"],
    });
  }
  if (!hasStudentManifest && !isLegacyProject(projectRoot) && studentCommands.has(command.kind) && command.kind !== "init" && command.kind !== "doctor") {
    throw new CliError("student project is not initialized; run `vos init` first", "validation_failed", {
      reason: "student_manifest_missing",
      suggested_next_commands: ["vos init", "vos doctor"],
    });
  }
  if (command.kind === "verify" && command.scope !== "public") {
    throw new CliError("student v2 verify has no legacy scope; it always runs public and contract checks", "validation_failed", { reason: "legacy_verify_scope" });
  }
}

/** Portal-bound legacy workspaces remain an internal frozen integration surface. */
function isPortalBoundProject(projectRoot: string): boolean {
  const metadataPath = path.join(projectRoot, ".vos", "project.yaml");
  if (!existsSync(metadataPath)) return false;
  const metadata = readFileSync(metadataPath, "utf8");
  return /^portal_url\s*:\s*\S+/m.test(metadata) && /^project_id\s*:\s*\S+/m.test(metadata);
}

/** Explicit legacy metadata is retained only for frozen Portal/fixture paths. */
function isLegacyProject(projectRoot: string): boolean {
  return isPortalBoundProject(projectRoot) || existsSync(path.join(projectRoot, ".vos", "project.yaml"));
}

export interface ExecuteVosCommandOptions {
  runId?: string;
  projectRoot: string;
  json?: boolean;
  progress?: "auto" | "always" | "never";
  agentSession?: string;
  reportPath?: string;
  evidenceDir?: string;
  portalClient?: PortalClient;
  agentRunner?: HeadlessAgentTaskRunner;
  interactiveAgentRunner?: InteractiveAgentTaskRunner;
  readonlyDisplayStarter?: ReadonlyAgentDisplayStarter;
  serveBinding?: {
    portalUrl: string;
    projectId: string;
    bearerToken?: string;
  };
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void | Promise<void>;
}

export function isVosCommand(command: CliCommand): command is VosCommand {
  return command.kind !== "help" &&
    command.kind !== "login" &&
    command.kind !== "logout" &&
    command.kind !== "whoami" &&
    command.kind !== "serve" &&
    command.kind !== "agent_serve";
}

function startReadonlyDisplayForCommand(
  command: CliCommand,
  projectRoot: string,
  starter: ReadonlyAgentDisplayStarter | undefined,
): ReadonlyAgentDisplayHandle | undefined {
  if (!usesReadonlyDisplay(command)) return undefined;
  return startAgentReadonlyDisplay({
    projectRoot,
    title: commandToArray(command).join(" "),
    starter,
  });
}

function usesReadonlyDisplay(command: CliCommand): boolean {
  if (!("display" in command) || command.display !== true) return false;
  if (command.kind === "agent_debug" && !command.logPath && !command.runId) return false;
  return true;
}

export async function executeVosCommand(
  command: VosCommand,
  options: ExecuteVosCommandOptions,
): Promise<BaseCommandResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const global = {
    projectRoot,
    json: options.json ?? true,
    verbose: false,
    progress: options.progress ?? "never",
    agentSession: options.agentSession,
    reportPath: options.reportPath,
    evidenceDir: options.evidenceDir,
  } satisfies ParsedInvocation["global"];
  const parsed = { global, command } satisfies ParsedInvocation;

  return await withProjectEnv(projectRoot, async () => {
    if (!existsSync(path.join(projectRoot, "vos.yaml")) && isLegacyProject(projectRoot)) await ensureDefaultProjectConfig(projectRoot);
    const progress = createSilentProgress();
    const commandArray = commandToArray(command);
    const auth = await resolveAuthContext({
      projectRoot,
      command,
      commandArray,
      serveBinding: options.serveBinding,
      portalClient: options.portalClient ?? defaultPortalClient,
    });
    const evidence = await EvidenceWriter.create({
      runId: options.runId,
      projectRoot,
      evidenceDir: options.evidenceDir ?? ".vos",
      command: commandArray,
      args: commandArray,
      auth: auth.auth,
      agentSessionId: options.agentSession,
      onEvent: options.onEvent,
      gitRev: currentHead(projectRoot),
      parentSha: parentSha(projectRoot),
    });
    const readonlyDisplay = startReadonlyDisplayForCommand(
      command,
      projectRoot,
      options.readonlyDisplayStarter,
    );

    try {
      if (auth.blocked) {
        throw new CliError(`policy_blocked: ${auth.auth.reason ?? "policy_blocked"}`, "policy_blocked", {
          reason: auth.auth.reason,
        });
      }
      const repro = await resolveReproducibilityContext(projectRoot, command);
      const runMetadata = await collectRunMetadata(projectRoot, command);
      await evidence.setReproducibility({
        gitRev: repro.commitSha,
        parentSha: repro.parentSha,
        ledgerRef: repro.ledgerRef,
        ...runMetadata,
      });
      const outcome = await executeCommand(command, {
        projectRoot,
        global,
        evidence,
        progress,
        auth: auth.auth,
        effectivePolicy: auth.effectivePolicy,
        signal: options.signal,
        agentRunner: options.agentRunner,
        interactiveAgentRunner: options.interactiveAgentRunner,
        readonlyDisplay,
        portalClient: options.portalClient ?? defaultPortalClient,
      });
      if (options.signal?.aborted) {
        throw new CliError("cancelled", "cancelled", { reason: "cancelled" });
      }
      return await finalizeRun({ parsed, evidence, outcome, progress, readonlyDisplay });
    } catch (error) {
      const status = options.signal?.aborted ? "cancelled" : classifyErrorStatus(error);
      const message = error instanceof Error ? error.message : "unknown error";
      readonlyDisplay?.error(message);
      readonlyDisplay?.close();
      const manifest = await evidence.finalize(status, { message });
      progress.finish(status, message);
      return {
        ok: false,
        run_id: evidence.run_id,
        command: manifest.command,
        status,
        artifacts: manifest.artifacts,
        evidence_refs: manifest.evidence_refs,
        started_at: manifest.started_at,
        finished_at: manifest.finished_at,
        message,
        details: {
          error: true,
          ...(error instanceof CliError ? error.details ?? {} : {}),
        },
      };
    }
  });
}

function createSilentProgress(): CommandProgress {
  return {
    mode: "always",
    enabled: true,
    start() { },
    update() { },
    finish() { },
    hide() { },
  };
}

async function finalizeRun(params: {
  parsed: ParsedInvocation;
  evidence: EvidenceWriter;
  outcome: CommandOutcome;
  progress: CommandProgress;
  readonlyDisplay?: ReadonlyAgentDisplayHandle;
}): Promise<BaseCommandResult> {
  const manifest = await params.evidence.finalize(params.outcome.status, {
    message: typeof params.outcome.details.message === "string" ? params.outcome.details.message : undefined,
  });
  const finalOutput: BaseCommandResult = {
    ok: isSuccessStatus(params.outcome.status),
    run_id: params.evidence.run_id,
    command: manifest.command,
    status: manifest.status,
    artifacts: manifest.artifacts,
    evidence_refs: manifest.evidence_refs,
    started_at: manifest.started_at,
    finished_at: manifest.finished_at,
    message: (params.outcome.details.message as string | undefined) ?? "ok",
    details: params.outcome.details,
  };
  if (params.parsed.command.kind === "report_generate" && isSuccessStatus(params.outcome.status) && !existsSync(path.join(manifest.project_root, "vos.yaml"))) {
    const commit = await commitGeneratedReport({
      projectRoot: manifest.project_root,
      runId: params.evidence.run_id,
      details: params.outcome.details,
      artifacts: manifest.artifacts.map((artifact) => artifact.path),
      evidenceRefs: manifest.evidence_refs,
      final: params.parsed.command.final,
      stage: params.parsed.command.stage,
      agentSessionId: params.parsed.global.agentSession,
    });
    finalOutput.details = {
      ...finalOutput.details,
      commit_sha: commit.commitSha,
      ledger_ref: commit.ledgerRef,
    };
  }
  if (params.parsed.global.reportPath) {
    await writeFile(params.parsed.global.reportPath, `${JSON.stringify(finalOutput, null, 2)}\n`);
  }
  params.progress.finish(params.outcome.status, typeof params.outcome.details.message === "string" ? params.outcome.details.message : undefined);
  params.readonlyDisplay?.progress({
    stage: commandLabel(params.parsed.command),
    status: isSuccessStatus(params.outcome.status) ? "completed" : params.outcome.status,
    message: finalOutput.message,
    percent: 100,
  });
  params.readonlyDisplay?.close();
  return finalOutput;
}

async function commitGeneratedReport(params: {
  projectRoot: string;
  runId: string;
  details: Record<string, unknown>;
  artifacts: string[];
  evidenceRefs: import("./evidence/manifest.ts").EvidenceRef[];
  final: boolean;
  stage?: string;
  agentSessionId?: string;
}): Promise<{ commitSha: string; ledgerRef: string }> {
  const changedTargets = collectStringArray(params.details.changed_targets);
  if (changedTargets.length === 0) {
    throw new CliError("report generate did not return changed targets for commit", "failed");
  }
  const toAdd = [
    ...changedTargets,
    ".vos/index/evidence.json",
    ".vos/commit-ledger.jsonl",
    ...params.artifacts,
  ].filter((entry) => existsSync(path.join(params.projectRoot, entry)));
  git(params.projectRoot, ["add", "-f", ...[...new Set(toAdd)]]);
  const title = params.final ? "final" : (params.stage ?? "stage");
  git(params.projectRoot, ["commit", "-m", `[vos][report] Generate ${title} report`]);
  const commitSha = currentHead(params.projectRoot);
  if (!commitSha) {
    throw new CliError("report generate commit did not produce a HEAD commit", "failed");
  }
  await appendLedgerEntry(params.projectRoot, {
    commit_sha: commitSha,
    parent_sha: parentSha(params.projectRoot),
    actor: "human",
    agent_session_id: params.agentSessionId,
    run_id: params.runId,
    spec_refs: collectStringArray(params.details.spec_refs),
    changed_targets: [...new Set([...changedTargets, ".vos/commit-ledger.jsonl"])],
    evidence_refs: params.evidenceRefs,
    collaboration_intent: params.final ? "generate final course report" : `generate ${params.stage ?? "stage"} course report`,
    based_on_agent_output: true,
  });
  return {
    commitSha,
    ledgerRef: `.vos/commit-ledger.jsonl#${commitSha}`,
  };
}

async function resolveAuthContext(params: {
  projectRoot: string;
  command: CliCommand;
  commandArray: string[];
  serveBinding?: { portalUrl: string; projectId: string; bearerToken?: string };
  portalClient: PortalClient;
}): Promise<{
  auth: RunAuthContext;
  effectivePolicy: EffectivePolicy;
  blocked: boolean;
}> {
  const localPolicy = await loadPolicyConfig(params.projectRoot);
  const localOnlyPolicy = mergeEffectivePolicy({ local: localPolicy });
  if (isAuthBypassCommand(params.command)) {
    return {
      auth: { verdict: "not_required", checkedAt: new Date().toISOString() },
      effectivePolicy: localOnlyPolicy,
      blocked: false,
    };
  }

  const project: { portal_url?: string; project_id?: string } = isLegacyProject(params.projectRoot)
    ? await loadProjectConfig(params.projectRoot)
    : {};
  const portalUrl = params.serveBinding?.portalUrl ?? project.portal_url;
  const projectId = params.serveBinding?.projectId ?? project.project_id;
  if (!portalUrl) {
    return {
      auth: { verdict: "not_required", checkedAt: new Date().toISOString(), projectId },
      effectivePolicy: localOnlyPolicy,
      blocked: false,
    };
  }
  if (!projectId) {
    return {
      auth: {
        verdict: "denied",
        reason: "policy_unavailable",
        portalUrl: normalizePortalUrl(portalUrl),
        checkedAt: new Date().toISOString(),
      },
      effectivePolicy: localOnlyPolicy,
      blocked: true,
    };
  }

  const bearerToken = params.serveBinding?.bearerToken;
  const stored = bearerToken ? undefined : await getToken(portalUrl);
  const token = bearerToken ?? stored?.token;
  if (!token) {
    return {
      auth: {
        verdict: "denied",
        reason: "not_logged_in",
        portalUrl: normalizePortalUrl(portalUrl),
        projectId,
        checkedAt: new Date().toISOString(),
      },
      effectivePolicy: localOnlyPolicy,
      blocked: true,
    };
  }

  try {
    const user = await params.portalClient.getMe(portalUrl, token);
    const policy = await params.portalClient.getProjectPolicy(portalUrl, projectId, token);
    if (policy.expiresAt && Date.parse(policy.expiresAt) <= Date.now()) {
      throw new CliError("policy_blocked: policy snapshot expired", "policy_blocked", { reason: "policy_expired" });
    }
    if (!bearerToken) {
      await updateStoredUser(portalUrl, user);
    }
    const effectivePolicy = mergeEffectivePolicy({ portal: policy, local: localPolicy });
    assertCommandAllowed(params.commandArray, effectivePolicy, localPolicy);
    return {
      auth: {
        verdict: "allowed",
        portalUrl: normalizePortalUrl(portalUrl),
        projectId,
        user,
        policySnapshot: policy,
        checkedAt: new Date().toISOString(),
      },
      effectivePolicy,
      blocked: false,
    };
  } catch (error) {
    const reason = error instanceof CliError && typeof error.details?.reason === "string"
      ? error.details.reason
      : error instanceof CliError && error.status === "policy_blocked"
        ? "command_denied"
        : "policy_unavailable";
    return {
      auth: {
        verdict: "denied",
        reason,
        portalUrl: normalizePortalUrl(portalUrl),
        projectId,
        checkedAt: new Date().toISOString(),
      },
      effectivePolicy: localOnlyPolicy,
      blocked: true,
    };
  }
}

function isAuthBypassCommand(command: CliCommand): boolean {
  return command.kind === "login" ||
    command.kind === "logout" ||
    command.kind === "whoami" ||
    command.kind === "init" ||
    command.kind === "stage_save" ||
    command.kind === "ledger_record" ||
    command.kind === "help";
}

async function resolveReproducibilityContext(
  projectRoot: string,
  command: CliCommand,
): Promise<{ commitSha?: string; parentSha?: string; ledgerRef?: string }> {
  if (existsSync(path.join(projectRoot, "vos.yaml")) && (command.kind === "build" || command.kind === "run_qemu" || command.kind === "run_hardware")) {
    return await resolveOptionalReproducibilityContext(projectRoot);
  }
  if (isReproBypassCommand(command)) {
    return {
      commitSha: currentHead(projectRoot),
      parentSha: parentSha(projectRoot),
    };
  }
  if (!isReproControlledCommand(command)) {
    return await resolveOptionalReproducibilityContext(projectRoot);
  }
  if (!isLegacyProject(projectRoot)) {
    const current = await checkReproducibility(projectRoot);
    if (!current.ok && current.reason === "ledger_missing") {
      const changedTargets = git(projectRoot, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      await ensureHeadLedgerEntry({
        projectRoot,
        actor: "human",
        intent: `record manually committed student state before ${commandLabel(command)}`,
        changedTargets,
      });
    }
  }
  const verdict = await assertReproducible(projectRoot);
  return {
    commitSha: verdict.commitSha,
    parentSha: verdict.parentSha,
    ledgerRef: verdict.ledgerRef,
  };
}

async function resolveOptionalReproducibilityContext(
  projectRoot: string,
): Promise<{ commitSha?: string; parentSha?: string; ledgerRef?: string }> {
  const verdict = await checkReproducibility(projectRoot);
  if (verdict.ok) {
    return {
      commitSha: verdict.commitSha,
      parentSha: verdict.parentSha,
      ledgerRef: verdict.ledgerRef,
    };
  }
  return {
    commitSha: currentHead(projectRoot),
    parentSha: parentSha(projectRoot),
  };
}

async function collectRunMetadata(projectRoot: string, command: CliCommand): Promise<{
  specHash?: string;
  inputFiles?: string[];
  outputFiles?: string[];
  testsRun?: string[];
}> {
  if (isAuthBypassCommand(command)) {
    return {};
  }
  if (existsSync(path.join(projectRoot, "vos.yaml"))) {
    const manifestText = await readFile(path.join(projectRoot, "vos.yaml"), "utf8");
    const studentBundle = await buildNormalizedSpecBundle({ projectRoot });
    return {
      specHash: hashString(JSON.stringify(studentBundle.hashes)),
      inputFiles: ["vos.yaml", ...studentBundle.sources.map((source) => source.path)],
      outputFiles: studentBundle.manifest?.artifacts ?? [],
      testsRun: command.kind === "verify" || command.kind === "agent_verify" ? studentBundle.manifest?.checks.map((check) => check.id) : [],
      ...(manifestText.length === 0 ? { specHash: undefined } : {}),
    };
  }
  const specHash = await computeToolchainSpecHash(projectRoot);
  const metadata: {
    specHash?: string;
    inputFiles?: string[];
    outputFiles?: string[];
    testsRun?: string[];
  } = {
    specHash,
  };
  const manifestPath = await resolveToolchainManifestPath({ projectRoot }).catch(() => undefined);
  if (!manifestPath || !existsSync(manifestPath)) {
    return metadata;
  }
  const raw = await readFile(manifestPath, "utf8").catch(() => undefined);
  const manifest = raw ? safeJsonTryParse(raw) as Record<string, unknown> | undefined : undefined;
  if (!manifest || typeof manifest !== "object") {
    return metadata;
  }
  const files = collectStringArray(manifest.files);
  metadata.inputFiles = [...new Set([".vos/toolchain.json", ...files])];
  metadata.outputFiles = collectManifestOutputFiles(manifest);
  metadata.testsRun = collectManifestTests(command, manifest);
  metadata.specHash = typeof manifest.spec_hash === "string" && manifest.spec_hash.trim()
    ? manifest.spec_hash.trim()
    : metadata.specHash;
  return metadata;
}

async function computeToolchainSpecHash(projectRoot: string): Promise<string | undefined> {
  const specRoot = path.join(projectRoot, "spec", "toolchain");
  if (!existsSync(specRoot)) return undefined;
  const files = await listFiles(specRoot);
  if (files.length === 0) return undefined;
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    const rel = path.relative(projectRoot, file).replace(/\\/g, "/");
    hash.update(rel);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function collectManifestOutputFiles(manifest: Record<string, unknown>): string[] {
  const variants = (manifest.build as { variants?: Array<{ artifacts?: unknown }> } | undefined)?.variants ?? [];
  const out = variants.flatMap((variant) => collectStringArray(variant.artifacts));
  return [...new Set(out)];
}

function collectManifestTests(command: CliCommand, manifest: Record<string, unknown>): string[] {
  if (command.kind !== "test" && !(command.kind === "verify" && command.scope === "public")) {
    return [];
  }
  if (command.kind === "test" && command.suites.length > 0) {
    return [...command.suites];
  }
  const suites = (manifest.test as { suites?: unknown } | undefined)?.suites;
  if (Array.isArray(suites)) {
    return suites
      .map((suite) => suite && typeof suite === "object" ? (suite as { name?: unknown }).name : undefined)
      .filter((name): name is string => typeof name === "string");
  }
  return collectStringArray(manifest.tests);
}

function isReproBypassCommand(command: CliCommand): boolean {
  return command.kind === "login" ||
    command.kind === "logout" ||
    command.kind === "whoami" ||
    command.kind === "help" ||
    command.kind === "init" ||
    command.kind === "agent_config" ||
    command.kind === "stage_save" ||
    command.kind === "ledger_record";
}

function isReproControlledCommand(command: CliCommand): boolean {
  switch (command.kind) {
    case "build":
      return !command.dryRun;
    case "run_qemu":
      return !command.dryRun && !command.listProfiles && !command.listCases;
    case "run_hardware":
      return !command.dryRun;
    case "test":
      return !command.dryRun;
    case "verify":
      return !command.dryRun;
    case "trace_syscall":
      return !command.dryRun;
    case "build_generate":
    case "spec_patch_apply":
    case "toolchain_init":
    case "agent_generate":
    case "agent_implement":
    case "agent_verify":
    case "agent_apply_patch":
    case "agent_validate_generated":
    case "submit_pack":
    case "report_generate":
      return true;
    default:
      return false;
  }
}

export async function executeInit(
  _command: InitCommand,
  context: ExecContext,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const studentFiles = INIT_COMMIT_TARGETS;
  const initialFileSnapshots = snapshotInitCommitTargets(projectRoot, studentFiles);
  await ensureStudentProjectFiles(projectRoot);
  const evidence = context.evidence;
  const gitInitialized = ensureProjectGitRepository(projectRoot);
  const initialCommitTargets = changedInitCommitTargets(projectRoot, initialFileSnapshots, studentFiles);
  const initialCommitCreated = currentHead(projectRoot)
    ? false
    : createInitialProjectCommit(projectRoot, initialCommitTargets);
  await ensureHeadLedgerEntry({
    projectRoot,
    actor: "human",
    intent: "initialize VOS project ledger",
    specRefs: [],
    changedTargets: studentFiles,
    runId: evidence.run_id,
  });
  return {
    status: "passed",
    details: {
      initialized: true,
      ledger: true,
      git_initialized: gitInitialized,
      initial_commit_created: initialCommitCreated,
      suggested_next_commands: ["vos agent config", "vos doctor", "vos agent ask", "vos spec lint design"],
    },
  };
}

type InitFileSnapshot = Record<string, string | undefined>;

const INIT_COMMIT_TARGETS = [
  ".gitignore",
  "vos.yaml",
  "spec/design.yaml",
  "spec/modules/toolchain.yaml",
];

function snapshotInitCommitTargets(projectRoot: string, targets = INIT_COMMIT_TARGETS): InitFileSnapshot {
  const snapshots: InitFileSnapshot = {};
  for (const target of targets) {
    const filePath = path.join(projectRoot, target);
    snapshots[target] = existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined;
  }
  return snapshots;
}

function changedInitCommitTargets(projectRoot: string, snapshots: InitFileSnapshot, targets = INIT_COMMIT_TARGETS): string[] {
  return targets.filter((target) => {
    const filePath = path.join(projectRoot, target);
    if (!existsSync(filePath)) return false;
    return readFileSync(filePath, "utf8") !== snapshots[target];
  });
}

async function ensureStudentProjectFiles(projectRoot: string): Promise<void> {
  await mkdir(path.join(projectRoot, "spec", "modules"), { recursive: true });
  await mkdir(path.join(projectRoot, "spec", "interfaces"), { recursive: true });
  await mkdir(path.join(projectRoot, "spec", "goals"), { recursive: true });
  await mkdir(path.join(projectRoot, "spec", "patches"), { recursive: true });
  const files: Record<string, string> = {
    "spec/design.yaml": [
      "# VOS DesignSpec. Discuss choices with `vos agent ask`, then replace every TODO by hand.",
      "system:",
      "  name: student-os",
      "  language: TODO",
      "  isa: TODO",
      "machine:",
      "  qemu: {}",
      "  hardware: {}",
      "kernel:",
      "  organization: TODO",
      "  execution: TODO",
      "  protection: TODO",
      "  communication: TODO",
      "  resource_model: TODO",
      "required_mechanisms: []",
      "composition_invariants: []",
      "non_goals: []",
      "hardware_port:",
      "  board: TODO",
      "  boot: TODO",
      "  console: TODO",
      "  interrupt: TODO",
      "",
    ].join("\n"),
    "spec/modules/toolchain.yaml": [
      "id: toolchain",
      "module: toolchain",
      "level: 1",
      "purpose: Own the student build, runner, and contract commands.",
      "owns:",
      "  - vos.yaml",
      "  - Makefile",
      "  - xtask",
      "  - tests/toolchain",
      "interface: []",
      "properties: []",
      "errors: []",
      "",
    ].join("\n"),
    "vos.yaml": [
      "version: vos.project.v1",
      "build:",
      "  program: bun",
      "  args: [--version]",
      "  cwd: .",
      "  env: []",
      "  timeout: 30000",
      "  artifacts: []",
      "runners:",
      "  qemu:",
      "    program: bun",
      "    args: [--version]",
      "    cwd: .",
      "    env: []",
      "    timeout: 30000",
      "    artifacts: []",
      "  hardware:",
      "    program: bun",
      "    args: [--version]",
      "    cwd: .",
      "    env: []",
      "    timeout: 30000",
      "    artifacts: []",
      "checks:",
      "  public-toolchain:",
      "    program: bun",
      "    args: [--version]",
      "    cwd: .",
      "    env: []",
      "    timeout: 30000",
      "    verifies: [toolchain]",
      "  contract-toolchain:",
      "    program: bun",
      "    args: [--version]",
      "    cwd: .",
      "    env: []",
      "    timeout: 30000",
      "    verifies: [toolchain]",
      "",
    ].join("\n"),
  };
  for (const [relative, content] of Object.entries(files)) {
    const filePath = path.join(projectRoot, relative);
    if (!existsSync(filePath)) await writeFile(filePath, content);
  }
  const gitignore = path.join(projectRoot, ".gitignore");
  const existing = existsSync(gitignore) ? await readFile(gitignore, "utf8") : "";
  const lines = existing.split(/\r?\n/).filter(Boolean);
  const additions = [".vos/", ".env", "build/", "fs.img"];
  const missing = additions.filter((entry) => !lines.includes(entry));
  if (missing.length > 0) await writeFile(gitignore, `${existing.replace(/\s*$/, "")}${existing.trim() ? "\n" : ""}${missing.join("\n")}\n`);
}

function ensureProjectGitRepository(projectRoot: string): boolean {
  if (gitInitMaybe(projectRoot, ["rev-parse", "--is-inside-work-tree"]).ok) {
    return false;
  }
  const result = gitInitMaybe(projectRoot, ["init"]);
  if (!result.ok) {
    throw new CliError(`git init failed: ${result.stderr.trim()}`, "failed");
  }
  return true;
}

function createInitialProjectCommit(projectRoot: string, targets: string[]): boolean {
  if (!hasGitIdentity(projectRoot)) {
    throw new CliError(
      "git identity is required before vos init can create the initial commit",
      "policy_blocked",
      {
        reason: "git_identity_missing",
        suggested_next_commands: [
          "git config user.name \"Your Name\"",
          "git config user.email \"you@example.com\"",
          "vos init",
        ],
      },
    );
  }

  if (targets.length > 0) {
    const add = gitInitMaybe(projectRoot, ["add", "--", ...targets]);
    if (!add.ok) {
      throw new CliError(`git add failed: ${add.stderr.trim()}`, "failed");
    }
  }
  const commitArgs = targets.length > 0
    ? ["commit", "-m", "[vos][init] Initialize VOS project"]
    : ["commit", "--allow-empty", "-m", "[vos][init] Initialize VOS project"];
  const commit = gitInitMaybe(projectRoot, commitArgs);
  if (!commit.ok) {
    throw new CliError(`git commit failed: ${commit.stderr.trim()}`, "failed");
  }
  return true;
}

function hasGitIdentity(projectRoot: string): boolean {
  const name = firstNonEmpty(
    process.env.GIT_COMMITTER_NAME,
    process.env.GIT_AUTHOR_NAME,
    gitConfigValue(projectRoot, "user.name"),
  );
  const email = firstNonEmpty(
    process.env.GIT_COMMITTER_EMAIL,
    process.env.GIT_AUTHOR_EMAIL,
    gitConfigValue(projectRoot, "user.email"),
  );
  return Boolean(name && email);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function gitConfigValue(projectRoot: string, key: string): string | undefined {
  const result = gitInitMaybe(projectRoot, ["config", "--get", key]);
  return result.ok ? result.stdout.trim() || undefined : undefined;
}

function gitInitMaybe(projectRoot: string, args: string[]): { ok: true; stdout: string; stderr: string } | { ok: false; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: projectRoot,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const result = {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
  return proc.exitCode === 0 ? { ok: true, ...result } : { ok: false, ...result };
}

export async function executeDoctor(
  _command: DoctorCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  if (!existsSync(path.join(projectRoot, "vos.yaml")) && !existsSync(path.join(projectRoot, "spec", "design.yaml")) && !isLegacyProject(projectRoot)) {
    return executeUninitializedStudentDoctor(projectRoot);
  }
  if (existsSync(path.join(projectRoot, "vos.yaml")) || existsSync(path.join(projectRoot, "spec", "design.yaml"))) {
    return executeStudentDoctor(context, evidence);
  }
  const checks: DoctorCheck[] = [
    doctorCommandCheck("bun", "base", typeof Bun !== "undefined"),
    doctorCommandCheck("git", "base"),
    doctorCommandCheck("node", "base"),
  ];
  const requiredCommands = new Set(["bun", "git", "node"]);
  const suggested = new Set<string>();

  const projectPath = path.join(projectRoot, ".vos", "project.yaml");
  const policyPath = path.join(projectRoot, ".vos", "policy.yaml");
  checks.push(doctorFileCheck("project-config", "project", projectPath, "run `vos init` to create project metadata"));
  checks.push(doctorFileCheck("policy-config", "project", policyPath, "run `vos init` to create default policy metadata"));
  let currentStage: string | undefined;
  try {
    const project = await loadProjectConfig(projectRoot);
    currentStage = project.current_stage;
    const specRoot = project.spec_root ?? "spec";
    checks.push(doctorFileCheck("spec-root", "project", path.resolve(projectRoot, specRoot), "create the configured spec root or update .vos/project.yaml"));
  } catch (error) {
    checks.push({
      name: "spec-root",
      category: "project",
      required: true,
      ok: false,
      message: errorMessage(error),
      hint: "run `vos init` to create project metadata",
    });
  }

  let manifest: ToolchainManifestV2 | undefined;
  const requiresToolchainManifest = currentStage !== "architecture-seed";
  try {
    const loaded = await loadToolchainManifest({ projectRoot });
    manifest = loaded.manifest;
    checks.push({
      name: "toolchain-manifest",
      category: "toolchain",
      required: true,
      ok: true,
      message: path.relative(projectRoot, loaded.path),
    });
  } catch (error) {
    checks.push({
      name: "toolchain-manifest",
      category: "toolchain",
      required: requiresToolchainManifest,
      ok: false,
      message: errorMessage(error),
      hint: requiresToolchainManifest ? "run `vos build generate` to create .vos/toolchain.json" : "toolchain manifest is optional during architecture-seed",
    });
    if (requiresToolchainManifest) {
      suggested.add("vos build generate");
    }
  }

  if (manifest) {
    for (const tool of manifest.environment.required_tools) {
      requiredCommands.add(tool.command);
      checks.push(probeRequiredToolCheck(tool));
    }
    for (const command of manifestCommandEntrypoints(manifest)) {
      requiredCommands.add(command);
      checks.push(doctorCommandCheck(command, "toolchain-command"));
    }
  }

  for (const command of OPTIONAL_TOOL_COMMANDS) {
    if (!requiredCommands.has(command)) {
      checks.push(doctorCommandCheck(command, "optional-tools", undefined, false));
    }
  }

  const missing = checks.filter((check) => check.required && !check.ok).map((check) => check.name);
  const warnings = checks
    .filter((check) => !check.required && !check.ok)
    .map((check) => check.name);
  if (missing.length > 0) {
    suggested.add("install missing tools, then rerun `vos doctor`");
  }
  return {
    status: missing.length === 0 ? "passed" : "failed",
    details: {
      checks,
      missing,
      warnings,
      suggested_next_commands: [...suggested],
      message: missing.length === 0 ? "environment ok" : "missing required tools/configuration",
    },
  };
}

function executeUninitializedStudentDoctor(projectRoot: string): CommandOutcome {
  const checks = [
    { name: "bun", category: "base", required: true, ok: commandExists("bun"), hint: "install Bun and rerun `vos doctor`" },
    { name: "git", category: "base", required: true, ok: commandExists("git"), hint: "install Git and rerun `vos doctor`" },
    { name: "vos.yaml", category: "project", required: true, ok: false, hint: "run `vos init`" },
    { name: "spec/design.yaml", category: "project", required: true, ok: false, hint: "run `vos init`" },
    { name: "spec/modules/toolchain.yaml", category: "project", required: true, ok: false, hint: "run `vos init`" },
  ];
  return {
    status: "validation_failed",
    details: {
      checks,
      missing: checks.filter((check) => check.required && !check.ok).map((check) => check.name),
      suggested_next_commands: ["vos init"],
      message: `student project is not initialized at ${studentRelativePath(projectRoot, projectRoot) || "."}; run \`vos init\``,
    },
  };
}

async function executeStudentDoctor(context: ExecContext, evidence: EvidenceWriter): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const checks: Array<Record<string, unknown>> = [];
  let requireEmbedding = false;
  let manifestValue: unknown;
  for (const command of ["bun", "git"]) {
    checks.push({ name: command, category: "base", required: true, ok: commandExists(command), hint: commandExists(command) ? undefined : `install ${command} and rerun vos doctor` });
  }
  for (const relative of ["vos.yaml", "spec/design.yaml", "spec/modules/toolchain.yaml"]) {
    checks.push({ name: relative, category: "project", required: true, ok: existsSync(path.join(projectRoot, relative)), hint: `run vos init to create ${relative}` });
  }
  try {
    const manifest = await readStudentManifest(projectRoot);
    manifestValue = manifest.manifest;
    checks.push({ name: "manifest-schema", category: "project", required: true, ok: true, message: path.relative(projectRoot, manifest.path) });
    const kbSources = await listKbSources(projectRoot);
    requireEmbedding = kbSources.length > 0;
    checks.push({ name: "kb-sources", category: "knowledge", required: false, ok: true, message: `${kbSources.length} source(s) indexed` });
    for (const [id, target] of Object.entries(manifest.manifest.checks)) {
      checks.push({ name: `check:${id}`, category: "contract", required: true, ok: commandExists(target.program), command: target.program, hint: commandExists(target.program) ? undefined : `install ${target.program} or update vos.yaml` });
    }
  } catch (error) {
    checks.push({ name: "manifest-schema", category: "project", required: true, ok: false, message: errorMessage(error), hint: "fix vos.yaml schema errors, then rerun vos doctor" });
  }
  for (const check of checkAgentConfig(projectRoot, mergedProjectEnv(projectRoot), { requireEmbedding })) {
    checks.push({
      ...check,
      category: check.name === "kb-embedding" ? "knowledge" : "agent",
      required: false,
    });
  }
  const bundle = await buildNormalizedSpecBundle({ projectRoot });
  checks.push({ name: "spec-contract", category: "spec", required: true, ok: !hasBlockingDiagnostics(bundle.diagnostics), message: `${bundle.diagnostics.length} diagnostic(s)`, hint: "run vos spec lint for exact diagnostics" });

  const before = await studentGitFingerprint(projectRoot);
  let diagnosis: DoctorDiagnosis | undefined;
  let diagnosisWarning: string | undefined;
  try {
    const agentProgress = createAgentProgressParams(context, "doctor debug agent");
    const response = await runAgentWithPrompt({
      projectRoot,
      taskPrompt: agentProgress.taskPrompt([
        "Act as the VOS Doctor Debug Agent. Read every Spec, vos.yaml, the project tree, and the deterministic diagnostics provided in context.",
        "Infer the host command-line tools required by this concrete project and distinguish required from optional tools using explicit Spec references.",
        "For every tool, use the Bash tool to run bounded version, target, compile, or runtime capability probes. Return each Bash tool-call id in probe_ids; a conclusion without matching Bash evidence is invalid.",
        "Do not install or download anything, invoke a package manager, change system configuration, or modify project files. You may write temporary probe output only under .vos/doctor/.",
        "Give platform-appropriate installation suggestions as advice only. Prompt policy, Git checks, and audit logs are not a host security boundary.",
      ].join("\n")),
      taskKind: "doctor",
      requestedScope: "doctor:student-project",
      context: {
        specs: studentSpecContext(bundle),
        manifest: manifestValue,
        deterministic_checks: checks,
        deterministic_diagnostics: bundle.diagnostics,
        platform: { os: process.platform, arch: process.arch },
        probe_directory: `.vos/doctor/${evidence.run_id}`,
      },
      courseMode: true,
      toolPolicy: doctorToolPolicy(),
      allowedVosCommands: await loadAgentAllowedCommands(projectRoot, context.effectivePolicy),
      resultSubmissionSchema: "doctor_diagnosis.v1",
      extraMcpServers: agentProgress.extraMcpServers,
      onEvent: agentProgress.onEvent,
      taskRunner: context.agentRunner,
    });
    diagnosis = parseDoctorDiagnosis(agentStructuredOutput(response, "doctor"), response.rawEvents);
  } catch (error) {
    diagnosisWarning = `Debug Agent unavailable: ${errorMessage(error)}`;
  }

  const after = await studentGitFingerprint(projectRoot);
  if (after.fingerprint !== before.fingerprint) {
    checks.push({
      name: "doctor-readonly",
      category: "agent",
      required: true,
      ok: false,
      message: "Debug Agent modified project files",
      evidence: after.changed,
    });
  } else {
    checks.push({ name: "doctor-readonly", category: "agent", required: true, ok: true });
  }

  if (diagnosis) {
    for (const tool of diagnosis.tools) {
      checks.push({
        name: `agent-tool:${tool.program}`,
        category: "agent-tool",
        required: tool.required,
        ok: tool.status === "installed",
        message: tool.purpose,
        spec_refs: tool.spec_refs,
        probe_ids: tool.probe_ids,
        suggestions: tool.suggestions,
      });
    }
  } else {
    checks.push({
      name: "agent-tool-diagnosis",
      category: "agent",
      required: false,
      ok: false,
      message: diagnosisWarning ?? "Debug Agent diagnosis unavailable",
      hint: "deterministic doctor results remain valid; configure the Agent provider and rerun vos doctor",
    });
  }

  const doctorDirectory = path.join(projectRoot, ".vos", "doctor", evidence.run_id);
  await mkdir(doctorDirectory, { recursive: true });
  const diagnosisPath = path.join(doctorDirectory, "diagnosis.json");
  await writeFile(diagnosisPath, `${JSON.stringify({ diagnosis: diagnosis ?? null, warning: diagnosisWarning ?? null, checks }, null, 2)}\n`);
  evidence.addArtifactFromPath("doctor", diagnosisPath, "student doctor diagnosis");

  const missing = checks.filter((check) => check.required && check.ok !== true).map((check) => String(check.name));
  return {
    status: missing.length === 0 ? "passed" : "validation_failed",
    details: {
      checks,
      missing,
      warnings: checks.filter((check) => !check.required && check.ok !== true).map((check) => String(check.name)),
      diagnosis: diagnosis ?? { status: "unavailable", warning: diagnosisWarning },
      evidence: studentRelativePath(projectRoot, diagnosisPath),
      suggested_next_commands: missing.length > 0
        ? ["vos spec lint", "vos agent review"]
        : ["vos build", "vos verify"],
    },
  };
}

interface DoctorDiagnosisTool {
  program: string;
  purpose: string;
  required: boolean;
  status: "installed" | "missing" | "failed";
  spec_refs: string[];
  probe_ids: string[];
  suggestions: string[];
}

interface DoctorDiagnosis {
  summary: string;
  tools: DoctorDiagnosisTool[];
  limitations: string[];
}

function parseDoctorDiagnosis(value: unknown, events: Array<Record<string, unknown>>): DoctorDiagnosis {
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.tools) || !Array.isArray(value.limitations) || !value.limitations.every((item) => typeof item === "string")) {
    throw new AgentOutputError("doctor diagnosis does not match doctor_diagnosis.v1");
  }
  const bashResults = new Set(events.flatMap((event) => {
    if (event.type !== "tool.result" || event.name !== "Bash" || typeof event.toolCallId !== "string") return [];
    return [event.toolCallId];
  }));
  const tools = value.tools.map((raw, index): DoctorDiagnosisTool => {
    if (!isRecord(raw) || typeof raw.program !== "string" || typeof raw.purpose !== "string" || typeof raw.required !== "boolean" ||
      !["installed", "missing", "failed"].includes(String(raw.status)) || !Array.isArray(raw.spec_refs) || !raw.spec_refs.every((item) => typeof item === "string") ||
      !Array.isArray(raw.probe_ids) || !raw.probe_ids.every((item) => typeof item === "string") || !Array.isArray(raw.suggestions) || !raw.suggestions.every((item) => typeof item === "string")) {
      throw new AgentOutputError(`doctor diagnosis tool ${index} is invalid`);
    }
    if (raw.spec_refs.length === 0) throw new AgentOutputError(`doctor diagnosis tool ${raw.program} has no Spec basis`);
    if (raw.probe_ids.length === 0 || raw.probe_ids.some((id) => !bashResults.has(id))) {
      throw new AgentOutputError(`doctor diagnosis tool ${raw.program} is not bound to actual Bash evidence`);
    }
    return raw as unknown as DoctorDiagnosisTool;
  });
  return { summary: value.summary, tools, limitations: value.limitations as string[] };
}

function doctorToolPolicy() {
  return {
    canExecute(request: { name: string; argumentsJson: string }) {
      if (request.name !== "Bash") return { allowed: true as const };
      let command = request.argumentsJson;
      try {
        const parsed = JSON.parse(request.argumentsJson) as Record<string, unknown>;
        if (typeof parsed.command === "string") command = parsed.command;
      } catch {
        return { allowed: false as const, reason: "doctor Bash arguments must be valid JSON" };
      }
      const mutating = /(?:^|[;&|]\s*)(?:sudo\s+)?(?:apt(?:-get)?|dnf|yum|pacman|zypper|apk|brew|winget|choco|scoop|pip\d*|npm|pnpm|yarn|bun)\s+(?:install|add|remove|uninstall|upgrade|update)\b|\b(?:curl|wget)\b|\bgit\s+clone\b/i;
      return mutating.test(command)
        ? { allowed: false as const, reason: "vos doctor may advise installation but may not install or download tools" }
        : { allowed: true as const };
    },
  };
}

export async function executeStageShow(
  _command: StageShowCommand,
  projectRoot: string,
): Promise<CommandOutcome> {
  const timeline = await loadTimeline(projectRoot);
  const current = await currentStageForProject(projectRoot);
  return {
    status: "passed",
    details: {
      current_stage: current,
      stages: timeline,
    },
  };
}

export async function executeStageSave(
  command: StageSaveCommand,
  context: ExecContext,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const before = git(projectRoot, ["status", "--porcelain", "--untracked-files=all"])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  git(projectRoot, ["add", "-A"]);
  const staged = git(projectRoot, ["diff", "--cached", "--name-only"])
    .split(/\r?\n/)
    .filter(Boolean);
  let committed = false;
  if (staged.length > 0) {
    git(projectRoot, ["commit", "-m", "[vos][stage] Save stage state"]);
    committed = true;
  }
  const entry = await ensureHeadLedgerEntry({
    projectRoot,
    actor: command.actor,
    intent: command.intent,
    changedTargets: staged.length > 0 ? staged : before,
    runId: context.evidence.run_id,
  });
  return {
    status: "passed",
    details: {
      committed,
      changed_targets: staged.length > 0 ? staged : before,
      ledger: entry ? `${".vos/commit-ledger.jsonl"}#${entry.commit_sha}` : undefined,
    },
  };
}

export async function executeToolchainLint(
  _command: ToolchainLintCommand,
  projectRoot: string,
): Promise<CommandOutcome> {
  const lint = await runToolchainLint(projectRoot);
  return { status: lint.status, details: lint as unknown as Record<string, unknown> };
}

export async function executeToolchainInit(
  command: ToolchainInitCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  return await writeDeterministicToolchainManifest(context.projectRoot, evidence, command.force);
}

export async function executeSpecLint(
  command: SpecLintCommand,
  projectRoot: string,
  _context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const bundle = await buildNormalizedSpecBundle({ projectRoot });
  const target = resolveStudentSpecTarget(bundle, command.target);
  const diagnostics = studentSpecDiagnostics(bundle, target);
  const bundlePath = await writeNormalizedBundle(projectRoot, { ...bundle, diagnostics }, evidence);
  return {
    status: hasBlockingDiagnostics(diagnostics) ? "validation_failed" : "passed",
    details: {
      target: target.label,
      diagnostics,
      bundle_ref: studentRelativePath(projectRoot, bundlePath),
      source_count: bundle.sources.length,
      design: bundle.design?.path,
      module_count: bundle.normalized_modules.length,
      interface_count: bundle.interfaces.length,
      goal_count: bundle.goals.length,
      patch_count: bundle.patch_records.length,
      manifest: bundle.manifest?.path,
      model_used: false,
    },
  };
}

interface ResolvedStudentSpecTarget {
  label: string;
  all: boolean;
  paths: Set<string>;
  refs: Set<string>;
}

function resolveStudentSpecTarget(bundle: NormalizedSpecBundle, rawTarget: string | undefined): ResolvedStudentSpecTarget {
  const target = rawTarget?.trim();
  if (!target || target === "all") return { label: "all", all: true, paths: new Set(), refs: new Set() };
  const normalized = target.replace(/\\/g, "/").replace(/^\.\//, "");
  const matches: Array<{ path: string; refs: string[] }> = [];
  if (target === "design" && bundle.design) matches.push({ path: bundle.design.path, refs: ["design"] });
  for (const module of bundle.normalized_modules) {
    if ([module.id, module.module, module.path].includes(target) || module.path === normalized) {
      matches.push({ path: module.path, refs: [module.id, module.module] });
    }
  }
  for (const item of bundle.interfaces) {
    if ([item.id, item.name, item.path].includes(target) || item.path === normalized) {
      matches.push({ path: item.path, refs: [item.id, item.name] });
    }
  }
  for (const item of bundle.goals) {
    if ([item.goal_id, item.path].includes(target) || item.path === normalized) {
      matches.push({ path: item.path, refs: [item.goal_id] });
    }
  }
  for (const item of bundle.patch_records) {
    if ([item.id, item.path].includes(target) || item.path === normalized) {
      matches.push({ path: item.path ?? normalized, refs: [item.id] });
    }
  }
  if (matches.length === 0) {
    const source = bundle.sources.find((item) => item.path === normalized);
    if (source) matches.push({ path: source.path, refs: [] });
  }
  if (matches.length === 0) {
    throw new CliError(`unknown Spec target: ${target}`, "validation_failed", {
      reason: "spec_target_unknown",
      target,
    });
  }
  return {
    label: target,
    all: false,
    paths: new Set(matches.map((item) => item.path)),
    refs: new Set(matches.flatMap((item) => item.refs)),
  };
}

function studentSpecDiagnostics(bundle: NormalizedSpecBundle, target: ResolvedStudentSpecTarget) {
  const diagnostics = [...bundle.diagnostics];
  if (target.all) {
    if (!bundle.design) diagnostics.push({ severity: "error" as const, code: "design.missing", message: "spec/design.yaml is required", path: "spec/design.yaml" });
    if (bundle.normalized_modules.length === 0) diagnostics.push({ severity: "error" as const, code: "module.missing", message: "at least one ModuleSpec is required under spec/modules/", path: "spec/modules" });
    if (!bundle.normalized_modules.some((module) => module.module === "toolchain" || module.id === "toolchain")) {
      diagnostics.push({ severity: "error" as const, code: "toolchain.module_missing", message: "toolchain must be represented as a ModuleSpec", path: "spec/modules/toolchain.yaml", ref: "toolchain" });
    }
    return diagnostics;
  }
  return diagnostics.filter((diagnostic) =>
    Boolean(diagnostic.path && target.paths.has(diagnostic.path.replace(/\\/g, "/"))) ||
    Boolean(diagnostic.ref && target.refs.has(diagnostic.ref)) ||
    [...target.refs].some((ref) => diagnostic.message.includes(ref))
  );
}

export async function executeSpecNormalize(
  _command: SpecNormalizeCommand,
  projectRoot: string,
  _context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const project = await loadProjectConfig(projectRoot);
  const bundle = await buildNormalizedSpecBundle({ projectRoot, specRoot: project.spec_root ?? "spec" });
  const cachePath = await writeNormalizedBundle(projectRoot, bundle, evidence);
  return {
    status: hasBlockingDiagnostics(bundle.diagnostics) ? "validation_failed" : "passed",
    details: {
      diagnostics: bundle.diagnostics,
      source_count: bundle.sources.length,
      module_count: bundle.modules.length,
      operation_count: bundle.operations.length,
      normalized_cache: path.relative(projectRoot, cachePath),
    },
  };
}

export async function executeSpecCheckConsistency(
  _command: SpecCheckConsistencyCommand,
  projectRoot: string,
  _context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const project = await loadProjectConfig(projectRoot);
  const bundle = await buildNormalizedSpecBundle({ projectRoot, specRoot: project.spec_root ?? "spec" });
  const bundlePath = await writeNormalizedBundle(projectRoot, bundle, evidence);
  return {
    status: hasBlockingDiagnostics(bundle.diagnostics) ? "validation_failed" : "passed",
    details: {
      diagnostics: bundle.diagnostics,
      checked: bundle.sources.length,
      bundle_ref: path.relative(projectRoot, bundlePath),
    },
  };
}

export async function executeSpecPatchLint(
  command: SpecPatchLintCommand,
  projectRoot: string,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  if (!command.patchPath) {
    return {
      status: "validation_failed",
      details: { message: "spec patch lint requires a SpecPatch YAML path or commit-ish" },
    };
  }
  const project = await loadProjectConfig(projectRoot);
  const bundle = await buildNormalizedSpecBundle({ projectRoot, specRoot: project.spec_root ?? "spec" });
  const { patch, impact } = await resolveSpecPatch({
    projectRoot,
    specRoot: project.spec_root ?? "spec",
    ref: command.patchPath,
    bundle,
  });
  const agentReview = await runDefaultAgentSpecReview({
    command: "spec patch lint",
    target: command.patchPath,
    bundle,
    impact,
    context,
    evidence,
  });
  return {
    status: hasBlockingDiagnostics([...bundle.diagnostics, ...impact.diagnostics]) ? "validation_failed" : "passed",
    details: {
      patch,
      impact,
      selected_checks: selectPatchVerificationChecks(impact),
      agent_review: agentReview,
    },
  };
}

export async function executeSpecPatchApply(
  command: SpecPatchApplyCommand,
  projectRoot: string,
  _context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  if (!command.patchPath) {
    return {
      status: "validation_failed",
      details: { message: "spec patch apply requires a SpecPatch YAML path or commit-ish" },
    };
  }
  const project = await loadProjectConfig(projectRoot);
  const bundle = await buildNormalizedSpecBundle({ projectRoot, specRoot: project.spec_root ?? "spec" });
  const { patch, impact } = await resolveSpecPatch({
    projectRoot,
    specRoot: project.spec_root ?? "spec",
    ref: command.patchPath,
    bundle,
    strict: true,
  });
  const selectedChecks = selectPatchVerificationChecks(impact);
  const normalizedCache = await writeNormalizedBundle(projectRoot, bundle, evidence);
  const patchCache = await writePatchApplyCache({
    projectRoot,
    evidence,
    bundle,
    patch,
    impact,
    selectedChecks,
    status: "planned",
  });
  if (hasBlockingDiagnostics([...bundle.diagnostics, ...impact.diagnostics])) {
    const failedStatus = await writePatchApplyStatus({
      projectRoot,
      evidence,
      patchId: patch.id,
      commitSha: patch.commit_sha,
      parentSha: patch.parent_sha,
      status: "validation_failed",
      diagnostics: [...bundle.diagnostics, ...impact.diagnostics],
      verificationRunId: evidence.run_id,
    });
    return {
      status: "validation_failed",
      details: {
        patch,
        impact,
        selected_checks: selectedChecks,
        cache_artifacts: patchCache,
        normalized_cache: path.relative(projectRoot, normalizedCache),
        status_artifact: path.relative(projectRoot, failedStatus),
      },
    };
  }
  const verification = await runVerifyCommand({
    projectRoot,
    evidence,
    scope: "patch",
    target: command.patchPath,
    dryRun: false,
  });
  if (verification.status !== "ok") {
    const failedStatus = await writePatchApplyStatus({
      projectRoot,
      evidence,
      patchId: patch.id,
      commitSha: patch.commit_sha,
      parentSha: patch.parent_sha,
      status: verification.status,
      diagnostics: [],
      verificationRunId: evidence.run_id,
    });
    return {
      status: verification.status,
      details: {
        patch,
        impact,
        selected_checks: selectedChecks,
        verification,
        cache_artifacts: patchCache,
        normalized_cache: path.relative(projectRoot, normalizedCache),
        status_artifact: path.relative(projectRoot, failedStatus),
      },
    };
  }
  const finalStatus = await writePatchApplyStatus({
    projectRoot,
    evidence,
    patchId: patch.id,
    commitSha: patch.commit_sha,
    parentSha: patch.parent_sha,
    status: "passed",
    diagnostics: [],
    verificationRunId: evidence.run_id,
  });
  const appliedState = await writeAppliedPatchState({
    projectRoot,
    evidence,
    patch,
    impactRef: patchCache.impact,
    verificationRef: path.relative(projectRoot, evidence.manifest_path),
  });
  const projectionArtifacts = await writeLocalPatchProjections({
    projectRoot,
    evidence,
    bundle,
    patch,
    impact,
    selectedChecks,
  });
  return {
    status: "passed",
    details: {
      patch,
      impact,
      selected_checks: selectedChecks,
      verification,
      cache_artifacts: {
        ...patchCache,
        status: path.relative(projectRoot, finalStatus),
      },
      projection_artifacts: projectionArtifacts,
      applied_state: appliedState,
      normalized_cache: path.relative(projectRoot, normalizedCache),
    },
  };
}

export async function executeArchLint(
  command: ArchLintCommand,
  projectRoot: string,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const project = await loadProjectConfig(projectRoot);
  const bundle = await buildNormalizedSpecBundle({
    projectRoot,
    specRoot: project.spec_root ?? "spec",
    targetPath: command.path,
  });
  const composition = composeArchitecture(bundle);
  const agentReview = command.noAgent
    ? deterministicOnlyAgentReview("arch lint")
    : await runDefaultAgentSpecReview({
      command: "arch lint",
      target: command.path,
      bundle,
      context,
      evidence,
    });
  const diagnostics = [...bundle.diagnostics, ...composition.conflicts];
  return {
    status: hasBlockingDiagnostics(diagnostics) ? "validation_failed" : "passed",
    details: {
      diagnostics,
      composition,
      conflicts: composition.conflicts,
      enabled_modules: composition.enabled_modules,
      agent_review: agentReview,
    },
  };
}

export async function executeArchCompose(
  command: ArchComposeCommand,
  projectRoot: string,
  _context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const project = await loadProjectConfig(projectRoot);
  const bundle = await buildNormalizedSpecBundle({ projectRoot, specRoot: project.spec_root ?? "spec" });
  const composition = composeArchitecture(bundle, command.path);
  const composePath = path.join(projectRoot, ".vos", "cache", "composition.json");
  await mkdir(path.dirname(composePath), { recursive: true });
  await writeFile(composePath, `${JSON.stringify(composition, null, 2)}\n`);
  evidence.addArtifact("arch", path.relative(projectRoot, composePath), "architecture composition");
  return {
    status: hasBlockingDiagnostics([...bundle.diagnostics, ...composition.conflicts]) ? "validation_failed" : "passed",
    details: {
      composition,
      conflicts: composition.conflicts,
      enabled_modules: composition.enabled_modules,
      output: path.relative(projectRoot, composePath),
    },
  };
}

export async function executeArchDeriveTests(
  command: ArchDeriveTestsCommand,
  projectRoot: string,
  _context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const project = await loadProjectConfig(projectRoot);
  const bundle = await buildNormalizedSpecBundle({ projectRoot, specRoot: project.spec_root ?? "spec" });
  const matrix = deriveTestMatrix(bundle, command.path);
  const derivedPath = path.join(projectRoot, ".vos", "cache", "derived-tests.json");
  await mkdir(path.dirname(derivedPath), { recursive: true });
  await writeFile(derivedPath, `${JSON.stringify(matrix, null, 2)}\n`);
  evidence.addArtifact("arch", path.relative(projectRoot, derivedPath), "derived tests");
  return {
    status: hasBlockingDiagnostics(bundle.diagnostics) ? "validation_failed" : "passed",
    details: {
      matrix,
      source_refs: bundle.sources.map((source) => source.path),
      output: path.relative(projectRoot, derivedPath),
    },
  };
}

export async function executeTraceSyscall(
  command: TraceSyscallCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
  projectRoot: string,
): Promise<CommandOutcome> {
  updateProgress(context, { stage: "trace syscall", status: "running", message: "running qemu" });
  const result = await runQemuCommand({
    projectRoot,
    evidence,
    dryRun: command.dryRun,
    timeoutMs: command.timeoutMs,
    signal: context.signal,
  });
  return {
    status: result.status === "failed" ? "validation_failed" : result.status,
    details: {
      readyDetected: result.readyDetected,
      traceFile: result.serialPath,
      output: result.output,
      durationMs: result.durationMs,
    },
  };
}

export async function executeDebugExplainLog(
  command: DebugExplainLogCommand,
  projectRoot: string,
): Promise<CommandOutcome> {
  const logPath = command.logPath ?? (await findLatestLogPath(projectRoot));
  if (!logPath) {
    return { status: "failed", details: { message: "no log path found" } };
  }
  const text = await readFile(logPath, "utf8");
  const lines = text.split(/\r?\n/);
  const errors = lines.filter((line) => /error|fail|panic|assert|segfault/i.test(line));
  return {
    status: errors.length === 0 ? "passed" : "validation_failed",
    details: {
      logPath,
      related_specs: inferSpecsFromLog(text),
      suggested_next_commands: ["build", "verify public", "agent plan"],
      summary: `${errors.length} suspect issue lines`,
    },
  };
}

export async function executeReportGenerate(
  command: ReportGenerateCommand,
  context: ExecContext,
): Promise<CommandOutcome> {
  if (existsSync(path.join(context.projectRoot, "vos.yaml"))) {
    return executeStudentReport(context.projectRoot, context.evidence);
  }
  updateProgress(context, { stage: "report generate", status: "running", message: "aggregating evidence" });
  const projectRoot = context.projectRoot;
  const result = await generateCourseReport({
    projectRoot,
    stage: command.stage,
    final: command.final,
    visibilityScope: context.auth?.verdict === "not_required" ? "full" : context.effectivePolicy?.visibilityScope,
    evidence: context.evidence,
    agentRunner: context.agentRunner,
  });
  return {
    status: "passed",
    details: {
      report_path: path.relative(projectRoot, result.reportPath),
      summary_path: path.relative(projectRoot, result.summaryPath),
      agent_narrative_ref: path.relative(projectRoot, result.agentNarrativePath),
      final: command.final,
      stage: result.summary.stage,
      visibility_scope: result.summary.visibility_scope,
      requirements_total: result.summary.requirements_total,
      requirements_passed: result.summary.requirements_passed,
      ai_used: result.summary.ai_used,
      changed_targets: result.changedTargets,
      spec_refs: result.specRefs,
    },
  };
}

async function executeStudentReport(projectRoot: string, evidence: EvidenceWriter): Promise<CommandOutcome> {
  const bundle = await buildNormalizedSpecBundle({ projectRoot });
  const head = currentHead(projectRoot);
  const state = await studentGitStatus(projectRoot).catch(() => ({ clean: false, changed: [] as string[] }));
  const evidenceIndex = await readStudentEvidenceIndex(projectRoot);
  const manifestChecks = bundle.manifest?.checks ?? [];
  const verifiedRun = evidenceIndex.some((run) => {
    if (run.status !== "passed" || !Array.isArray(run.command)) return false;
    return run.command.some((part) => part === "verify");
  });
  const report = {
    version: "vos.report.v2",
    generated_at: new Date().toISOString(),
    commit_sha: head,
    commits: studentCommitHistory(projectRoot),
    spec_hash: hashString(JSON.stringify(bundle.hashes)),
    config_hash: existsSync(path.join(projectRoot, "vos.yaml")) ? hashString(await readFile(path.join(projectRoot, "vos.yaml"), "utf8")) : undefined,
    clean_head: state.clean,
    submittable: state.clean && !hasBlockingDiagnostics(bundle.diagnostics) && verifiedRun,
    diagnostics: bundle.diagnostics,
    spec_ids: {
      design: bundle.design ? ["design"] : [],
      modules: bundle.normalized_modules.map((module) => module.id),
      interfaces: bundle.interfaces.map((iface) => iface.id),
      goals: bundle.goals.map((goal) => goal.goal_id),
      patches: bundle.patch_records.map((patch) => patch.id),
    },
    evidence: {
      run_id: evidence.run_id,
      manifest: studentRelativePath(projectRoot, evidence.manifest_path),
      runs: evidenceIndex,
      verified_run: verifiedRun,
    },
    checks: manifestChecks,
    hardware_status: "pending_human_review",
  };
  const reportPath = path.join(projectRoot, ".vos", "report.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  evidence.addArtifactFromPath("report", reportPath, "deterministic student report");
  return { status: report.submittable ? "passed" : "validation_failed", details: { report_path: studentRelativePath(projectRoot, reportPath), ...report } };
}

function studentCommitHistory(projectRoot: string): Array<{ sha: string; parent?: string; subject: string }> {
  const output = git(projectRoot, ["log", "--format=%H%x09%P%x09%s", "-n", "100"]);
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, parent, ...subject] = line.split("\t");
    return { sha, ...(parent ? { parent } : {}), subject: subject.join("\t") };
  });
}

async function readStudentEvidenceIndex(projectRoot: string): Promise<Array<Record<string, unknown>>> {
  const indexPath = path.join(projectRoot, ".vos", "index", "evidence.json");
  if (!existsSync(indexPath)) return [];
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as { runs?: unknown };
    if (!Array.isArray(parsed.runs)) return [];
    return parsed.runs.filter((run): run is Record<string, unknown> => Boolean(run && typeof run === "object" && !Array.isArray(run)));
  } catch (error) {
    throw new CliError(`student evidence index is invalid: ${error instanceof Error ? error.message : String(error)}`, "validation_failed");
  }
}

export async function executeSubmitPack(
  _command: SubmitPackCommand,
  projectRoot: string,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  if (existsSync(path.join(projectRoot, "vos.yaml"))) {
    const report = await executeStudentReport(projectRoot, evidence);
    if (report.status !== "passed") {
      throw new CliError("submit requires a clean, verified student report", "policy_blocked", { report: report.details });
    }
    const reportPath = String((report.details as Record<string, unknown> | undefined)?.report_path ?? ".vos/report.json");
    const pack = await createStudentSubmitPack({ projectRoot, reportPath });
    evidence.addArtifact("submit-pack", studentRelativePath(projectRoot, pack.archivePath), "student submission archive");
    evidence.addArtifact("submit-manifest", studentRelativePath(projectRoot, pack.manifestPath), "student submission manifest");
    return { status: "passed", details: { ...pack.manifest, report, pack_path: studentRelativePath(projectRoot, pack.archivePath), manifest_path: studentRelativePath(projectRoot, pack.manifestPath) } };
  }
  const pack = await createSubmitPack({ projectRoot, evidence });
  evidence.addArtifact("submit-pack", path.relative(projectRoot, pack.archivePath), "submission archive");
  evidence.addArtifact("submit-manifest", path.relative(projectRoot, pack.manifestPath), "submission manifest");
  return {
    status: "passed",
    details: {
      pack_path: path.relative(projectRoot, pack.archivePath),
      manifest_path: path.relative(projectRoot, pack.manifestPath),
      ...pack.manifest,
    },
  };
}

export async function executeAgentConfig(
  command: AgentConfigCommand,
  context: ExecContext,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const requireEmbedding = await studentProjectRequiresEmbedding(projectRoot);

  if (command.reset) {
    const removed = resetAgentConfig(projectRoot);
    return {
      status: "passed",
      details: {
        removed,
        config_path: ".vos/config.toml",
        message: removed.agent || removed.embedding
          ? "agent and KB embedding configuration removed"
          : "agent configuration was already empty",
        suggested_next_commands: ["vos agent config"],
      },
    };
  }

  if (command.check) {
    return agentConfigCheckOutcome(projectRoot, requireEmbedding);
  }

  const existing = readAgentConfig(projectRoot);
  if (command.show) {
    return {
      status: existing.agent ? "passed" : "validation_failed",
      details: {
        config_path: ".vos/config.toml",
        agent: sanitizedProviderDetails(existing.agent, mergedProjectEnv(projectRoot)),
        kb_embedding: sanitizedProviderDetails(existing.embedding, mergedProjectEnv(projectRoot)),
        kb_embedding_required: requireEmbedding,
        suggested_next_commands: existing.agent ? ["vos agent config --check"] : ["vos agent config"],
      },
    };
  }

  let agent: ProviderConfig<AgentProviderName>;
  let embedding: ProviderConfig<AgentEmbeddingProviderName> | undefined;
  if (!hasAgentConfigValues(command)) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new CliError(
        "agent config wizard requires an interactive terminal; pass --provider, --model, --base-url, and --auth-env for non-interactive use",
        "validation_failed",
        { reason: "agent_config_non_interactive" },
      );
    }
    context.progress?.hide();
    ({ agent, embedding } = await promptAgentConfiguration(existing, requireEmbedding));
  } else {
    agent = mergeAgentProvider(command, existing.agent);
    embedding = mergeEmbeddingProvider(command, existing.embedding, agent);
  }

  writeAgentConfig(projectRoot, agent, embedding);
  const outcome = agentConfigCheckOutcome(projectRoot, requireEmbedding);
  return {
    ...outcome,
    details: {
      ...outcome.details,
      config_path: ".vos/config.toml",
      agent: sanitizedProviderDetails(agent, mergedProjectEnv(projectRoot)),
      kb_embedding: sanitizedProviderDetails(embedding, mergedProjectEnv(projectRoot)),
      message: outcome.status === "passed"
        ? "agent configuration saved and validated"
        : "agent configuration saved, but required credentials or KB embedding configuration are missing",
    },
  };
}

function hasAgentConfigValues(command: AgentConfigCommand): boolean {
  return Boolean(
    command.provider || command.model || command.baseUrl || command.authEnv ||
    command.embeddingProvider || command.embeddingModel || command.embeddingBaseUrl ||
    command.embeddingAuthEnv || command.configureEmbedding !== undefined,
  );
}

function mergeAgentProvider(
  command: AgentConfigCommand,
  existing: ProviderConfig<AgentProviderName> | undefined,
): ProviderConfig<AgentProviderName> {
  const provider = command.provider ?? existing?.provider;
  if (!provider) throw new CliError("agent provider is required", "validation_failed", { reason: "agent_config_provider_missing" });
  const changedProvider = command.provider !== undefined && command.provider !== existing?.provider;
  const defaults = AGENT_PROVIDER_DEFAULTS[provider];
  const model = command.model?.trim() || (!changedProvider ? existing?.model : undefined);
  if (!model) throw new CliError("agent model is required", "validation_failed", { reason: "agent_config_model_missing" });
  const baseUrl = command.baseUrl?.trim() || (!changedProvider ? existing?.baseUrl : undefined) || defaults.baseUrl;
  const authEnv = command.authEnv?.trim() || (!changedProvider ? existing?.authEnv : undefined) || defaults.authEnv;
  return { provider, model, ...(baseUrl ? { baseUrl } : {}), ...(authEnv ? { authEnv } : {}) };
}

function mergeEmbeddingProvider(
  command: AgentConfigCommand,
  existing: ProviderConfig<AgentEmbeddingProviderName> | undefined,
  agent: ProviderConfig<AgentProviderName>,
): ProviderConfig<AgentEmbeddingProviderName> | undefined {
  if (command.configureEmbedding === false) return undefined;
  const requested = command.configureEmbedding === true || Boolean(
    command.embeddingProvider || command.embeddingModel || command.embeddingBaseUrl || command.embeddingAuthEnv,
  );
  if (!requested) return existing;
  const provider = command.embeddingProvider ?? existing?.provider ?? defaultEmbeddingProvider(agent.provider);
  if (!provider) {
    throw new CliError(
      `${agent.provider} has no default embedding provider; pass --embedding-provider openai or openai-compatible`,
      "validation_failed",
      { reason: "agent_embedding_provider_missing" },
    );
  }
  const changedProvider = command.embeddingProvider !== undefined && command.embeddingProvider !== existing?.provider;
  const model = command.embeddingModel?.trim() || (!changedProvider ? existing?.model : undefined) || DEFAULT_EMBEDDING_MODEL;
  const baseUrl = command.embeddingBaseUrl?.trim() || (!changedProvider ? existing?.baseUrl : undefined) || defaultEmbeddingBaseUrl(provider, agent);
  const authEnv = command.embeddingAuthEnv?.trim() || (!changedProvider ? existing?.authEnv : undefined) || defaultEmbeddingAuthEnv(provider, agent);
  return { provider, model, ...(baseUrl ? { baseUrl } : {}), authEnv };
}

async function promptAgentConfiguration(
  existing: ReturnType<typeof readAgentConfig>,
  requireEmbedding: boolean,
): Promise<{
  agent: ProviderConfig<AgentProviderName>;
  embedding?: ProviderConfig<AgentEmbeddingProviderName>;
}> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const provider = await promptChoice(terminal, "Agent provider", AGENT_PROVIDER_NAMES, existing.agent?.provider);
    const defaults = AGENT_PROVIDER_DEFAULTS[provider];
    const sameProvider = provider === existing.agent?.provider;
    const model = await promptRequired(terminal, "Model", sameProvider ? existing.agent?.model : undefined);
    const baseUrl = await promptOptional(terminal, "Base URL", sameProvider ? existing.agent?.baseUrl : defaults.baseUrl);
    const authEnv = provider === "ollama"
      ? await promptOptional(terminal, "Credential environment variable (optional)", sameProvider ? existing.agent?.authEnv : defaults.authEnv)
      : await promptRequired(terminal, "Credential environment variable", sameProvider ? existing.agent?.authEnv : defaults.authEnv);
    const agent = { provider, model, ...(baseUrl ? { baseUrl } : {}), ...(authEnv ? { authEnv } : {}) };
    const withEmbedding = await promptBoolean(
      terminal,
      "Configure KB embeddings",
      requireEmbedding || Boolean(existing.embedding),
    );
    if (!withEmbedding) return { agent };
    const suggestedProvider = existing.embedding?.provider ?? defaultEmbeddingProvider(provider);
    const embeddingProvider = await promptChoice(terminal, "Embedding provider", AGENT_EMBEDDING_PROVIDER_NAMES, suggestedProvider);
    const sameEmbeddingProvider = embeddingProvider === existing.embedding?.provider;
    const embeddingModel = await promptRequired(terminal, "Embedding model", sameEmbeddingProvider ? existing.embedding?.model : DEFAULT_EMBEDDING_MODEL);
    const embeddingBaseUrl = await promptOptional(
      terminal,
      "Embedding base URL",
      sameEmbeddingProvider ? existing.embedding?.baseUrl : defaultEmbeddingBaseUrl(embeddingProvider, agent),
    );
    const embeddingAuthEnv = await promptRequired(
      terminal,
      "Embedding credential environment variable",
      sameEmbeddingProvider ? existing.embedding?.authEnv : defaultEmbeddingAuthEnv(embeddingProvider, agent),
    );
    return {
      agent,
      embedding: {
        provider: embeddingProvider,
        model: embeddingModel,
        ...(embeddingBaseUrl ? { baseUrl: embeddingBaseUrl } : {}),
        authEnv: embeddingAuthEnv,
      },
    };
  } finally {
    terminal.close();
  }
}

type TerminalQuestions = Pick<ReturnType<typeof createInterface>, "question">;

async function promptChoice<T extends string>(
  terminal: TerminalQuestions,
  label: string,
  values: readonly T[],
  current?: T,
): Promise<T> {
  const choices = values.map((value, index) => `${index + 1}) ${value}`).join("  ");
  while (true) {
    const answer = (await terminal.question(`${label} [${choices}]${current ? ` (${current})` : ""}: `)).trim();
    if (!answer && current) return current;
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && values[index]) return values[index];
    const exact = values.find((value) => value === answer.toLowerCase());
    if (exact) return exact;
    process.stdout.write(`Choose one of: ${values.join(", ")}\n`);
  }
}

async function promptRequired(terminal: TerminalQuestions, label: string, current?: string): Promise<string> {
  while (true) {
    const answer = (await terminal.question(`${label}${current ? ` (${current})` : ""}: `)).trim();
    if (answer) return answer;
    if (current) return current;
    process.stdout.write(`${label} is required.\n`);
  }
}

async function promptOptional(terminal: TerminalQuestions, label: string, current?: string): Promise<string | undefined> {
  const answer = (await terminal.question(`${label}${current ? ` (${current})` : ""}: `)).trim();
  return answer || current;
}

async function promptBoolean(terminal: TerminalQuestions, label: string, current: boolean): Promise<boolean> {
  while (true) {
    const answer = (await terminal.question(`${label}? ${current ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
    if (!answer) return current;
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    process.stdout.write("Enter y or n.\n");
  }
}

async function studentProjectRequiresEmbedding(projectRoot: string): Promise<boolean> {
  try {
    return (await listKbSources(projectRoot)).length > 0;
  } catch {
    return false;
  }
}

function mergedProjectEnv(projectRoot: string): NodeJS.ProcessEnv {
  return { ...readProjectEnv(projectRoot), ...process.env };
}

function agentConfigCheckOutcome(projectRoot: string, requireEmbedding: boolean): CommandOutcome {
  const checks = checkAgentConfig(projectRoot, mergedProjectEnv(projectRoot), { requireEmbedding });
  const missing = checks.filter((check) => !check.ok).map((check) => check.name);
  return {
    status: missing.length === 0 ? "passed" : "validation_failed",
    details: {
      checks,
      missing,
      kb_embedding_required: requireEmbedding,
      suggested_next_commands: missing.length === 0 ? ["vos doctor"] : ["vos agent config", "vos agent config --check"],
    },
  };
}

function sanitizedProviderDetails(
  config: ProviderConfig | undefined,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> | null {
  if (!config) return null;
  return {
    provider: config.provider,
    model: config.model,
    base_url: config.baseUrl,
    auth_env: config.authEnv,
    credential_present: config.authEnv ? Boolean(env[config.authEnv]) : true,
  };
}

export async function executeAgentImplement(
  command: AgentImplementCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  assertStudentModuleName(command.module);
  const projectRoot = context.projectRoot;
  const clean = await studentGitStatus(projectRoot);
  if (!clean.clean) {
    throw new CliError("agent implement requires a clean HEAD; commit the ModuleSpec first", "policy_blocked", {
      reason: "dirty_worktree",
      changed_targets: clean.changed,
    });
  }
  const bundle = await buildNormalizedSpecBundle({ projectRoot });
  const module = bundle.normalized_modules.find((candidate) => candidate.module === command.module || candidate.id === command.module);
  if (!module) throw new CliError(`ModuleSpec not found: ${command.module}`, "validation_failed", { module: command.module });
  const baseHead = currentHead(projectRoot);
  if (!baseHead) throw new CliError("agent implement requires a committed Git HEAD", "policy_blocked", { reason: "head_missing" });
  await assertStudentGitIdentity(projectRoot);
  const ownedPaths = await studentOwnedPaths(projectRoot, bundle, module);
  const specHash = hashString(JSON.stringify(bundle.hashes));
  const currentManifest = await readStudentManifest(projectRoot);
  const existingTargetIds = Object.keys(currentManifest.manifest.checks).sort();
  const worktree = await createStudentWorktree(projectRoot, evidence.run_id);
  let patch = "";
  let validation: Record<string, unknown> = {};
  let implementation: StudentImplementationPayload | undefined;
  let agentSubmission: unknown;
  let implementationEvents: Array<Record<string, unknown>> = [];
  let implementationCommit = "";
  const commitMessage = `[vos][agent] Implement ${module.module}\n\nRun-ID: ${evidence.run_id}\nSpec-Hash: ${specHash}`;
  try {
    const progress = createAgentProgressParams(context, "agent implement");
    const initialPrompt = `Implement ModuleSpec ${module.id}. Work only within these owned paths: ${ownedPaths.join(", ")}. Generate the implementation plus concrete public, contract, fixed-seed bounded fuzz, bounded trace/oracle, and local hidden tests for this module. Test source paths must also be covered by owns. This is an implementation task, not a planning task: do not stop after describing a plan; write the owned files, run validation, and call submit_result. Read only the current project root: its Spec, vos.yaml, owned files, and public test framework. Reuse helpers under tests/public and do not reimplement them in generated tests. Do not inspect parent or sibling directories, other checkouts/worktrees, VOS implementation source, Git history, old Lab implementations/diffs, or previous .vos runs; the current Spec and the result contract below are the complete authority. Do not perform repo-wide schema searches or toolchain discovery. Do not edit vos.yaml: return structured test_targets and hidden_tests so VOS can validate and project them atomically. Existing test target IDs are immutable and MUST NOT be proposed again: ${JSON.stringify(existingTargetIds)}. Choose new module-prefixed IDs that do not collide with that list. Each test_targets entry is {id, kind, program, args, cwd, env, timeout, verifies, artifacts}; timeout is an integer number of milliseconds and must be at least 1000 (for example 60000 for 60 seconds); use env: [\"PATH\"] for every target whose program or script resolves host tools by name. Fuzz additionally requires seed, cases, reproduction_artifact; trace additionally requires workload and oracle. Each hidden_tests entry is {id, path, content, program, args, cwd, env, timeout, verifies, seed} with the same millisecond timeout rule, and args may use {hidden_test}; hidden tests that resolve host tools also require PATH in env. Every verifies list must include ${module.id}. Hidden test content is returned in the result and must not be written into Git. Each implementation or evidence-driven repair turn retains the Agent runtime's required hard 50-iteration maxIterations guard. Finish discovery by iteration 5, write the implementation and every non-hidden test by iteration 12, verify that every proposed command path exists, and submit by iteration 30 so VOS can run authoritative gates and return bounded failures to the same thread. Batch independent Read/Write/Bash calls in the same response. Never spend more than five iterations debugging one failed command: either fix it, choose a simpler Spec-compliant implementation, or submit a failed result with the root cause. Do not spend iterations investigating harmless output formatting after the declared oracle passes. Run useful local checks, but VOS will independently run the build and every existing and proposed non-hidden target before applying anything. Do not edit specs, .git, .vos, or worktrees. Stop when evidence is complete or report the root cause.`;
    let taskPrompt = `${initialPrompt}\nImplement only operations and behavior explicitly declared by the target ModuleSpec. Do not add adjacent later-stage operations merely because a reference OS commonly includes them; choose the smallest complete composition that satisfies the current Spec. Prefer WriteFiles to create a related implementation or test-file batch in one tool call. A missing implementation or test file is not an external blocker: create it with the available tools and do not submit failed merely because owned work remains.`;
    let threadId: string | undefined;
    const projectedTargetIds = new Set<string>();
    while (true) {
      const eventCountBeforeRun = implementationEvents.length;
      const agentResult = await runAgentWithPrompt({
        projectRoot: worktree,
        taskPrompt,
        taskKind: "implementation",
        requestedScope: `implement:${module.id}`,
        context: studentSpecContext(bundle, module.id),
        allowedPaths: ownedPaths,
        requiredValidations: ["build", "public tests", "contract tests", "fixed-seed fuzz tests", "bounded trace/oracle tests"],
        courseMode: false,
        threadId,
        maxIterations: 50,
        completionReserveIterations: 20,
        resultSubmissionSchema: "student_implementation_result.v1",
        taskRunner: context.agentRunner,
        onEvent: async (event) => {
          implementationEvents.push(event);
          await progress.onEvent(event);
        },
      });
      if (implementationEvents.length === eventCountBeforeRun) implementationEvents.push(...agentResult.rawEvents);
      agentSubmission = agentResult.parsedResult;
      const usedIterations = Math.max(1, agentResult.iterations);
      threadId = agentResult.threadId ?? threadId;
      try {
        implementation = parseStudentImplementationPayload(agentResult.parsedResult, module.id, bundle);
      } catch (error) {
        validation = {
          status: "validation_failed",
          message: errorMessage(error),
          agent_result: agentResult.parsedResult,
        };
        if (usedIterations >= 50 || !threadId) break;
        taskPrompt = `VOS rejected the structured implementation result before running gates. Preserve the current worktree. Use the available tools now to correct the result fields and any incomplete owned files, then run validation and resubmit status passed. Do not merely describe a known fix or immediately resubmit failed while iterations remain. This continuation keeps the same Agent thread and has the required 50-iteration maxIterations guard. Bounded validation evidence:\n${JSON.stringify(studentImplementationRepairSummary(validation), null, 2)}`;
        continue;
      }

      if (implementation.status !== "passed") {
        validation = {
          status: "validation_failed",
          message: `student implementation Agent reported ${implementation.status}`,
          agent_result: agentResult.parsedResult,
        };
        break;
      }

      const agentChanged = await studentChangedPaths(worktree);
      const violations = agentChanged.filter((target) =>
        !(target === "vos.yaml" && projectedTargetIds.size > 0) && !isOwnedStudentPath(target, ownedPaths)
      );
      if (violations.length > 0) {
        validation = { status: "owns_violation", changed: agentChanged, violations };
      } else {
        const proposedIds = new Set(implementation.test_targets.map((target) => target.id));
        if (projectedTargetIds.size > 0 && (proposedIds.size !== projectedTargetIds.size || [...proposedIds].some((id) => !projectedTargetIds.has(id)))) {
          validation = { status: "validation_failed", message: "repair submission changed the projected test target ID set", expected_ids: [...projectedTargetIds], actual_ids: [...proposedIds] };
        } else {
          const missingCommandInputs = studentMissingProposedCommandInputs(worktree, implementation.test_targets);
          if (missingCommandInputs.length > 0) {
            validation = {
              status: "validation_failed",
              message: "proposed test command inputs do not exist",
              missing_command_inputs: missingCommandInputs,
              agent_result: agentResult.parsedResult,
            };
          } else {
            await applyStudentTestTargetProposals(worktree, implementation.test_targets, projectedTargetIds);
            for (const id of proposedIds) projectedTargetIds.add(id);
            patch = await studentWorktreeDiff(worktree);
            if (!patch.trim() || agentChanged.length === 0) {
              validation = { status: "no_changes", agent_result: agentResult.parsedResult };
            } else {
              const proposedBundle = await buildNormalizedSpecBundle({ projectRoot: worktree });
              const specDiagnostics = proposedBundle.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
              if (specDiagnostics.length > 0) {
                validation = { status: "validation_failed", spec_diagnostics: specDiagnostics, agent_result: agentResult.parsedResult };
              } else {
                const runner = new HostRunner(worktree, context.signal);
                const build = await runner.build("build");
                const manifest = await readStudentManifest(worktree);
                const checks = [] as unknown[];
                if (build.status === "passed") {
                  for (const id of Object.keys(manifest.manifest.checks)) checks.push(await runner.check(id));
                }
                const gatesPassed = build.status === "passed" && checks.length > 0 && (checks as Array<{ status?: string }>).every((check) => check.status === "passed");
                validation = {
                  status: gatesPassed && implementation.status === "passed" ? "passed" : "validation_failed",
                  ...(implementation.status === "passed" ? {} : { message: `student implementation Agent reported ${implementation.status}` }),
                  build,
                  checks,
                  evidence: await runner.collectEvidence(),
                  agent_result: agentResult.parsedResult,
                };
              }
            }
          }
        }
      }
      if (validation.status === "passed" || validation.status === "owns_violation" || usedIterations >= 50 || !threadId) break;
      taskPrompt = `VOS authoritative validation rejected the current implementation. Keep the existing projected test target IDs. Use the available tools now to inspect and correct the current worktree files, create every missing owned test file, run the failing commands, and resubmit status passed when every gate succeeds. A missing implementation or test file is not an external blocker. Do not merely describe a known fix or immediately resubmit failed while iterations remain. This continuation keeps the same Agent thread and has the required 50-iteration maxIterations guard. Bounded validation evidence:\n${JSON.stringify(studentImplementationRepairSummary(validation), null, 2)}`;
    }
    if (validation.status === "passed") {
      if (!implementation) throw new CliError("implementation result disappeared before commit preparation", "failed");
      const preparedChanged = await studentChangedPaths(worktree);
      await runStudentGit(worktree, ["add", "--", ...preparedChanged]);
      await runStudentGit(worktree, ["commit", "-m", commitMessage]);
      implementationCommit = currentHead(worktree) ?? "";
      if (!implementationCommit) throw new CliError("prepared implementation commit has no Git identity", "failed");
    }
  } catch (error) {
    let changedPaths: string[] = [];
    let patchCaptureError: string | undefined;
    try {
      changedPaths = await studentChangedPaths(worktree);
      patch = await studentWorktreeDiff(worktree);
    } catch (captureError) {
      patchCaptureError = errorMessage(captureError);
    }
    validation = {
      status: "validation_failed",
      message: errorMessage(error),
      changed_paths: changedPaths,
      owns_violations: changedPaths.filter((target) => !isOwnedStudentPath(target, ownedPaths)),
      ...(patchCaptureError ? { patch_capture_error: patchCaptureError } : {}),
      ...(agentSubmission === undefined ? {} : { agent_result: agentSubmission }),
    };
  } finally {
    await removeStudentWorktree(projectRoot, worktree);
  }

  await writeStudentAgentArtifact(projectRoot, evidence, "implement", {
    module: module.id,
    base_head: baseHead,
    patch,
    validation,
    agent_events: implementationEvents,
  });
  if (validation.status !== "passed") {
    return { status: validation.status === "owns_violation" ? "policy_blocked" : "validation_failed", details: { module: module.id, base_head: baseHead, validation, patch_available: Boolean(patch) } };
  }
  if (currentHead(projectRoot) !== baseHead) {
    return { status: "policy_blocked", details: { module: module.id, reason: "head_drift", expected_head: baseHead, actual_head: currentHead(projectRoot), patch_available: true } };
  }
  const landingState = await studentGitStatus(projectRoot);
  if (!landingState.clean) {
    return { status: "policy_blocked", details: { module: module.id, reason: "worktree_drift", changed_targets: landingState.changed, patch_available: true } };
  }
  if (!implementationCommit) throw new CliError("validated implementation commit is missing", "failed");
  const changedResult = await runStudentGit(projectRoot, ["diff-tree", "--no-commit-id", "--name-only", "-r", implementationCommit]);
  const changed = changedResult.stdout.split(/\r?\n/).map((value) => value.trim().replace(/\\/g, "/")).filter(Boolean);
  if (changed.some((target) => target !== "vos.yaml" && !isOwnedStudentPath(target, ownedPaths))) {
    throw new CliError("agent implementation changed a path outside the ModuleSpec owns set", "policy_blocked", { reason: "owns_violation", changed_targets: changed });
  }
  const commit = await runStudentGit(projectRoot, ["merge", "--ff-only", implementationCommit]);
  if (!implementation) throw new CliError("implementation result disappeared before hidden-test persistence", "failed");
  const hidden = await persistStudentHiddenTests({ projectRoot, specHash, runId: evidence.run_id, moduleId: module.id, payload: implementation, events: implementationEvents });
  await ensureHeadLedgerEntry({ projectRoot, actor: "agent", intent: `implement ${module.module}`, specRefs: [module.path], changedTargets: changed, runId: evidence.run_id, evidenceRefs: [{ id: evidence.run_id, kind: "run", path: path.relative(projectRoot, evidence.manifest_path) }] });
  return { status: "passed", details: { module: module.id, commit: commit.stdout.trim(), run_id: evidence.run_id, spec_hash: specHash, hidden_tests: hidden, validation } };
}

type StudentTestKind = "public" | "contract" | "fuzz" | "trace";

interface StudentTestTargetProposal {
  id: string;
  kind: StudentTestKind;
  program: string;
  args: string[];
  cwd: string;
  env: string[];
  timeout: number;
  verifies: string[];
  artifacts: string[];
  seed?: number;
  cases?: number;
  reproduction_artifact?: string;
  workload?: string;
  oracle?: string;
}

interface StudentHiddenTestProposal {
  id: string;
  path: string;
  content: string;
  program: string;
  args: string[];
  cwd: string;
  env: string[];
  timeout: number;
  verifies: string[];
  seed: number;
}

interface StudentImplementationPayload {
  status: string;
  test_targets: StudentTestTargetProposal[];
  hidden_tests: StudentHiddenTestProposal[];
}

function studentImplementationRepairSummary(validation: Record<string, unknown>): Record<string, unknown> {
  const build = isRecord(validation.build) ? validation.build : undefined;
  const checks = Array.isArray(validation.checks) ? validation.checks : [];
  return {
    status: validation.status,
    message: validation.message,
    missing_command_inputs: validation.missing_command_inputs,
    spec_diagnostics: validation.spec_diagnostics,
    build: build ? boundedRunnerFailure(build) : undefined,
    failed_checks: checks.filter((check) => isRecord(check) && check.status !== "passed").map((check) => boundedRunnerFailure(check as Record<string, unknown>)),
  };
}

function boundedRunnerFailure(result: Record<string, unknown>): Record<string, unknown> {
  const tail = (value: unknown): unknown => typeof value === "string" ? value.slice(-4000) : value;
  return {
    target: result.target,
    status: result.status,
    exitCode: result.exitCode,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
  };
}

function parseStudentImplementationPayload(value: unknown, moduleId: string, bundle: NormalizedSpecBundle): StudentImplementationPayload {
  if (!isRecord(value) || typeof value.status !== "string" || !Array.isArray(value.test_targets) || !Array.isArray(value.hidden_tests)) {
    throw new AgentOutputError("student implementation result must include test_targets and hidden_tests");
  }
  const stableRefs = new Set<string>([
    "design",
    ...bundle.normalized_modules.flatMap((item) => [item.id, item.module]),
    ...bundle.interfaces.flatMap((item) => [item.id, item.name]),
    ...bundle.goals.map((item) => item.goal_id),
    ...bundle.patch_records.map((item) => item.id),
  ]);
  const testTargets = value.test_targets.map((raw, index) => parseStudentTestTarget(raw, index, moduleId, stableRefs));
  const targetIds = new Set<string>();
  for (const target of testTargets) {
    if (targetIds.has(target.id)) throw new AgentOutputError(`duplicate proposed test target id: ${target.id}`);
    targetIds.add(target.id);
  }
  for (const kind of ["public", "contract", "fuzz", "trace"] as const) {
    if (!testTargets.some((target) => target.kind === kind)) throw new AgentOutputError(`implementation must propose at least one ${kind} target`);
  }
  const hiddenTests = value.hidden_tests.map((raw, index): StudentHiddenTestProposal => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.path !== "string" || typeof raw.content !== "string" || typeof raw.program !== "string" ||
      !isStringArray(raw.args) || typeof raw.cwd !== "string" || !isStringArray(raw.env) || !isPositiveInteger(raw.timeout) || !isStringArray(raw.verifies) || !isNonnegativeInteger(raw.seed)) {
      throw new AgentOutputError(`hidden test proposal ${index} is invalid`);
    }
    assertStudentTargetId(raw.id);
    if (raw.timeout < 1_000) throw new AgentOutputError(`hidden test ${raw.id} timeout is milliseconds and must be at least 1000`);
    assertSafeStudentRelativePath(raw.path, `hidden test ${raw.id} path`);
    assertSafeStudentRelativePath(raw.cwd, `hidden test ${raw.id} cwd`, true);
    if (!raw.verifies.includes(moduleId) || raw.verifies.some((ref) => !stableRefs.has(ref))) {
      throw new AgentOutputError(`hidden test ${raw.id} must verify ${moduleId} using stable Spec IDs`);
    }
    if (raw.content.length === 0) throw new AgentOutputError(`hidden test ${raw.id} has empty content`);
    if (!raw.args.includes("{hidden_test}")) {
      throw new AgentOutputError(`hidden test ${raw.id} args must include {hidden_test}`);
    }
    return raw as unknown as StudentHiddenTestProposal;
  });
  if (hiddenTests.length === 0) throw new AgentOutputError("implementation must generate at least one local hidden test");
  if (new Set(hiddenTests.map((item) => item.id)).size !== hiddenTests.length) throw new AgentOutputError("hidden test ids must be unique");
  return { status: value.status, test_targets: testTargets, hidden_tests: hiddenTests };
}

function parseStudentTestTarget(raw: unknown, index: number, moduleId: string, stableRefs: Set<string>): StudentTestTargetProposal {
  if (!isRecord(raw) || typeof raw.id !== "string" || !["public", "contract", "fuzz", "trace"].includes(String(raw.kind)) || typeof raw.program !== "string" ||
    !isStringArray(raw.args) || typeof raw.cwd !== "string" || !isStringArray(raw.env) || !isPositiveInteger(raw.timeout) || !isStringArray(raw.verifies) || !isStringArray(raw.artifacts)) {
    throw new AgentOutputError(`test target proposal ${index} is invalid`);
  }
  assertStudentTargetId(raw.id);
  if (raw.timeout < 1_000) throw new AgentOutputError(`test target ${raw.id} timeout is milliseconds and must be at least 1000`);
  assertSafeStudentRelativePath(raw.cwd, `test target ${raw.id} cwd`, true);
  for (const artifact of raw.artifacts) assertSafeStudentRelativePath(artifact, `test target ${raw.id} artifact`);
  if (!raw.verifies.includes(moduleId) || raw.verifies.some((ref) => !stableRefs.has(ref))) {
    throw new AgentOutputError(`test target ${raw.id} must verify ${moduleId} using stable Spec IDs`);
  }
  if (raw.kind === "fuzz") {
    if (!isNonnegativeInteger(raw.seed) || !isPositiveInteger(raw.cases) || typeof raw.reproduction_artifact !== "string") {
      throw new AgentOutputError(`fuzz target ${raw.id} requires fixed seed, bounded cases, timeout, and reproduction_artifact`);
    }
    assertSafeStudentRelativePath(raw.reproduction_artifact, `fuzz target ${raw.id} reproduction artifact`);
  }
  if (raw.kind === "trace") {
    if (typeof raw.workload !== "string" || !raw.workload || typeof raw.oracle !== "string" || !raw.oracle || raw.artifacts.length === 0) {
      throw new AgentOutputError(`trace target ${raw.id} requires workload, oracle, timeout, and artifacts`);
    }
  }
  return raw as unknown as StudentTestTargetProposal;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function assertStudentTargetId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new AgentOutputError(`invalid test target id: ${value}`);
}

function assertSafeStudentRelativePath(value: string, label: string, allowDot = false): void {
  const normalized = value.replace(/\\/g, "/");
  if ((!allowDot || normalized !== ".") && (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").some((part) => part === ".."))) {
    throw new AgentOutputError(`${label} must be a repository-relative path without traversal`);
  }
}

function studentMissingProposedCommandInputs(projectRoot: string, targets: StudentTestTargetProposal[]): Array<{ target: string; path: string }> {
  const scriptPrograms = new Set(["sh", "bash", "bun", "python", "python3"]);
  const missing: Array<{ target: string; path: string }> = [];
  for (const target of targets) {
    const program = path.basename(target.program).toLowerCase();
    const firstArg = target.args[0];
    if (!scriptPrograms.has(program) || !firstArg || firstArg.startsWith("-") || firstArg.includes("{") || !firstArg.replace(/\\/g, "/").includes("/")) continue;
    const cwd = target.cwd === "." ? projectRoot : path.resolve(projectRoot, target.cwd);
    const input = path.resolve(cwd, firstArg);
    const relative = path.relative(projectRoot, input).replace(/\\/g, "/");
    if (relative.startsWith("../") || path.isAbsolute(relative) || !existsSync(input)) {
      missing.push({ target: target.id, path: firstArg.replace(/\\/g, "/") });
    }
  }
  return missing;
}

async function applyStudentTestTargetProposals(
  projectRoot: string,
  targets: StudentTestTargetProposal[],
  replaceIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const manifestPath = path.join(projectRoot, "vos.yaml");
  const raw = parseTopLevelYaml(await readFile(manifestPath, "utf8"));
  const checks = isRecord(raw.checks) ? { ...raw.checks } : {};
  for (const target of targets) {
    if (checks[target.id] !== undefined && !replaceIds.has(target.id)) {
      throw new AgentOutputError(`test target already exists: ${target.id}`);
    }
    const { id, ...projection } = target;
    checks[id] = projection;
  }
  const projected = { ...raw, checks };
  parseProjectManifest(projected);
  const temporary = path.join(projectRoot, `.vos.yaml.${process.pid}.tmp`);
  await writeFile(temporary, stringifyYaml(projected, { lineWidth: 0 }));
  await rename(temporary, manifestPath);
}

async function persistStudentHiddenTests(params: {
  projectRoot: string;
  specHash: string;
  runId: string;
  moduleId: string;
  payload: StudentImplementationPayload;
  events: Array<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const root = path.join(params.projectRoot, ".vos", "hidden-tests", params.specHash);
  await mkdir(root, { recursive: true });
  const manifestPath = path.join(root, "manifest.json");
  const previousManifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, "utf8")) as unknown
    : undefined;
  const previousTests = isRecord(previousManifest) && previousManifest.version === "vos.hidden-tests.v1" && previousManifest.spec_hash === params.specHash && Array.isArray(previousManifest.tests)
    ? previousManifest.tests.filter(isRecord)
    : [];
  const legacyModuleId = isRecord(previousManifest) && typeof previousManifest.module_id === "string"
    ? previousManifest.module_id
    : undefined;
  const retainedTests = previousTests.filter((test) => {
    const moduleId = typeof test.module_id === "string" ? test.module_id : legacyModuleId;
    return moduleId !== params.moduleId;
  });
  const retainedIds = new Set(retainedTests.flatMap((test) => typeof test.id === "string" ? [test.id] : []));
  const retainedPaths = new Set(retainedTests.flatMap((test) => typeof test.path === "string" ? [test.path] : []));
  const model = params.events.find((event) => event.type === "model.usage" && typeof event.model === "string")?.model ?? "unknown";
  const generatedTests = [] as Array<Record<string, unknown>>;
  for (const proposal of params.payload.hidden_tests) {
    const relative = proposal.path.replace(/\\/g, "/");
    const file = path.join(root, relative);
    const hiddenPath = studentRelativePath(params.projectRoot, file);
    if (retainedIds.has(proposal.id)) {
      throw new AgentOutputError(`hidden test id already belongs to another module: ${proposal.id}`);
    }
    if (retainedPaths.has(hiddenPath)) {
      throw new AgentOutputError(`hidden test path already belongs to another module: ${hiddenPath}`);
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, proposal.content);
    generatedTests.push({
      ...proposal,
      path: hiddenPath,
      args: canonicalStudentHiddenArgs(hiddenPath, proposal.args),
      content_hash: hashString(proposal.content),
      module_id: params.moduleId,
      model,
      generation_run_id: params.runId,
    });
  }
  const tests = [...retainedTests, ...generatedTests];
  const manifest = {
    version: "vos.hidden-tests.v1",
    commit_sha: currentHead(params.projectRoot),
    spec_hash: params.specHash,
    config_hash: hashString(await readFile(path.join(params.projectRoot, "vos.yaml"), "utf8")),
    module_id: params.moduleId,
    model,
    generation_run_id: params.runId,
    tests,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifest: studentRelativePath(params.projectRoot, manifestPath),
    count: tests.length,
    generated_count: generatedTests.length,
    retained_count: retainedTests.length,
    model,
  };
}

export async function executeAgentVerify(
  _command: AgentVerifyCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const state = await studentGitStatus(context.projectRoot);
  if (!state.clean) {
    return { status: "policy_blocked", details: { role: "verify", model_used: false, reason: "dirty_worktree", changed_targets: state.changed } };
  }
  const worktree = await createStudentWorktree(context.projectRoot, `${evidence.run_id}-verify`);
  try {
    const result = await executeStudentVerify(
      { kind: "verify", scope: "public", dryRun: false },
      { ...context, projectRoot: worktree },
      evidence,
    );
    return { ...result, details: { ...(result.details ?? {}), role: "verify", model_used: false, worktree_read_only: true } };
  } finally {
    await removeStudentWorktree(context.projectRoot, worktree);
  }
}

export async function executeAgentReview(
  command: AgentReviewCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const bundle = await buildNormalizedSpecBundle({ projectRoot });
  const target = resolveStudentSpecTarget(bundle, command.target);
  const diagnostics = studentSpecDiagnostics(bundle, target);
  const before = await studentGitFingerprint(projectRoot);
  const reviewContext = {
    target: target.label,
    target_paths: [...target.paths],
    target_refs: [...target.refs],
    lint_diagnostics: diagnostics,
    manifest: bundle.manifest,
    spec: studentSpecContext(bundle, target.label),
  };
  if (command.display) {
    context.progress?.hide();
    await runAgentInteractiveTask({
      projectRoot,
      taskKind: "spec_review",
      requestedScope: `agent.review:${target.label}`,
      initialTask: "Begin by presenting a complete, evidence-grounded review of the selected handwritten Spec and its vos.yaml mappings. Then answer follow-up questions. Do not write files, propose patches, install software, or alter project state.",
      context: reviewContext,
      courseMode: true,
      allowedVosCommands: await loadAgentAllowedCommands(projectRoot, context.effectivePolicy),
      runner: context.interactiveAgentRunner,
    });
    const after = await studentGitFingerprint(projectRoot);
    assertStudentReadonlyFingerprint(before, after, "agent review");
    return { status: "passed", details: { role: "review", target: target.label, interactive: true, diagnostics, model_used: true } };
  }
  const review = await runDefaultAgentSpecReview({
    command: "agent review",
    target: target.label,
    targetPaths: [...target.paths],
    targetRefs: [...target.refs],
    bundle,
    context,
    evidence,
  });
  const after = await studentGitFingerprint(projectRoot);
  assertStudentReadonlyFingerprint(before, after, "agent review");
  const blocker = review.findings.some((finding) => finding.severity === "blocker");
  return {
    status: blocker ? "validation_failed" : "passed",
    details: { role: "review", target: target.label, diagnostics, agent_review: review, model_used: review.status === "ok" },
  };
}

function studentSpecContext(bundle: NormalizedSpecBundle, focus?: string): Record<string, unknown> {
  return {
    focus,
    design: bundle.design?.document ?? null,
    modules: bundle.normalized_modules,
    interfaces: bundle.interfaces,
    goals: bundle.goals,
    patches: bundle.patch_records,
    manifest: bundle.manifest,
    diagnostics: bundle.diagnostics,
  };
}

async function studentOwnedPaths(projectRoot: string, bundle: NormalizedSpecBundle, module: { id?: string; module: string; owns: string[] }): Promise<string[]> {
  const paths = new Set(module.owns);
  for (const patch of bundle.patch_records) {
    if (!(await isCommittedSpecPatch(projectRoot, patch, [module.module, module.id]))) continue;
    if (patch.affected_modules.some((affected) => [module.module, module.id].some((ref) => Boolean(ref && (affected === ref || moduleMatches(affected, ref)))))) {
      for (const affected of patch.affected_modules) {
        const owner = bundle.normalized_modules.find((candidate) => candidate.module === affected || candidate.id === affected || moduleMatches(candidate.module, affected) || moduleMatches(candidate.id, affected));
        for (const owned of owner?.owns ?? []) paths.add(owned);
      }
    }
  }
  return [...paths].map((value) => value.replace(/\\/g, "/"));
}

async function isCommittedSpecPatch(projectRoot: string, patch: SpecPatchRecord, modules: Array<string | undefined>): Promise<boolean> {
  if (!patch.affected_modules.some((affected) => modules.some((module) => Boolean(module && (affected === module || moduleMatches(affected, module)))))) return false;
  const commitSha = patch.commit_sha?.trim() || await inferSpecPatchCommit(projectRoot, patch.path);
  if (!commitSha) return false;
  const result = await runCommand({ command: ["git", "merge-base", "--is-ancestor", commitSha, "HEAD"], cwd: projectRoot });
  return result.exitCode === 0;
}

async function inferSpecPatchCommit(projectRoot: string, patchPath: string | undefined): Promise<string | undefined> {
  if (!patchPath) return undefined;
  const result = await runCommand({ command: ["git", "log", "-1", "--format=%H", "--", patchPath], cwd: projectRoot });
  if (result.exitCode !== 0) return undefined;
  const commit = result.stdout.trim().split(/\s+/)[0];
  return /^[0-9a-f]{7,64}$/i.test(commit) ? commit : undefined;
}

function isOwnedStudentPath(target: string, ownedPaths: readonly string[], allowSpec = false): boolean {
  const raw = target.replace(/\\/g, "/").replace(/^\.\//, "");
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || raw.split("/").some((segment) => segment === "..")) return false;
  const normalized = path.posix.normalize(raw);
  if ((!allowSpec && normalized.startsWith("spec/")) || normalized.startsWith(".git/") || normalized.startsWith(".vos/")) return false;
  return ownedPaths.some((owned) => {
    const prefixRaw = owned.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (prefixRaw.startsWith("/") || /^[A-Za-z]:\//.test(prefixRaw) || prefixRaw.split("/").some((segment) => segment === "..")) return false;
    const prefix = path.posix.normalize(prefixRaw);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

function assertStudentModuleName(value: string): void {
  const normalized = value.replace(/\\/g, "/");
  if (!/^[A-Za-z0-9._/-]+$/.test(normalized) || normalized === "." || normalized === ".." || normalized.startsWith("/") || normalized.endsWith("/") || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new CliError(`invalid module name: ${value}`, "validation_failed", { reason: "module_path_invalid" });
  }
}

function studentRelativePath(projectRoot: string, target: string): string {
  return path.relative(projectRoot, target).replace(/\\/g, "/");
}

async function studentGitStatus(projectRoot: string): Promise<{ clean: boolean; changed: string[] }> {
  const result = await runStudentGit(projectRoot, ["status", "--porcelain", "--untracked-files=all"]);
  const changed = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .filter((target) => !target.replace(/\\/g, "/").startsWith(".vos/"));
  return { clean: changed.length === 0, changed };
}

async function studentGitFingerprint(projectRoot: string): Promise<{ fingerprint: string; changed: string[] }> {
  const state = await studentGitStatus(projectRoot);
  const entries: Array<{ path: string; content: string }> = [];
  for (const target of [...state.changed].sort()) {
    const resolved = path.resolve(projectRoot, target);
    const relative = path.relative(projectRoot, resolved);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      entries.push({ path: target, content: "<outside-project>" });
      continue;
    }
    try {
      entries.push({ path: target, content: hashString(await readFile(resolved, "utf8")) });
    } catch {
      entries.push({ path: target, content: "<missing-or-non-file>" });
    }
  }
  return { fingerprint: hashString(JSON.stringify(entries)), changed: state.changed };
}

function assertStudentReadonlyFingerprint(before: { fingerprint: string; changed: string[] }, after: { fingerprint: string; changed: string[] }, role: string): void {
  if (before.fingerprint === after.fingerprint) return;
  throw new CliError(`${role} changed project files despite its read-only contract`, "policy_blocked", {
    reason: "readonly_agent_modified_project",
    before: before.changed,
    after: after.changed,
  });
}

async function runStudentGit(projectRoot: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const result = await runCommand({ command: ["git", ...args], cwd: projectRoot });
  if (result.exitCode !== 0) throw new CliError(result.stderr.trim() || result.stdout.trim() || `git ${args[0]} failed`, "failed", { command: ["git", ...args] });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

async function assertStudentGitIdentity(projectRoot: string): Promise<void> {
  try {
    await runStudentGit(projectRoot, ["var", "GIT_AUTHOR_IDENT"]);
    await runStudentGit(projectRoot, ["var", "GIT_COMMITTER_IDENT"]);
  } catch {
    throw new CliError(
      "agent implement requires a valid Git author and committer identity; configure user.name and user.email for this repository",
      "policy_blocked",
      { reason: "git_identity_missing" },
    );
  }
}

async function createStudentWorktree(projectRoot: string, id: string): Promise<string> {
  const worktree = path.join(projectRoot, ".vos", "worktrees", id.replace(/[^A-Za-z0-9._-]+/g, "-"));
  await mkdir(path.dirname(worktree), { recursive: true });
  await runStudentGit(projectRoot, ["worktree", "add", "--detach", worktree, "HEAD"]);
  return worktree;
}

async function removeStudentWorktree(projectRoot: string, worktree: string): Promise<void> {
  const result = await runCommand({ command: ["git", "worktree", "remove", "--force", worktree], cwd: projectRoot });
  if (result.exitCode !== 0 && existsSync(worktree)) await rm(worktree, { recursive: true, force: true });
}

async function studentChangedPaths(projectRoot: string): Promise<string[]> {
  const result = await runStudentGit(projectRoot, ["diff", "--name-only", "HEAD"]);
  const untracked = await runStudentGit(projectRoot, ["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...result.stdout.split(/\r?\n/), ...untracked.stdout.split(/\r?\n/)].map((value) => value.trim().replace(/\\/g, "/")).filter(Boolean))];
}

async function studentWorktreeDiff(projectRoot: string): Promise<string> {
  const untracked = await runStudentGit(projectRoot, ["ls-files", "--others", "--exclude-standard"]);
  const untrackedPaths = untracked.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (untrackedPaths.length > 0) await runStudentGit(projectRoot, ["add", "-N", "--", ...untrackedPaths]);
  const result = await runStudentGit(projectRoot, ["diff", "--binary", "HEAD"]);
  return result.stdout;
}

async function writeStudentAgentArtifact(projectRoot: string, evidence: EvidenceWriter, name: string, value: unknown): Promise<void> {
  const artifact = path.join(evidence.artifacts_root, `student-${name}.json`);
  await writeFile(artifact, `${JSON.stringify(value, null, 2)}\n`);
  evidence.addArtifactFromPath("agent", artifact, `student ${name} evidence`);
  void projectRoot;
}

export async function executeAgentContext(
  command: AgentContextCommand,
  projectRoot: string,
  context: ExecContext,
): Promise<CommandOutcome> {
  updateProgress(context, { stage: "agent context", status: "running", message: "building context" });
  const bundle = await buildContextBundle({
    projectRoot,
    requestedScope: command.scope,
    effectivePolicy: context.effectivePolicy,
  });
  const contextArtifact = path.join(projectRoot, ".vos", "agent-context.json");
  await writeFile(contextArtifact, `${JSON.stringify(bundle, null, 2)}\n`);
  context.evidence.addArtifact("agent", path.relative(projectRoot, contextArtifact), "context bundle");
  return {
    status: "passed",
    details: bundle as unknown as Record<string, unknown>,
  };
}

export async function executeAgentPlan(
  command: AgentPlanCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const requestedScope = command.scope ?? "agent.plan";
  const projectRoot = context.projectRoot;
  updateProgress(context, { stage: "agent plan", status: "running", message: "building context" });
  const bundle = await buildContextBundle({ projectRoot, requestedScope, effectivePolicy: context.effectivePolicy });
  updateProgress(context, { stage: "agent plan", status: "running", message: "waiting for agent" });
  const agentProgress = createAgentProgressParams(context, "agent plan");
  const agentResult = await runAgentWithPrompt({
    projectRoot,
    taskPrompt: agentProgress.taskPrompt(command.task ?? `Plan the next VOS work for ${requestedScope}.`),
    taskKind: "plan",
    requestedScope,
    context: bundle,
    allowedPaths: bundle.allowed_paths,
    evidenceRefs: bundle.recent_evidence.map((entry) => entry.run_id),
    policyFlags: bundle.policy_flags,
    courseMode: true,
    allowedVosCommands: await loadAgentAllowedCommands(projectRoot, context.effectivePolicy),
    resultSubmissionSchema: "plan_draft.v1",
    extraMcpServers: agentProgress.extraMcpServers,
    onEvent: agentProgress.onEvent,
    taskRunner: context.agentRunner,
  });
  let parsed;
  try {
    parsed = parsePlanDraft(
      agentStructuredOutput(agentResult, "agent_plan"),
    );
  } catch (error) {
    await recordRawAgentOutput(evidence, "agent", "agent-plan-raw.txt", agentResult.resultText);
    throw error instanceof AgentOutputError
      ? error
      : new AgentOutputError(error instanceof Error ? error.message : String(error));
  }
  const logPath = await recordAICollaboration({
    projectRoot,
    event: {
      session_id: contextSessionId(context),
      task_kind: "plan",
      agent_profile: resolvePromptProfileEnvelope("plan"),
      related_specs: parsed.related_specs,
      allowed_paths: bundle.allowed_paths,
      output_kind: "plan",
      result: "accepted",
      created_at: new Date().toISOString(),
    },
  });
  evidence.addArtifact("agent", path.relative(projectRoot, logPath), "agent plan log");
  return {
    status: "passed",
    details: {
      plan: parsed,
      raw_events: agentResult.rawEvents,
      log: logPath,
    },
  };
}

export async function executeLogin(command: LoginCommand, context: ExecContext): Promise<CommandOutcome> {
  let token = command.token
    ?? (command.tokenStdin ? (await Bun.stdin.text()).trim() : undefined)
    ?? process.env.VOS_PORTAL_TOKEN;
  if (!token) {
    const client=context.portalClient??defaultPortalClient;
    if(!client.beginDeviceAuthorization||!client.pollDeviceAuthorization)throw new CliError("Portal does not support CLI device authorization","failed");
    const authorization=await client.beginDeviceAuthorization(command.portalUrl,"vos-cli");
    if(!context.global.json)console.error(`Open ${authorization.verification_uri} and enter code ${authorization.user_code}`);
    const deadline=Date.now()+authorization.expires_in*1000;
    while(Date.now()<deadline){await Bun.sleep(Math.max(2,authorization.interval)*1000);const result=await client.pollDeviceAuthorization(command.portalUrl,authorization.device_code);if(result.status==="approved"){token=result.access_token;break;}if(result.status==="access_denied")throw new CliError("device authorization denied","policy_blocked",{reason:"access_denied"});if(result.status==="expired_token")break;}
    if(!token)throw new CliError("device authorization expired","policy_blocked",{reason:"expired_token"});
  }
  let user;
  try {
    user = await (context.portalClient ?? defaultPortalClient).getMe(command.portalUrl, token);
  } catch (error) {
    throw new CliError("policy_blocked: token_invalid", "policy_blocked", {
      reason: "token_invalid",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const entry = await saveToken({
    portalUrl: command.portalUrl,
    token,
    user,
  });
  return {
    status: "passed",
    details: {
      portal_url: entry.portalUrl,
      user,
      message: "logged in",
    },
  };
}

export async function executeLogout(command: LogoutCommand, projectRoot: string, context?:ExecContext): Promise<CommandOutcome> {
  const project = await loadProjectConfig(projectRoot).catch(() => undefined);
  const portalUrl = command.portalUrl ?? project?.portal_url;
  if (!portalUrl) {
    return {
      status: "passed",
      details: {
        removed: false,
        message: "no portal binding",
      },
    };
  }
  const stored=await getToken(portalUrl);
  if(stored?.token&&context?.portalClient?.revokeToken)await context.portalClient.revokeToken(portalUrl,stored.token);
  else if(stored?.token)await defaultPortalClient.revokeToken(portalUrl,stored.token);
  const removed = await removeToken(portalUrl);
  return {
    status: "passed",
    details: {
      portal_url: normalizePortalUrl(portalUrl),
      removed,
      message: removed ? "logged out" : "no token found",
    },
  };
}

export async function executeWhoami(command: WhoamiCommand, projectRoot: string, context: ExecContext): Promise<CommandOutcome> {
  const project = await loadProjectConfig(projectRoot).catch(() => undefined);
  const portalUrl = command.portalUrl ?? project?.portal_url;
  if (!portalUrl) {
    return {
      status: "passed",
      details: {
        portal_url: null,
        project_id: project?.project_id,
        authenticated: false,
        policy_status: "local-only",
        message: "local-only project",
      },
    };
  }
  const stored = await getToken(portalUrl);
  if (!stored?.token) {
    return {
      status: "passed",
      details: {
        portal_url: normalizePortalUrl(portalUrl),
        project_id: project?.project_id,
        authenticated: false,
        policy_status: "not_logged_in",
        message: "not logged in",
      },
    };
  }
  try {
    const user = await (context.portalClient ?? defaultPortalClient).getMe(portalUrl, stored.token);
    await updateStoredUser(portalUrl, user);
    let policySnapshotRef: string | undefined;
    const boundProjectId=project?.project_id&&project.portal_url&&normalizePortalUrl(project.portal_url)===normalizePortalUrl(portalUrl)?project.project_id:undefined;
    if (boundProjectId) {
      const policy = await (context.portalClient ?? defaultPortalClient).getProjectPolicy(portalUrl, boundProjectId, stored.token);
      policySnapshotRef = policy.ref;
    }
    return {
      status: "passed",
      details: {
        portal_url: normalizePortalUrl(portalUrl),
        project_id: project?.project_id,
        authenticated: true,
        user,
        policy_status: boundProjectId ? "online" : "no_project_binding",
        policy_snapshot_ref: policySnapshotRef,
        message: "online",
      },
    };
  } catch (error) {
    return {
      status: "policy_blocked",
      details: {
        portal_url: normalizePortalUrl(portalUrl),
        project_id: project?.project_id,
        authenticated: false,
        policy_status: "policy_unavailable",
        message: error instanceof Error ? error.message : "policy unavailable",
      },
    };
  }
}

export async function executePortalPipeline(command:PortalPipelineCommand,context:ExecContext):Promise<CommandOutcome>{
  const project=await loadProjectConfig(context.projectRoot);if(!project.portal_url||!project.project_id)throw new CliError("pipeline commands require portal_url and project_id in .vos/project.yaml","policy_blocked",{reason:"portal_binding_missing"});
  const stored=await getToken(project.portal_url);if(!stored?.token)throw new CliError("policy_blocked: not_logged_in","policy_blocked",{reason:"not_logged_in"});
  const client=context.portalClient??defaultPortalClient;const requireMethod=<T>(method:T|undefined,name:string):T=>{if(!method)throw new CliError(`Portal client does not support ${name}`,"failed");return method;};
  if(command.action==="trigger"){const reproducible=await assertReproducible(context.projectRoot);const stage=await currentStageForProject(context.projectRoot);const method=requireMethod(client.triggerPipeline?.bind(client),"pipeline trigger");const run=await method(project.portal_url,stored.token,{version:"pipeline-request.v1",project_id:project.project_id,commit_sha:reproducible.commitSha!,stage_key:stage,scope:command.scope??"public",model_credential_id:command.modelCredentialId,reason:command.reason!});assertBoundProject(run.project_id,project.project_id,"pipeline");return{status:"passed",details:{run}};}
  const runId=command.runId!;
  if(command.action==="status"){const method=requireMethod(client.getPipeline?.bind(client),"pipeline status");const run=await method(project.portal_url,stored.token,runId);assertBoundProject(run.project_id,project.project_id,"pipeline");return{status:"passed",details:{run}};}
  if(command.action==="watch"){const method=requireMethod(client.watchPipeline?.bind(client),"pipeline watch");const events=await method(project.portal_url,stored.token,runId);const status=await requireMethod(client.getPipeline?.bind(client),"pipeline status")(project.portal_url,stored.token,runId);assertBoundProject(status.project_id,project.project_id,"pipeline");return{status:status.status==="passed"?"passed":status.status==="cancelled"?"cancelled":status.status==="timed_out"?"timed_out":"failed",details:{run:status,events}};}
  if(command.action==="cancel"){const method=requireMethod(client.cancelPipeline?.bind(client),"pipeline cancel");const run=await method(project.portal_url,stored.token,runId,command.reason!);assertBoundProject(run.project_id,project.project_id,"pipeline");return{status:"cancelled",details:{run}};}
  if(command.action==="reproduce"){const method=requireMethod(client.getReproduction?.bind(client),"pipeline reproduce");const reproduction=await method(project.portal_url,stored.token,runId);assertBoundProject(reproduction.project_id,project.project_id,"reproduction");return{status:"passed",details:{reproduction}};}
  if(command.action==="download"){
    const evidence=await requireMethod(client.getEvidence?.bind(client),"pipeline evidence")(project.portal_url,stored.token,runId);assertBoundProject(evidence.run.project_id,project.project_id,"evidence");
    if(evidence.artifacts.length===0)throw new CliError("No visible artifacts are available for this run","failed",{run_id:runId});
    const download=requireMethod(client.downloadArtifact?.bind(client),"pipeline download");const destination=path.resolve(context.projectRoot,command.outDir??path.join(".vos","downloads",runId));await mkdir(destination,{recursive:true});
    const files:string[]=[];const used=new Set<string>();for(const artifact of evidence.artifacts){const stem=`${artifact.id}-${artifact.label}`.replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^\.+/,"").slice(0,160)||artifact.id;let name=stem;let suffix=1;while(used.has(name)){name=`${stem}-${suffix++}`;}used.add(name);const target=path.join(destination,name);await download(project.portal_url,stored.token,artifact,target);files.push(path.relative(context.projectRoot,target));}
    return{status:"passed",details:{run_id:runId,destination:path.relative(context.projectRoot,destination),files,verified:true}};
  }
  const method=requireMethod(client.getEvidence?.bind(client),"pipeline evidence");const evidence=await method(project.portal_url,stored.token,runId);assertBoundProject(evidence.run.project_id,project.project_id,"evidence");return{status:"passed",details:{evidence}};
}

function assertBoundProject(actual:string,expected:string,resource:string):void{if(actual!==expected)throw new CliError(`Portal returned ${resource} for a different project`,"policy_blocked",{reason:"project_mismatch",expected_project_id:expected,actual_project_id:actual});}

export async function executeProjectBind(command:ProjectBindCommand,context:ExecContext):Promise<CommandOutcome>{const portalUrl=normalizePortalUrl(command.portalUrl);const stored=await getToken(portalUrl);if(!stored?.token)throw new CliError("project bind requires an authenticated Portal session","policy_blocked",{reason:"not_logged_in"});const client=context.portalClient??defaultPortalClient;if(!client.getProjectBinding)throw new CliError("Portal client does not support project binding","failed");const binding=await client.getProjectBinding(portalUrl,stored.token,command.projectId);if(binding.project_id!==command.projectId)throw new CliError("Portal returned a mismatched project binding","policy_blocked",{reason:"project_mismatch"});const projectPath=path.join(context.projectRoot,".vos","project.yaml");if(!existsSync(projectPath))throw new CliError("project configuration missing, run `vos init` first","validation_failed");let source=await readFile(projectPath,"utf8");const set=(key:string,value:string)=>{const line=`${key}: ${value}`;source=new RegExp(`^${key}:.*$`,"m").test(source)?source.replace(new RegExp(`^${key}:.*$`,"m"),line):`${source.trimEnd()}\n${line}\n`;};set("project_id",binding.project_id);set("portal_url",portalUrl);await writeFile(projectPath,source);return{status:"passed",details:{binding,project_file:path.relative(context.projectRoot,projectPath),message:"project binding updated; commit the binding before submitting"}};}

export async function executeLedgerRecord(
  command: LedgerRecordCommand,
  projectRoot: string,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const commitSha = currentHead(projectRoot);
  if (!commitSha) {
    throw new CliError("ledger record requires a git HEAD", "policy_blocked", { reason: "head_missing" });
  }
  const entry = await appendLedgerEntry(projectRoot, {
    commit_sha: commitSha,
    parent_sha: parentSha(projectRoot),
    actor: command.actor,
    run_id: evidence.run_id,
    spec_refs: command.specRefs,
    changed_targets: command.changedTargets,
    evidence_refs: [{ id: evidence.run_id, kind: "run", path: path.relative(projectRoot, evidence.manifest_path) }],
    collaboration_intent: command.intent,
  });
  return {
    status: "passed",
    details: {
      ledger: ".vos/commit-ledger.jsonl",
      commit_sha: entry.commit_sha,
      actor: entry.actor,
    },
  };
}

export async function executeKbAdd(
  command: KbAddCommand,
  context: ExecContext,
): Promise<CommandOutcome> {
  const { projectRoot, evidence } = context;
  const source = await addKbSource(projectRoot, {
    source: command.source,
    sourceKind: command.sourceKind,
    stage: command.stage,
    title: command.title,
    recursive: command.recursive,
    branch: command.branch,
    tag: command.tag,
  }, {
    embedder: createKbEmbedder(projectRoot),
    onProgress: (progress) => {
      updateProgress(context, {
        stage: "kb add",
        phase: progress.phase,
        current: progress.current,
        total: progress.total,
        percent: progress.percent,
        status: "running",
        message: progress.message,
      });
    },
  });
  updateProgress(context, { stage: "kb add", phase: "artifacts", percent: 96, status: "running", message: "writing add result" });
  const artifact = path.join(projectRoot, ".vos", "kb", "last-add.json");
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(source, null, 2)}\n`);
  evidence.addArtifact("kb", path.relative(projectRoot, artifact), "kb source added");
  if (command.manifestPath) {
    updateProgress(context, { stage: "kb add", phase: "manifest", percent: 98, status: "running", message: "exporting manifest" });
    const manifest = await exportKbManifest(projectRoot);
    const manifestPath = path.resolve(projectRoot, command.manifestPath);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    evidence.addArtifact("kb", path.relative(projectRoot, manifestPath), "kb object manifest");
  }
  return {
    status: "passed",
    details: {
      source,
      object_ref: source.object_ref,
      message: "kb source added",
    },
  };
}

export async function executeKbList(projectRoot: string): Promise<CommandOutcome> {
  const sources = await listKbSources(projectRoot);
  return {
    status: "passed",
    details: {
      count: sources.length,
      sources,
    },
  };
}

// ── seed status ────────────────────────────────────────────

interface SeedStatusFields {
  filled: boolean;
  lab: string;
}

const SEED_LAB_FIELDS: Record<string, string[]> = {
  "Lab 1 (identity)": ["id", "project", "domain", "target_platform", "language", "architecture_name", "architecture_summary"],
  "Lab 2 (boot)": ["constraints"],
  "Lab 3 (memory)": ["constraints"],
  "Lab 4 (interrupts)": [],
  "Lab 5 (user-space)": ["goals", "non_goals", "reference_systems"],
  "Lab 6 (filesystem)": [],
  "Lab 7 (resource-abi)": [],
  "Lab 8 (personal-goal)": [],
  "Lab 9 (hardware-port)": [],
  "Final Lab": ["initial_validation_binding"],
};

function isBlankValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string" && (v.trim() === "" || v.startsWith("TODO"))) return true;
  if (Array.isArray(v)) {
    if (v.length === 0) return true;
    return v.every((item) => typeof item === "string" && (item.trim() === "" || item.startsWith("TODO")));
  }
  return false;
}

export async function executeSeedStatus(projectRoot: string): Promise<CommandOutcome> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const yaml = await import("yaml");

  const seedPath = path.join(projectRoot, "spec", "architecture", "seed.yaml");
  let seedYaml: Record<string, unknown> | null = null;

  try {
    const raw = await fs.readFile(seedPath, "utf-8");
    const parsed = yaml.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      seedYaml = parsed as Record<string, unknown>;
    }
  } catch {
    // seed.yaml not found or unparseable
  }

  if (!seedYaml) {
    return {
      status: "validation_failed",
      details: {
        message: "seed.yaml not found at spec/architecture/seed.yaml",
        hint: "Run Lab 1 to create your seed skeleton.",
      },
    };
  }

  const fieldStatus: Record<string, SeedStatusFields> = {};
  for (const [lab, fields] of Object.entries(SEED_LAB_FIELDS)) {
    for (const field of fields) {
      const value = seedYaml[field];
      if (!fieldStatus[field]) {
        fieldStatus[field] = { filled: !isBlankValue(value), lab };
      } else if (!fieldStatus[field].filled && !isBlankValue(value)) {
        fieldStatus[field] = { filled: true, lab };
      }
    }
  }

  const filledFields = Object.entries(fieldStatus).filter(([, s]) => s.filled);
  const totalTracked = Object.keys(fieldStatus).length;
  const filledCount = filledFields.length;

  const completedLabs: string[] = [];
  if (fieldStatus["architecture_summary"]?.filled) completedLabs.push("Lab 1");
  if (fieldStatus["goals"]?.filled && fieldStatus["non_goals"]?.filled) completedLabs.push("Lab 5 (goals/non-goals)");
  if (fieldStatus["reference_systems"]?.filled) completedLabs.push("Lab 5 (reference systems)");

  return {
    status: "passed",
    details: {
      seedPath,
      filledCount,
      totalTracked,
      fields: Object.fromEntries(
        Object.entries(fieldStatus).map(([k, v]) => [k, v.filled ? "filled" : "blank"])
      ),
      completedLabs,
      summary: `${filledCount}/${totalTracked} fields filled — ${completedLabs.length > 0 ? completedLabs.join(", ") : "no labs completed yet"}`,
    },
  };
}

export async function executeKbSearch(command: KbSearchCommand, projectRoot: string): Promise<CommandOutcome> {
  const hits = await searchKb(projectRoot, command.query, { embedder: createKbEmbedder(projectRoot) });
  return {
    status: "passed",
    details: {
      query: command.query,
      hits,
    },
  };
}

export async function executeKbRemove(command: KbRemoveCommand, projectRoot: string): Promise<CommandOutcome> {
  const removed = await removeKbSource(projectRoot, command.id);
  return {
    status: removed ? "passed" : "validation_failed",
    details: {
      id: command.id,
      removed,
      message: removed ? "kb source removed" : "kb source not found",
    },
  };
}

export async function executeKbClear(projectRoot: string): Promise<CommandOutcome> {
  await clearKbSources(projectRoot);
  return {
    status: "passed",
    details: {
      cleared: true,
      message: "kb sources cleared",
    },
  };
}

export async function executeKbExportManifest(
  command: KbExportManifestCommand,
  projectRoot: string,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const manifest = await exportKbManifest(projectRoot);
  const outPath = path.resolve(projectRoot, command.outPath ?? path.join(".vos", "kb", "manifests", "object-manifest.json"));
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  evidence.addArtifact("kb", path.relative(projectRoot, outPath), "kb object manifest");
  return {
    status: "passed",
    details: {
      path: path.relative(projectRoot, outPath),
      manifest,
    },
  };
}

export async function executeKbImportManifest(
  command: KbImportManifestCommand,
  projectRoot: string,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const manifestPath = path.resolve(projectRoot, command.manifestPath);
  const manifest = await importKbManifest(projectRoot, JSON.parse(await readFile(manifestPath, "utf8")), { embedder: createKbEmbedder(projectRoot) });
  evidence.addArtifact("kb", path.relative(projectRoot, manifestPath), "kb object manifest imported");
  return {
    status: "passed",
    details: {
      manifest,
      source_count: manifest.sources.length,
      object_count: manifest.objects.length,
    },
  };
}

export async function executeBuildGenerate(
  command: BuildGenerateCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  if (command.noAgent) {
    return await writeDeterministicToolchainManifest(projectRoot, evidence, true);
  }
  const spec = await loadToolchainGenerationSpec(projectRoot);
  const agentResult = await runAgentWithPrompt({
    projectRoot,
    taskPrompt: "Generate the minimum VOS toolchain draft from the provided toolchain specs and allowed output paths.",
    taskKind: "toolchain_generate",
    requestedScope: "toolchain.generate",
    context: spec,
    allowedPaths: spec.allowedOutputPaths,
    courseMode: true,
    resultSubmissionSchema: "toolchain_generation_draft.v1",
    taskRunner: context.agentRunner,
  });
  let draft;
  try {
    draft = normalizeToolchainDraft(agentStructuredOutput(agentResult, "build_generate"));
  } catch (error) {
    if (error instanceof AgentOutputError) {
      await recordRawAgentOutput(evidence, "toolchain", "build-generate-raw.txt", agentResult.resultText);
    }
    throw error;
  }
  const specHash = hashString(JSON.stringify(spec));
  validateToolchainDraftPaths(draft, spec.allowedOutputPaths);

  for (const file of draft.files) {
    const target = path.join(projectRoot, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }

  const manifest = {
    ...draft.manifest,
    spec_hash: specHash,
    spec_path: "spec/toolchain/toolchain.yaml",
    generator: {
      ...((draft.manifest.generator && typeof draft.manifest.generator === "object") ? draft.manifest.generator as Record<string, unknown> : {}),
      name: ((draft.manifest.generator as { name?: unknown } | undefined)?.name as string | undefined) ?? "vos-agent",
      version: ((draft.manifest.generator as { version?: unknown } | undefined)?.version as string | undefined) ?? "toolchain-draft-v1",
    },
    environment: normalizeToolchainEnvironment(draft.manifest),
  };
  try {
    parseToolchainManifest(manifest);
  } catch (error) {
    await recordRawAgentOutput(evidence, "toolchain", "build-generate-raw.txt", agentResult.resultText);
    throw new AgentOutputError(error instanceof Error ? error.message : String(error));
  }
  const manifestPath = path.join(projectRoot, ".vos", "toolchain.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const instructionsPath = path.join(evidence.artifacts_root, "toolchain", "build-instructions.md");
  await mkdir(path.dirname(instructionsPath), { recursive: true });
  await writeFile(instructionsPath, `${draft.build_instructions.trim()}\n`);
  evidence.addArtifactFromPath("toolchain", instructionsPath, "agent build instructions");

  const changedTargets = [...new Set([...draft.changed_targets, ...draft.files.map((file) => file.path), ".vos/toolchain.json"])];
  git(projectRoot, ["add", ...changedTargets.filter((target) => !target.startsWith(".vos/"))]);
  const ignoredVosTargets = changedTargets.filter((target) => target.startsWith(".vos/"));
  if (ignoredVosTargets.length > 0) git(projectRoot, ["add", "-f", ...ignoredVosTargets]);
  git(projectRoot, ["commit", "-m", "[vos][toolchain] Generate build system"]);
  const commitSha = currentHead(projectRoot);
  if (commitSha) {
    await appendLedgerEntry(projectRoot, {
      commit_sha: commitSha,
      parent_sha: parentSha(projectRoot),
      actor: "agent",
      agent_session_id: command.agentSession ?? context.global.agentSession,
      run_id: evidence.run_id,
      spec_refs: draft.spec_refs,
      changed_targets: changedTargets,
      evidence_refs: [{ id: evidence.run_id, kind: "run", path: path.relative(projectRoot, evidence.manifest_path) }],
      collaboration_intent: "toolchain-generate",
    });
  }

  return {
    status: "passed",
    details: {
      spec_hash: specHash,
      changed_targets: changedTargets,
      manifest: ".vos/toolchain.json",
      message: "toolchain generated",
    },
  };
}

interface ToolchainLintResult {
  status: "passed" | "validation_failed";
  message: string;
  specPath: string;
  includedFiles: string[];
  allowedOutputPaths: string[];
  manifestExists: boolean;
  manifestPath?: string;
  issues: string[];
}

async function runToolchainLint(projectRoot: string): Promise<ToolchainLintResult> {
  const specRoot = path.join(projectRoot, "spec", "toolchain");
  const toolchainSpecPath = path.join(specRoot, "toolchain.yaml");
  let manifestPath = path.join(projectRoot, ".vos", "toolchain.json");

  const issues: string[] = [];
  let passed = true;

  if (!existsSync(specRoot)) {
    return {
      status: "validation_failed",
      message: "toolchain spec directory missing",
      specPath: toolchainSpecPath,
      includedFiles: [],
      allowedOutputPaths: [],
      manifestExists: false,
      issues: ["spec/toolchain directory not found"],
    };
  }

  if (!existsSync(toolchainSpecPath)) {
    return {
      status: "validation_failed",
      message: "toolchain spec index missing",
      specPath: toolchainSpecPath,
      includedFiles: [],
      allowedOutputPaths: [],
      manifestExists: existsSync(manifestPath),
      issues: ["toolchain.yaml is required at spec/toolchain/toolchain.yaml"],
    };
  }

  const toolchainText = await readFile(toolchainSpecPath, "utf8");
  const includes = parseYamlList(toolchainText, "includes");
  if (includes.length === 0) {
    issues.push("toolchain.yaml should include an `includes` list");
    passed = false;
  }

  const includedFiles = includes.map((value) => path.resolve(specRoot, value));
  const buildSpecPath = path.resolve(specRoot, "build.yaml");

  for (const file of includedFiles) {
    if (!existsSync(file)) {
      issues.push(`toolchain include missing: ${path.relative(projectRoot, file)}`);
      passed = false;
      continue;
    }
  }

  if (!existsSync(buildSpecPath) && !includes.includes("build.yaml")) {
    issues.push("toolchain build contract is missing (build.yaml)");
    passed = false;
  }

  let allowedOutputPaths: string[] = [];
  if (existsSync(buildSpecPath)) {
    const buildText = await readFile(buildSpecPath, "utf8");
    allowedOutputPaths = parseYamlList(buildText, "allowed_output_path");
    if (allowedOutputPaths.length === 0) {
      issues.push("build.allowed_output_path should contain at least one allowed path");
      passed = false;
    }
  }

  manifestPath = await resolveToolchainManifestPath({ projectRoot });
  if (existsSync(manifestPath)) {
    const manifestRaw = await readFile(manifestPath, "utf8");
    const manifest = safeJsonTryParse(manifestRaw);
    if (!manifest || typeof manifest !== "object") {
      issues.push("toolchain manifest is not valid JSON");
      passed = false;
    } else {
      const manifestFiles = collectManifestPaths(manifest as Record<string, unknown>);
      if (manifestFiles.length > 0 && allowedOutputPaths.length > 0) {
        const denied = manifestFiles.filter((entry) => !isPathAllowed(entry, allowedOutputPaths));
        if (denied.length > 0) {
          issues.push(`toolchain manifest has files outside allowed_output_path: ${denied.join(", ")}`);
          passed = false;
        }
      }
    }
  }

  return {
    status: passed ? "passed" : "validation_failed",
    message: passed ? "toolchain lint passed" : "toolchain lint failed",
    specPath: path.relative(projectRoot, toolchainSpecPath),
    includedFiles: includes,
    allowedOutputPaths,
    manifestExists: existsSync(manifestPath),
    manifestPath: existsSync(manifestPath) ? path.relative(projectRoot, manifestPath) : undefined,
    issues,
  };
}

function parseYamlList(raw: string, key: string): string[] {
  return collectStringListByKey(parseTopLevelYaml(raw), key);
}

function isPathAllowed(candidate: string, allowedPrefixes: string[]): boolean {
  if (allowedPrefixes.length === 0) return true;
  const normalized = normalizePath(candidate);
  return allowedPrefixes.some((prefix) => {
    const normalizedPrefix = normalizePath(prefix);
    return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}${path.sep}`);
  });
}

function normalizePath(raw: string): string {
  return path.normalize(raw.trim()).replace(/^\.?[\\/]/, "");
}

function collectManifestPaths(manifest: Record<string, unknown>): string[] {
  const out: string[] = [];
  const files = manifest["files"] as unknown;
  if (Array.isArray(files)) {
    for (const value of files) {
      if (typeof value === "string") out.push(value);
    }
  }
  return [...new Set(out)];
}

function isSuccessStatus(status: CommandStatus): boolean {
  return status === "passed" || status === "ok" || status === "planned";
}

export async function executeBuild(command: BuildCommand, context: ExecContext, evidence: EvidenceWriter, projectRoot: string): Promise<CommandOutcome> {
  if (existsSync(path.join(projectRoot, "vos.yaml"))) {
    updateProgress(context, { stage: "build", status: "running", message: command.dryRun ? "planning build" : "running build" });
    if (command.dryRun) {
      const manifest = await readStudentManifest(projectRoot);
      return { status: "planned", details: { target: "build", program: manifest.manifest.build.program, args: manifest.manifest.build.args, cwd: manifest.manifest.build.cwd, timeout: manifest.manifest.build.timeout } };
    }
    const runner = new ManifestRunner(projectRoot, context.signal);
    const result = await runner.build("build");
    const bundle = await runner.collectEvidence();
    const artifact = path.join(evidence.artifacts_root, "student-build.json");
    await writeFile(artifact, `${JSON.stringify({ result, bundle }, null, 2)}\n`);
    evidence.addArtifactFromPath("build", artifact, "student manifest build evidence");
    return { status: result.status === "passed" ? "passed" : result.status === "timed_out" ? "timed_out" : "failed", details: { ...result, evidence: bundle } };
  }
  updateProgress(context, { stage: "build", status: "running", message: command.dryRun ? "planning build" : "running build" });
  const result = await runBuildCommand({
    projectRoot,
    evidence,
    toolchainPath: command.toolchainPath,
    variant: command.variant,
    dryRun: command.dryRun,
    signal: context.signal,
  });
  return {
    status: result.status,
    details: {
      output: result.output,
      artifacts: result.artifacts,
      failedStep: result.failedStep,
      toolchain_environment: result.toolVersions,
    },
  };
}

export async function executeRunQemu(command: RunQemuCommand, context: ExecContext, evidence: EvidenceWriter, projectRoot: string): Promise<CommandOutcome> {
  if (existsSync(path.join(projectRoot, "vos.yaml"))) {
    if (command.listProfiles || command.listCases) {
      const manifest = await readStudentManifest(projectRoot);
      return { status: "passed", details: { profiles: manifest.manifest.runners.qemu ? ["qemu"] : [], cases: Object.keys(manifest.manifest.checks) } };
    }
    if (command.dryRun) {
      const manifest = await readStudentManifest(projectRoot);
      return { status: "planned", details: { target: "qemu", program: manifest.manifest.runners.qemu?.program, args: manifest.manifest.runners.qemu?.args } };
    }
    const runner = new QemuRunner(projectRoot, context.signal);
    const result = await runner.run("qemu");
    const bundle = await runner.collectEvidence();
    const artifact = path.join(evidence.artifacts_root, "student-qemu.json");
    await writeFile(artifact, `${JSON.stringify({ result, bundle }, null, 2)}\n`);
    evidence.addArtifactFromPath("qemu", artifact, "student QEMU evidence");
    return { status: result.status === "passed" ? "passed" : result.status === "timed_out" ? "timed_out" : "failed", details: { ...result, evidence: bundle } };
  }
  updateProgress(context, { stage: "run qemu", status: "running", message: command.dryRun ? "planning run" : "running qemu" });
  const result = await runQemuCommand({
    projectRoot,
    evidence,
    dryRun: command.dryRun,
    timeoutMs: command.timeoutMs,
    readyPattern: command.readyPattern,
    profileId: command.profileId,
    caseId: command.caseId,
    listProfiles: command.listProfiles,
    listCases: command.listCases,
    signal: context.signal,
  });
  return {
    status: result.status,
    details: {
      profileId: result.profileId,
      caseId: result.caseId,
      profiles: result.profiles,
      cases: result.cases,
      readyDetected: result.readyDetected,
      durationMs: result.durationMs,
      serialPath: result.serialPath,
      stderrPath: result.stderrPath,
      resultPath: result.resultPath,
      output: result.output,
    },
  };
}

export async function executeRunHardware(command: RunHardwareCommand, context: ExecContext, evidence: EvidenceWriter, projectRoot: string): Promise<CommandOutcome> {
  if (!existsSync(path.join(projectRoot, "vos.yaml"))) {
    throw new CliError("run hardware requires a v2 vos.yaml manifest", "validation_failed");
  }
  if (command.dryRun) {
    const manifest = await readStudentManifest(projectRoot);
    return { status: "planned", details: { target: "hardware", program: manifest.manifest.runners.hardware?.program, args: manifest.manifest.runners.hardware?.args, human_review: "pending_human_review" } };
  }
  const runner = new HardwareRunner(projectRoot, context.signal);
  const result = await runner.run("hardware");
  const bundle = await runner.collectEvidence();
  const artifact = path.join(evidence.artifacts_root, "student-hardware.json");
  await writeFile(artifact, `${JSON.stringify({ result, bundle }, null, 2)}\n`);
  evidence.addArtifactFromPath("hardware", artifact, "student hardware evidence pending human review");
  return { status: result.status === "passed" ? "passed" : result.status === "timed_out" ? "timed_out" : "failed", details: { ...result, human_review: "pending_human_review", evidence: bundle } };
}

export async function executeTest(command: TestCommand, context: ExecContext, evidence: EvidenceWriter, projectRoot: string): Promise<CommandOutcome> {
  updateProgress(context, { stage: "test", status: "running", message: command.dryRun ? "planning tests" : "running tests" });
  const result = await runTestCommand({
    projectRoot,
    evidence,
    suites: command.suites,
    dryRun: command.dryRun,
    signal: context.signal,
  });
  return {
    status: result.status,
    details: {
      suiteCount: result.suiteCount,
      passedCount: result.passedCount,
      failedCount: result.failedCount,
      details: result.details,
    },
  };
}

export async function executeVerify(
  command: VerifyCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  if (existsSync(path.join(projectRoot, "vos.yaml"))) {
    return executeStudentVerify(command, context, evidence);
  }
  updateProgress(context, { stage: "verify", status: "running", message: `verifying ${command.scope}` });
  const result = await runVerifyCommand({
    projectRoot,
    evidence,
    scope: command.scope,
    target: command.target,
    dryRun: command.dryRun,
    staffPolicy: command.staffPolicy,
    visibilityScope: context.effectivePolicy?.visibilityScope,
    behaviorTestRunner: createVerifyBehaviorTestRunner(context, projectRoot),
    signal: context.signal,
  });
  const debug = result.status === "passed" || result.status === "ok"
    ? undefined
    : {
      run_id: evidence.run_id,
      command: `vos agent debug --run ${evidence.run_id}`,
    };
  return {
    status: result.status,
    details: {
      scope: result.scope,
      scopeTarget: command.target,
      steps: result.steps,
      requiredChecks: result.requiredChecks,
      publicSummaryPath: result.publicSummaryPath,
      ...(debug ? { debug } : {}),
    },
  };
}

async function executeStudentVerify(
  command: VerifyCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  updateProgress(context, { stage: "verify", status: "running", message: "checking student contract" });
  const bundle = await buildNormalizedSpecBundle({ projectRoot });
  const diagnostics = [...bundle.diagnostics];
  if (!bundle.design) diagnostics.push({ severity: "error", code: "design.missing", message: "spec/design.yaml is required", path: "spec/design.yaml" });
  if (bundle.normalized_modules.length === 0) diagnostics.push({ severity: "error", code: "module.missing", message: "at least one ModuleSpec is required", path: "spec/modules" });
  if (!bundle.manifest || bundle.manifest.checks.length === 0) diagnostics.push({ severity: "error", code: "manifest.checks_missing", message: "vos.yaml must declare at least one public or contract check", path: "vos.yaml/checks" });
  if (hasBlockingDiagnostics(diagnostics)) {
    return { status: "validation_failed", details: { diagnostics, checks: [], clean_head: false, submittable: false } };
  }
  if (command.dryRun) {
    const manifest = await readStudentManifest(projectRoot);
    return { status: "planned", details: { diagnostics, checks: Object.keys(manifest.manifest.checks), build: manifest.manifest.build.program } };
  }
  const runner = new HostRunner(projectRoot, context.signal);
  const build = await runner.build("build");
  const checks = [] as Array<Awaited<ReturnType<ManifestRunner["check"]>>>;
  if (build.status === "passed") {
    const manifest = await readStudentManifest(projectRoot);
    const selected = command.target ? [command.target] : Object.keys(manifest.manifest.checks);
    for (const id of selected) {
      checks.push(await runner.check(id));
    }
  }
  const collected = await runner.collectEvidence();
  const publicPassed = build.status === "passed" && checks.every((check) => check.status === "passed") && collected.cleanHead;
  const hidden = command.hidden && publicPassed
    ? await executeStudentHiddenVerification(projectRoot, bundle, context.signal)
    : undefined;
  const artifact = path.join(evidence.artifacts_root, "student-verify.json");
  await writeFile(artifact, `${JSON.stringify({ diagnostics, build, checks, hidden, evidence: collected }, null, 2)}\n`);
  evidence.addArtifactFromPath("verify", artifact, "deterministic student verification evidence");
  const passed = publicPassed && (!command.hidden || hidden?.status === "passed");
  return {
    status: passed ? "passed" : build.status === "timed_out" || checks.some((check) => check.status === "timed_out") || hidden?.results.some((result) => result.status === "timed_out") ? "timed_out" : "validation_failed",
    details: { diagnostics, build, checks, hidden, evidence: collected, clean_head: collected.cleanHead, submittable: passed },
  };
}

interface StudentHiddenVerification {
  status: "passed" | "validation_failed";
  commit_sha: string;
  spec_hash: string;
  config_hash: string;
  manifest_path: string;
  results: Array<Record<string, unknown> & { status: "passed" | "failed" | "timed_out" }>;
  verification_path: string;
}

async function executeStudentHiddenVerification(projectRoot: string, bundle: NormalizedSpecBundle, signal?: AbortSignal): Promise<StudentHiddenVerification> {
  const commitSha = currentHead(projectRoot);
  if (!commitSha) throw new CliError("hidden verification requires a committed HEAD", "policy_blocked", { reason: "head_missing" });
  const specHash = hashString(JSON.stringify(bundle.hashes));
  const configHash = hashString(await readFile(path.join(projectRoot, "vos.yaml"), "utf8"));
  const root = path.join(projectRoot, ".vos", "hidden-tests", specHash);
  const manifestPath = path.join(root, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new CliError("no hidden tests are bound to the current Spec hash; rerun vos agent implement", "validation_failed", { spec_hash: specHash });
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!isRecord(manifest) || manifest.version !== "vos.hidden-tests.v1" || manifest.spec_hash !== specHash || manifest.config_hash !== configHash || !Array.isArray(manifest.tests)) {
    throw new CliError("hidden tests are not bound to the current Spec and vos.yaml", "validation_failed", { reason: "hidden_binding_mismatch" });
  }
  const results = [] as StudentHiddenVerification["results"];
  for (const raw of manifest.tests) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.path !== "string" || typeof raw.content_hash !== "string" || typeof raw.program !== "string" || !isStringArray(raw.args) || typeof raw.cwd !== "string" || !isStringArray(raw.env) || !isPositiveInteger(raw.timeout)) {
      throw new CliError("hidden test manifest contains an invalid command", "validation_failed");
    }
    assertSafeStudentRelativePath(raw.path, `hidden test ${raw.id} path`);
    const hiddenFile = path.resolve(projectRoot, raw.path);
    if (!existsSync(hiddenFile) || hashString(await readFile(hiddenFile, "utf8")) !== raw.content_hash) {
      throw new CliError(`hidden test ${raw.id} content does not match its bound hash`, "validation_failed", { reason: "hidden_content_mismatch", hidden_test: raw.id });
    }
    const result = await runStructuredStudentCommand(projectRoot, {
      program: raw.program,
      args: canonicalStudentHiddenArgs(raw.path, raw.args),
      cwd: raw.cwd,
      env: raw.env,
      timeout: raw.timeout,
    }, signal);
    results.push({ id: raw.id, ...result });
  }
  const status = results.length > 0 && results.every((result) => result.status === "passed") ? "passed" : "validation_failed";
  const verificationPath = path.join(root, "last-verification.json");
  await writeFile(verificationPath, `${JSON.stringify({ version: "vos.hidden-verification.v1", status, commit_sha: commitSha, spec_hash: specHash, config_hash: configHash, manifest_hash: hashString(await readFile(manifestPath, "utf8")), results }, null, 2)}\n`);
  return {
    status,
    commit_sha: commitSha,
    spec_hash: specHash,
    config_hash: configHash,
    manifest_path: studentRelativePath(projectRoot, manifestPath),
    results,
    verification_path: studentRelativePath(projectRoot, verificationPath),
  };
}

function canonicalStudentHiddenArgs(hiddenPath: string, args: string[]): string[] {
  return [hiddenPath, ...args.filter((value) => value !== hiddenPath && value !== "{hidden_test}")];
}

function createVerifyBehaviorTestRunner(context: ExecContext, projectRoot: string): BehaviorTestRunner {
  return async (request) => {
    const agentProgress = createAgentProgressParams(context, `verify ${request.phase} behavior`);
    const result = await runAgentWithPrompt({
      projectRoot,
      taskPrompt: agentProgress.taskPrompt(request.prompt),
      taskKind: "validate",
      requestedScope: `verify.${request.phase}.behavior.${request.kind}`,
      courseMode: true,
      allowedVosCommands: await loadAgentAllowedCommands(projectRoot, context.effectivePolicy),
      resultSubmissionSchema: request.kind === "plan" ? "behavior_test_plan.v1" : "behavior_test_patch.v1",
      extraMcpServers: agentProgress.extraMcpServers,
      onEvent: agentProgress.onEvent,
      taskRunner: context.agentRunner,
    });
    return result.resultText;
  };
}

export async function executeAgentServe(command: AgentServeCommand, projectRoot: string, evidence: EvidenceWriter): Promise<CommandOutcome> {
  const server = startAgentServer({
    projectRoot,
    host: command.host,
    port: command.port,
  });
  const serveLog = path.join(projectRoot, ".vos", "agent-serve.log");
  const content = `serving package vos-agent/headless at ${server.url} at ${new Date().toISOString()}\n`;
  await writeFile(serveLog, content);
  evidence.addArtifact("agent", path.relative(projectRoot, serveLog), "agent serve intent");
  return {
    status: "passed",
    details: {
      host: server.host,
      port: server.port,
      url: server.url,
      package_api: "vos-agent/headless:startAgentHttpServer",
    },
  };
}

export async function executeAgentGenerate(
  command: AgentGenerateCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  if (command.run && !command.build) {
    throw new CliError("`agent generate --run` requires `--build`", "failed");
  }
  if (command.build && !command.apply) {
    throw new CliError("`agent generate --build` requires `--apply`", "failed");
  }

  const projectRoot = context.projectRoot;
  updateProgress(context, { stage: "agent generate", status: "running", message: "building context" });
  const bundle = await buildContextBundle({
    projectRoot,
    requestedScope: "agent.generate",
    effectivePolicy: context.effectivePolicy,
  });
  const task = command.task ?? command.target ?? bundle.current_stage;
  updateProgress(context, { stage: "agent generate", status: "running", message: "waiting for agent" });
  const agentProgress = createAgentProgressParams(context, "agent generate");
  let agentResult = await runAgentWithPrompt({
    projectRoot,
    taskPrompt: agentProgress.taskPrompt(`Generate a spec-bound patch for ${task}.`),
    taskKind: "codegen",
    requestedScope: "agent.generate",
    context: { bundle, build_requested: command.build, run_requested: command.run },
    allowedPaths: bundle.allowed_paths,
    evidenceRefs: bundle.recent_evidence.map((entry) => entry.run_id),
    policyFlags: bundle.policy_flags,
    courseMode: true,
    allowedVosCommands: await loadAgentAllowedCommands(projectRoot, context.effectivePolicy),
    resultSubmissionSchema: "spec_compiler_output.v1",
    extraMcpServers: agentProgress.extraMcpServers,
    onEvent: agentProgress.onEvent,
    taskRunner: context.agentRunner,
  });
  const rawResponsePath = path.join(projectRoot, ".vos", "agent-generate-raw.txt");
  let parsed;
  try {
    parsed = parsePatchProposal(agentStructuredOutput(agentResult, "agent_generate"));
  } catch (error) {
    await mkdir(path.dirname(rawResponsePath), { recursive: true });
    await writeFile(rawResponsePath, `${agentResult.resultText}\n`);
    evidence.addArtifact("agent", path.relative(projectRoot, rawResponsePath), "raw agent generate response");
    throw error;
  }
  let applyStatus: "skipped" | "ok" | "failed" = "skipped";
  let applyOutput: string | undefined;
  let applyValidationSummary: unknown[] = [];
  let runStatus: "skipped" | "ok" | "failed" | "timed_out" = "skipped";
  let runOutput: string | undefined;
  let resultStatus: CommandStatus = "passed";
  if (command.apply) {
    updateProgress(context, { stage: "agent generate", status: "running", message: "applying patch", percent: 70 });
    const applyResult = await applyPatchText({
      projectRoot,
      patchText: parsed.patch,
      specBindings: parsed.bound_clauses,
      allowedPaths: bundle.allowed_paths,
      requireSpec: true,
      runValidation: command.build || command.run,
      evidence,
    });
    applyStatus = applyResult.status;
    applyOutput = applyResult.output;
    applyValidationSummary = applyResult.validationSummary ?? [];
    if (applyResult.reason === "policy_violation") {
      resultStatus = "policy_blocked";
    } else if (applyResult.validationRun && applyResult.validationStatus === "failed") {
      resultStatus = "validation_failed";
    } else if (applyStatus === "failed") {
      resultStatus = "failed";
    }
    if (command.build && applyResult.validationRun) {
      const applySummaryPath = path.join(evidence.artifacts_root, "agent", "agent-generate-apply.json");
      await mkdir(path.dirname(applySummaryPath), { recursive: true });
      await writeFile(applySummaryPath, `${JSON.stringify({
        status: applyResult.status,
        changedPaths: applyResult.changedPaths,
        validationStatus: applyResult.validationStatus,
        validationSummary: applyResult.validationSummary ?? [],
      })}\n`);
      evidence.addArtifactFromPath("agent", applySummaryPath, "agent-generated patch applied");
    } else if (command.apply) {
      const applySummaryPath = path.join(evidence.artifacts_root, "agent", "agent-generate-apply.json");
      await mkdir(path.dirname(applySummaryPath), { recursive: true });
      await writeFile(applySummaryPath, `${JSON.stringify({
        status: applyResult.status,
        changedPaths: applyResult.changedPaths,
        validationStatus: applyResult.validationStatus,
        validationSummary: applyResult.validationSummary ?? [],
      })}\n`);
      evidence.addArtifactFromPath("agent", applySummaryPath, "agent-generated patch apply result");
    }
    if (applyResult.status === "ok" && command.run) {
      updateProgress(context, { stage: "agent generate", status: "running", message: "running qemu", percent: 88 });
      const runResult = await runQemuCommand({
        projectRoot,
        evidence,
        dryRun: false,
        signal: context.signal,
      });
      runStatus = runResult.status;
      runOutput = runResult.output;
      if (runResult.status === "failed" || runResult.status === "timed_out") {
        resultStatus = runResult.status;
      }
    }
  }

  const details = {
    proposal: parsed,
    apply: command.apply,
    buildRequested: command.build,
    runRequested: command.run,
    applyStatus,
    applyOutput,
    applyValidationSummary,
    runStatus,
    runOutput,
  };
  const bundlePath = path.join(projectRoot, ".vos", "agent-generate.json");
  await writeFile(bundlePath, `${JSON.stringify(details, null, 2)}\n`);
  evidence.addArtifact("agent", path.relative(projectRoot, bundlePath), "agent generate proposal");
  return {
    status: resultStatus,
    details,
  };
}

export async function executeAgentApplyPatch(
  command: AgentApplyPatchCommand,
  projectRoot: string,
  evidence: EvidenceWriter,
  effectivePolicy?: EffectivePolicy,
): Promise<CommandOutcome> {
  const patchText = command.patchFile
    ? await readFile(path.resolve(projectRoot, command.patchFile), "utf8")
    : await readPatchFromStdin();
  const result = await applyPatchText({
    projectRoot,
    patchText,
    allowedPaths: effectivePolicy?.source === "portal"
      ? effectivePolicy.allowedPaths
      : await loadAgentAllowedPaths(projectRoot),
    requireSpec: command.requireSpec,
    runValidation: command.runValidation,
    evidence,
  });
  const artifact = path.join(projectRoot, ".vos", "agent", "apply-patch-last.txt");
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(result, null, 2)}\n`);
  evidence.addArtifact("agent", path.relative(projectRoot, artifact), "apply-patch result");
  const status: CommandStatus = command.runValidation && result.validationStatus === "failed"
    ? "validation_failed"
    : result.reason === "policy_violation"
      ? "policy_blocked"
      : result.status;
  return {
    status,
    details: result as unknown as Record<string, unknown>,
  };
}

export async function executeAgentAsk(
  command: AgentAskCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const studentProject = existsSync(path.join(projectRoot, "vos.yaml")) && !isLegacyProject(projectRoot);
  const readonlyBefore = studentProject ? await studentGitFingerprint(projectRoot) : undefined;
  const studentHasKbSources = studentProject && (await listKbSources(projectRoot)).length > 0;
  const requestedScope = studentProject
    ? "student-kb"
    : command.scope ?? await currentStageForProject(projectRoot).catch(() => "agent.ask");
  updateProgress(context, { stage: "agent ask", status: "running", message: "building context" });
  const bundle = await buildContextBundle({
    projectRoot,
    requestedScope,
    effectivePolicy: context.effectivePolicy,
  });
  const embedder = !studentProject || studentHasKbSources ? createKbEmbedder(projectRoot) : undefined;
  const kbHits = command.question && embedder
    ? await searchKb(projectRoot, command.question, { limit: 5, embedder })
    : [];
  const kbManifest = await exportKbManifest(projectRoot);
  await evidence.appendEvent({
    type: "progress",
    visibility: "agent-only",
    payload: {
      kind: "kb_query",
      query: command.question,
      visible_hits: kbHits,
      source_manifest: kbManifest,
      policy: context.effectivePolicy?.visibilityScope ?? "local",
    },
  });
  const kbMcpServer = embedder ? {
    name: "vos-kb",
    command: process.execPath,
    args: [path.resolve(import.meta.dir, "../../../packages/vos-kb/src/mcp.ts")],
    cwd: projectRoot,
    env: { VOS_PROJECT_ROOT: projectRoot, ...kbEmbeddingEnv(projectRoot) },
  } : undefined;
  if (command.interactive) {
    updateProgress(context, { stage: "agent ask", status: "running", message: "starting interactive repl" });
    context.progress?.hide();
    await runAgentInteractiveTask({
      projectRoot,
      taskKind: "knowledgebase_qa",
      requestedScope,
      initialTask: command.question,
      context: { bundle, kb_hits: kbHits, object_manifest: kbManifest },
      courseMode: true,
      allowedVosCommands: await loadAgentAllowedCommands(projectRoot, context.effectivePolicy),
      extraMcpServers: kbMcpServer ? [kbMcpServer] : [],
      runner: context.interactiveAgentRunner,
    });
    if (readonlyBefore) assertStudentReadonlyFingerprint(readonlyBefore, await studentGitFingerprint(projectRoot), "agent ask");
    return {
      status: "passed",
      details: {
        interactive: true,
        scope: requestedScope,
        initial_question: command.question,
      },
    };
  }
  if (!command.question) {
    throw new CliError("agent ask requires a question unless interactive mode is enabled", "failed");
  }
  updateProgress(context, { stage: "agent ask", status: "running", message: "waiting for agent" });
  const agentProgress = createAgentProgressParams(context, "agent ask");
  const response = await runAgentWithPrompt({
    projectRoot,
    taskPrompt: agentProgress.taskPrompt(command.question),
    taskKind: "knowledgebase_qa",
    requestedScope,
    context: { bundle, kb_hits: kbHits, object_manifest: kbManifest },
    evidenceRefs: bundle.recent_evidence.map((entry) => entry.run_id),
    policyFlags: bundle.policy_flags,
    courseMode: true,
    allowedVosCommands: await loadAgentAllowedCommands(projectRoot, context.effectivePolicy),
    resultSubmissionSchema: "knowledgebase_answer.v1",
    extraMcpServers: [
      ...agentProgress.extraMcpServers,
      ...(kbMcpServer ? [kbMcpServer] : []),
    ],
    onEvent: agentProgress.onEvent,
    taskRunner: context.agentRunner,
  });
  let parsed: ReturnType<typeof parseKnowledgebaseAnswer>;
  try {
    parsed = parseKnowledgebaseAnswer(agentStructuredOutput(response, "agent_ask"));
  } catch (error) {
    const rawPath = await recordRawAgentOutput(evidence, "agent", "agent-ask-raw.txt", response.resultText);
    throw new AgentOutputError(`knowledgebase answer does not match knowledgebase_answer.v1: ${error instanceof Error ? error.message : String(error)}`, {
      schema: "knowledgebase_answer.v1",
      schema_error: error instanceof Error ? error.message : String(error),
      raw_artifact: path.relative(evidence.artifacts_root, rawPath),
      suggested_next_commands: ["rerun `vos agent ask` or inspect the raw artifact"],
    });
  }
  const artifact = path.join(projectRoot, ".vos", "agent-ask.json");
  await writeFile(artifact, `${JSON.stringify({ question: command.question, answer: parsed, kb_hits: kbHits, object_manifest: kbManifest }, null, 2)}\n`);
  evidence.addArtifact("agent", path.relative(projectRoot, artifact), "knowledgebase answer");
  const logPath = await recordAICollaboration({
    projectRoot,
    event: {
      session_id: contextSessionId(context),
      task_kind: "knowledgebase_qa",
      agent_profile: resolvePromptProfileEnvelope("knowledgebase_qa"),
      related_specs: bundle.resolved_specs,
      allowed_paths: bundle.allowed_paths,
      output_kind: "knowledgebase_answer",
      result: "accepted",
      created_at: new Date().toISOString(),
      evidence_ref: path.relative(projectRoot, artifact),
    },
  });
  evidence.addArtifact("agent", path.relative(projectRoot, logPath), "agent ask log");
  if (readonlyBefore) assertStudentReadonlyFingerprint(readonlyBefore, await studentGitFingerprint(projectRoot), "agent ask");
  return {
    status: "passed",
    details: {
      question: command.question,
      scope: requestedScope,
      answer: parsed,
      kb_hits: kbHits,
      object_manifest: kbManifest,
      raw_events: response.rawEvents,
    },
  };
}

export async function executeAgentValidateGenerated(
  command: AgentValidateGeneratedCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  return executeDebugTrace({
    context,
    evidence,
    target: command.target,
    patchFile: command.patchFile,
    keepWorktree: command.keepWorktree,
    requestedScope: "agent.validate-generated",
  });
}

async function executeDebugTrace(params: {
  context: ExecContext;
  evidence: EvidenceWriter;
  target: string;
  patchFile?: string;
  keepWorktree: boolean;
  requestedScope: string;
}): Promise<CommandOutcome> {
  const { context, evidence } = params;
  const projectRoot = context.projectRoot;
  updateProgress(context, { stage: "agent debug trace", status: "running", message: "checking worktree" });
  await ensureCleanGitWorktree(projectRoot);
  const recentEvidence = await collectRunManifestSummaries(projectRoot);
  const traceInput = await buildDebugTraceInput({
    projectRoot,
    target: params.target,
    recentEvidence,
  });
  const rawEvents: Array<Record<string, unknown>> = [];
  let prompt = buildAgentDebugTracePrompt(traceInput);
  let lastAgentOutput = "";
  let lastError: unknown;
  for (let attempt = 1; attempt <= DEBUG_TRACE_AGENT_ATTEMPTS; attempt++) {
    updateProgress(context, { stage: "agent debug trace", status: "running", message: `agent attempt ${attempt}`, current: attempt, total: DEBUG_TRACE_AGENT_ATTEMPTS });
    const agentProgress = createAgentProgressParams(context, "agent debug trace");
    const agentResult = await runAgentWithPrompt({
      projectRoot,
      taskPrompt: agentProgress.taskPrompt(prompt),
      taskKind: "debug_trace",
      requestedScope: params.requestedScope,
      context: traceInput,
      courseMode: true,
      allowedVosCommands: await loadAgentAllowedCommands(projectRoot, context.effectivePolicy),
      resultSubmissionSchema: "debug_trace_plan.v1",
      extraMcpServers: agentProgress.extraMcpServers,
      onEvent: agentProgress.onEvent,
      taskRunner: context.agentRunner,
    });
    rawEvents.push(...agentResult.rawEvents);
    lastAgentOutput = agentTracePlanText(agentResult);
    try {
      const result = await runAgentDebugTrace({
        projectRoot,
        evidence,
        target: params.target,
        patchFile: params.patchFile,
        keepWorktree: params.keepWorktree,
        agentPlanText: lastAgentOutput,
        recentEvidence,
      });

      if (result.status === "passed" || attempt >= DEBUG_TRACE_AGENT_ATTEMPTS) {
        return {
          status: result.status,
          details: {
            target: params.target,
            worktree: path.relative(projectRoot, result.worktreePath),
            worktreeBranch: result.worktreeBranch,
            worktreeKept: result.worktreeKept,
            plan: path.relative(projectRoot, result.planPath),
            summary: path.relative(projectRoot, result.summaryPath),
            caseCount: result.cases.length,
            passedCount: result.cases.filter((item) => item.status === "ok").length,
            failedCount: result.cases.filter((item) => item.status === "failed").length,
            cases: result.cases,
            agentAttempts: attempt,
            raw_events: rawEvents,
          },
        };
      }

      prompt = buildAgentDebugTraceRepairPrompt({
        input: traceInput,
        previousOutput: lastAgentOutput,
        errorMessage: debugTraceFailureSummary(result),
        patchAlreadyBuilt: true,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= DEBUG_TRACE_AGENT_ATTEMPTS || !isTracePlanFeedbackError(error)) {
        throw error;
      }
      prompt = buildAgentDebugTraceRepairPrompt({
        input: traceInput,
        previousOutput: lastAgentOutput,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw lastError instanceof Error ? lastError : new CliError("agent debug trace failed", "validation_failed");
}

export async function executeAgentDebug(
  command: AgentDebugCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  // Keep the frozen Portal/legacy command path intact. Student v2 projects are
  // identified by vos.yaml and use the deterministic, read-only debug report
  // below; legacy projects still expose their existing interactive profile.
  if (!existsSync(path.join(projectRoot, "vos.yaml")) && !command.logPath && !command.runId) {
    updateProgress(context, { stage: "agent debug", status: "running", message: "starting interactive repl" });
    context.progress?.hide();
    await runAgentInteractiveTask({
      projectRoot,
      taskKind: "debug",
      requestedScope: "agent.debug",
      courseMode: true,
      allowedVosCommands: await loadAgentAllowedCommands(projectRoot, context.effectivePolicy),
      runner: context.interactiveAgentRunner,
    });
    return {
      status: "passed",
      details: {
        interactive: true,
        profile: "debug",
      },
    };
  }
  if (!command.logPath && !command.runId) {
    const bundle = await buildNormalizedSpecBundle({ projectRoot });
    const state = await studentGitStatus(projectRoot).catch(() => ({ clean: false, changed: [] as string[] }));
    const logPath = await findLatestLogPath(projectRoot);
    const text = logPath && existsSync(logPath) ? await readFile(logPath, "utf8") : "";
    const suspectLines = text.split(/\r?\n/).filter((line) => /error|fail|panic|assert|timeout|segfault/i.test(line));
    const artifact = path.join(evidence.artifacts_root, "student-debug.json");
    await writeFile(artifact, `${JSON.stringify({ role: "debug", root_cause: suspectLines[0] ?? (bundle.diagnostics[0]?.message ?? "no deterministic failure evidence"), evidence: suspectLines.slice(0, 20), diagnostics: bundle.diagnostics, clean_head: state.clean, changed_targets: state.changed }, null, 2)}\n`);
    evidence.addArtifactFromPath("agent", artifact, "read-only student debug evidence");
    return { status: "passed", details: { role: "debug", root_cause: suspectLines[0] ?? (bundle.diagnostics[0]?.message ?? "no deterministic failure evidence"), evidence: suspectLines.slice(0, 20), diagnostics: bundle.diagnostics, clean_head: state.clean, changed_targets: state.changed, model_used: false } };
  }

  updateProgress(context, { stage: "agent debug", status: "running", message: "loading log" });
  const runContext = command.runId ? await loadDebugRunContext(projectRoot, command.runId) : undefined;
  const debugTarget = runContext ? inferDebugTarget(runContext) : undefined;
  const debugRoot = path.join(evidence.artifacts_root, "agent-debug");
  await mkdir(debugRoot, { recursive: true });
  const traceEvidence = runContext
    ? await prepareAgentDebugTraceEvidence({
      projectRoot,
      context,
      evidence,
      debugRoot,
      target: debugTarget ?? "full-syscall",
      keepWorktree: command.keepWorktree,
    })
    : undefined;
  const adapterContractPath = runContext
    ? await writeGdbAdapterContract(projectRoot, evidence, debugRoot, runContext, debugTarget ?? "full-syscall")
    : undefined;
  const logPath = command.logPath ?? (runContext?.primaryLogPath ?? await findLatestLogPath(projectRoot));
  if (!logPath) {
    return { status: "failed", details: { message: "log path required" } };
  }
  const text = await readFile(logPath, "utf8");
  const readonlyBefore = existsSync(path.join(projectRoot, "vos.yaml")) ? await studentGitFingerprint(projectRoot) : undefined;
  updateProgress(context, { stage: "agent debug", status: "running", message: "waiting for agent" });
  const agentProgress = createAgentProgressParams(context, "agent debug");
  let response: Awaited<ReturnType<typeof runAgentWithPrompt>>;
  try {
    response = await runAgentWithPrompt({
      projectRoot,
      taskPrompt: agentProgress.taskPrompt(`Diagnose VOS run failure from ${path.basename(logPath)}.`),
      taskKind: "debug",
      requestedScope: "agent.debug",
      context: {
        log_ref: path.basename(logPath),
        log_text: text,
        run_context: runContext,
        trace_evidence: traceEvidence,
        gdb_adapter_contract: adapterContractPath ? path.relative(projectRoot, adapterContractPath) : undefined,
        debug_target: debugTarget,
      },
      evidenceRefs: [
        ...(command.runId ? [command.runId] : []),
        ...(traceEvidence?.summaryPath ? [path.relative(projectRoot, traceEvidence.summaryPath)] : []),
        ...(adapterContractPath ? [path.relative(projectRoot, adapterContractPath)] : []),
      ],
      courseMode: true,
      allowedVosCommands: await loadAgentAllowedCommands(projectRoot, context.effectivePolicy),
      resultSubmissionSchema: "debug_output.v1",
      extraMcpServers: agentProgress.extraMcpServers,
      onEvent: agentProgress.onEvent,
      taskRunner: context.agentRunner,
    });
  } catch (error) {
    if (readonlyBefore) assertStudentReadonlyFingerprint(readonlyBefore, await studentGitFingerprint(projectRoot), "agent debug");
    if (!command.runId) throw error;
    const failurePath = await writeGdbFailureArtifact(projectRoot, evidence, debugRoot, error, adapterContractPath);
    return {
      status: "failed",
      details: {
        run_id: command.runId,
        message: "DebugAgent GDB MCP setup failed",
        gdb_failure: path.relative(projectRoot, failurePath),
        adapter_contract: adapterContractPath ? path.relative(projectRoot, adapterContractPath) : undefined,
      },
    };
  }
  if (readonlyBefore) assertStudentReadonlyFingerprint(readonlyBefore, await studentGitFingerprint(projectRoot), "agent debug");
  let debugOutput: ReturnType<typeof parseDebugOutput>;
  try {
    debugOutput = parseDebugOutput(agentStructuredOutput(response, "agent_debug"));
  } catch (error) {
    const rawPath = await recordRawAgentOutput(evidence, "agent-debug", "agent-debug-raw.txt", response.resultText);
    throw new AgentOutputError(`agent debug output does not match debug_output.v1: ${error instanceof Error ? error.message : String(error)}`, {
      schema: "debug_output.v1",
      schema_error: error instanceof Error ? error.message : String(error),
      raw_artifact: path.relative(evidence.artifacts_root, rawPath),
      suggested_next_commands: ["rerun `vos agent debug --run <run-id>` or inspect the raw artifact"],
    });
  }
  const gdbSummaryPath = await writeGdbSummaryArtifact(projectRoot, evidence, debugRoot, debugOutput, adapterContractPath);
  const artifact = path.join(debugRoot, "debug.json");
  const markdown = path.join(debugRoot, "debug.md");
  const visualization = path.join(debugRoot, "visualization.html");
  await writeFile(artifact, `${JSON.stringify(debugOutput, null, 2)}\n`);
  await writeFile(markdown, renderDebugMarkdown(debugOutput));
  await writeFile(visualization, sanitizeAgentVisualizationHtml(debugOutput.visualization_html));
  evidence.addArtifactFromPath("agent-debug", artifact, "agent debug output");
  evidence.addArtifactFromPath("agent-debug-markdown", markdown, "agent debug report");
  evidence.addArtifactFromPath("agent-debug-visualization", visualization, "agent debug visualization");
  return {
    status: "passed",
    details: {
      debug: debugOutput,
      run_id: command.runId,
      artifact: path.relative(projectRoot, artifact),
      report: path.relative(projectRoot, markdown),
      visualization: path.relative(projectRoot, visualization),
      gdb_summary: path.relative(projectRoot, gdbSummaryPath),
      adapter_contract: adapterContractPath ? path.relative(projectRoot, adapterContractPath) : undefined,
      raw_events: response.rawEvents,
    },
  };
}

async function prepareAgentDebugTraceEvidence(params: {
  projectRoot: string;
  context: ExecContext;
  evidence: EvidenceWriter;
  debugRoot: string;
  target: string;
  keepWorktree: boolean;
}): Promise<{ summary: string; summaryPath: string }> {
  const summaryPath = path.join(params.debugRoot, "trace", "summary.json");
  await mkdir(path.dirname(summaryPath), { recursive: true });
  const toolchainPath = await resolveToolchainManifestPath({ projectRoot: params.projectRoot });
  if (!existsSync(toolchainPath) || !currentHead(params.projectRoot)) {
    await writeFile(summaryPath, `${JSON.stringify({
      status: "not_observed",
      reason: "debug trace requires a git project with .vos/toolchain.json",
      target: params.target,
    }, null, 2)}\n`);
    params.evidence.addArtifactFromPath("agent-debug-trace-summary", summaryPath, "agent debug trace summary");
    return { summary: "not observed", summaryPath };
  }

  try {
    const recentEvidence = await collectRunManifestSummaries(params.projectRoot);
    const traceInput = await buildDebugTraceInput({
      projectRoot: params.projectRoot,
      target: params.target,
      recentEvidence,
    });
    const agentProgress = createAgentProgressParams(params.context, "agent debug trace");
    const agentResult = await runAgentWithPrompt({
      projectRoot: params.projectRoot,
      taskPrompt: agentProgress.taskPrompt(buildAgentDebugTracePrompt(traceInput)),
      taskKind: "debug_trace",
      requestedScope: "agent.debug.trace",
      context: traceInput,
      courseMode: true,
      allowedVosCommands: await loadAgentAllowedCommands(params.projectRoot, params.context.effectivePolicy),
      resultSubmissionSchema: "debug_trace_plan.v1",
      extraMcpServers: agentProgress.extraMcpServers,
      onEvent: agentProgress.onEvent,
      taskRunner: params.context.agentRunner,
    });
    const result = await runAgentDebugTrace({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      target: params.target,
      keepWorktree: params.keepWorktree,
      agentPlanText: agentTracePlanText(agentResult),
      recentEvidence,
    });
    return {
      summary: `${result.status}; ${result.cases.length} trace case(s); branch ${result.worktreeBranch}`,
      summaryPath: result.summaryPath,
    };
  } catch (error) {
    await writeFile(summaryPath, `${JSON.stringify({
      status: "failed",
      target: params.target,
      reason: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`);
    params.evidence.addArtifactFromPath("agent-debug-trace-summary", summaryPath, "agent debug trace summary");
    return { summary: "failed", summaryPath };
  }
}

async function findRecentFailedRunIds(projectRoot: string): Promise<string[]> {
  const runsRoot = path.join(projectRoot, ".vos", "runs");
  if (!existsSync(runsRoot)) return [];
  const out: string[] = [];
  for (const entry of await readdir(runsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(runsRoot, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = safeJsonTryParse(await readFile(manifestPath, "utf8")) as { status?: string; run_id?: string } | undefined;
    if (manifest?.status && !["passed", "ok", "partial", "planned"].includes(manifest.status)) {
      out.push(manifest.run_id ?? entry.name);
    }
  }
  return out.sort().slice(-10).reverse();
}

async function loadDebugRunContext(projectRoot: string, runId: string): Promise<{
  runId: string;
  status: string;
  command: string[];
  primaryLogPath: string;
  artifacts: Array<{ path: string; snippet: string }>;
  manifest: Record<string, unknown>;
}> {
  const manifestPath = path.join(projectRoot, ".vos", "runs", runId, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new CliError(`debug run not found: ${runId}`, "failed");
  }
  const manifest = safeJsonTryParse(await readFile(manifestPath, "utf8")) as {
    run_id?: string;
    command?: unknown;
    status?: string;
    artifacts?: Array<{ path?: unknown; kind?: unknown; summary?: unknown }>;
  } | undefined;
  if (!manifest) {
    throw new CliError(`debug run manifest is not JSON: ${runId}`, "failed");
  }
  const artifacts = [];
  for (const artifact of manifest.artifacts ?? []) {
    if (typeof artifact.path !== "string") continue;
    const absolute = path.resolve(projectRoot, artifact.path);
    if (!existsSync(absolute)) continue;
    const text = await readFile(absolute, "utf8").catch(() => "");
    artifacts.push({
      path: artifact.path,
      snippet: text.slice(0, 12_000),
    });
  }
  const primary = artifacts.find((artifact) => /log|result|trace|manifest/i.test(artifact.path)) ?? artifacts[0];
  if (!primary) {
    throw new CliError(`debug run has no readable artifacts: ${runId}`, "failed");
  }
  return {
    runId: manifest.run_id ?? runId,
    status: manifest.status ?? "unknown",
    command: Array.isArray(manifest.command) ? manifest.command.map(String) : [],
    primaryLogPath: path.resolve(projectRoot, primary.path),
    artifacts,
    manifest: manifest as Record<string, unknown>,
  };
}

function inferDebugTarget(runContext: {
  command: string[];
  manifest: Record<string, unknown>;
  artifacts: Array<{ path: string; snippet: string }>;
}): string {
  const details = isRecord(runContext.manifest.details) ? runContext.manifest.details : {};
  if (typeof details.scopeTarget === "string" && details.scopeTarget.trim()) return details.scopeTarget.trim();
  const command = runContext.command.join(" ");
  const targetIndex = runContext.command.indexOf("--target");
  if (targetIndex >= 0 && runContext.command[targetIndex + 1]) return runContext.command[targetIndex + 1];
  if (/verify\s+public/.test(command)) return "public";
  for (const artifact of runContext.artifacts) {
    const match = artifact.snippet.match(/kernel\/[A-Za-z0-9_/-]+/);
    if (match) return match[0];
  }
  return "full-syscall";
}

async function writeGdbAdapterContract(
  projectRoot: string,
  evidence: EvidenceWriter,
  debugRoot: string,
  runContext: { runId: string; command: string[] },
  target: string,
): Promise<string> {
  const gdbRoot = path.join(debugRoot, "gdb");
  await mkdir(gdbRoot, { recursive: true });
  const contractPath = path.join(gdbRoot, "adapter-contract.json");
  const toolchain = await readToolchainForDebug(projectRoot);
  const runArgs = toolchain.run?.args ?? [];
  const endpoint = "127.0.0.1:26000";
  const monitorRoot = path.join(gdbRoot, "monitor");
  await mkdir(monitorRoot, { recursive: true });
  const qmpEndpoint = `unix:${path.join(monitorRoot, "qmp.sock")}`;
  const hmpEndpoint = `unix:${path.join(monitorRoot, "hmp.sock")}`;
  const contract = {
    mode: "qemu-gdbstub",
    target,
    source_run_id: runContext.runId,
    source_command: runContext.command,
    program: toolchain.run?.artifact ?? toolchain.run?.artifacts?.[0] ?? "build/kernel.elf",
    symbols: toolchain.run?.artifact ?? toolchain.run?.artifacts?.[0] ?? "build/kernel.elf",
    endpoint,
    qmp_endpoint: qmpEndpoint,
    hmp_endpoint: hmpEndpoint,
    connect_gdb: [`target remote ${endpoint}`],
    qemu_args: ensureQemuDebugArgs(runArgs, endpoint, qmpEndpoint, hmpEndpoint),
    forbidden: ["qemu-user-gdb", "gdb_attach for QEMU-system"],
    monitor_forbidden_commands: ["quit", "stop", "cont", "system_reset", "system_powerdown", "device_add", "device_del", "migrate", "savevm", "loadvm", "screendump"],
    notes: [
      "Use built-in gdb-debug skill.",
      "Use built-in qemu-monitor skill only for supplemental readonly QEMU monitor evidence.",
      "Use target remote for QEMU-system gdbstub.",
      "Adapter contract is evidence; DebugAgent chooses breakpoints and inspection commands.",
    ],
  };
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  evidence.addArtifactFromPath("agent-debug-gdb-adapter", contractPath, "GDB adapter contract");
  return contractPath;
}

async function writeGdbSummaryArtifact(
  projectRoot: string,
  evidence: EvidenceWriter,
  debugRoot: string,
  debugOutput: ReturnType<typeof parseDebugOutput>,
  adapterContractPath?: string,
): Promise<string> {
  const gdbRoot = path.join(debugRoot, "gdb");
  await mkdir(gdbRoot, { recursive: true });
  const summaryPath = path.join(gdbRoot, "summary.json");
  await writeFile(summaryPath, `${JSON.stringify({
    summary: debugOutput.gdb_summary ?? "not observed",
    adapter_contract: adapterContractPath ? path.relative(projectRoot, adapterContractPath) : undefined,
    observations: debugOutput.evidence_chain.filter((entry) => /gdb|backtrace|register|breakpoint/i.test(`${entry.label} ${entry.observation}`)),
  }, null, 2)}\n`);
  evidence.addArtifactFromPath("agent-debug-gdb-summary", summaryPath, "GDB debug summary");
  return summaryPath;
}

async function writeGdbFailureArtifact(
  projectRoot: string,
  evidence: EvidenceWriter,
  debugRoot: string,
  error: unknown,
  adapterContractPath?: string,
): Promise<string> {
  const gdbRoot = path.join(debugRoot, "gdb");
  await mkdir(gdbRoot, { recursive: true });
  const failurePath = path.join(gdbRoot, "failure.json");
  await writeFile(failurePath, `${JSON.stringify({
    status: "failed",
    reason: error instanceof Error ? error.message : String(error),
    adapter_contract: adapterContractPath ? path.relative(projectRoot, adapterContractPath) : undefined,
  }, null, 2)}\n`);
  evidence.addArtifactFromPath("agent-debug-gdb-failure", failurePath, "GDB debug failure");
  return failurePath;
}

async function readToolchainForDebug(projectRoot: string): Promise<{
  run?: { args?: string[]; artifact?: string; artifacts?: string[] };
}> {
  if (!existsSync(path.join(projectRoot, ".vos", "toolchain.json"))) return {};
  const { manifest } = await loadToolchainManifest({ projectRoot });
  const profile = manifest.run.profiles[0];
  return { run: { args: profile.args, artifact: profile.artifacts[0], artifacts: profile.artifacts } };
}

function ensureQemuGdbstubArgs(args: string[], endpoint: string): string[] {
  const port = endpoint.split(":").at(-1) ?? "26000";
  const out = [...args];
  if (!out.includes("-S")) out.push("-S");
  if (!out.includes("-gdb")) out.push("-gdb", `tcp::${port}`);
  return out;
}

function ensureQemuDebugArgs(args: string[], gdbEndpoint: string, qmpEndpoint: string, hmpEndpoint: string): string[] {
  const out = ensureQemuGdbstubArgs(args, gdbEndpoint);
  if (!out.includes("-qmp")) out.push("-qmp", `${qmpEndpoint.slice("unix:".length)},server=on,wait=off`);
  if (!out.includes("-monitor")) out.push("-monitor", `${hmpEndpoint.slice("unix:".length)},server=on,wait=off`);
  return out;
}

function renderDebugMarkdown(debug: ReturnType<typeof parseDebugOutput>): string {
  return [
    `# Debug Summary`,
    "",
    `**Failure class:** ${debug.failure_class}`,
    "",
    debug.summary,
    debug.trace_summary ? ["", "## Trace Summary", debug.trace_summary].join("\n") : "",
    debug.gdb_summary ? ["", "## GDB Summary", debug.gdb_summary].join("\n") : "",
    "",
    "## Evidence Chain",
    ...debug.evidence_chain.map((entry) => `- ${entry.label}: ${entry.observation}${entry.artifact ? ` (${entry.artifact})` : ""}`),
    "",
    "## Suspected Concepts",
    ...debug.suspected_concepts.map((concept) => `- ${concept}`),
    "",
    "## Next Commands",
    ...debug.next_diagnostic_commands.map((command) => `- \`${command}\``),
    "",
    "## Student-visible limitations",
    ...(debug.student_visible_limitations.length > 0 ? debug.student_visible_limitations : ["Full instrumentation diffs are withheld from this report."]).map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function sanitizeAgentVisualizationHtml(html: string): string {
  if (!/<!doctype html|<html[\s>]/i.test(html)) {
    throw new CliError("DebugOutput.visualization_html must be a complete HTML document", "validation_failed");
  }
  if (/diff --git|^@@\s/m.test(html)) {
    throw new CliError("DebugOutput.visualization_html must not include full instrumentation diffs", "validation_failed");
  }
  return html;
}

export async function executeAgentLog(
  command: AgentLogCommand,
  projectRoot: string,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const logPath = path.join(projectRoot, ".vos", "agent-log.jsonl");
  if (command.append) {
    const text = command.inputPath
      ? await readFile(path.resolve(projectRoot, command.inputPath), "utf8")
      : await readPatchFromStdin();
    await appendLogEntry(logPath, safeJsonTryParse(text) ?? { raw: text, ts: new Date().toISOString() });
    evidence.addArtifact("agent", path.relative(projectRoot, logPath), "agent log append");
    return { status: "passed", details: { append: true, logPath: path.relative(projectRoot, logPath) } };
  }
  const entries = await readLogEntries(logPath);
  return {
    status: "passed",
    details: {
      append: false,
      count: entries.length,
      logPath: path.relative(projectRoot, logPath),
      entries,
    },
  };
}

async function writeNormalizedBundle(
  projectRoot: string,
  bundle: NormalizedSpecBundle,
  evidence: EvidenceWriter,
): Promise<string> {
  const cachePath = path.join(projectRoot, ".vos", "cache", "normalized", "bundle.json");
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(bundle, null, 2)}\n`);
  evidence.addArtifact("spec", path.relative(projectRoot, cachePath), "normalized spec bundle");
  return cachePath;
}

async function writeCurrentNormalizedBundleAndHash(
  projectRoot: string,
  evidence: EvidenceWriter,
): Promise<string> {
  const project = await loadProjectConfig(projectRoot);
  const bundle = await buildNormalizedSpecBundle({ projectRoot, specRoot: project.spec_root ?? "spec" });
  const bundlePath = await writeNormalizedBundle(projectRoot, bundle, evidence);
  return normalizedBundleContentHash(await readFile(bundlePath, "utf8"));
}

function normalizedBundleContentHash(serializedBundle: string): string {
  const bundle = JSON.parse(serializedBundle) as Record<string, unknown>;
  // `generated_at` documents cache freshness but is not part of the spec
  // content. Including it makes a checked-in toolchain manifest unusable
  // after the next deterministic `spec lint` invocation.
  delete bundle.generated_at;
  return createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
}

async function writePatchApplyCache(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  bundle: NormalizedSpecBundle;
  patch: SpecPatchRecord;
  impact: PatchImpactReport;
  selectedChecks: string[];
  status: CommandStatus;
}): Promise<{ impact: string; verification_plan: string; status: string }> {
  const patchDir = path.join(params.projectRoot, ".vos", "cache", "patches", safeCacheSegment(params.patch.id));
  await mkdir(patchDir, { recursive: true });
  const impactPath = path.join(patchDir, "impact.json");
  const planPath = path.join(patchDir, "verification-plan.json");
  const statusPath = path.join(patchDir, "status.json");
  await writeFile(impactPath, `${JSON.stringify({ patch: params.patch, impact: params.impact }, null, 2)}\n`);
  await writeFile(planPath, `${JSON.stringify({
    patch_id: params.patch.id,
    commit_sha: params.patch.commit_sha,
    parent_sha: params.patch.parent_sha,
    selected_checks: params.selectedChecks,
    required_checks: params.impact.required_checks,
    selected_tests: params.impact.selected_tests,
    generated_at: new Date().toISOString(),
  }, null, 2)}\n`);
  await writeFile(statusPath, `${JSON.stringify({
    patch_id: params.patch.id,
    commit_sha: params.patch.commit_sha,
    parent_sha: params.patch.parent_sha,
    status: params.status,
    diagnostics: params.impact.diagnostics,
    verification_run_id: params.evidence.run_id,
    updated_at: new Date().toISOString(),
  }, null, 2)}\n`);
  params.evidence.addArtifact("patch", path.relative(params.projectRoot, impactPath), "SpecPatch impact report");
  params.evidence.addArtifact("patch", path.relative(params.projectRoot, planPath), "SpecPatch verification plan");
  params.evidence.addArtifact("patch", path.relative(params.projectRoot, statusPath), "SpecPatch apply status");
  void params.bundle;
  return {
    impact: path.relative(params.projectRoot, impactPath),
    verification_plan: path.relative(params.projectRoot, planPath),
    status: path.relative(params.projectRoot, statusPath),
  };
}

async function writePatchApplyStatus(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  patchId: string;
  commitSha?: string;
  parentSha?: string;
  status: CommandStatus;
  diagnostics: SpecDiagnostic[];
  verificationRunId: string;
}): Promise<string> {
  const statusPath = path.join(params.projectRoot, ".vos", "cache", "patches", safeCacheSegment(params.patchId), "status.json");
  await mkdir(path.dirname(statusPath), { recursive: true });
  await writeFile(statusPath, `${JSON.stringify({
    patch_id: params.patchId,
    commit_sha: params.commitSha,
    parent_sha: params.parentSha,
    status: params.status,
    diagnostics: params.diagnostics,
    verification_run_id: params.verificationRunId,
    updated_at: new Date().toISOString(),
  }, null, 2)}\n`);
  params.evidence.addArtifact("patch", path.relative(params.projectRoot, statusPath), "SpecPatch apply status");
  return statusPath;
}

async function writeAppliedPatchState(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  patch: SpecPatchRecord;
  impactRef: string;
  verificationRef: string;
}): Promise<Record<string, unknown>> {
  const appliedPath = path.join(params.projectRoot, ".vos", "cache", "patches", "applied.json");
  const applied = {
    patch_id: params.patch.id,
    commit_sha: params.patch.commit_sha,
    parent_sha: params.patch.parent_sha,
    spec_commit_sha: params.patch.spec_commit_sha,
    applied_at: new Date().toISOString(),
    impact_ref: params.impactRef,
    verification_ref: params.verificationRef,
  };
  await mkdir(path.dirname(appliedPath), { recursive: true });
  await writeFile(appliedPath, `${JSON.stringify(applied, null, 2)}\n`);
  params.evidence.addArtifact("patch", path.relative(params.projectRoot, appliedPath), "applied SpecPatch state");
  return {
    ...applied,
    path: path.relative(params.projectRoot, appliedPath),
  };
}

async function writeLocalPatchProjections(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  bundle: NormalizedSpecBundle;
  patch: SpecPatchRecord;
  impact: PatchImpactReport;
  selectedChecks: string[];
}): Promise<Record<string, string>> {
  const projectionDir = path.join(params.projectRoot, ".vos", "cache", "projections");
  await mkdir(projectionDir, { recursive: true });
  const specHash = createHash("sha256").update(JSON.stringify(params.bundle.hashes)).digest("hex");
  const student = {
    projection_kind: "student",
    generated_at: new Date().toISOString(),
    spec_hash: specHash,
    patch_id: params.patch.id,
    stage: params.patch.stage,
    visible_sources: params.bundle.sources.filter((source) => params.bundle.visibility[source.path] === "public").map((source) => source.path),
    stages: params.bundle.architecture.stages,
    modules: params.bundle.modules,
    operations: params.bundle.operations.map((operation) => ({
      id: operation.id,
      module: operation.module,
      operation: operation.operation,
      stage: operation.stage,
      public_tests: operation.public_tests,
    })),
    public_requirements: params.bundle.verification.public_requirements,
    selected_public_tests: params.impact.selected_tests,
    required_checks: params.selectedChecks,
  };
  const agent = {
    ...student,
    projection_kind: "agent",
    patch_impact: {
      affected_specs: params.impact.affected_specs,
      affected_code_paths: params.impact.affected_code_paths,
      affected_modules: params.impact.affected_modules,
      affected_operations: params.impact.affected_operations,
      requires_cloud_projection_refresh: params.impact.requires_cloud_projection_refresh,
    },
  };
  const staff = {
    ...agent,
    projection_kind: "staff",
    sources: params.bundle.sources,
    patch_records: params.bundle.patch_records,
    diagnostics: params.bundle.diagnostics,
    impact_diagnostics: params.impact.diagnostics,
  };
  const projections = { student, agent, staff };
  const out: Record<string, string> = {};
  for (const [kind, value] of Object.entries(projections)) {
    const filePath = path.join(projectionDir, `${kind}.json`);
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    params.evidence.addArtifact("projection", path.relative(params.projectRoot, filePath), `${kind} local projection`);
    out[kind] = path.relative(params.projectRoot, filePath);
  }
  return out;
}

function safeCacheSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "-");
}

async function runDefaultAgentSpecReview(params: {
  command: string;
  target?: string;
  targetPaths?: string[];
  targetRefs?: string[];
  bundle: NormalizedSpecBundle;
  impact?: unknown;
  context: ExecContext;
  evidence: EvidenceWriter;
}): Promise<AgentSpecReview> {
  const targetRefs = new Set(params.targetRefs ?? []);
  const targetPaths = new Set(params.targetPaths ?? []);
  const scoped = targetRefs.size > 0 || targetPaths.size > 0;
  const operations = params.bundle.operations.filter((operation) =>
    !scoped || targetRefs.has(operation.module) || targetPaths.has(operation.path)
  );
  const publicChecks = (params.bundle.manifest?.checks ?? []).filter((check) =>
    !scoped || check.verifies.some((ref) => targetRefs.has(ref))
  );
  const stages = new Set(params.bundle.architecture.stages.map((stage) => stage.stage));
  for (const module of params.bundle.normalized_modules) {
    if (scoped && !targetRefs.has(module.id) && !targetPaths.has(module.path)) continue;
    const stage = typeof module.state?.stage === "string" ? module.state.stage.trim() : "";
    if (stage) stages.add(stage);
  }
  const reviewInput = {
    command: params.command,
    target: params.target,
    target_paths: params.targetPaths ?? [],
    target_refs: params.targetRefs ?? [],
    diagnostics: params.bundle.diagnostics,
    counts: {
      sources: params.bundle.sources.length,
      modules: params.bundle.modules.length,
      operations: operations.length,
      mapped_checks: publicChecks.length,
    },
    inventory: {
      operations: operations.map((operation) => operation.id),
      mapped_checks: publicChecks.map((check) => ({ id: check.id, verifies: check.verifies })),
    },
    architecture: {
      stages: [...stages].sort(),
    },
    impact: params.impact,
  };
  const prompt = [
    "Review this VOS spec result for design conflicts and tradeoffs.",
    AGENTS_READONLY_GUIDANCE_PROMPT,
    "Return JSON only with { findings: [{ severity, message, related_specs, suggested_actions }], summary }.",
    "Severity must be one of info, warning, error, blocker.",
    "Your findings are advisory and must be grounded in the provided diagnostics or spec refs.",
    "inventory.mapped_checks is the current vos.yaml verifies projection, not a ModuleSpec field. It is expected to be empty while reviewing a newly handwritten Spec before agent implement; do not propose a public_requirements field because the strict ModuleSpec schema has no such field. Instead assess whether properties name observable checks that implement can propose and VOS can validate before projection.",
    "If a missing public spec or agent workflow convention belongs in AGENTS.md, mention that in suggested_actions.",
    JSON.stringify(reviewInput, null, 2),
  ].join("\n\n");

  try {
    const agentProgress = createAgentProgressParams(params.context, "agent spec review");
    const response = await runAgentWithPrompt({
      projectRoot: params.context.projectRoot,
      taskPrompt: agentProgress.taskPrompt(prompt),
      taskKind: "design_review",
      requestedScope: `agent.review:${params.target ?? "all"}`,
      context: reviewInput,
      courseMode: true,
      allowedVosCommands: await loadAgentAllowedCommands(params.context.projectRoot, params.context.effectivePolicy),
      resultSubmissionSchema: "spec_review.v1",
      extraMcpServers: agentProgress.extraMcpServers,
      onEvent: agentProgress.onEvent,
      taskRunner: params.context.agentRunner,
    });
    const review = parseAgentSpecReview(agentStructuredOutput(response, "agent_review"), response.resultText);
    await writeAgentReviewArtifact(params.context.projectRoot, params.evidence, review);
    return review;
  } catch (error) {
    const review: AgentSpecReview = {
      status: "unavailable",
      findings: [{
        severity: "warning",
        message: `agent review unavailable: ${error instanceof Error ? error.message : String(error)}`,
        related_specs: [],
        suggested_actions: ["configure vos-agent model credentials or rerun `vos agent review`"],
      }],
      summary: "agent review unavailable; deterministic spec checks still ran",
    };
    await writeAgentReviewArtifact(params.context.projectRoot, params.evidence, review);
    return review;
  }
}

function deterministicOnlyAgentReview(command: string): AgentSpecReview {
  return {
    status: "unavailable",
    findings: [],
    summary: `${command} ran deterministic checks only (--no-agent)`,
  };
}

async function writeAgentReviewArtifact(
  projectRoot: string,
  evidence: EvidenceWriter,
  review: AgentSpecReview,
): Promise<void> {
  const artifact = path.join(evidence.artifacts_root, "agent", "spec-review.json");
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(review, null, 2)}\n`);
  evidence.addArtifactFromPath("agent", artifact, "agent spec review");
  if (review.status !== "ok") {
    await evidence.appendEvent({
      type: "progress",
      visibility: "agent-only",
      payload: {
        kind: "agent_review",
        status: review.status,
        summary: review.summary,
      },
    });
  }
}

async function loadAgentAllowedCommands(projectRoot: string, effectivePolicy?: EffectivePolicy): Promise<string[]> {
  if (effectivePolicy) {
    return effectivePolicy.allowedCommands.filter(isAllowedModelVosCommand);
  }
  const policy = await loadPolicyConfig(projectRoot);
  return (policy.allowed_commands ?? []).filter(isAllowedModelVosCommand);
}

function isAllowedModelVosCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  return normalized !== "agent" && !normalized.startsWith("agent ");
}

function updateProgress(context: ExecContext, update: ProgressUpdate): void {
  context.progress?.update(update);
  context.readonlyDisplay?.progress(update);
  void context.evidence.appendEvent({
    type: "progress",
    visibility: "agent-only",
    payload: {
      stage: update.stage,
      ...(update.phase ? { phase: update.phase } : {}),
      ...(update.step ? { step: update.step } : {}),
      ...(typeof update.current === "number" ? { current: update.current } : {}),
      ...(typeof update.total === "number" ? { total: update.total } : {}),
      ...(typeof update.percent === "number" ? { percent: update.percent } : {}),
      ...(update.status ? { status: update.status } : {}),
      ...(update.message ? { message: update.message } : {}),
      ...(typeof update.confidence === "number" ? { confidence: update.confidence } : {}),
    },
  });
}

function createAgentProgressParams(context: ExecContext, stage: string): {
  taskPrompt: (prompt: string) => string;
  extraMcpServers: ReturnType<typeof createProgressMcpServerConfig>[];
  onEvent: (event: Record<string, unknown>) => Promise<void>;
} {
  if (!context.progress?.enabled && !context.readonlyDisplay) {
    return {
      taskPrompt: (prompt) => prompt,
      extraMcpServers: [],
      onEvent: async () => { },
    };
  }
  return {
    taskPrompt: (prompt) => prompt,
    extraMcpServers: [createProgressMcpServerConfig(context.projectRoot)],
    onEvent: async (event) => {
      context.readonlyDisplay?.onSessionEvent(event as never);
      await context.evidence.appendEvent({
        type: "progress",
        visibility: "agent-only",
        payload: { kind: "agent_event", event },
      });
      const update = progressUpdateFromAgentEvent(event, stage);
      if (update) {
        updateProgress(context, { ...update, stage: update.stage || stage });
      }
    },
  };
}

function commandLabel(command: CliCommand): string {
  return commandToArray(command).join(" ");
}

export function commandToArray(command: CliCommand): string[] {
  switch (command.kind) {
    case "login":
      return [
        "login",
        "--portal-url",
        command.portalUrl,
        ...(command.token ? ["--token", "<redacted>"] : []),
        ...(command.tokenStdin ? ["--token-stdin"] : []),
      ];
    case "logout":
      return ["logout", ...(command.portalUrl ? ["--portal-url", command.portalUrl] : [])];
    case "whoami":
      return ["whoami", ...(command.portalUrl ? ["--portal-url", command.portalUrl] : [])];
    case "portal_pipeline":
      return ["pipeline",command.action,...(command.runId?[command.runId]:[]),...(command.scope&&command.action==="trigger"?["--scope",command.scope]:[]),...(command.modelCredentialId&&command.action==="trigger"?["--model-credential",command.modelCredentialId]:[]),...(command.outDir&&command.action==="download"?["--out",command.outDir]:[]),...(command.reason?["--reason",command.reason]:[])];
    case "project_bind":
      return ["project","bind","--portal-url",command.portalUrl,"--project-id",command.projectId];
    case "serve":
      return [
        "serve",
        "--portal-url",
        command.portalUrl,
        "--project-id",
        command.projectId,
        ...(command.host ? ["--host", command.host] : []),
        ...(command.port !== undefined ? ["--port", String(command.port)] : []),
      ];
    case "build": {
      const commandParts = ["build"];
      if (command.dryRun) commandParts.push("--dry-run");
      if (command.toolchainPath) {
        commandParts.push("--toolchain", command.toolchainPath);
      }
      return commandParts;
    }
    case "build_generate":
      return [
        "build",
        "generate",
        ...(command.agentSession ? ["--agent-session", command.agentSession] : []),
        ...(command.noAgent ? ["--no-agent"] : []),
      ];
    case "run_qemu":
      return [
        "run",
        "qemu",
        ...(command.dryRun ? ["--dry-run"] : []),
        ...(command.timeoutMs ? ["--timeout", String(command.timeoutMs)] : []),
        ...(command.readyPattern ? ["--ready-pattern", command.readyPattern] : []),
      ];
    case "run_hardware":
      return ["run", "hardware", ...(command.dryRun ? ["--dry-run"] : []), ...(command.timeoutMs !== undefined ? ["--timeout", String(command.timeoutMs)] : [])];
    case "spec_lint":
      return ["spec", "lint", ...(command.target ? [command.target] : [])];
    case "spec_check_consistency":
      return ["spec", "check-consistency"];
    case "spec_patch_lint":
      return command.patchPath ? ["spec", "patch", "lint", command.patchPath] : ["spec", "patch", "lint"];
    case "spec_patch_apply":
      return [
        "spec",
        "patch",
        "apply",
        ...(command.patchPath ? [command.patchPath] : command.inputFromStdin ? ["-"] : []),
      ];
    case "spec_normalize":
      return ["spec", "normalize"];
    case "arch_lint":
      return ["arch", "lint", ...(command.noAgent ? ["--no-agent"] : []), ...(command.path ? [command.path] : [])];
    case "arch_compose":
      return command.path ? ["arch", "compose", command.path] : ["arch", "compose"];
    case "arch_derive_tests":
      return command.path ? ["arch", "derive-tests", command.path] : ["arch", "derive-tests"];
    case "test":
      return [
        "test",
        ...(command.dryRun ? ["--dry-run"] : []),
        ...command.suites.flatMap((suite) => ["--suite", suite]),
      ];
    case "verify":
      return [
        "verify",
        command.scope,
        ...(command.hidden ? ["--hidden"] : []),
        ...(command.dryRun ? ["--dry-run"] : []),
        ...(command.target ? ["--target", command.target] : []),
        ...(command.staffPolicy ? ["--staff-policy", command.staffPolicy] : []),
      ];
    case "trace_syscall":
      return [
        "trace",
        "syscall",
        ...(command.dryRun ? ["--dry-run"] : []),
        ...(command.timeoutMs ? ["--timeout", String(command.timeoutMs)] : []),
      ];
    case "debug_explain_log":
      return command.logPath ? ["debug", "explain-log", command.logPath] : ["debug", "explain-log"];
    case "toolchain_lint":
      return ["toolchain", "lint"];
    case "toolchain_init":
      return ["toolchain", "init", ...(command.force ? ["--force"] : [])];
    case "agent_serve":
      return [
        "agent",
        "serve",
        ...(command.display ? ["-i"] : []),
        ...(command.host ? ["--host", command.host] : []),
        ...(command.port ? ["--port", String(command.port)] : []),
      ];
    case "agent_config":
      return [
        "agent",
        "config",
        ...(command.provider ? ["--provider", command.provider] : []),
        ...(command.model ? ["--model", command.model] : []),
        ...(command.baseUrl ? ["--base-url", command.baseUrl] : []),
        ...(command.authEnv ? ["--auth-env", command.authEnv] : []),
        ...(command.configureEmbedding === true ? ["--with-embedding"] : []),
        ...(command.configureEmbedding === false ? ["--without-embedding"] : []),
        ...(command.embeddingProvider ? ["--embedding-provider", command.embeddingProvider] : []),
        ...(command.embeddingModel ? ["--embedding-model", command.embeddingModel] : []),
        ...(command.embeddingBaseUrl ? ["--embedding-base-url", command.embeddingBaseUrl] : []),
        ...(command.embeddingAuthEnv ? ["--embedding-auth-env", command.embeddingAuthEnv] : []),
        ...(command.show ? ["--show"] : []),
        ...(command.reset ? ["--reset"] : []),
        ...(command.check ? ["--check"] : []),
      ];
    case "agent_context":
      return [
        "agent",
        "context",
        ...(command.display ? ["-i"] : []),
        ...(command.scope ? ["--scope", command.scope] : []),
      ];
    case "agent_plan":
      return [
        "agent",
        "plan",
        ...(command.display ? ["-i"] : []),
        ...(command.task ? ["--task", command.task] : []),
      ];
    case "agent_generate":
      return [
        "agent",
        "generate",
        ...(command.display ? ["-i"] : []),
        ...(command.target ? [command.target] : command.task ? ["--task", command.task] : []),
        ...(command.apply ? ["--apply"] : []),
        ...(command.build ? ["--build"] : []),
        ...(command.run ? ["--run"] : []),
      ];
    case "agent_apply_patch":
      return [
        "agent",
        "apply-patch",
        ...(command.display ? ["-i"] : []),
        ...(command.patchFile ? ["--patch-file", command.patchFile] : []),
        ...(command.requireSpec ? [] : ["--no-require-spec"]),
        ...(command.runValidation ? ["--run-validation"] : []),
      ];
    case "agent_validate_generated":
      return [
        "agent",
        "validate-generated",
        ...(command.display ? ["-i"] : []),
        "--target",
        command.target,
        ...(command.patchFile ? ["--patch-file", command.patchFile] : []),
        ...(command.keepWorktree ? ["--keep-worktree"] : []),
      ];
    case "agent_debug":
      return [
        "agent",
        "debug",
        ...(command.display ? ["-i"] : []),
        ...(command.logPath ? ["--log", command.logPath] : []),
        ...(command.runId ? ["--run", command.runId] : []),
        ...(command.keepWorktree ? ["--keep-worktree"] : []),
      ];
    case "agent_implement":
      return ["agent", "implement", command.module, ...(command.display ? ["--interactive"] : [])];
    case "agent_verify":
      return ["agent", "verify", ...(command.display ? ["--interactive"] : [])];
    case "agent_review":
      return ["agent", "review", ...(command.target ? [command.target] : []), ...(command.display ? ["--interactive"] : [])];
    case "agent_log":
      return [
        "agent",
        "log",
        ...(command.display ? ["-i"] : []),
        ...(command.append ? ["--append"] : []),
        ...(command.inputPath ? [command.inputPath] : []),
      ];
    case "agent_ask":
      return [
        "agent",
        "ask",
        ...(command.interactive && command.question ? ["-i"] : []),
        ...(command.question ? [command.question] : []),
      ];
    case "kb_add":
      return [
        "kb",
        "add",
        command.source,
        "--source-kind",
        command.sourceKind,
        ...(command.stage ? ["--stage", command.stage] : []),
        ...(command.title ? ["--title", command.title] : []),
        ...(command.recursive ? ["--recursive"] : []),
        ...(command.manifestPath ? ["--manifest", command.manifestPath] : []),
      ];
    case "kb_list":
      return ["kb", "list"];
    case "kb_search":
      return ["kb", "search", command.query];
    case "kb_remove":
      return ["kb", "remove", command.id];
    case "kb_clear":
      return ["kb", "clear"];
    case "kb_export_manifest":
      return ["kb", "export-manifest", ...(command.outPath ? ["--out", command.outPath] : [])];
    case "kb_import_manifest":
      return ["kb", "import-manifest", command.manifestPath];
    case "report_generate":
      return [
        "report",
        ...(command.final ? ["--final"] : []),
        ...(command.stage ? ["--stage", command.stage] : []),
      ];
    case "submit_pack":
      return ["submit"];
    case "ledger_record":
      return [
        "ledger",
        "record",
        "--actor",
        command.actor,
        "--intent",
        command.intent,
        ...command.specRefs.flatMap((ref) => ["--spec-ref", ref]),
        ...command.changedTargets.flatMap((target) => ["--changed-target", target]),
      ];
    case "init":
      return ["init"];
    case "doctor":
      return ["doctor"];
    case "stage_show":
      return ["stage", "show"];
    case "stage_save":
      return ["stage", "save", "--actor", command.actor, "--intent", command.intent];
    default:
      return ["unknown"];
  }
}

function commandExists(cmd: string): boolean {
  if (path.isAbsolute(cmd)) return existsSync(cmd);
  const envPath = process.env.PATH?.split(path.delimiter) ?? [];
  const candidates = isWindows()
    ? [".exe", ".cmd", "", ".bat"].map((suffix) => cmd + suffix)
    : [cmd];
  return envPath.some((dir) => {
    return candidates.some((candidate) => existsSync(path.join(dir, candidate)));
  });
}

type DoctorCategory = "base" | "project" | "toolchain" | "toolchain-command" | "optional-tools";

interface DoctorCheck {
  name: string;
  category: DoctorCategory;
  required: boolean;
  ok: boolean;
  command?: string;
  message?: string;
  hint?: string;
}

const OPTIONAL_TOOL_COMMANDS = [
  "clang",
  "gcc",
  "make",
  "cmake",
  "ninja",
  "python3",
  "jq",
  "yq",
  "gdb-multiarch",
  "qemu-system-riscv64",
  "qemu-system-x86_64",
  "qemu-system-aarch64",
];

function doctorCommandCheck(
  command: string,
  category: DoctorCategory,
  ok = commandExists(command),
  required = true,
): DoctorCheck {
  return {
    name: command,
    category,
    required,
    ok,
    command,
    ...(!ok ? { hint: installHint(command) } : {}),
  };
}

function doctorFileCheck(name: string, category: DoctorCategory, filePath: string, hint: string): DoctorCheck {
  const ok = existsSync(filePath);
  return {
    name,
    category,
    required: true,
    ok,
    message: path.relative(path.dirname(filePath), filePath),
    ...(!ok ? { hint } : {}),
  };
}

function probeRequiredToolCheck(tool: RequiredToolV2): DoctorCheck {
  try {
    const [probe] = probeRequiredTools([tool]);
    return {
      name: tool.name,
      category: "toolchain",
      required: true,
      ok: true,
      command: tool.command,
      message: `${probe.detected_version} satisfies ${tool.version_constraint}`,
    };
  } catch (error) {
    return {
      name: tool.name,
      category: "toolchain",
      required: true,
      ok: false,
      command: tool.command,
      message: errorMessage(error),
      hint: installHint(tool.command),
    };
  }
}

function manifestCommandEntrypoints(manifest: ToolchainManifestV2): string[] {
  const commands = new Set<string>();
  for (const variant of manifest.build.variants) {
    for (const command of variant.commands) {
      const entrypoint = typeof command === "string" ? firstCommandToken(command) : command.command[0];
      if (entrypoint) commands.add(entrypoint);
    }
  }
  for (const suite of manifest.test.suites) {
    if (suite.kind === "command") commands.add(suite.command[0]);
  }
  for (const profile of manifest.run.profiles) {
    commands.add(profile.command);
  }
  return [...commands].sort();
}

function firstCommandToken(command: string): string | undefined {
  return command.match(/"([^"]*)"|'([^']*)'|\S+/)?.[0]?.replace(/^"|"$|^'|'$/g, "");
}

function installHint(command: string): string {
  if (command.startsWith("qemu-system-")) return "Install QEMU system emulator with your OS package manager.";
  if (command.startsWith("riscv64-unknown-elf-")) return "Install the RISC-V cross toolchain with your OS package manager.";
  return `Install ${command} with your OS package manager.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function discoverSpecFiles(root: string): Promise<string[]> {
  const normalizedRoot = path.resolve(root);
  const entries = await listYamlFiles(normalizedRoot);
  return entries.filter((entry) => isYamlFile(entry)).map((entry) => path.resolve(entry));
}

async function listYamlFiles(root: string): Promise<string[]> {
  try {
    const stat = await import("node:fs/promises").then((m) => m.stat(root));
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }
  const fs = await import("node:fs/promises");
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let items: { name: string; isDirectory(): boolean; isFile(): boolean }[] = [];
    try {
      items = await fs.readdir(dir, { withFileTypes: true }) as unknown as typeof items;
    } catch {
      return;
    }
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
        continue;
      }
      if (item.isFile() && isYamlFile(item.name)) {
        out.push(full);
      }
    }
  };
  await walk(root);
  return out;
}

function isYamlFile(name: string): boolean {
  return name.endsWith(".yml") || name.endsWith(".yaml");
}

function classifyErrorStatus(error: unknown): CommandStatus {
  if (error instanceof AgentOutputError) return "agent_output_error";
  if (error instanceof CliError) return error.status;
  if (error instanceof Error && error.message.includes("timed out")) return "timed_out";
  return "failed";
}

function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function safeJsonTryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function inferSpecsFromLog(text: string): string[] {
  const candidates = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/spec\/([^\s]+)/);
    if (match) candidates.add(`spec/${match[1]}`);
  }
  return [...candidates];
}

async function findLatestLogPath(projectRoot: string): Promise<string | undefined> {
  const runs = path.join(projectRoot, ".vos", "runs");
  if (!existsSync(runs)) return undefined;
  const dirs = await readdir(runs, { withFileTypes: true });
  const runEntries: Array<{ manifestPath: string; mtimeMs: number }> = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const manifestPath = path.join(runs, dir.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const stat = await import("node:fs/promises").then((m) => m.stat(manifestPath));
      runEntries.push({ manifestPath, mtimeMs: stat.mtimeMs });
    } catch {
      continue;
    }
  }
  for (const entry of runEntries.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    const manifestText = await readFile(entry.manifestPath, "utf8");
    const manifest = safeJsonTryParse(manifestText) as {
      artifacts?: Array<{ path: string; kind?: string }>;
    } | null;
    if (!manifest || !Array.isArray(manifest.artifacts)) continue;
    const candidate = manifest.artifacts
      .map((artifact) => artifact.path)
      .find((value) => value.includes("trace") || value.includes("qemu") || value.includes("log"));
    if (candidate) return path.resolve(projectRoot, candidate);
  }
  return undefined;
}

async function collectRunManifestSummaries(projectRoot: string): Promise<Array<{ run_id: string; status: string }>> {
  const runRoot = path.join(projectRoot, ".vos", "runs");
  if (!existsSync(runRoot)) return [];
  const dirs = await readdir(runRoot, { withFileTypes: true });
  const out: Array<{ run_id: string; status: string }> = [];
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(runRoot, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const raw = safeJsonTryParse(await readFile(manifestPath, "utf8"));
    if (raw && typeof raw === "object" && raw !== null) {
      const status = (raw as { status?: string }).status;
      out.push({ run_id: entry.name, status: status ?? "unknown" });
    }
  }
  return out;
}

export function buildAgentDebugTracePrompt(input: DebugTraceInput): string {
  return [
    "You are producing a VOS agent debug trace plan for an xv6-style project.",
    "Return exactly one JSON object and nothing else.",
    "Do not execute commands.",
    "Do not modify spec files.",
    AGENTS_READONLY_GUIDANCE_PROMPT,
    "Do not force AGENTS.md into temporary instrumentation patches.",
    "If validation uncovers a durable project workflow rule, suggest a follow-up AGENTS.md update instead.",
    "Use the validation input as the source of truth: target, public requirements, module test surfaces, coverage hints, project tree, toolchain, and recent evidence.",
    "Before writing the final JSON, use available file-reading tools to inspect every source file you modify and any spec file that names the mapped requirement.",
    "If target names a specific module or requirement, every case must map to that target through requirement_id, related_specs, and expected_trace_events.",
    "The JSON object must contain:",
    "- instrumentation_patch: a git unified diff that applies with git apply",
    "- trace_format: { \"prefix\": \"VOS_TRACE \" }",
    "- cases: array of validation cases",
    "Each case must contain:",
    "- id: string",
    "- requirement_id: string when mapped to a public requirement",
    "- related_specs: string[]",
    "- stdin or stimulus: string or string[] to send to QEMU stdin",
    "- success_regex: string",
    "- failure_regex: optional string",
    "- expected_trace_events: string[] containing event names only, for example [\"boot_ok\"], not full trace lines",
    "success_regex must validate non-trace serial output. Do not put VOS_TRACE in success_regex; expected_trace_events validates trace output separately.",
    "Instrumentation may only touch kernel/, user/, mkfs/, Makefile, or .vos/toolchain.json.",
    "Instrumentation must emit trace lines as: VOS_TRACE {\"event\":\"name\",...}.",
    "Use existing kernel/user printing facilities already present in the inspected file, such as printk/printf, instead of adding new dependencies.",
    "Do not weaken the build or run contract in .vos/toolchain.json. Only touch it when agent debug trace cannot run without a toolchain fix grounded in the current manifest.",
    "Unified diff requirements:",
    "- instrumentation_patch must be a git-style patch: every file section starts with `diff --git a/<path> b/<path>`.",
    "- Every file diff must use exact current file paths and real surrounding context.",
    "- Do not include prose, markdown fences, or abbreviated hunks inside instrumentation_patch.",
    "- The patch must pass `git apply --check` exactly, without recounting or repair.",
    "Validation input:",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

function buildAgentDebugTraceRepairPrompt(args: {
  input: DebugTraceInput;
  previousOutput: string;
  errorMessage: string;
  patchAlreadyBuilt?: boolean;
}): string {
  return [
    buildAgentDebugTracePrompt(args.input),
    "",
    "PREVIOUS OUTPUT FAILED MACHINE VALIDATION.",
    "Return a corrected complete JSON object and nothing else.",
    "Do not explain the failure in prose.",
    "Use the same source-of-truth validation input, but fix every schema or patch issue reported below.",
    args.patchAlreadyBuilt
      ? "The previous instrumentation_patch already applied and the kernel build completed. Prefer repairing cases and expected trace events before changing the patch."
      : "",
    args.patchAlreadyBuilt
      ? "Do not add new instrumentation hunks or new files in a repair response just to broaden coverage; first make the already-built plan pass with the strongest runnable subset."
      : "",
    "If the failure is a git patch error, regenerate the entire instrumentation_patch from exact current file contents.",
    "If a validation case failed, update the instrumentation and cases so success_regex and expected_trace_events can both pass without trace output corrupting the observed serial text.",
    "Keep hunks small and avoid touching extra files just to preserve the prior plan.",
    "Validation error:",
    args.errorMessage,
    "Previous output:",
    args.previousOutput,
  ].join("\n");
}

function debugTraceFailureSummary(result: {
  status: CommandStatus;
  cases: Array<{
    id: string;
    requirement_id?: string;
    status: "ok" | "failed";
    trace_count: number;
    success_matched: boolean;
    failure_matched: boolean;
    serial_log: string;
    trace_log: string;
  }>;
}): string {
  return [
    `agent debug trace finished with status ${result.status}`,
    ...result.cases.map((item) => [
      `case ${item.id}: ${item.status}`,
      item.requirement_id ? `requirement=${item.requirement_id}` : undefined,
      `success_matched=${item.success_matched}`,
      `failure_matched=${item.failure_matched}`,
      `trace_count=${item.trace_count}`,
      `serial_log=${item.serial_log}`,
      `trace_log=${item.trace_log}`,
    ].filter(Boolean).join(", ")),
  ].join("\n");
}

function isTracePlanFeedbackError(error: unknown): boolean {
  if (error instanceof AgentOutputError) return true;
  if (!(error instanceof CliError)) return false;
  return error.status === "validation_failed" || error.status === "policy_blocked";
}

async function recordAICollaboration(params: {
  projectRoot: string;
  event: {
    session_id: string;
    task_kind: string;
    agent_profile: unknown;
    related_specs: string[];
    allowed_paths: string[];
    output_kind: string;
    result: "accepted" | "rejected" | "pending" | "failed";
    created_at: string;
    patch_ref?: string;
    evidence_ref?: string;
  };
}): Promise<string> {
  const logPath = path.join(params.projectRoot, ".vos", "agent-log.jsonl");
  await appendLogEntry(logPath, params.event);
  return logPath;
}

function agentStructuredOutput(result: Awaited<ReturnType<typeof runAgentWithPrompt>>, _source: string): unknown {
  return result.parsedResult;
}

function agentTracePlanText(result: Awaited<ReturnType<typeof runAgentWithPrompt>>): string {
  return `${JSON.stringify(result.parsedResult, null, 2)}\n`;
}

async function recordRawAgentOutput(
  evidence: EvidenceWriter,
  kind: string,
  fileName: string,
  content: string,
): Promise<string> {
  const rawPath = path.join(evidence.artifacts_root, kind, fileName);
  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(rawPath, content);
  evidence.addArtifactFromPath(kind, rawPath, "raw agent response");
  return rawPath;
}

function contextSessionId(context: ExecContext): string {
  const sessionPrefix = context.global.agentSession ?? "session";
  return `${sessionPrefix}-${path.basename(context.projectRoot)}-${context.evidence.run_id}`;
}

async function loadToolchainGenerationSpec(projectRoot: string): Promise<{
  toolchainIndex: unknown;
  buildSpec: unknown;
  profileSpec?: unknown;
  runSpec?: unknown;
  allowedOutputPaths: string[];
  environment: { required_tools: RequiredToolV2[] };
}> {
  const toolchainPath = path.join(projectRoot, "spec", "toolchain", "toolchain.yaml");
  const buildPath = path.join(projectRoot, "spec", "toolchain", "build.yaml");
  if (!existsSync(toolchainPath) || !existsSync(buildPath)) {
    throw new CliError("build generate requires spec/toolchain/toolchain.yaml and build.yaml", "failed");
  }
  const toolchainIndex = parseTopLevelYaml(await readFile(toolchainPath, "utf8"));
  const buildSpec = parseTopLevelYaml(await readFile(buildPath, "utf8"));
  const profilePath = path.join(projectRoot, "spec", "toolchain", "profile.yaml");
  const runPath = path.join(projectRoot, "spec", "toolchain", "run.yaml");
  const profileSpec = existsSync(profilePath) ? parseTopLevelYaml(await readFile(profilePath, "utf8")) : undefined;
  return {
    toolchainIndex,
    buildSpec,
    profileSpec,
    runSpec: existsSync(runPath) ? parseTopLevelYaml(await readFile(runPath, "utf8")) : undefined,
    allowedOutputPaths: collectStringListByKey(buildSpec, "allowed_output_path"),
    environment: normalizeProfileEnvironment(profileSpec),
  };
}

async function writeDeterministicToolchainManifest(
  projectRoot: string,
  evidence: EvidenceWriter,
  force: boolean,
): Promise<CommandOutcome> {
  const manifestPath = path.join(projectRoot, ".vos", "toolchain.json");
  if (existsSync(manifestPath) && !force) {
    throw new CliError("toolchain manifest already exists; rerun with --force to overwrite", "failed", {
      path: ".vos/toolchain.json",
    });
  }
  const spec = await loadToolchainGenerationSpec(projectRoot);
  const specHash = await writeCurrentNormalizedBundleAndHash(projectRoot, evidence);
  const manifest = buildDeterministicToolchainManifest(projectRoot, spec, specHash);
  parseToolchainManifest(manifest);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  evidence.addArtifact("toolchain", path.relative(projectRoot, manifestPath), "deterministic toolchain manifest");
  return {
    status: "passed",
    details: {
      path: ".vos/toolchain.json",
      generator: manifest.generator,
      required_tools: manifest.environment.required_tools.map((tool) => tool.command),
      build_artifacts: manifest.build.variants[0]?.artifacts ?? [],
      run_cases: manifest.run.cases.map((testCase) => testCase.id),
      test_suites: manifest.test.suites.map((suite) => suite.name),
    },
  };
}

function buildDeterministicToolchainManifest(
  projectRoot: string,
  spec: Awaited<ReturnType<typeof loadToolchainGenerationSpec>>,
  specHash: string,
): ToolchainManifestV2 {
  const buildArtifacts = collectStringListByKey(spec.buildSpec, "generated_artifacts").length > 0
    ? collectStringListByKey(spec.buildSpec, "generated_artifacts")
    : collectStringListByKey(spec.buildSpec, "expected_outputs");
  const runSpec = isRecord(spec.runSpec) && isRecord(spec.runSpec.run) ? spec.runSpec.run : spec.runSpec;
  const runRecord = isRecord(runSpec) ? runSpec : {};
  const command = stringValue(runRecord.command) ?? stringValue(runRecord.emulator) ?? "qemu-system-riscv64";
  const args = stringValue(runRecord.command)
    ? []
    : qemuArgsFromRunSpec(runRecord, buildArtifacts[0] ?? "build/kernel.elf");
  const timeoutSecs = numberValue(runRecord.timeout_secs);
  const timeoutMs = numberValue(runRecord.timeout_ms) ?? (timeoutSecs ? timeoutSecs * 1000 : undefined);
  const successRegex = stringValue(runRecord.success_signal) ?? stringValue(runRecord.success_regex) ?? "ok";
  const profileArtifact = stringValue(runRecord.artifact) ?? buildArtifacts[0];
  const publicTests = publicMatrixTests(projectRoot);
  return {
    manifest_version: 2,
    spec_hash: specHash,
    spec_path: "spec/toolchain/toolchain.yaml",
    files: ["Makefile"].filter((file) => existsSync(path.join(projectRoot, file))),
    generator: { name: "vos-deterministic", version: "toolchain-init-v1" },
    environment: spec.environment.required_tools.length > 0
      ? spec.environment
      : { required_tools: [requiredTool("true", ">=0")] },
    build: {
      variants: [{
        id: "baseline",
        commands: [{ name: "make-all", command: ["make", "all"], timeout_ms: 60000 }],
        artifacts: buildArtifacts,
      }],
    },
    run: {
      profiles: [{
        id: "default",
        command,
        args,
        artifacts: profileArtifact ? [profileArtifact] : [],
        timeout_ms: timeoutMs,
      }],
      cases: [{
        id: "boot-smoke",
        profile: "default",
        success_regex: successRegex,
        exit_code: 0,
        timeout_ms: timeoutMs,
        required_artifacts: [],
        expected_qmp_events: [],
      }],
    },
    test: {
      suites: publicTests.map((name) => ({
        name,
        kind: "command",
        command: ["bash", "tests/public/verify.sh", name],
        related_specs: [],
      })),
    },
  };
}

function qemuArgsFromRunSpec(runSpec: Record<string, unknown>, artifact: string): string[] {
  const args: string[] = [];
  const machine = stringValue(runSpec.machine);
  if (machine) args.push("-machine", machine);
  const bios = stringValue(runSpec.bios);
  if (bios) args.push("-bios", bios);
  args.push(stringValue(runSpec.kernel_arg) ?? "-kernel", artifact);
  const memory = stringValue(runSpec.memory);
  if (memory) args.push("-m", memory);
  args.push("-smp", "1");
  const extra = Array.isArray(runSpec.extra_args) ? runSpec.extra_args.filter((item): item is string => typeof item === "string") : [];
  args.push(...extra);
  return args;
}

function publicMatrixTests(projectRoot: string): string[] {
  const matrixPath = path.join(projectRoot, "spec", "verification", "public-matrix.yaml");
  if (!existsSync(matrixPath)) return [];
  try {
    const matrix = parseTopLevelYaml(readFileSync(matrixPath, "utf8"));
    return collectStringListByKey(matrix, "required_tests");
  } catch {
    return [];
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeToolchainDraft(raw: unknown): ToolchainGenerationDraft {
  if (!raw || typeof raw !== "object") {
    throw new AgentOutputError("toolchain draft must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const files = Array.isArray(obj.files)
    ? obj.files.map((file) => {
      if (!file || typeof file !== "object") throw new AgentOutputError("toolchain draft file must be an object");
      const item = file as Record<string, unknown>;
      if (typeof item.path !== "string" || typeof item.content !== "string") {
        throw new AgentOutputError("toolchain draft files require path and content");
      }
      return { path: normalizeProjectPath(item.path), content: item.content };
    })
    : undefined;
  if (!files || files.length === 0) throw new AgentOutputError("toolchain draft requires files");
  if (!obj.manifest || typeof obj.manifest !== "object" || Array.isArray(obj.manifest)) {
    throw new AgentOutputError("toolchain draft requires manifest object");
  }
  if (typeof obj.build_instructions !== "string") {
    throw new AgentOutputError("toolchain draft requires build_instructions");
  }
  return {
    files,
    manifest: obj.manifest as Record<string, unknown>,
    build_instructions: obj.build_instructions,
    spec_refs: stringArrayValue(obj.spec_refs),
    changed_targets: stringArrayValue(obj.changed_targets),
  };
}

function validateToolchainDraftPaths(draft: ToolchainGenerationDraft, allowedOutputPaths: string[]): void {
  if (allowedOutputPaths.length === 0) {
    throw new CliError("policy_blocked: toolchain allowed_output_path is empty", "policy_blocked", {
      reason: "path_denied",
    });
  }
  const filePaths = draft.files.map((file) => normalizeProjectPath(file.path));
  for (const filePath of filePaths) {
    if (!isAllowedToolchainOutput(filePath, allowedOutputPaths)) {
      throw new CliError(`policy_blocked: disallowed toolchain output ${filePath}`, "policy_blocked", {
        reason: "path_denied",
        path: filePath,
      });
    }
  }
  const manifestFiles = stringArrayValue((draft.manifest as { files?: unknown }).files);
  if (manifestFiles.length === 0) {
    throw new AgentOutputError("toolchain manifest requires files");
  }
  const fileSet = new Set(filePaths);
  const missing = manifestFiles.map(normalizeProjectPath).filter((file) => !fileSet.has(file));
  if (missing.length > 0) {
    throw new AgentOutputError(`toolchain manifest references files not in draft: ${missing.join(", ")}`);
  }
}

function normalizeToolchainEnvironment(
  manifest: Record<string, unknown>,
): { required_tools: Array<Record<string, unknown>> } {
  const existing = manifest.environment && typeof manifest.environment === "object" && !Array.isArray(manifest.environment)
    ? (manifest.environment as { required_tools?: unknown }).required_tools
    : undefined;
  if (!Array.isArray(existing) || existing.length === 0) {
    throw new AgentOutputError("toolchain environment.required_tools is required");
  }
  const tools = existing.filter((tool): tool is Record<string, unknown> => Boolean(tool) && typeof tool === "object" && !Array.isArray(tool));
  if (tools.length === 0) {
    throw new AgentOutputError("toolchain environment.required_tools is required");
  }
  return { required_tools: tools };
}

function normalizeProfileEnvironment(profileSpec: unknown): { required_tools: RequiredToolV2[] } {
  const env = profileSpec && typeof profileSpec === "object" && !Array.isArray(profileSpec)
    ? (profileSpec as { environment?: unknown }).environment
    : undefined;
  if (!env || typeof env !== "object" || Array.isArray(env)) return { required_tools: [] };
  const out = new Map<string, RequiredToolV2>();
  for (const item of Array.isArray((env as { required_tools?: unknown }).required_tools) ? (env as { required_tools: unknown[] }).required_tools : []) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const [name, constraint] of Object.entries(item)) {
        if (typeof constraint === "string") out.set(name, requiredTool(name, constraint));
      }
    }
  }
  for (const line of stringArrayValue((env as { allowed_versions?: unknown }).allowed_versions)) {
    const match = /^(\S+)\s+(.+)$/.exec(line.trim());
    if (match && !out.has(match[1])) out.set(match[1], requiredTool(match[1], match[2]));
  }
  return { required_tools: [...out.values()] };
}

function requiredTool(name: string, constraint: string): RequiredToolV2 {
  return {
    name,
    command: name,
    version_args: ["--version"],
    version_regex: "(\\d+(?:\\.\\d+){0,3})",
    version_constraint: constraint,
    kind: toolKind(name),
  };
}

function toolKind(name: string): string {
  if (["bash", "make", "true"].includes(name)) return "utility";
  if (name.includes("qemu")) return "emulator";
  if (name.includes("objcopy") || name.includes("objdump") || name.endsWith("-ld") || name === "ld" || name === "ar") return "binutils";
  return "compiler";
}

function isAllowedToolchainOutput(candidate: string, allowedOutputPaths: string[]): boolean {
  const normalized = normalizeProjectPath(candidate);
  return allowedOutputPaths.some((allowed) => {
    const prefix = normalizeProjectPath(allowed);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

function normalizeProjectPath(value: string): string {
  return path.normalize(value.trim()).replace(/\\/g, "/").replace(/^\.\//, "");
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function printResult(result: Record<string, unknown>, asJson: boolean, verbose: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(renderOutput(result as unknown as BaseCommandResult, { verbose }));
}

export function printHelp(topic?: string, stream: "stdout" | "stderr" = "stdout"): boolean {
  const lines = STUDENT_HELP_TOPICS[topic ?? ""];
  const write = stream === "stdout" ? console.log : console.error;
  if (!lines) {
    console.error(`unknown help topic: ${topic}`);
    console.error("Run `vos --help` to list commands.");
    return false;
  }
  write(lines.join("\n"));
  return true;
}

export function printCliError(error: unknown, argv: string[]): void {
  console.error(error instanceof Error ? error.message : "unknown error");
  const topic = inferHelpTopic(argv);
  if (topic && STUDENT_HELP_TOPICS[topic]) {
    console.error("");
    printHelp(topic, "stderr");
  }
}

function helpBlock(usage: string, options: string[], examples: string[]): string[] {
  return [
    `Usage: vos ${usage}`,
    "",
    "Options:",
    ...options.map((line) => `  ${line}`),
    "",
    "Examples:",
    ...examples.map((line) => `  ${line}`),
  ];
}

function verifyHelpBlock(scope: string): string[] {
  return helpBlock(
    `verify ${scope} [--dry-run] [--target <value>] [--staff-policy <path>]`,
    ["--dry-run", "--target <value>", "--staff-policy <path>"],
    [`vos verify ${scope}`],
  );
}

const STUDENT_HELP_TOPICS: Record<string, string[]> = {
  "": [
    "vos CLI",
    `version: ${COMMAND_VERSION}`,
    "",
    "Global:",
    "  --project-root <dir>",
    "  --json",
    "  -v, --verbose",
    "  --progress auto|always|never",
    "",
    "Student workflow:",
    "  init",
    "  doctor",
    "  spec lint [<Spec ID|path|design|all>]",
    "  agent config [--show|--check|--reset]",
    "  agent implement <module>",
    "  agent debug",
    "  agent verify",
    "  agent ask [question]",
    "  agent review [<Spec ID|path|design|all>] [-i]",
    "  kb add|list|search|remove|clear|export-manifest|import-manifest",
    "  build",
    "  run qemu",
    "  run hardware",
    "  verify",
    "  report",
    "  submit",
    "",
    "Agent implementation runs in a disposable detached Git worktree. This is a rollback boundary, not a process, network, credential, or host-file security sandbox; commands inherit the current user's privileges.",
  ],
  "init": helpBlock("init", ["Creates an empty DesignSpec, toolchain ModuleSpec, vos.yaml, .gitignore, and an initial Git commit."], ["vos init"]),
  "doctor": helpBlock("doctor", ["Runs deterministic project checks, then asks the read-only Debug Agent to derive and probe required and optional host tools from the Specs."], ["vos doctor"]),
  "spec": helpBlock("spec lint [<Spec ID|path|design|all>]", ["Deterministic schema, stable-ID, reference, path, owns, level, and vos.yaml mapping checks. Omit the target for all Specs."], ["vos spec lint", "vos spec lint design", "vos spec lint kernel.memory"]),
  "spec lint": helpBlock("spec lint [<Spec ID|path|design|all>]", ["Loads the complete project so cross-Spec references remain valid, then reports diagnostics relevant to the selected target. It never calls a model."], ["vos spec lint", "vos spec lint spec/modules/memory.yaml"]),
  "agent": helpBlock("agent config|implement|debug|verify|ask|review", ["config [--show|--check|--reset]", "implement <module>", "debug", "verify", "ask [question]", "review [<Spec ID|path|design|all>] [-i]"], ["vos agent config", "vos agent ask \"What is a syscall boundary?\"", "vos agent review design", "vos agent implement memory"]),
  "agent config": helpBlock("agent config [options]", ["No options: run the interactive setup wizard.", "--provider <anthropic|openai|openai-compatible|deepseek|ollama>", "--model <id>", "--base-url <url>", "--auth-env <name>", "--with-embedding | --without-embedding", "--embedding-provider <openai|openai-compatible>", "--embedding-model <id>", "--embedding-base-url <url>", "--embedding-auth-env <name>", "--show: show configuration without secret values", "--check: validate configuration and referenced credentials", "--reset: remove agent and embedding sections"], ["vos agent config", "vos agent config --check", "vos agent config --provider openai --model gpt-5 --auth-env OPENAI_API_KEY"]),
  "agent implement": helpBlock("agent implement <module>", ["Requires clean HEAD and a committed ModuleSpec whose owns covers implementation and test paths. Generates implementation plus public, contract, fixed-seed fuzz, trace/oracle, and local hidden tests. VOS validates and atomically projects test targets into vos.yaml."], ["vos agent implement memory"]),
  "agent debug": helpBlock("agent debug", ["Read-only root-cause and evidence summary."], ["vos agent debug"]),
  "agent verify": helpBlock("agent verify", ["Read-only deterministic verification report."], ["vos agent verify"]),
  "agent ask": helpBlock("agent ask [question]", ["Question answering only; omit the question or pass --interactive for a continuing conversation. It does not modify project files."], ["vos agent ask \"What is a syscall boundary?\"", "vos agent ask"]),
  "agent review": helpBlock("agent review [<Spec ID|path|design|all>] [-i]", ["Runs deterministic lint first, then reviews the selected handwritten Spec, related Specs, and verifies mappings without modifying files. Non-interactive blocker findings fail validation; -i begins with a full review and continues as advisory Q&A."], ["vos agent review memory", "vos agent review design -i"]),
  "kb": helpBlock("kb add|list|search|remove|clear|export-manifest|import-manifest", ["KB sources are managed by commands and indexed under .vos; vos.yaml contains no knowledge source declarations."], ["vos kb add docs/reference --recursive", "vos kb list", "vos kb search \"Sv39 page table\""]),
  "kb add": helpBlock("kb add <path-or-url> [options]", ["--recursive", "--source-kind <project|course|external>", "--title <text>", "--stage <id>", "--branch <name> | --tag <name>", "--manifest <path>"], ["vos kb add docs/reference --recursive", "vos kb add https://example.invalid/reference.git --tag v1.0.0"]),
  "kb list": helpBlock("kb list", ["Lists indexed sources and stable source IDs."], ["vos kb list"]),
  "kb search": helpBlock("kb search <query>", ["Runs semantic search through the configured embedding provider."], ["vos kb search \"Sv39 page table\""]),
  "kb remove": helpBlock("kb remove <source-id>", ["Removes one indexed source and its local objects."], ["vos kb remove <source-id>"]),
  "kb clear": helpBlock("kb clear", ["Removes every indexed source from the current project."], ["vos kb clear"]),
  "kb export-manifest": helpBlock("kb export-manifest [--out <path>]", ["Exports a content-addressed KB object manifest."], ["vos kb export-manifest"]),
  "kb import-manifest": helpBlock("kb import-manifest <path>", ["Imports and verifies a previously exported object manifest."], ["vos kb import-manifest .vos/kb/manifests/object-manifest.json"]),
  "build": helpBlock("build", ["Runs the structured argv build target from vos.yaml."], ["vos build"]),
  "run": helpBlock("run qemu|hardware", ["qemu", "hardware (evidence remains pending_human_review)"], ["vos run qemu"]),
  "run qemu": helpBlock("run qemu", ["Captures non-graphical serial output from the manifest runner."], ["vos run qemu"]),
  "run hardware": helpBlock("run hardware", ["Records board/build/serial evidence and never self-approves human review."], ["vos run hardware"]),
  "verify": helpBlock("verify [--hidden]", ["Requires clean HEAD; runs spec lint, build, and every public, contract, fixed-seed fuzz, and trace target deterministically. --hidden runs the suite bound to the current Spec and config, then binds its result to the current commit."], ["vos verify", "vos verify --hidden"]),
  "report": helpBlock("report", ["Generates deterministic .vos/report.json without invoking a model or committing."], ["vos report"]),
  "submit": helpBlock("submit", ["Requires a current successful vos verify --hidden, refreshes the report, and creates a private reproducible archive bound to commit/spec/config/test hashes."], ["vos submit"]),
};

const HELP_TOPICS: Record<string, string[]> = {
  "": [
    "vos CLI",
    `version: ${COMMAND_VERSION}`,
    "",
    "Global:",
    "  --project-root <dir>",
    "  --json",
    "  -v, --verbose",
    "  --progress auto|always|never",
    "  --agent-session <id>",
    "  --report <path>",
    "  --evidence-dir <path>",
    "",
    "Commands:",
    "  login --portal-url <url> [--token <token>|--token-stdin]  # device flow when token is omitted",
    "  logout [--portal-url <url>]",
    "  whoami [--portal-url <url>]",
    "  pipeline trigger --reason <text> [--scope public|staff|final] [--model-credential <id>]",
    "  pipeline status|watch|evidence|reproduce <run-id>",
    "  pipeline download <run-id> [--out <directory>]",
    "  pipeline cancel <run-id> --reason <text>",
    "  project bind --portal-url <url> --project-id <id>",
    "  serve --portal-url <url> --project-id <id> [--host <host>] [--port <port>]",
    "  init",
    "  doctor",
    "  stage show|save --intent <text> [--actor human|agent]",
    "  toolchain lint|init [--force]",
    "  spec lint [<Spec ID|path|design|all>]",
    "  spec normalize",
    "  spec check-consistency",
    "  spec patch lint <patch-yaml|commit-ish>",
    "  spec patch apply <patch-yaml|commit-ish>",
    "  arch lint [--no-agent] [path]",
    "  arch compose [path]",
    "  arch derive-tests [path]",
    "  build [--dry-run] [--toolchain <path>]",
    "  build generate [--agent-session <id>] [--no-agent]",
    "  run qemu [--dry-run] [--timeout=<ms>]",
    "  test [--dry-run] [--suite=<name>]...",
    "  verify public|patch|full|invariant|generated|fuzz [--target <value>] [--staff-policy <path>]",
    "  trace syscall [--dry-run] [--timeout=<ms>]",
    "  debug explain-log [log-path]",
    "  report generate [--stage <stage>|--final]",
    "  submit pack",
    "  ledger record --actor human|agent --intent <text> [--spec-ref <ref>]... [--changed-target <path>]...",
    "  kb add <path-or-url> [--source-kind course|project|external] [--stage <stage>] [--title <title>] [--recursive] [--manifest <path>]",
    "  kb list",
    "  kb search <query>",
    "  kb remove <source-id>",
    "  kb clear",
    "  kb export-manifest [--out <path>]",
    "  kb import-manifest <path>",
    "  agent serve [-i] [--host --port]",
    "  agent context [-i] [--scope <scope>]",
    "  agent plan [-i] [--scope <scope>|--stage <stage>] [--task <task>]",
    "  agent ask [-i|--interactive] [--stage <stage>|--scope <scope>] [question]",
    "  agent generate [-i] [target] [--target <target>] [--apply] [--build] [--run]",
    "  agent apply-patch [-i] [--patch-file <file>] [--run-validation] [--no-require-spec]",
    "  agent validate-generated [-i] --target <value> [--patch-file <file>] [--keep-worktree]",
    "  agent review [<Spec ID|path|design|all>] [-i]",
    "  agent debug [-i] [--run <run-id>] [--log <path>] [--keep-worktree]  # no args starts fixed debug REPL",
    "  agent log [-i] [--append] [entry-path]",
    "",
    "  -i on finite agent commands opens a readonly TUI flow display; ask -i and empty debug keep their fixed-profile REPLs.",
  ],
  "login": helpBlock(
    "login --portal-url <url> [--token <token>|--token-stdin]",
    ["--portal-url <url>", "--token <token>", "--token-stdin", "Omit token flags to use CLI device authorization."],
    ["vos login --portal-url https://portal.example", "vos login --portal-url https://portal.example --token-stdin"],
  ),
  "logout": helpBlock("logout [--portal-url <url>]", ["--portal-url <url>"], ["vos logout"]),
  "whoami": helpBlock("whoami [--portal-url <url>]", ["--portal-url <url>"], ["vos whoami"]),
  "pipeline": helpBlock("pipeline trigger|status|watch|cancel|evidence|download|reproduce",["trigger --reason <text> [--scope public|staff|final] [--model-credential <id>]","status <run-id>","watch <run-id>","cancel <run-id> --reason <text>","evidence <run-id>","download <run-id> [--out <directory>]","reproduce <run-id>"],["vos pipeline trigger --reason \"submit memory stage\"","vos pipeline watch run-123","vos pipeline download run-123"]),
  "project bind": helpBlock("project bind --portal-url <url> --project-id <id>",["--portal-url <url>","--project-id <id>"],["vos project bind --portal-url https://portal.example --project-id project-1"]),
  "serve": helpBlock(
    "serve --portal-url <url> --project-id <id> [--host <host>] [--port <port>]",
    ["--portal-url <url>", "--project-id <id>", "--host <host>", "--port <port>"],
    ["vos serve --portal-url https://portal.example --project-id project-1"],
  ),
  "init": helpBlock("init", ["No command-specific options."], ["vos init"]),
  "doctor": helpBlock("doctor", ["No command-specific options."], ["vos doctor"]),
  "stage": helpBlock("stage show|save ...", ["show", "save --intent <text> [--actor human|agent]"], ["vos stage show"]),
  "stage show": helpBlock("stage show", ["No command-specific options."], ["vos stage show"]),
  "stage save": helpBlock(
    "stage save --intent <text> [--actor human|agent]",
    ["--intent <text>", "--actor human|agent"],
    ["vos stage save --intent \"save boot stage\" --actor human"],
  ),
  "toolchain": helpBlock("toolchain lint|init ...", ["lint", "init [--force]"], ["vos toolchain lint"]),
  "toolchain lint": helpBlock("toolchain lint", ["No command-specific options."], ["vos toolchain lint"]),
  "toolchain init": helpBlock("toolchain init [--force]", ["--force"], ["vos toolchain init --force"]),
  "spec": helpBlock(
    "spec lint|normalize|check-consistency|patch ...",
    ["lint [<Spec ID|path|design|all>]", "normalize", "check-consistency", "patch lint|apply <patch-yaml|commit-ish>"],
    ["vos spec lint spec/modules/memory.yaml"],
  ),
  "spec lint": helpBlock("spec lint [<Spec ID|path|design|all>]", ["target is optional and defaults to all"], ["vos spec lint design", "vos spec lint kernel/memory"]),
  "spec normalize": helpBlock("spec normalize", ["No command-specific options."], ["vos spec normalize"]),
  "spec check-consistency": helpBlock("spec check-consistency", ["No command-specific options."], ["vos spec check-consistency"]),
  "spec patch": helpBlock(
    "spec patch lint|apply <patch-yaml|commit-ish>",
    ["lint <patch-yaml|commit-ish>", "apply <patch-yaml|commit-ish>"],
    ["vos spec patch lint change.yaml"],
  ),
  "spec patch lint": helpBlock(
    "spec patch lint <patch-yaml|commit-ish>",
    ["<patch-yaml|commit-ish>"],
    ["vos spec patch lint change.yaml"],
  ),
  "spec patch apply": helpBlock(
    "spec patch apply <patch-yaml|commit-ish>",
    ["<patch-yaml|commit-ish>"],
    ["vos spec patch apply change.yaml"],
  ),
  "arch": helpBlock(
    "arch lint|compose|derive-tests ...",
    ["lint [--no-agent] [path]", "compose [path]", "derive-tests [path]"],
    ["vos arch lint --no-agent"],
  ),
  "arch lint": helpBlock("arch lint [--no-agent] [path]", ["--no-agent", "path"], ["vos arch lint --no-agent"]),
  "arch compose": helpBlock("arch compose [path]", ["path"], ["vos arch compose spec/arch.yaml"]),
  "arch derive-tests": helpBlock("arch derive-tests [path]", ["path"], ["vos arch derive-tests spec/arch.yaml"]),
  "build": helpBlock(
    "build [--dry-run] [--toolchain <path>] [--variant <name>]",
    ["--dry-run", "--toolchain <path>", "--variant <name>"],
    ["vos build", "vos build --dry-run"],
  ),
  "build generate": helpBlock(
    "build generate [--agent-session <id>] [--no-agent]",
    ["--agent-session <id>", "--no-agent"],
    ["vos build generate --no-agent"],
  ),
  "run": helpBlock("run qemu ...", ["qemu [--dry-run] [--timeout <ms>] [--profile <id>] [--case <id>]"], ["vos run qemu"]),
  "run qemu": helpBlock(
    "run qemu [--dry-run] [--timeout <ms>] [--ready-pattern <text>] [--profile <id>] [--case <id>] [--list-profiles] [--list-cases]",
    ["--dry-run", "--timeout <ms>", "--ready-pattern <text>", "--profile <id>", "--case <id>", "--list-profiles", "--list-cases"],
    ["vos run qemu --profile syscall --case write-smoke"],
  ),
  "test": helpBlock("test [--dry-run] [--suite <name>]...", ["--dry-run", "--suite <name>"], ["vos test --suite public"]),
  "verify": helpBlock(
    "verify public|patch|full|invariant|generated|fuzz [--target <value>] [--staff-policy <path>]",
    ["public|patch|full|invariant|generated|fuzz", "--target <value>", "--staff-policy <path>", "--dry-run"],
    ["vos verify public", "vos verify full --staff-policy ../staff/verify.json"],
  ),
  "verify public": verifyHelpBlock("public"),
  "verify patch": verifyHelpBlock("patch"),
  "verify full": verifyHelpBlock("full"),
  "verify invariant": verifyHelpBlock("invariant"),
  "verify generated": verifyHelpBlock("generated"),
  "verify fuzz": verifyHelpBlock("fuzz"),
  "trace": helpBlock("trace syscall ...", ["syscall [--dry-run] [--timeout <ms>]"], ["vos trace syscall --dry-run"]),
  "trace syscall": helpBlock("trace syscall [--dry-run] [--timeout <ms>]", ["--dry-run", "--timeout <ms>"], ["vos trace syscall --timeout=10000"]),
  "debug": helpBlock("debug explain-log [log-path]", ["explain-log [log-path]"], ["vos debug explain-log .vos/runs/run/log.jsonl"]),
  "debug explain-log": helpBlock("debug explain-log [log-path]", ["log-path"], ["vos debug explain-log"]),
  "report": helpBlock("report generate [--stage <stage>|--final]", ["generate [--stage <stage>|--final]"], ["vos report generate --final"]),
  "report generate": helpBlock("report generate [--stage <stage>|--final]", ["--stage <stage>", "--final"], ["vos report generate --stage boot"]),
  "submit": helpBlock("submit pack", ["pack"], ["vos submit pack"]),
  "submit pack": helpBlock("submit pack", ["No command-specific options."], ["vos submit pack"]),
  "ledger": helpBlock("ledger record ...", ["record --actor human|agent --intent <text>"], ["vos ledger record --actor human --intent \"manual fix\""]),
  "ledger record": helpBlock(
    "ledger record --actor human|agent --intent <text> [--spec-ref <ref>]... [--changed-target <path>]...",
    ["--actor human|agent", "--intent <text>", "--spec-ref <ref>", "--changed-target <path>"],
    ["vos ledger record --actor human --intent \"manual fix\" --changed-target kernel/syscall.c"],
  ),
  "kb": helpBlock(
    "kb add|list|search|remove|clear|export-manifest|import-manifest ...",
    ["add <path-or-url>", "list", "search <query>", "remove <source-id>", "clear", "export-manifest [--out <path>]", "import-manifest <path>"],
    ["vos kb search allocator"],
  ),
  "kb add": helpBlock(
    "kb add <path-or-url> [--source-kind course|project|external] [--stage <stage>] [--title <title>] [--recursive] [--manifest <path>]",
    ["--source-kind course|project|external", "--stage <stage>", "--title <title>", "--recursive", "--manifest <path>", "--branch <name>", "--tag <name>"],
    ["vos kb add docs/manual.md --source-kind course --stage memory"],
  ),
  "kb list": helpBlock("kb list", ["No command-specific options."], ["vos kb list"]),
  "kb search": helpBlock("kb search <query>", ["<query>"], ["vos kb search allocator invariant"]),
  "kb remove": helpBlock("kb remove <source-id>", ["<source-id>"], ["vos kb remove kb-123"]),
  "kb clear": helpBlock("kb clear", ["No command-specific options."], ["vos kb clear"]),
  "kb export-manifest": helpBlock("kb export-manifest [--out <path>]", ["--out <path>"], ["vos kb export-manifest --out kb-manifest.json"]),
  "kb import-manifest": helpBlock("kb import-manifest <path>", ["<path>"], ["vos kb import-manifest kb-manifest.json"]),
  "agent": helpBlock(
    "agent serve|context|plan|ask|review|generate|apply-patch|validate-generated|debug|log ...",
    ["serve", "context", "plan", "ask", "review", "generate", "apply-patch", "validate-generated", "debug", "log"],
    ["vos agent plan --stage memory \"check allocator design\""],
  ),
  "agent serve": helpBlock("agent serve [-i] [--host <host>] [--port <port>]", ["-i, --interactive", "--host <host>", "--port <port>"], ["vos agent serve --port 8787"]),
  "agent context": helpBlock("agent context [-i] [--scope <scope>]", ["-i, --interactive", "--scope <scope>", "--stage <stage>"], ["vos agent context --scope memory"]),
  "agent plan": helpBlock("agent plan [-i] [--scope <scope>|--stage <stage>] [--task <task>]", ["-i, --interactive", "--scope <scope>", "--stage <stage>", "--task <task>"], ["vos agent plan --stage syscall \"check allocator design\""]),
  "agent ask": helpBlock("agent ask [-i|--interactive] [--stage <stage>|--scope <scope>] [question]", ["-i, --interactive", "--stage <stage>", "--scope <scope>", "--task <question>"], ["vos agent ask --stage memory \"How should I design kalloc?\""]),
  "agent generate": helpBlock(
    "agent generate [-i] [target] [--target <target>] [--task <task>] [--apply] [--build] [--run]",
    ["-i, --interactive", "--target <target>", "--task <task>", "--apply", "--build", "--run"],
    ["vos agent generate kernel/memory --apply --build"],
  ),
  "agent apply-patch": helpBlock(
    "agent apply-patch [-i] [--patch-file <file>] [--run-validation] [--no-require-spec]",
    ["-i, --interactive", "--patch-file <file>", "--run-validation", "--no-require-spec"],
    ["vos agent apply-patch --patch-file candidate.patch --run-validation"],
  ),
  "agent validate-generated": helpBlock(
    "agent validate-generated [-i] --target <value> [--patch-file <file>] [--keep-worktree]",
    ["-i, --interactive", "--target <value>", "--patch-file <file>", "--keep-worktree"],
    ["vos agent validate-generated --target full-syscall --patch-file candidate.patch"],
  ),
  "agent review": helpBlock("agent review [<Spec ID|path|design|all>] [-i]", ["-i, --interactive"], ["vos agent review kernel/memory"]),
  "agent debug": helpBlock(
    "agent debug [-i] [--run <run-id>] [--log <path>] [--keep-worktree]",
    ["-i, --interactive", "--run <run-id>", "--log <path>", "--keep-worktree"],
    ["vos agent debug --run run-1"],
  ),
  "agent log": helpBlock("agent log [-i] [--append] [entry-path]", ["-i, --interactive", "--append", "--entry <path>", "entry-path"], ["vos agent log --append entry.json"]),
};

function inferHelpTopic(argv: string[]): string | undefined {
  const valueFlags = new Set(["--project-root", "--progress", "--agent-session", "--report", "--evidence-dir"]);
  const tokens: string[] = [];
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (valueFlags.has(arg)) {
      i++;
      continue;
    }
    if ([...valueFlags].some((flag) => arg.startsWith(`${flag}=`))) continue;
    if (arg === "--json" || arg === "-v" || arg === "--verbose") continue;
    if (arg.startsWith("-")) break;
    tokens.push(arg);
  }
  if (tokens[0] === "help") tokens.shift();
  for (let length = tokens.length; length > 0; length--) {
    const topic = tokens.slice(0, length).join(" ");
    if (STUDENT_HELP_TOPICS[topic] || HELP_TOPICS[topic]) return topic;
  }
  return undefined;
}

function extractPatchTouches(patchText: string): string[] {
  const changed = new Set<string>();
  for (const line of patchText.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const rest = line.slice(4).trim();
      if (!rest || rest === "/dev/null") continue;
      changed.add(rest.replace(/^b\//, ""));
    }
    if (line.startsWith("--- ")) {
      const rest = line.slice(4).trim();
      if (!rest || rest === "/dev/null") continue;
      changed.add(rest.replace(/^a\//, ""));
    }
  }
  return [...changed];
}

export { executeCommand };
export { startAgentServer } from "./agent/runner.ts";
export type { CommandOutcome, ExecContext, ExecuteCliOptions } from "./bootstrap.ts";

if (import.meta.main) {
  main();
}
