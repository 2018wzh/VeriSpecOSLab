import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { transcriptItemsFromMessages } from "../../app/terminal/transcript.ts";

describe("terminal transcript restoration", () => {
  test("rebuilds visible transcript rows from stored chat messages", () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
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

    expect(transcriptItemsFromMessages(messages)).toEqual([
      { type: "user", text: "old question" },
      { type: "assistant", text: "old answer" },
      { type: "tool-call", name: "Read", text: "{\"file_path\":\"README.md\"}" },
      { type: "tool-result", name: "Read", text: "old tool output" },
    ]);
  });

  test("keeps text content parts and tolerates unmatched tool results", () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
      },
      { role: "tool", tool_call_id: "missing-tool", content: "orphan result" },
    ];

    expect(transcriptItemsFromMessages(messages)).toEqual([
      { type: "user", text: "first\nsecond" },
      { type: "tool-result", name: "missing-tool", text: "orphan result" },
    ]);
  });

  test("summarizes restored tool payloads so large histories stay responsive", () => {
    const payload = `line one\n${"x".repeat(240)}`;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "tool-1",
          type: "function",
          function: { name: "Bash", arguments: payload },
        }],
      },
      { role: "tool", tool_call_id: "tool-1", content: payload },
    ];

    const items = transcriptItemsFromMessages(messages);
    const callText = items[0]?.type === "tool-call" ? items[0].text ?? "" : "";
    const resultText = items[1]?.type === "tool-result" ? items[1].text : "";

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: "tool-call", name: "Bash" });
    expect(items[1]).toMatchObject({ type: "tool-result", name: "Bash" });
    expect(callText.length).toBeLessThan(payload.length);
    expect(resultText.length).toBeLessThan(payload.length);
    expect(callText).toContain("...");
    expect(resultText).toContain("...");
    expect(callText).not.toContain("\n");
    expect(resultText).not.toContain("\n");
  });
});
