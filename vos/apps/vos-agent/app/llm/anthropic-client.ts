import Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { defineChatClientCapabilities } from "../agent/loop.ts";
import type {
  ChatUsage,
  ChatClient,
  ChatClientCapabilities,
  ChatRequest,
} from "../agent/loop.ts";
import type { ReasoningEffort } from "../config.ts";
import {
  fromAnthropicMessage,
  toAnthropicRequest,
} from "./anthropic-translate.ts";

export const DEFAULT_ANTHROPIC_MAX_TOKENS = 8192;

const ANTHROPIC_MESSAGES_CAPABILITIES: ChatClientCapabilities =
  defineChatClientCapabilities({ text: true, image: true, pdf: true });

export interface AnthropicProviderConfig {
  apiKey?: string;
  /** Bearer token auth for Anthropic-compatible gateways. */
  authToken?: string;
  /** Override the Anthropic API base URL (proxies, self-hosted gateways). */
  baseURL?: string;
  /** Anthropic requires max_tokens; defaults to {@link DEFAULT_ANTHROPIC_MAX_TOKENS}. */
  maxTokens?: number;
  /** Max retries on transient errors. SDK default is 2; pass 0 to disable. */
  maxRetries?: number;
}

type AnthropicRequestBody = Anthropic.Messages.MessageCreateParamsNonStreaming & {
  /** Non-standard extension accepted by Anthropic-compatible gateways. */
  reasoning_effort?: ReasoningEffort;
};

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Wrap Anthropic's Messages API as a ChatClient. The wire format is
 * different from OpenAI; this adapter translates messages and tool
 * shapes at both boundaries so the agent loop can stay OpenAI-shaped.
 */
export function createAnthropicChatClient(
  config: AnthropicProviderConfig,
): ChatClient {
  const apiKey = config.apiKey?.trim() || undefined;
  const authToken = apiKey ? undefined : config.authToken?.trim() || undefined;
  if (!apiKey && !authToken) {
    throw new Error(
      "Anthropic provider requires either apiKey or authToken",
    );
  }

  const client = new Anthropic({
    apiKey: apiKey ?? null,
    authToken: authToken ?? null,
    baseURL: config.baseURL,
    ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
  });
  const maxTokens = config.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS;

  return {
    capabilities() {
      return ANTHROPIC_MESSAGES_CAPABILITIES;
    },

    async chat(request: ChatRequest) {
      try {
        const translated = toAnthropicRequest(request.messages, request.tools);
        const body: AnthropicRequestBody = {
          model: request.model,
          max_tokens: maxTokens,
          ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
          ...(translated.system ? { system: translated.system } : {}),
          messages: translated.messages,
          ...(translated.tools.length > 0 ? { tools: translated.tools } : {}),
        };
        if (request.onEvent) {
          return await streamAnthropicMessage(client, body, request);
        }

        const response = await client.messages.create(
          body,
          request.signal ? { signal: request.signal } : undefined,
        );
        await emitAnthropicUsage(request, response.usage);
        return fromAnthropicMessage(response);
      } catch (e) {
        throw new Error(
          `Anthropic chat request failed for model "${request.model}": ${formatError(e)}`,
          { cause: e },
        );
      }
    },
  };
}

async function streamAnthropicMessage(
  client: Anthropic,
  body: AnthropicRequestBody,
  request: ChatRequest,
): Promise<OpenAI.Chat.ChatCompletionMessage> {
  const stream = client.messages.stream(
    body as Anthropic.Messages.MessageStreamParams,
    request.signal ? { signal: request.signal } : undefined,
  );

  for await (const event of stream) {
    if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") {
      continue;
    }
    if (event.delta.text.length > 0) {
      await request.onEvent?.({ type: "text.delta", delta: event.delta.text });
    }
  }

  const message = await stream.finalMessage();
  await emitAnthropicUsage(request, message.usage);
  return fromAnthropicMessage(message);
}

async function emitAnthropicUsage(
  request: ChatRequest,
  usage: Anthropic.Messages.Usage | undefined,
): Promise<void> {
  if (!usage) return;
  await request.onUsage?.(anthropicUsageToChatUsage(usage));
}

function anthropicUsageToChatUsage(usage: Anthropic.Messages.Usage): ChatUsage {
  const cacheRead = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens;
  const cacheCreation = (usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    ...(cacheRead ? { cachedInputTokens: cacheRead } : {}),
    ...(cacheCreation ? { cacheCreationInputTokens: cacheCreation } : {}),
  };
}
