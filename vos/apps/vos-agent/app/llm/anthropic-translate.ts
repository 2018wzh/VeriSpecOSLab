import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";

/**
 * Translation between the OpenAI chat-completion shape (used as the
 * canonical internal format) and the Anthropic Messages API shape.
 *
 * Differences worth knowing:
 *   - OpenAI puts `system` in the `messages` array; Anthropic puts it
 *     in a top-level `system` field.
 *   - OpenAI emits one `role:"tool"` message per tool result;
 *     Anthropic groups all tool results from the same turn into one
 *     `role:"user"` message containing multiple `tool_result` blocks.
 *   - OpenAI's assistant messages carry `tool_calls` alongside `content`;
 *     Anthropic represents both as content blocks (`text` + `tool_use`)
 *     on the assistant message.
 *   - Anthropic requires `max_tokens`. We default it; callers may
 *     override at the client level.
 */

type OAIMsg = OpenAI.Chat.ChatCompletionMessageParam;
type OAITool = OpenAI.Chat.ChatCompletionFunctionTool;

type AntMsg = Anthropic.Messages.MessageParam;
type AntBlock = Anthropic.Messages.ContentBlockParam;
type AntTool = Anthropic.Messages.Tool;

export interface TranslatedRequest {
  system?: string;
  messages: AntMsg[];
  tools: AntTool[];
}

/**
 * Convert an OpenAI-shaped request (messages + tools) into Anthropic
 * shape. System messages are extracted; consecutive tool results are
 * grouped into a single user message.
 */
export function toAnthropicRequest(
  messages: OAIMsg[],
  tools: OAITool[],
): TranslatedRequest {
  const systemParts: string[] = [];
  const out: AntMsg[] = [];

  let i = 0;
  while (i < messages.length) {
    const m = messages[i];

    if (m.role === "system" || m.role === "developer") {
      appendTextParts(systemParts, m.content);
      i++;
      continue;
    }

    if (m.role === "user") {
      out.push({ role: "user", content: userContentToAnthropic(m.content) });
      i++;
      continue;
    }

    if (m.role === "assistant") {
      const blocks: AntBlock[] = [];
      const text = stringifyOAIContent(m.content);
      if (text) blocks.push({ type: "text", text });
      const toolCalls = m.tool_calls ?? [];
      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: safeJsonParse(call.function.arguments) ?? {},
        });
      }
      if (blocks.length === 0) {
        // Empty assistant message — Anthropic rejects empty content.
        blocks.push({ type: "text", text: "" });
      }
      out.push({ role: "assistant", content: blocks });
      i++;
      continue;
    }

    if (m.role === "tool") {
      // Collect consecutive tool messages into one user turn.
      const blocks: AntBlock[] = [];
      while (i < messages.length && messages[i].role === "tool") {
        const t = messages[i] as OpenAI.Chat.ChatCompletionToolMessageParam;
        blocks.push({
          type: "tool_result",
          tool_use_id: t.tool_call_id,
          content: stringifyOAIContent(t.content),
        });
        i++;
      }
      out.push({ role: "user", content: blocks });
      continue;
    }

    // Unknown role (function legacy, etc.) — skip.
    i++;
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: out,
    tools: tools.map((t) => ({
      name: t.function.name,
      description: t.function.description ?? undefined,
      input_schema: (t.function.parameters ?? {
        type: "object",
        properties: {},
      }) as AntTool["input_schema"],
    })),
  };
}

/**
 * Convert an Anthropic Message (assistant turn) into the OpenAI
 * ChatCompletionMessage shape the agent loop expects.
 */
export function fromAnthropicMessage(
  msg: Anthropic.Messages.Message,
): OpenAI.Chat.ChatCompletionMessage {
  const textParts: string[] = [];
  const toolCalls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = [];

  for (const block of msg.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
    // Other block types (thinking, citations, etc.) are dropped for now.
  }

  const out = {
    role: "assistant" as const,
    content: textParts.length > 0 ? textParts.join("") : null,
    refusal: null,
  } as OpenAI.Chat.ChatCompletionMessage;

  if (toolCalls.length > 0) {
    out.tool_calls = toolCalls;
  }
  return out;
}

function stringifyOAIContent(content: OAIMsg["content"]): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  // Multi-modal content array — concatenate any text parts.
  return content
    .map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object" && "type" in p && p.type === "text") {
        return (p as { text: string }).text;
      }
      return "";
    })
    .join("");
}

function userContentToAnthropic(content: OAIMsg["content"]): AntMsg["content"] {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;

  const blocks: AntBlock[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      blocks.push({ type: "text", text: part });
      continue;
    }
    if (!part || typeof part !== "object" || !("type" in part)) continue;

    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "image_url") {
      blocks.push(imagePartToAnthropic(part));
      continue;
    }
    if (part.type === "file") {
      blocks.push(filePartToAnthropic(part));
      continue;
    }

    throw new Error(
      `OpenAI content part type "${part.type}" cannot be translated to Anthropic user content`,
    );
  }

  return blocks.length > 0 ? blocks : "";
}

function imagePartToAnthropic(
  part: OpenAI.Chat.ChatCompletionContentPartImage,
): Anthropic.Messages.ImageBlockParam {
  const url = part.image_url.url;
  const dataUrl = parseBase64DataUrl(url);
  if (dataUrl) {
    if (!isAnthropicImageMediaType(dataUrl.mediaType)) {
      throw new Error(
        `Unsupported image media type for Anthropic: ${dataUrl.mediaType}`,
      );
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: dataUrl.mediaType,
        data: dataUrl.data,
      },
    };
  }

  if (!isHttpUrl(url)) {
    throw new Error(
      "Anthropic image content requires an http(s) URL or data:<image/*>;base64 payload",
    );
  }
  return { type: "image", source: { type: "url", url } };
}

function filePartToAnthropic(
  part: OpenAI.Chat.ChatCompletionContentPart.File,
): Anthropic.Messages.DocumentBlockParam {
  if (part.file.file_id) {
    throw new Error(
      "OpenAI file_id content parts cannot be translated to Anthropic; pass PDF file_data instead",
    );
  }
  const fileData = part.file.file_data;
  if (!fileData) {
    throw new Error(
      "OpenAI file content parts require file_data to be translated to Anthropic",
    );
  }

  const dataUrl = parseBase64DataUrl(fileData);
  let data = fileData;
  if (dataUrl) {
    if (dataUrl.mediaType !== "application/pdf") {
      throw new Error(
        `Only PDF file_data can be translated to Anthropic documents, got ${dataUrl.mediaType}`,
      );
    }
    data = dataUrl.data;
  } else if (!part.file.filename?.toLowerCase().endsWith(".pdf")) {
    throw new Error(
      "Only PDF file_data can be translated to Anthropic documents; include a .pdf filename or data:application/pdf;base64 payload",
    );
  }

  return {
    type: "document",
    ...(part.file.filename ? { title: part.file.filename } : {}),
    source: { type: "base64", media_type: "application/pdf", data },
  };
}

function parseBase64DataUrl(
  value: string,
): { mediaType: string; data: string } | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/is.exec(value);
  if (!match) return undefined;
  return { mediaType: match[1].toLowerCase(), data: match[2] };
}

function isAnthropicImageMediaType(
  mediaType: string,
): mediaType is Anthropic.Messages.Base64ImageSource["media_type"] {
  return (
    mediaType === "image/jpeg" ||
    mediaType === "image/png" ||
    mediaType === "image/gif" ||
    mediaType === "image/webp"
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function appendTextParts(
  out: string[],
  content: OAIMsg["content"],
): void {
  const text = stringifyOAIContent(content);
  if (text) out.push(text);
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
