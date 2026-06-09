import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import {
  fromAnthropicMessage,
  toAnthropicRequest,
} from "../../app/llm/anthropic-translate.ts";

type OAIMsg = OpenAI.Chat.ChatCompletionMessageParam;
type OAITool = OpenAI.Chat.ChatCompletionFunctionTool;

const READ_TOOL: OAITool = {
  type: "function",
  function: {
    name: "Read",
    description: "Read a file",
    parameters: {
      type: "object",
      properties: { file_path: { type: "string" } },
      required: ["file_path"],
    },
  },
};

describe("toAnthropicRequest", () => {
  test("extracts system messages into the top-level system field", () => {
    const messages: OAIMsg[] = [
      { role: "system", content: "Be brief." },
      { role: "user", content: "hi" },
    ];
    const out = toAnthropicRequest(messages, []);
    expect(out.system).toBe("Be brief.");
    expect(out.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("concatenates multiple system messages", () => {
    const messages: OAIMsg[] = [
      { role: "system", content: "Rule 1" },
      { role: "system", content: "Rule 2" },
      { role: "user", content: "hi" },
    ];
    const out = toAnthropicRequest(messages, []);
    expect(out.system).toBe("Rule 1\n\nRule 2");
  });

  test("preserves developer messages as Anthropic system instructions", () => {
    const messages: OAIMsg[] = [
      { role: "system", content: "Rule 1" },
      { role: "developer", content: "Rule 2" } as OAIMsg,
      { role: "user", content: "hi" },
    ];
    const out = toAnthropicRequest(messages, []);
    expect(out.system).toBe("Rule 1\n\nRule 2");
    expect(out.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("translates assistant text and tool_calls into content blocks", () => {
    const messages: OAIMsg[] = [
      { role: "user", content: "what's in x?" },
      {
        role: "assistant",
        content: "I'll read it.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "Read",
              arguments: JSON.stringify({ file_path: "x" }),
            },
          },
        ],
      },
    ];
    const out = toAnthropicRequest(messages, [READ_TOOL]);
    expect(out.messages).toHaveLength(2);
    const assistantMsg = out.messages[1];
    expect(assistantMsg.role).toBe("assistant");
    const blocks = assistantMsg.content as Anthropic.Messages.ContentBlockParam[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "text", text: "I'll read it." });
    expect(blocks[1]).toEqual({
      type: "tool_use",
      id: "call_1",
      name: "Read",
      input: { file_path: "x" },
    });
  });

  test("groups consecutive tool results into one user message", () => {
    const messages: OAIMsg[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "Read", arguments: "{}" },
          },
          {
            id: "c2",
            type: "function",
            function: { name: "Read", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "result 1" },
      { role: "tool", tool_call_id: "c2", content: "result 2" },
    ];
    const out = toAnthropicRequest(messages, [READ_TOOL]);
    // user(go), assistant(2 tool_use), user(2 tool_result)
    expect(out.messages).toHaveLength(3);
    const last = out.messages[2];
    expect(last.role).toBe("user");
    const blocks = last.content as Anthropic.Messages.ContentBlockParam[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "tool_result",
      tool_use_id: "c1",
      content: "result 1",
    });
    expect(blocks[1]).toEqual({
      type: "tool_result",
      tool_use_id: "c2",
      content: "result 2",
    });
  });

  test("translates tool schemas (drops the 'function' wrapper)", () => {
    const out = toAnthropicRequest([], [READ_TOOL]);
    expect(out.tools).toHaveLength(1);
    expect(out.tools[0]).toEqual({
      name: "Read",
      description: "Read a file",
      input_schema: {
        type: "object",
        properties: { file_path: { type: "string" } },
        required: ["file_path"],
      } as Anthropic.Messages.Tool["input_schema"],
    });
  });

  test("malformed tool_call arguments default to empty input", () => {
    const messages: OAIMsg[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c",
            type: "function",
            function: { name: "Read", arguments: "not-json" },
          },
        ],
      },
    ];
    const out = toAnthropicRequest(messages, []);
    const blocks = out.messages[0].content as Anthropic.Messages.ContentBlockParam[];
    expect((blocks[0] as Anthropic.Messages.ToolUseBlockParam).input).toEqual({});
  });

  test("translates user image and PDF content parts into Anthropic blocks", () => {
    const messages: OAIMsg[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "inspect these" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,aW1n" },
          },
          {
            type: "image_url",
            image_url: { url: "https://example.com/pic.webp" },
          },
          {
            type: "file",
            file: { filename: "paper.pdf", file_data: "JVBERi0xLjQK" },
          } as OpenAI.Chat.ChatCompletionContentPart,
        ],
      },
    ];

    const out = toAnthropicRequest(messages, []);

    const blocks = out.messages[0].content as Anthropic.Messages.ContentBlockParam[];
    expect(blocks).toEqual([
      { type: "text", text: "inspect these" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "aW1n" },
      },
      {
        type: "image",
        source: { type: "url", url: "https://example.com/pic.webp" },
      },
      {
        type: "document",
        title: "paper.pdf",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: "JVBERi0xLjQK",
        },
      },
    ]);
  });

  test("rejects Anthropic-incompatible OpenAI file references", () => {
    const messages: OAIMsg[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            file: { file_id: "file_123" },
          } as OpenAI.Chat.ChatCompletionContentPart,
        ],
      },
    ];

    expect(() => toAnthropicRequest(messages, [])).toThrow(
      /OpenAI file_id content parts cannot be translated to Anthropic/,
    );
  });
});

describe("fromAnthropicMessage", () => {
  test("plain text → assistant with content and no tool_calls", () => {
    const msg: Anthropic.Messages.Message = {
      id: "m1",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [{ type: "text", text: "hello", citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {} as Anthropic.Messages.Usage,
    };
    const out = fromAnthropicMessage(msg);
    expect(out.content).toBe("hello");
    expect(out.tool_calls).toBeUndefined();
  });

  test("tool_use blocks → tool_calls with JSON-stringified arguments", () => {
    const msg: Anthropic.Messages.Message = {
      id: "m2",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [
        { type: "text", text: "let me check", citations: null },
        {
          type: "tool_use",
          id: "tu_1",
          name: "Read",
          input: { file_path: "x" },
          caller: { type: "direct" },
        } as Anthropic.Messages.ToolUseBlock,
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {} as Anthropic.Messages.Usage,
    };
    const out = fromAnthropicMessage(msg);
    expect(out.content).toBe("let me check");
    expect(out.tool_calls).toHaveLength(1);
    expect(out.tool_calls?.[0]).toEqual({
      id: "tu_1",
      type: "function",
      function: { name: "Read", arguments: JSON.stringify({ file_path: "x" }) },
    });
  });

  test("only tool_use blocks → content is null", () => {
    const msg: Anthropic.Messages.Message = {
      id: "m3",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "Read",
          input: {},
          caller: { type: "direct" },
        } as Anthropic.Messages.ToolUseBlock,
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {} as Anthropic.Messages.Usage,
    };
    const out = fromAnthropicMessage(msg);
    expect(out.content).toBeNull();
    expect(out.tool_calls).toHaveLength(1);
  });
});

describe("toAnthropicRequest + fromAnthropicMessage round-trip", () => {
  test("a tool-use assistant message survives a round trip", () => {
    const messages: OAIMsg[] = [
      { role: "user", content: "go" },
    ];
    toAnthropicRequest(messages, [READ_TOOL]); // ensure no throw

    // Simulate an Anthropic response, then translate back.
    const anthResp: Anthropic.Messages.Message = {
      id: "m",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [
        {
          type: "tool_use",
          id: "c1",
          name: "Read",
          input: { file_path: "y" },
          caller: { type: "direct" },
        } as Anthropic.Messages.ToolUseBlock,
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {} as Anthropic.Messages.Usage,
    };
    const oaiAssistant = fromAnthropicMessage(anthResp);
    expect(oaiAssistant.tool_calls?.[0].id).toBe("c1");

    // Now build the next transcript and re-translate; the assistant
    // tool_use must come back as a tool_use block with the same id.
    const next: OAIMsg[] = [
      ...messages,
      oaiAssistant,
      { role: "tool", tool_call_id: "c1", content: "file body" },
    ];
    const out = toAnthropicRequest(next, [READ_TOOL]);
    const assistantBlocks = out.messages[1]
      .content as Anthropic.Messages.ContentBlockParam[];
    expect(assistantBlocks).toHaveLength(1);
    expect((assistantBlocks[0] as Anthropic.Messages.ToolUseBlockParam).id).toBe(
      "c1",
    );
    const toolResultBlocks = out.messages[2]
      .content as Anthropic.Messages.ContentBlockParam[];
    expect(toolResultBlocks[0]).toEqual({
      type: "tool_result",
      tool_use_id: "c1",
      content: "file body",
    });
  });
});
