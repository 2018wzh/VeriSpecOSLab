import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EvidenceWriter } from "../evidence/index.ts";
import { runCommand } from "./executor.ts";
import { isRecord, parseTopLevelYaml, stringArray } from "../utils/yaml.ts";
import { resolveToolchainManifestPath } from "./toolchain-manifest.ts";

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
  successSignal: string;
  timeoutMs: number;
  artifact: string;
}

interface ParsedRunYaml {
  command: string;
  args: string[];
  successSignal?: string;
  timeoutSecs: number;
  artifact: string;
}

export interface RunCommandResult {
  status: "ok" | "failed";
  output: string;
  readyDetected: boolean;
  serialPath?: string;
  durationMs: number;
  smokeResultPath?: string;
}

export async function runQemuCommand(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  timeoutMs?: number;
  readyPattern?: string;
  dryRun: boolean;
}): Promise<RunCommandResult> {
  const toolchainFile = await resolveToolchainManifestPath({
    projectRoot: params.projectRoot,
  });
  if (!existsSync(toolchainFile)) {
    throw new Error("run requires .vos/toolchain.json");
  }

  const manifest: RunManifest = JSON.parse(await readFile(toolchainFile, "utf8"));
  const runSpec = resolveRunSpec(manifest, params.projectRoot, {
    commandTimeoutMs: params.timeoutMs,
    readyPattern: params.readyPattern,
  });

  const serialPath = path.join(params.evidence.artifacts_root, "qemu.log");
  const smokeResultPath = path.join(params.evidence.run_root, "smoke-result.json");
  const commandLine = [runSpec.command, ...runSpec.args];

  if (params.dryRun) {
    const planPath = path.join(params.evidence.artifacts_root, "run", "qemu-plan.txt");
    await mkdir(path.dirname(planPath), { recursive: true });
    await writeFile(planPath, `${commandLine.map(escapeShellArg).join(" ")}\n`);
    params.evidence.addArtifact("run-plan", path.relative(params.projectRoot, planPath), "dry-run qemu command");
    const smokeResult = {
      status: "ok",
      statusReason: "dry-run",
      command: commandLine.join(" "),
      success_signal: runSpec.successSignal,
      timed_out: false,
      ready_detected: false,
    };
    await writeFile(smokeResultPath, `${JSON.stringify(smokeResult, null, 2)}\n`);
    params.evidence.addArtifact("smoke-result", path.relative(params.projectRoot, smokeResultPath), "smoke result");
    return {
      status: "ok",
      output: `dry-run: ${commandLine.join(" ")}`,
      readyDetected: false,
      serialPath,
      durationMs: 0,
      smokeResultPath,
    };
  }

  const artifactPath = path.resolve(params.projectRoot, runSpec.artifact);
  if (!existsSync(artifactPath)) {
    throw new Error(`run requires kernel artifact from run spec: ${runSpec.artifact}`);
  }

  const runResult = await runCommand({
    command: [runSpec.command, ...runSpec.args],
    cwd: params.projectRoot,
    timeoutMs: runSpec.timeoutMs,
    onStdoutLine: () => {},
    onStderrLine: () => {},
  });

  const output = `${runResult.stdout}${runResult.stderr}`;
  await writeFile(serialPath, `${output}\n`);
  params.evidence.addArtifact("trace", path.relative(params.projectRoot, serialPath), "qemu serial log");

  const readyDetected = new RegExp(runSpec.successSignal).test(output);
  const status = readyDetected ? "ok" : "failed";

  const smokeResult = {
    status,
    statusReason: status === "ok" ? "success_signal_matched" : "runtime_failed",
    command: commandLine.join(" "),
    success_signal: runSpec.successSignal,
    timed_out: runResult.timedOut,
    signal: runResult.signal,
    exit_code: runResult.exitCode,
    ready_detected: readyDetected,
    artifact: runSpec.artifact,
    duration_ms: runResult.durationMs,
  };
  await writeFile(smokeResultPath, `${JSON.stringify(smokeResult, null, 2)}\n`);
  params.evidence.addArtifact("smoke-result", path.relative(params.projectRoot, smokeResultPath), "smoke result");

  return {
    status,
    output,
    readyDetected,
    serialPath,
    durationMs: runResult.durationMs,
    smokeResultPath,
  };
}

function resolveRunSpec(
  manifest: RunManifest,
  projectRoot: string,
  opts: {
    commandTimeoutMs?: number;
    readyPattern?: string;
  },
): RunSpec {
  const manifestRun = manifest.run;
  const runYamlPath = path.join(projectRoot, "spec", "toolchain", "run.yaml");
  const runYaml = parseRunYaml(runYamlPath);
  const artifact = manifestRun?.artifact
    ?? manifestRun?.artifacts?.[0]
    ?? runYaml.artifact;

  const command = manifestRun?.command ?? runYaml.command;
  let args = manifestRun?.args
    ? [...manifestRun.args]
    : [...runYaml.args];
  if (!command) {
    throw new Error("run spec missing command");
  }
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error("run spec missing arguments");
  }
  if (!artifact) {
    throw new Error("run spec missing artifact");
  }
  const kernelArgIndex = args.indexOf("-kernel");
  if (kernelArgIndex >= 0) {
    if (args[kernelArgIndex + 1] !== artifact) {
      args.splice(kernelArgIndex + 1, 0, artifact);
    }
  } else if (!args.includes(`-kernel=${artifact}`)) {
    args.push("-kernel", artifact);
  }

  const successSignal = resolveSuccessSignal(
    manifestRun?.successSignal,
    runYaml.successSignal,
    opts.readyPattern,
  );
  const timeoutMs = resolveTimeoutMs(
    opts.commandTimeoutMs,
    manifestRun?.timeout_ms,
    manifestRun?.timeout_secs,
    runYaml.timeoutSecs,
  );

  return {
    command,
    args,
    successSignal,
    timeoutMs,
    artifact,
  };
}

function resolveSuccessSignal(
  manifestSignal: string | undefined,
  yamlSignal: string | undefined,
  overrideSignal: string | undefined,
): string {
  if (overrideSignal) return overrideSignal;
  if (manifestSignal && manifestSignal.trim()) return manifestSignal.trim();
  if (yamlSignal && yamlSignal.trim()) return yamlSignal.trim();
  throw new Error("run requires success signal");
}

function parseRunYaml(runYamlPath: string): ParsedRunYaml {
  if (!existsSync(runYamlPath)) {
    throw new Error(`run requires ${runYamlPath}`);
  }

  const run: ParsedRunYaml = {
    command: "qemu-system-riscv64",
    args: [],
    timeoutSecs: 30,
    artifact: "build/kernel.bin",
  };

  const parsed = parseTopLevelYaml(readFileSync(runYamlPath, "utf8"));
  const rawRun = parsed.run;
  if (!isRecord(rawRun)) {
    run.args.push("-machine", "virt", "-cpu", "rv64");
    return run;
  }

  const command = stringValue(rawRun.command) ?? stringValue(rawRun.emulator);
  if (command) {
    run.command = command;
  }

  const kernelArg = stringValue(rawRun.kernel_arg);
  if (kernelArg) {
    run.args.push(kernelArg);
  }

  const machine = stringValue(rawRun.machine) ?? "virt";
  run.args.push("-machine", machine);

  const cpu = stringValue(rawRun.cpu) ?? "rv64";
  run.args.push("-cpu", cpu);

  const extraArgs = stringArray(rawRun.extra_args);
  if (extraArgs) {
    run.args.push(...extraArgs);
  }

  const artifact = stringValue(rawRun.kernel_path) ?? stringValue(rawRun.artifact);
  if (artifact) {
    run.artifact = artifact;
  }

  const successSignal = stringValue(rawRun.success_signal) ?? stringValue(rawRun.successSignal);
  if (successSignal) {
    run.successSignal = successSignal;
  }

  const timeoutSecs = numberValue(rawRun.timeout_secs) ?? numberValue(rawRun.timeoutSecs);
  if (timeoutSecs !== undefined && timeoutSecs > 0) {
    run.timeoutSecs = timeoutSecs;
  }

  return run;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveTimeoutMs(
  cliTimeoutMs: number | undefined,
  manifestTimeoutMs?: number,
  manifestTimeoutSecs?: number,
  yamlTimeoutSecs: number = 30,
): number {
  if (cliTimeoutMs !== undefined) return cliTimeoutMs;
  if (manifestTimeoutMs !== undefined) return manifestTimeoutMs;
  if (manifestTimeoutSecs !== undefined) return manifestTimeoutSecs * 1000;
  return yamlTimeoutSecs * 1000;
}

function escapeShellArg(value: string): string {
  if (/\s/.test(value)) {
    return `"${value.replace(/"/g, "\\\"")}"`;
  }
  return value;
}
