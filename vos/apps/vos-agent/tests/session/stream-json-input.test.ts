import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  StreamJsonInputError,
  parseStreamJsonInputLine,
  runStreamJsonInputSession,
} from "../../app/session/stream-json-input.ts";
import { ThreadStore } from "../../app/session/thread-store.ts";
import { CallbackChatClient, TEST_MODEL, textResponse } from "../helpers/stub-chat.ts";
import { makeTmpDir, removeTmpDir } from "../helpers/tmp.ts";

describe("stream JSON input", () => {
  let tmp: string;
  let store: ThreadStore;

  beforeEach(() => {
    tmp = makeTmpDir("stars-stream-input-");
    store = new ThreadStore({
      stateDir: join(tmp, ".stars"),
      workspaceRoot: tmp,
      idGenerator: () => "T-session",
      now: () => new Date("2026-06-03T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("parses string and text-block user messages", () => {
    expect(parseStreamJsonInputLine(
      JSON.stringify({ type: "user", message: { role: "user", content: "hello" } }),
      1,
    )).toBe("hello");

    expect(parseStreamJsonInputLine(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            { type: "text", text: "world" },
          ],
        },
      }),
      2,
    )).toBe("hello\nworld");
  });

  test("rejects malformed input with line metadata", () => {
    expect(() => parseStreamJsonInputLine("not-json", 3)).toThrow(StreamJsonInputError);
    try {
      parseStreamJsonInputLine(JSON.stringify({ type: "assistant" }), 4);
      throw new Error("expected parser to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(StreamJsonInputError);
      expect((e as StreamJsonInputError).line).toBe(4);
      expect((e as StreamJsonInputError).code).toBe("malformed_stream_json_input");
      expect((e as Error).message).toContain('type "user"');
    }
  });

  test("runs multiple input messages through one local thread", async () => {
    const input = [
      JSON.stringify({ type: "user", message: { role: "user", content: "first" } }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "second" }] },
      }),
    ].join("\n");
    const prompts: string[] = [];
    const eventTypes: string[] = [];
    const chat = new CallbackChatClient((request, index) => {
      const userMessages = request.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content);
      if (index === 0) {
        expect(userMessages).toEqual(["first"]);
        return textResponse("first done");
      }
      expect(userMessages).toEqual(["first", "second"]);
      return textResponse("second done");
    });

    const result = await runStreamJsonInputSession({
      chat,
      store,
      workspaceRoot: tmp,
      input,
      model: TEST_MODEL,
      onTurnStart: (prompt) => {
        prompts.push(prompt);
      },
      onEvent: (event) => {
        eventTypes.push(event.type);
      },
    });

    expect(result.thread.id).toBe("T-session");
    expect(result.content).toBe("second done");
    expect(result.turns).toBe(2);
    expect(result.iterations).toBe(2);
    expect(prompts).toEqual(["first", "second"]);
    expect(eventTypes).toEqual([
      "thread.created",
      "assistant.message",
      "agent.done",
      "thread.saved",
      "done",
      "thread.loaded",
      "assistant.message",
      "agent.done",
      "thread.saved",
      "done",
    ]);
    expect(store.load("T-session").messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)).toEqual(["first", "second"]);
  });

  test("preserves completed turns before reporting a malformed later line", async () => {
    const chat = new CallbackChatClient(() => textResponse("first done"));

    await expect(runStreamJsonInputSession({
      chat,
      store,
      workspaceRoot: tmp,
      input: `${JSON.stringify({ type: "user", message: { role: "user", content: "first" } })}\nnot-json`,
      model: TEST_MODEL,
    })).rejects.toMatchObject({
      line: 2,
      code: "malformed_stream_json_input",
    });

    expect(chat.requests).toHaveLength(1);
    expect(store.load("T-session").messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)).toEqual(["first"]);
  });

  test("honors explicit model and mode overrides when resuming a thread", async () => {
    const first = await runStreamJsonInputSession({
      chat: new CallbackChatClient(() => textResponse("seed done")),
      store,
      workspaceRoot: tmp,
      input: JSON.stringify({ type: "user", message: { role: "user", content: "seed" } }),
      model: "old-model",
      mode: "deep",
      reasoningEffort: "high",
    });
    const chat = new CallbackChatClient((request) => {
      expect(request.model).toBe("new-model");
      expect(request.reasoningEffort).toBe("low");
      return textResponse("override done");
    });

    const second = await runStreamJsonInputSession({
      chat,
      store,
      workspaceRoot: tmp,
      threadId: first.thread.id,
      input: JSON.stringify({ type: "user", message: { role: "user", content: "override" } }),
      model: "new-model",
      mode: "smart",
      reasoningEffort: "low",
    });

    expect(second.thread.model).toBe("new-model");
    expect(second.thread.mode).toBe("smart");
    expect(second.thread.reasoningEffort).toBe("low");
  });
});
