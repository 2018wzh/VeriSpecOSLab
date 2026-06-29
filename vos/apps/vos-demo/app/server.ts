import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAgentTask, type AgentTaskRequest, type AgentTaskResult } from "vos-agent/headless";
import {
  buildAskDemoTask,
  buildDebugDemoTask,
  collectDebugArtifactExcerpts,
} from "./demo-context.ts";
import {
  executeVosCommand,
  type BaseCommandResult,
  type CoreRunEvent,
  type ExecuteVosCommandOptions,
  type VosCommand,
} from "vos-core";

export type DemoExecutor = (
  command: VosCommand,
  options: ExecuteVosCommandOptions,
) => Promise<BaseCommandResult>;
export type DemoReplRunner = (request: AgentTaskRequest) => Promise<AgentTaskResult>;

export interface DemoServerOptions {
  projectRoot: string;
  accessCodes: string[];
  dbPath?: string;
  executor?: DemoExecutor;
  replRunner?: DemoReplRunner;
  dailyLimit?: number;
  sessionLimit?: number;
}

type DemoRunKind = "ask" | "debug";
type DemoRunStatus = "running" | "passed" | "failed" | "cancelled" | "timed_out" | "validation_failed" | "policy_blocked" | "agent_output_error" | "partial" | "ok" | "not_implemented" | "planned";

interface RunRecord {
  id: string;
  kind: DemoRunKind;
  status: DemoRunStatus;
  runId?: string;
  question?: string;
  targetRunId?: string;
  threadId?: string;
  result?: BaseCommandResult;
  error?: string;
  events: CoreRunEvent[];
  subscribers: Set<(event: CoreRunEvent) => void>;
}

interface StoredVisualization {
  id: string;
  demo_run_id: string;
  run_id: string;
  path: string;
  title: string;
}

const DEFAULT_DAILY_LIMIT = 200;
const DEFAULT_SESSION_LIMIT = 50;
const SESSION_COOKIE = "vos_demo_session";
const WEB_DIST = path.resolve(import.meta.dir, "..", "web", "dist");

export function createDemoHandler(options: DemoServerOptions): (request: Request) => Promise<Response> {
  const projectRoot = path.resolve(options.projectRoot);
  const db = openDb(options.dbPath ?? path.join(projectRoot, ".vos", "demo.sqlite"));
  const accessCodes = new Set(options.accessCodes.filter(Boolean));
  const executor = options.executor ?? executeVosCommand;
  const replRunner = options.replRunner ?? runAgentTask;
  const dailyLimit = options.dailyLimit ?? readLimitEnv("VOS_DEMO_DAILY_LIMIT", DEFAULT_DAILY_LIMIT);
  const sessionLimit = options.sessionLimit ?? readLimitEnv("VOS_DEMO_SESSION_LIMIT", DEFAULT_SESSION_LIMIT);
  const runs = new Map<string, RunRecord>();

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return cors(null, 204);
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "vos-demo" });
      }
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
        return await staticResponse(url.pathname);
      }
      if (request.method === "POST" && url.pathname === "/api/demo/login") {
        const body = await readJson(request);
        const code = typeof body.accessCode === "string" ? body.accessCode.trim() : "";
        if (!accessCodes.has(code)) return json({ error: "invalid_access_code" }, 401);
        const sessionId = randomUUID();
        db.query("insert into sessions (id, code_hash, created_at, ask_count) values (?, ?, ?, 0)")
          .run(sessionId, hash(code), new Date().toISOString());
        return json(sessionPayload(projectRoot, sessionId, dailyLimit, sessionLimit, db), 200, {
          "Set-Cookie": `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
        });
      }

      const sessionId = sessionFromCookie(request);
      const session = sessionId ? db.query("select id from sessions where id = ?").get(sessionId) as { id: string } | null : null;
      if (!session) return json({ error: "not_authenticated" }, 401);

      if (request.method === "GET" && url.pathname === "/api/demo/session") {
        return json(sessionPayload(projectRoot, session.id, dailyLimit, sessionLimit, db));
      }
      if (request.method === "GET" && url.pathname === "/api/demo/debug-targets") {
        return json({ targets: await debugTargets(projectRoot) });
      }
      if (request.method === "POST" && url.pathname === "/api/demo/ask") {
        const quota = consumeQuota(db, session.id, dailyLimit, sessionLimit);
        if (!quota.ok) return json({ error: quota.reason }, 429);
        const body = await readJson(request);
        const question = typeof body.question === "string" ? body.question.trim() : "";
        if (!question) return json({ error: "question_required" }, 400);
        const scope = typeof body.scope === "string" && body.scope.trim() ? body.scope.trim() : undefined;
        const threadId = typeof body.threadId === "string" && body.threadId.trim() ? body.threadId.trim() : undefined;
        const run = createRun(runs, "ask", { question, threadId });
        void runReplTurn(run, {
          projectRoot,
          replRunner,
          taskKind: "knowledgebase_qa",
          requestedScope: scope,
          task: buildAskDemoTask(question),
          context: {
            mode: "ask_repl",
            scope,
            demo_flow: {
              audience: "public demo viewer",
              expected_sections: ["project context", "design goal", "citations", "suggested next steps"],
            },
          },
          command: ["agent", "ask", "--repl"],
          db,
        });
        return json({ id: run.id, status: run.status }, 202);
      }
      if (request.method === "POST" && url.pathname === "/api/demo/debug") {
        const quota = consumeQuota(db, session.id, dailyLimit, sessionLimit);
        if (!quota.ok) return json({ error: quota.reason }, 429);
        const body = await readJson(request);
        const runId = typeof body.runId === "string" ? body.runId.trim() : "";
        const message = typeof body.message === "string" && body.message.trim()
          ? body.message.trim()
          : runId ? `Debug run ${runId}.` : "Start debug REPL.";
        const threadId = typeof body.threadId === "string" && body.threadId.trim() ? body.threadId.trim() : undefined;
        const run = createRun(runs, "debug", { targetRunId: runId || undefined, question: message, threadId });
        const targetRun = runId ? await loadRunManifest(projectRoot, runId) : undefined;
        void runReplTurn(run, {
          projectRoot,
          replRunner,
          taskKind: "debug",
          requestedScope: "agent.debug",
          task: buildDebugDemoTask(message),
          context: {
            mode: "debug_repl",
            target_run_id: runId || undefined,
            target_run: publicRunSummary(targetRun),
            artifact_excerpts: runId
              ? await collectDebugArtifactExcerpts(
                projectRoot,
                runId,
                Array.isArray(targetRun?.artifacts) ? targetRun.artifacts as Array<{ kind?: unknown; path?: unknown }> : [],
              )
              : [],
            demo_flow: {
              audience: "public demo viewer",
              expected_sections: ["failure overview", "evidence chain", "timeline", "GDB/trace status", "visualization", "next commands"],
            },
          },
          evidenceRefs: runId ? [runId] : undefined,
          command: runId ? ["agent", "debug", "--repl", "--run", runId] : ["agent", "debug", "--repl"],
          db,
        });
        return json({ id: run.id, status: run.status }, 202);
      }

      const runMatch = url.pathname.match(/^\/api\/demo\/runs\/([^/]+)(?:\/events)?$/);
      if (runMatch && request.method === "GET") {
        const run = runs.get(decodeURIComponent(runMatch[1]));
        if (!run) return json({ error: "not_found" }, 404);
        if (url.pathname.endsWith("/events")) return sse(run);
        return json(await runPayload(projectRoot, db, run));
      }

      const vizMatch = url.pathname.match(/^\/api\/demo\/visualizations\/([A-Za-z0-9_-]+)$/);
      if (vizMatch && request.method === "GET") {
        return await visualizationResponse(projectRoot, db, vizMatch[1]);
      }

      return json({ error: "not_found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "unknown_error" }, 500);
    }
  };
}

async function staticResponse(urlPath: string): Promise<Response> {
  const relativePath = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
  if (relativePath.includes("\0") || relativePath.split(/[\\/]+/).includes("..")) return json({ error: "not_found" }, 404);
  const filePath = path.resolve(WEB_DIST, relativePath);
  if (!filePath.startsWith(`${WEB_DIST}${path.sep}`) && filePath !== WEB_DIST) return json({ error: "not_found" }, 404);
  if (!existsSync(filePath)) {
    if (urlPath !== "/" && existsSync(path.join(WEB_DIST, "index.html"))) {
      return staticResponse("/");
    }
    return html("<!doctype html><meta charset=\"utf-8\"><title>VOS Demo</title><body><p>VOS demo frontend is not built. Run <code>bun run build</code> in <code>vos/apps/vos-demo</code>.</p></body>");
  }
  return new Response(Bun.file(filePath), { headers: { "Content-Type": contentType(filePath), ...corsHeaders() } });
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function openDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.exec(`
    create table if not exists sessions (
      id text primary key,
      code_hash text not null,
      created_at text not null,
      ask_count integer not null default 0
    );
    create table if not exists visualizations (
      id text primary key,
      demo_run_id text not null,
      run_id text not null,
      path text not null,
      title text not null
    );
  `);
  return db;
}

function createRun(
  runs: Map<string, RunRecord>,
  kind: DemoRunKind,
  values: { question?: string; targetRunId?: string; threadId?: string },
): RunRecord {
  const run: RunRecord = {
    id: randomUUID(),
    kind,
    status: "running",
    question: values.question,
    targetRunId: values.targetRunId,
    threadId: values.threadId,
    events: [],
    subscribers: new Set(),
  };
  runs.set(run.id, run);
  return run;
}

async function runReplTurn(
  run: RunRecord,
  params: {
    projectRoot: string;
    replRunner: DemoReplRunner;
    taskKind: "knowledgebase_qa" | "debug";
    requestedScope?: string;
    task: string;
    context: unknown;
    evidenceRefs?: string[];
    command: string[];
    db: Database;
  },
): Promise<void> {
  try {
    pushRunEvent(run, "progress", { stage: `${run.kind} repl`, message: "waiting for agent" });
    const result = await params.replRunner({
      projectRoot: params.projectRoot,
      taskKind: params.taskKind,
      requestedScope: params.requestedScope,
      task: params.task,
      context: params.context,
      evidenceRefs: params.evidenceRefs,
      threadId: run.threadId,
      courseMode: true,
      env: await projectEnv(params.projectRoot),
      onEvent: async (event) => pushRunEvent(run, "progress", { agent_event: event.type }),
    });
    run.threadId = result.threadId;
    const core = await replResultToCommandResult(params.projectRoot, run, params.command, result.structuredOutput);
    run.result = core;
    run.runId = core.run_id;
    run.status = "passed";
    recordVisualizations(params.projectRoot, params.db, run, core);
    pushRunEvent(run, "run_finished", { status: "passed", thread_id: run.threadId });
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : "unknown_error";
    pushRunEvent(run, "run_finished", { status: "failed", message: run.error });
  }
}

async function replResultToCommandResult(
  projectRoot: string,
  run: RunRecord,
  command: string[],
  structuredOutput: unknown,
): Promise<BaseCommandResult> {
  const started = new Date().toISOString();
  const details: Record<string, unknown> = run.kind === "ask"
    ? { answer: structuredOutput, repl: true, threadId: run.threadId }
    : { debug: structuredOutput, repl: true, threadId: run.threadId };
  const artifacts: BaseCommandResult["artifacts"] = [];
  if (isRecord(structuredOutput) && typeof structuredOutput.visualization_html === "string") {
    const relative = path.join(".vos", "runs", run.id, "artifacts", `agent-${run.kind}`, "visualization.html");
    const full = path.join(projectRoot, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, structuredOutput.visualization_html);
    details.visualization = relative;
    artifacts.push({ kind: `agent-${run.kind}-visualization`, path: relative });
  }
  return {
    ok: true,
    run_id: run.id,
    command,
    status: "passed",
    artifacts,
    evidence_refs: [],
    started_at: started,
    finished_at: new Date().toISOString(),
    details,
  };
}

async function runCommand(
  run: RunRecord,
  params: {
    projectRoot: string;
    executor: DemoExecutor;
    command: VosCommand;
    db: Database;
  },
): Promise<void> {
  try {
    const result = await params.executor(params.command, {
      projectRoot: params.projectRoot,
      progress: "never",
      onEvent: (event) => {
        const sanitized = sanitizeEvent(event);
        if (!sanitized) return;
        run.events.push(sanitized);
        if (event.type === "run_started" && typeof event.run_id === "string") run.runId = event.run_id;
        for (const subscriber of run.subscribers) subscriber(sanitized);
      },
    });
    run.result = result;
    run.runId = result.run_id;
    run.status = result.status;
    recordVisualizations(params.projectRoot, params.db, run, result);
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : "unknown_error";
  }
}

function pushRunEvent(run: RunRecord, type: CoreRunEvent["type"], payload: Record<string, unknown>): void {
  const event: CoreRunEvent = {
    run_id: run.runId ?? run.id,
    ts: new Date().toISOString(),
    type,
    visibility: "public",
    payload,
  };
  run.events.push(event);
  for (const subscriber of run.subscribers) subscriber(event);
}

function recordVisualizations(projectRoot: string, db: Database, run: RunRecord, result: BaseCommandResult): void {
  const candidates = [
    typeof result.details?.visualization === "string" ? result.details.visualization : undefined,
    ...result.artifacts
      .filter((artifact) => artifact.kind.includes("visualization"))
      .map((artifact) => artifact.path),
  ].filter((value): value is string => Boolean(value));
  const seen = new Set<string>();
  for (const relativePath of candidates) {
    if (seen.has(relativePath) || !isSafeArtifactPath(projectRoot, result.run_id, relativePath)) continue;
    seen.add(relativePath);
    db.query("insert or ignore into visualizations (id, demo_run_id, run_id, path, title) values (?, ?, ?, ?, ?)")
      .run(randomUUID(), run.id, result.run_id, relativePath, run.kind === "debug" ? "Debug visualization" : "Visualization");
  }
}

async function runPayload(projectRoot: string, db: Database, run: RunRecord): Promise<Record<string, unknown>> {
  const details = run.result?.details ?? {};
  const answer = run.kind === "ask" ? details.answer : undefined;
  const debug = run.kind === "debug" ? details.debug : undefined;
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    runId: run.runId ?? run.result?.run_id,
    threadId: run.threadId,
    question: run.question,
    targetRunId: run.targetRunId,
    answer,
    debug,
    error: run.error,
    events: run.events,
    artifacts: run.result?.artifacts ?? [],
    visualizations: visualizationsForRun(db, run.id),
    project: await projectSummary(projectRoot),
  };
}

async function loadRunManifest(projectRoot: string, runId: string): Promise<Record<string, unknown> | undefined> {
  if (runId.includes("\0") || runId.includes("/") || runId.includes("\\")) return undefined;
  const manifestPath = path.join(projectRoot, ".vos", "runs", runId, "manifest.json");
  if (!existsSync(manifestPath)) return undefined;
  return JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
}

function publicRunSummary(manifest: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!manifest) return undefined;
  return {
    run_id: manifest.run_id,
    command: manifest.command,
    status: manifest.status,
    started_at: manifest.started_at,
    finished_at: manifest.finished_at,
    artifacts_count: Array.isArray(manifest.artifacts) ? manifest.artifacts.length : 0,
    evidence_refs_count: Array.isArray(manifest.evidence_refs) ? manifest.evidence_refs.length : 0,
  };
}

function visualizationsForRun(db: Database, demoRunId: string): StoredVisualization[] {
  return db.query("select id, demo_run_id, run_id, path, title from visualizations where demo_run_id = ?")
    .all(demoRunId) as StoredVisualization[];
}

async function visualizationResponse(projectRoot: string, db: Database, id: string): Promise<Response> {
  const row = db.query("select id, demo_run_id, run_id, path, title from visualizations where id = ?")
    .get(id) as StoredVisualization | null;
  if (!row || !isSafeArtifactPath(projectRoot, row.run_id, row.path)) return json({ error: "not_found" }, 404);
  const full = path.resolve(projectRoot, row.path);
  return new Response(await readFile(full), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: https:; font-src https:; connect-src https:; frame-ancestors 'self'",
      ...corsHeaders(),
    },
  });
}

function isSafeArtifactPath(projectRoot: string, runId: string, relativePath: string): boolean {
  if (relativePath.includes("\0") || path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) return false;
  const normalized = relativePath.replace(/\\/g, "/");
  const allowedPrefix = `.vos/runs/${runId}/artifacts/`;
  if (!normalized.startsWith(allowedPrefix)) return false;
  const full = path.resolve(projectRoot, normalized);
  const runRoot = path.resolve(projectRoot, ".vos", "runs", runId);
  return full.startsWith(`${runRoot}${path.sep}`) && existsSync(full);
}

async function debugTargets(projectRoot: string): Promise<Array<Record<string, unknown>>> {
  const runsRoot = path.join(projectRoot, ".vos", "runs");
  if (!existsSync(runsRoot)) return [];
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const out: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(runsRoot, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
      out.push({
        runId: entry.name,
        status: manifest.status,
        command: manifest.command,
        artifactsCount: Array.isArray(manifest.artifacts) ? manifest.artifacts.length : 0,
        startedAt: manifest.started_at,
        finishedAt: manifest.finished_at,
      });
    } catch {
      // Ignore corrupt historical artifacts; the demo is a viewer, not a repair tool.
    }
  }
  return out.sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? ""))).slice(0, 50);
}

async function projectSummary(projectRoot: string): Promise<Record<string, unknown>> {
  const projectPath = path.join(projectRoot, ".vos", "project.yaml");
  const textValue = existsSync(projectPath) ? await readFile(projectPath, "utf8") : "";
  return {
    projectRoot,
    projectId: textValue.match(/^project_id:\s*(.+)$/m)?.[1]?.trim() ?? "local-project",
    currentStage: textValue.match(/^current_stage:\s*(.+)$/m)?.[1]?.trim() ?? "unknown",
  };
}

async function projectEnv(projectRoot: string): Promise<Record<string, string | undefined>> {
  const env = { ...process.env };
  const envPath = path.join(projectRoot, ".env");
  if (existsSync(envPath)) {
    const textValue = await readFile(envPath, "utf8");
    for (const line of textValue.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match) continue;
      env[match[1]] ??= unquoteEnv(match[2].trim());
    }
  }
  const config = await readAgentToml(projectRoot);
  if (config?.provider === "deepseek") {
    if (!env.DEEPSEEK_API_KEY && config.authEnv) env.DEEPSEEK_API_KEY = env[config.authEnv];
    if (config.baseUrl) env.DEEPSEEK_BASE_URL = config.baseUrl;
  }
  if (config?.provider === "openai-compatible") {
    if (!env.OPENAI_COMPATIBLE_API_KEY && config.authEnv) env.OPENAI_COMPATIBLE_API_KEY = env[config.authEnv];
    if (config.baseUrl) env.OPENAI_COMPATIBLE_BASE_URL = config.baseUrl;
  }
  if (config?.provider === "openai") {
    if (!env.OPENAI_API_KEY && config.authEnv) env.OPENAI_API_KEY = env[config.authEnv];
    if (config.baseUrl) env.OPENAI_BASE_URL = config.baseUrl;
  }
  if (config?.provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY && config.authEnv) env.ANTHROPIC_API_KEY = env[config.authEnv];
    if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl;
  }
  if (config?.provider === "ollama") {
    env.OLLAMA_ENABLED = "1";
    if (!env.OLLAMA_API_KEY && config.authEnv) env.OLLAMA_API_KEY = env[config.authEnv];
    if (config.baseUrl) env.OLLAMA_BASE_URL = config.baseUrl;
  }
  if (config?.model && !env.SMART_MODEL) env.SMART_MODEL = config.model;
  return env;
}

async function readAgentToml(projectRoot: string): Promise<{ provider?: string; model?: string; baseUrl?: string; authEnv?: string } | undefined> {
  const configPath = path.join(projectRoot, ".vos", "config.toml");
  if (!existsSync(configPath)) return undefined;
  const parsed = Bun.TOML.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  const agent = isRecord(parsed.agent) ? parsed.agent : undefined;
  if (!agent) return undefined;
  const auth = isRecord(agent.auth) ? agent.auth : undefined;
  return {
    provider: typeof agent.provider === "string" ? agent.provider.trim().toLowerCase() : undefined,
    model: typeof agent.model === "string" ? agent.model.trim() : undefined,
    baseUrl: typeof agent.base_url === "string" ? agent.base_url.trim() : undefined,
    authEnv: typeof auth?.env === "string" ? auth.env.trim() : undefined,
  };
}

function unquoteEnv(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function consumeQuota(
  db: Database,
  sessionId: string,
  dailyLimit: number,
  sessionLimit: number,
): { ok: true } | { ok: false; reason: string } {
  const session = db.query("select ask_count as askCount from sessions where id = ?").get(sessionId) as { askCount: number } | null;
  if (!session) return { ok: false, reason: "not_authenticated" };
  if (session.askCount >= sessionLimit) return { ok: false, reason: "session_limit_exceeded" };
  const total = db.query("select coalesce(sum(ask_count), 0) as total from sessions").get() as { total: number };
  if (total.total >= dailyLimit) return { ok: false, reason: "daily_limit_exceeded" };
  db.query("update sessions set ask_count = ask_count + 1 where id = ?").run(sessionId);
  return { ok: true };
}

function sessionPayload(projectRoot: string, sessionId: string, dailyLimit: number, sessionLimit: number, db: Database): Record<string, unknown> {
  const session = db.query("select ask_count as askCount from sessions where id = ?").get(sessionId) as { askCount: number } | null;
  return {
    ok: true,
    projectRoot,
    sessionId,
    quota: {
      used: session?.askCount ?? 0,
      sessionLimit,
      dailyLimit,
    },
  };
}

function sanitizeEvent(event: CoreRunEvent): CoreRunEvent | undefined {
  if (event.visibility === "staff-only") return undefined;
  return JSON.parse(JSON.stringify(event).replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer <redacted>")) as CoreRunEvent;
}

function sse(run: RunRecord): Response {
  const encoder = new TextEncoder();
  let subscriber: ((event: CoreRunEvent) => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: CoreRunEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      for (const event of run.events) send(event);
      if (run.status !== "running") {
        controller.close();
        return;
      }
      subscriber = send;
      run.subscribers.add(send);
    },
    cancel() {
      if (subscriber) run.subscribers.delete(subscriber);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...corsHeaders(),
    },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  return await request.json().catch(() => ({})) as Record<string, unknown>;
}

function sessionFromCookie(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1];
}

function readLimitEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { ...corsHeaders(), ...headers } });
}

function html(value: string): Response {
  return text(value, "text/html; charset=utf-8");
}

function text(value: string, contentType: string): Response {
  return new Response(value, { headers: { "Content-Type": contentType, ...corsHeaders() } });
}

function cors(value: string | null, status: number): Response {
  return new Response(value, { status, headers: corsHeaders() });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
}
