import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CommandStatus } from "../types.ts";
import type { EvidenceWriter } from "../evidence/index.ts";
import { AgentOutputError, CliError } from "../errors.ts";
import { runCommand } from "./executor.ts";
import { runBuildCommand } from "./build.ts";
import { resolveToolchainManifestPath } from "./toolchain-manifest.ts";
import { isRecord, parseTopLevelYaml, stringArray } from "../utils/yaml.ts";

const TRACE_PREFIX = "VOS_TRACE ";
const DEFAULT_ALLOWED_INSTRUMENTATION_PATHS = [
  "kernel/",
  "user/",
  "mkfs/",
  "Makefile",
  ".vos/toolchain.json",
];
const DEFAULT_REJECTED_INSTRUMENTATION_PATHS = [
  "spec/",
  ".git/",
  ".vos/runs/",
  ".vos/worktrees/",
];

export interface TraceValidationInput {
  target: string;
  publicRequirements: PublicRequirement[];
  moduleTests: ModuleTestSurface[];
  coverageHints: TraceCoverageHint[];
  recentEvidence: Array<{ run_id: string; status?: string }>;
  projectTree: string[];
  toolchain: {
    buildCommands: string[];
    runCommand?: string;
    runArgs: string[];
    runArtifact?: string;
    successSignal?: string;
  };
}

export interface PublicRequirement {
  id: string;
  description?: string;
  related_specs: string[];
  required_tests: string[];
  required_artifacts: string[];
}

export interface ModuleTestSurface {
  module: string;
  tests: Array<{ id: string; description?: string }>;
  source: string;
}

export interface TraceCoverageHint {
  module: string;
  requirement_ids: string[];
  required_tests: string[];
  related_specs: string[];
  source?: string;
}

export interface TraceValidationPlan {
  instrumentation_patch: string;
  trace_format: {
    prefix: string;
  };
  cases: TraceValidationCase[];
}

export interface TraceValidationCase {
  id: string;
  requirement_id?: string;
  related_specs: string[];
  stdin?: string;
  success_regex?: string;
  failure_regex?: string;
  expected_trace_events: string[];
}

export interface TraceValidationCaseResult {
  id: string;
  requirement_id?: string;
  status: "ok" | "failed";
  duration_ms: number;
  serial_log: string;
  trace_log: string;
  result_json: string;
  trace_count: number;
  success_matched: boolean;
  failure_matched: boolean;
}

export interface TraceValidationResult {
  status: CommandStatus;
  worktreePath: string;
  worktreeKept: boolean;
  planPath: string;
  summaryPath: string;
  cases: TraceValidationCaseResult[];
}

interface RawTraceValidationPlan {
  instrumentation_patch?: unknown;
  trace_format?: unknown;
  cases?: unknown;
}

interface RunManifest {
  run?: {
    command?: string;
    args?: string[];
    timeout_ms?: number;
    timeout_secs?: number;
    successSignal?: string;
    artifact?: string;
    artifacts?: string[];
  };
}

interface RunSpec {
  command: string;
  args: string[];
  artifact: string;
  timeoutMs: number;
  readyPattern?: string;
}

export async function runAgentTraceValidation(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  target: string;
  patchFile?: string;
  keepWorktree: boolean;
  agentPlanText: string;
  recentEvidence: Array<{ run_id: string; status?: string }>;
}): Promise<TraceValidationResult> {
  await ensureCleanGitWorktree(params.projectRoot);

  const input = await buildTraceValidationInput({
    projectRoot: params.projectRoot,
    target: params.target,
    recentEvidence: params.recentEvidence,
  });
  const plan = parseTraceValidationPlan(params.agentPlanText);
  const patchPolicy = validateInstrumentationPatch(plan.instrumentation_patch);
  if (!patchPolicy.ok) {
    throw new CliError(patchPolicy.reason, "policy_blocked");
  }

  const planPath = path.join(params.evidence.artifacts_root, "trace-validation", "agent-plan.json");
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify({ input, plan }, null, 2)}\n`);
  params.evidence.addArtifactFromPath("trace-validation", planPath, "agent trace validation plan");

  const worktreePath = path.join(params.projectRoot, ".vos", "worktrees", params.evidence.run_id);
  await mkdir(path.dirname(worktreePath), { recursive: true });
  let worktreeCreated = false;
  let worktreeKept = params.keepWorktree;
  try {
    await createDetachedWorktree(params.projectRoot, worktreePath);
    worktreeCreated = true;

    if (params.patchFile) {
      const patchText = await readFile(path.resolve(params.projectRoot, params.patchFile), "utf8");
      await applyPatchInWorktree(worktreePath, patchText);
    }
    if (plan.instrumentation_patch.trim()) {
      await applyPatchInWorktree(worktreePath, plan.instrumentation_patch);
    }

    const buildResult = await runBuildCommand({
      projectRoot: worktreePath,
      evidence: params.evidence,
      dryRun: false,
    });
    if (buildResult.status === "failed") {
      throw new CliError("trace validation build failed", "validation_failed");
    }

    const cases: TraceValidationCaseResult[] = [];
    for (const validationCase of plan.cases) {
      const result = await runTraceValidationCase({
        projectRoot: worktreePath,
        evidence: params.evidence,
        validationCase,
      });
      cases.push(result);
      params.evidence.addEvidenceRef(
        `${params.evidence.run_id}:${result.id}`,
        "trace-validation-case",
        result.result_json,
      );
    }

    const status: CommandStatus = cases.every((item) => item.status === "ok") ? "passed" : "validation_failed";
    const summaryPath = path.join(params.evidence.artifacts_root, "trace-validation", "trace-validation-summary.json");
    const summary = {
      target: params.target,
      status,
      worktree: path.relative(params.projectRoot, worktreePath),
      worktree_kept: params.keepWorktree,
      public_requirement_count: input.publicRequirements.length,
      module_test_surface_count: input.moduleTests.reduce((sum, item) => sum + item.tests.length, 0),
      cases,
    };
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    params.evidence.addArtifactFromPath("trace-validation-summary", summaryPath, "trace validation summary");
    return {
      status,
      worktreePath,
      worktreeKept,
      planPath,
      summaryPath,
      cases,
    };
  } finally {
    if (worktreeCreated && !params.keepWorktree) {
      await removeWorktree(params.projectRoot, worktreePath);
      worktreeKept = false;
    }
  }
}

export async function buildTraceValidationInput(params: {
  projectRoot: string;
  target: string;
  recentEvidence: Array<{ run_id: string; status?: string }>;
}): Promise<TraceValidationInput> {
  const allPublicRequirements = await collectPublicRequirements(params.projectRoot);
  const allModuleTests = await collectModuleTestSurfaces(params.projectRoot);
  const publicRequirements = filterPublicRequirementsForTarget(params.target, allPublicRequirements);
  const moduleTests = filterModuleTestsForTarget(params.target, allModuleTests, publicRequirements);
  return {
    target: params.target,
    publicRequirements,
    moduleTests,
    coverageHints: buildTraceCoverageHints(publicRequirements, moduleTests),
    recentEvidence: params.recentEvidence,
    projectTree: await collectTraceProjectTree(params.projectRoot),
    toolchain: await collectToolchainSummary(params.projectRoot),
  };
}

export function filterPublicRequirementsForTarget(
  target: string,
  publicRequirements: PublicRequirement[],
): PublicRequirement[] {
  const normalizedTarget = normalizeTargetName(target);
  const matches = publicRequirements.filter((requirement) => {
    if (normalizeTargetName(requirement.id) === normalizedTarget) return true;
    return requirement.related_specs.some((spec) => moduleMatchesTarget(specModuleName(spec), normalizedTarget));
  });
  return matches.length > 0 ? matches : publicRequirements;
}

export function filterModuleTestsForTarget(
  target: string,
  moduleTests: ModuleTestSurface[],
  publicRequirements: PublicRequirement[],
): ModuleTestSurface[] {
  const normalizedTarget = normalizeTargetName(target);
  const requirementModules = new Set(publicRequirements.flatMap((requirement) =>
    requirement.related_specs.map((spec) => specModuleName(spec))
  ));
  const matches = moduleTests.filter((surface) =>
    moduleMatchesTarget(surface.module, normalizedTarget) || requirementModules.has(surface.module)
  );
  return matches.length > 0 ? matches : moduleTests;
}

export function buildTraceCoverageHints(
  publicRequirements: PublicRequirement[],
  moduleTests: ModuleTestSurface[],
): TraceCoverageHint[] {
  const hints = new Map<string, TraceCoverageHint>();
  for (const surface of moduleTests) {
    hints.set(surface.module, {
      module: surface.module,
      requirement_ids: [],
      required_tests: surface.tests.map((item) => item.id),
      related_specs: [],
      source: surface.source,
    });
  }

  for (const requirement of publicRequirements) {
    const modules = requirement.related_specs.map((spec) => spec.split(".")[0]).filter(Boolean);
    for (const moduleName of modules) {
      const existing = hints.get(moduleName) ?? {
        module: moduleName,
        requirement_ids: [],
        required_tests: [],
        related_specs: [],
      };
      existing.requirement_ids.push(requirement.id);
      existing.required_tests.push(...requirement.required_tests);
      existing.related_specs.push(...requirement.related_specs.filter((spec) => spec === moduleName || spec.startsWith(`${moduleName}.`)));
      hints.set(moduleName, existing);
    }
  }

  return [...hints.values()]
    .map((hint) => ({
      ...hint,
      requirement_ids: uniqueStrings(hint.requirement_ids),
      required_tests: uniqueStrings(hint.required_tests),
      related_specs: uniqueStrings(hint.related_specs),
    }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

export async function collectPublicRequirements(projectRoot: string): Promise<PublicRequirement[]> {
  const matrixPath = path.join(projectRoot, "spec", "verification", "public-matrix.yaml");
  if (!existsSync(matrixPath)) return [];
  const parsed = parseTopLevelYaml(await readFile(matrixPath, "utf8"));
  const requirements = Array.isArray(parsed.public_requirements) ? parsed.public_requirements : [];
  const out: PublicRequirement[] = [];
  for (const value of requirements) {
    if (!isRecord(value)) continue;
    const id = optionalString(value.id);
    if (!id) continue;
    const relatedSpecs: string[] = [];
    if (Array.isArray(value.related_specs)) {
      for (const item of value.related_specs) {
        if (!isRecord(item)) continue;
        const moduleName = optionalString(item.module);
        const operation = optionalString(item.operation);
        if (moduleName && operation) relatedSpecs.push(`${moduleName}.${operation}`);
        else if (moduleName) relatedSpecs.push(moduleName);
      }
    }
    out.push({
      id,
      description: optionalString(value.description),
      related_specs: relatedSpecs,
      required_tests: stringArray(value.required_tests) ?? [],
      required_artifacts: stringArray(value.required_artifacts) ?? [],
    });
  }
  return out;
}

export async function collectModuleTestSurfaces(projectRoot: string): Promise<ModuleTestSurface[]> {
  const modulesRoot = path.join(projectRoot, "spec", "modules");
  if (!existsSync(modulesRoot)) return [];
  const testFiles = await listFilesNamed(modulesRoot, "tests.yaml");
  const out: ModuleTestSurface[] = [];
  for (const file of testFiles.sort()) {
    const parsed = parseTopLevelYaml(await readFile(file, "utf8"));
    const moduleName = optionalString(parsed.module);
    if (!moduleName) continue;
    const tests: Array<{ id: string; description?: string }> = [];
    const requiredTests = Array.isArray(parsed.required_tests) ? parsed.required_tests : [];
    for (const item of requiredTests) {
      if (!isRecord(item)) continue;
      const id = optionalString(item.test);
      if (!id) continue;
      tests.push({ id, description: optionalString(item.description) });
    }
    for (const id of stringArray(parsed.test_surfaces) ?? []) {
      if (!tests.some((item) => item.id === id)) {
        tests.push({ id });
      }
    }
    out.push({
      module: moduleName,
      tests,
      source: path.relative(projectRoot, file),
    });
  }
  return out;
}

export function parseTraceValidationPlan(text: string): TraceValidationPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1) {
      throw new AgentOutputError("trace validation agent output is not JSON");
    }
    try {
      parsed = JSON.parse(text.slice(first, last + 1));
    } catch {
      throw new AgentOutputError("trace validation agent output is not JSON");
    }
  }

  if (!isRecord(parsed)) {
    throw new AgentOutputError("trace validation agent output must be an object");
  }
  const raw = parsed as RawTraceValidationPlan;
  if (typeof raw.instrumentation_patch !== "string") {
    throw new AgentOutputError("trace validation plan requires instrumentation_patch");
  }
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    throw new AgentOutputError("trace validation plan requires at least one case");
  }

  const traceFormat = isRecord(raw.trace_format) && typeof raw.trace_format.prefix === "string"
    ? { prefix: raw.trace_format.prefix }
    : { prefix: TRACE_PREFIX };
  if (traceFormat.prefix !== TRACE_PREFIX) {
    throw new AgentOutputError(`trace validation trace_format.prefix must be ${TRACE_PREFIX.trim()}`);
  }

  const cases: TraceValidationCase[] = raw.cases.map((item, index) => {
    if (!isRecord(item)) {
      throw new AgentOutputError(`trace validation case ${index + 1} must be an object`);
    }
    const id = optionalString(item.id);
    if (!id) {
      throw new AgentOutputError(`trace validation case ${index + 1} requires id`);
    }
    const successRegex = optionalString(item.success_regex);
    if (successRegex && /VOS_TRACE/i.test(successRegex)) {
      throw new AgentOutputError(`trace validation case ${id} success_regex must validate non-trace serial output`);
    }
    return {
      id,
      requirement_id: optionalString(item.requirement_id),
      related_specs: stringArray(item.related_specs) ?? [],
      stdin: normalizeStimulus(item.stdin ?? item.stimulus),
      success_regex: successRegex,
      failure_regex: optionalString(item.failure_regex),
      expected_trace_events: stringArray(item.expected_trace_events) ?? [],
    };
  });

  return {
    instrumentation_patch: raw.instrumentation_patch,
    trace_format: traceFormat,
    cases,
  };
}

export function validateInstrumentationPatch(patchText: string): { ok: true } | { ok: false; reason: string } {
  const changedPaths = extractChangedPaths(patchText);
  if (patchText.trim() && changedPaths.length === 0) {
    return { ok: false, reason: "instrumentation patch must use git-style diff --git file sections" };
  }
  for (const changedPath of changedPaths) {
    const normalized = normalizeRepoPath(changedPath);
    if (normalized.startsWith("..") || path.isAbsolute(changedPath)) {
      return { ok: false, reason: `instrumentation patch escapes worktree: ${changedPath}` };
    }
    if (DEFAULT_REJECTED_INSTRUMENTATION_PATHS.some((prefix) => normalized.startsWith(prefix))) {
      return { ok: false, reason: `instrumentation patch touches rejected path: ${changedPath}` };
    }
    const allowed = DEFAULT_ALLOWED_INSTRUMENTATION_PATHS.some((entry) => {
      return entry.endsWith("/")
        ? normalized.startsWith(entry)
        : normalized === entry;
    });
    if (!allowed) {
      return { ok: false, reason: `instrumentation patch touches disallowed path: ${changedPath}` };
    }
  }
  return { ok: true };
}

export function parseVosTraceLines(serialOutput: string): Array<Record<string, unknown>> {
  const traces: Array<Record<string, unknown>> = [];
  for (const line of serialOutput.split(/\r?\n/)) {
    const index = line.indexOf(TRACE_PREFIX);
    if (index < 0) continue;
    const raw = line.slice(index + TRACE_PREFIX.length).trim();
    try {
      const parsed = JSON.parse(raw);
      traces.push(isRecord(parsed) ? parsed : { value: parsed });
    } catch (error) {
      traces.push({
        raw,
        parse_error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return traces;
}

async function runTraceValidationCase(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  validationCase: TraceValidationCase;
}): Promise<TraceValidationCaseResult> {
  const safeId = safeCaseId(params.validationCase.id);
  const runSpec = await resolveRunSpec(params.projectRoot);
  const commandLine = [runSpec.command, ...runSpec.args];
  const successRegex = params.validationCase.success_regex
    ? new RegExp(params.validationCase.success_regex)
    : undefined;
  const failureRegex = params.validationCase.failure_regex
    ? new RegExp(params.validationCase.failure_regex)
    : undefined;
  const stdinReadyPattern = runSpec.readyPattern
    ? `${runSpec.readyPattern}|\\$\\s`
    : undefined;
  const nodeId = `trace-validation:${safeId}`;
  await params.evidence.markNodeStarted(nodeId);
  const commandResult = await runCommand({
    command: commandLine,
    cwd: params.projectRoot,
    timeoutMs: runSpec.timeoutMs,
    timeoutGraceMs: 500,
    stdin: stdinReadyPattern && params.validationCase.stdin?.trim()
      ? undefined
      : params.validationCase.stdin,
    stdinAfter: stdinReadyPattern && params.validationCase.stdin?.trim()
      ? { pattern: stdinReadyPattern, text: params.validationCase.stdin }
      : undefined,
    stopWhen: ({ stdout, stderr }) => {
      const output = `${stdout}${stderr}`;
      if (failureRegex?.test(output)) return true;
      return successRegex?.test(output) ?? false;
    },
  });
  const output = `${commandResult.stdout}${commandResult.stderr}`;
  const traces = parseVosTraceLines(output);
  const successMatched = successRegex ? successRegex.test(output) : commandResult.exitCode === 0;
  const failureMatched = failureRegex ? failureRegex.test(output) : false;
  const traceEventsSatisfied = params.validationCase.expected_trace_events.length === 0
    ? true
    : params.validationCase.expected_trace_events.every((eventName) =>
      traces.some((trace) => trace.event === eventName || trace.name === eventName || trace.type === eventName)
    );
  const status: "ok" | "failed" = successMatched && !failureMatched && traceEventsSatisfied ? "ok" : "failed";

  const caseRoot = path.join(params.evidence.artifacts_root, "trace-validation", safeId);
  await mkdir(caseRoot, { recursive: true });
  const serialPath = path.join(caseRoot, "serial.log");
  const tracePath = path.join(caseRoot, "trace.jsonl");
  const resultPath = path.join(caseRoot, "result.json");
  await writeFile(serialPath, `${output}\n`);
  await writeFile(tracePath, traces.map((trace) => JSON.stringify(trace)).join("\n") + (traces.length > 0 ? "\n" : ""));

  const result = {
    id: params.validationCase.id,
    requirement_id: params.validationCase.requirement_id,
    status,
    command: commandLine,
    exit_code: commandResult.exitCode,
    signal: commandResult.signal,
    timed_out: commandResult.timedOut,
    duration_ms: commandResult.durationMs,
    success_matched: successMatched,
    failure_matched: failureMatched,
    trace_events_satisfied: traceEventsSatisfied,
    trace_count: traces.length,
    serial_log: path.relative(params.evidence.run_root, serialPath),
    trace_log: path.relative(params.evidence.run_root, tracePath),
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  params.evidence.addArtifactFromPath("trace-validation-log", serialPath, params.validationCase.id);
  params.evidence.addArtifactFromPath("trace", tracePath, params.validationCase.id);
  params.evidence.addArtifactFromPath("trace-validation-result", resultPath, params.validationCase.id);
  await params.evidence.markNodeFinished(nodeId, status);

  return {
    id: params.validationCase.id,
    requirement_id: params.validationCase.requirement_id,
    status,
    duration_ms: commandResult.durationMs,
    serial_log: path.relative(params.evidence.run_root, serialPath),
    trace_log: path.relative(params.evidence.run_root, tracePath),
    result_json: path.relative(params.evidence.run_root, resultPath),
    trace_count: traces.length,
    success_matched: successMatched,
    failure_matched: failureMatched,
  };
}

export async function ensureCleanGitWorktree(projectRoot: string): Promise<void> {
  const result = await runCommand({
    command: ["git", "status", "--porcelain", "--untracked-files=all"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new CliError(result.stderr || result.stdout || "git status failed", "failed");
  }
  const dirty = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(2).trim().replace(/^"|"$/g, "");
      return !file.startsWith(".vos/runs/") && !file.startsWith(".vos/worktrees/");
    });
  if (dirty.length > 0) {
    throw new CliError(`trace validation requires a clean git worktree: ${dirty.join(", ")}`, "policy_blocked");
  }
}

async function createDetachedWorktree(projectRoot: string, worktreePath: string): Promise<void> {
  const result = await runCommand({
    command: ["git", "worktree", "add", "--detach", worktreePath, "HEAD"],
    cwd: projectRoot,
    timeoutMs: 120_000,
  });
  if (result.exitCode !== 0) {
    throw new CliError(result.stderr || result.stdout || "git worktree add failed", "failed");
  }
}

async function removeWorktree(projectRoot: string, worktreePath: string): Promise<void> {
  const result = await runCommand({
    command: ["git", "worktree", "remove", "--force", worktreePath],
    cwd: projectRoot,
    timeoutMs: 120_000,
  });
  if (result.exitCode !== 0 && existsSync(worktreePath)) {
    await rm(worktreePath, { recursive: true, force: true });
  }
}

async function applyPatchInWorktree(worktreePath: string, patchText: string): Promise<void> {
  if (!patchText.trim()) return;
  const patchPath = path.join(worktreePath, ".vos", `trace-validation-${shortHash(patchText)}.patch`);
  await mkdir(path.dirname(patchPath), { recursive: true });
  await writeFile(patchPath, normalizePatchForGitApply(patchText));
  const check = await runCommand({
    command: ["git", "apply", "--check", patchPath],
    cwd: worktreePath,
    timeoutMs: 120_000,
  });
  if (check.exitCode !== 0) {
    throw new CliError(check.stderr || check.stdout || "git apply --check failed", "validation_failed");
  }
  const apply = await runCommand({
    command: ["git", "apply", patchPath],
    cwd: worktreePath,
    timeoutMs: 120_000,
  });
  if (apply.exitCode !== 0) {
    throw new CliError(apply.stderr || apply.stdout || "git apply failed", "validation_failed");
  }
}

async function resolveRunSpec(projectRoot: string): Promise<RunSpec> {
  const toolchainFile = await resolveToolchainManifestPath({ projectRoot });
  const manifest: RunManifest = JSON.parse(await readFile(toolchainFile, "utf8"));
  const run = manifest.run;
  if (!run?.command) {
    throw new Error("trace validation requires run.command in .vos/toolchain.json");
  }
  const artifact = run.artifact ?? run.artifacts?.[0] ?? "build/kernel.bin";
  const args = [...(run.args ?? [])];
  const kernelArgIndex = args.indexOf("-kernel");
  if (kernelArgIndex >= 0 && args[kernelArgIndex + 1] !== artifact) {
    args.splice(kernelArgIndex + 1, 0, artifact);
  } else if (kernelArgIndex < 0) {
    args.push("-kernel", artifact);
  }
  if (!existsSync(path.resolve(projectRoot, artifact))) {
    throw new Error(`trace validation requires kernel artifact: ${artifact}`);
  }
  return {
    command: run.command,
    args,
    artifact,
    timeoutMs: run.timeout_ms ?? (run.timeout_secs ? run.timeout_secs * 1000 : 30_000),
    readyPattern: run.successSignal,
  };
}

async function collectTraceProjectTree(projectRoot: string): Promise<string[]> {
  const roots = ["Makefile", "kernel", "user", "mkfs", "spec/modules", "spec/verification", ".vos/toolchain.json"];
  const suffixes = [".c", ".h", ".S", ".s", ".ld", ".yaml", ".yml", ".json"];
  const out: string[] = [];
  for (const entry of roots) {
    const absolute = path.join(projectRoot, entry);
    if (!existsSync(absolute)) continue;
    const stat = await import("node:fs/promises").then((fs) => fs.stat(absolute));
    if (stat.isDirectory()) {
      out.push(...(await listFilesWithSuffixes(absolute, suffixes)).map((file) => normalizeRepoPath(path.relative(projectRoot, file))));
    } else {
      out.push(normalizeRepoPath(path.relative(projectRoot, absolute)));
    }
  }
  return uniqueStrings(out).slice(0, 240);
}

async function collectToolchainSummary(projectRoot: string): Promise<TraceValidationInput["toolchain"]> {
  try {
    const toolchainFile = await resolveToolchainManifestPath({ projectRoot });
    const manifest = JSON.parse(await readFile(toolchainFile, "utf8")) as {
      build?: { commands?: unknown };
      run?: RunManifest["run"];
    };
    return {
      buildCommands: normalizeBuildCommands(manifest.build?.commands),
      runCommand: manifest.run?.command,
      runArgs: manifest.run?.args ?? [],
      runArtifact: manifest.run?.artifact ?? manifest.run?.artifacts?.[0],
      successSignal: manifest.run?.successSignal,
    };
  } catch {
    return {
      buildCommands: [],
      runArgs: [],
    };
  }
}

function normalizeBuildCommands(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (isRecord(entry)) {
      const command = entry.command;
      if (typeof command === "string") return [command];
      if (Array.isArray(command) && command.every((item) => typeof item === "string")) {
        return [command.join(" ")];
      }
    }
    return [];
  });
}

async function listFilesNamed(root: string, fileName: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(dir, { withFileTypes: true }));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name === fileName) {
        out.push(full);
      }
    }
  };
  await walk(root);
  return out;
}

async function listFilesWithSuffixes(root: string, suffixes: string[]): Promise<string[]> {
  const out: string[] = [];
  const normalizedSuffixes = suffixes.map((suffix) => suffix.toLowerCase());
  const walk = async (dir: string): Promise<void> => {
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(dir, { withFileTypes: true }));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && normalizedSuffixes.some((suffix) => entry.name.toLowerCase().endsWith(suffix))) {
        out.push(full);
      }
    }
  };
  await walk(root);
  return out;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function moduleMatchesTarget(moduleName: string, normalizedTarget: string): boolean {
  const normalizedModule = normalizeTargetName(moduleName);
  return normalizedModule === normalizedTarget
    || normalizedModule.endsWith(`/${normalizedTarget}`)
    || normalizedTarget.endsWith(`/${normalizedModule}`);
}

function specModuleName(spec: string): string {
  return spec.split(".")[0] ?? spec;
}

function normalizeTargetName(value: string): string {
  return normalizeRepoPath(value).replace(/^spec\/modules\//, "").replace(/\/module\.ya?ml$/, "");
}

function extractChangedPaths(patchText: string): string[] {
  const out = new Set<string>();
  for (const line of patchText.split(/\r?\n/)) {
    if (!line.startsWith("diff --git ")) continue;
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) continue;
    out.add(match[1]);
    out.add(match[2]);
  }
  return [...out].filter((value) => value !== "/dev/null");
}

function normalizePatchForGitApply(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function normalizeRepoPath(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, "/").replace(/^\.?\//, ""));
}

function normalizeStimulus(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join("\n") + "\n";
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function safeCaseId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
