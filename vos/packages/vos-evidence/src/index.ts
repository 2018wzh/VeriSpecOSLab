import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import type { EvidenceRef, CommandOutcome, RunId } from "vos-core";

export type RunArtifactKind = "log" | "artifact" | "image" | "report" | "other";
export type RunVisibility = "public" | "agent-only" | "staff-only";

export interface RunArtifact {
  kind: RunArtifactKind;
  path: string;
  size?: number;
  sha256?: string;
  summary?: string;
}

export interface RunManifest {
  run_id: RunId;
  command: string[];
  arguments: string[];
  status: CommandOutcome["status"];
  started_at: string;
  finished_at: string;
  artifacts: RunArtifact[];
  evidence_refs: EvidenceRef[];
  project_root: string;
  project_id?: string;
  user_id?: string;
}

export interface RunEvent {
  run_id: RunId;
  ts: string;
  type:
    | "run_started"
    | "node_started"
    | "stdout_line"
    | "stderr_line"
    | "progress"
    | "node_finished"
    | "run_finished"
    | "run_cancelled";
  node_id?: string;
  visibility?: RunVisibility;
  payload?: Record<string, unknown>;
}

export interface EvidenceWriterOptions {
  projectRoot: string;
  command: string[];
  args?: string[];
  runId?: RunId;
}

export interface EventLogWriter {
  append(event: Omit<RunEvent, "run_id" | "ts">): Promise<void>;
  close(): Promise<void>;
}

export interface ManifestBuilder {
  appendEvent(event: Omit<RunEvent, "run_id" | "ts">): RunEvent;
  addArtifact(artifact: RunArtifact): void;
  addEvidenceRef(ref: EvidenceRef): void;
  finalize(status: CommandOutcome["status"], finishedAt?: string): RunManifest;
  build(): RunManifest;
}

export class EvidenceWriter implements ManifestBuilder {
  public readonly run_id: RunId;
  private readonly projectRoot: string;
  private readonly command: string[];
  private readonly args: string[];
  private readonly startedAt: string;
  private readonly events: RunEvent[] = [];
  private readonly artifacts: RunArtifact[] = [];
  private readonly evidenceRefs: EvidenceRef[] = [];
  private status: CommandOutcome["status"] = "ok";
  private finishedAt: string;

  constructor(options: EvidenceWriterOptions) {
    this.run_id = options.runId ?? (`run-${Date.now().toString(36)}` as RunId);
    this.projectRoot = options.projectRoot;
    this.command = [...options.command];
    this.args = options.args ? [...options.args] : [];
    this.startedAt = new Date().toISOString();
    this.finishedAt = this.startedAt;
  }

  static async create(_options: EvidenceWriterOptions): Promise<EvidenceWriter> {
    return new EvidenceWriter(_options);
  }

  appendEvent(event: Omit<RunEvent, "run_id" | "ts">): RunEvent {
    const full: RunEvent = {
      run_id: this.run_id,
      ts: new Date().toISOString(),
      ...event,
    };
    this.events.push(full);
    return full;
  }

  addArtifact(artifact: RunArtifact): void {
    this.artifacts.push(artifact);
  }

  addEvidenceRef(ref: EvidenceRef): void {
    this.evidenceRefs.push(ref);
  }

  finalize(status: CommandOutcome["status"], finishedAt = new Date().toISOString()): RunManifest {
    this.status = status;
    this.finishedAt = finishedAt;
    return this.buildManifest();
  }

  build(): RunManifest {
    return this.buildManifest();
  }

  private buildManifest(): RunManifest {
    return {
      run_id: this.run_id,
      command: this.command,
      arguments: this.args,
      status: this.status,
      started_at: this.startedAt,
      finished_at: this.finishedAt,
      artifacts: [...this.artifacts],
      evidence_refs: [...this.evidenceRefs],
      project_root: this.projectRoot,
    };
  }
}

export async function appendLogEntry(filePath: string, event: RunEvent): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function collectRunManifestSummaries(projectRoot: string): Promise<Array<{ run_id: string; status: string }>> {
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

export async function collectLatestLogArtifact(projectRoot: string): Promise<string | undefined> {
  const runRoot = path.join(projectRoot, ".vos", "runs");
  if (!existsSync(runRoot)) return undefined;
  const dirs = await readdir(runRoot, { withFileTypes: true });
  const manifestRefs: Array<{ manifestPath: string; mtimeMs: number }> = [];

  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(runRoot, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifestStat = await stat(manifestPath);
      manifestRefs.push({ manifestPath, mtimeMs: manifestStat.mtimeMs });
    } catch {
      continue;
    }
  }

  for (const entry of manifestRefs.sort((left, right) => right.mtimeMs - left.mtimeMs)) {
    const manifestText = await readFile(entry.manifestPath, "utf8");
    const manifest = safeJsonTryParse(manifestText) as { artifacts?: Array<{ path: string; kind?: string }> } | null;
    if (!manifest || !Array.isArray(manifest.artifacts)) continue;
    const candidate = manifest.artifacts
      .map((artifact) => artifact.path)
      .find((value) => value.includes("trace") || value.includes("qemu") || value.includes("log"));
    if (candidate) {
      return path.resolve(projectRoot, candidate);
    }
  }

  return undefined;
}

export async function writeManifest(manifestPath: string, manifest: RunManifest): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function safeJsonTryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
