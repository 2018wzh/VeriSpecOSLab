import type { SessionEvent } from "../session/types.ts";
import type { ReasoningEffort } from "../config.ts";

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error: boolean;
};

export type StreamJsonOutputEvent =
  | {
      type: "system";
      subtype: "init";
      cwd: string;
      session_id: string;
      tools: string[];
      mcp_servers: string[];
      model?: string;
      agent_mode?: string;
      reasoning_effort?: ReasoningEffort;
    }
  | {
      type: "user";
      message: {
        role: "user";
        content: Array<TextBlock | ToolResultBlock>;
      };
      parent_tool_use_id: string | null;
      session_id: string;
    }
  | {
      type: "assistant";
      message: {
        type: "message";
        role: "assistant";
        content: Array<TextBlock | ToolUseBlock>;
        stop_reason: "end_turn" | "tool_use" | null;
      };
      parent_tool_use_id: string | null;
      session_id: string;
    }
  | {
      type: "result";
      subtype: "success";
      duration_ms: number;
      is_error: false;
      num_turns: number;
      result: string;
      session_id: string;
    }
  | {
      type: "result";
      subtype: "error_during_execution" | "error_max_turns";
      duration_ms: number;
      is_error: true;
      num_turns: number;
      error: string;
      errors: string[];
      error_code?: StreamJsonErrorCode;
      line?: number;
      session_id?: string;
    };

export type StreamJsonEvent = StreamJsonOutputEvent | Record<string, unknown>;

export type StreamJsonErrorCode =
  | "malformed_stream_json_input"
  | "invalid_stream_json_input"
  | "agent_error"
  | "max_turns";

export interface StreamJsonEncoderOptions {
  cwd: string;
  startedAt?: number;
  now?: () => number;
  emitFinalResult?: boolean;
}

export interface StreamJsonErrorOptions {
  durationMs?: number;
  errorCode?: StreamJsonErrorCode;
  line?: number;
  numTurns?: number;
  sessionId?: string;
  subtype?: "error_during_execution" | "error_max_turns";
}

export class StreamJsonEncoder {
  private readonly cwd: string;
  private readonly startedAt: number;
  private readonly now: () => number;
  private readonly emitFinalResult: boolean;
  private initialized = false;
  private sessionId: string | undefined;
  private pendingPrompt: string | undefined;
  private completedTurns = 0;

  constructor(opts: StreamJsonEncoderOptions) {
    this.cwd = opts.cwd;
    this.startedAt = opts.startedAt ?? Date.now();
    this.now = opts.now ?? (() => Date.now());
    this.emitFinalResult = opts.emitFinalResult ?? true;
  }

  beginTurn(prompt: string): void {
    this.pendingPrompt = prompt;
  }

  encode(event: SessionEvent): StreamJsonOutputEvent[] {
    if (event.type === "thread.created" || event.type === "thread.loaded") {
      this.sessionId = event.thread_id;
      const events: StreamJsonOutputEvent[] = [];
      if (!this.initialized) {
        this.initialized = true;
        events.push({
          type: "system",
          subtype: "init",
          cwd: event.cwd || this.cwd,
          session_id: event.thread_id,
          tools: event.tools,
          mcp_servers: event.mcpServers ?? [],
          model: event.model,
          ...(event.mode ? { agent_mode: event.mode } : {}),
          ...(event.reasoningEffort ? { reasoning_effort: event.reasoningEffort } : {}),
        });
      }
      const userEvent = this.consumePendingUserEvent();
      if (userEvent) events.push(userEvent);
      return events;
    }

    if (event.type === "assistant.message") {
      const content: Array<TextBlock | ToolUseBlock> = [];
      if (event.content !== null) {
        content.push({ type: "text", text: event.content });
      }
      for (const toolCall of event.toolCalls) {
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: parseToolInput(toolCall.arguments),
        });
      }
      if (content.length === 0) return [];
      return [{
        type: "assistant",
        message: {
          type: "message",
          role: "assistant",
          content,
          stop_reason: event.toolCalls.length > 0 ? "tool_use" : "end_turn",
        },
        parent_tool_use_id: null,
        session_id: event.thread_id,
      }];
    }

    if (event.type === "assistant.delta") {
      return [];
    }

    if (event.type === "tool.call") {
      return [];
    }

    if (event.type === "tool.result") {
      return [{
        type: "user",
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: event.id,
            content: event.content,
            is_error: false,
          }],
        },
        parent_tool_use_id: null,
        session_id: event.thread_id,
      }];
    }

    if (event.type === "agent.done") {
      this.completedTurns += event.iteration;
      return [];
    }

    if (event.type === "done") {
      if (!this.emitFinalResult) return [];
      return [this.successEvent(event.content)];
    }

    return [];
  }

  successEvent(content: string | null): StreamJsonOutputEvent {
    return {
      type: "result",
      subtype: "success",
      duration_ms: Math.max(0, this.now() - this.startedAt),
      is_error: false,
      num_turns: this.completedTurns,
      result: content ?? "",
      session_id: this.sessionId ?? "",
    };
  }

  errorEvent(error: unknown, opts: Omit<StreamJsonErrorOptions, "durationMs" | "numTurns" | "sessionId"> = {}): StreamJsonOutputEvent {
    return createStreamJsonErrorEvent(error, {
      ...opts,
      durationMs: Math.max(0, this.now() - this.startedAt),
      numTurns: this.completedTurns,
      sessionId: this.sessionId,
    });
  }

  private consumePendingUserEvent(): StreamJsonOutputEvent | undefined {
    if (this.pendingPrompt === undefined || this.sessionId === undefined) {
      return undefined;
    }
    const prompt = this.pendingPrompt;
    this.pendingPrompt = undefined;
    return {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: prompt }],
      },
      parent_tool_use_id: null,
      session_id: this.sessionId,
    };
  }
}

export function createStreamJsonErrorEvent(
  error: unknown,
  opts: StreamJsonErrorOptions = {},
): StreamJsonOutputEvent {
  const message = formatError(error);
  return {
    type: "result",
    subtype: opts.subtype ?? (opts.errorCode === "max_turns" ? "error_max_turns" : "error_during_execution"),
    duration_ms: opts.durationMs ?? 0,
    is_error: true,
    num_turns: opts.numTurns ?? 0,
    error: message,
    errors: [message],
    ...(opts.errorCode ? { error_code: opts.errorCode } : {}),
    ...(opts.line !== undefined ? { line: opts.line } : {}),
    ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
  };
}

export function formatStreamJsonEvent(event: StreamJsonEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function streamJsonLines(events: readonly StreamJsonEvent[]): string {
  return events.map(formatStreamJsonEvent).join("");
}

function parseToolInput(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed tool-call arguments are already handled by tools. Stream
    // output stays JSONL-compatible by representing the input as empty.
  }
  return {};
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
