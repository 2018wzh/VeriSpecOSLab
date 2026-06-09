import type OpenAI from "openai";
import type { StarsTranscriptItem } from "../tui/stars-view.ts";

type RestoredToolCall = Readonly<{
  id: string;
  name: string;
  arguments: string;
}>;

const maxInlineLength = 160;

/**
 * Rebuild the visible TUI transcript from persisted OpenAI-shaped thread
 * messages when an interactive session resumes an existing thread.
 */
export function transcriptItemsFromMessages(
  messages: readonly OpenAI.Chat.ChatCompletionMessageParam[],
): StarsTranscriptItem[] {
  const items: StarsTranscriptItem[] = [];
  const toolNames = new Map<string, string>();

  for (const message of messages) {
    switch (message.role) {
      case "user": {
        const text = contentToText(message.content);
        if (text.length > 0) {
          items.push({ type: "user", text });
        }
        break;
      }
      case "assistant": {
        const text = contentToText(message.content);
        if (text.length > 0) {
          items.push({ type: "assistant", text });
        }
        for (const toolCall of toolCallsFromMessage(message)) {
          if (toolCall.id) {
            toolNames.set(toolCall.id, toolCall.name);
          }
          items.push({
            type: "tool-call",
            name: toolCall.name,
            text: summarizeToolPayload(toolCall.arguments),
          });
        }
        break;
      }
      case "tool": {
        const id = stringField(message, "tool_call_id");
        const text = summarizeToolPayload(contentToText(message.content));
        items.push({ type: "tool-result", name: id ? toolNames.get(id) ?? id : "tool", text });
        break;
      }
      default:
        break;
    }
  }

  return items;
}

function summarizeToolPayload(value: string): string {
  // Match live TUI tool previews: persisted tool payloads can be very large,
  // so resumptions should not spend time wrapping thousands of historical rows.
  const oneLine = value.trim().replace(/\s+/g, " ");
  if (oneLine.length <= maxInlineLength) {
    return oneLine;
  }

  return `${oneLine.slice(0, maxInlineLength - 1)}...`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const text = stringField(part, "text");
      return text ?? "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

function toolCallsFromMessage(message: OpenAI.Chat.ChatCompletionMessageParam): RestoredToolCall[] {
  if (!("tool_calls" in message) || !Array.isArray(message.tool_calls)) {
    return [];
  }

  return message.tool_calls.flatMap((toolCall) => {
    if (!toolCall || typeof toolCall !== "object") {
      return [];
    }
    const id = stringField(toolCall, "id") ?? "";
    const fn = objectField(toolCall, "function");
    const name = fn ? stringField(fn, "name") : undefined;
    if (!name) {
      return [];
    }

    return [{
      id,
      name,
      arguments: fn ? stringField(fn, "arguments") ?? "" : "",
    }];
  });
}

function objectField(value: object, key: string): object | undefined {
  const field = (value as Record<string, unknown>)[key];
  return field && typeof field === "object" ? field : undefined;
}

function stringField(value: object, key: string): string | undefined {
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}
