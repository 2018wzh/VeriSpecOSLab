import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ThreadStore } from "../../app/session/thread-store.ts";
import { runSessionTurn } from "../../app/session/run-turn.ts";
import {
  CallbackChatClient,
  TEST_MODEL,
  textResponse,
  toolCallResponse,
} from "../helpers/stub-chat.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

function fakeMcpServerScript(): string {
  return String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
function send(message) { process.stdout.write(JSON.stringify(message) + "\n"); }
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "fake", version: "1.0.0" }
    }});
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [{
      name: "echo",
      description: "Echo text",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
    }] }});
    return;
  }
  if (message.method === "tools/call") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      content: [{ type: "text", text: "mcp:" + message.params.arguments.text }],
      isError: false
    }});
    return;
  }
});
`;
}

describe("runSessionTurn", () => {
  let tmp: string;
  let store: ThreadStore;

  beforeEach(() => {
    tmp = makeTmpDir("stars-run-turn-");
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

  test("creates a thread, injects AGENTS guidance, and persists transcript", async () => {
    writeFixture(tmp, "AGENTS.md", "Use Bun.");
    const chat = new CallbackChatClient((request) => {
      expect(request.messages[0]).toMatchObject({ role: "system" });
      expect(String(request.messages[0].content)).toContain("Use Bun.");
      return textResponse("done");
    });
    const events: string[] = [];

    const result = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      prompt: "inspect",
      model: TEST_MODEL,
      mode: "smart",
      onEvent: (event) => {
        events.push(event.type);
      },
    });

    expect(result.thread.id).toBe("T-session");
    expect(result.content).toBe("done");
    expect(store.load("T-session").messages).toHaveLength(3);
    expect(events).toEqual([
      "thread.created",
      "assistant.message",
      "agent.done",
      "thread.saved",
      "done",
    ]);
  });

  test("maps provider text deltas to session events before final persistence", async () => {
    const chat = new CallbackChatClient(async (request) => {
      await request.onEvent?.({ type: "text.delta", delta: "stream" });
      await request.onEvent?.({ type: "text.delta", delta: "ing" });
      return textResponse("streaming");
    });
    const events: string[] = [];

    const result = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      prompt: "inspect",
      model: TEST_MODEL,
      streamAssistant: true,
      onEvent: (event) => {
        events.push(event.type === "assistant.delta" ? `delta:${event.delta}` : event.type);
      },
    });

    expect(result.content).toBe("streaming");
    expect(store.load("T-session").messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "streaming",
    });
    expect(events).toEqual([
      "thread.created",
      "delta:stream",
      "delta:ing",
      "assistant.message",
      "agent.done",
      "thread.saved",
      "done",
    ]);
  });

  test("loads nested AGENTS guidance from the start directory", async () => {
    writeFixture(tmp, "AGENTS.md", "root rules");
    writeFixture(tmp, "app/AGENTS.md", "app rules");
    const chat = new CallbackChatClient((request) => {
      expect(String(request.messages[0].content)).toContain("root rules");
      expect(String(request.messages[0].content)).toContain("app rules");
      return textResponse("done");
    });

    await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      startDir: join(tmp, "app"),
      prompt: "inspect",
      model: TEST_MODEL,
    });
  });

  test("continues an existing thread without duplicating guidance", async () => {
    const first = await runSessionTurn({
      chat: new CallbackChatClient(() => textResponse("first")),
      store,
      workspaceRoot: tmp,
      prompt: "first",
      model: TEST_MODEL,
    });

    const chat = new CallbackChatClient((request) => {
      expect(request.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
        "first",
        "second",
      ]);
      return textResponse("second done");
    });

    const second = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      threadId: first.thread.id,
      prompt: "second",
      model: TEST_MODEL,
    });

    expect(second.thread.messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(second.content).toBe("second done");
  });

  test("continues with the stored model and mode unless overridden", async () => {
    const first = await runSessionTurn({
      chat: new CallbackChatClient(() => textResponse("first")),
      store,
      workspaceRoot: tmp,
      prompt: "first",
      model: "deep-model",
      mode: "deep",
      reasoningEffort: "high",
    });

    const chat = new CallbackChatClient((request) => {
      expect(request.model).toBe("deep-model");
      expect(request.reasoningEffort).toBe("high");
      return textResponse("second done");
    });

    const second = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      threadId: first.thread.id,
      prompt: "second",
    });

    expect(second.thread.model).toBe("deep-model");
    expect(second.thread.mode).toBe("deep");
    expect(second.thread.reasoningEffort).toBe("high");
  });

  test("allows an explicit model and mode to override a resumed thread", async () => {
    const first = await runSessionTurn({
      chat: new CallbackChatClient(() => textResponse("first")),
      store,
      workspaceRoot: tmp,
      prompt: "first",
      model: "deep-model",
      mode: "deep",
    });

    const chat = new CallbackChatClient((request) => {
      expect(request.model).toBe("smart-model");
      return textResponse("second done");
    });

    const second = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      threadId: first.thread.id,
      prompt: "second",
      model: "smart-model",
      mode: "smart",
      reasoningEffort: "low",
    });

    expect(second.thread.model).toBe("smart-model");
    expect(second.thread.mode).toBe("smart");
    expect(second.thread.reasoningEffort).toBe("low");
  });

  test("mode override on a resumed thread clears stale reasoning effort", async () => {
    const first = await runSessionTurn({
      chat: new CallbackChatClient(() => textResponse("first")),
      store,
      workspaceRoot: tmp,
      prompt: "first",
      model: "rush-model",
      mode: "rush",
      reasoningEffort: "medium",
    });

    const chat = new CallbackChatClient((request) => {
      expect(request.model).toBe("smart-model");
      expect(request.reasoningEffort).toBeUndefined();
      return textResponse("second done");
    });

    const second = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      threadId: first.thread.id,
      prompt: "second",
      model: "smart-model",
      mode: "smart",
    });

    expect(second.thread.model).toBe("smart-model");
    expect(second.thread.mode).toBe("smart");
    expect(second.thread.reasoningEffort).toBeUndefined();
  });

  test("raw model override on a resumed thread clears stale mode metadata", async () => {
    const first = await runSessionTurn({
      chat: new CallbackChatClient(() => textResponse("first")),
      store,
      workspaceRoot: tmp,
      prompt: "first",
      model: "deep-model",
      mode: "deep",
      reasoningEffort: "high",
    });

    const chat = new CallbackChatClient((request) => {
      expect(request.model).toBe("raw-model");
      expect(request.reasoningEffort).toBeUndefined();
      return textResponse("second done");
    });

    const second = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      threadId: first.thread.id,
      prompt: "second",
      model: "raw-model",
    });

    expect(second.thread.model).toBe("raw-model");
    expect(second.thread.mode).toBeUndefined();
    expect(second.thread.reasoningEffort).toBeUndefined();
  });

  test("refuses to resume a thread saved for a different workspace", async () => {
    const first = await runSessionTurn({
      chat: new CallbackChatClient(() => textResponse("first")),
      store,
      workspaceRoot: tmp,
      prompt: "first",
      model: TEST_MODEL,
    });
    first.thread.workspaceRoot = join(tmp, "other-workspace");
    store.save(first.thread);

    await expect(runSessionTurn({
      chat: new CallbackChatClient(() => textResponse("should not run")),
      store,
      workspaceRoot: tmp,
      threadId: first.thread.id,
      prompt: "second",
      model: TEST_MODEL,
    })).rejects.toThrow(/belongs to workspace/);
  });

  test("refuses to resume an archived thread", async () => {
    const first = await runSessionTurn({
      chat: new CallbackChatClient(() => textResponse("first")),
      store,
      workspaceRoot: tmp,
      prompt: "first",
      model: TEST_MODEL,
    });
    store.archive(first.thread.id);

    await expect(runSessionTurn({
      chat: new CallbackChatClient(() => textResponse("should not run")),
      store,
      workspaceRoot: tmp,
      threadId: first.thread.id,
      prompt: "second",
      model: TEST_MODEL,
    })).rejects.toThrow(/thread "T-session" is archived/);
  });

  test("persists todo state changed by model tool calls", async () => {
    const chat = new CallbackChatClient((_request, index) => {
      if (index === 0) {
        return toolCallResponse([
          {
            name: "TodoWrite",
            args: {
              todos: [{ id: "1", content: "plan", status: "completed" }],
            },
            id: "todo",
          },
        ]);
      }
      return textResponse("updated todos");
    });

    const result = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      prompt: "make todos",
      model: TEST_MODEL,
    });

    expect(result.thread.todos).toEqual([
      { id: "1", content: "plan", status: "completed" },
    ]);
  });

  test("enables Task subagents for delegated work", async () => {
    const chat = new CallbackChatClient((request, index) => {
      if (index === 0) {
        expect(request.tools.map((tool) => tool.function.name)).toContain("Task");
        return toolCallResponse([
          {
            name: "Task",
            args: {
              description: "inspect the repo",
              prompt: "Find the important file and report it.",
            },
            id: "task-1",
          },
        ]);
      }
      if (index === 1) {
        expect(request.tools.map((tool) => tool.function.name)).not.toContain("Task");
        expect(request.messages.at(-1)).toMatchObject({
          role: "user",
          content: "Find the important file and report it.",
        });
        return textResponse("subagent found src/app.ts");
      }
      expect(String(request.messages.at(-1)?.content)).toContain("subagent found src/app.ts");
      return textResponse("delegated result consumed");
    });

    const result = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      prompt: "Use a subagent to inspect the repo.",
      model: TEST_MODEL,
    });

    expect(result.content).toBe("delegated result consumed");
  });

  test("disabled tools are not advertised and model calls receive denial text", async () => {
    const chat = new CallbackChatClient((request, index) => {
      if (index === 0) {
        expect(request.tools.map((tool) => tool.function.name)).not.toContain("Vos");
        return toolCallResponse([
          {
            name: "Vos",
            args: { command: "spec lint spec" },
            id: "vos-1",
          },
        ]);
      }
      const last = request.messages.at(-1);
      expect(last).toMatchObject({ role: "tool", tool_call_id: "vos-1" });
      expect(String(last?.content)).toContain('Tool "Vos" denied by policy');
      return textResponse("policy denial consumed");
    });

    const result = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      prompt: "try shell",
      model: TEST_MODEL,
      disabledTools: ["Vos"],
    });

    expect(result.content).toBe("policy denial consumed");
  });

  test("loads plugin MCP tools and executes them through the agent loop", async () => {
    const serverPath = writeFixture(tmp, "fake-mcp.js", fakeMcpServerScript());
    writeFixture(tmp, ".agents/plugins/fake.json", JSON.stringify({
      name: "fake",
      mcpServers: {
        fake: {
          command: process.execPath,
          args: [serverPath],
        },
      },
    }));
    const events: string[] = [];
    const chat = new CallbackChatClient((request, index) => {
      if (index === 0) {
        expect(request.tools.map((tool) => tool.function.name)).toContain("mcp__fake__echo");
        return toolCallResponse([
          {
            name: "mcp__fake__echo",
            args: { text: "hello" },
            id: "mcp-1",
          },
        ]);
      }
      expect(String(request.messages.at(-1)?.content)).toBe("mcp:hello");
      return textResponse("mcp consumed");
    });

    const result = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      prompt: "use mcp",
      model: TEST_MODEL,
      onEvent: (event) => {
        if (event.type === "thread.created") {
          expect(event.mcpServers).toEqual(["fake"]);
        }
        events.push(event.type);
      },
    });

    expect(result.content).toBe("mcp consumed");
    expect(events).toContain("tool.result");
  });

  test("loads extra MCP servers supplied by headless callers", async () => {
    const serverPath = writeFixture(tmp, "extra-mcp.js", fakeMcpServerScript());
    const chat = new CallbackChatClient((request, index) => {
      if (index === 0) {
        expect(request.tools.map((tool) => tool.function.name)).toContain("mcp__extra__echo");
        return toolCallResponse([
          {
            name: "mcp__extra__echo",
            args: { text: "hello" },
            id: "extra-1",
          },
        ]);
      }
      expect(String(request.messages.at(-1)?.content)).toBe("mcp:hello");
      return textResponse("extra mcp consumed");
    });

    const result = await runSessionTurn({
      chat,
      store,
      workspaceRoot: tmp,
      prompt: "use extra mcp",
      model: TEST_MODEL,
      extraMcpServers: [{
        name: "extra",
        command: process.execPath,
        args: [serverPath],
        cwd: tmp,
      }],
    });

    expect(result.content).toBe("extra mcp consumed");
  });

  test("rejects duplicate MCP server names between plugins and task profile extras", async () => {
    const serverPath = writeFixture(tmp, "fake-mcp.js", fakeMcpServerScript());
    writeFixture(tmp, ".agents/plugins/gdb.json", JSON.stringify({
      name: "gdb-plugin",
      mcpServers: {
        gdb: {
          command: process.execPath,
          args: [serverPath],
        },
      },
    }));

    await expect(runSessionTurn({
      chat: new CallbackChatClient(() => textResponse("unused")),
      store,
      workspaceRoot: tmp,
      prompt: "use debug mcp",
      model: TEST_MODEL,
      extraMcpServers: [{
        name: "gdb",
        command: process.execPath,
        args: [serverPath],
        cwd: tmp,
      }],
    })).rejects.toThrow(/duplicate MCP server name "gdb"/);
  });
});
