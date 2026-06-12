import type OpenAI from "openai";
import type { ReasoningEffort } from "../config.ts";

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
  | {
      type: "agent.done";
      thread_id: string;
      iteration: number;
      content: string | null;
    }
  | { type: "done"; thread_id: string; content: string | null };
