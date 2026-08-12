import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { runAgent } from "../../app/agent/loop.ts";
import { ToolRegistry, type Tool } from "../../app/tools/types.ts";
import {
  ScriptedChatClient,
  TEST_MODEL,
  textResponse,
  toolCallResponse,
} from "../helpers/stub-chat.ts";

function recordingTool(name: string, replies: string[]): { tool: Tool; calls: string[] } {
  const calls: string[] = [];
  let cursor = 0;
  const tool: Tool = {
    name,
    schema: {
      type: "function",
      function: {
        name,
        description: "",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    execute(args: string) {
      calls.push(args);
      const reply = replies[cursor] ?? "";
      cursor++;
      return reply;
    },
  };
  return { tool, calls };
}

describe("runAgent", () => {
  test("returns the model's text reply when no tool calls are issued", async () => {
    const chat = new ScriptedChatClient([textResponse("hello world")]);
    const registry = new ToolRegistry();
    const result = await runAgent({ model: TEST_MODEL, chat, registry, prompt: "hi" });

    expect(result.content).toBe("hello world");
    expect(result.iterations).toBe(1);
    expect(chat.callCount).toBe(1);
    expect(result.messages).toHaveLength(2); // user + assistant
    expect(result.messages[0]).toEqual({ role: "user", content: "hi" });
  });

  test("continues after premature prose until the required completion tool is called", async () => {
    const chat = new ScriptedChatClient([
      textResponse("I will implement it next."),
      toolCallResponse([{ name: "Submit", args: {} }]),
      textResponse("done"),
    ]);
    const { tool, calls } = recordingTool("Submit", ["accepted"]);
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry: new ToolRegistry([tool]),
      prompt: "implement",
      requiredCompletionTool: "Submit",
    });

    expect(result.content).toBeNull();
    expect(result.iterations).toBe(2);
    expect(calls).toHaveLength(1);
    expect(chat.requests[1].messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("Do not repeat the plan"),
    });
  });

  test("fails fast when the required completion tool is unavailable", async () => {
    await expect(runAgent({
      model: TEST_MODEL,
      chat: new ScriptedChatClient([textResponse("done")]),
      registry: new ToolRegistry(),
      prompt: "implement",
      requiredCompletionTool: "Submit",
    })).rejects.toThrow(/required completion tool is unavailable/);
  });

  test("seeds first request with the user prompt and the tool schemas", async () => {
    const chat = new ScriptedChatClient([textResponse("done")]);
    const { tool } = recordingTool("Read", []);
    const registry = new ToolRegistry([tool]);
    await runAgent({
      model: TEST_MODEL,
      reasoningEffort: "high",
      chat,
      registry,
      prompt: "go",
    });

    expect(chat.requests).toHaveLength(1);
    expect(chat.requests[0].reasoningEffort).toBe("high");
    expect(chat.requests[0].messages).toEqual([{ role: "user", content: "go" }]);
    expect(chat.requests[0].tools).toHaveLength(1);
    expect(chat.requests[0].tools[0].function.name).toBe("Read");
  });

  test("dispatches a tool call and appends the result as a 'tool' message", async () => {
    const { tool, calls } = recordingTool("Read", ["file contents"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Read", args: { file_path: "x.txt" }, id: "c1" }]),
      textResponse("file contents"),
    ]);
    const registry = new ToolRegistry([tool]);
    const result = await runAgent({ model: TEST_MODEL, chat, registry, prompt: "read x" });

    expect(calls).toEqual([JSON.stringify({ file_path: "x.txt" })]);
    expect(result.iterations).toBe(2);

    // Second request should include the assistant tool_call + tool result.
    const secondReq = chat.requests[1];
    expect(secondReq.messages.length).toBeGreaterThanOrEqual(3);
    const toolMsg = secondReq.messages[secondReq.messages.length - 1] as {
      role: string;
      tool_call_id: string;
      content: string;
    };
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.tool_call_id).toBe("c1");
    expect(toolMsg.content).toBe("file contents");
  });

  test("handles multiple tool calls in a single assistant turn", async () => {
    const { tool: a, calls: aCalls } = recordingTool("A", ["ra"]);
    const { tool: b, calls: bCalls } = recordingTool("B", ["rb"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([
        { name: "A", args: {}, id: "x" },
        { name: "B", args: {}, id: "y" },
      ]),
      textResponse("ok"),
    ]);
    const registry = new ToolRegistry([a, b]);
    await runAgent({ model: TEST_MODEL, chat, registry, prompt: "run both" });

    expect(aCalls).toEqual(["{}"]);
    expect(bCalls).toEqual(["{}"]);

    const secondReq = chat.requests[1];
    const toolMsgs = secondReq.messages.filter((m) => m.role === "tool");
    expect(toolMsgs.map((m) => (m as { tool_call_id: string }).tool_call_id)).toEqual(
      ["x", "y"],
    );
  });

  test("loops across multiple turns until the model stops", async () => {
    const { tool } = recordingTool("Read", ["first result", "second result"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Read", args: { file_path: "a" } }]),
      toolCallResponse([{ name: "Read", args: { file_path: "b" } }]),
      textResponse("42"),
    ]);
    const registry = new ToolRegistry([tool]);
    const result = await runAgent({ model: TEST_MODEL, chat, registry, prompt: "?" });

    expect(result.content).toBe("42");
    expect(result.iterations).toBe(3);
    expect(chat.callCount).toBe(3);
  });

  test("returns 'Unknown tool' result instead of throwing for unregistered tools", async () => {
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Missing", args: {}, id: "m" }]),
      textResponse("done"),
    ]);
    const registry = new ToolRegistry();
    await runAgent({ model: TEST_MODEL, chat, registry, prompt: "?" });

    const secondReq = chat.requests[1];
    const toolMsg = secondReq.messages.find((m) => m.role === "tool") as
      | { content: string }
      | undefined;
    expect(toolMsg?.content).toContain("Unknown tool: Missing");
  });

  test("returns thrown tool errors as tool messages and continues", async () => {
    const tool: Tool = {
      name: "Boom",
      schema: recordingTool("Boom", []).tool.schema,
      execute: () => {
        throw new Error("bad input");
      },
    };
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Boom", args: {}, id: "b" }]),
      textResponse("recovered"),
    ]);
    const registry = new ToolRegistry([tool]);
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "?",
    });

    expect(result.content).toBe("recovered");
    const toolMsg = chat.requests[1].messages.find((m) => m.role === "tool") as
      | { content: string }
      | undefined;
    expect(toolMsg?.content).toContain('Error executing tool "Boom"');
    expect(toolMsg?.content).toContain("bad input");
  });

  test("enforces maxIterations to protect against runaway loops", async () => {
    const chat = new ScriptedChatClient(
      // Always asks for a tool, never terminates.
      Array.from({ length: 10 }, () =>
        toolCallResponse([{ name: "Loop", args: {} }]),
      ),
    );
    const { tool } = recordingTool("Loop", []);
    const registry = new ToolRegistry([tool]);

    await expect(
      runAgent({ model: TEST_MODEL, chat, registry, prompt: "?", maxIterations: 3 }),
    ).rejects.toThrow(/max iterations \(3\)/);
  });

  test("does not execute tool calls when no follow-up iteration remains", async () => {
    const { tool, calls } = recordingTool("Write", ["OK"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Write", args: { file_path: "x" } }]),
    ]);
    const registry = new ToolRegistry([tool]);

    await expect(
      runAgent({ model: TEST_MODEL, chat, registry, prompt: "?", maxIterations: 1 }),
    ).rejects.toThrow(/before tool calls could be completed/);
    expect(calls).toEqual([]);
  });

  test("accepts the required completion tool on the last available iteration", async () => {
    const { tool, calls } = recordingTool("Submit", ["accepted"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Submit", args: { status: "done" } }]),
    ]);
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry: new ToolRegistry([tool]),
      prompt: "implement",
      maxIterations: 1,
      requiredCompletionTool: "Submit",
    });

    expect(result.iterations).toBe(1);
    expect(calls).toHaveLength(1);
    expect(chat.requests[0].tools.map((entry) => entry.function.name)).toEqual(["Submit"]);
    expect(chat.requests[0].requiredTool).toBeUndefined();
    expect(chat.requests[0].messages.at(-1)).toMatchObject({ role: "user", content: "implement" });
  });

  test("keeps normal tools available until the model submits completed work", async () => {
    const { tool, calls } = recordingTool("Submit", ["accepted"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Write", args: { file_path: "x" } }]),
      toolCallResponse([{ name: "Submit", args: { status: "done" } }]),
    ]);
    const { tool: writeTool } = recordingTool("Write", ["OK"]);
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry: new ToolRegistry([writeTool, tool]),
      prompt: "implement",
      maxIterations: 4,
      requiredCompletionTool: "Submit",
    });

    expect(result.iterations).toBe(2);
    expect(calls).toHaveLength(1);
    expect(chat.requests[0].requiredTool).toBeUndefined();
    expect(chat.requests[1].requiredTool).toBeUndefined();
    expect(chat.requests[1].tools.map((entry) => entry.function.name)).toEqual(["Write", "Submit"]);
  });

  for (const submitIteration of [20, 120, 500]) {
    test(`accepts a state-driven structured submission at iteration ${submitIteration}`, async () => {
      const { tool: workTool } = recordingTool("Work", Array.from({ length: submitIteration - 1 }, () => "OK"));
      const { tool: submitTool, calls } = recordingTool("Submit", ["accepted"]);
      const responses = Array.from({ length: submitIteration - 1 }, () =>
        toolCallResponse([{ name: "Work", args: {} }])
      );
      responses.push(toolCallResponse([{ name: "Submit", args: { status: "passed" } }]));
      const chat = new ScriptedChatClient(responses);

      const result = await runAgent({
        model: TEST_MODEL,
        chat,
        registry: new ToolRegistry([workTool, submitTool]),
        prompt: "implement",
        maxIterations: 1000,
        requiredCompletionTool: "Submit",
      });

      expect(result.iterations).toBe(submitIteration);
      expect(calls).toHaveLength(1);
      expect(chat.requests[submitIteration - 1].requiredTool).toBeUndefined();
      expect(chat.requests[submitIteration - 1].tools.map((entry) => entry.function.name)).toEqual([
        "Work",
        "Submit",
      ]);
    });
  }

  test("allows a corrected completion payload on the last available iteration", async () => {
    const { tool, calls } = recordingTool("Submit", ["validation error: seed must be integer", "accepted"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Submit", args: { seed: "42" } }]),
      toolCallResponse([{ name: "Submit", args: { seed: 42 } }]),
    ]);
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry: new ToolRegistry([tool]),
      prompt: "implement",
      maxIterations: 2,
      requiredCompletionTool: "Submit",
    });

    expect(result.iterations).toBe(2);
    expect(calls).toHaveLength(2);
    expect(chat.requests[1].messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("previous Submit call was rejected"),
    });
  });

  test("returns a rejected structured submission to a full-tool repair turn", async () => {
    const { tool: submitTool, calls: submissions } = recordingTool("Submit", ["validation error", "accepted"]);
    const { tool: writeTool, calls: writes } = recordingTool("Write", ["OK"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Submit", args: { seed: "bad" } }]),
      toolCallResponse([{ name: "Write", args: { file_path: "fixed" } }]),
      toolCallResponse([{ name: "Submit", args: { seed: 42 } }]),
    ]);
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry: new ToolRegistry([writeTool, submitTool]),
      prompt: "implement",
      maxIterations: 3,
      requiredCompletionTool: "Submit",
    });

    expect(result.iterations).toBe(3);
    expect(submissions).toHaveLength(2);
    expect(writes).toHaveLength(1);
    expect(chat.requests[1].tools.map((entry) => entry.function.name)).toEqual(["Write", "Submit"]);
    expect(chat.requests[1].messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("previous Submit call was rejected"),
    });
    expect(chat.requests[2].tools.map((entry) => entry.function.name)).toEqual(["Write", "Submit"]);
  });

  test("keeps all intervening turns available for repair before final resubmission", async () => {
    const { tool: submitTool, calls: submissions } = recordingTool("Submit", ["validation error", "accepted"]);
    const { tool: writeTool, calls: writes } = recordingTool("Write", ["OK", "OK", "OK"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Write", args: { file_path: "implementation.c" } }]),
      toolCallResponse([{ name: "Submit", args: { status: "partial" } }]),
      toolCallResponse([{ name: "Write", args: { file_path: "tests/public.ts" } }]),
      toolCallResponse([{ name: "Write", args: { file_path: "tests/contract.ts" } }]),
      toolCallResponse([{ name: "Submit", args: { status: "passed" } }]),
    ]);
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry: new ToolRegistry([writeTool, submitTool]),
      prompt: "implement",
      maxIterations: 5,
      requiredCompletionTool: "Submit",
    });

    expect(result.iterations).toBe(5);
    expect(submissions).toHaveLength(2);
    expect(writes).toHaveLength(3);
    expect(chat.requests[2].requiredTool).toBeUndefined();
    expect(chat.requests[3].requiredTool).toBeUndefined();
    expect(chat.requests[4].requiredTool).toBeUndefined();
    expect(chat.requests[4].tools.map((entry) => entry.function.name)).toEqual(["Write", "Submit"]);
  });

  test("allows multiple full-tool repair turns before a corrected submission", async () => {
    const { tool: submitTool, calls: submissions } = recordingTool("Submit", ["validation error", "accepted"]);
    const { tool: writeTool, calls: writes } = recordingTool("Write", ["OK", "OK"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Submit", args: { status: "partial" } }]),
      toolCallResponse([{ name: "Write", args: { file_path: "implementation.c" } }]),
      toolCallResponse([{ name: "Write", args: { file_path: "tests/public.ts" } }]),
      toolCallResponse([{ name: "Submit", args: { status: "passed" } }]),
    ]);
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry: new ToolRegistry([writeTool, submitTool]),
      prompt: "implement",
      maxIterations: 5,
      requiredCompletionTool: "Submit",
    });

    expect(result.iterations).toBe(4);
    expect(submissions).toHaveLength(2);
    expect(writes).toHaveLength(2);
    expect(chat.requests[1].tools.map((entry) => entry.function.name)).toEqual(["Write", "Submit"]);
    expect(chat.requests[2].tools.map((entry) => entry.function.name)).toEqual(["Write", "Submit"]);
    expect(chat.requests[3].requiredTool).toBeUndefined();
  });

  test("executes repairs before the required completion tool on the final turn", async () => {
    const { tool: submitTool, calls: submissions } = recordingTool("Submit", ["accepted"]);
    const { tool: writeTool, calls: writes } = recordingTool("Write", ["OK"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([
        { name: "Write", args: { file_path: "late.txt" } },
        { name: "Submit", args: { status: "partial" } },
      ]),
    ]);
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry: new ToolRegistry([writeTool, submitTool]),
      prompt: "implement",
      maxIterations: 1,
      requiredCompletionTool: "Submit",
    });

    expect(result.iterations).toBe(1);
    expect(submissions).toHaveLength(1);
    expect(writes).toHaveLength(1);
  });

  test("fails at maxIterations when no required completion result is accepted", async () => {
    const { tool: workTool, calls: workCalls } = recordingTool("Work", ["OK"]);
    const { tool: submitTool } = recordingTool("Submit", []);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Work", args: {} }]),
    ]);

    await expect(runAgent({
      model: TEST_MODEL,
      chat,
      registry: new ToolRegistry([workTool, submitTool]),
      prompt: "implement",
      maxIterations: 1,
      requiredCompletionTool: "Submit",
    })).rejects.toThrow(/without an accepted required completion tool result/);

    expect(workCalls).toHaveLength(1);
    expect(chat.requests[0].tools.map((entry) => entry.function.name)).toEqual(["Work", "Submit"]);
    expect(chat.requests[0].requiredTool).toBeUndefined();
  });

  test("prepends an optional system prompt", async () => {
    const chat = new ScriptedChatClient([textResponse("ok")]);
    const registry = new ToolRegistry();
    await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "hi",
      system: "be brief",
    });

    expect(chat.requests[0].messages[0]).toEqual({
      role: "system",
      content: "be brief",
    });
    expect(chat.requests[0].messages[1]).toEqual({
      role: "user",
      content: "hi",
    });
  });

  test("continues from history without mutating it", async () => {
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: "be brief" },
      { role: "user", content: "first" },
      { role: "assistant", content: "one" },
    ];
    const original = [...history];
    const chat = new ScriptedChatClient([textResponse("two")]);
    const registry = new ToolRegistry();

    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "second",
      history,
    });

    expect(history).toEqual(original);
    expect(chat.requests[0].messages).toEqual([
      ...original,
      { role: "user", content: "second" },
    ]);
    expect(result.messages).toEqual([
      ...original,
      { role: "user", content: "second" },
      { role: "assistant", content: "two", refusal: null },
    ]);
  });

  test("rejects a system prompt when continuing from history", async () => {
    const chat = new ScriptedChatClient([textResponse("unused")]);
    const registry = new ToolRegistry();

    await expect(
      runAgent({
        model: TEST_MODEL,
        chat,
        registry,
        prompt: "next",
        history: [{ role: "user", content: "old" }],
        system: "do not duplicate",
      }),
    ).rejects.toThrow(/system cannot be provided when continuing from history/);
    expect(chat.callCount).toBe(0);
  });

  test("emits assistant, tool, and done events", async () => {
    const { tool } = recordingTool("Read", ["file contents"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Read", args: { file_path: "x" }, id: "c" }]),
      textResponse("done"),
    ]);
    const registry = new ToolRegistry([tool]);
    const events: string[] = [];

    await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "go",
      onEvent(event) {
        events.push(event.type);
      },
    });

    expect(events).toEqual([
      "assistant.message",
      "tool.call",
      "tool.result",
      "assistant.message",
      "agent.done",
    ]);
  });

  test("forwards provider text deltas before the completed assistant message", async () => {
    const chat = new ScriptedChatClient([textResponse("hello")]);
    const registry = new ToolRegistry();
    const events: string[] = [];

    chat.chat = async (request) => {
      await request.onEvent?.({ type: "text.delta", delta: "he" });
      await request.onEvent?.({ type: "text.delta", delta: "llo" });
      return textResponse("hello");
    };

    await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "go",
      streamAssistant: true,
      onEvent(event) {
        events.push(event.type === "assistant.delta" ? `delta:${event.delta}` : event.type);
      },
    });

    expect(events).toEqual([
      "delta:he",
      "delta:llo",
      "assistant.message",
      "agent.done",
    ]);
  });

  test("does not request provider streaming unless explicitly enabled", async () => {
    const chat = new ScriptedChatClient([textResponse("hello")]);
    const registry = new ToolRegistry();
    let providerStreamingHookSeen = false;

    chat.chat = async (request) => {
      providerStreamingHookSeen = request.onEvent !== undefined;
      return textResponse("hello");
    };

    await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "go",
      onEvent() {},
    });

    expect(providerStreamingHookSeen).toBe(false);
  });

  test("emits model usage reported by the chat client", async () => {
    const chat = new ScriptedChatClient([textResponse("hello")]);
    const registry = new ToolRegistry();
    const events: string[] = [];

    chat.chat = async (request) => {
      await request.onUsage?.({
        inputTokens: 10,
        outputTokens: 3,
        totalTokens: 13,
      });
      return textResponse("hello");
    };

    await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "go",
      onEvent(event) {
        if (event.type === "model.usage") {
          events.push(`${event.model}:${event.usage.totalTokens}`);
        }
      },
    });

    expect(events).toEqual([`${TEST_MODEL}:13`]);
  });

  test("passes AbortSignal through chat requests and tool executions", async () => {
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Read", args: { file_path: "x" }, id: "c1" }]),
      textResponse("done"),
    ]);
    const controller = new AbortController();
    let seenChatSignal: AbortSignal | undefined;
    let seenToolSignal: AbortSignal | undefined;
    const tool: Tool = {
      name: "Read",
      schema: recordingTool("Read", []).tool.schema,
      execute(_args, context) {
        seenToolSignal = context?.signal;
        return "file contents";
      },
    };
    const registry = new ToolRegistry([tool]);

    const originalChat = chat.chat.bind(chat);
    chat.chat = async (request) => {
      seenChatSignal = request.signal;
      return originalChat(request);
    };

    await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "go",
      signal: controller.signal,
    });

    expect(seenChatSignal).toBe(controller.signal);
    expect(seenToolSignal).toBe(controller.signal);
  });

  test("throws before the first request when already aborted", async () => {
    const chat = new ScriptedChatClient([textResponse("unused")]);
    const registry = new ToolRegistry();
    const controller = new AbortController();
    controller.abort(new Error("stop now"));

    await expect(runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "go",
      signal: controller.signal,
    })).rejects.toThrow(/stop now/);
    expect(chat.callCount).toBe(0);
  });

  test("stops before tool execution when aborted after the model reply", async () => {
    const controller = new AbortController();
    const { tool, calls } = recordingTool("Write", ["OK"]);
    const chat = new ScriptedChatClient([
      toolCallResponse([{ name: "Write", args: { file_path: "x" } }]),
    ]);
    const registry = new ToolRegistry([tool]);

    await expect(runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "go",
      signal: controller.signal,
      onEvent(event) {
        if (event.type === "assistant.message") {
          controller.abort(new Error("user canceled"));
        }
      },
    })).rejects.toThrow(/user canceled/);

    expect(calls).toEqual([]);
  });
});
