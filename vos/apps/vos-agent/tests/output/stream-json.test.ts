import { describe, expect, test } from "bun:test";
import {
  StreamJsonEncoder,
  createStreamJsonErrorEvent,
  formatStreamJsonEvent,
  streamJsonLines,
} from "../../app/output/stream-json.ts";

describe("stream JSON output", () => {
  test("formats one JSON object per line", () => {
    const line = formatStreamJsonEvent({
      type: "result",
      subtype: "success",
      duration_ms: 10,
      is_error: false,
      num_turns: 1,
      result: "ok",
      session_id: "T-1",
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      type: "result",
      subtype: "success",
      duration_ms: 10,
      is_error: false,
      num_turns: 1,
      result: "ok",
      session_id: "T-1",
    });
  });

  test("serializes compatible lifecycle events without extra output", () => {
    const out = streamJsonLines([
      {
        type: "system",
        subtype: "init",
        cwd: "/repo",
        session_id: "T-1",
        tools: ["Read"],
        mcp_servers: [],
        model: "opus4.7",
      },
      {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
        parent_tool_use_id: null,
        session_id: "T-1",
      },
      {
        type: "result",
        subtype: "success",
        duration_ms: 1,
        is_error: false,
        num_turns: 1,
        result: "ok",
        session_id: "T-1",
      },
    ]);
    const lines = out.trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([
      {
        type: "system",
        subtype: "init",
        cwd: "/repo",
        session_id: "T-1",
        tools: ["Read"],
        mcp_servers: [],
        model: "opus4.7",
      },
      {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
        parent_tool_use_id: null,
        session_id: "T-1",
      },
      {
        type: "result",
        subtype: "success",
        duration_ms: 1,
        is_error: false,
        num_turns: 1,
        result: "ok",
        session_id: "T-1",
      },
    ]);
  });

  test("maps a tool-using session to Claude/Amp-compatible events", () => {
    const encoder = new StreamJsonEncoder({
      cwd: "/repo",
      startedAt: 1_000,
      now: () => 1_250,
    });
    const events = [];
    encoder.beginTurn("inspect README");
    events.push(...encoder.encode({
      type: "thread.created",
      thread_id: "T-1",
      model: "opus4.7",
      mode: "smart",
      tools: ["Read"],
      cwd: "/repo",
    }));
    events.push(...encoder.encode({
      type: "assistant.message",
      thread_id: "T-1",
      iteration: 1,
      content: null,
      toolCalls: [
        {
          id: "call_1",
          name: "Read",
          arguments: '{"file_path":"README.md"}',
        },
      ],
    }));
    events.push(...encoder.encode({
      type: "tool.call",
      thread_id: "T-1",
      iteration: 1,
      id: "call_1",
      name: "Read",
      arguments: '{"file_path":"README.md"}',
    }));
    events.push(...encoder.encode({
      type: "tool.result",
      thread_id: "T-1",
      iteration: 1,
      id: "call_1",
      name: "Read",
      content: "# Stars",
    }));
    events.push(...encoder.encode({
      type: "assistant.message",
      thread_id: "T-1",
      iteration: 2,
      content: "done",
      toolCalls: [],
    }));
    events.push(...encoder.encode({
      type: "agent.done",
      thread_id: "T-1",
      iteration: 2,
      content: "done",
    }));
    events.push(...encoder.encode({ type: "thread.saved", thread_id: "T-1" }));
    events.push(...encoder.encode({ type: "done", thread_id: "T-1", content: "done" }));

    expect(events).toEqual([
      {
        type: "system",
        subtype: "init",
        cwd: "/repo",
        session_id: "T-1",
        tools: ["Read"],
        mcp_servers: [],
        model: "opus4.7",
        agent_mode: "smart",
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "inspect README" }],
        },
        parent_tool_use_id: null,
        session_id: "T-1",
      },
      {
        type: "assistant",
        message: {
          type: "message",
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "call_1",
            name: "Read",
            input: { file_path: "README.md" },
          }],
          stop_reason: "tool_use",
        },
        parent_tool_use_id: null,
        session_id: "T-1",
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "call_1",
            content: "# Stars",
            is_error: false,
          }],
        },
        parent_tool_use_id: null,
        session_id: "T-1",
      },
      {
        type: "assistant",
        message: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
        },
        parent_tool_use_id: null,
        session_id: "T-1",
      },
      {
        type: "result",
        subtype: "success",
        duration_ms: 250,
        is_error: false,
        num_turns: 2,
        result: "done",
        session_id: "T-1",
      },
    ]);
  });

  test("groups assistant text and multiple tool uses into one assistant event", () => {
    const encoder = new StreamJsonEncoder({ cwd: "/repo" });
    encoder.beginTurn("inspect two files");
    const events = [
      ...encoder.encode({
        type: "thread.created",
        thread_id: "T-1",
        model: "opus4.7",
        tools: ["Read"],
        cwd: "/repo",
      }),
      ...encoder.encode({
        type: "assistant.message",
        thread_id: "T-1",
        iteration: 1,
        content: "I will inspect both files.",
        toolCalls: [
          { id: "call_1", name: "Read", arguments: '{"file_path":"a.txt"}' },
          { id: "call_2", name: "Read", arguments: '{"file_path":"b.txt"}' },
        ],
      }),
    ];

    expect(events[2]).toEqual({
      type: "assistant",
      message: {
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect both files." },
          {
            type: "tool_use",
            id: "call_1",
            name: "Read",
            input: { file_path: "a.txt" },
          },
          {
            type: "tool_use",
            id: "call_2",
            name: "Read",
            input: { file_path: "b.txt" },
          },
        ],
        stop_reason: "tool_use",
      },
      parent_tool_use_id: null,
      session_id: "T-1",
    });
  });

  test("includes MCP server names in the init event", () => {
    const encoder = new StreamJsonEncoder({ cwd: "/repo" });

    const events = encoder.encode({
      type: "thread.created",
      thread_id: "T-1",
      model: "opus4.7",
      tools: ["Read", "mcp__fake__echo"],
      mcpServers: ["fake"],
      cwd: "/repo",
    });

    expect(events[0]).toMatchObject({
      type: "system",
      subtype: "init",
      mcp_servers: ["fake"],
    });
  });

  test("formats structured error result events", () => {
    expect(createStreamJsonErrorEvent(new Error("bad input"), {
      durationMs: 12,
      line: 3,
      sessionId: "T-1",
      numTurns: 1,
      errorCode: "malformed_stream_json_input",
    })).toEqual({
      type: "result",
      subtype: "error_during_execution",
      duration_ms: 12,
      is_error: true,
      num_turns: 1,
      error: "bad input",
      errors: ["bad input"],
      error_code: "malformed_stream_json_input",
      line: 3,
      session_id: "T-1",
    });
  });
});
