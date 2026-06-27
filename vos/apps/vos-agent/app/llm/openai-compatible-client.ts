import OpenAI from "openai";
import { defineChatClientCapabilities } from "../agent/loop.ts";
import type {
  ChatUsage,
  ChatClient,
  ChatClientCapabilities,
  ChatInputCapabilities,
  ChatRequest,
} from "../agent/loop.ts";
import type {
  OpenAICompatibleReasoningEffort,
  OpenAICompatibleResponseFormat,
  OpenAICompatibleStreamUsage,
  ReasoningEffort,
} from "../config.ts";

export interface OpenAICompatibleProviderConfig {
  apiKey: string;
  baseURL?: string;
  responseFormat: OpenAICompatibleResponseFormat;
  reasoningEffort: OpenAICompatibleReasoningEffort;
  streamUsage: OpenAICompatibleStreamUsage;
  input: ChatInputCapabilities;
  extraHeaders?: Record<string, string>;
  /** Max retries on transient errors. SDK default is 2; pass 0 to disable. */
  maxRetries?: number;
}

type StreamingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type OpenAICompatibleChatBody = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
  reasoning_effort?: ReasoningEffort;
};

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createOpenAICompatibleChatClient(
  config: OpenAICompatibleProviderConfig,
): ChatClient {
  const capabilities: ChatClientCapabilities = defineChatClientCapabilities(config.input);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.extraHeaders,
    ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
  });
  return {
    capabilities() {
      return capabilities;
    },

    async chat(request: ChatRequest) {
      if (request.onEvent) {
        return await streamChatCompletion(client, config, request);
      }

      let response: OpenAI.Chat.ChatCompletion;
      try {
        const body = openAICompatibleChatBody(config, request);
        response = await client.chat.completions.create(body, request.signal ? { signal: request.signal } : undefined);
      } catch (e) {
        throw new Error(
          `OpenAI-compatible chat request failed for model "${request.model}": ${formatError(e)}`,
          { cause: e },
        );
      }
      if (!response.choices || response.choices.length === 0) {
        throw new Error(
          `OpenAI-compatible chat request for model "${request.model}" returned no choices`,
        );
      }
      await emitUsage(request, response.usage);
      return response.choices[0].message;
    },
  };
}

function openAICompatibleChatBody(
  config: OpenAICompatibleProviderConfig,
  request: ChatRequest,
): OpenAICompatibleChatBody {
  return {
    model: request.model,
    ...(config.reasoningEffort === "passthrough" && request.reasoningEffort
      ? { reasoning_effort: request.reasoningEffort }
      : {}),
    messages: request.messages,
    tools: request.tools,
    ...(compatibleResponseFormat(config.responseFormat, request.responseFormat)
      ? { response_format: compatibleResponseFormat(config.responseFormat, request.responseFormat) }
      : {}),
  } as OpenAICompatibleChatBody;
}

function compatibleResponseFormat(
  mode: OpenAICompatibleResponseFormat,
  responseFormat: unknown,
): unknown {
  if (mode === "none" || !responseFormat || typeof responseFormat !== "object") return undefined;
  const type = (responseFormat as { type?: unknown }).type;
  if (mode === "json_object" && (type === "json_schema" || type === "json_object")) {
    return { type: "json_object" };
  }
  if (mode === "json_schema") {
    return responseFormat;
  }
  return undefined;
}

async function streamChatCompletion(
  client: OpenAI,
  config: OpenAICompatibleProviderConfig,
  request: ChatRequest,
): Promise<OpenAI.Chat.ChatCompletionMessage> {
  const contentParts: string[] = [];
  const refusalParts: string[] = [];
  const toolCalls = new Map<number, StreamingToolCall>();
  let usage: ChatUsage | undefined;

  try {
    const body = {
      ...openAICompatibleChatBody(config, request),
      stream: true,
      ...(config.streamUsage === "include_usage" && request.onUsage
        ? { stream_options: { include_usage: true } }
        : {}),
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming;
    const stream = await client.chat.completions.create(body, request.signal ? { signal: request.signal } : undefined);

    for await (const chunk of stream) {
      usage = usageToChatUsage(chunk.usage) ?? usage;
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
      `OpenAI-compatible chat request failed for model "${request.model}": ${formatError(e)}`,
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

async function emitUsage(
  request: ChatRequest,
  usage: OpenAI.Completions.CompletionUsage | undefined,
): Promise<void> {
  const normalized = usageToChatUsage(usage);
  if (normalized) {
    await request.onUsage?.(normalized);
  }
}

function usageToChatUsage(
  usage: OpenAI.Completions.CompletionUsage | null | undefined,
): ChatUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    ...(usage.prompt_tokens_details?.cached_tokens
      ? { cachedInputTokens: usage.prompt_tokens_details.cached_tokens }
      : {}),
  };
}
