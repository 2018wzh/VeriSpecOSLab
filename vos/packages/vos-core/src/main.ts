#!/usr/bin/env bun

import { parseArgs } from "./cli.ts";
import type {
  AgentApplyPatchCommand,
  AgentContextCommand,
  AgentDebugCommand,
  AgentGenerateCommand,
  AgentLogCommand,
  AgentPlanCommand,
  AgentReviewSpecCommand,
  AgentServeCommand,
  AgentValidateGeneratedCommand,
  AgentAskCommand,
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
  ParsedInvocation,
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
import { withProjectEnv } from "./utils/dotenv.ts";
import { executeCommand } from "./dispatch.ts";
import {
  ensureDefaultProjectConfig,
  loadPolicyConfig,
  loadTimeline,
  loadProjectConfig,
  currentStageForProject,
} from "./utils/project.ts";
import { appendLogEntry, readLogEntries } from "./agent/helpers.ts";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderOutput } from "./output.ts";
import { createCommandProgress } from "./progress/index.ts";
import type { CommandProgress, ProgressUpdate } from "./progress/types.ts";
import { runProgressMcpServer } from "./progress/mcp-server.ts";
import {
  appendAgentProgressInstructions,
  createProgressMcpServerConfig,
  progressUpdateFromAgentEvent,
} from "./progress/agent.ts";
import { runBuildCommand } from "./runtime/build.ts";
import { probeRequiredTools } from "./runtime/environment.ts";
import { createSubmitPack } from "./submit/pack.ts";
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
  parseJsonFromText,
  runAgentWithPrompt,
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
import { defaultPortalClient, type PortalClient } from "./auth/portal-client.ts";
import { getToken, normalizePortalUrl, removeToken, saveToken, updateStoredUser } from "./auth/store.ts";
import { assertCommandAllowed, mergeEffectivePolicy } from "./policy/effective-policy.ts";
import type { RunEvent } from "./evidence/events.ts";
import {
  appendLedgerEntry,
  assertReproducible,
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
} from "vos-spec";
import {
  addKbSource,
  clearKbSources,
  exportKbManifest,
  importKbManifest,
  listKbSources,
  removeKbSource,
  searchKb,
} from "vos-kb";

const COMMAND_VERSION = "0.1.0";
const DEBUG_TRACE_AGENT_ATTEMPTS = 3;

async function main(): Promise<void> {
  try {
    if (process.argv[2] === "internal" && process.argv[3] === "progress-mcp") {
      await runProgressMcpServer();
      return;
    }

    const parsed = parseArgs(process.argv);
    if (parsed.command.kind === "help") {
      printHelp(parsed.command.topic);
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
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error("unknown error");
    }
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
    await ensureDefaultProjectConfig(projectRoot);
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

export interface ExecuteVosCommandOptions {
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
    await ensureDefaultProjectConfig(projectRoot);
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
  if (params.parsed.command.kind === "report_generate" && isSuccessStatus(params.outcome.status)) {
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

  const project = await loadProjectConfig(params.projectRoot);
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
  if (isReproBypassCommand(command)) {
    return {
      commitSha: currentHead(projectRoot),
      parentSha: parentSha(projectRoot),
    };
  }
  if (!isReproControlledCommand(command)) {
    return {};
  }
  const verdict = await assertReproducible(projectRoot);
  return {
    commitSha: verdict.commitSha,
    parentSha: verdict.parentSha,
    ledgerRef: verdict.ledgerRef,
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
    command.kind === "stage_save" ||
    command.kind === "ledger_record";
}

function isReproControlledCommand(command: CliCommand): boolean {
  return command.kind !== "doctor";
}

export async function executeInit(
  _command: InitCommand,
  context: ExecContext,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const evidence = context.evidence;
  await ensureDefaultProjectConfig(projectRoot);
  await ensureHeadLedgerEntry({
    projectRoot,
    actor: "human",
    intent: "initialize VOS project ledger",
    specRefs: [],
    changedTargets: [".vos/project.yaml", ".vos/policy.yaml", ".gitignore", "AGENTS.md"],
    runId: evidence.run_id,
  });
  return { status: "passed", details: { initialized: true, ledger: true } };
}

export async function executeDoctor(
  _command: DoctorCommand,
  projectRoot: string,
): Promise<CommandOutcome> {
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
  try {
    const project = await loadProjectConfig(projectRoot);
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
      required: true,
      ok: false,
      message: errorMessage(error),
      hint: "run `vos build generate` to create .vos/toolchain.json",
    });
    suggested.add("vos build generate");
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

  for (const command of OPTIONAL_DEVBOX_COMMANDS) {
    if (!requiredCommands.has(command)) {
      checks.push(doctorCommandCheck(command, "devbox", undefined, false));
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
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const project = await loadProjectConfig(projectRoot);
  const bundle = await buildNormalizedSpecBundle({
    projectRoot,
    specRoot: project.spec_root ?? "spec",
    targetPath: command.path,
  });
  const bundlePath = await writeNormalizedBundle(projectRoot, bundle, evidence);
  const agentReview = command.noAgent
    ? deterministicOnlyAgentReview("spec lint")
    : await runDefaultAgentSpecReview({
      command: "spec lint",
      target: command.path,
      bundle,
      context,
      evidence,
    });
  return {
    status: hasBlockingDiagnostics(bundle.diagnostics) ? "validation_failed" : "passed",
    details: {
      diagnostics: bundle.diagnostics,
      bundle_ref: path.relative(projectRoot, bundlePath),
      agent_review: agentReview,
      source_count: bundle.sources.length,
      module_count: bundle.modules.length,
      operation_count: bundle.operations.length,
    },
  };
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

export async function executeSubmitPack(
  _command: SubmitPackCommand,
  projectRoot: string,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
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
  const token = command.token
    ?? (command.tokenStdin ? (await Bun.stdin.text()).trim() : undefined)
    ?? process.env.VOS_PORTAL_TOKEN;
  if (!token) {
    throw new CliError("login requires --token, --token-stdin, or VOS_PORTAL_TOKEN", "failed");
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

export async function executeLogout(command: LogoutCommand, projectRoot: string): Promise<CommandOutcome> {
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
    if (project?.project_id) {
      const policy = await (context.portalClient ?? defaultPortalClient).getProjectPolicy(portalUrl, project.project_id, stored.token);
      policySnapshotRef = policy.ref;
    }
    return {
      status: "passed",
      details: {
        portal_url: normalizePortalUrl(portalUrl),
        project_id: project?.project_id,
        authenticated: true,
        user,
        policy_status: project?.project_id ? "online" : "no_project_binding",
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
  projectRoot: string,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const source = await addKbSource(projectRoot, {
    source: command.source,
    sourceKind: command.sourceKind,
    stage: command.stage,
    title: command.title,
    recursive: command.recursive,
    branch: command.branch,
    tag: command.tag,
  }, { embedder: createKbEmbedder(projectRoot) });
  const artifact = path.join(projectRoot, ".vos", "kb", "last-add.json");
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(source, null, 2)}\n`);
  evidence.addArtifact("kb", path.relative(projectRoot, artifact), "kb source added");
  if (command.manifestPath) {
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

export async function executeAgentReviewSpec(
  command: AgentReviewSpecCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const project = await loadProjectConfig(context.projectRoot);
  const bundle = await buildNormalizedSpecBundle({
    projectRoot: context.projectRoot,
    specRoot: project.spec_root ?? "spec",
    targetPath: command.target,
  });
  const review = await runDefaultAgentSpecReview({
    command: "agent review-spec",
    target: command.target,
    bundle,
    context,
    evidence,
  });
  return {
    status: hasBlockingDiagnostics(bundle.diagnostics) ? "validation_failed" : "passed",
    details: {
      target: command.target,
      diagnostics: bundle.diagnostics,
      agent_review: review,
    },
  };
}

export async function executeAgentAsk(
  command: AgentAskCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const requestedScope = command.scope ?? await currentStageForProject(projectRoot).catch(() => "agent.ask");
  updateProgress(context, { stage: "agent ask", status: "running", message: "building context" });
  const bundle = await buildContextBundle({
    projectRoot,
    requestedScope,
    effectivePolicy: context.effectivePolicy,
  });
  const embedder = createKbEmbedder(projectRoot);
  const kbHits = command.question
    ? await searchKb(projectRoot, command.question, { limit: 5, embedder })
    : [];
  const kbManifest = await exportKbManifest(projectRoot);
  const kbMcpServer = {
    name: "vos-kb",
    command: process.execPath,
    args: [path.resolve(import.meta.dir, "../../../packages/vos-kb/src/mcp.ts")],
    cwd: projectRoot,
    env: { VOS_PROJECT_ROOT: projectRoot, ...kbEmbeddingEnv(projectRoot) },
  };
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
      extraMcpServers: [kbMcpServer],
      runner: context.interactiveAgentRunner,
    });
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
    extraMcpServers: [
      ...agentProgress.extraMcpServers,
      kbMcpServer,
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
  if (!command.logPath && !command.runId) {
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
      extraMcpServers: agentProgress.extraMcpServers,
      onEvent: agentProgress.onEvent,
      taskRunner: context.agentRunner,
    });
  } catch (error) {
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
  return createHash("sha256").update(await readFile(bundlePath)).digest("hex");
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
  bundle: NormalizedSpecBundle;
  impact?: unknown;
  context: ExecContext;
  evidence: EvidenceWriter;
}): Promise<AgentSpecReview> {
  const reviewInput = {
    command: params.command,
    target: params.target,
    diagnostics: params.bundle.diagnostics,
    counts: {
      sources: params.bundle.sources.length,
      modules: params.bundle.modules.length,
      operations: params.bundle.operations.length,
      public_requirements: params.bundle.verification.public_requirements.length,
    },
    architecture: {
      stages: params.bundle.architecture.stages.map((stage) => stage.stage),
    },
    impact: params.impact,
  };
  const prompt = [
    "Review this VOS spec result for design conflicts and tradeoffs.",
    AGENTS_READONLY_GUIDANCE_PROMPT,
    "Return JSON only with { findings: [{ severity, message, related_specs, suggested_actions }], summary }.",
    "Severity must be one of info, warning, error, blocker.",
    "Your findings are advisory and must be grounded in the provided diagnostics or spec refs.",
    "If a missing public spec or agent workflow convention belongs in AGENTS.md, mention that in suggested_actions.",
    JSON.stringify(reviewInput, null, 2),
  ].join("\n\n");

  try {
    const agentProgress = createAgentProgressParams(params.context, "agent spec review");
    const response = await runAgentWithPrompt({
      projectRoot: params.context.projectRoot,
      taskPrompt: agentProgress.taskPrompt(prompt),
      taskKind: "design_review",
      requestedScope: "agent.review-spec",
      context: reviewInput,
      courseMode: true,
      allowedVosCommands: await loadAgentAllowedCommands(params.context.projectRoot, params.context.effectivePolicy),
      extraMcpServers: agentProgress.extraMcpServers,
      onEvent: agentProgress.onEvent,
      taskRunner: params.context.agentRunner,
    });
    const review = parseAgentSpecReview(agentStructuredOutput(response, "agent_review_spec"), response.resultText);
    await writeAgentReviewArtifact(params.context.projectRoot, params.evidence, review);
    return review;
  } catch (error) {
    const review: AgentSpecReview = {
      status: "unavailable",
      findings: [{
        severity: "warning",
        message: `agent review unavailable: ${error instanceof Error ? error.message : String(error)}`,
        related_specs: [],
        suggested_actions: ["configure vos-agent model credentials or rerun `vos agent review-spec`"],
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
    taskPrompt: appendAgentProgressInstructions,
    extraMcpServers: [createProgressMcpServerConfig(context.projectRoot)],
    onEvent: async (event) => {
      context.readonlyDisplay?.onSessionEvent(event as never);
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
    case "spec_lint":
      return ["spec", "lint", ...(command.noAgent ? ["--no-agent"] : []), ...(command.path ? [command.path] : [])];
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
    case "agent_log":
      return [
        "agent",
        "log",
        ...(command.display ? ["-i"] : []),
        ...(command.append ? ["--append"] : []),
        ...(command.inputPath ? [command.inputPath] : []),
      ];
    case "agent_review_spec":
      return [
        "agent",
        "review-spec",
        ...(command.display ? ["-i"] : []),
        ...(command.target ? ["--target", command.target] : []),
      ];
    case "agent_ask":
      return [
        "agent",
        "ask",
        ...(command.interactive && command.question ? ["-i"] : []),
        ...(command.scope ? ["--stage", command.scope] : []),
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
        "generate",
        ...(command.final ? ["--final"] : []),
        ...(command.stage ? ["--stage", command.stage] : []),
      ];
    case "submit_pack":
      return ["submit", "pack"];
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
  const envPath = process.env.PATH?.split(path.delimiter) ?? [];
  const candidates = process.platform === "win32"
    ? [".exe", ".cmd", "", ".bat"].map((suffix) => cmd + suffix)
    : [cmd];
  return envPath.some((dir) => {
    return candidates.some((candidate) => existsSync(path.join(dir, candidate)));
  });
}

type DoctorCategory = "base" | "project" | "toolchain" | "toolchain-command" | "devbox";

interface DoctorCheck {
  name: string;
  category: DoctorCategory;
  required: boolean;
  ok: boolean;
  command?: string;
  message?: string;
  hint?: string;
}

const OPTIONAL_DEVBOX_COMMANDS = [
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

function parseAgentJson(raw: string, source: string): unknown {
  const parsed = parseJsonFromText(raw);
  if (!parsed) {
    throw new AgentOutputError(`agent output for ${source} is not parseable JSON`);
  }
  return parsed;
}

function agentStructuredOutput(result: Awaited<ReturnType<typeof runAgentWithPrompt>>, source: string): unknown {
  return result.parsedResult ?? parseAgentJson(result.resultText, source);
}

function agentTracePlanText(result: Awaited<ReturnType<typeof runAgentWithPrompt>>): string {
  return result.parsedResult
    ? `${JSON.stringify(result.parsedResult, null, 2)}\n`
    : result.resultText;
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

export function printHelp(topic?: string): void {
  const globalHelp = [
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
    "  login --portal-url <url> [--token <token>|--token-stdin]",
    "  logout [--portal-url <url>]",
    "  whoami [--portal-url <url>]",
    "  serve --portal-url <url> --project-id <id> [--host <host>] [--port <port>]",
    "  init",
    "  doctor",
    "  stage show|save --intent <text> [--actor human|agent]",
    "  toolchain lint|init [--force]",
    "  spec lint [--no-agent] [path]",
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
    "  agent review-spec [-i] [--target <path|stage|patch>]",
    "  agent debug [-i] [--run <run-id>] [--log <path>] [--keep-worktree]  # no args starts fixed debug REPL",
    "  agent log [-i] [--append] [entry-path]",
    "",
    "  -i on finite agent commands opens a readonly TUI flow display; ask -i and empty debug keep their fixed-profile REPLs.",
  ];
  console.log(globalHelp.join("\n"));
  if (topic) {
    console.log(`\nUnknown topic: ${topic}`);
  }
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
