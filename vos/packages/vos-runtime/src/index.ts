import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseProjectManifest, type ProjectManifest } from "vos-spec";

export interface BuildEvidence {
  target: string;
  status: "passed" | "failed" | "timed_out";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  artifacts: string[];
  submittable: boolean;
  oracle?: {
    outcome: "success" | "failure" | "missing";
    pattern: string;
  };
}

export interface RunEvidence extends BuildEvidence {
  runner: "host" | "qemu" | "hardware";
  humanReview: "not_required" | "pending_human_review";
  board?: string;
  serial?: string;
  workload?: string;
  buildIdentity?: { commitSha?: string };
}

export interface EvidenceBundle {
  cleanHead: boolean;
  submittable: boolean;
  build?: BuildEvidence;
  runs: RunEvidence[];
}

export interface Runner {
  build(target: string): Promise<BuildEvidence>;
  run(target: string): Promise<RunEvidence>;
  collectEvidence(): Promise<EvidenceBundle>;
}

interface TargetCommand {
  program: string;
  args: string[];
  cwd?: string;
  env: string[];
  timeout?: number;
  artifacts: string[];
  board?: string;
  serial?: string;
  workload?: string;
  successPattern?: string;
  failurePattern?: string;
}

export interface StructuredStudentCommand {
  program: string;
  args: string[];
  cwd?: string;
  env: string[];
  timeout?: number;
}

export async function runStructuredStudentCommand(
  projectRoot: string,
  raw: StructuredStudentCommand,
  signal?: AbortSignal,
): Promise<Omit<BuildEvidence, "target" | "artifacts" | "submittable">> {
  const cwd = raw.cwd ?? ".";
  const resolved = path.resolve(projectRoot, cwd);
  const relative = path.relative(projectRoot, resolved);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`structured command cwd escapes project root: ${cwd}`);
  }
  return runStructuredCommand(
    { ...raw, cwd: resolved, artifacts: [] },
    projectRoot,
    signal,
  );
}

export async function readStudentManifest(
  projectRoot: string,
): Promise<{ path: string; manifest: ProjectManifest }> {
  const manifestPath = path.join(projectRoot, "vos.yaml");
  if (!existsSync(manifestPath))
    throw new Error("vos.yaml is missing; run `vos init` first");
  const raw = await readFile(manifestPath, "utf8");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new Error(
      `vos.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return {
      path: manifestPath,
      manifest: parseProjectManifest(
        process.env.VOS_COURSE_ADAPTER === "xv6-spec"
          ? normalizeXv6CourseManifest(parsed)
          : parsed,
      ),
    };
  } catch (error) {
    throw new Error(
      `vos.yaml failed schema validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeXv6CourseManifest(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const project = value as Record<string, unknown>;
  if (project.version !== "vos.project.v1") return value;
  const runners = project.runners;
  if (!runners || typeof runners !== "object" || Array.isArray(runners))
    return value;
  const qemu = (runners as Record<string, unknown>).qemu;
  if (!qemu || typeof qemu !== "object" || Array.isArray(qemu)) return value;
  const qemuRunner = qemu as Record<string, unknown>;
  return {
    ...project,
    runners: {
      ...runners,
      qemu: {
        ...qemuRunner,
        success_pattern: qemuRunner.success_pattern ?? "XV6_BOOT_OK",
        failure_pattern: qemuRunner.failure_pattern ?? "panic",
      },
    },
  };
}

export class ManifestRunner implements Runner {
  private readonly evidence: EvidenceBundle = {
    cleanHead: false,
    submittable: false,
    runs: [],
  };
  private readonly manifestPromise: Promise<{
    path: string;
    manifest: ProjectManifest;
  }>;

  constructor(
    protected readonly projectRoot: string,
    private readonly signal?: AbortSignal,
  ) {
    this.manifestPromise = readStudentManifest(projectRoot);
  }

  async build(target = "build"): Promise<BuildEvidence> {
    const { manifest } = await this.manifestPromise;
    const command = normalizeTarget(manifest.build, this.projectRoot);
    const result = await runStructuredCommand(
      command,
      this.projectRoot,
      this.signal,
    );
    const evidence = {
      target,
      ...result,
      artifacts: command.artifacts,
      submittable: await this.isCleanHead(),
    } satisfies BuildEvidence;
    this.evidence.build = evidence;
    this.evidence.submittable = evidence.submittable;
    return evidence;
  }

  async run(target: string): Promise<RunEvidence> {
    const { manifest } = await this.manifestPromise;
    const runner =
      target === "hardware" ? "hardware" : target === "qemu" ? "qemu" : "host";
    const config =
      runner === "qemu"
        ? manifest.runners.qemu
        : runner === "hardware"
          ? manifest.runners.hardware
          : undefined;
    if (!config) throw new Error(`runner target is not configured: ${target}`);
    const command = normalizeTarget(config, this.projectRoot);
    const result = await runStructuredCommand(
      command,
      this.projectRoot,
      this.signal,
    );
    const submittable = await this.isCleanHead();
    const evidence = {
      target,
      runner,
      ...result,
      artifacts: command.artifacts,
      submittable,
      humanReview:
        runner === "hardware" ? "pending_human_review" : "not_required",
      ...(command.board ? { board: command.board } : {}),
      ...(command.serial ? { serial: command.serial } : {}),
      ...(command.workload ? { workload: command.workload } : {}),
      buildIdentity: { commitSha: await currentHead(this.projectRoot) },
    } satisfies RunEvidence;
    this.evidence.runs.push(evidence);
    this.evidence.submittable =
      (this.evidence.build?.submittable ?? true) && submittable;
    return evidence;
  }

  async check(id: string): Promise<RunEvidence> {
    const { manifest } = await this.manifestPromise;
    const target = manifest.checks[id];
    if (!target)
      throw new Error(`public or contract check is not configured: ${id}`);
    const command = normalizeTarget(target, this.projectRoot);
    const result = await runStructuredCommand(
      command,
      this.projectRoot,
      this.signal,
    );
    const submittable = await this.isCleanHead();
    const evidence = {
      target: id,
      runner: "host",
      ...result,
      artifacts: [],
      submittable,
      humanReview: "not_required",
    } satisfies RunEvidence;
    this.evidence.runs.push(evidence);
    this.evidence.submittable =
      (this.evidence.build?.submittable ?? true) && submittable;
    return evidence;
  }

  async collectEvidence(): Promise<EvidenceBundle> {
    const cleanHead = await this.isCleanHead();
    const hasEvidence =
      Boolean(this.evidence.build) || this.evidence.runs.length > 0;
    const buildPassed =
      !this.evidence.build ||
      (this.evidence.build.status === "passed" &&
        this.evidence.build.submittable);
    this.evidence.cleanHead = cleanHead;
    this.evidence.submittable =
      cleanHead &&
      hasEvidence &&
      buildPassed &&
      this.evidence.runs.every(
        (run) => run.status === "passed" && run.submittable,
      );
    return structuredClone(this.evidence);
  }

  private async isCleanHead(): Promise<boolean> {
    const [tracked, untracked] = await Promise.all([
      gitOutput(this.projectRoot, ["diff", "--name-only", "HEAD"]),
      gitOutput(this.projectRoot, [
        "ls-files",
        "--others",
        "--exclude-standard",
      ]),
    ]);
    return [...tracked, ...untracked].every((file) => isRuntimeArtifact(file));
  }
}

/** Host checks use the same structured command/evidence path as build. */
export class HostRunner extends ManifestRunner {
  override async run(target = "host"): Promise<RunEvidence> {
    const { manifest } = await readStudentManifest(this.projectRoot);
    const checkId =
      target === "host" ? Object.keys(manifest.checks)[0] : target;
    if (!checkId)
      throw new Error(
        "host runner requires at least one public or contract check",
      );
    return this.check(checkId);
  }
}

/** QEMU is deliberately a thin projection of the project manifest. */
export class QemuRunner extends ManifestRunner {
  override async run(_target = "qemu"): Promise<RunEvidence> {
    return super.run("qemu");
  }
}

/** Hardware evidence is always marked pending human review by ManifestRunner. */
export class HardwareRunner extends ManifestRunner {
  override async run(_target = "hardware"): Promise<RunEvidence> {
    return super.run("hardware");
  }
}

function normalizeTarget(
  raw:
    | ProjectManifest["build"]
    | NonNullable<ProjectManifest["runners"]["qemu"]>
    | ProjectManifest["checks"][string],
  projectRoot: string,
): TargetCommand {
  const cwd = raw.cwd ?? ".";
  const resolved = path.resolve(projectRoot, cwd);
  const relative = path.relative(projectRoot, resolved);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`manifest command cwd escapes project root: ${cwd}`);
  }
  return {
    program: raw.program,
    args: raw.args,
    cwd: resolved,
    env: raw.env,
    timeout: raw.timeout,
    artifacts: "artifacts" in raw ? raw.artifacts : [],
    board: "board" in raw ? raw.board : undefined,
    serial: "serial" in raw ? raw.serial : undefined,
    workload: "workload" in raw ? raw.workload : undefined,
    successPattern: "success_pattern" in raw ? raw.success_pattern : undefined,
    failurePattern: "failure_pattern" in raw ? raw.failure_pattern : undefined,
  };
}

async function currentHead(projectRoot: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return exitCode === 0 ? stdout.trim() || undefined : undefined;
}

function isRuntimeArtifact(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  return normalized.startsWith(".vos/");
}

async function gitOutput(
  projectRoot: string,
  args: string[],
): Promise<string[]> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || `git ${args[0]} failed`);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function runStructuredCommand(
  command: TargetCommand,
  projectRoot: string,
  signal?: AbortSignal,
): Promise<Omit<BuildEvidence, "target" | "artifacts" | "submittable">> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
  };
  for (const key of command.env) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  const proc = Bun.spawn([command.program, ...command.args], {
    cwd: command.cwd ?? projectRoot,
    env: { ...env, VOS_PROJECT_ROOT: projectRoot },
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let oracle: BuildEvidence["oracle"];
  const successPattern = command.successPattern
    ? new RegExp(command.successPattern)
    : undefined;
  const failurePattern = command.failurePattern
    ? new RegExp(command.failurePattern)
    : undefined;
  let combinedOutput = "";
  const timeout = command.timeout;
  const abort = () => {
    forceKillTimer ??= terminateProcessTree(proc);
  };
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (timeout !== undefined) {
    timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, timeout);
  }
  const started = Date.now();
  const inspectOutput = (text: string) => {
    if (oracle || text.length === 0) return;
    combinedOutput += text;
    if (failurePattern?.test(combinedOutput)) {
      oracle = { outcome: "failure", pattern: command.failurePattern! };
      if (timer) clearTimeout(timer);
      timer = undefined;
      abort();
      return;
    }
    if (successPattern?.test(combinedOutput)) {
      oracle = { outcome: "success", pattern: command.successPattern! };
      if (timer) clearTimeout(timer);
      timer = undefined;
      abort();
    }
  };
  const [stdout, stderr, exitCode] = await Promise.all([
    readCommandStream(proc.stdout, inspectOutput),
    readCommandStream(proc.stderr, inspectOutput),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  signal?.removeEventListener("abort", abort);
  if (!oracle && successPattern) {
    oracle = { outcome: "missing", pattern: command.successPattern! };
  }
  return {
    status: timedOut
      ? "timed_out"
      : oracle?.outcome === "failure" || oracle?.outcome === "missing"
        ? "failed"
        : oracle?.outcome === "success" || exitCode === 0
          ? "passed"
          : "failed",
    exitCode,
    stdout,
    stderr,
    durationMs: Date.now() - started,
    ...(oracle ? { oracle } : {}),
  };
}

function terminateProcessTree(
  proc: Bun.Subprocess,
): ReturnType<typeof setTimeout> {
  if (process.platform === "win32") {
    if (!spawnWindowsTreeKill(proc.pid)) proc.kill("SIGTERM");
  } else {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }
  }
  return setTimeout(() => {
    if (process.platform === "win32") {
      if (!spawnWindowsTreeKill(proc.pid)) proc.kill("SIGKILL");
      return;
    }
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }, 1_000);
}

function spawnWindowsTreeKill(pid: number): boolean {
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR;
  const taskkill = windowsRoot
    ? path.join(windowsRoot, "System32", "taskkill.exe")
    : "taskkill.exe";
  try {
    const killer = Bun.spawnSync([taskkill, "/PID", String(pid), "/T", "/F"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return killer.exitCode === 0;
  } catch {
    return false;
  }
}

async function readCommandStream(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    output += text;
    onText(text);
  }
  const tail = decoder.decode();
  output += tail;
  onText(tail);
  return output;
}
