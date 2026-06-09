import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import {
  runInteractive,
  runInteractiveController,
  type InteractiveInput,
  type InteractiveStatus,
  type InteractiveView,
} from "../../app/terminal/repl.ts";
import { ThreadStore } from "../../app/session/thread-store.ts";
import type { SessionEvent } from "../../app/session/types.ts";
import type { StarsTranscriptItem } from "../../app/tui/stars-view.ts";
import {
  CallbackChatClient,
  TEST_MODEL,
  textResponse,
  toolCallResponse,
} from "../helpers/stub-chat.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

function testConfig() {
  return {
    defaultMode: "smart",
    modes: {
      smart: { model: TEST_MODEL },
      rush: { model: "rush-model", reasoningEffort: "medium" as const },
    },
    tools: { disabled: [] },
  };
}

function capture(stream: PassThrough): () => string {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });
  return () => Buffer.concat(chunks).toString("utf8");
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

class FakeInteractiveInput implements InteractiveInput {
  private index = 0;

  constructor(private readonly lines: readonly string[]) {}

  async readLine(): Promise<string | undefined> {
    const line = this.lines[this.index];
    this.index++;
    return line;
  }
}

class RecordingInteractiveView implements InteractiveView {
  readonly welcomes: InteractiveStatus[] = [];
  readonly statuses: InteractiveStatus[] = [];
  readonly commands: string[] = [];
  readonly errors: string[] = [];
  readonly sessionEvents: SessionEvent[] = [];
  readonly restoredTranscripts: StarsTranscriptItem[][] = [];

  welcome(status: InteractiveStatus): void {
    this.welcomes.push(status);
  }

  restoreTranscript(items: readonly StarsTranscriptItem[]): void {
    this.restoredTranscripts.push([...items]);
  }

  command(message: string): void {
    this.commands.push(message);
  }

  status(status: InteractiveStatus): void {
    this.statuses.push(status);
  }

  error(message: string): void {
    this.errors.push(message);
  }

  onSessionEvent(event: SessionEvent): void {
    this.sessionEvents.push(event);
  }
}

describe("runInteractive", () => {
  let tmp: string;
  let store: ThreadStore;

  beforeEach(() => {
    tmp = makeTmpDir("stars-repl-");
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

  test("controller runs with fake input/view without readline", async () => {
    const view = new RecordingInteractiveView();
    const chat = new CallbackChatClient(() => textResponse("controller answer"));

    await runInteractiveController({
      chat,
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      input: new FakeInteractiveInput(["hello", "/new", "/quit"]),
      view,
    });

    expect(view.errors).toEqual([]);
    expect(view.welcomes).toHaveLength(1);
    expect(view.welcomes[0]).toMatchObject({
      mode: "smart",
      disabledTools: [],
    });
    expect(view.welcomes[0]?.threadId).toBeUndefined();
    expect(view.commands).toContain("new thread");
    expect(view.statuses).toHaveLength(1);
    expect(view.statuses[0]).toMatchObject({
      mode: "smart",
      disabledTools: [],
    });
    expect(view.statuses[0]?.threadId).toBeUndefined();
    expect(view.sessionEvents.map((event) => event.type)).toEqual([
      "thread.created",
      "assistant.message",
      "agent.done",
      "thread.saved",
      "done",
    ]);
    expect(view.sessionEvents.at(-1)).toMatchObject({
      type: "done",
      content: "controller answer",
    });
    expect(chat.requests).toHaveLength(1);
  });

  test("controller reports command errors through the view", async () => {
    const view = new RecordingInteractiveView();

    await runInteractiveController({
      chat: new CallbackChatClient(() => {
        throw new Error("chat should not be called for slash command errors");
      }),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      input: new FakeInteractiveInput(["/mode bogus", "/wat", "/quit"]),
      view,
    });

    expect(view.errors).toEqual([
      'unknown mode "bogus". known modes: rush, smart',
      "unknown command: /wat",
    ]);
  });

  test("controller propagates view failures instead of reporting them as command errors", async () => {
    const failure = new Error("render failed");
    let errorCalled = false;
    const view: InteractiveView = {
      welcome(): void {},
      command(): void {
        throw failure;
      },
      status(): void {},
      error(): void {
        errorCalled = true;
      },
      onSessionEvent(): void {},
    };

    await expect(runInteractiveController({
      chat: new CallbackChatClient(() => {
        throw new Error("chat should not be called for /help");
      }),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      input: new FakeInteractiveInput(["/help", "/quit"]),
      view,
    })).rejects.toThrow("render failed");
    expect(errorCalled).toBe(false);
  });

  test("rejects an archived initial thread before entering the prompt loop", async () => {
    const thread = store.create({ prompt: "seed", model: TEST_MODEL });
    store.save(thread);
    store.archive(thread.id);
    const input = new PassThrough();
    input.end();

    await expect(runInteractive({
      chat: new CallbackChatClient(() => textResponse("should not run")),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      threadId: thread.id,
      input,
      output: new PassThrough(),
      error: new PassThrough(),
    })).rejects.toThrow(/thread "T-session" is archived/);
  });

  test("renders session metadata, tool progress, and final response", async () => {
    writeFixture(tmp, "note.txt", "hi");
    const input = new PassThrough();
    const output = new PassThrough();
    const error = new PassThrough();
    const readOutput = capture(output);
    const readError = capture(error);
    const chat = new CallbackChatClient((request, index) => {
      if (index === 0) {
        expect(request.tools.map((tool) => tool.function.name)).toContain("Read");
        return toolCallResponse([
          {
            id: "read-1",
            name: "Read",
            args: { file_path: "note.txt" },
          },
        ]);
      }
      expect(String(request.messages.at(-1)?.content)).toContain("hi");
      return textResponse("final answer");
    });
    input.end("inspect\n/quit\n");

    await runInteractive({
      chat,
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      input,
      output,
      error,
    });

    expect(readError()).toBe("");
    const text = readOutput();
    expect(text).toContain("thread: T-session (new)");
    expect(text).toContain("mode: smart");
    expect(text).toContain(`model: ${TEST_MODEL}`);
    expect(text).toContain("tool call: Read");
    expect(text).toContain("active tools: Read");
    expect(text).toContain("tool done: Read");
    expect(text).not.toContain("assistant:");
    expect(text).toContain("final answer");
  });

  test("uses the raw TUI on TTY streams and restores terminal modes", async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode(enabled: boolean): typeof input;
    };
    const output = new PassThrough() as PassThrough & {
      isTTY: boolean;
      columns: number;
      rows: number;
    };
    const error = new PassThrough();
    const rawModeValues: boolean[] = [];
    const readOutput = capture(output);
    const readError = capture(error);
    input.isTTY = true;
    input.setRawMode = (enabled: boolean) => {
      rawModeValues.push(enabled);
      return input;
    };
    output.isTTY = true;
    output.columns = 60;
    output.rows = 20;
    input.end("hello\r");
    let providerStreamingHookSeen = false;

    await runInteractive({
      chat: new CallbackChatClient(async (request) => {
        providerStreamingHookSeen = request.onEvent !== undefined;
        await request.onEvent?.({ type: "text.delta", delta: "tty " });
        await request.onEvent?.({ type: "text.delta", delta: "answer" });
        return textResponse("tty answer");
      }),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      input,
      output,
      error,
    });

    expect(readError()).toBe("");
    expect(providerStreamingHookSeen).toBe(true);
    expect(rawModeValues).toEqual([true, false]);
    const text = readOutput();
    expect(text).toContain("\x1b[?1049h");
    expect(text).toContain("\x1b[?1049l");
    expect(text).toContain("\x1b[?1000h");
    expect(text).toContain("\x1b[?1006h");
    expect(text).toContain("\x1b[?1006l");
    expect(text).toContain("\x1b[?1000l");
    expect(text).toContain("VOS Agent");
    expect(stripAnsi(text)).toContain("smart");
    expect(text).toContain("\x1b[0;1;32m│");
    expect(stripAnsi(text)).toContain("hello");
    expect(text).not.toContain("assistant:");
    expect(text).toContain("tty");
    expect(text).toContain("answer");
    expect(text).not.toContain("vos-agent> ");
    expect(output.listenerCount("resize")).toBe(0);
  });

  test("restores the TUI terminal if raw input startup fails", async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode(enabled: boolean): typeof input;
    };
    const output = new PassThrough() as PassThrough & {
      isTTY: boolean;
      columns: number;
      rows: number;
    };
    const readOutput = capture(output);
    input.isTTY = true;
    input.setRawMode = () => {
      throw new Error("raw mode failed");
    };
    output.isTTY = true;
    output.columns = 60;
    output.rows = 10;

    await expect(runInteractive({
      chat: new CallbackChatClient(() => textResponse("should not run")),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      input,
      output,
      error: new PassThrough(),
    })).rejects.toThrow("raw mode failed");

    const text = readOutput();
    expect(text).toContain("\x1b[?1049h");
    expect(text).toContain("\x1b[?1049l");
  });

  test("restores the TUI terminal if raw input cleanup fails", async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode(enabled: boolean): typeof input;
    };
    const output = new PassThrough() as PassThrough & {
      isTTY: boolean;
      columns: number;
      rows: number;
    };
    const readOutput = capture(output);
    input.isTTY = true;
    input.setRawMode = (enabled: boolean) => {
      if (!enabled) {
        throw new Error("raw cleanup failed");
      }
      return input;
    };
    output.isTTY = true;
    output.columns = 60;
    output.rows = 10;
    input.write("/quit\r");

    await expect(runInteractive({
      chat: new CallbackChatClient(() => textResponse("should not run")),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      input,
      output,
      error: new PassThrough(),
    })).rejects.toThrow("raw cleanup failed");

    const text = readOutput();
    expect(text).toContain("\x1b[?1049h");
    expect(text).toContain("\x1b[?1049l");
    expect(output.listenerCount("resize")).toBe(0);
  });

  test("slash command errors do not break later commands", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const error = new PassThrough();
    const readOutput = capture(output);
    const readError = capture(error);
    input.end("/help\n/mode bogus\n/mode rush\n/mode\n/wat\n/quit\n");

    await runInteractive({
      chat: new CallbackChatClient(() => {
        throw new Error("chat should not be called for slash commands");
      }),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      input,
      output,
      error,
    });

    const text = readOutput();
    expect(text).toContain("VOS Agent commands:");
    expect(text).toContain("mode: rush");
    expect(text).toContain("rush");
    const errors = readError();
    expect(errors).toContain('unknown mode "bogus"');
    expect(errors).toContain("unknown command: /wat");
  });

  test("runs project markdown slash commands as expanded prompts", async () => {
    writeFixture(tmp, ".agents/commands/review.md", "Review this target:\n\n$ARGUMENTS");
    const input = new PassThrough();
    const output = new PassThrough();
    const error = new PassThrough();
    const readOutput = capture(output);
    const readError = capture(error);
    const chat = new CallbackChatClient((request) => {
      expect(request.messages.filter((message) => message.role === "user").at(-1)).toMatchObject({
        content: "Review this target:\n\napp/main.ts",
      });
      return textResponse("reviewed");
    });
    input.end("/review app/main.ts\n/quit\n");

    await runInteractive({
      chat,
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      input,
      output,
      error,
    });

    expect(readError()).toBe("");
    expect(readOutput()).toContain("project command: /review");
    expect(readOutput()).toContain("reviewed");
  });

  test("reports invalid project command definitions before entering the prompt loop", async () => {
    writeFixture(tmp, ".agents/commands/empty.md", "\n");
    const input = new PassThrough();
    input.end();

    await expect(runInteractive({
      chat: new CallbackChatClient(() => textResponse("should not run")),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      input,
      output: new PassThrough(),
      error: new PassThrough(),
    })).rejects.toThrow(/project command "empty" must not be empty/);
  });

  test("raw model pin reports that mode switching has no effect", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const error = new PassThrough();
    const readOutput = capture(output);
    const readError = capture(error);
    input.end("/mode\n/mode rush\n/quit\n");

    await runInteractive({
      chat: new CallbackChatClient(() => {
        throw new Error("chat should not be called for slash commands");
      }),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      model: "raw-model",
      input,
      output,
      error,
    });

    expect(readOutput()).toContain("mode: raw model (raw-model)");
    expect(readError()).toContain("cannot switch mode while --model is pinned");
  });

  test("welcome status shows stored thread mode and model", async () => {
    const thread = store.create({
      prompt: "seed",
      model: "rush-model",
      mode: "rush",
      reasoningEffort: "medium",
    });
    store.save(thread);
    const input = new PassThrough();
    const output = new PassThrough();
    const readOutput = capture(output);
    input.end("/quit\n");

    await runInteractive({
      chat: new CallbackChatClient(() => {
        throw new Error("chat should not be called for /quit");
      }),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      threadId: thread.id,
      input,
      output,
      error: new PassThrough(),
    });

    const text = readOutput();
    expect(text).toContain("thread: T-session");
    expect(text).toContain("mode: rush");
    expect(text).toContain("model: rush-model");
  });

  test("controller restores stored thread messages for transcript-capable views", async () => {
    const thread = store.create({
      prompt: "seed",
      model: TEST_MODEL,
      mode: "smart",
    });
    thread.messages = [
      { role: "user", content: "old question" },
      {
        role: "assistant",
        content: "old answer",
        tool_calls: [{
          id: "tool-1",
          type: "function",
          function: { name: "Read", arguments: "{\"file_path\":\"README.md\"}" },
        }],
      },
      { role: "tool", tool_call_id: "tool-1", content: "old tool output" },
    ];
    store.save(thread);
    const view = new RecordingInteractiveView();

    await runInteractiveController({
      chat: new CallbackChatClient(() => {
        throw new Error("chat should not be called for /quit");
      }),
      config: testConfig(),
      store,
      workspaceRoot: tmp,
      threadId: thread.id,
      input: new FakeInteractiveInput(["/quit"]),
      view,
    });

    expect(view.restoredTranscripts).toEqual([[
      { type: "user", text: "old question" },
      { type: "assistant", text: "old answer" },
      { type: "tool-call", name: "Read", text: "{\"file_path\":\"README.md\"}" },
      { type: "tool-result", name: "Read", text: "old tool output" },
    ]]);
  });
});
