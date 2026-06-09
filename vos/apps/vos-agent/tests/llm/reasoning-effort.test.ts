import { describe, expect, test } from "bun:test";
import { createAnthropicChatClient } from "../../app/llm/anthropic-client.ts";
import { createOpenAIChatClient } from "../../app/llm/openai-client.ts";

describe("reasoning effort provider forwarding", () => {
  test("OpenAI-compatible requests include reasoning_effort when configured", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
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
        });
      },
    });

    try {
      const chat = createOpenAIChatClient({
        apiKey: "fake",
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        maxRetries: 0,
      });
      await chat.chat({
        model: "gpt5.5",
        reasoningEffort: "high",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      });
      expect(bodies[0]).toMatchObject({ reasoning_effort: "high" });
    } finally {
      await server.stop(true);
    }
  });

  test("Anthropic-compatible requests include reasoning_effort when configured", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
        return Response.json({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "sonnet4.6",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });

    try {
      const chat = createAnthropicChatClient({
        authToken: "fake",
        baseURL: `http://127.0.0.1:${server.port}`,
        maxRetries: 0,
      });
      await chat.chat({
        model: "sonnet4.6",
        reasoningEffort: "medium",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      });
      expect(bodies[0]).toMatchObject({ reasoning_effort: "medium" });
    } finally {
      await server.stop(true);
    }
  });
});
