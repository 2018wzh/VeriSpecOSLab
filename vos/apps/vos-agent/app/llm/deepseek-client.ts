import OpenAI from "openai";
import { defineChatClientCapabilities } from "../agent/loop.ts";
import type {
  ChatUsage,
  ChatClient,
  ChatClientCapabilities,
  ChatRequest,
} from "../agent/loop.ts";
import type { ReasoningEffort } from "../config.ts";

export interface DeepSeekProviderConfig {
  apiKey: string;
  baseURL?: string;
  betaBaseURL?: string;
  /** Max retries on transient errors. SDK default is 2; pass 0 to disable. */
  maxRetries?: number;
}

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

const DEEPSEEK_CHAT_CAPABILITIES: ChatClientCapabilities =
  defineChatClientCapabilities({ text: true, image: false, pdf: false });

type StreamingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type DeepSeekUsage = OpenAI.Completions.CompletionUsage & {
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * DeepSeek is OpenAI-compatible, but not OpenAI-identical:
 * json_schema response_format is rejected, while JSON Output uses json_object.
 */
export function createDeepSeekChatClient(
  config: DeepSeekProviderConfig,
): ChatClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL ?? DEFAULT_DEEPSEEK_BASE_URL,
    ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
  });
  return {
    capabilities() {
      return DEEPSEEK_CHAT_CAPABILITIES;
    },

    async chat(request: ChatRequest) {
      if (request.onEvent) {
        return await streamChatCompletion(client, request);
      }

      let response: OpenAI.Chat.ChatCompletion;
      try {
        const body = deepSeekChatBody(request) as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
        response = await client.chat.completions.create(body, request.signal ? { signal: request.signal } : undefined);
      } catch (e) {
        throw new Error(
          `DeepSeek chat request failed for model "${request.model}": ${formatError(e)}`,
          { cause: e },
        );
      }
      if (!response.choices || response.choices.length === 0) {
        throw new Error(
          `DeepSeek chat request for model "${request.model}" returned no choices`,
        );
      }
      await emitDeepSeekUsage(request, response.usage);
      return response.choices[0].message;
    },
  };
}

type DeepSeekChatBody = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
  reasoning_effort?: "high" | "max";
};

function deepSeekChatBody(request: ChatRequest): DeepSeekChatBody {
  return {
    model: request.model,
    ...(deepSeekReasoningEffort(request.reasoningEffort)
      ? { reasoning_effort: deepSeekReasoningEffort(request.reasoningEffort) }
      : {}),
    messages: request.messages,
    tools: request.tools,
    ...(deepSeekResponseFormat(request.responseFormat)
      ? { response_format: deepSeekResponseFormat(request.responseFormat) }
      : {}),
  } as DeepSeekChatBody;
}

function deepSeekReasoningEffort(effort: ReasoningEffort | undefined): "high" | "max" | undefined {
  if (effort === "xhigh") return "max";
  if (effort === "low" || effort === "medium" || effort === "high") return "high";
  return undefined;
}

function deepSeekResponseFormat(responseFormat: unknown): unknown {
  if (!responseFormat || typeof responseFormat !== "object") return undefined;
  const type = (responseFormat as { type?: unknown }).type;
  if (type === "json_schema" || type === "json_object") {
    return { type: "json_object" };
  }
  if (type === "text") {
    return { type: "text" };
  }
  return undefined;
}

async function streamChatCompletion(
  client: OpenAI,
  request: ChatRequest,
): Promise<OpenAI.Chat.ChatCompletionMessage> {
  const contentParts: string[] = [];
  const refusalParts: string[] = [];
  const toolCalls = new Map<number, StreamingToolCall>();
  let usage: ChatUsage | undefined;

  try {
    const body = {
      ...deepSeekChatBody(request),
      stream: true,
      ...(request.onUsage ? { stream_options: { include_usage: true } } : {}),
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming;
    const stream = await client.chat.completions.create(body, request.signal ? { signal: request.signal } : undefined);

    for await (const chunk of stream) {
      usage = deepSeekUsageToChatUsage(chunk.usage as DeepSeekUsage | null | undefined) ?? usage;
      const choice = chunk.choices[0];
      if (!choice) {
        continue;
      }

      const delta = choice.delta;
      if (delta.content) {
        contentParts.push(delta.content);
        await request.onEvent?.({ type: "text.delta", delta: delta.content });
      }
      if (delta.refusal) {
        refusalParts.push(delta.refusal);
      }
      for (const toolCall of delta.tool_calls ?? []) {
        const existing = toolCalls.get(toolCall.index) ?? { id: "", name: "", arguments: "" };
        toolCalls.set(toolCall.index, {
          id: toolCall.id ?? existing.id,
          name: toolCall.function?.name ? `${existing.name}${toolCall.function.name}` : existing.name,
          arguments: toolCall.function?.arguments
            ? `${existing.arguments}${toolCall.function.arguments}`
            : existing.arguments,
        });
      }
    }
  } catch (e) {
    throw new Error(
      `DeepSeek chat request failed for model "${request.model}": ${formatError(e)}`,
      { cause: e },
    );
  }

  const message = {
    role: "assistant" as const,
    content: contentParts.length > 0 ? contentParts.join("") : null,
    refusal: refusalParts.length > 0 ? refusalParts.join("") : null,
  } as OpenAI.Chat.ChatCompletionMessage;
  const assembledToolCalls = Array.from(toolCalls.entries())
    .sort(([left], [right]) => left - right)
    .flatMap(([, toolCall]) => {
      if (!toolCall.name) {
        return [];
      }
      return [{
        id: toolCall.id,
        type: "function" as const,
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      }];
    });

  if (assembledToolCalls.length > 0) {
    message.tool_calls = assembledToolCalls;
  }

  if (usage) {
    await request.onUsage?.(usage);
  }

  return message;
}

async function emitDeepSeekUsage(
  request: ChatRequest,
  usage: OpenAI.Completions.CompletionUsage | undefined,
): Promise<void> {
  const normalized = deepSeekUsageToChatUsage(usage as DeepSeekUsage | undefined);
  if (normalized) {
    await request.onUsage?.(normalized);
  }
}

function deepSeekUsageToChatUsage(
  usage: DeepSeekUsage | null | undefined,
): ChatUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cachedInputTokens: usage.prompt_cache_hit_tokens,
    cacheCreationInputTokens: usage.prompt_cache_miss_tokens,
  };
}
