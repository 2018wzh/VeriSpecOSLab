import path from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { BaseCommandResult, CommandStatus, VosHttpRun } from "../types.ts";
import type { RunEvent } from "../evidence/events.ts";
import { executeCliInvocation } from "../main.ts";
import type { PortalClient } from "../auth/portal-client.ts";

export interface VosHttpServerOptions {
  projectRoot: string;
  portalUrl: string;
  projectId: string;
  host?: string;
  port?: number;
  portalClient?: PortalClient;
}

export interface VosHttpServerResult {
  host: string;
  port: number;
  url: string;
  server: Bun.Server<undefined>;
}

interface RunRecord extends VosHttpRun {
  controller: AbortController;
  events: RunEvent[];
  subscribers: Set<(event: RunEvent) => void>;
}

export function startVosHttpServer(options: VosHttpServerOptions): VosHttpServerResult {
  const host = options.host ?? "127.0.0.1";
  const server = Bun.serve({
    hostname: host,
    port: options.port ?? 8788,
    fetch: createVosHttpHandler(options),
  });

  return {
    host: server.hostname ?? host,
    port: server.port ?? (options.port ?? 8788),
    url: `http://${server.hostname ?? host}:${server.port ?? (options.port ?? 8788)}`,
    server,
  };
}

export function createVosHttpHandler(options: VosHttpServerOptions): (req: Request) => Promise<Response> {
  const projectRoot = path.resolve(options.projectRoot);
  const runs = new Map<string, RunRecord>();
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    try {
      if (req.method === "POST" && url.pathname === "/api/v1/vos/runs") {
        return await createRun(req, {
          runs,
          projectRoot,
          portalUrl: options.portalUrl,
          projectId: options.projectId,
          portalClient: options.portalClient,
        });
      }
      const match = url.pathname.match(/^\/api\/v1\/vos\/runs\/([^/]+)(?:\/(events|cancel))?$/);
      if (match) {
        const runId = decodeURIComponent(match[1]);
        const action = match[2];
        const run = runs.get(runId) ?? await loadCompletedRun(projectRoot, runId);
        if (!run) return json({ error: "not_found" }, 404);
        if (!action && req.method === "GET") {
          return json(runSummary(run));
        }
        if (action === "events" && req.method === "GET") {
          return sse(run);
        }
        if (action === "cancel" && req.method === "POST") {
          if (isRunRecord(run)) {
            run.controller.abort();
            run.status = "cancelled";
          }
          return json({ run_id: runId, status: "cancelled" }, 202);
        }
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : "unknown error",
      }, 500);
    }
  };
}

function isRunRecord(run: VosHttpRun | RunRecord | (VosHttpRun & { events: RunEvent[] })): run is RunRecord {
  return "controller" in run && run.controller instanceof AbortController;
}

async function createRun(
  req: Request,
  params: {
    runs: Map<string, RunRecord>;
    projectRoot: string;
    portalUrl: string;
    projectId: string;
    portalClient?: PortalClient;
  },
): Promise<Response> {
  const body = await req.json().catch(() => undefined) as {
    command?: unknown;
    args?: unknown;
    requested_by?: unknown;
    agent_session_id?: unknown;
    reason?: unknown;
  } | undefined;
  const commandArgs = normalizeRpcCommand(body?.command, body?.args);
  if (!commandArgs.ok) {
    return json({ error: commandArgs.error }, 400);
  }
  if (commandArgs.args.some((arg) => arg === "--project-root" || arg.startsWith("--project-root=") || arg === "--portal-url" || arg.startsWith("--portal-url=") || arg === "--project-id" || arg.startsWith("--project-id="))) {
    return json({ error: "run RPC cannot override server binding" }, 400);
  }
  const controller = new AbortController();
  const runId = provisionalRunId();
  const run: RunRecord = {
    id: runId,
    status: "queued",
    command: commandArgs.args,
    requestedBy: typeof body?.requested_by === "string" ? body.requested_by : "unknown",
    reason: typeof body?.reason === "string" ? body.reason : undefined,
    agentSessionId: typeof body?.agent_session_id === "string" ? body.agent_session_id : undefined,
    createdAt: new Date().toISOString(),
    controller,
    events: [],
    subscribers: new Set(),
  };
  params.runs.set(runId, run);

  void (async () => {
    run.status = "running";
    run.startedAt = new Date().toISOString();
    const argv = [
      "bun",
      "vos",
      "--project-root",
      params.projectRoot,
      "--json",
      ...(run.agentSessionId ? ["--agent-session", run.agentSessionId] : []),
      ...commandArgs.args,
    ];
    const result = await executeCliInvocation(argv, {
      print: false,
      serveBinding: {
        portalUrl: params.portalUrl,
        projectId: params.projectId,
      },
      portalClient: params.portalClient,
      signal: controller.signal,
      onEvent: (event) => {
        run.events.push(event);
        for (const subscriber of run.subscribers) {
          subscriber(event);
        }
        if (event.type === "run_started") {
          params.runs.delete(run.id);
          run.id = event.run_id;
          params.runs.set(run.id, run);
        }
      },
    });
    run.result = result;
    run.status = result.status;
    run.finishedAt = result.finished_at;
  })();

  await waitForRunIdStabilized(run);
  return json({
    run_id: run.id,
    status: run.status,
  }, 202);
}

function normalizeRpcCommand(command: unknown, args: unknown):
  | { ok: true; args: string[] }
  | { ok: false; error: string } {
  const out: string[] = [];
  if (typeof command === "string") {
    out.push(...splitShellLike(command));
  } else if (Array.isArray(command) && command.every((item) => typeof item === "string")) {
    out.push(...command as string[]);
  } else {
    return { ok: false, error: "command must be a string or string[]" };
  }
  if (Array.isArray(args)) {
    for (const arg of args) {
      if (typeof arg !== "string") return { ok: false, error: "args must be string[]" };
      out.push(arg);
    }
  } else if (args !== undefined) {
    return { ok: false, error: "args must be string[]" };
  }
  if (out[0] === "vos") out.shift();
  if (out.length === 0) return { ok: false, error: "command must include a subcommand" };
  return { ok: true, args: out };
}

function runSummary(run: VosHttpRun | RunRecord): Record<string, unknown> {
  return {
    run_id: run.id,
    status: run.status,
    command: run.command,
    requested_by: run.requestedBy,
    created_at: run.createdAt,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    result: run.result,
    error: run.error,
  };
}

async function loadCompletedRun(projectRoot: string, runId: string): Promise<(VosHttpRun & { events: RunEvent[]; subscribers?: Set<(event: RunEvent) => void> }) | undefined> {
  const runRoot = path.join(projectRoot, ".vos", "runs", runId);
  const manifestPath = path.join(runRoot, "manifest.json");
  const eventsPath = path.join(runRoot, "events.jsonl");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    command?: string[];
    status?: CommandStatus;
    started_at?: string;
    finished_at?: string;
  };
  const events = existsSync(eventsPath)
    ? (await readFile(eventsPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as RunEvent)
    : [];
  return {
    id: runId,
    status: manifest.status ?? "failed",
    command: manifest.command ?? [],
    requestedBy: "unknown",
    createdAt: manifest.started_at ?? new Date().toISOString(),
    startedAt: manifest.started_at,
    finishedAt: manifest.finished_at,
    events,
  };
}

function sse(run: VosHttpRun & { events: RunEvent[]; subscribers?: Set<(event: RunEvent) => void> }): Response {
  const encoder = new TextEncoder();
  let subscriber: ((event: RunEvent) => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RunEvent) => {
        if (event.visibility === "staff-only") return;
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      for (const event of run.events) {
        send(event);
      }
      if (run.status !== "queued" && run.status !== "running") {
        controller.close();
        return;
      }
      subscriber = send;
      run.subscribers?.add(send);
    },
    cancel() {
      if (subscriber) {
        run.subscribers?.delete(subscriber);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function waitForRunIdStabilized(run: RunRecord): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (run.events.some((event) => event.type === "run_started")) return;
    if (run.result) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function provisionalRunId(): string {
  return `pending-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function splitShellLike(command: string): string[] {
  const matches = command.trim().match(/"([^"]*)"|'([^']*)'|\S+/g);
  return matches?.map((value) => value.replace(/^"|"$|^'|'$/g, "")) ?? [];
}
