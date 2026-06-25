import OpenAI from "openai";
import { defineChatClientCapabilities } from "../agent/loop.ts";
import type {
  ChatUsage,
  ChatClient,
  ChatClientCapabilities,
  ChatRequest,
} from "../agent/loop.ts";

export interface OpenAIProviderConfig {
  apiKey: string;
  /** Override for OpenAI-compatible endpoints (OpenRouter, vLLM, …). */
  baseURL?: string;
  /** Max retries on transient errors. SDK default is 2; pass 0 to disable. */
  maxRetries?: number;
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const OPENAI_CHAT_CAPABILITIES: ChatClientCapabilities =
  defineChatClientCapabilities({ text: true, image: true, pdf: true });

type StreamingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/**
 * Wrap an OpenAI-compatible HTTP client as a ChatClient.
 * The model is supplied per request, not per client.
 */
export function createOpenAIChatClient(
  config: OpenAIProviderConfig,
): ChatClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
  });
  return {
    capabilities() {
      return OPENAI_CHAT_CAPABILITIES;
    },

    async chat(request: ChatRequest) {
      if (request.onEvent) {
        return await streamChatCompletion(client, request);
      }

      let response: OpenAI.Chat.ChatCompletion;
      try {
        const body = {
          model: request.model,
          ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
          messages: request.messages,
          tools: request.tools,
          ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
        } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
        response = await client.chat.completions.create(body, request.signal ? { signal: request.signal } : undefined);
      } catch (e) {
        throw new Error(
          `OpenAI chat request failed for model "${request.model}": ${formatError(e)}`,
          { cause: e },
        );
      }
      if (!response.choices || response.choices.length === 0) {
        throw new Error(
          `OpenAI chat request for model "${request.model}" returned no choices`,
        );
      }
      await emitOpenAIUsage(request, response.usage);
      return response.choices[0].message;
    },
  };
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
      model: request.model,
      ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
      messages: request.messages,
      tools: request.tools,
      ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
      stream: true,
      ...(request.onUsage ? { stream_options: { include_usage: true } } : {}),
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming;
    const stream = await client.chat.completions.create(body, request.signal ? { signal: request.signal } : undefined);

    for await (const chunk of stream) {
      usage = openAIUsageToChatUsage(chunk.usage) ?? usage;
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
      `OpenAI chat request failed for model "${request.model}": ${formatError(e)}`,
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

async function emitOpenAIUsage(
  request: ChatRequest,
  usage: OpenAI.Completions.CompletionUsage | undefined,
): Promise<void> {
  const normalized = openAIUsageToChatUsage(usage);
  if (normalized) {
    await request.onUsage?.(normalized);
  }
}

function openAIUsageToChatUsage(
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
