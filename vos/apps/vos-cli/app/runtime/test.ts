import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EvidenceWriter } from "../evidence/index.ts";
import { runCommand } from "./executor.ts";
import { loadToolchainManifest, type TestSuiteV2, type ToolchainManifestV2 } from "./manifest.ts";
import { runBuildCommand } from "./build.ts";
import { runQemuCommand } from "./qemu.ts";

export interface TestSuiteVerdict {
  name: string;
  kind: TestSuiteV2["kind"];
  status: "ok" | "failed" | "timed_out" | "skipped";
  durationMs: number;
  evidenceRefs: string[];
  output?: string;
}

export interface TestResult {
  status: "ok" | "failed" | "timed_out";
  suiteCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  suites: TestSuiteVerdict[];
  details: Record<string, { status: "ok" | "failed" | "timed_out" | "skipped"; output: string }>;
}

export async function runTestCommand(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  suites: string[];
  dryRun: boolean;
  manifest?: ToolchainManifestV2;
  signal?: AbortSignal;
}): Promise<TestResult> {
  const { manifest } = params.manifest
    ? { manifest: params.manifest }
    : await loadToolchainManifest({ projectRoot: params.projectRoot });
  const selected = selectSuites(manifest, params.suites);
  const builtVariants = new Set<string>();
  const result: TestResult = {
    status: "ok",
    suiteCount: selected.length,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    suites: [],
    details: {},
  };

  for (const suite of selected) {
    const verdict = await runSuite({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      suite,
      dryRun: params.dryRun,
      builtVariants,
      signal: params.signal,
    });
    result.suites.push(verdict);
    result.details[suite.name] = { status: verdict.status, output: verdict.output ?? "" };
    if (verdict.status === "ok") {
      result.passedCount++;
    } else if (verdict.status === "skipped") {
      result.skippedCount++;
    } else {
      result.failedCount++;
      result.status = verdict.status;
      break;
    }
  }

  return result;
}

export function collectAvailableSuitesFromManifest(manifest: ToolchainManifestV2): Set<string> {
  return new Set(manifest.test.suites.map((suite) => suite.name));
}

function selectSuites(manifest: ToolchainManifestV2, requested: string[]): TestSuiteV2[] {
  if (requested.length === 0) return manifest.test.suites;
  const out = requested.map((name) => {
    const suite = manifest.test.suites.find((candidate) => candidate.name === name);
    if (!suite) throw new Error(`unknown test suite: ${name}`);
    return suite;
  });
  return out;
}

async function runSuite(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  suite: TestSuiteV2;
  dryRun: boolean;
  builtVariants: Set<string>;
  signal?: AbortSignal;
}): Promise<TestSuiteVerdict> {
  const started = Date.now();
  const nodeId = "test:" + params.suite.name;
  await params.evidence.markNodeStarted(nodeId);
  try {
    const buildVariant = params.suite.build_variant;
    if (buildVariant && !params.builtVariants.has(buildVariant)) {
      const build = await runBuildCommand({
        projectRoot: params.projectRoot,
        evidence: params.evidence,
        variant: buildVariant,
        dryRun: params.dryRun,
        signal: params.signal,
      });
      if (build.status !== "ok") {
        await params.evidence.markNodeFinished(nodeId, build.status);
        return {
          name: params.suite.name,
          kind: params.suite.kind,
          status: build.status,
          durationMs: Date.now() - started,
          evidenceRefs: build.artifacts.map((artifact) => path.relative(params.evidence.run_root, artifact)),
          output: build.output,
        };
      }
      params.builtVariants.add(buildVariant);
    }

    const verdict = params.suite.kind === "command"
      ? await runCommandSuite({
        projectRoot: params.projectRoot,
        evidence: params.evidence,
        suite: params.suite,
        dryRun: params.dryRun,
        signal: params.signal,
      })
      : await runQemuCaseSuite({
        projectRoot: params.projectRoot,
        evidence: params.evidence,
        suite: params.suite,
        dryRun: params.dryRun,
        signal: params.signal,
      });
    await params.evidence.markNodeFinished(nodeId, verdict.status);
    return verdict;
  } catch (error) {
    await params.evidence.markNodeFinished(nodeId, "failed");
    return {
      name: params.suite.name,
      kind: params.suite.kind,
      status: "failed",
      durationMs: Date.now() - started,
      evidenceRefs: [],
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runCommandSuite(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  suite: Extract<TestSuiteV2, { kind: "command" }>;
  dryRun: boolean;
  signal?: AbortSignal;
}): Promise<TestSuiteVerdict> {
  const started = Date.now();
  const root = path.join(params.evidence.artifacts_root, "test", safeFileName(params.suite.name));
  await mkdir(root, { recursive: true });
  const planPath = path.join(root, "plan.txt");
  if (params.dryRun) {
    await writeFile(planPath, `${params.suite.command.map(escapeShellArg).join(" ")}\n`);
    params.evidence.addArtifactFromPath("test-plan", planPath, params.suite.name);
    return {
      name: params.suite.name,
      kind: "command",
      status: "ok",
      durationMs: Date.now() - started,
      evidenceRefs: [path.relative(params.evidence.run_root, planPath)],
      output: "dry run",
    };
  }

  const commandResult = await runCommand({
    command: params.suite.command,
    cwd: params.suite.cwd ? path.resolve(params.projectRoot, params.suite.cwd) : params.projectRoot,
    env: params.suite.env,
    timeoutMs: params.suite.timeout_ms,
    signal: params.signal,
  });
  const stdoutPath = path.join(root, "stdout.log");
  const stderrPath = path.join(root, "stderr.log");
  const resultPath = path.join(root, "result.json");
  await writeFile(stdoutPath, commandResult.stdout);
  await writeFile(stderrPath, commandResult.stderr);
  const status = commandResult.exitCode === 0 && !commandResult.timedOut
    ? "ok"
    : commandResult.timedOut ? "timed_out" : "failed";
  await writeFile(resultPath, `${JSON.stringify({
    suite: params.suite.name,
    kind: params.suite.kind,
    exit_code: commandResult.exitCode,
    timed_out: commandResult.timedOut,
    duration_ms: commandResult.durationMs,
    status,
  }, null, 2)}\n`);
  params.evidence.addArtifactFromPath("test-stdout", stdoutPath, params.suite.name);
  params.evidence.addArtifactFromPath("test-stderr", stderrPath, params.suite.name);
  params.evidence.addArtifactFromPath("test-result", resultPath, params.suite.name);
  return {
    name: params.suite.name,
    kind: "command",
    status,
    durationMs: commandResult.durationMs,
    evidenceRefs: [stdoutPath, stderrPath, resultPath].map((file) => path.relative(params.evidence.run_root, file)),
    output: `${commandResult.stdout}\n${commandResult.stderr}`,
  };
}

async function runQemuCaseSuite(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  suite: Extract<TestSuiteV2, { kind: "qemu-case" }>;
  dryRun: boolean;
  signal?: AbortSignal;
}): Promise<TestSuiteVerdict> {
  const started = Date.now();
  const run = await runQemuCommand({
    projectRoot: params.projectRoot,
    evidence: params.evidence,
    caseId: params.suite.run_case,
    timeoutMs: params.suite.timeout_ms,
    dryRun: params.dryRun,
    signal: params.signal,
  });
  return {
    name: params.suite.name,
    kind: "qemu-case",
    status: run.status,
    durationMs: run.durationMs || Date.now() - started,
    evidenceRefs: [run.serialPath, run.stderrPath, run.resultPath].filter((value): value is string => !!value)
      .map((file) => path.relative(params.evidence.run_root, file)),
    output: run.output,
  };
}

function safeFileName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_.-]/g, "-");
}

function escapeShellArg(value: string): string {
  if (/\s/.test(value)) return `"${value.replace(/"/g, "\\\"")}"`;
  return value;
}
