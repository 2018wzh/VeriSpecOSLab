import type OpenAI from "openai";
import type { ReasoningEffort } from "../config.ts";
import type { ToolRegistry } from "../tools/types.ts";
import { throwIfAborted } from "../cancellation.ts";

export interface ChatRequest {
  /** Model identifier for this turn. Drives routing in multi-provider setups. */
  model: string;
  /** Optional provider reasoning-effort hint selected by mode/config. */
  reasoningEffort?: ReasoningEffort;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools: OpenAI.Chat.ChatCompletionFunctionTool[];
  /** Optional provider text streaming hook. Final messages are still returned by chat(). */
  onEvent?: (event: ChatStreamEvent) => void | Promise<void>;
  /** Optional provider token-usage hook. */
  onUsage?: (usage: ChatUsage) => void | Promise<void>;
  /** Optional cancellation signal for provider requests. */
  signal?: AbortSignal;
}

export type ChatStreamEvent = Readonly<{
  type: "text.delta";
  delta: string;
}>;

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export type ChatInputKind = "text" | "image" | "pdf";
export type ChatInputCapabilities = Readonly<Record<ChatInputKind, boolean>>;

export interface ChatClientCapabilities {
  /** Provider-boundary input shapes Stars can safely pass to this client. */
  readonly input: ChatInputCapabilities;
}

export function defineChatClientCapabilities(
  input: Record<ChatInputKind, boolean>,
): ChatClientCapabilities {
  return Object.freeze({ input: Object.freeze({ ...input }) });
}

export const TEXT_ONLY_CHAT_CLIENT_CAPABILITIES = defineChatClientCapabilities({
  text: true,
  image: false,
  pdf: false,
});

export function chatClientCapabilities(
  chat: ChatClient,
  model: string,
): ChatClientCapabilities {
  return chat.capabilities?.(model) ?? TEXT_ONLY_CHAT_CLIENT_CAPABILITIES;
}

export function chatClientSupportsInput(
  chat: ChatClient,
  model: string,
  kind: ChatInputKind,
): boolean {
  return chatClientCapabilities(chat, model).input[kind];
}

/**
 * Minimal abstraction over an LLM chat endpoint. Production code wires
 * this to OpenAI/Anthropic via the createXxxChatClient functions in
 * app/llm/; tests inject scripted stubs to drive the agent loop
 * deterministically.
 *
 * The interface speaks OpenAI shapes (messages + tools + return value)
 * so that the agent loop has a single mental model. Non-OpenAI
 * providers translate at their boundaries.
 */
export interface ChatClient {
  /** Optional provider/model capability metadata for callers building inputs. */
  capabilities?: (model: string) => ChatClientCapabilities;
  chat(request: ChatRequest): Promise<OpenAI.Chat.ChatCompletionMessage>;
}

export interface RunAgentOptions {
  chat: ChatClient;
  registry: ToolRegistry;
  prompt: string;
  /** Model identifier sent on every request. */
  model: string;
  /** Optional provider reasoning-effort hint sent on every request. */
  reasoningEffort?: ReasoningEffort;
  /** Safety cap on round-trips. Default 50. */
  maxIterations?: number;
  /** Optional system prompt prepended to the conversation. */
  system?: string;
  /** Existing transcript to continue. Copied before mutation. */
  history?: OpenAI.Chat.ChatCompletionMessageParam[];
  /** When true, ask capable providers to emit assistant text deltas. */
  streamAssistant?: boolean;
  /** Optional lifecycle event hook for TUI/stream-json/session surfaces. */
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  /** Optional cancellation signal for the whole agent run. */
  signal?: AbortSignal;
}

export type AgentEvent =
  | {
      type: "assistant.delta";
      iteration: number;
      delta: string;
    }
  | {
      type: "assistant.message";
      iteration: number;
      message: OpenAI.Chat.ChatCompletionMessage;
    }
  | {
      type: "tool.call";
      iteration: number;
      toolCall: OpenAI.Chat.ChatCompletionMessageFunctionToolCall;
    }
  | {
      type: "tool.result";
      iteration: number;
      toolCallId: string;
      name: string;
      content: string;
    }
  | {
      type: "model.usage";
      iteration: number;
      model: string;
      usage: ChatUsage;
    }
  | { type: "agent.done"; iteration: number; content: string | null };

export interface RunAgentResult {
  /** Final assistant text reply (may be null per OpenAI spec). */
  content: string | null;
  /** Full conversation transcript, useful for debugging/tests. */
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  /** Number of model round-trips that occurred. */
  iterations: number;
}

/**
 * The agent loop:
 *   1. Send messages + tool schemas to the model
 *   2. Append the assistant reply to the transcript
 *   3. If reply has no tool_calls → terminate, return the content
 *   4. Else execute each tool, append role:"tool" results, and repeat
 *
 * Throws if maxIterations is exceeded without a terminating reply.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const {
    chat,
    registry,
    prompt,
    model,
    reasoningEffort,
    maxIterations = 50,
    system,
    history,
    streamAssistant = false,
    onEvent,
    signal,
  } = opts;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error(
      `maxIterations must be a positive integer, got ${maxIterations}`,
    );
  }
  throwIfAborted(signal);

  const tools = registry.schemas();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = history
    ? [...history]
    : [];
  if (history && system) {
    throw new Error("system cannot be provided when continuing from history");
  }
  if (messages.length === 0 && system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: prompt });

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    throwIfAborted(signal);
    const message = await chat.chat({
      model,
      reasoningEffort,
      messages,
      tools,
      ...(signal ? { signal } : {}),
      ...(streamAssistant && onEvent
        ? {
            onEvent: async (event) => {
              if (event.type === "text.delta" && event.delta.length > 0) {
                await onEvent({ type: "assistant.delta", iteration, delta: event.delta });
              }
            },
          }
        : {}),
      ...(onEvent
        ? {
            onUsage: async (usage) => {
              await onEvent({ type: "model.usage", iteration, model, usage });
            },
          }
        : {}),
    });
    messages.push(message);
    await onEvent?.({ type: "assistant.message", iteration, message });
    throwIfAborted(signal);

    const toolCalls = message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      await onEvent?.({ type: "agent.done", iteration, content: message.content });
      return { content: message.content, messages, iterations: iteration };
    }

    if (iteration === maxIterations) {
      throw new Error(
        `agent loop reached max iterations (${maxIterations}) before tool calls could be completed`,
      );
    }

    for (const call of toolCalls) {
      throwIfAborted(signal);
      if (call.type !== "function") {
        throw new Error(`unsupported tool call type: ${call.type}`);
      }
      await onEvent?.({ type: "tool.call", iteration, toolCall: call });
      const result = await registry.execute(
        call.function.name,
        call.function.arguments,
        { signal },
      );
      throwIfAborted(signal);
      await onEvent?.({
        type: "tool.result",
        iteration,
        toolCallId: call.id,
        name: call.function.name,
        content: result,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }
  throw new Error(`agent loop exceeded max iterations (${maxIterations})`);
}
