import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isReasoningEffort, type ReasoningEffort } from "../config.ts";
import type { AgentGuidanceFileRef, StoredThread, ThreadSummary, TodoItem } from "./types.ts";
import { THREAD_SCHEMA_VERSION } from "./types.ts";
import { emptyThreadUsage, validateStoredThreadUsage } from "./usage.ts";

const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface CreateThreadInput {
  prompt: string;
  model: string;
  mode?: string;
  reasoningEffort?: ReasoningEffort;
  guidanceFiles?: readonly AgentGuidanceFileRef[];
  todos?: readonly TodoItem[];
}

export interface ThreadStoreOptions {
  workspaceRoot?: string;
  stateDir?: string;
  now?: () => Date;
  idGenerator?: () => string;
}

export type ThreadArchiveFilter = "active" | "archived" | "all";

export interface ListThreadsOptions {
  archived?: ThreadArchiveFilter;
}

export class ThreadStore {
  private readonly workspaceRoot: string;
  private readonly stateDir: string;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(opts: ThreadStoreOptions = {}) {
    this.workspaceRoot = resolve(opts.workspaceRoot ?? process.cwd());
    this.stateDir = resolve(
      opts.stateDir ?? process.env.VOS_AGENT_HOME ?? process.env.STARS_HOME ?? join(homedir(), ".vos-agent"),
    );
    this.now = opts.now ?? (() => new Date());
    this.idGenerator = opts.idGenerator ?? (() => `VOS-${randomUUID()}`);
  }

  create(input: CreateThreadInput): StoredThread {
    const now = this.now().toISOString();
    const id = this.idGenerator();
    validateThreadId(id);
    return {
      schemaVersion: THREAD_SCHEMA_VERSION,
      id,
      title: titleFromPrompt(input.prompt),
      createdAt: now,
      updatedAt: now,
      workspaceRoot: this.workspaceRoot,
      model: input.model,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      guidanceFiles: [...(input.guidanceFiles ?? [])],
      messages: [],
      todos: [...(input.todos ?? [])],
      usage: emptyThreadUsage(),
    };
  }

  load(id: string): StoredThread {
    const path = this.pathFor(id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new Error(`Error loading thread "${id}": ${(e as Error).message}`);
    }
    return validateStoredThread(parsed, path);
  }

  save(thread: StoredThread): void {
    validateThreadId(thread.id);
    const path = this.pathFor(thread.id);
    const dir = join(this.stateDir, "threads");
    mkdirSync(dir, { recursive: true });
    thread.updatedAt = this.now().toISOString();
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(thread, null, 2)}\n`, "utf8");
    renameSync(tmpPath, path);
  }

  archive(id: string): StoredThread {
    const thread = this.load(id);
    this.assertThreadBelongsToWorkspace(thread, "archive");
    if (thread.archivedAt) {
      return thread;
    }
    thread.archivedAt = this.now().toISOString();
    this.save(thread);
    return thread;
  }

  fork(id: string): StoredThread {
    const source = this.load(id);
    this.assertThreadBelongsToWorkspace(source, "fork");
    const fork = this.create({
      prompt: `Fork of ${source.title}`,
      model: source.model,
      ...(source.mode ? { mode: source.mode } : {}),
      ...(source.reasoningEffort ? { reasoningEffort: source.reasoningEffort } : {}),
      guidanceFiles: cloneJson(source.guidanceFiles),
      todos: cloneJson(source.todos),
    });
    fork.messages = cloneJson(source.messages);
    fork.usage = cloneJson(source.usage);
    this.save(fork);
    return fork;
  }

  list(opts: ListThreadsOptions = {}): ThreadSummary[] {
    const archived = opts.archived ?? "active";
    const dir = join(this.stateDir, "threads");
    if (!existsSync(dir)) return [];
    const summaries: ThreadSummary[] = [];
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      const id = entry.slice(0, -".json".length);
      try {
        const thread = this.load(id);
        if (archived === "active" && thread.archivedAt) continue;
        if (archived === "archived" && !thread.archivedAt) continue;
        summaries.push({
          id: thread.id,
          title: thread.title,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          workspaceRoot: thread.workspaceRoot,
          model: thread.model,
          ...(thread.mode ? { mode: thread.mode } : {}),
          ...(thread.reasoningEffort ? { reasoningEffort: thread.reasoningEffort } : {}),
          ...(thread.archivedAt ? { archivedAt: thread.archivedAt } : {}),
          messageCount: thread.messages.length,
          usage: cloneJson(thread.usage),
          path: this.pathFor(thread.id),
        });
      } catch {
        // Ignore corrupt thread files when listing; loading by ID still reports details.
      }
    }
    return summaries.sort((a, b) => {
      const byUpdatedAt = b.updatedAt.localeCompare(a.updatedAt);
      if (byUpdatedAt !== 0) return byUpdatedAt;
      const byCreatedAt = b.createdAt.localeCompare(a.createdAt);
      if (byCreatedAt !== 0) return byCreatedAt;
      return a.id.localeCompare(b.id);
    });
  }

  pathFor(id: string): string {
    validateThreadId(id);
    return join(this.stateDir, "threads", `${id}.json`);
  }

  private assertThreadBelongsToWorkspace(thread: StoredThread, action: string): void {
    if (resolve(thread.workspaceRoot) !== this.workspaceRoot) {
      throw new Error(
        `cannot ${action} thread "${thread.id}": thread belongs to workspace "${thread.workspaceRoot}", not "${this.workspaceRoot}"`,
      );
    }
  }
}

export function createThreadStore(opts: ThreadStoreOptions = {}): ThreadStore {
  return new ThreadStore(opts);
}

function validateThreadId(id: string): void {
  if (!THREAD_ID_PATTERN.test(id)) {
    throw new Error(`invalid thread id: ${id}`);
  }
}

function titleFromPrompt(prompt: string): string {
  const oneLine = prompt.trim().replace(/\s+/g, " ");
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine || "Untitled";
}

function validateStoredThread(value: unknown, path: string): StoredThread {
  if (!value || typeof value !== "object") {
    throw new Error(`invalid thread file ${path}: expected object`);
  }
  const thread = value as StoredThread;
  if (thread.schemaVersion !== THREAD_SCHEMA_VERSION) {
    throw new Error(`invalid thread file ${path}: unsupported schema version`);
  }
  for (const field of [
    "id",
    "title",
    "createdAt",
    "updatedAt",
    "workspaceRoot",
    "model",
  ] as const) {
    if (typeof thread[field] !== "string" || thread[field].trim().length === 0) {
      throw new Error(`invalid thread file ${path}: ${field} must be a non-empty string`);
    }
  }
  if (thread.mode !== undefined && typeof thread.mode !== "string") {
    throw new Error(`invalid thread file ${path}: mode must be a string`);
  }
  if (thread.archivedAt !== undefined) {
    if (typeof thread.archivedAt !== "string" || thread.archivedAt.trim().length === 0) {
      throw new Error(`invalid thread file ${path}: archivedAt must be a non-empty string`);
    }
  }
  if (thread.reasoningEffort !== undefined) {
    if (
      typeof thread.reasoningEffort !== "string" ||
      !isReasoningEffort(thread.reasoningEffort)
    ) {
      throw new Error(`invalid thread file ${path}: reasoningEffort is invalid`);
    }
  }
  validateThreadId(thread.id);
  if (!Array.isArray(thread.messages)) {
    throw new Error(`invalid thread file ${path}: messages must be an array`);
  }
  if (!Array.isArray(thread.todos)) {
    thread.todos = [];
  }
  if (!Array.isArray(thread.guidanceFiles)) {
    thread.guidanceFiles = [];
  }
  thread.usage = validateStoredThreadUsage(thread.usage, path);
  return thread;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
