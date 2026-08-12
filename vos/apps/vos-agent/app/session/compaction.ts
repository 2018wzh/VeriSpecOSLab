import type OpenAI from "openai";
import type { ChatClient, ChatUsage } from "../agent/loop.ts";
import { normalizeModelId } from "../llm/model-registry.ts";
import type { StoredThreadUsage } from "./types.ts";

export interface ContextCompactionOptions {
  /** Compact when the last recorded context-window usage is greater than this value. */
  threshold?: number;
  /** Fallback trigger for models without catalogued context-window metadata. */
  maxInputTokens?: number;
  /** Number of most recent transcript messages to preserve verbatim. */
  protectLastMessages?: number;
}

export type ContextCompactionSetting = false | ContextCompactionOptions;

export const DEFAULT_CONTEXT_COMPACTION_THRESHOLD = 0.8;
export const DEFAULT_CONTEXT_COMPACTION_MAX_INPUT_TOKENS = 60_000;
export const DEFAULT_PROTECTED_MESSAGES = 8;
const MAX_EXTRACTED_SUMMARY_CHARACTERS = 24_000;
const MAX_EXTRACTED_MESSAGE_CHARACTERS = 1_600;

type Message = OpenAI.Chat.ChatCompletionMessageParam;
type UserMessage = OpenAI.Chat.ChatCompletionUserMessageParam;
type UserContent = UserMessage["content"];

export interface CompactHistoryInput {
  chat: ChatClient;
  model: string;
  messages: readonly Message[];
  usage: StoredThreadUsage;
  options?: ContextCompactionSetting;
  signal?: AbortSignal;
}

export interface CompactHistoryResult {
  compacted: boolean;
  messages: Message[];
  usageEvents: ChatUsage[];
}

export async function compactHistoryIfNeeded(
  input: CompactHistoryInput,
): Promise<CompactHistoryResult> {
  const options = resolveCompactionOptions(input.options);
  if (!options) return { compacted: false, messages: [...input.messages], usageEvents: [] };
  if (!shouldCompact(input.model, input.usage, options.threshold, options.maxInputTokens)) {
    return { compacted: false, messages: [...input.messages], usageEvents: [] };
  }

  const { older, recent } = splitProtectedMessages(
    input.messages,
    options.protectLastMessages,
  );
  if (older.length === 0) {
    return { compacted: false, messages: [...input.messages], usageEvents: [] };
  }

  void input.chat;
  void input.signal;
  const summary = extractHistorySummary(older);
  const usageEvents: ChatUsage[] = [];
  if (!summary) {
    return { compacted: false, messages: [...input.messages], usageEvents };
  }
  const summaryContent = `[Compacted conversation summary]\n${summary}`;

  return {
    compacted: true,
    messages: prependCompactionSummary(summaryContent, recent),
    usageEvents,
  };
}

function resolveCompactionOptions(
  setting: ContextCompactionSetting | undefined,
): Required<ContextCompactionOptions> | undefined {
  if (setting === false) return undefined;
  return {
    threshold: setting?.threshold ?? DEFAULT_CONTEXT_COMPACTION_THRESHOLD,
    maxInputTokens: setting?.maxInputTokens ?? DEFAULT_CONTEXT_COMPACTION_MAX_INPUT_TOKENS,
    protectLastMessages: Math.max(
      1,
      Math.trunc(setting?.protectLastMessages ?? DEFAULT_PROTECTED_MESSAGES),
    ),
  };
}

function shouldCompact(
  model: string,
  usage: StoredThreadUsage,
  threshold: number,
  maxInputTokens: number,
): boolean {
  const normalizedModel = normalizeModelId(model);
  const modelUsage = usage.byModel.find((entry) =>
    normalizeModelId(entry.model) === normalizedModel
  );
  const usageRatio = modelUsage?.lastContextWindowUsage
    ?? Math.max(0, ...usage.byModel.map((entry) => entry.lastContextWindowUsage ?? 0));
  if (usageRatio > threshold) return true;
  return (modelUsage?.inputTokens ?? 0) > maxInputTokens;
}

function splitProtectedMessages(
  messages: readonly Message[],
  protectLastMessages: number,
): { older: Message[]; recent: Message[] } {
  let start = Math.max(0, messages.length - protectLastMessages);
  while (start > 0 && messages[start]?.role === "tool") {
    start--;
  }
  return {
    older: messages.slice(0, start),
    recent: messages.slice(start),
  };
}

function prependCompactionSummary(
  summary: string,
  recent: readonly Message[],
): Message[] {
  const first = recent[0];
  if (first?.role !== "user") {
    return [{ role: "user", content: summary }, ...recent];
  }

  return [
    {
      ...first,
      content: prependSummaryToUserContent(summary, first.content),
    },
    ...recent.slice(1),
  ];
}

function prependSummaryToUserContent(summary: string, content: UserContent): UserContent {
  if (typeof content === "string") {
    return `${summary}\n\n${content}`;
  }
  const summaryPart: OpenAI.Chat.ChatCompletionContentPartText = {
    type: "text",
    text: `${summary}\n\n`,
  };
  return [summaryPart, ...content];
}

function extractHistorySummary(messages: readonly Message[]): string | undefined {
  const entries: string[] = [];
  let remaining = MAX_EXTRACTED_SUMMARY_CHARACTERS;
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index--) {
    const message = messages[index]!;
    const formatted = `## Earlier message ${index + 1}: ${message.role}\n${formatMessage(message)}`;
    const bounded = boundText(formatted, Math.min(MAX_EXTRACTED_MESSAGE_CHARACTERS, remaining));
    entries.push(bounded);
    remaining -= bounded.length + 2;
  }
  if (entries.length === 0) return undefined;
  entries.reverse();
  const omitted = messages.length - entries.length;
  return [
    "Deterministic extractive summary. The original transcript remains in the audit log.",
    "Treat only explicit tool results as evidence; do not infer success from plans or assistant prose.",
    ...(omitted > 0 ? [`${omitted} oldest message(s) were omitted by the bounded context policy.`] : []),
    "",
    ...entries,
  ].join("\n\n");
}

function boundText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const marker = "\n...[middle omitted by deterministic context compaction]...\n";
  if (limit <= marker.length) return value.slice(0, limit);
  const available = limit - marker.length;
  const head = Math.ceil(available / 2);
  return `${value.slice(0, head)}${marker}${value.slice(value.length - (available - head))}`;
}

function formatMessage(message: Message): string {
  const parts = [stringifyContent(message.content)];
  if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
    parts.push(
      "Tool calls:",
      ...message.tool_calls.map((call) =>
        call.type === "function"
          ? `- ${call.function.name}: ${call.function.arguments}`
          : `- unsupported tool call: ${call.type}`
      ),
    );
  }
  if (message.role === "tool") {
    parts.unshift(`tool_call_id: ${message.tool_call_id}`);
  }
  return parts.filter((part) => part.length > 0).join("\n");
}

function stringifyContent(content: Message["content"]): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object" && "type" in part && part.type === "text") {
      return part.text;
    }
    if (part && typeof part === "object" && "type" in part && part.type === "image_url") {
      return "[Image omitted]";
    }
    return JSON.stringify(part);
  }).join("\n");
}
