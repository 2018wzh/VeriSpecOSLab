import type OpenAI from "openai";
import type { ReasoningEffort } from "../config.ts";
import type { ModelProvider } from "../llm/model-registry.ts";

export const THREAD_SCHEMA_VERSION = 1 as const;

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface AgentGuidanceFileRef {
  path: string;
  scopeDir: string;
}

export interface StoredUsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  estimatedCostUsd?: number;
}

export interface StoredModelUsage extends StoredUsageTotals {
  model: string;
  provider?: ModelProvider;
  contextWindowTokens?: number;
  lastContextWindowUsage?: number;
}

export interface StoredThreadUsage extends StoredUsageTotals {
  byModel: StoredModelUsage[];
}

export interface ModelUsageEvent extends StoredUsageTotals {
  model: string;
  provider?: ModelProvider;
  contextWindowTokens?: number;
  contextWindowUsage?: number;
}

export interface StoredThread {
  schemaVersion: typeof THREAD_SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspaceRoot: string;
  model: string;
  mode?: string;
  reasoningEffort?: ReasoningEffort;
  archivedAt?: string;
  guidanceFiles: AgentGuidanceFileRef[];
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  todos: TodoItem[];
  usage: StoredThreadUsage;
}

export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspaceRoot: string;
  model: string;
  mode?: string;
  reasoningEffort?: ReasoningEffort;
  archivedAt?: string;
  messageCount: number;
  usage: StoredThreadUsage;
  path: string;
}

export type SessionEvent =
  | {
      type: "thread.created";
      thread_id: string;
      model: string;
      mode?: string;
      reasoningEffort?: ReasoningEffort;
      tools: string[];
      mcpServers?: string[];
      cwd: string;
    }
  | {
      type: "thread.loaded";
      thread_id: string;
      model: string;
      mode?: string;
      reasoningEffort?: ReasoningEffort;
      tools: string[];
      mcpServers?: string[];
      cwd: string;
    }
  | { type: "thread.saved"; thread_id: string }
  | {
      type: "assistant.delta";
      thread_id: string;
      iteration: number;
      delta: string;
    }
  | {
      type: "assistant.message";
      thread_id: string;
      iteration: number;
      content: string | null;
      toolCalls: Array<{
        id: string;
        name: string;
        arguments: string;
      }>;
    }
  | {
      type: "tool.call";
      thread_id: string;
      iteration: number;
      name: string;
      id: string;
      arguments: string;
    }
  | {
      type: "tool.result";
      thread_id: string;
      iteration: number;
      name: string;
      id: string;
      content: string;
    }
  | ({
      type: "model.usage";
      thread_id: string;
      iteration: number;
    } & ModelUsageEvent)
  | {
      type: "agent.done";
      thread_id: string;
      iteration: number;
      content: string | null;
    }
  | { type: "done"; thread_id: string; content: string | null };
