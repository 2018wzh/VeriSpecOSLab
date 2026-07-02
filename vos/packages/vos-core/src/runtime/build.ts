import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EvidenceWriter } from "../evidence/index.ts";
import { runCommand } from "./executor.ts";
import { probeRequiredTools, type ToolVersionProbe } from "./environment.ts";
import { collectStringListByKey, parseTopLevelYaml } from "../utils/yaml.ts";
import { relativeProjectPath } from "../utils/paths.ts";
import { withResourceLock } from "./locks.ts";
import { getBuildVariant, loadToolchainManifest, type ToolchainCommandV2, type ToolchainManifestV2 } from "./manifest.ts";

export interface ToolchainCommand {
  name: string;
  command: string[];
  cwd?: string;
  timeoutMs?: number;
  timeout_ms?: number;
}

export interface BuildManifest {
  spec_hash?: string;
  spec_path?: string;
  files?: string[];
  generator?: {
    name?: string;
    version?: string;
  };
  commands?: Array<string | ToolchainCommand>;
  build?: {
    commands?: Array<string | ToolchainCommand>;
    artifacts?: string[];
  };
  artifacts?: string[];
  projection_version?: string;
}

export interface BuildPlanStep {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}

interface BuildResult {
  status: "ok" | "failed" | "timed_out";
  artifacts: string[];
  output: string;
  failedStep?: string;
  toolVersions?: ToolVersionProbe[];
}

export async function runBuildCommand(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  toolchainPath?: string;
  variant?: string;
  dryRun: boolean;
  signal?: AbortSignal;
}): Promise<BuildResult> {
  return await withResourceLock(params.evidence, `build:${params.projectRoot}`, async () => runBuildCommandUnlocked(params));
}

async function runBuildCommandUnlocked(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  toolchainPath?: string;
  variant?: string;
  dryRun: boolean;
  signal?: AbortSignal;
}): Promise<BuildResult> {
  const { path: toolchainFile, manifest } = await loadToolchainManifest({
    projectRoot: params.projectRoot,
    toolchainPath: params.toolchainPath,
  });
  const requiredSpecHash = manifest.spec_hash;
  if (requiredSpecHash) {
    await ensureCachedSpecHashMatches(params.projectRoot, requiredSpecHash);
  }
  enforceManifestFilesExist(manifest, params.projectRoot);
  const allowedOutputPaths = await loadAllowedOutputPaths(params.projectRoot);
  enforceManifestPathGuard(manifest, allowedOutputPaths);
  const toolVersions = probeRequiredTools(manifest.environment.required_tools);
  const envPath = path.join(params.evidence.artifacts_root, "build", "environment.json");
  mkdirSync(path.dirname(envPath), { recursive: true });
  await writeFile(envPath, `${JSON.stringify({ required_tools: toolVersions }, null, 2)}\n`);
  params.evidence.addArtifactFromPath("toolchain-environment", envPath, "required tool versions");
  const variant = getBuildVariant(manifest, params.variant ?? "baseline");
  const steps = normalizeCommands(manifest, params.projectRoot, variant.id);

  if (params.dryRun) {
    const dryPlan = steps.map((s) => `${s.command} ${s.args.join(" ")}`);
    const planPath = path.join(params.evidence.run_root, "artifacts", "build", "plan.txt");
    mkdirSync(path.dirname(planPath), { recursive: true });
    await writeFile(planPath, `${dryPlan.join("\n")}\n`);
    params.evidence.addArtifactFromPath("build-plan", planPath, "dry-run plan");
    return {
      status: "ok",
      artifacts: [relativeProjectPath(params.projectRoot, planPath)],
      output: dryPlan.join("\n"),
      toolVersions,
    };
  }

  const artifacts: string[] = [];
  const buildLog = path.join(params.evidence.artifacts_root, "build.log");
  let output = "";
  for (const step of steps) {
    const nodeId = `build:${step.id}`;
    await params.evidence.markNodeStarted(nodeId);
    const childResult = await runCommand({
      command: [step.command, ...step.args],
      cwd: step.cwd,
      timeoutMs: step.timeoutMs,
      signal: params.signal,
      onStdoutLine: (line) => {
        output += `${line}\n`;
      },
      onStderrLine: (line) => {
        output += `${line}\n`;
      },
    });

    const logPath = await params.evidence.writeLog(
      "build",
      `${step.id}.log`,
      `${childResult.stdout}\n${childResult.stderr}`,
    );
    artifacts.push(logPath);
    await params.evidence.markNodeFinished(nodeId, childResult.exitCode === 0 ? "ok" : "failed");

    if (childResult.exitCode !== 0) {
      const cancelled = params.signal?.aborted;
      return {
        status: childResult.timedOut ? "timed_out" : cancelled ? "failed" : "failed",
        artifacts: [relativeProjectPath(params.projectRoot, logPath)],
        output: cancelled ? "cancelled" : output || "build command failed",
        failedStep: step.id,
      };
    }

    await params.evidence.addEvidenceRef(`${params.evidence.run_id}:${step.id}`, "build-step", relativeProjectPath(params.projectRoot, logPath));
    params.evidence.addArtifact("build", relativeProjectPath(params.projectRoot, logPath), `step ${step.id}`);
  }

  if (variant.artifacts) {
    for (const rel of variant.artifacts) {
      const p = path.resolve(params.projectRoot, rel);
      if (existsSync(p) && (await lstat(p)).isFile()) {
        const hash = await hashFile(p);
        params.evidence.addArtifact("artifact", relativeProjectPath(params.projectRoot, p), `sha256:${hash}`);
        artifacts.push(p);
      }
    }
  }

  const normalizedManifestHash = await hashFile(toolchainFile);
  const runManifest = {
    status: "ok",
    generated_at: new Date().toISOString(),
    manifest_hash: normalizedManifestHash,
  };
  await writeFile(path.join(path.dirname(toolchainFile), "toolchain.meta.json"), `${JSON.stringify(runManifest, null, 2)}\n`);

  if (manifest.generator?.name) {
    if (manifest.generator.version) {
      const projectionRef = `${manifest.generator.name}@${manifest.generator.version}`;
      params.evidence.addEvidenceRef("projection", "toolchain.generator", projectionRef);
    }
  }

  await writeFile(buildLog, `${output}\n`);
  params.evidence.addArtifactFromPath("build", buildLog, "aggregate build log");
  return { status: "ok", artifacts, output: output || "build completed", toolVersions };
}

async function loadAllowedOutputPaths(projectRoot: string): Promise<string[]> {
  const buildSpecPath = path.join(projectRoot, "spec", "toolchain", "build.yaml");
  if (!existsSync(buildSpecPath)) {
    return [];
  }
  const raw = await readFile(buildSpecPath, "utf8");
  return collectStringListByKey(parseTopLevelYaml(raw), "allowed_output_path");
}

function enforceManifestPathGuard(manifest: ToolchainManifestV2, allowedOutputPaths: string[]): void {
  const candidates = collectManifestOutputPaths(manifest);
  if (allowedOutputPaths.length === 0) {
    if (candidates.length > 0) {
      throw new Error("toolchain build.allowed_output_path is missing or empty");
    }
    return;
  }
  const denied = candidates.filter((entry) => !isPathAllowed(entry, allowedOutputPaths));
  if (denied.length > 0) {
    throw new Error(`toolchain manifest writes disallowed paths: ${denied.join(", ")}`);
  }
}

function enforceManifestFilesExist(manifest: ToolchainManifestV2, projectRoot: string): void {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const missing = files
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    .filter((entry) => !existsSync(path.resolve(projectRoot, entry)));
  if (missing.length > 0) {
    throw new Error(`toolchain manifest references missing generated files: ${missing.join(", ")}`);
  }
}

function collectManifestOutputPaths(manifest: ToolchainManifestV2): string[] {
  const out: string[] = [];
  if (Array.isArray(manifest.files)) {
    for (const value of manifest.files) {
      if (typeof value === "string") out.push(value);
    }
  }
  return [...new Set(out)];
}

function isPathAllowed(candidate: string, allowed: string[]): boolean {
  const normalized = normalizeArtifactPath(candidate);
  return allowed.some((entry) => {
    const prefix = normalizeArtifactPath(entry);
    return normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`);
  });
}

function normalizeArtifactPath(raw: string): string {
  return path.normalize(raw.trim()).replace(/^\.?[\\/]/, "");
}

function normalizeCommands(manifest: ToolchainManifestV2, projectRoot: string, variantId: string): BuildPlanStep[] {
  const raw = getBuildVariant(manifest, variantId).commands;

  return raw.map((cmd, index) => {
    const { command, args } = normalizeCommand(cmd);
    const stepId = typeof cmd === "string" ? `step-${index + 1}` : cmd.name || `step-${index + 1}`;
    const cwd = typeof cmd === "string" || !cmd.cwd
      ? projectRoot
      : path.resolve(projectRoot, cmd.cwd);
    const timeoutMs = typeof cmd === "string"
      ? 60_000
      : cmd.timeoutMs ?? cmd.timeout_ms ?? 60_000;
    return {
      id: stepId,
      command,
      args,
      cwd,
      timeoutMs,
    };
  });
}

function normalizeCommand(cmd: string | ToolchainCommandV2): { command: string; args: string[] } {
  if (typeof cmd === "string") {
    const parts = splitCommand(cmd);
    return { command: parts[0], args: parts.slice(1) };
  }

  return {
    command: cmd.command[0],
    args: cmd.command.slice(1),
  };
}

function splitCommand(cmd: string): string[] {
  const match = cmd.match(/"([^"]*)"|'([^']*)'|\S+/g);
  if (!match) {
    throw new Error(`invalid command line: ${cmd}`);
  }
  return match.map((v) => v.replace(/^"|"$|^'|'$/g, ""));
}

async function hashFile(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

async function ensureCachedSpecHashMatches(projectRoot: string, expected: string): Promise<void> {
  const normalizedBundlePath = path.resolve(projectRoot, ".vos", "cache", "normalized", "bundle.json");
  if (!existsSync(normalizedBundlePath)) {
    throw new Error(`build requires normalized spec bundle for hash validation: ${normalizedBundlePath}`);
  }
  const actual = await hashFile(normalizedBundlePath);
  if (actual !== expected) {
    throw new Error(`build spec hash mismatch: expected ${expected}, got ${actual}`);
  }
}
