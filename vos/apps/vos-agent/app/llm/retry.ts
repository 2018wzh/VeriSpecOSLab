import type { ChatClient, ChatRequest } from "../agent/loop.ts";
import { isAbortError, sleep, throwIfAborted } from "../cancellation.ts";

export interface ChatRetryOptions {
  /** Number of retries after the first failed attempt. */
  maxRetries: number;
  /** First retry delay in milliseconds. */
  initialDelayMs?: number;
  /** Maximum retry delay in milliseconds. */
  maxDelayMs?: number;
}

export const DEFAULT_CHAT_RETRY_OPTIONS: Required<ChatRetryOptions> = Object.freeze({
  maxRetries: 0,
  initialDelayMs: 200,
  maxDelayMs: 2_000,
});

export function withRetryingChatClient(
  client: ChatClient,
  options: ChatRetryOptions | undefined,
): ChatClient {
  const retry = normalizeChatRetryOptions(options);
  if (retry.maxRetries <= 0) return client;
  return {
    ...(client.capabilities
      ? {
          capabilities(model: string) {
            return client.capabilities!(model);
          },
        }
      : {}),

    async chat(request: ChatRequest) {
      throwIfAborted(request.signal);
      if (request.onEvent) {
        // Streaming may already have emitted deltas before a failure. Retrying
        // would duplicate user-visible text, so leave retries to the provider SDK.
        return await client.chat(request);
      }

      let attempt = 0;
      while (true) {
        try {
          return await client.chat(request);
        } catch (e) {
          throwIfAborted(request.signal);
          if (
            attempt >= retry.maxRetries ||
            isAbortError(e) ||
            !isRetryableChatError(e)
          ) {
            throw e;
          }
          attempt++;
          await sleep(retryDelayMs(retry, attempt), request.signal);
        }
      }
    },
  };
}

function normalizeChatRetryOptions(
  options: ChatRetryOptions | undefined,
): Required<ChatRetryOptions> {
  return {
    maxRetries: Math.max(
      0,
      Math.trunc(options?.maxRetries ?? DEFAULT_CHAT_RETRY_OPTIONS.maxRetries),
    ),
    initialDelayMs: Math.max(
      0,
      Math.trunc(options?.initialDelayMs ?? DEFAULT_CHAT_RETRY_OPTIONS.initialDelayMs),
    ),
    maxDelayMs: Math.max(
      0,
      Math.trunc(options?.maxDelayMs ?? DEFAULT_CHAT_RETRY_OPTIONS.maxDelayMs),
    ),
  };
}

function retryDelayMs(retry: Required<ChatRetryOptions>, attempt: number): number {
  return Math.min(
    retry.maxDelayMs,
    retry.initialDelayMs * 2 ** Math.max(0, attempt - 1),
  );
}

function isRetryableChatError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const message = error.message;
  if (/no chat client registered/.test(message)) return false;
  if (/provider is not configured/.test(message)) return false;
  return true;
}
