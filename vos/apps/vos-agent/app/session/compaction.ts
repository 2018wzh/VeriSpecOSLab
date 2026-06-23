import type OpenAI from "openai";
import type { ChatClient, ChatUsage } from "../agent/loop.ts";
import { normalizeModelId } from "../llm/model-registry.ts";
import type { StoredThreadUsage } from "./types.ts";

export interface ContextCompactionOptions {
  /** Compact when the last recorded context-window usage is greater than this value. */
  threshold?: number;
  /** Number of most recent transcript messages to preserve verbatim. */
  protectLastMessages?: number;
}

export type ContextCompactionSetting = false | ContextCompactionOptions;

export const DEFAULT_CONTEXT_COMPACTION_THRESHOLD = 0.8;
export const DEFAULT_PROTECTED_MESSAGES = 8;

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

interface SummaryResult {
  summary: string | undefined;
  usageEvents: ChatUsage[];
}

export async function compactHistoryIfNeeded(
  input: CompactHistoryInput,
): Promise<CompactHistoryResult> {
  const options = resolveCompactionOptions(input.options);
  if (!options) return { compacted: false, messages: [...input.messages], usageEvents: [] };
  if (!shouldCompact(input.model, input.usage, options.threshold)) {
    return { compacted: false, messages: [...input.messages], usageEvents: [] };
  }

  const { older, recent } = splitProtectedMessages(
    input.messages,
    options.protectLastMessages,
  );
  if (older.length === 0) {
    return { compacted: false, messages: [...input.messages], usageEvents: [] };
  }

  const { summary, usageEvents } = await summarizeMessages(
    input.chat,
    input.model,
    older,
    input.signal,
  );
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
): boolean {
  const normalizedModel = normalizeModelId(model);
  const modelUsage = usage.byModel.find((entry) =>
    normalizeModelId(entry.model) === normalizedModel
  );
  const usageRatio = modelUsage?.lastContextWindowUsage
    ?? Math.max(0, ...usage.byModel.map((entry) => entry.lastContextWindowUsage ?? 0));
  return usageRatio > threshold;
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

async function summarizeMessages(
  chat: ChatClient,
  model: string,
  messages: readonly Message[],
  signal: AbortSignal | undefined,
): Promise<SummaryResult> {
  const usageEvents: ChatUsage[] = [];
  const response = await chat.chat({
    model,
    messages: [{
      role: "user",
      content: [
        "Summarize this earlier VOS Agent conversation for continuation.",
        "Preserve decisions, constraints, file paths, commands, failing tests, and unresolved tasks.",
        "Do not include the most recent messages; they will be kept verbatim.",
        "",
        formatTranscript(messages),
      ].join("\n"),
    }],
    tools: [],
    onUsage: (chatUsage) => {
      usageEvents.push(chatUsage);
    },
    ...(signal ? { signal } : {}),
  });

  return {
    summary: typeof response.content === "string" && response.content.trim().length > 0
      ? response.content.trim()
      : undefined,
    usageEvents,
  };
}

function formatTranscript(messages: readonly Message[]): string {
  return messages.map((message, index) =>
    `## Message ${index + 1}: ${message.role}\n${formatMessage(message)}`
  ).join("\n\n");
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
