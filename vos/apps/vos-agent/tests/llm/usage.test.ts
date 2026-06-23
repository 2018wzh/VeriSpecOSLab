import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ChatUsage } from "../../app/agent/loop.ts";
import { createAnthropicChatClient } from "../../app/llm/anthropic-client.ts";
import { createOpenAIChatClient } from "../../app/llm/openai-client.ts";
import { runSessionTurn } from "../../app/session/run-turn.ts";
import { ThreadStore } from "../../app/session/thread-store.ts";
import { addModelUsage, emptyThreadUsage } from "../../app/session/usage.ts";
import { CallbackChatClient, textResponse } from "../helpers/stub-chat.ts";
import { makeTmpDir, removeTmpDir } from "../helpers/tmp.ts";

describe("provider usage reporting", () => {
  test("OpenAI-compatible responses emit normalized usage", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        await req.json();
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "gpt5.5",
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "ok" },
          }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 5,
            total_tokens: 17,
            prompt_tokens_details: { cached_tokens: 3 },
          },
        });
      },
    });

    try {
      const chat = createOpenAIChatClient({
        apiKey: "fake",
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        maxRetries: 0,
      });
      const usage: ChatUsage[] = [];
      await chat.chat({
        model: "gpt5.5",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        onUsage: (event) => {
          usage.push(event);
        },
      });

      expect(usage).toEqual([{
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
        cachedInputTokens: 3,
      }]);
    } finally {
      await server.stop(true);
    }
  });

  test("Anthropic responses emit normalized usage", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        await req.json();
        return Response.json({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "sonnet4.6",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 12,
            cache_creation_input_tokens: 8,
          },
        });
      },
    });

    try {
      const chat = createAnthropicChatClient({
        authToken: "fake",
        baseURL: `http://127.0.0.1:${server.port}`,
        maxRetries: 0,
      });
      const usage: ChatUsage[] = [];
      await chat.chat({
        model: "sonnet4.6",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        onUsage: (event) => {
          usage.push(event);
        },
      });

      expect(usage).toEqual([{
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cachedInputTokens: 12,
        cacheCreationInputTokens: 8,
      }]);
    } finally {
      await server.stop(true);
    }
  });
});

describe("session usage persistence", () => {
  test("aggregates model aliases into the normalized model usage record", () => {
    const usage = emptyThreadUsage();

    addModelUsage(usage, "anthropic:sonnet4.6", {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    addModelUsage(usage, "sonnet4.6", {
      inputTokens: 20,
      outputTokens: 6,
      totalTokens: 26,
    });

    expect(usage.byModel).toHaveLength(1);
    expect(usage.byModel[0]).toMatchObject({
      model: "anthropic:sonnet4.6",
      inputTokens: 30,
      outputTokens: 11,
      totalTokens: 41,
      lastContextWindowUsage: 0.0001,
    });
  });

  test("persists model usage totals, context window percentage, and estimated cost", async () => {
    const tmp = makeTmpDir("vos-usage-");
    try {
      const store = new ThreadStore({
        stateDir: join(tmp, ".vos-agent"),
        workspaceRoot: tmp,
        idGenerator: () => "T-usage",
        now: () => new Date("2026-06-03T12:00:00.000Z"),
      });
      const events: string[] = [];
      const chat = new CallbackChatClient(async (request) => {
        await request.onUsage?.({
          inputTokens: 1_000,
          outputTokens: 2_000,
          totalTokens: 3_000,
        });
        return textResponse("done");
      });

      const result = await runSessionTurn({
        chat,
        store,
        workspaceRoot: tmp,
        prompt: "track usage",
        model: "sonnet4.6",
        onEvent: (event) => {
          if (event.type === "model.usage") {
            events.push(`${event.model}:${event.inputTokens}:${event.outputTokens}`);
            expect(event.contextWindowUsage).toBe(0.005);
            expect(event.estimatedCostUsd).toBeCloseTo(0.033, 6);
          }
        },
      });

      expect(events).toEqual(["sonnet4.6:1000:2000"]);
      expect(result.thread.usage).toMatchObject({
        inputTokens: 1_000,
        outputTokens: 2_000,
        totalTokens: 3_000,
        estimatedCostUsd: expect.closeTo(0.033, 6),
        byModel: [{
          model: "sonnet4.6",
          provider: "anthropic",
          inputTokens: 1_000,
          outputTokens: 2_000,
          totalTokens: 3_000,
          contextWindowTokens: 200_000,
          lastContextWindowUsage: 0.005,
          estimatedCostUsd: expect.closeTo(0.033, 6),
        }],
      });
      expect(store.load("T-usage").usage).toEqual(result.thread.usage);
    } finally {
      removeTmpDir(tmp);
    }
  });
});
