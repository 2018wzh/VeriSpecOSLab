import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EvidenceWriter } from "../evidence/index.ts";
import { runCommand } from "./executor.ts";
import { resolveToolchainManifestPath } from "./toolchain-manifest.ts";

interface TestSuite {
  name: string;
  command: string | string[];
}

interface ToolchainTestSpec {
  test?: {
    suites?: TestSuite[];
    command?: string;
  };
  tests?: string[];
}

export interface TestResult {
  status: "ok" | "failed";
  suiteCount: number;
  passedCount: number;
  failedCount: number;
  details: Record<string, { status: "ok" | "failed"; output: string }>;
}

export async function runTestCommand(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  suites: string[];
  dryRun: boolean;
  signal?: AbortSignal;
}): Promise<TestResult> {
  const toolchainFile = await resolveToolchainManifestPath({
    projectRoot: params.projectRoot,
  });
  const manifest: ToolchainTestSpec = existsSync(toolchainFile)
    ? JSON.parse(await readFile(toolchainFile, "utf8"))
    : {};

  const suites = buildSuites(manifest, params.suites, params.projectRoot);

  if (suites.length === 0) {
    return {
      status: "failed",
      suiteCount: 0,
      passedCount: 0,
      failedCount: 0,
      details: {},
    };
  }

  const result: TestResult = {
    status: "ok",
    suiteCount: suites.length,
    passedCount: 0,
    failedCount: 0,
    details: {},
  };

  for (const suite of suites) {
    const normalized = normalizeCommand(suite.command);
    const nodeId = "test:" + suite.name;
    await params.evidence.markNodeStarted(nodeId);

    if (params.dryRun) {
      const planPath = path.join(params.evidence.run_root, "artifacts", "test", suite.name + ".plan");
      await mkdir(path.dirname(planPath), { recursive: true });
      await writeFile(planPath, normalized.command + " " + normalized.args.join(" ") + "\n");
      result.details[suite.name] = { status: "ok", output: "dry run" };
      result.passedCount++;
      params.evidence.addArtifact("test-plan", path.relative(params.projectRoot, planPath), suite.command as string);
      await params.evidence.markNodeFinished(nodeId, "ok");
      continue;
    }

    const commandResult = await runCommand({
      command: [normalized.command, ...normalized.args],
      cwd: params.projectRoot,
      signal: params.signal,
      onStdoutLine: () => {},
      onStderrLine: () => {},
    });

    const output = String(commandResult.stdout) + "\n" + String(commandResult.stderr);
    const logPath = await params.evidence.writeLog("test", suite.name + ".log", output);
    const suitePassed = commandResult.exitCode === 0;
    result.details[suite.name] = { status: suitePassed ? "ok" : "failed", output };
    params.evidence.addArtifact("test", path.relative(params.projectRoot, logPath), suite.name);
    if (suitePassed) {
      result.passedCount++;
    } else {
      result.failedCount++;
      result.status = "failed";
    }
    await params.evidence.markNodeFinished(nodeId, suitePassed ? "ok" : "failed");
    if (result.status === "failed") {
      break;
    }
  }

  return result;
}

function buildSuites(manifest: ToolchainTestSpec, requested: string[], _projectRoot: string): TestSuite[] {
  const suites: TestSuite[] = [];

  if (manifest.test?.suites && manifest.test.suites.length > 0) {
    const requestedSet = new Set(requested);
    for (const s of manifest.test.suites) {
      if (requested.length > 0 && !requestedSet.has(s.name)) {
        continue;
      }
      suites.push(s);
    }
  }

  if (manifest.tests && suites.length === 0) {
    for (const name of manifest.tests) {
      if (requested.length > 0 && !requested.includes(name)) continue;
      suites.push({ name, command: name });
    }
  }

  return suites;
}

function normalizeCommand(raw: string | string[]): { command: string; args: string[] } {
  if (Array.isArray(raw)) {
    return { command: raw[0], args: raw.slice(1) };
  }
  const split = raw.match(/"([^"]*)"|'([^']*)'|\S+/g);
  if (!split) {
    throw new Error("invalid command for test suite: " + raw);
  }
  return {
    command: split[0],
    args: split.slice(1).map((v) => v.replace(/^"|"$|^'|'$/g, "")),
  };
}
