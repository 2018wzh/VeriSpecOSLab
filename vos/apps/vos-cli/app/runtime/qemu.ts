import { createConnection } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { EvidenceWriter } from "../evidence/index.ts";
import { runCommand } from "./executor.ts";
import { isRecord, parseTopLevelYaml, stringArray } from "../utils/yaml.ts";
import { resolveToolchainManifestPath } from "./toolchain-manifest.ts";
import { withResourceLock } from "./locks.ts";
import {
  escapeRunShellArg,
  resolveRunTimeoutMs,
  safeRunArtifactName,
  type RunCommandResult,
} from "./run.ts";

const endpointSchema = z.union([
  z.boolean(),
  z.object({
    enabled: z.boolean().optional(),
    path: z.string().optional(),
    port: z.number().int().positive().optional(),
  }),
]).optional();

const profileSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  timeout_ms: z.number().nonnegative().optional(),
  timeout_secs: z.number().nonnegative().optional(),
  serial: endpointSchema,
  qmp: endpointSchema,
  hmp: endpointSchema,
  gdb: endpointSchema,
  resource_lock: z.string().optional(),
});

const caseSchema = z.object({
  id: z.string().min(1),
  profile: z.string().optional(),
  stdin: z.string().optional(),
  stdin_after: z.object({
    pattern: z.string(),
    text: z.string(),
  }).optional(),
  success_regex: z.string().optional(),
  failure_regex: z.string().optional(),
  exit_code: z.number().int().optional(),
  timeout_ms: z.number().nonnegative().optional(),
  required_artifacts: z.array(z.string()).optional(),
  expected_qmp_events: z.array(z.string()).optional(),
});

const manifestRunSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  timeout_ms: z.number().nonnegative().optional(),
  timeout_secs: z.number().nonnegative().optional(),
  successSignal: z.string().optional(),
  artifact: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
  profiles: z.array(profileSchema).optional(),
  cases: z.array(caseSchema).optional(),
});

interface QemuToolchainManifest {
  run?: unknown;
}

interface LegacyQemuRunYaml {
  command: string;
  args: string[];
  successSignal?: string;
  timeoutSecs: number;
  artifact: string;
}

interface EndpointConfig {
  enabled: boolean;
  path?: string;
  port?: number;
}

interface QemuProfile {
  id: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  artifacts: string[];
  timeoutMs: number;
  qmp: EndpointConfig;
  hmp: EndpointConfig;
  gdb: EndpointConfig;
  resourceLock: string;
  legacyKernelInject: boolean;
}

interface QemuCase {
  id: string;
  profileId: string;
  stdin?: string;
  stdinAfter?: { pattern: string; text: string };
  successRegex?: string;
  failureRegex?: string;
  exitCode?: number;
  timeoutMs?: number;
  requiredArtifacts: string[];
  expectedQmpEvents: string[];
}

interface QemuRunPlan {
  profiles: QemuProfile[];
  cases: QemuCase[];
  profile: QemuProfile;
  testCase: QemuCase;
  commandLine: string[];
  qmpEndpoint?: string;
  hmpEndpoint?: string;
  gdbEndpoint?: string;
}

export type QemuRunCommandResult = RunCommandResult;

export async function runQemuCommand(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  timeoutMs?: number;
  readyPattern?: string;
  profileId?: string;
  caseId?: string;
  listProfiles?: boolean;
  listCases?: boolean;
  dryRun: boolean;
  signal?: AbortSignal;
}): Promise<QemuRunCommandResult> {
  const plan = await resolveRunPlan(params);
  return await withResourceLock(params.evidence, plan.profile.resourceLock, async () => runQemuCommandUnlocked(params, plan));
}

async function runQemuCommandUnlocked(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  timeoutMs?: number;
  readyPattern?: string;
  profileId?: string;
  caseId?: string;
  listProfiles?: boolean;
  listCases?: boolean;
  dryRun: boolean;
  signal?: AbortSignal;
}, plan: QemuRunPlan): Promise<QemuRunCommandResult> {
  if (params.listProfiles || params.listCases) {
    const list = {
      profiles: plan.profiles.map((profile) => profile.id),
      cases: plan.cases.map((testCase) => ({ id: testCase.id, profile: testCase.profileId })),
    };
    const listPath = path.join(params.evidence.artifacts_root, "run", "qemu-list.json");
    await mkdir(path.dirname(listPath), { recursive: true });
    await writeFile(listPath, `${JSON.stringify(list, null, 2)}\n`);
    params.evidence.addArtifactFromPath("run-plan", listPath, "qemu profile/case list");
    return {
      status: "ok",
      output: JSON.stringify(list),
      readyDetected: false,
      durationMs: 0,
      profiles: list.profiles,
      cases: list.cases.map((item) => item.id),
    };
  }

  const caseRoot = path.join(params.evidence.artifacts_root, "run", safeRunArtifactName(plan.testCase.id));
  const legacySerialPath = path.join(params.evidence.artifacts_root, "qemu.log");
  const legacyResultPath = path.join(params.evidence.run_root, "smoke-result.json");
  const serialPath = path.join(caseRoot, "serial.log");
  const stderrPath = path.join(caseRoot, "stderr.log");
  const resultPath = path.join(caseRoot, "result.json");
  await mkdir(caseRoot, { recursive: true });

  if (params.dryRun) {
    const planPath = path.join(caseRoot, "qemu-plan.txt");
    await writeFile(planPath, `${plan.commandLine.map(escapeRunShellArg).join(" ")}\n`);
    params.evidence.addArtifactFromPath("run-plan", planPath, "dry-run qemu command");
    const dryResult = buildResultJson({
      status: "ok",
      statusReason: "dry-run",
      plan,
      commandResult: undefined,
      stdout: "",
      stderr: "",
      qmpEvents: [],
      serialPath,
      stderrPath,
      runRoot: params.evidence.run_root,
      adapterPath: await writeAdapterContract(params, plan, caseRoot),
    });
    await writeFile(resultPath, `${JSON.stringify(dryResult, null, 2)}\n`);
    await writeFile(legacyResultPath, `${JSON.stringify(dryResult, null, 2)}\n`);
    params.evidence.addArtifactFromPath("smoke-result", resultPath, "qemu case result");
    return {
      status: "ok",
      output: `dry-run: ${plan.commandLine.join(" ")}`,
      readyDetected: false,
      serialPath,
      stderrPath,
      durationMs: 0,
      smokeResultPath: legacyResultPath,
      resultPath,
      profileId: plan.profile.id,
      caseId: plan.testCase.id,
    };
  }

  for (const artifact of plan.profile.artifacts) {
    if (!existsSync(path.resolve(params.projectRoot, artifact))) {
      throw new Error(`run requires artifact from run profile ${plan.profile.id}: ${artifact}`);
    }
  }

  const qmpController = new AbortController();
  const qmpEventsPromise = plan.qmpEndpoint
    ? collectQmpEvents({
      endpoint: plan.qmpEndpoint,
      expectedEvents: plan.testCase.expectedQmpEvents,
      timeoutMs: plan.testCase.timeoutMs ?? plan.profile.timeoutMs,
      signal: qmpController.signal,
    })
    : Promise.resolve([] as Array<Record<string, unknown>>);

  const commandResult = await runCommand({
    command: plan.commandLine,
    cwd: plan.profile.cwd ? path.resolve(params.projectRoot, plan.profile.cwd) : params.projectRoot,
    env: plan.profile.env,
    timeoutMs: plan.testCase.timeoutMs ?? plan.profile.timeoutMs,
    timeoutGraceMs: 500,
    stdin: plan.testCase.stdin,
    stdinAfter: plan.testCase.stdinAfter,
    signal: params.signal,
    stopWhen: ({ stdout, stderr }) => {
      const output = `${stdout}${stderr}`;
      if (plan.testCase.failureRegex && new RegExp(plan.testCase.failureRegex).test(output)) return true;
      return plan.testCase.exitCode === undefined &&
        !!plan.testCase.successRegex &&
        new RegExp(plan.testCase.successRegex).test(output);
    },
  });
  qmpController.abort();
  const qmpEvents = await qmpEventsPromise.catch(() => [] as Array<Record<string, unknown>>);

  await writeFile(serialPath, commandResult.stdout);
  await writeFile(stderrPath, commandResult.stderr);
  await writeFile(legacySerialPath, `${commandResult.stdout}${commandResult.stderr}\n`);
  const adapterPath = await writeAdapterContract(params, plan, caseRoot);

  const output = `${commandResult.stdout}${commandResult.stderr}`;
  const oracle = evaluateOracle({
    plan,
    output,
    exitCode: commandResult.exitCode,
    timedOut: commandResult.timedOut,
    qmpEvents,
    projectRoot: params.projectRoot,
  });
  const status: QemuRunCommandResult["status"] = oracle.ok
    ? "ok"
    : commandResult.timedOut
      ? "timed_out"
      : "failed";
  const result = buildResultJson({
    status,
    statusReason: oracle.reason,
    plan,
    commandResult,
    stdout: commandResult.stdout,
    stderr: commandResult.stderr,
    qmpEvents,
    serialPath,
    stderrPath,
    runRoot: params.evidence.run_root,
    adapterPath,
    oracle,
  });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(legacyResultPath, `${JSON.stringify(result, null, 2)}\n`);

  params.evidence.addArtifactFromPath("trace", serialPath, `qemu serial ${plan.testCase.id}`);
  params.evidence.addArtifactFromPath("qemu-stderr", stderrPath, `qemu stderr ${plan.testCase.id}`);
  params.evidence.addArtifactFromPath("smoke-result", resultPath, `qemu result ${plan.testCase.id}`);
  if (adapterPath) params.evidence.addArtifactFromPath("qemu-adapter", adapterPath, `qemu adapter ${plan.testCase.id}`);

  return {
    status,
    output,
    readyDetected: oracle.successMatched,
    serialPath,
    stderrPath,
    durationMs: commandResult.durationMs,
    smokeResultPath: legacyResultPath,
    resultPath,
    profileId: plan.profile.id,
    caseId: plan.testCase.id,
  };
}

async function resolveRunPlan(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  timeoutMs?: number;
  readyPattern?: string;
  profileId?: string;
  caseId?: string;
}): Promise<QemuRunPlan> {
  const toolchainFile = await resolveToolchainManifestPath({ projectRoot: params.projectRoot });
  if (!existsSync(toolchainFile)) throw new Error("run requires .vos/toolchain.json");
  const manifest: QemuToolchainManifest = JSON.parse(await readFile(toolchainFile, "utf8"));
  const manifestRun = manifestRunSchema.parse(manifest.run ?? {});
  const yaml = parseRunYaml(path.join(params.projectRoot, "spec", "toolchain", "run.yaml"));
  const legacy = !manifestRun.profiles?.length && !manifestRun.cases?.length;
  const profiles = legacy
    ? [legacyProfile(manifestRun, yaml)]
    : manifestRun.profiles!.map((profile) => normalizeProfile(profile, params.evidence.run_root, false));
  const cases = legacy
    ? [legacyCase(manifestRun, yaml, params.readyPattern, params.timeoutMs)]
    : manifestRun.cases!.map((testCase) => normalizeCase(testCase, profiles[0].id, params.readyPattern, params.timeoutMs));
  const profile = profiles.find((candidate) => candidate.id === (params.profileId ?? cases.find((item) => item.id === (params.caseId ?? "smoke"))?.profileId ?? "default"))
    ?? profiles[0];
  const testCase = cases.find((candidate) => candidate.id === (params.caseId ?? "smoke") && candidate.profileId === profile.id)
    ?? cases.find((candidate) => candidate.profileId === profile.id)
    ?? cases[0];
  const qmpEndpoint = endpointPath("qmp", profile.qmp, params.evidence.run_root, testCase.id);
  const hmpEndpoint = endpointPath("hmp", profile.hmp, params.evidence.run_root, testCase.id);
  const gdbEndpoint = profile.gdb.enabled
    ? `tcp:127.0.0.1:${profile.gdb.port ?? 26000}`
    : undefined;
  const commandLine = buildCommandLine(profile, {
    qmpEndpoint,
    hmpEndpoint,
    gdbEndpoint,
  });
  return { profiles, cases, profile, testCase, commandLine, qmpEndpoint, hmpEndpoint, gdbEndpoint };
}

function legacyProfile(run: z.infer<typeof manifestRunSchema>, yaml: LegacyQemuRunYaml): QemuProfile {
  const artifact = run.artifact ?? run.artifacts?.[0] ?? yaml.artifact;
  const args = run.args ? [...run.args] : [...yaml.args];
  return {
    id: "default",
    command: run.command ?? yaml.command,
    args,
    artifacts: artifact ? [artifact] : [],
    timeoutMs: resolveRunTimeoutMs(run.timeout_ms, run.timeout_secs, yaml.timeoutSecs),
    qmp: { enabled: false },
    hmp: { enabled: false },
    gdb: { enabled: false },
    resourceLock: "qemu:default",
    legacyKernelInject: true,
  };
}

function legacyCase(
  run: z.infer<typeof manifestRunSchema>,
  yaml: LegacyQemuRunYaml,
  readyPattern?: string,
  timeoutMs?: number,
): QemuCase {
  const success = readyPattern ?? run.successSignal ?? yaml.successSignal;
  if (!success) throw new Error("run requires success signal");
  return {
    id: "smoke",
    profileId: "default",
    successRegex: success,
    timeoutMs,
    requiredArtifacts: [],
    expectedQmpEvents: [],
  };
}

function normalizeProfile(raw: z.infer<typeof profileSchema>, runRoot: string, legacyKernelInject: boolean): QemuProfile {
  return {
    id: raw.id,
    command: raw.command,
    args: raw.args ?? [],
    cwd: raw.cwd,
    env: raw.env,
    artifacts: raw.artifacts ?? [],
    timeoutMs: resolveRunTimeoutMs(raw.timeout_ms, raw.timeout_secs, 30),
    qmp: normalizeEndpoint(raw.qmp),
    hmp: normalizeEndpoint(raw.hmp),
    gdb: normalizeEndpoint(raw.gdb),
    resourceLock: raw.resource_lock ?? `qemu:${raw.id}`,
    legacyKernelInject,
  };
}

function normalizeCase(
  raw: z.infer<typeof caseSchema>,
  defaultProfileId: string,
  readyPattern?: string,
  timeoutMs?: number,
): QemuCase {
  return {
    id: raw.id,
    profileId: raw.profile ?? defaultProfileId,
    stdin: raw.stdin,
    stdinAfter: raw.stdin_after,
    successRegex: readyPattern ?? raw.success_regex,
    failureRegex: raw.failure_regex,
    exitCode: raw.exit_code,
    timeoutMs: timeoutMs ?? raw.timeout_ms,
    requiredArtifacts: raw.required_artifacts ?? [],
    expectedQmpEvents: raw.expected_qmp_events ?? [],
  };
}

function buildCommandLine(profile: QemuProfile, endpoints: {
  qmpEndpoint?: string;
  hmpEndpoint?: string;
  gdbEndpoint?: string;
}): string[] {
  const args = [...profile.args];
  if (profile.legacyKernelInject && profile.artifacts[0]) {
    const kernelArgIndex = args.indexOf("-kernel");
    if (kernelArgIndex >= 0) {
      if (args[kernelArgIndex + 1] !== profile.artifacts[0]) args.splice(kernelArgIndex + 1, 0, profile.artifacts[0]);
    } else if (!args.includes(`-kernel=${profile.artifacts[0]}`)) {
      args.push("-kernel", profile.artifacts[0]);
    }
  }
  if (endpoints.qmpEndpoint) {
    args.push("-qmp", qemuUnixArg(endpoints.qmpEndpoint));
  }
  if (endpoints.hmpEndpoint) {
    args.push("-monitor", qemuUnixArg(endpoints.hmpEndpoint));
  }
  if (endpoints.gdbEndpoint) {
    const port = endpoints.gdbEndpoint.split(":").at(-1) ?? "26000";
    args.push("-S", "-gdb", `tcp::${port}`);
  }
  return [profile.command, ...args];
}

function normalizeEndpoint(raw: z.infer<typeof endpointSchema>): EndpointConfig {
  if (raw === true) return { enabled: true };
  if (raw === undefined || raw === false) return { enabled: false };
  return { enabled: raw.enabled ?? true, path: raw.path, port: raw.port };
}

function endpointPath(kind: "qmp" | "hmp", endpoint: EndpointConfig, runRoot: string, caseId: string): string | undefined {
  if (!endpoint.enabled) return undefined;
  if (endpoint.port) return `tcp:127.0.0.1:${endpoint.port}`;
  return endpoint.path ?? path.join(runRoot, "artifacts", "run", safeRunArtifactName(caseId), `${kind}.sock`);
}

function qemuUnixArg(endpoint: string): string {
  if (endpoint.startsWith("tcp:")) return endpoint;
  const socketPath = endpoint.startsWith("unix:") ? endpoint.slice("unix:".length) : endpoint;
  return `unix:${socketPath},server=on,wait=off`;
}

async function writeAdapterContract(
  params: { projectRoot: string; evidence: EvidenceWriter },
  plan: QemuRunPlan,
  caseRoot: string,
): Promise<string | undefined> {
  if (!plan.qmpEndpoint && !plan.hmpEndpoint && !plan.gdbEndpoint) return undefined;
  const adapterPath = path.join(caseRoot, "adapter-contract.json");
  await writeFile(adapterPath, `${JSON.stringify({
    profile_id: plan.profile.id,
    case_id: plan.testCase.id,
    qmp_endpoint: plan.qmpEndpoint ? displayEndpoint(plan.qmpEndpoint) : undefined,
    hmp_endpoint: plan.hmpEndpoint ? displayEndpoint(plan.hmpEndpoint) : undefined,
    gdb_endpoint: plan.gdbEndpoint,
    qemu_args: plan.commandLine.slice(1),
    monitor_forbidden_commands: ["quit", "stop", "cont", "system_reset", "system_powerdown", "device_add", "device_del"],
  }, null, 2)}\n`);
  return adapterPath;
}

function evaluateOracle(params: {
  plan: QemuRunPlan;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  qmpEvents: Array<Record<string, unknown>>;
  projectRoot: string;
}): {
  ok: boolean;
  reason: string;
  successMatched: boolean;
  failureMatched: boolean;
  exitCodeMatched: boolean;
  requiredArtifactsPresent: boolean;
  qmpEventsSatisfied: boolean;
} {
  const { testCase } = params.plan;
  const successMatched = testCase.successRegex ? new RegExp(testCase.successRegex).test(params.output) : params.exitCode === 0;
  const failureMatched = testCase.failureRegex ? new RegExp(testCase.failureRegex).test(params.output) : false;
  const exitCodeMatched = testCase.exitCode === undefined || params.exitCode === testCase.exitCode;
  const requiredArtifactsPresent = testCase.requiredArtifacts.every((artifact) => existsSync(path.resolve(params.projectRoot, artifact)));
  const qmpEventNames = new Set(params.qmpEvents.map((event) => typeof event.event === "string" ? event.event : undefined).filter(Boolean));
  const qmpEventsSatisfied = testCase.expectedQmpEvents.every((event) => qmpEventNames.has(event));
  const ok = successMatched && !failureMatched && exitCodeMatched && requiredArtifactsPresent && qmpEventsSatisfied;
  return {
    ok,
    reason: ok ? "oracle_passed" : params.timedOut ? "timed_out" : "oracle_failed",
    successMatched,
    failureMatched,
    exitCodeMatched,
    requiredArtifactsPresent,
    qmpEventsSatisfied,
  };
}

function buildResultJson(params: {
  status: string;
  statusReason: string;
  plan: QemuRunPlan;
  commandResult?: Awaited<ReturnType<typeof runCommand>>;
  stdout: string;
  stderr: string;
  qmpEvents: Array<Record<string, unknown>>;
  serialPath: string;
  stderrPath: string;
  runRoot: string;
  adapterPath?: string;
  oracle?: ReturnType<typeof evaluateOracle>;
}): Record<string, unknown> {
  return {
    status: params.status,
    statusReason: params.statusReason,
    profile_id: params.plan.profile.id,
    case_id: params.plan.testCase.id,
    command: params.plan.commandLine,
    exit_code: params.commandResult?.exitCode,
    signal: params.commandResult?.signal,
    timed_out: params.commandResult?.timedOut ?? false,
    duration_ms: params.commandResult?.durationMs ?? 0,
    serial_log: path.relative(params.runRoot, params.serialPath),
    stderr_log: path.relative(params.runRoot, params.stderrPath),
    adapter_contract: params.adapterPath ? path.relative(params.runRoot, params.adapterPath) : undefined,
    qmp_events: params.qmpEvents,
    oracle: params.oracle
      ? {
        success_matched: params.oracle.successMatched,
        failure_matched: params.oracle.failureMatched,
        exit_code_matched: params.oracle.exitCodeMatched,
        required_artifacts_present: params.oracle.requiredArtifactsPresent,
        qmp_events_satisfied: params.oracle.qmpEventsSatisfied,
      }
      : undefined,
  };
}

async function collectQmpEvents(params: {
  endpoint: string;
  expectedEvents: string[];
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<Array<Record<string, unknown>>> {
  const endpoint = parseEndpoint(params.endpoint);
  const events: Array<Record<string, unknown>> = [];
  const deadline = Date.now() + Math.max(params.timeoutMs, 100);
  while (!params.signal.aborted && Date.now() < deadline) {
    try {
      await collectQmpEventsOnce(endpoint, events, params);
      return events;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  return events;
}

function collectQmpEventsOnce(
  endpoint: { kind: "unix"; path: string } | { kind: "tcp"; host: string; port: number },
  events: Array<Record<string, unknown>>,
  params: { expectedEvents: string[]; signal: AbortSignal; timeoutMs: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = endpoint.kind === "unix"
      ? createConnection(endpoint.path)
      : createConnection({ host: endpoint.host, port: endpoint.port });
    let buffer = "";
    let capabilitiesSent = false;
    const expected = new Set(params.expectedEvents);
    const finish = () => {
      socket.destroy();
      resolve();
    };
    const timer = setTimeout(finish, Math.min(params.timeoutMs, 1000));
    const abort = () => {
      clearTimeout(timer);
      finish();
    };
    params.signal.addEventListener("abort", abort, { once: true });
    socket.on("error", (error) => {
      clearTimeout(timer);
      params.signal.removeEventListener("abort", abort);
      reject(error);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const message of parseQmpMessages(lines.filter(Boolean).join("\n"))) {
        if (message.QMP && !capabilitiesSent) {
          capabilitiesSent = true;
          socket.write(`${JSON.stringify({ execute: "qmp_capabilities" })}\r\n`);
          continue;
        }
        if (typeof message.event === "string") {
          events.push(message);
          if (expected.size > 0 && [...expected].every((event) => events.some((item) => item.event === event))) {
            clearTimeout(timer);
            params.signal.removeEventListener("abort", abort);
            finish();
          }
        }
      }
    });
    socket.on("close", () => {
      clearTimeout(timer);
      params.signal.removeEventListener("abort", abort);
      resolve();
    });
  });
}

export function parseQmpMessages(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const parsed = JSON.parse(line) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      out.push(parsed as Record<string, unknown>);
    }
  }
  return out;
}

function parseRunYaml(runYamlPath: string): LegacyQemuRunYaml {
  if (!existsSync(runYamlPath)) {
    throw new Error(`run requires ${runYamlPath}`);
  }
  const run: LegacyQemuRunYaml = {
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
  if (command) run.command = command;
  const kernelArg = stringValue(rawRun.kernel_arg);
  if (kernelArg) run.args.push(kernelArg);
  run.args.push("-machine", stringValue(rawRun.machine) ?? "virt");
  run.args.push("-cpu", stringValue(rawRun.cpu) ?? "rv64");
  const extraArgs = stringArray(rawRun.extra_args);
  if (extraArgs) run.args.push(...extraArgs);
  const artifact = stringValue(rawRun.kernel_path) ?? stringValue(rawRun.artifact);
  if (artifact) run.artifact = artifact;
  const successSignal = stringValue(rawRun.success_signal) ?? stringValue(rawRun.successSignal);
  if (successSignal) run.successSignal = successSignal;
  const timeoutSecs = numberValue(rawRun.timeout_secs) ?? numberValue(rawRun.timeoutSecs);
  if (timeoutSecs !== undefined && timeoutSecs > 0) run.timeoutSecs = timeoutSecs;
  return run;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stripUnixPrefix(endpoint: string): string {
  return endpoint.startsWith("unix:") ? endpoint.slice("unix:".length) : endpoint;
}

function displayEndpoint(endpoint: string): string {
  if (endpoint.startsWith("tcp:")) return endpoint;
  return `unix:${stripUnixPrefix(endpoint)}`;
}

function parseEndpoint(endpoint: string): { kind: "unix"; path: string } | { kind: "tcp"; host: string; port: number } {
  if (endpoint.startsWith("tcp:")) {
    const [, host = "127.0.0.1", rawPort = "0"] = endpoint.split(":");
    return { kind: "tcp", host, port: Number(rawPort) };
  }
  return { kind: "unix", path: stripUnixPrefix(endpoint) };
}
