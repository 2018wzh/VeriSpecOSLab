import type OpenAI from "openai";
import { defineChatClientCapabilities } from "../agent/loop.ts";
import type {
  ChatUsage,
  ChatClient,
  ChatClientCapabilities,
  ChatRequest,
} from "../agent/loop.ts";
import type { OllamaThink } from "../config.ts";

export interface OllamaProviderConfig {
  baseURL: string;
  apiKey?: string;
  think: OllamaThink;
  keepAlive?: string;
}

const OLLAMA_CHAT_CAPABILITIES: ChatClientCapabilities =
  defineChatClientCapabilities({ text: true, image: false, pdf: false });

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
};

type OllamaToolCall = {
  function?: {
    name?: string;
    arguments?: unknown;
  };
};

type OllamaResponse = {
  message?: OllamaMessage;
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

export function createOllamaChatClient(config: OllamaProviderConfig): ChatClient {
  return {
    capabilities() {
      return OLLAMA_CHAT_CAPABILITIES;
    },

    async chat(request: ChatRequest) {
      const response = await fetch(`${trimTrailingSlash(config.baseURL)}/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(ollamaBody(config, request)),
        signal: request.signal,
      });
      if (!response.ok) {
        throw new Error(`Ollama chat request failed for model "${request.model}": ${response.status} ${await response.text()}`);
      }
      if (request.onEvent) {
        return await readOllamaStream(response, request);
      }
      const payload = await response.json() as OllamaResponse;
      if (payload.error) {
        throw new Error(`Ollama chat request failed for model "${request.model}": ${payload.error}`);
      }
      await emitOllamaUsage(request, payload);
      return fromOllamaMessage(payload.message);
    },
  };
}

function ollamaBody(config: OllamaProviderConfig, request: ChatRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages.flatMap(toOllamaMessage),
    stream: Boolean(request.onEvent),
    ...(request.tools.length > 0 ? { tools: request.tools } : {}),
    ...(ollamaFormat(request.responseFormat) ? { format: ollamaFormat(request.responseFormat) } : {}),
    ...(config.think === "passthrough" && request.reasoningEffort ? { think: true } : {}),
    ...(config.keepAlive ? { keep_alive: config.keepAlive } : {}),
  };
}

function toOllamaMessage(message: OpenAI.Chat.ChatCompletionMessageParam): OllamaMessage[] {
  if (message.role === "developer") {
    return [{ role: "system", content: stringifyContent(message.content) }];
  }
  if (message.role === "tool") {
    return [{ role: "tool", content: stringifyContent(message.content) }];
  }
  if (message.role === "function") {
    return [{ role: "tool", content: stringifyContent(message.content) }];
  }
  if (message.role === "assistant") {
    const toolCalls = (message.tool_calls ?? [])
      .filter((toolCall) => toolCall.type === "function")
      .map((toolCall) => ({
        function: {
          name: toolCall.function.name,
          arguments: safeJsonParse(toolCall.function.arguments) ?? {},
        },
      }));
    return [{
      role: "assistant",
      content: stringifyContent(message.content),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    }];
  }
  return [{ role: message.role, content: stringifyContent(message.content) }];
}

function stringifyContent(content: OpenAI.Chat.ChatCompletionMessageParam["content"]): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "type" in part && part.type === "text") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

function ollamaFormat(responseFormat: unknown): unknown {
  if (!responseFormat || typeof responseFormat !== "object") return undefined;
  const type = (responseFormat as { type?: unknown }).type;
  if (type === "json_object") return "json";
  if (type === "json_schema") {
    const schema = (responseFormat as { json_schema?: { schema?: unknown } }).json_schema?.schema;
    return schema && typeof schema === "object" ? schema : undefined;
  }
  return undefined;
}

async function readOllamaStream(
  response: Response,
  request: ChatRequest,
): Promise<OpenAI.Chat.ChatCompletionMessage> {
  const contentParts: string[] = [];
  let usage: ChatUsage | undefined;
  const text = await response.text();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const chunk = JSON.parse(line) as OllamaResponse;
    if (chunk.error) {
      throw new Error(`Ollama chat request failed for model "${request.model}": ${chunk.error}`);
    }
    const delta = chunk.message?.content ?? "";
    if (delta) {
      contentParts.push(delta);
      await request.onEvent?.({ type: "text.delta", delta });
    }
    usage = ollamaUsageToChatUsage(chunk) ?? usage;
  }
  if (usage) {
    await request.onUsage?.(usage);
  }
  return {
    role: "assistant",
    content: contentParts.length > 0 ? contentParts.join("") : null,
    refusal: null,
  } as OpenAI.Chat.ChatCompletionMessage;
}

function fromOllamaMessage(message: OllamaMessage | undefined): OpenAI.Chat.ChatCompletionMessage {
  const out = {
    role: "assistant" as const,
    content: message?.content ?? null,
    refusal: null,
  } as OpenAI.Chat.ChatCompletionMessage;
  const toolCalls = (message?.tool_calls ?? []).flatMap((toolCall, index) => {
    const name = toolCall.function?.name;
    if (!name) return [];
    return [{
      id: `ollama_call_${index}`,
      type: "function" as const,
      function: {
        name,
        arguments: JSON.stringify(toolCall.function?.arguments ?? {}),
      },
    }];
  });
  if (toolCalls.length > 0) {
    out.tool_calls = toolCalls;
  }
  return out;
}

async function emitOllamaUsage(
  request: ChatRequest,
  response: OllamaResponse,
): Promise<void> {
  const usage = ollamaUsageToChatUsage(response);
  if (usage) {
    await request.onUsage?.(usage);
  }
}

function ollamaUsageToChatUsage(response: OllamaResponse): ChatUsage | undefined {
  if (response.prompt_eval_count === undefined && response.eval_count === undefined) return undefined;
  const inputTokens = response.prompt_eval_count;
  const outputTokens = response.eval_count;
  return {
    inputTokens,
    outputTokens,
    totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function safeJsonParse(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
