import { randomUUID } from "node:crypto";
import type { Config, ReasoningEffort } from "../config.ts";
import { resolveModeDefinition } from "../config.ts";
import type { ChatClient } from "../agent/loop.ts";
import { runSessionTurn } from "../session/run-turn.ts";
import type { ThreadStore } from "../session/thread-store.ts";
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
