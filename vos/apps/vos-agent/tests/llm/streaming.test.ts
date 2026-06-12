import { describe, expect, test } from "bun:test";
import { createAnthropicChatClient } from "../../app/llm/anthropic-client.ts";
import { createOpenAIChatClient } from "../../app/llm/openai-client.ts";

function openAISse(events: readonly string[]): string {
  return events.map((event) => `data: ${event}`).join("\n\n") + "\n\n";
}

function anthropicSse(events: readonly { name: string; data: string }[]): string {
  return events
    .map((event) => `event: ${event.name}\ndata: ${event.data}`)
    .join("\n\n") + "\n\n";
}

describe("provider response streaming", () => {
  test("OpenAI-compatible streaming emits text deltas and returns the assembled message", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
        return new Response(openAISse([
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "gpt5.5",
            choices: [{ index: 0, delta: { role: "assistant", content: "he" }, finish_reason: null }],
          }),
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "gpt5.5",
            choices: [{ index: 0, delta: { content: "llo" }, finish_reason: null }],
          }),
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "gpt5.5",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }),
          "[DONE]",
        ]), { headers: { "content-type": "text/event-stream" } });
      },
    });

    try {
      const chat = createOpenAIChatClient({
        apiKey: "fake",
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        maxRetries: 0,
      });
      const deltas: string[] = [];

      const message = await chat.chat({
        model: "gpt5.5",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        onEvent: (event) => {
          deltas.push(event.delta);
        },
      });

      expect(bodies[0]).toMatchObject({ model: "gpt5.5", stream: true });
      expect(deltas).toEqual(["he", "llo"]);
      expect(message).toMatchObject({ role: "assistant", content: "hello" });
    } finally {
      await server.stop(true);
    }
  });

  test("OpenAI-compatible streaming preserves tool call chunks", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        await req.json();
        return new Response(openAISse([
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "gpt5.5",
            choices: [{ index: 0, delta: { role: "assistant", content: "Checking." }, finish_reason: null }],
          }),
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "gpt5.5",
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "Read", arguments: "{\"file" },
                }],
              },
              finish_reason: null,
            }],
          }),
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "gpt5.5",
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: "_path\":\"README.md\"}" },
                }],
              },
              finish_reason: null,
            }],
          }),
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "gpt5.5",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          }),
          "[DONE]",
        ]), { headers: { "content-type": "text/event-stream" } });
      },
    });

    try {
      const chat = createOpenAIChatClient({
        apiKey: "fake",
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        maxRetries: 0,
      });
      const deltas: string[] = [];

      const message = await chat.chat({
        model: "gpt5.5",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        onEvent: (event) => {
          deltas.push(event.delta);
        },
      });

      expect(deltas).toEqual(["Checking."]);
      expect(message.tool_calls).toEqual([{
        id: "call_1",
        type: "function",
        function: {
          name: "Read",
          arguments: "{\"file_path\":\"README.md\"}",
        },
      }]);
    } finally {
      await server.stop(true);
    }
  });

  test("Anthropic-compatible streaming emits text deltas and returns the assembled message", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
        return new Response(anthropicSse([
          {
            name: "message_start",
            data: JSON.stringify({
              type: "message_start",
              message: {
                id: "msg_test",
                type: "message",
                role: "assistant",
                model: "sonnet4.6",
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 0 },
              },
            }),
          },
          {
            name: "content_block_start",
            data: JSON.stringify({
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            }),
          },
          {
            name: "content_block_delta",
            data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "he" } }),
          },
          {
            name: "content_block_delta",
            data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "llo" } }),
          },
          {
            name: "content_block_stop",
            data: JSON.stringify({ type: "content_block_stop", index: 0 }),
          },
          {
            name: "message_delta",
            data: JSON.stringify({
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: 2 },
            }),
          },
          { name: "message_stop", data: JSON.stringify({ type: "message_stop" }) },
        ]), { headers: { "content-type": "text/event-stream" } });
      },
    });

    try {
      const chat = createAnthropicChatClient({
        authToken: "fake",
        baseURL: `http://127.0.0.1:${server.port}`,
        maxRetries: 0,
      });
      const deltas: string[] = [];

      const message = await chat.chat({
        model: "sonnet4.6",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        onEvent: (event) => {
          deltas.push(event.delta);
        },
      });

      expect(bodies[0]).toMatchObject({ model: "sonnet4.6", stream: true });
      expect(deltas).toEqual(["he", "llo"]);
      expect(message).toMatchObject({ role: "assistant", content: "hello" });
    } finally {
      await server.stop(true);
    }
  });
});
