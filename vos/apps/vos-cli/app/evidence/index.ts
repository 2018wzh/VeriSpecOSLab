import { mkdir } from "node:fs/promises";
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { CommandStatus } from "../types.ts";
import type { RunArtifact, EvidenceRef, RunManifest } from "./manifest.ts";
import { createRunEvent, eventToLine, type RunEvent } from "./events.ts";

export interface EvidenceWriterOptions {
  projectRoot: string;
  evidenceDir: string;
  command: string[];
  args: string[];
  gitRev?: string;
  specHash?: string;
  projectionVersion?: string;
}

export class EvidenceWriter {
  private readonly projectRoot: string;
  private readonly evidenceDir: string;
  private readonly command: string[];
  private readonly args: string[];
  private readonly runId: string;
  private readonly runDir: string;
  private readonly eventsPath: string;
  private readonly manifestPath: string;
  private readonly artifactsRoot: string;
  private readonly startAt = new Date().toISOString();
  private gitRev?: string;
  private specHash?: string;
  private projectionVersion?: string;
  private artifacts: RunArtifact[] = [];
  private evidenceRefs: EvidenceRef[] = [];
  private started = false;

  constructor(options: EvidenceWriterOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.evidenceDir = path.resolve(this.projectRoot, options.evidenceDir);
    this.command = [...options.command];
    this.args = [...options.args];
    this.runId = randomRunId();
    this.runDir = path.join(this.evidenceDir, "runs", this.runId);
    this.eventsPath = path.join(this.runDir, "events.jsonl");
    this.manifestPath = path.join(this.runDir, "manifest.json");
    this.artifactsRoot = path.join(this.runDir, "artifacts");
    this.gitRev = options.gitRev;
    this.specHash = options.specHash;
    this.projectionVersion = options.projectionVersion;
  }

  static async create(options: EvidenceWriterOptions): Promise<EvidenceWriter> {
    const writer = new EvidenceWriter(options);
    await writer.init();
    return writer;
  }

  get run_id(): string {
    return this.runId;
  }

  get run_root(): string {
    return this.runDir;
  }

  get artifacts_root(): string {
    return this.artifactsRoot;
  }

  async init(): Promise<void> {
    if (this.started) return;
    await mkdir(this.runDir, { recursive: true });
    await mkdir(this.artifactsRoot, { recursive: true });
    appendFileSync(this.eventsPath, eventToLine(createRunEvent(this.runId, "run_started", {
      command: this.command,
      arguments: this.args,
      project_root: this.projectRoot,
    })));
    await this.writeManifest({
      status: "partial",
      finishedAt: this.startAt,
    });
    this.started = true;
  }

  async appendEvent(event: Omit<RunEvent, "run_id" | "ts">): Promise<void> {
    const fullEvent = {
      run_id: this.runId,
      ts: new Date().toISOString(),
      ...event,
    } satisfies RunEvent;
    appendFileSync(this.eventsPath, eventToLine(fullEvent));
  }

  addArtifact(kind: string, relativePath: string, summary?: string): string {
    const absolute = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(this.projectRoot, relativePath);
    const artifact: RunArtifact = {
      kind,
      path: path.relative(this.projectRoot, absolute),
      summary,
    };
    this.artifacts.push(artifact);
    return absolute;
  }

  addArtifactFromPath(kind: string, absolutePath: string, summary?: string): string {
    const artifact: RunArtifact = {
      kind,
      path: path.relative(this.projectRoot, absolutePath),
      summary,
    };
    this.artifacts.push(artifact);
    return absolutePath;
  }

  addEvidenceRef(id: string, kind: string, pathValue: string): void {
    this.evidenceRefs.push({ id, kind, path: pathValue });
  }

  async markNodeStarted(nodeId: string): Promise<void> {
    await this.appendEvent({ type: "node_started", node_id: nodeId, payload: { nodeId } });
  }

  async markNodeFinished(nodeId: string, status: string): Promise<void> {
    await this.appendEvent({ type: "node_finished", node_id: nodeId, payload: { status } });
  }

  async writeLog(kind: string, name: string, content: string): Promise<string> {
    const filePath = path.join(this.artifactsRoot, kind, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await Bun.write(filePath, content);
    this.addArtifact(kind, filePath);
    return filePath;
  }

  async finalize(status: CommandStatus, options: { finishedAt?: string; message?: string } = {}): Promise<RunManifest> {
    const finishedAt = options.finishedAt ?? new Date().toISOString();
    const manifest = await this.writeManifest({ status, finishedAt, message: options.message });
    await this.appendEvent({
      type: status === "cancelled" ? "run_cancelled" : "run_finished",
      payload: {
        status,
      },
    });
    return manifest;
  }

  async writeManifest(payload: {
    status: CommandStatus;
    finishedAt: string;
    message?: string;
  }): Promise<RunManifest> {
    const manifest: RunManifest = {
      run_id: this.runId,
      command: this.command,
      arguments: this.args,
      git_rev: this.gitRev,
      spec_hash: this.specHash,
      projection_version: this.projectionVersion,
      started_at: this.startAt,
      finished_at: payload.finishedAt,
      status: payload.status,
      artifacts: [...this.artifacts],
      evidence_refs: [...this.evidenceRefs],
      project_root: this.projectRoot,
    };
    if (payload.message) {
      (manifest as unknown as Record<string, unknown>).message = payload.message;
    }
    await Bun.write(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  }
}

function randomRunId(): string {
  const random = Math.random().toString(16).slice(2, 10);
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 15)}-${random}`;
}
