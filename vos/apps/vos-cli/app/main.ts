#!/usr/bin/env bun

import { parseArgs, type ParsedInvocation } from "./cli.ts";
import type {
  AgentApplyPatchCommand,
  AgentContextCommand,
  AgentDebugCommand,
  AgentGenerateCommand,
  AgentLogCommand,
  AgentPlanCommand,
  AgentServeCommand,
  ArchComposeCommand,
  ArchDeriveTestsCommand,
  ArchLintCommand,
  BaseCommandResult,
  BuildCommand,
  CliCommand,
  CommandStatus,
  DebugExplainLogCommand,
  DoctorCommand,
  InitCommand,
  ReportGenerateCommand,
  RunQemuCommand,
  StageShowCommand,
  SpecCheckConsistencyCommand,
  SpecLintCommand,
  SpecNormalizeCommand,
  SpecPatchApplyCommand,
  SpecPatchLintCommand,
  SubmitPackCommand,
  TestCommand,
  ToolchainLintCommand,
  TraceSyscallCommand,
  VerifyCommand,
} from "./types.ts";
import { CliError, AgentOutputError } from "./errors.ts";
import { EvidenceWriter } from "./evidence/index.ts";
import { collectStringListByKey, parseTopLevelYaml } from "./utils/yaml.ts";
import { withProjectEnv } from "./utils/dotenv.ts";
import {
  ensureDefaultProjectConfig,
  loadPolicyConfig,
  loadTimeline,
  loadProjectConfig,
  currentStageForProject,
} from "./utils/project.ts";
import { appendLogEntry, readLogEntries } from "./agent/helpers.ts";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { renderOutput } from "./output.ts";
import { runBuildCommand } from "./runtime/build.ts";
import { runQemuCommand } from "./runtime/run.ts";
import { runTestCommand } from "./runtime/test.ts";
import { runVerifyCommand } from "./runtime/verify.ts";
import { resolveToolchainManifestPath } from "./runtime/toolchain-manifest.ts";
import { buildContextBundle, loadAgentAllowedPaths } from "./agent/context.ts";
import { buildPromptEnvelope, formatPrompt, FIXED_PROMPT_IDS } from "./agent/prompt.ts";
import {
  parseJsonFromText,
  runAgentWithPrompt,
  startAgentServer,
  type HeadlessAgentRunner,
} from "./agent/runner.ts";
import { parseDebugOutput, parsePatchProposal, parsePlanDraft } from "./agent/schemas.ts";
import { applyPatchText, readPatchFromStdin } from "./agent/apply-patch.ts";

const COMMAND_VERSION = "0.1.0";

interface CommandOutcome {
  status: CommandStatus;
  details: Record<string, unknown>;
}

interface ExecContext {
  projectRoot: string;
  global: ParsedInvocation["global"];
  evidence: EvidenceWriter;
  agentRunner?: HeadlessAgentRunner;
}

async function main(): Promise<void> {
  try {
    const parsed = parseArgs(process.argv);

    if (parsed.command.kind === "help") {
      printHelp(parsed.command.topic);
      return;
    }

    const projectRoot = path.resolve(parsed.global.projectRoot);
    await withProjectEnv(projectRoot, async () => {
      await ensureDefaultProjectConfig(projectRoot);

      const evidence = await EvidenceWriter.create({
        projectRoot,
        evidenceDir: parsed.global.evidenceDir ?? ".vos",
        command: commandToArray(parsed.command),
        args: process.argv.slice(2),
      });

      try {
        const outcome = await executeCommand(parsed.command, {
          projectRoot,
          global: parsed.global,
          evidence,
        });
        const manifest = await evidence.finalize(outcome.status, {
          message: typeof outcome.details.message === "string" ? outcome.details.message : undefined,
        });

        const finalOutput = {
          ok: isSuccessStatus(outcome.status),
          run_id: evidence.run_id,
          command: manifest.command,
          status: manifest.status,
          artifacts: manifest.artifacts,
          evidence_refs: manifest.evidence_refs,
          started_at: manifest.started_at,
          finished_at: manifest.finished_at,
          message: (outcome.details.message as string | undefined) ?? "ok",
          details: outcome.details,
        };

        if (parsed.global.reportPath) {
          await writeFile(parsed.global.reportPath, `${JSON.stringify(finalOutput, null, 2)}\n`);
        }

        printResult(finalOutput, parsed.global.json);
      } catch (error) {
        const status = classifyErrorStatus(error);
        await evidence.finalize(status, {
          message: error instanceof Error ? error.message : "unknown error",
        });
        const manifest = await evidence.writeManifest({
          status,
          finishedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : "unknown error",
        });
        printResult({
          ok: false,
          run_id: evidence.run_id,
          command: manifest.command,
          status,
          artifacts: manifest.artifacts,
          evidence_refs: manifest.evidence_refs,
          started_at: manifest.started_at,
          finished_at: manifest.finished_at,
          message: error instanceof Error ? error.message : "unknown error",
          details: {
            error: true,
          },
        }, parsed.global.json);
        process.exitCode = isSuccessStatus(status) ? 0 : 1;
        return;
      }
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error("unknown error");
    }
    process.exitCode = 1;
  }
}

export async function executeCommand(command: CliCommand, context: ExecContext): Promise<CommandOutcome> {
  const { projectRoot, evidence } = context;

  switch (command.kind) {
    case "init":
      await ensureDefaultProjectConfig(projectRoot);
      return { status: "passed", details: { initialized: true } };

    case "doctor": {
      const checks = [
        { name: "bun", ok: typeof Bun !== "undefined" },
        { name: "git", ok: commandExists("git") },
        { name: "node", ok: commandExists("node") },
      ];
      const missing = checks.filter((check) => !check.ok).map((check) => check.name);
      return {
        status: missing.length === 0 ? "passed" : "failed",
        details: {
          checks,
          missing,
          message: missing.length === 0 ? "environment ok" : "missing tools",
        },
      };
    }

    case "stage_show": {
      const timeline = await loadTimeline(projectRoot);
      const current = await currentStageForProject(projectRoot);
      return {
        status: "passed",
        details: {
          current_stage: current,
          stages: timeline,
          fallback: timeline.length === 0 ? "boot" : "timeline",
        },
      };
    }

    case "toolchain_lint": {
      const lint = await runToolchainLint(projectRoot);
      return { status: lint.status, details: lint };
    }

    case "spec_lint": {
      const specPath = command.path
        ? path.resolve(projectRoot, command.path)
        : path.resolve(projectRoot, (await loadProjectConfig(projectRoot)).spec_root ?? "spec");
      const files = await discoverSpecFiles(specPath);
      const diagnostics: Array<{ file: string; error: string }> = [];
      for (const file of files) {
        const text = await readFile(file, "utf8");
        try {
          parseTopLevelYaml(text);
        } catch {
          diagnostics.push({ file: path.relative(projectRoot, file), error: "yaml parse error" });
        }
      }
      return {
        status: diagnostics.length === 0 ? "passed" : "validation_failed",
        details: {
          file_count: files.length,
          diagnostics,
          path: path.relative(projectRoot, specPath),
        },
      };
    }

    case "spec_normalize": {
      const specRoot = path.resolve(projectRoot, (await loadProjectConfig(projectRoot)).spec_root ?? "spec");
      const files = await discoverSpecFiles(specRoot);
      const cacheDir = path.join(projectRoot, ".vos", "cache", "normalized");
      const cachePath = path.join(cacheDir, "bundle.json");
      const manifest = {
        generated_at: new Date().toISOString(),
        files: files.map((file) => path.relative(projectRoot, file)),
      };
      await writeFile(cachePath, `${JSON.stringify(manifest, null, 2)}\n`);
      evidence.addArtifact("spec", path.relative(projectRoot, cachePath), "normalized bundle");
      return {
        status: "passed",
        details: {
          spec_count: files.length,
          normalized_cache: path.relative(projectRoot, cachePath),
        },
      };
    }

    case "spec_check_consistency": {
      const cachePath = path.join(projectRoot, ".vos", "cache", "normalized", "bundle.json");
      if (!existsSync(cachePath)) {
        return { status: "failed", details: { message: "run spec normalize first" } };
      }
      let cache: { files?: unknown[] };
      try {
        cache = JSON.parse(await readFile(cachePath, "utf8"));
      } catch (error) {
        return {
          status: "failed",
          details: {
            message: "normalized cache is not valid JSON",
            source: cachePath,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
      const sourceCount = Array.isArray(cache?.files) ? cache.files.length : 0;
      return {
        status: "passed",
        details: {
          checked: sourceCount,
          source: "normalized cache",
        },
      };
    }

    case "spec_patch_lint": {
      const patchPath = command.patchPath ?? null;
      const patchText = patchPath
        ? await readFile(path.resolve(projectRoot, patchPath), "utf8")
        : await readPatchFromStdin();
      const touched = extractPatchTouches(patchText);
      return {
        status: touched.length > 0 ? "passed" : "failed",
        details: { touched, touched_count: touched.length },
      };
    }

    case "spec_patch_apply": {
      const patchPath = command.patchPath ?? null;
      const patchText = patchPath
        ? await readFile(path.resolve(projectRoot, patchPath), "utf8")
        : command.inputFromStdin
          ? await readPatchFromStdin()
          : await readPatchFromStdin();
      const policy = await loadPolicyConfig(projectRoot);
      const result = await applyPatchText({
        projectRoot,
        patchText,
        allowedPaths: policy.allowed_paths ?? ["src", "spec", "tests", ".vos"],
        requireSpec: true,
        runValidation: false,
      });
      return {
        status: result.status,
        details: result,
      };
    }

    case "arch_lint": {
      const architecturePath = command.path
        ? path.resolve(projectRoot, command.path)
        : path.resolve(projectRoot, "spec", "architecture");
      const files = (await discoverSpecFiles(architecturePath)).map((file) => path.relative(projectRoot, file));
      return {
        status: files.length > 0 ? "passed" : "validation_failed",
        details: { files, count: files.length },
      };
    }

    case "arch_compose": {
      const composePath = path.join(projectRoot, ".vos", "cache", "composition.json");
      const timeline = await loadTimeline(projectRoot);
      await writeFile(
        composePath,
        `${JSON.stringify({ generated_at: new Date().toISOString(), timeline }, null, 2)}\n`,
      );
      evidence.addArtifact("arch", path.relative(projectRoot, composePath), "architecture composition");
      return {
        status: "passed",
        details: { output: path.relative(projectRoot, composePath), stage_count: timeline.length },
      };
    }

    case "arch_derive_tests": {
      const derivedPath = path.join(projectRoot, ".vos", "cache", "derived-tests.json");
      const timeline = await loadTimeline(projectRoot);
      const tests = timeline.map((item) => ({ stage: item.stage, gate: item.validation_gate ?? [] }));
      await writeFile(derivedPath, `${JSON.stringify({ tests }, null, 2)}\n`);
      evidence.addArtifact("arch", path.relative(projectRoot, derivedPath), "derived tests");
      return {
        status: "passed",
        details: { derived_count: tests.length, output: path.relative(projectRoot, derivedPath) },
      };
    }

    case "build":
      return executeBuild(command, evidence, projectRoot);

    case "run_qemu":
      return executeRunQemu(command, evidence, projectRoot);

    case "test":
      return executeTest(command, evidence, projectRoot);

    case "verify":
      return executeVerify(command, evidence, projectRoot);

    case "trace_syscall": {
      const result = await runQemuCommand({
        projectRoot,
        evidence,
        dryRun: command.dryRun,
        timeoutMs: command.timeoutMs,
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

    case "debug_explain_log": {
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

    case "report_generate": {
      const runs = await collectRunManifestSummaries(projectRoot);
      const reportPath = path.join(projectRoot, ".vos", "report", "report.json");
      await writeFile(reportPath, `${JSON.stringify({ generated_at: new Date().toISOString(), runs }, null, 2)}\n`);
      evidence.addArtifact("report", path.relative(projectRoot, reportPath), "report generate");
      return {
        status: "passed",
        details: {
          run_count: runs.length,
          report: path.relative(projectRoot, reportPath),
        },
      };
    }

    case "submit_pack": {
      const reportPath = path.join(projectRoot, ".vos", "submit", "pack.json");
      const runs = await collectRunManifestSummaries(projectRoot);
      const pack = {
        generated_at: new Date().toISOString(),
        command_root: projectRoot,
        evidence_runs: runs,
      };
      await writeFile(reportPath, `${JSON.stringify(pack, null, 2)}\n`);
      evidence.addArtifact("submit", path.relative(projectRoot, reportPath), "submission payload");
      return {
        status: "passed",
        details: { pack_path: path.relative(projectRoot, reportPath), run_count: runs.length },
      };
    }

    case "agent_serve":
      return executeAgentServe(command, projectRoot, evidence);

    case "agent_context": {
      const bundle = await buildContextBundle({
        projectRoot,
        requestedScope: command.scope,
      });
      const contextArtifact = path.join(projectRoot, ".vos", "agent-context.json");
      await writeFile(contextArtifact, `${JSON.stringify(bundle, null, 2)}\n`);
      evidence.addArtifact("agent", path.relative(projectRoot, contextArtifact), "context bundle");
      return {
        status: "passed",
        details: bundle as Record<string, unknown>,
      };
    }

    case "agent_plan": {
      const requestedScope = command.scope ?? "agent.plan";
      const bundle = await buildContextBundle({ projectRoot, requestedScope });
      const prompt = formatPrompt(buildPromptEnvelope({
        role: "specAssistant",
        taskKind: "design_review",
        requestedScope,
        specBindings: bundle.resolved_specs,
        contextBundleRef: "agent-context",
        evidenceRefs: bundle.recent_evidence.map((entry) => entry.run_id),
        allowedPaths: bundle.allowed_paths,
        requiredValidations: [],
        policyFlags: bundle.policy_flags,
        task: command.task,
      }));
      const agentResult = await runAgentWithPrompt({
        projectRoot,
        rolePrompt: prompt,
        courseMode: true,
        allowedVosCommands: await loadAgentAllowedCommands(projectRoot),
        runner: context.agentRunner,
      });
      const parsed = parsePlanDraft(
        parseAgentJson(agentResult.resultText, "agent_plan"),
      );
      const logPath = await recordAICollaboration({
        projectRoot,
        event: {
          session_id: contextSessionId(context),
          task_kind: "plan",
          agent_role: "specAssistant",
          related_specs: parsed.related_specs,
          allowed_paths: bundle.allowed_paths,
          output_kind: "plan",
          result: "accepted",
          created_at: new Date().toISOString(),
          fixed_prompt_id: FIXED_PROMPT_IDS.specAssistant,
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

    case "agent_generate":
      return executeAgentGenerate(command, context, evidence);

    case "agent_apply_patch":
      return executeAgentApplyPatch(command, projectRoot, evidence);

    case "agent_debug":
      return executeAgentDebug(command, context, evidence);

    case "agent_log":
      return executeAgentLog(command, projectRoot, evidence);

    default:
      throw new CliError(`unsupported command: ${JSON.stringify(command)}`, "failed");
  }
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

async function executeBuild(command: BuildCommand, evidence: EvidenceWriter, projectRoot: string): Promise<CommandOutcome> {
  const result = await runBuildCommand({
    projectRoot,
    evidence,
    toolchainPath: command.toolchainPath,
    dryRun: command.dryRun,
  });
  return {
    status: result.status,
    details: {
      output: result.output,
      artifacts: result.artifacts,
      failedStep: result.failedStep,
    },
  };
}

async function executeRunQemu(command: RunQemuCommand, evidence: EvidenceWriter, projectRoot: string): Promise<CommandOutcome> {
  const result = await runQemuCommand({
    projectRoot,
    evidence,
    dryRun: command.dryRun,
    timeoutMs: command.timeoutMs,
    readyPattern: command.readyPattern,
  });
  return {
    status: result.status,
    details: {
      readyDetected: result.readyDetected,
      durationMs: result.durationMs,
      serialPath: result.serialPath,
      output: result.output,
    },
  };
}

async function executeTest(command: TestCommand, evidence: EvidenceWriter, projectRoot: string): Promise<CommandOutcome> {
  const result = await runTestCommand({
    projectRoot,
    evidence,
    suites: command.suites,
    dryRun: command.dryRun,
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

async function executeVerify(command: VerifyCommand, evidence: EvidenceWriter, projectRoot: string): Promise<CommandOutcome> {
  const result = await runVerifyCommand({
    projectRoot,
    evidence,
    scope: command.scope,
    target: command.target,
    dryRun: command.dryRun,
  });
  return {
    status: result.status,
    details: {
      scope: result.scope,
      scopeTarget: command.target,
      steps: result.steps,
    },
  };
}

async function executeAgentServe(command: AgentServeCommand, projectRoot: string, evidence: EvidenceWriter): Promise<CommandOutcome> {
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

async function executeAgentGenerate(
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
  const bundle = await buildContextBundle({
    projectRoot,
    requestedScope: "agent.generate",
  });
  const task = command.task ?? command.target ?? bundle.current_stage;
  const prompt = formatPrompt(
    buildPromptEnvelope({
      role: "specCompiler",
      taskKind: "codegen",
      requestedScope: "agent.generate",
      specBindings: bundle.resolved_specs,
      contextBundleRef: "agent-context",
      evidenceRefs: bundle.recent_evidence.map((entry) => entry.run_id),
      allowedPaths: bundle.allowed_paths,
      requiredValidations: [],
      policyFlags: bundle.policy_flags,
      task,
    }),
  );
  const agentResult = await runAgentWithPrompt({
    projectRoot,
    rolePrompt: prompt,
    courseMode: true,
    allowedVosCommands: await loadAgentAllowedCommands(projectRoot),
    runner: context.agentRunner,
  });
  const parsed = parsePatchProposal(parseAgentJson(agentResult.resultText, "agent_generate"));
  let applyStatus: "skipped" | "ok" | "failed" = "skipped";
  let applyOutput: string | undefined;
  let applyValidationSummary: unknown[] = [];
  let runStatus: "skipped" | "ok" | "failed" = "skipped";
  let runOutput: string | undefined;
  let resultStatus: CommandStatus = "passed";
  if (command.apply) {
    const applyResult = await applyPatchText({
      projectRoot,
      patchText: parsed.patch,
      specBindings: parsed.bound_clauses,
      allowedPaths: await loadAgentAllowedPaths(projectRoot),
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
      }, null, 2)}\n`);
      evidence.addArtifactFromPath("agent", applySummaryPath, "agent-generated patch applied");
    } else if (command.apply) {
      const applySummaryPath = path.join(evidence.artifacts_root, "agent", "agent-generate-apply.json");
      await mkdir(path.dirname(applySummaryPath), { recursive: true });
      await writeFile(applySummaryPath, `${JSON.stringify({
        status: applyResult.status,
        changedPaths: applyResult.changedPaths,
        validationStatus: applyResult.validationStatus,
        validationSummary: applyResult.validationSummary ?? [],
      }, null, 2)}\n`);
      evidence.addArtifactFromPath("agent", applySummaryPath, "agent-generated patch apply result");
    }
    if (applyResult.status === "ok" && command.run) {
      const runResult = await runQemuCommand({
        projectRoot,
        evidence,
        dryRun: false,
      });
      runStatus = runResult.status;
      runOutput = runResult.output;
      if (runResult.status === "failed") {
        resultStatus = "failed";
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

async function executeAgentApplyPatch(
  command: AgentApplyPatchCommand,
  projectRoot: string,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const patchText = command.patchFile
    ? await readFile(path.resolve(projectRoot, command.patchFile), "utf8")
    : await readPatchFromStdin();
  const result = await applyPatchText({
    projectRoot,
    patchText,
    allowedPaths: await loadAgentAllowedPaths(projectRoot),
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
    details: result,
  };
}

async function executeAgentDebug(
  command: AgentDebugCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const logPath = command.logPath ?? (await findLatestLogPath(projectRoot));
  if (!logPath) {
    return { status: "failed", details: { message: "log path required" } };
  }
  const text = await readFile(logPath, "utf8");
  const prompt = formatPrompt(
    buildPromptEnvelope({
      role: "debugAgent",
      taskKind: "debug",
      requestedScope: "agent.debug",
      specBindings: [],
      contextBundleRef: "agent-context",
      evidenceRefs: [path.basename(logPath)],
      allowedPaths: ["logs", "tests", "spec", "src"],
      requiredValidations: [],
      policyFlags: ["no_exec"],
      task: text,
    }),
  );
  const response = await runAgentWithPrompt({
    projectRoot,
    rolePrompt: prompt,
    courseMode: true,
    allowedVosCommands: await loadAgentAllowedCommands(projectRoot),
    runner: context.agentRunner,
  });
  const debugOutput = parseDebugOutput(parseAgentJson(response.resultText, "agent_debug"));
  const artifact = path.join(projectRoot, ".vos", "agent-debug.json");
  await writeFile(artifact, `${JSON.stringify(debugOutput, null, 2)}\n`);
  evidence.addArtifact("agent", path.relative(projectRoot, artifact), "agent debug output");
  return {
    status: "passed",
    details: { debug: debugOutput, artifact: path.relative(projectRoot, artifact) },
  };
}

async function executeAgentLog(
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

async function loadAgentAllowedCommands(projectRoot: string): Promise<string[]> {
  const policy = await loadPolicyConfig(projectRoot);
  return (policy.allowed_commands ?? []).filter(isAllowedModelVosCommand);
}

function isAllowedModelVosCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  return normalized !== "agent" && !normalized.startsWith("agent ");
}

function commandToArray(command: CliCommand): string[] {
  switch (command.kind) {
    case "build": {
      const commandParts = ["build"];
      if (command.dryRun) commandParts.push("--dry-run");
      if (command.toolchainPath) {
        commandParts.push("--toolchain", command.toolchainPath);
      }
      return commandParts;
    }
    case "run_qemu":
      return [
        "run",
        "qemu",
        ...(command.dryRun ? ["--dry-run"] : []),
        ...(command.timeoutMs ? ["--timeout", String(command.timeoutMs)] : []),
        ...(command.readyPattern ? ["--ready-pattern", command.readyPattern] : []),
      ];
    case "spec_lint":
      return command.path ? ["spec", "lint", command.path] : ["spec", "lint"];
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
      return command.path ? ["arch", "lint", command.path] : ["arch", "lint"];
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
        ...(command.target ? ["--target", command.target] : []),
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
    case "agent_serve":
      return [
        "agent",
        "serve",
        ...(command.host ? ["--host", command.host] : []),
        ...(command.port ? ["--port", String(command.port)] : []),
      ];
    case "agent_context":
      return command.scope ? ["agent", "context", "--scope", command.scope] : ["agent", "context"];
    case "agent_plan":
      return command.task ? ["agent", "plan", "--task", command.task] : ["agent", "plan"];
    case "agent_generate":
      return [
        "agent",
        "generate",
        ...(command.target ? [command.target] : command.task ? ["--task", command.task] : []),
        ...(command.apply ? ["--apply"] : []),
        ...(command.build ? ["--build"] : []),
        ...(command.run ? ["--run"] : []),
      ];
    case "agent_apply_patch":
      return [
        "agent",
        "apply-patch",
        ...(command.patchFile ? ["--patch-file", command.patchFile] : []),
        ...(command.requireSpec ? [] : ["--no-require-spec"]),
        ...(command.runValidation ? ["--run-validation"] : []),
      ];
    case "agent_debug":
      return command.logPath ? ["agent", "debug", "--log", command.logPath] : ["agent", "debug"];
    case "agent_log":
      return [
        "agent",
        "log",
        ...(command.append ? ["--append"] : []),
        ...(command.inputPath ? [command.inputPath] : []),
      ];
    case "report_generate":
      return ["report", "generate"];
    case "submit_pack":
      return ["submit", "pack"];
    case "init":
      return ["init"];
    case "doctor":
      return ["doctor"];
    case "stage_show":
      return ["stage", "show"];
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
  await walk(normalizedRoot);
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

async function recordAICollaboration(params: {
  projectRoot: string;
  event: {
    session_id: string;
    task_kind: string;
    agent_role: string;
    related_specs: string[];
    allowed_paths: string[];
    output_kind: string;
    result: "accepted" | "rejected" | "pending" | "failed";
    created_at: string;
    fixed_prompt_id?: string;
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

function contextSessionId(context: ExecContext): string {
  const sessionPrefix = context.global.agentSession ?? "session";
  return `${sessionPrefix}-${path.basename(context.projectRoot)}-${context.evidence.run_id}`;
}

function printResult(result: Record<string, unknown>, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(renderOutput(result as BaseCommandResult));
}

function printHelp(topic?: string): void {
  const globalHelp = [
    "vos CLI",
    `version: ${COMMAND_VERSION}`,
    "",
    "Global:",
    "  --project-root <dir>",
    "  --json",
    "  --agent-session <id>",
    "  --report <path>",
    "  --evidence-dir <path>",
    "",
    "Commands:",
    "  init",
    "  doctor",
    "  stage show",
    "  toolchain lint",
    "  spec lint [path]",
    "  spec normalize",
    "  spec check-consistency",
    "  spec patch lint [patch-file]",
    "  spec patch apply [patch-file]",
    "  arch lint [path]",
    "  arch compose [path]",
    "  arch derive-tests [path]",
    "  build [--dry-run] [--toolchain <path>]",
    "  run qemu [--dry-run] [--timeout=<ms>]",
    "  test [--dry-run] [--suite=<name>]...",
    "  verify public|patch|full|invariant|fuzz|base|architecture|composition|goal [--target <value>]",
    "  trace syscall [--dry-run] [--timeout=<ms>]",
    "  debug explain-log [log-path]",
    "  report generate",
    "  submit pack",
    "  agent serve [--host --port]",
    "  agent context [--scope <scope>]",
    "  agent plan [--scope <scope>|--stage <stage>] [--task <task>]",
    "  agent generate [target] [--target <target>] [--apply] [--build] [--run]",
    "  agent apply-patch [--patch-file <file>] [--run-validation] [--no-require-spec]",
    "  agent debug [--log <path>]",
    "  agent log [--append] [entry-path]",
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

if (import.meta.main) {
  main();
}
