import { randomUUID } from "node:crypto";
import type { Config, ReasoningEffort } from "../config.ts";
import { resolveModeDefinition } from "../config.ts";
import { resolveActiveModelSettings } from "../resolve-model.ts";
import type { ChatClient } from "../agent/loop.ts";
import { runSessionTurn } from "../session/run-turn.ts";
import type { ThreadStore } from "../session/thread-store.ts";
import type { SessionEvent } from "../session/types.ts";
import {
  buildAgentTaskSystemPrompt,
  buildAgentTaskUserPrompt,
  createProfileToolPolicy,
  publicAgentTaskProfile,
  resolveAgentTaskProfile,
  resolveProfileVosCommands,
  type AgentTaskProfileInput,
} from "../agent/profiles.ts";
import {
  createSeededPortalStore,
  handlePortalApiRequest,
  portalCorsHeaders,
  type PortalStore,
} from "./portal.ts";

export interface AgentHttpServerOptions {
  chat: ChatClient;
  config: Config;
  store: ThreadStore;
  workspaceRoot: string;
  host: string;
  port: number;
  portalStore?: PortalStore;
}

type ChatCompletionRequest = {
  model?: string;
  messages?: ChatMessage[];
  project_id?: string;
  thread_id?: string;
  stream?: boolean;
};

type AgentTaskHttpRequest = {
  task_kind?: string;
  requested_scope?: string;
  agent_profile?: AgentTaskProfileInput;
  task?: string;
  prompt?: string;
  context?: unknown;
  context_refs?: string[];
  evidence_refs?: string[];
  allowed_paths?: string[];
  required_validations?: string[];
  policy_flags?: string[];
  allowed_vos_commands?: string[];
  project_id?: string;
  user_id?: string;
  thread_id?: string;
  model?: string;
  mode?: string;
  max_iterations?: number;
  disabled_tools?: string[];
  course_mode?: boolean;
  stream?: boolean;
};

type ChatMessage = {
  role: string;
  content: unknown;
};

export function serveAgentHttp(opts: AgentHttpServerOptions): Bun.Server<undefined> {
  const portalStore = opts.portalStore ?? createSeededPortalStore();
  const server = Bun.serve({
    hostname: opts.host,
    port: opts.port,
    async fetch(request) {
      try {
        return await handleRequest(request, { ...opts, portalStore });
      } catch (e) {
        return jsonResponse({
          error: {
            message: e instanceof Error ? e.message : String(e),
            type: "vos_agent_error",
          },
        }, 500);
      }
    },
  });
  return server;
}

async function handleRequest(
  request: Request,
  opts: AgentHttpServerOptions & { portalStore: PortalStore },
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return corsResponse();
  }
  const agentResponse = await handleAgentApiRequest(request, opts);
  if (agentResponse) return agentResponse;
  const portalResponse = await handlePortalApiRequest(request, opts.portalStore);
  if (portalResponse) return portalResponse;
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      service: "vos-agent",
      backend: "typescript",
    });
  }
  if (request.method === "GET" && url.pathname === "/v1/models") {
    return jsonResponse(modelsResponse(opts.config));
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await request.json() as ChatCompletionRequest;
    return jsonResponse(await chatCompletion(body, opts));
  }
  return jsonResponse({ error: { message: "not found", type: "not_found" } }, 404);
}

async function handleAgentApiRequest(
  request: Request,
  opts: AgentHttpServerOptions & { portalStore: PortalStore },
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (request.method === "POST" && url.pathname === "/api/v1/agent/profile") {
    const body = await request.json() as AgentTaskHttpRequest;
    const profile = resolveAgentTaskProfile({
      taskKind: body.task_kind,
    }, body.agent_profile);
    return jsonResponse({ agent_profile: publicAgentTaskProfile(profile) });
  }
  if (request.method === "POST" && url.pathname === "/api/v1/agent/tasks") {
    const body = await request.json() as AgentTaskHttpRequest;
    return jsonResponse(await runAgentHttpTask(body, opts));
  }
  if (
    request.method === "POST" &&
    parts[0] === "api" &&
    parts[1] === "v1" &&
    parts[2] === "agent" &&
    parts[3] === "sessions" &&
    parts[5] === "turns"
  ) {
    const body = await request.json() as AgentTaskHttpRequest;
    return jsonResponse(await runAgentHttpTask({ ...body, thread_id: parts[4] }, opts));
  }
  if (
    request.method === "GET" &&
    parts[0] === "api" &&
    parts[1] === "v1" &&
    parts[2] === "agent" &&
    parts[3] === "sessions" &&
    parts.length === 5
  ) {
    const thread = opts.store.load(parts[4]);
    return jsonResponse({
      id: thread.id,
      title: thread.title,
      created_at: thread.createdAt,
      updated_at: thread.updatedAt,
      workspace_root: thread.workspaceRoot,
      model: thread.model,
      mode: thread.mode,
      reasoning_effort: thread.reasoningEffort,
      archived_at: thread.archivedAt,
      message_count: thread.messages.length,
      todos: thread.todos,
    });
  }
  return undefined;
}

async function runAgentHttpTask(
  request: AgentTaskHttpRequest,
  opts: AgentHttpServerOptions & { portalStore: PortalStore },
): Promise<Record<string, unknown>> {
  if (request.stream) {
    throw new Error("streaming agent tasks are not implemented by vos-agent HTTP yet");
  }
  const task = request.task ?? request.prompt;
  if (!task) {
    throw new Error("agent task request must include task or prompt");
  }
  const profile = resolveAgentTaskProfile({
    taskKind: request.task_kind,
  }, request.agent_profile);
  const modelSettings = request.model
    ? { model: request.model, mode: request.mode }
    : resolveActiveModelSettings(opts.config, {
      model: undefined,
      mode: request.mode ?? profile.mode,
    });
  const prompt = buildAgentTaskUserPrompt({
    profile,
    task,
    taskKind: request.task_kind,
    requestedScope: request.requested_scope,
    context: request.context,
    contextRefs: asStringArray(request.context_refs),
    evidenceRefs: asStringArray(request.evidence_refs),
    allowedPaths: asStringArray(request.allowed_paths),
    requiredValidations: asStringArray(request.required_validations),
    policyFlags: asStringArray(request.policy_flags),
    promptOverride: request.prompt && !request.task ? request.prompt : undefined,
  });
  const events: SessionEvent[] = [];
  const result = await runSessionTurn({
    chat: opts.chat,
    store: opts.store,
    workspaceRoot: opts.workspaceRoot,
    startDir: opts.workspaceRoot,
    prompt,
    threadId: request.thread_id,
    model: modelSettings.model,
    mode: modelSettings.mode,
    reasoningEffort: modelSettings.reasoningEffort,
    disabledTools: mergeDisabledTools(opts.config.tools.disabled, request.disabled_tools),
    permissionRules: opts.config.tools.permissions,
    maxIterations: request.max_iterations,
    courseMode: request.course_mode ?? true,
    allowedVosCommands: resolveProfileVosCommands(profile, request.allowed_vos_commands),
    toolPolicy: createProfileToolPolicy(profile),
    fixedSystemPrompt: buildAgentTaskSystemPrompt(profile),
    onEvent: (event) => {
      events.push(event);
    },
  });
  const structuredOutput = parseJsonFromText(result.content ?? "");
  opts.portalStore.recordAgentAudit({
    projectId: request.project_id,
    userId: request.user_id,
    sessionId: result.thread.id,
    model: request.model ?? modelSettings.model,
    taskKind: request.task_kind ?? profile.taskKinds[0],
    prompt,
    response: result.content ?? undefined,
    riskFlags: collectRiskFlags(structuredOutput),
  });

  return {
    session_id: result.thread.id,
    thread_id: result.thread.id,
    agent_profile: publicAgentTaskProfile(profile),
    model: modelSettings.model,
    mode: modelSettings.mode,
    reasoning_effort: modelSettings.reasoningEffort,
    content: result.content ?? "",
    structured_output: structuredOutput,
    events,
  };
}

async function chatCompletion(
  request: ChatCompletionRequest,
  opts: AgentHttpServerOptions,
): Promise<Record<string, unknown>> {
  if (request.stream) {
    throw new Error("streaming chat completions are not implemented by vos-agent HTTP yet");
  }
  const prompt = lastUserPrompt(request.messages ?? []);
  if (!prompt) {
    throw new Error("chat completion request must include at least one user message");
  }

  const modelSettings = resolveRequestedModel(opts.config, request.model);
  const result = await runSessionTurn({
    chat: opts.chat,
    store: opts.store,
    workspaceRoot: opts.workspaceRoot,
    startDir: opts.workspaceRoot,
    prompt,
    threadId: request.thread_id,
    model: modelSettings.model,
    mode: modelSettings.mode,
    reasoningEffort: modelSettings.reasoningEffort,
    disabledTools: opts.config.tools.disabled,
    permissionRules: opts.config.tools.permissions,
  });
  opts.portalStore?.recordAgentAudit({
    projectId: request.project_id,
    sessionId: result.thread.id,
    model: request.model ?? modelSettings.model,
    prompt,
    response: result.content ?? undefined,
  });

  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.model ?? "vos-local-agent",
    thread_id: result.thread.id,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: result.content ?? "",
      },
      finish_reason: "stop",
    }],
  };
}

function modelsResponse(config: Config): Record<string, unknown> {
  const modeModels = Object.entries(config.modes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mode, def]) => ({
      id: `vos-${mode}`,
      object: "model",
      owned_by: "vos-agent",
      root: def.model,
    }));
  return {
    object: "list",
    data: [
      {
        id: "vos-local-agent",
        object: "model",
        owned_by: "vos-agent",
        root: config.modes[config.defaultMode]?.model,
      },
      ...modeModels,
    ],
  };
}

function resolveRequestedModel(
  config: Config,
  requested: string | undefined,
): { model: string; mode?: string; reasoningEffort?: ReasoningEffort } {
  if (!requested || requested === "vos-local-agent") {
    const def = resolveModeDefinition(config, config.defaultMode);
    return {
      model: def.model,
      mode: config.defaultMode,
      reasoningEffort: def.reasoningEffort,
    };
  }
  if (requested.startsWith("vos-")) {
    const mode = requested.slice("vos-".length);
    const def = resolveModeDefinition(config, mode);
    return { model: def.model, mode, reasoningEffort: def.reasoningEffort };
  }
  return { model: requested };
}

function lastUserPrompt(messages: readonly ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    return contentToText(message.content);
  }
  return undefined;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: unknown; text?: unknown };
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("\n");
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function mergeDisabledTools(
  configDisabledTools: readonly string[],
  requestDisabledTools: readonly string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...configDisabledTools, ...(requestDisabledTools ?? [])]) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    out.push(normalized);
  }
  return out;
}

function parseJsonFromText(text: string): unknown | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      return undefined;
    }
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return undefined;
    }
  }
}

function collectRiskFlags(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const riskFlags = (value as { risk_flags?: unknown }).risk_flags;
  return Array.isArray(riskFlags)
    ? riskFlags.filter((item): item is string => typeof item === "string")
    : [];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function corsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function corsHeaders(): Record<string, string> {
  return {
    ...portalCorsHeaders(),
  };
}
