import { describe, expect, test } from "bun:test";
import { chatClientCapabilities } from "../../app/agent/loop.ts";
import { createChatClientFromConfig } from "../../app/llm/providers.ts";

// Use an unreachable URL + maxRetries:0 so the underlying SDKs fail
// fast at connect. We only care that the router resolved a backend.
const DEAD_URL = "http://127.0.0.1:1/";

function fakeProvider() {
  return { apiKey: "fake", baseURL: DEAD_URL, maxRetries: 0 };
}

function fakeBearerProvider() {
  return { authToken: "fake", baseURL: DEAD_URL, maxRetries: 0 };
}

function emptyRequest(model: string) {
  return {
    model,
    messages: [{ role: "user" as const, content: "x" }],
    tools: [],
  };
}

function readBodyModel(body: unknown): unknown {
  return (body as { model?: unknown }).model;
}

describe("createChatClientFromConfig", () => {
  test("router throws a clear error when no provider serves the model", async () => {
    const chat = createChatClientFromConfig({
      defaultMode: "smart", modes: { smart: { model: "x" }, deep: { model: "y" } },
      tools: { disabled: [] },
      anthropic: fakeProvider(),
      openai: fakeProvider(),
    });
    await expect(chat.chat(emptyRequest("mistral-large"))).rejects.toThrow(
      /no chat client registered for model "mistral-large"/,
    );
  });

  test("with both providers, claude* dispatches without router error", async () => {
    const chat = createChatClientFromConfig({
      defaultMode: "smart", modes: { smart: { model: "x" }, deep: { model: "y" } },
      tools: { disabled: [] },
      openai: fakeProvider(),
      anthropic: fakeProvider(),
    });
    await expect(
      chat.chat(emptyRequest("claude-haiku-4-5")),
    ).rejects.not.toThrow(/no chat client registered/);
  });

  test("with both providers, gpt-* dispatches without router error", async () => {
    const chat = createChatClientFromConfig({
      defaultMode: "smart", modes: { smart: { model: "x" }, deep: { model: "y" } },
      tools: { disabled: [] },
      openai: fakeProvider(),
      anthropic: fakeProvider(),
    });
    await expect(chat.chat(emptyRequest("gpt-4o-mini"))).rejects.not.toThrow(
      /no chat client registered/,
    );
  });

  test("advertises provider input capabilities through the routed client", () => {
    const chat = createChatClientFromConfig({
      defaultMode: "smart", modes: { smart: { model: "x" }, deep: { model: "y" } },
      tools: { disabled: [] },
      openai: fakeProvider(),
      anthropic: fakeProvider(),
    });

    expect(chatClientCapabilities(chat, "gpt-4o-mini").input).toEqual({
      text: true,
      image: true,
      pdf: true,
    });
    expect(chatClientCapabilities(chat, "claude-haiku-4-5").input).toEqual({
      text: true,
      image: true,
      pdf: true,
    });
  });

  test("with both providers, Stars default model names dispatch to the expected provider", async () => {
    const openaiBodies: unknown[] = [];
    const anthropicBodies: unknown[] = [];
    const openaiServer = Bun.serve({
      port: 0,
      async fetch(req) {
        openaiBodies.push(await req.json());
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
    const anthropicServer = Bun.serve({
      port: 0,
      async fetch(req) {
        anthropicBodies.push(await req.json());
        return Response.json({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "opus4.7",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });

    try {
      const chat = createChatClientFromConfig({
        defaultMode: "smart",
        modes: {
          smart: { model: "opus4.7" },
          rush: { model: "sonnet4.6", reasoningEffort: "medium" },
          deep: { model: "gpt5.5" },
        },
        tools: { disabled: [] },
        openai: {
          apiKey: "fake",
          baseURL: `http://127.0.0.1:${openaiServer.port}/v1`,
          maxRetries: 0,
        },
        anthropic: {
          authToken: "fake",
          baseURL: `http://127.0.0.1:${anthropicServer.port}`,
          maxRetries: 0,
        },
      });

      await chat.chat(emptyRequest("gpt5.5"));
      await chat.chat(emptyRequest("opus4.7"));
      await chat.chat(emptyRequest("sonnet4.6"));

      expect(openaiBodies.map(readBodyModel)).toEqual(["gpt5.5"]);
      expect(anthropicBodies.map(readBodyModel)).toEqual([
        "opus4.7",
        "sonnet4.6",
      ]);
    } finally {
      await openaiServer.stop(true);
      await anthropicServer.stop(true);
    }
  });

  test("applies provider-neutral retry above routing", async () => {
    const openaiBodies: unknown[] = [];
    const openaiServer = Bun.serve({
      port: 0,
      async fetch(req) {
        openaiBodies.push(await req.json());
        if (openaiBodies.length === 1) {
          return Response.json({ error: { message: "temporary" } }, { status: 500 });
        }
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
      const chat = createChatClientFromConfig({
        defaultMode: "smart",
        modes: { smart: { model: "gpt5.5" }, deep: { model: "gpt5.5" } },
        tools: { disabled: [] },
        chatRetry: { maxRetries: 1, initialDelayMs: 0, maxDelayMs: 0 },
        openai: {
          apiKey: "fake",
          baseURL: `http://127.0.0.1:${openaiServer.port}/v1`,
          maxRetries: 0,
        },
      });

      await expect(chat.chat(emptyRequest("gpt5.5"))).resolves.toMatchObject({
        content: "ok",
      });
      expect(openaiBodies).toHaveLength(2);
    } finally {
      await openaiServer.stop(true);
    }
  });

  test("passes optional JSON schema response format to OpenAI-compatible provider", async () => {
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
      const chat = createChatClientFromConfig({
        defaultMode: "deep",
        modes: { deep: { model: "gpt5.5" } },
        tools: { disabled: [] },
        openai: {
          apiKey: "fake",
          baseURL: `http://127.0.0.1:${server.port}/v1`,
          maxRetries: 0,
        },
      });

      await chat.chat({
        ...emptyRequest("gpt5.5"),
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "report_narrative_v1",
            strict: true,
            schema: {
              type: "object",
              properties: { summary: { type: "string" } },
              required: ["summary"],
              additionalProperties: false,
            },
          },
        },
      });

      expect((bodies[0] as { response_format?: unknown }).response_format).toEqual({
        type: "json_schema",
        json_schema: {
          name: "report_narrative_v1",
          strict: true,
          schema: {
            type: "object",
            properties: { summary: { type: "string" } },
            required: ["summary"],
            additionalProperties: false,
          },
        },
      });
    } finally {
      await server.stop(true);
    }
  });

  test("with only Anthropic configured, an unknown model falls back to it", async () => {
    const chat = createChatClientFromConfig({
      defaultMode: "smart", modes: { smart: { model: "x" }, deep: { model: "y" } },
      tools: { disabled: [] },
      anthropic: fakeProvider(),
    });
    // No throw from the router; whatever Anthropic returns/throws is fine.
    await expect(
      chat.chat(emptyRequest("some-other-model")),
    ).rejects.not.toThrow(/no chat client registered/);
  });

  test("single-provider fallback does not send known Anthropic models to OpenAI", async () => {
    const chat = createChatClientFromConfig({
      defaultMode: "smart", modes: { smart: { model: "x" }, deep: { model: "y" } },
      tools: { disabled: [] },
      openai: fakeProvider(),
    });
    await expect(chat.chat(emptyRequest("claude-haiku-4-5"))).rejects.toThrow(
      /Anthropic provider is not configured.*ANTHROPIC_API_KEY/,
    );
  });

  test("single-provider fallback does not send known OpenAI models to Anthropic", async () => {
    const chat = createChatClientFromConfig({
      defaultMode: "smart", modes: { smart: { model: "x" }, deep: { model: "y" } },
      tools: { disabled: [] },
      anthropic: fakeProvider(),
    });
    await expect(chat.chat(emptyRequest("gpt-5"))).rejects.toThrow(
      /OpenAI provider is not configured.*OPENAI_API_KEY/,
    );
  });

  test("capability lookup for a known unconfigured provider throws clearly", () => {
    const chat = createChatClientFromConfig({
      defaultMode: "smart", modes: { smart: { model: "x" }, deep: { model: "y" } },
      tools: { disabled: [] },
      openai: fakeProvider(),
    });

    expect(() => chatClientCapabilities(chat, "claude-haiku-4-5")).toThrow(
      /Anthropic provider is not configured.*ANTHROPIC_API_KEY/,
    );
  });

  test("colon provider routing prefixes are stripped before SDK calls", async () => {
    const chat = createChatClientFromConfig({
      defaultMode: "smart", modes: { smart: { model: "x" }, deep: { model: "y" } },
      tools: { disabled: [] },
      openai: fakeProvider(),
    });
    await expect(
      chat.chat(emptyRequest("openai:gpt-4o-mini")),
    ).rejects.toThrow(/OpenAI chat request failed for model "gpt-4o-mini"/);
  });

  test("slash provider namespace prefixes are preserved before SDK calls", async () => {
    const openaiBodies: unknown[] = [];
    const anthropicBodies: unknown[] = [];
    const openaiServer = Bun.serve({
      port: 0,
      async fetch(req) {
        openaiBodies.push(await req.json());
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "openai/gpt-4o-mini",
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "ok" },
          }],
        });
      },
    });
    const anthropicServer = Bun.serve({
      port: 0,
      async fetch(req) {
        anthropicBodies.push(await req.json());
        return Response.json({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "anthropic/claude-opus-4.6",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });

    try {
      const chat = createChatClientFromConfig({
        defaultMode: "smart",
        modes: { smart: { model: "x" }, deep: { model: "y" } },
        tools: { disabled: [] },
        openai: {
          apiKey: "fake",
          baseURL: `http://127.0.0.1:${openaiServer.port}/v1`,
          maxRetries: 0,
        },
        anthropic: {
          authToken: "fake",
          baseURL: `http://127.0.0.1:${anthropicServer.port}`,
          maxRetries: 0,
        },
      });

      await chat.chat(emptyRequest("openai/gpt-4o-mini"));
      await chat.chat(emptyRequest("anthropic/claude-opus-4.6"));

      expect(openaiBodies.map(readBodyModel)).toEqual(["openai/gpt-4o-mini"]);
      expect(anthropicBodies.map(readBodyModel)).toEqual([
        "anthropic/claude-opus-4.6",
      ]);
    } finally {
      await openaiServer.stop(true);
      await anthropicServer.stop(true);
    }
  });

  test("Anthropic auth-token provider can route smart-mode gpt-5.5", async () => {
    const chat = createChatClientFromConfig({
      defaultMode: "smart",
      modes: {
        smart: { model: "anthropic:gpt-5.5" },
        deep: { model: "y" },
      },
      tools: { disabled: [] },
      anthropic: fakeBearerProvider(),
    });
    await expect(
      chat.chat(emptyRequest("anthropic:gpt-5.5")),
    ).rejects.toThrow(/Anthropic chat request failed for model "gpt-5.5"/);
  });
});
