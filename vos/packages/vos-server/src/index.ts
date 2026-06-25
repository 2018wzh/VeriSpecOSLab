import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  commandToArray,
  executeVosCommand,
  type BaseCommandResult,
  type CommandStatus,
  type CoreRunEvent,
  type PortalClient,
  type VerifyScope,
  type VosCommand,
} from "vos-core";

export interface VosHttpServerOptions {
  projectRoot: string;
  portalUrl: string;
  projectId: string;
  host?: string;
  port?: number;
  portalClient?: PortalClient;
  executeCommand?: (params: VosCommandExecutionContext) => Promise<BaseCommandResult>;
}

export interface VosHttpServerResult {
  host: string;
  port: number;
  url: string;
  server: Bun.Server<undefined>;
}

export interface VosHttpRun {
  id: string;
  status: CommandStatus | "queued" | "running";
  command: string[];
  requestedBy: string;
  reason?: string;
  agentSessionId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: BaseCommandResult;
  error?: string;
}

export interface VosCommandExecutionContext {
  runId: string;
  command: VosCommand;
  requestedBy: string;
  reason?: string;
  agentSessionId?: string;
  bearerToken?: string;
  projectRoot: string;
  portalUrl: string;
  projectId: string;
  portalClient?: PortalClient;
  signal?: AbortSignal;
  onEvent?: (event: CoreRunEvent) => void | Promise<void>;
}

type RouteKind = "sync" | "run";
type Method = "GET" | "POST" | "PUT" | "DELETE";

interface RouteDef {
  method: Method;
  path: string;
  kind: RouteKind;
  schema: z.ZodTypeAny;
  makeCommand: (input: Record<string, unknown>, params: Record<string, string>) => VosCommand;
}

const emptySchema = z.object({}).strict();
const commonRunFields = {
  requested_by: z.string().optional(),
  reason: z.string().optional(),
  agent_session_id: z.string().optional(),
};
const dryRunSchema = z.object({ dry_run: z.boolean().optional() }).strict();
const pathSchema = z.object({ path: z.string().optional() }).strict();
const runBaseSchema = z.object(commonRunFields).strict();

const routes: RouteDef[] = [
  { method: "POST", path: "/api/v1/init", kind: "sync", schema: emptySchema, makeCommand: () => ({ kind: "init" }) },
  { method: "GET", path: "/api/v1/doctor", kind: "sync", schema: emptySchema, makeCommand: () => ({ kind: "doctor" }) },
  { method: "GET", path: "/api/v1/stage", kind: "sync", schema: emptySchema, makeCommand: () => ({ kind: "stage_show" }) },
  { method: "POST", path: "/api/v1/toolchain/lint", kind: "sync", schema: emptySchema, makeCommand: () => ({ kind: "toolchain_lint" }) },
  { method: "POST", path: "/api/v1/spec/lint", kind: "sync", schema: pathSchema, makeCommand: (input) => ({ kind: "spec_lint", path: stringValue(input.path) }) },
  { method: "POST", path: "/api/v1/spec/normalize", kind: "sync", schema: emptySchema, makeCommand: () => ({ kind: "spec_normalize" }) },
  { method: "POST", path: "/api/v1/spec/check-consistency", kind: "sync", schema: emptySchema, makeCommand: () => ({ kind: "spec_check_consistency" }) },
  { method: "POST", path: "/api/v1/spec/patch/lint", kind: "sync", schema: z.object({ patch_path: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "spec_patch_lint", patchPath: stringValue(input.patch_path) }) },
  { method: "POST", path: "/api/v1/arch/lint", kind: "sync", schema: pathSchema, makeCommand: (input) => ({ kind: "arch_lint", path: stringValue(input.path) }) },
  { method: "POST", path: "/api/v1/arch/compose", kind: "sync", schema: pathSchema, makeCommand: (input) => ({ kind: "arch_compose", path: stringValue(input.path) }) },
  { method: "POST", path: "/api/v1/arch/derive-tests", kind: "sync", schema: pathSchema, makeCommand: (input) => ({ kind: "arch_derive_tests", path: stringValue(input.path) }) },
  { method: "GET", path: "/api/v1/kb/sources", kind: "sync", schema: emptySchema, makeCommand: () => ({ kind: "kb_list" }) },
  { method: "POST", path: "/api/v1/kb/search", kind: "sync", schema: z.object({ query: z.string().min(1) }).strict(), makeCommand: (input) => ({ kind: "kb_search", query: input.query as string }) },
  { method: "DELETE", path: "/api/v1/kb/sources/{id}", kind: "sync", schema: emptySchema, makeCommand: (_input, params) => ({ kind: "kb_remove", id: params.id }) },
  { method: "DELETE", path: "/api/v1/kb/sources", kind: "sync", schema: emptySchema, makeCommand: () => ({ kind: "kb_clear" }) },
  { method: "GET", path: "/api/v1/kb/manifest", kind: "sync", schema: emptySchema, makeCommand: () => ({ kind: "kb_export_manifest" }) },
  { method: "PUT", path: "/api/v1/kb/manifest", kind: "sync", schema: z.object({ manifest_path: z.string().min(1) }).strict(), makeCommand: (input) => ({ kind: "kb_import_manifest", manifestPath: input.manifest_path as string }) },
  { method: "POST", path: "/api/v1/ledger/entries", kind: "sync", schema: z.object({ actor: z.enum(["human", "agent"]), intent: z.string(), spec_refs: z.array(z.string()).optional(), changed_targets: z.array(z.string()).optional() }).strict(), makeCommand: (input) => ({ kind: "ledger_record", actor: input.actor as "human" | "agent", intent: input.intent as string, specRefs: stringArray(input.spec_refs), changedTargets: stringArray(input.changed_targets) }) },

  { method: "POST", path: "/api/v1/build/runs", kind: "run", schema: z.object({ ...commonRunFields, dry_run: z.boolean().optional(), toolchain_path: z.string().optional(), variant: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "build", dryRun: bool(input.dry_run), toolchainPath: stringValue(input.toolchain_path), variant: stringValue(input.variant) }) },
  { method: "POST", path: "/api/v1/build/generate-runs", kind: "run", schema: runBaseSchema, makeCommand: (input) => ({ kind: "build_generate", agentSession: stringValue(input.agent_session_id) }) },
  { method: "POST", path: "/api/v1/run/qemu-runs", kind: "run", schema: z.object({ ...commonRunFields, dry_run: z.boolean().optional(), timeout_ms: z.number().int().positive().optional(), ready_pattern: z.string().optional(), profile_id: z.string().optional(), case_id: z.string().optional(), list_profiles: z.boolean().optional(), list_cases: z.boolean().optional() }).strict(), makeCommand: (input) => ({ kind: "run_qemu", dryRun: bool(input.dry_run), timeoutMs: numberValue(input.timeout_ms), readyPattern: stringValue(input.ready_pattern), profileId: stringValue(input.profile_id), caseId: stringValue(input.case_id), listProfiles: bool(input.list_profiles), listCases: bool(input.list_cases) }) },
  { method: "POST", path: "/api/v1/test/runs", kind: "run", schema: z.object({ ...commonRunFields, suites: z.array(z.string()).optional(), dry_run: z.boolean().optional() }).strict(), makeCommand: (input) => ({ kind: "test", suites: stringArray(input.suites), dryRun: bool(input.dry_run) }) },
  { method: "POST", path: "/api/v1/verify/runs", kind: "run", schema: z.object({ ...commonRunFields, scope: z.enum(["public", "patch", "full", "invariant", "generated", "fuzz"]), target: z.string().optional(), dry_run: z.boolean().optional(), staff_policy: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "verify", scope: input.scope as VerifyScope, target: stringValue(input.target), dryRun: bool(input.dry_run), staffPolicy: stringValue(input.staff_policy) }) },
  { method: "POST", path: "/api/v1/trace/syscall-runs", kind: "run", schema: z.object({ ...commonRunFields, timeout_ms: z.number().int().positive().optional(), dry_run: z.boolean().optional() }).strict(), makeCommand: (input) => ({ kind: "trace_syscall", timeoutMs: numberValue(input.timeout_ms), dryRun: bool(input.dry_run) }) },
  { method: "POST", path: "/api/v1/debug/explain-log-runs", kind: "run", schema: z.object({ ...commonRunFields, log_path: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "debug_explain_log", logPath: stringValue(input.log_path) }) },
  { method: "POST", path: "/api/v1/spec/patch/apply-runs", kind: "run", schema: z.object({ ...commonRunFields, patch_path: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "spec_patch_apply", patchPath: stringValue(input.patch_path), inputFromStdin: false }) },
  { method: "POST", path: "/api/v1/kb/add-runs", kind: "run", schema: z.object({ ...commonRunFields, source: z.string().min(1), source_kind: z.enum(["course", "project", "external"]).optional(), stage: z.string().optional(), title: z.string().optional(), recursive: z.boolean().optional(), manifest_path: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "kb_add", source: input.source as string, sourceKind: (input.source_kind as "course" | "project" | "external" | undefined) ?? "project", stage: stringValue(input.stage), title: stringValue(input.title), recursive: bool(input.recursive), manifestPath: stringValue(input.manifest_path) }) },
  { method: "POST", path: "/api/v1/agent/context-runs", kind: "run", schema: z.object({ ...commonRunFields, scope: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "agent_context", scope: stringValue(input.scope) }) },
  { method: "POST", path: "/api/v1/agent/plan-runs", kind: "run", schema: z.object({ ...commonRunFields, task: z.string().optional(), scope: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "agent_plan", task: stringValue(input.task), scope: stringValue(input.scope) }) },
  { method: "POST", path: "/api/v1/agent/ask-runs", kind: "run", schema: z.object({ ...commonRunFields, question: z.string().min(1), scope: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "agent_ask", question: input.question as string, scope: stringValue(input.scope), interactive: false }) },
  { method: "POST", path: "/api/v1/agent/generate-runs", kind: "run", schema: z.object({ ...commonRunFields, task: z.string().optional(), target: z.string().optional(), apply: z.boolean().optional(), build: z.boolean().optional(), run: z.boolean().optional() }).strict(), makeCommand: (input) => ({ kind: "agent_generate", task: stringValue(input.task), target: stringValue(input.target), apply: bool(input.apply), build: bool(input.build), run: bool(input.run) }) },
  { method: "POST", path: "/api/v1/agent/apply-patch-runs", kind: "run", schema: z.object({ ...commonRunFields, patch_file: z.string().optional(), require_spec: z.boolean().optional(), run_validation: z.boolean().optional() }).strict(), makeCommand: (input) => ({ kind: "agent_apply_patch", patchFile: stringValue(input.patch_file), requireSpec: input.require_spec !== false, runValidation: bool(input.run_validation) }) },
  { method: "POST", path: "/api/v1/agent/validate-generated-runs", kind: "run", schema: z.object({ ...commonRunFields, target: z.string().min(1), patch_file: z.string().optional(), keep_worktree: z.boolean().optional() }).strict(), makeCommand: (input) => ({ kind: "agent_validate_generated", target: input.target as string, patchFile: stringValue(input.patch_file), keepWorktree: bool(input.keep_worktree) }) },
  { method: "POST", path: "/api/v1/agent/review-spec-runs", kind: "run", schema: z.object({ ...commonRunFields, target: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "agent_review_spec", target: stringValue(input.target) }) },
  { method: "POST", path: "/api/v1/agent/debug-runs", kind: "run", schema: z.object({ ...commonRunFields, log_path: z.string().optional(), run_id: z.string().optional(), keep_worktree: z.boolean().optional() }).strict(), makeCommand: (input) => ({ kind: "agent_debug", logPath: stringValue(input.log_path), runId: stringValue(input.run_id), keepWorktree: bool(input.keep_worktree) }) },
  { method: "POST", path: "/api/v1/agent/log-runs", kind: "run", schema: z.object({ ...commonRunFields, append: z.boolean().optional(), input_path: z.string().optional() }).strict(), makeCommand: (input) => ({ kind: "agent_log", append: bool(input.append), inputPath: stringValue(input.input_path) }) },
  { method: "POST", path: "/api/v1/report/generate-runs", kind: "run", schema: z.object({ ...commonRunFields, stage: z.string().optional(), final: z.boolean().optional() }).strict(), makeCommand: (input) => ({ kind: "report_generate", stage: stringValue(input.stage), final: bool(input.final) }) },
  { method: "POST", path: "/api/v1/submit/pack-runs", kind: "run", schema: runBaseSchema, makeCommand: () => ({ kind: "submit_pack" }) },
];

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
  const openApi = createOpenApiDocument();

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "vos-server" });
      }
      if (req.method === "GET" && url.pathname === "/api/v1/openapi.json") {
        return json(openApi);
      }
      const runResponse = await handleRunRoute(req, url, { runs, projectRoot });
      if (runResponse) return runResponse;

      for (const route of routes) {
        const match = matchRoute(route.path, url.pathname);
        if (!match || req.method !== route.method) continue;
        const input = await readInput(req, route.schema);
        if (!input.ok) return json({ error: input.error }, 400);
        const command = route.makeCommand(input.value, match);
        if (route.kind === "sync") {
          const result = await runCommand(command, {
            runId: provisionalRunId(),
            requestedBy: stringValue(input.value.requested_by) ?? "portal",
            reason: stringValue(input.value.reason),
            agentSessionId: stringValue(input.value.agent_session_id),
            bearerToken: bearerToken(req),
            projectRoot,
            portalUrl: options.portalUrl,
            projectId: options.projectId,
            portalClient: options.portalClient,
            executeCommand: options.executeCommand,
          });
          return json(result, result.ok ? 200 : 400);
        }
        return await createRun(req, command, input.value, {
          runs,
          projectRoot,
          portalUrl: options.portalUrl,
          projectId: options.projectId,
          portalClient: options.portalClient,
          executeCommand: options.executeCommand,
        });
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "unknown error" }, 500);
    }
  };
}

interface RunRecord extends VosHttpRun {
  controller: AbortController;
  events: CoreRunEvent[];
  subscribers: Set<(event: CoreRunEvent) => void>;
}

async function createRun(
  req: Request,
  command: VosCommand,
  input: Record<string, unknown>,
  params: {
    runs: Map<string, RunRecord>;
    projectRoot: string;
    portalUrl: string;
    projectId: string;
    portalClient?: PortalClient;
    executeCommand?: VosHttpServerOptions["executeCommand"];
  },
): Promise<Response> {
  const controller = new AbortController();
  const runId = provisionalRunId();
  const run: RunRecord = {
    id: runId,
    status: "queued",
    command: commandToArray(command),
    requestedBy: stringValue(input.requested_by) ?? "portal",
    reason: stringValue(input.reason),
    agentSessionId: stringValue(input.agent_session_id),
    createdAt: new Date().toISOString(),
    controller,
    events: [],
    subscribers: new Set(),
  };
  params.runs.set(runId, run);

  void (async () => {
    run.status = "running";
    run.startedAt = new Date().toISOString();
    try {
      const result = await runCommand(command, {
        runId,
        requestedBy: run.requestedBy,
        reason: run.reason,
        agentSessionId: run.agentSessionId,
        bearerToken: bearerToken(req),
        projectRoot: params.projectRoot,
        portalUrl: params.portalUrl,
        projectId: params.projectId,
        portalClient: params.portalClient,
        signal: controller.signal,
        executeCommand: params.executeCommand,
        onEvent: (event) => {
          const publicEvent = sanitizeEvent(event);
          if (publicEvent) {
            run.events.push(publicEvent);
            for (const subscriber of run.subscribers) subscriber(publicEvent);
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
    } catch (error) {
      run.status = controller.signal.aborted ? "cancelled" : "failed";
      run.error = error instanceof Error ? error.message : "unknown error";
      run.finishedAt = new Date().toISOString();
    }
  })();

  await waitForRunIdStabilized(run);
  return json({ run_id: run.id, status: run.status }, 202);
}

async function runCommand(command: VosCommand, context: Omit<VosCommandExecutionContext, "command"> & {
  executeCommand?: VosHttpServerOptions["executeCommand"];
}): Promise<BaseCommandResult> {
  if (context.executeCommand) {
    return await context.executeCommand({ ...context, command });
  }
  return await executeVosCommand(command, {
    projectRoot: context.projectRoot,
    agentSession: context.agentSessionId,
    serveBinding: {
      portalUrl: context.portalUrl,
      projectId: context.projectId,
      bearerToken: context.bearerToken,
    },
    portalClient: context.portalClient,
    signal: context.signal,
    onEvent: context.onEvent,
  });
}

async function handleRunRoute(
  req: Request,
  url: URL,
  params: { runs: Map<string, RunRecord>; projectRoot: string },
): Promise<Response | undefined> {
  const match = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)(?:\/(events|cancel|manifest|artifacts))?$/);
  if (!match) return undefined;
  const runId = decodeURIComponent(match[1]);
  const action = match[2];
  const run = params.runs.get(runId) ?? await loadCompletedRun(params.projectRoot, runId);
  if (!run && action !== "artifacts") return json({ error: "not_found" }, 404);
  if (!action && req.method === "GET" && run) return json(runSummary(run));
  if (action === "events" && req.method === "GET" && run) return sse(run);
  if (action === "cancel" && req.method === "POST" && run) {
    if (isRunRecord(run)) {
      run.controller.abort();
      run.status = "cancelled";
    }
    return json({ run_id: runId, status: "cancelled" }, 202);
  }
  if (action === "manifest" && req.method === "GET") {
    return await runManifest(params.projectRoot, runId);
  }
  if (action === "artifacts" && req.method === "GET") {
    return await runArtifact(params.projectRoot, runId, url.searchParams.get("path"));
  }
  return json({ error: "not_found" }, 404);
}

async function runManifest(projectRoot: string, runId: string): Promise<Response> {
  const manifestPath = path.join(projectRoot, ".vos", "runs", runId, "manifest.json");
  if (!existsSync(manifestPath)) return json({ error: "not_found" }, 404);
  return json(JSON.parse(await readFile(manifestPath, "utf8")));
}

async function runArtifact(projectRoot: string, runId: string, requested: string | null): Promise<Response> {
  if (!requested) return json({ error: "path is required" }, 400);
  if (requested.includes("\0") || path.isAbsolute(requested) || requested.split(/[\\/]+/).includes("..")) {
    return json({ error: "invalid artifact path" }, 400);
  }
  const normalized = requested.replace(/\\/g, "/");
  const prefix = `.vos/runs/${runId}/`;
  if (!normalized.startsWith(prefix) || !normalized.includes("/artifacts/")) {
    return json({ error: "artifact path is outside run artifacts" }, 400);
  }
  const fullPath = path.resolve(projectRoot, normalized);
  const runRoot = path.resolve(projectRoot, ".vos", "runs", runId);
  if (!fullPath.startsWith(`${runRoot}${path.sep}`) || !existsSync(fullPath)) {
    return json({ error: "not_found" }, 404);
  }
  return new Response(await readFile(fullPath), {
    headers: { "content-type": "application/octet-stream" },
  });
}

function runSummary(run: VosHttpRun & { events: CoreRunEvent[]; subscribers?: Set<(event: CoreRunEvent) => void> }): Record<string, unknown> {
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

async function loadCompletedRun(projectRoot: string, runId: string): Promise<(VosHttpRun & { events: CoreRunEvent[] }) | undefined> {
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
    ? (await readFile(eventsPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as CoreRunEvent).flatMap((event) => {
      const sanitized = sanitizeEvent(event);
      return sanitized ? [sanitized] : [];
    })
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

function sse(run: VosHttpRun & { events: CoreRunEvent[]; subscribers?: Set<(event: CoreRunEvent) => void> }): Response {
  const encoder = new TextEncoder();
  let subscriber: ((event: CoreRunEvent) => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: CoreRunEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      for (const event of run.events) send(event);
      if (run.status !== "queued" && run.status !== "running") {
        controller.close();
        return;
      }
      subscriber = send;
      run.subscribers?.add(send);
    },
    cancel() {
      if (subscriber) run.subscribers?.delete(subscriber);
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

function sanitizeEvent(event: CoreRunEvent): CoreRunEvent | undefined {
  if (event.visibility === "staff-only") return undefined;
  return JSON.parse(JSON.stringify(event).replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer <redacted>")) as CoreRunEvent;
}

async function readInput(req: Request, schema: z.ZodTypeAny): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  const hasBody = req.method !== "GET" && req.method !== "DELETE";
  const raw = hasBody ? await req.json().catch(() => ({})) : {};
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, value: parsed.data as Record<string, unknown> };
}

function matchRoute(template: string, pathname: string): Record<string, string> | undefined {
  const names: string[] = [];
  const pattern = template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  const match = pathname.match(new RegExp(`^${pattern}$`));
  if (!match) return undefined;
  return Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(match[i + 1])]));
}

function createOpenApiDocument(): unknown {
  const registry = new OpenAPIRegistry();
  const jsonResponse = {
    description: "JSON response",
    content: { "application/json": { schema: z.object({}).passthrough() } },
  };
  for (const route of routes) {
    registry.registerPath({
      method: route.method.toLowerCase() as "get" | "post" | "put" | "delete",
      path: route.path,
      request: route.method === "GET" || route.method === "DELETE" ? undefined : {
        body: {
          content: {
            "application/json": {
              schema: route.schema,
            },
          },
        },
      },
      responses: {
        200: jsonResponse,
        202: jsonResponse,
        400: jsonResponse,
      },
    });
  }
  for (const pathName of ["/api/v1/runs/{run_id}", "/api/v1/runs/{run_id}/events", "/api/v1/runs/{run_id}/cancel", "/api/v1/runs/{run_id}/manifest", "/api/v1/runs/{run_id}/artifacts"]) {
    registry.registerPath({
      method: pathName.endsWith("/cancel") ? "post" : "get",
      path: pathName,
      responses: { 200: jsonResponse, 202: jsonResponse, 404: jsonResponse },
    });
  }
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.0",
    info: { title: "VOS Server API", version: "1.0.0" },
  });
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function isRunRecord(run: VosHttpRun | RunRecord | (VosHttpRun & { events: CoreRunEvent[] })): run is RunRecord {
  return "controller" in run && run.controller instanceof AbortController;
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function bool(value: unknown): boolean {
  return value === true;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
