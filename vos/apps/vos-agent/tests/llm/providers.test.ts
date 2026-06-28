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

function fakeCompatibleProvider() {
  return {
    apiKey: "fake",
    baseURL: DEAD_URL,
    maxRetries: 0,
    responseFormat: "json_object" as const,
    reasoningEffort: "off" as const,
    streamUsage: "off" as const,
    input: { text: true, image: false, pdf: false },
  };
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
    await expect(chat.chat(emptyRequest("unknown-large"))).rejects.toThrow(
      /no chat client registered for model "unknown-large"/,
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

  test("passes optional JSON schema response format to official OpenAI provider", async () => {
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

  test("OpenAI-compatible provider defaults JSON schema response format to JSON object mode", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "llama",
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "{\"summary\":\"ok\"}" },
          }],
        });
      },
    });

    try {
      const chat = createChatClientFromConfig({
        defaultMode: "smart",
        modes: { smart: { model: "llama" } },
        tools: { disabled: [] },
        openaiCompatible: {
          apiKey: "fake",
          baseURL: `http://127.0.0.1:${server.port}/v1`,
          maxRetries: 0,
          responseFormat: "json_object",
          reasoningEffort: "off",
          streamUsage: "off",
          input: { text: true, image: false, pdf: false },
        },
      });

      await chat.chat({
        ...emptyRequest("compat:llama"),
        reasoningEffort: "high",
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "answer", strict: true, schema: { type: "object" } },
        },
      });

      expect((bodies[0] as { model?: unknown }).model).toBe("llama");
      expect((bodies[0] as { response_format?: unknown }).response_format).toEqual({
        type: "json_object",
      });
      expect((bodies[0] as { reasoning_effort?: unknown }).reasoning_effort).toBeUndefined();
    } finally {
      await server.stop(true);
    }
  });

  test("OpenAI-compatible provider can preserve or suppress response format", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "llama",
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "ok" },
          }],
        });
      },
    });

    try {
      const schemaFormat = {
        type: "json_schema",
        json_schema: { name: "answer", strict: true, schema: { type: "object" } },
      };
      for (const responseFormat of ["json_schema", "none"] as const) {
        const chat = createChatClientFromConfig({
          defaultMode: "smart",
          modes: { smart: { model: "llama" } },
          tools: { disabled: [] },
          openaiCompatible: {
            apiKey: "fake",
            baseURL: `http://127.0.0.1:${server.port}/v1`,
            maxRetries: 0,
            responseFormat,
            reasoningEffort: "off",
            streamUsage: "off",
            input: { text: true, image: false, pdf: false },
          },
        });
        await chat.chat({
          ...emptyRequest("compat:llama"),
          responseFormat: schemaFormat,
        });
      }

      expect((bodies[0] as { response_format?: unknown }).response_format).toEqual(schemaFormat);
      expect((bodies[1] as { response_format?: unknown }).response_format).toBeUndefined();
    } finally {
      await server.stop(true);
    }
  });

  test("OpenAI-compatible provider gates reasoning effort, stream usage, headers, and capabilities", async () => {
    const bodies: unknown[] = [];
    const headerValues: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
        headerValues.push(req.headers.get("x-provider"));
        return new Response([
          "data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"llama\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"}}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n",
          "data: [DONE]\n\n",
        ].join(""), {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    try {
      const chat = createChatClientFromConfig({
        defaultMode: "smart",
        modes: { smart: { model: "llama" } },
        tools: { disabled: [] },
        openaiCompatible: {
          apiKey: "fake",
          baseURL: `http://127.0.0.1:${server.port}/v1`,
          maxRetries: 0,
          responseFormat: "json_object",
          reasoningEffort: "passthrough",
          streamUsage: "include_usage",
          input: { text: true, image: true, pdf: false },
          extraHeaders: { "x-provider": "compat" },
        },
      });
      const usageEvents: unknown[] = [];

      await chat.chat({
        ...emptyRequest("openai-compatible:llama"),
        reasoningEffort: "medium",
        onEvent: () => {},
        onUsage: (usage) => {
          usageEvents.push(usage);
        },
      });

      expect(chatClientCapabilities(chat, "openai-compatible:llama").input).toEqual({
        text: true,
        image: true,
        pdf: false,
      });
      expect((bodies[0] as { reasoning_effort?: unknown }).reasoning_effort).toBe("medium");
      expect((bodies[0] as { stream_options?: unknown }).stream_options).toEqual({
        include_usage: true,
      });
      expect(headerValues).toEqual(["compat"]);
      expect(usageEvents[0]).toEqual({
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      });
    } finally {
      await server.stop(true);
    }
  });

  test("Ollama provider sends native chat body and maps tool calls", async () => {
    const bodies: unknown[] = [];
    const authHeaders: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
        authHeaders.push(req.headers.get("authorization"));
        return Response.json({
          model: "qwen2.5-coder",
          created_at: "2026-06-28T00:00:00Z",
          message: {
            role: "assistant",
            content: "checking",
            tool_calls: [{
              function: {
                name: "Read",
                arguments: { path: "README.md" },
              },
            }],
          },
          done: true,
          prompt_eval_count: 5,
          eval_count: 7,
        });
      },
    });

    try {
      const chat = createChatClientFromConfig({
        defaultMode: "smart",
        modes: { smart: { model: "qwen2.5-coder" } },
        tools: { disabled: [] },
        ollama: {
          baseURL: `http://127.0.0.1:${server.port}/api`,
          apiKey: "ollama-token",
          think: "passthrough",
          keepAlive: "5m",
        },
      });
      const usageEvents: unknown[] = [];

      const response = await chat.chat({
        model: "ollama:qwen2.5-coder",
        reasoningEffort: "high",
        messages: [
          { role: "system", content: "Be terse." },
          { role: "user", content: "Read README" },
        ],
        tools: [{
          type: "function",
          function: {
            name: "Read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        }],
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "answer", strict: true, schema: { type: "object" } },
        },
        onUsage: (usage) => {
          usageEvents.push(usage);
        },
      });

      expect(authHeaders).toEqual(["Bearer ollama-token"]);
      expect(bodies[0]).toEqual({
        model: "qwen2.5-coder",
        messages: [
          { role: "system", content: "Be terse." },
          { role: "user", content: "Read README" },
        ],
        stream: false,
        tools: [{
          type: "function",
          function: {
            name: "Read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        }],
        format: { type: "object" },
        think: true,
        keep_alive: "5m",
      });
      expect(response.tool_calls).toEqual([{
        id: "ollama_call_0",
        type: "function",
        function: {
          name: "Read",
          arguments: "{\"path\":\"README.md\"}",
        },
      }]);
      expect(usageEvents[0]).toEqual({
        inputTokens: 5,
        outputTokens: 7,
        totalTokens: 12,
      });
    } finally {
      await server.stop(true);
    }
  });

  test("Ollama provider maps json_object format to json and streams NDJSON", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
        return new Response([
          "{\"model\":\"llama3.2\",\"message\":{\"role\":\"assistant\",\"content\":\"he\"},\"done\":false}\n",
          "{\"model\":\"llama3.2\",\"message\":{\"role\":\"assistant\",\"content\":\"llo\"},\"done\":false}\n",
          "{\"model\":\"llama3.2\",\"done\":true,\"prompt_eval_count\":2,\"eval_count\":3}\n",
        ].join(""), {
          headers: { "content-type": "application/x-ndjson" },
        });
      },
    });

    try {
      const chat = createChatClientFromConfig({
        defaultMode: "smart",
        modes: { smart: { model: "llama3.2" } },
        tools: { disabled: [] },
        ollama: {
          baseURL: `http://127.0.0.1:${server.port}/api`,
          think: "off",
        },
      });
      const deltas: string[] = [];
      const usageEvents: unknown[] = [];

      const response = await chat.chat({
        ...emptyRequest("llama3.2"),
        responseFormat: { type: "json_object" },
        onEvent: (event) => {
          deltas.push(event.delta);
        },
        onUsage: (usage) => {
          usageEvents.push(usage);
        },
      });

      expect(bodies[0]).toMatchObject({
        model: "llama3.2",
        stream: true,
        format: "json",
      });
      expect((bodies[0] as { think?: unknown }).think).toBeUndefined();
      expect(deltas).toEqual(["he", "llo"]);
      expect(response.content).toBe("hello");
      expect(usageEvents[0]).toEqual({
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      });
    } finally {
      await server.stop(true);
    }
  });

  test("maps JSON schema response format to DeepSeek JSON object mode", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "deepseek-chat",
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "{\"summary\":\"ok\"}" },
          }],
          usage: {
            prompt_tokens: 3,
            completion_tokens: 4,
            total_tokens: 7,
            prompt_cache_hit_tokens: 1,
            prompt_cache_miss_tokens: 2,
          },
        });
      },
    });

    try {
      const usageEvents: unknown[] = [];
      const chat = createChatClientFromConfig({
        defaultMode: "smart",
        modes: { smart: { model: "deepseek-chat" } },
        tools: { disabled: [] },
        deepseek: {
          apiKey: "fake",
          baseURL: `http://127.0.0.1:${server.port}`,
          maxRetries: 0,
        },
      });

      await chat.chat({
        ...emptyRequest("deepseek:deepseek-chat"),
        reasoningEffort: "xhigh",
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "report_narrative_v1",
            strict: true,
            schema: { type: "object" },
          },
        },
        onUsage: (usage) => {
          usageEvents.push(usage);
        },
      });

      expect((bodies[0] as { model?: unknown }).model).toBe("deepseek-chat");
      expect((bodies[0] as { reasoning_effort?: unknown }).reasoning_effort).toBe("max");
      expect((bodies[0] as { response_format?: unknown }).response_format).toEqual({
        type: "json_object",
      });
      expect(usageEvents[0]).toEqual({
        inputTokens: 3,
        outputTokens: 4,
        totalTokens: 7,
        cachedInputTokens: 1,
        cacheCreationInputTokens: 2,
      });
    } finally {
      await server.stop(true);
    }
  });

  test("does not send response format for plain DeepSeek chat and preserves tools", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(await req.json());
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "deepseek-chat",
          choices: [{
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: { name: "Read", arguments: "{\"path\":\"README.md\"}" },
              }],
            },
          }],
        });
      },
    });

    try {
      const chat = createChatClientFromConfig({
        defaultMode: "smart",
        modes: { smart: { model: "deepseek-chat" } },
        tools: { disabled: [] },
        deepseek: {
          apiKey: "fake",
          baseURL: `http://127.0.0.1:${server.port}`,
          maxRetries: 0,
        },
      });

      const response = await chat.chat({
        ...emptyRequest("deepseek-chat"),
        tools: [{
          type: "function",
          function: {
            name: "Read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        }],
      });

      expect((bodies[0] as { response_format?: unknown }).response_format).toBeUndefined();
      expect((bodies[0] as { tools?: unknown }).tools).toEqual([{
        type: "function",
        function: {
          name: "Read",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      }]);
      const toolCall = response.tool_calls?.[0];
      expect(toolCall?.type).toBe("function");
      expect(toolCall?.type === "function" ? toolCall.function.name : undefined).toBe("Read");
    } finally {
      await server.stop(true);
    }
  });

  test("streams DeepSeek text deltas and ignores reasoning deltas", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response([
          "data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"deepseek-chat\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"hidden\"}}]}\n\n",
          "data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"deepseek-chat\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"he\"}}]}\n\n",
          "data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"deepseek-chat\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"llo\"}}]}\n\n",
          "data: [DONE]\n\n",
        ].join(""), {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    try {
      const deltas: string[] = [];
      const chat = createChatClientFromConfig({
        defaultMode: "smart",
        modes: { smart: { model: "deepseek-chat" } },
        tools: { disabled: [] },
        deepseek: {
          apiKey: "fake",
          baseURL: `http://127.0.0.1:${server.port}`,
          maxRetries: 0,
        },
      });

      const response = await chat.chat({
        ...emptyRequest("deepseek-chat"),
        onEvent: (event) => {
          deltas.push(event.delta);
        },
      });

      expect(deltas).toEqual(["he", "llo"]);
      expect(response.content).toBe("hello");
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
