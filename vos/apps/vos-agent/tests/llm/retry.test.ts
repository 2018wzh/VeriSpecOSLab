import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import type { ChatClient, ChatRequest } from "../../app/agent/loop.ts";
import { withRetryingChatClient } from "../../app/llm/retry.ts";
import { textResponse } from "../helpers/stub-chat.ts";

function request(): ChatRequest {
  return {
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
  };
}

describe("withRetryingChatClient", () => {
  test("retries failed chat calls and returns the eventual response", async () => {
    let calls = 0;
    const base: ChatClient = {
      async chat() {
        calls++;
        if (calls === 1) throw new Error("temporary outage");
        return textResponse("ok") as OpenAI.Chat.ChatCompletionMessage;
      },
    };

    const chat = withRetryingChatClient(base, {
      maxRetries: 1,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });

    await expect(chat.chat(request())).resolves.toMatchObject({ content: "ok" });
    expect(calls).toBe(2);
  });

  test("does not retry streaming requests to avoid duplicate deltas", async () => {
    let calls = 0;
    const base: ChatClient = {
      async chat() {
        calls++;
        throw new Error("stream failed after partial output");
      },
    };
    const chat = withRetryingChatClient(base, {
      maxRetries: 3,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });

    await expect(chat.chat({ ...request(), onEvent() {} })).rejects.toThrow(/stream failed/);
    expect(calls).toBe(1);
  });

  test("does not retry aborted requests", async () => {
    let calls = 0;
    const base: ChatClient = {
      async chat() {
        calls++;
        const error = new Error("operation aborted");
        error.name = "AbortError";
        throw error;
      },
    };
    const chat = withRetryingChatClient(base, {
      maxRetries: 3,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });

    await expect(chat.chat(request())).rejects.toThrow(/operation aborted/);
    expect(calls).toBe(1);
  });

  test("delegates capabilities unchanged", () => {
    const base: ChatClient = {
      capabilities() {
        return { input: { text: true, image: true, pdf: false } };
      },
      async chat() {
        return textResponse("unused") as OpenAI.Chat.ChatCompletionMessage;
      },
    };

    const chat = withRetryingChatClient(base, {
      maxRetries: 1,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(chat.capabilities?.("test-model")).toEqual({
      input: { text: true, image: true, pdf: false },
    });
  });
});
