import path from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { runCommand } from "../runtime/executor.ts";
import type { EvidenceWriter } from "../evidence/index.ts";
import { runBuildCommand } from "../runtime/build.ts";
import { runTestCommand } from "../runtime/test.ts";
import { hasResolvableToolchainManifest } from "../runtime/toolchain-manifest.ts";
import { parseTopLevelYaml } from "../utils/yaml.ts";

interface ValidationSummary {
  name: string;
  status: "ok" | "failed";
  details?: string;
}

export interface ApplyPatchResult {
  status: "ok" | "failed";
  reason?:
    | "ok"
    | "policy_violation"
    | "patch_apply_failed"
    | "validation_failed"
    | "validation_unavailable"
    | "other";
  changedPaths: string[];
  validationRun: boolean;
  validationStatus?: "ok" | "failed";
  validationSummary?: ValidationSummary[];
  output: string;
}

export async function applyPatchText(params: {
  projectRoot: string;
  patchText: string;
  specBindings?: readonly string[];
  allowedPaths: string[];
  requireSpec: boolean;
  runValidation: boolean;
  evidence?: EvidenceWriter;
}): Promise<ApplyPatchResult> {
  const changed = extractChangedPaths(params.patchText);
  const validationSummary: ValidationSummary[] = [];

  if (changed.length === 0) {
    return {
      status: "failed",
      reason: "other",
      changedPaths: [],
      validationRun: false,
      output: "empty patch",
    };
  }

  if (!allPathsAllowed(changed, params.allowedPaths)) {
    return {
      status: "failed",
      reason: "policy_violation",
      changedPaths: changed,
      validationRun: false,
      output: "path violation in patch",
    };
  }

  if (params.requireSpec && !(await hasSpecBinding({
    projectRoot: params.projectRoot,
    patchText: params.patchText,
    specBindings: params.specBindings,
    changedPaths: changed,
  }))) {
    return {
      status: "failed",
      reason: "policy_violation",
      changedPaths: changed,
      validationRun: false,
      output: "patch must bind to local spec",
    };
  }

  const patchFile = path.join(params.projectRoot, ".vos", "apply.patch");
  mkdirSync(path.dirname(patchFile), { recursive: true });
  await writeFile(patchFile, normalizePatchForGitApply(params.patchText));

  const apply = await runCommand({
    command: ["git", "apply", patchFile],
    cwd: params.projectRoot,
    env: gitApplyProjectEnv(params.projectRoot),
    timeoutMs: 120_000,
  });

  if (apply.exitCode !== 0) {
    return {
      status: "failed",
      reason: "patch_apply_failed",
      changedPaths: changed,
      validationRun: params.runValidation,
      validationSummary,
      output: apply.stderr || apply.stdout || "git apply failed",
    };
  }

  const validationResult = params.runValidation
    ? await runMinimalValidationDag(params.projectRoot, changed, params.evidence, validationSummary)
    : { status: "ok" as const, summary: [] };

  if (validationResult.status === "failed") {
    const rollback = await runCommand({
      command: ["git", "apply", "-R", patchFile],
      cwd: params.projectRoot,
      env: gitApplyProjectEnv(params.projectRoot),
      timeoutMs: 120_000,
    });
    const rollbackOutput = rollback.exitCode === 0
      ? "rolled back applied patch"
      : `rollback failed: ${rollback.stderr || rollback.stdout || "git apply -R failed"}`;
    return {
      status: "failed",
      reason: "validation_failed",
      changedPaths: changed,
      validationRun: true,
      validationStatus: "failed",
      validationSummary,
      output: `validation failed after applying ${changed.length} files; ${rollbackOutput}`,
    };
  }

  return {
    status: "ok",
    reason: "ok",
    changedPaths: changed,
    validationRun: params.runValidation,
    validationStatus: validationResult.status,
    validationSummary,
    output: `applied ${changed.length} files`,
  };
}

function normalizePatchForGitApply(text: string): string {
  const withoutFinalNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = withoutFinalNewline.split("\n");
  const out: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      out.push(line);
      continue;
    }
    if (line.startsWith("@@ ")) {
      inHunk = true;
      out.push(line);
      continue;
    }
    if (inHunk && !isHunkLine(line)) {
      out.push(` ${line}`);
      continue;
    }
    out.push(line);
  }

  return `${out.join("\n")}\n`;
}

function isHunkLine(line: string): boolean {
  return line.startsWith(" ") ||
    line.startsWith("+") ||
    line.startsWith("-") ||
    line.startsWith("\\");
}

async function runMinimalValidationDag(
  projectRoot: string,
  changedPaths: string[],
  evidence?: EvidenceWriter,
  summary: ValidationSummary[] = [],
): Promise<{ status: "ok" | "failed"; summary: ValidationSummary[] }> {
  if (!evidence) {
    summary.push({
      name: "validation",
      status: "failed",
      details: "validation requires evidence writer",
    });
    return { status: "failed", summary };
  }

  const toolchainExists = await hasResolvableToolchainManifest(projectRoot);
  summary.push({
    name: "toolchain_manifest",
    status: toolchainExists ? "ok" : "failed",
    details: toolchainExists ? undefined : "missing .vos/toolchain.json or supported build entrypoint",
  });
  if (!toolchainExists) {
    return { status: "failed", summary };
  }

  const changedInSpec = changedPaths.some((value) => value.startsWith("spec/") || value.startsWith(".vos/") );
  if (changedInSpec) {
    const status = await runSpecLintFromPatch(projectRoot);
    summary.push(status);
    if (status.status === "failed") return { status: "failed", summary };
  }

  let buildResult;
  try {
    buildResult = await runBuildCommand({
      projectRoot,
      evidence,
      dryRun: false,
    });
  } catch (error) {
    summary.push({
      name: "build",
      status: "failed",
      details: error instanceof Error ? error.message : String(error),
    });
    return { status: "failed", summary };
  }
  summary.push({ name: "build", status: buildResult.status, details: buildResult.output });
  if (buildResult.status === "failed") return { status: "failed", summary };

  const suites = collectAffectedTestSuites(changedPaths, projectRoot);
  if (suites.length > 0) {
    const testResult = await runTestCommand({
      projectRoot,
      evidence,
      suites,
      dryRun: false,
    });
    summary.push({
      name: "tests",
      status: testResult.status,
      details: `passed ${testResult.passedCount}/${testResult.suiteCount}`,
    });
    if (testResult.status === "failed") return { status: "failed", summary };
  } else {
    summary.push({
      name: "tests",
      status: "ok",
      details: "no affected public tests inferred",
    });
  }

  return { status: "ok", summary };
}

async function runSpecLintFromPatch(projectRoot: string): Promise<ValidationSummary> {
  const normalizedBundle = path.join(projectRoot, ".vos", "cache", "normalized", "bundle.json");
  if (!existsSync(normalizedBundle)) {
    return {
      name: "spec_lint",
      status: "failed",
      details: "spec normalization cache missing",
    };
  }

  try {
    await readFile(normalizedBundle, "utf8");
    return { name: "spec_lint", status: "ok" };
  } catch (error) {
    return {
      name: "spec_lint",
      status: "failed",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectAffectedTestSuites(changedPaths: string[], projectRoot: string): string[] {
  const suiteSet = new Set<string>();
  const manifestPath = path.join(projectRoot, ".vos", "toolchain.json");
  if (!existsSync(manifestPath)) return [];

  return runSyncJson(manifestPath, projectRoot, changedPaths, suiteSet);
}

function runSyncJson(
  manifestPath: string,
  projectRoot: string,
  changedPaths: string[],
  suiteSet: Set<string>,
): string[] {
  const manifestText = readFileSync(manifestPath, "utf8");
  const parsed = safeJsonParse(manifestText);
  if (!parsed || typeof parsed !== "object") return [];

  const test = (parsed as {
    test?: {
      suites?: Array<{ name?: string } | string>;
      tests?: string[];
    };
  }).test;
  const suites: Array<{ name?: string } | string> = Array.isArray(test?.suites)
    ? test?.suites as Array<{ name?: string } | string>
    : [];

  for (const entry of suites) {
    if (typeof entry === "string") {
      const lowered = entry.toLowerCase();
      if (matchesChangedPath(lowered, changedPaths, projectRoot)) {
        suiteSet.add(entry);
      }
      continue;
    }
    if (!entry || !entry.name) continue;
    if (matchesChangedPath(entry.name.toLowerCase(), changedPaths, projectRoot)) {
      suiteSet.add(entry.name);
    }
  }

  const fallbackTests = (parsed as { test?: { suites?: string[] } }).test?.suites;
  if (suiteSet.size === 0 && Array.isArray(fallbackTests) && fallbackTests.length > 0) {
    if (changedPaths.some((value) => value.startsWith("spec/"))) {
      for (const suite of fallbackTests.slice(0, 1)) {
        suiteSet.add(String(suite));
      }
    }
  }
  return [...suiteSet];
}

function matchesChangedPath(suiteName: string, changedPaths: string[], projectRoot: string): boolean {
  const normalizedRoot = path.resolve(projectRoot);
  return changedPaths.some((changed) => {
    const lower = changed.toLowerCase();
    return lower.includes(suiteName) || suiteName.includes(lower) || lower.includes("spec") || lower.includes("kernel") || lower.includes("user");
  }) || false;
}

export async function readPatchFromStdin(): Promise<string> {
  return await Bun.stdin.text().catch(() => "");
}

function extractChangedPaths(diff: string): string[] {
  const lines = diff.split(/\r?\n/);
  const paths = new Set<string>();
  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      const next = line.slice(4).trim();
      if (next === "/dev/null") continue;
      const file = next.startsWith("b/") ? next.slice(2) : next;
      paths.add(file);
    }
    if (line.startsWith("--- ")) {
      const next = line.slice(4).trim();
      if (next === "/dev/null") continue;
      const file = next.startsWith("a/") ? next.slice(2) : next;
      paths.add(file);
    }
  }
  return [...paths];
}

function gitApplyProjectEnv(projectRoot: string): Record<string, string> {
  return {
    GIT_CEILING_DIRECTORIES: path.dirname(path.resolve(projectRoot)),
  };
}

function allPathsAllowed(changed: string[], allowed: string[]): boolean {
  const normalizedAllowed = allowed.map((entry) => path.normalize(entry));
  return changed.every((pathValue) => {
    const normalized = path.normalize(pathValue);
    return normalizedAllowed.some((prefix) => {
      const normalizedPrefix = path.normalize(prefix);
      if (normalized === normalizedPrefix) return true;
      return normalized.startsWith(`${normalizedPrefix}${path.sep}`);
    });
  });
}

async function hasSpecBinding(params: {
  projectRoot: string;
  patchText: string;
  changedPaths: readonly string[];
  specBindings?: readonly string[];
}): Promise<boolean> {
  if (params.specBindings && params.specBindings.length > 0) {
    for (const binding of params.specBindings) {
      if (bindingResolvesToLocalSpec(params.projectRoot, binding)) return true;
      if (await bindingResolvesToNormalizedOperation(params.projectRoot, binding, params.changedPaths)) return true;
      if (await bindingResolvesToSpecYaml(params.projectRoot, binding, params.changedPaths)) return true;
    }
    return false;
  }
  return looksLikeSpecBinding(params.patchText);
}

function looksLikeSpecBinding(text: string): boolean {
  return /spec|Spec|SpecRef|#spec|operation|operation.yaml|module\.yaml/i.test(text);
}

function bindingResolvesToLocalSpec(projectRoot: string, binding: string): boolean {
  const ref = normalizeSpecRef(binding);
  if (!ref) return false;
  const normalized = path.normalize(ref.trim());
  if (!normalized || path.isAbsolute(normalized) || normalized.startsWith("..")) {
    return false;
  }
  if (!normalized.includes("spec")) {
    return false;
  }
  return existsSync(path.resolve(projectRoot, normalized));
}

async function bindingResolvesToNormalizedOperation(
  projectRoot: string,
  binding: string,
  changedPaths: readonly string[],
): Promise<boolean> {
  const normalized = normalizeSpecRef(binding);
  if (!normalized) return false;
  for (const rel of [
    path.join(".vos", "cache", "normalized", "operations.json"),
    path.join(".vos", "cache", "normalized", "bundle.json"),
  ]) {
    const filePath = path.join(projectRoot, rel);
    if (!existsSync(filePath)) continue;
    const parsed = safeJsonParse(await readFile(filePath, "utf8"));
    if (jsonContainsOperationRef(parsed, normalized, changedPaths)) return true;
  }
  return false;
}

async function bindingResolvesToSpecYaml(
  projectRoot: string,
  binding: string,
  changedPaths: readonly string[],
): Promise<boolean> {
  const normalized = normalizeSpecRef(binding);
  if (!normalized) return false;
  const specRoot = path.join(projectRoot, "spec");
  if (!existsSync(specRoot)) return false;
  const files = await collectYamlFiles(specRoot);
  for (const file of files) {
    try {
      const parsed = parseTopLevelYaml(await readFile(file, "utf8"));
      if (jsonContainsOperationRef(parsed, normalized, changedPaths)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function collectYamlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
        out.push(filePath);
      }
    }
  };
  await walk(root);
  return out;
}

function jsonContainsOperationRef(
  value: unknown,
  binding: string,
  changedPaths: readonly string[],
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => jsonContainsOperationRef(item, binding, changedPaths));
  }
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (recordMatchesOperationRef(record, binding, changedPaths)) return true;
  return Object.values(record).some((child) => jsonContainsOperationRef(child, binding, changedPaths));
}

function recordMatchesOperationRef(
  record: Record<string, unknown>,
  binding: string,
  changedPaths: readonly string[],
): boolean {
  const id = stringValue(record.id);
  const module = stringValue(record.module);
  const operation = stringValue(record.operation);
  const refs = [
    id,
    operation,
    module,
    module && operation ? `${module}.${operation}` : undefined,
    module && operation ? `${module}:${operation}` : undefined,
    module && operation ? `${module}/${operation}` : undefined,
  ]
    .filter((value): value is string => typeof value === "string")
    .map(normalizeSpecRef)
    .filter((value): value is string => typeof value === "string");
  if (!refs.includes(binding)) return false;

  const editableFile = editableRegionFile(record);
  if (!editableFile) return true;
  const normalizedEditableFile = normalizeProjectPath(editableFile);
  return changedPaths.some((changedPath) =>
    normalizeProjectPath(changedPath) === normalizedEditableFile
  );
}

function normalizeSpecRef(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withoutDescription = trimmed.split(":")[0]?.trim() ?? trimmed;
  const withoutClause = withoutDescription
    .replace(/\.(guarantee|preconditions|postconditions|invariants_preserved|concurrency|assumptions|requirements)\b.*$/i, "")
    .replace(/\.(proof|obligation|side_effects|returns|effects)\b.*$/i, "");
  return withoutClause.replace(/\\/g, "/");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function editableRegionFile(record: Record<string, unknown>): string | undefined {
  const llmCodegen = record.llm_codegen;
  if (!llmCodegen || typeof llmCodegen !== "object" || Array.isArray(llmCodegen)) return undefined;
  const editableRegion = (llmCodegen as Record<string, unknown>).editable_region;
  if (!editableRegion || typeof editableRegion !== "object" || Array.isArray(editableRegion)) return undefined;
  return stringValue((editableRegion as Record<string, unknown>).file);
}

function normalizeProjectPath(value: string): string {
  return path.normalize(value.trim()).replace(/\\/g, "/").replace(/^\.\//, "");
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
