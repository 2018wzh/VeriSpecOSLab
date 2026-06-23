import type { ChatClient } from "../agent/loop.ts";
import type { ReasoningEffort } from "../config.ts";
import type { PermissionRule } from "../tools/permissions.ts";
import { runSessionTurn } from "./run-turn.ts";
import type { SessionEvent, StoredThread } from "./types.ts";
import type { ThreadStore } from "./thread-store.ts";

export class StreamJsonInputError extends Error {
  readonly code = "malformed_stream_json_input" as const;

  constructor(message: string, readonly line: number) {
    super(message);
    this.name = "StreamJsonInputError";
  }
}

export interface RunStreamJsonInputSessionOptions {
  chat: ChatClient;
  store: ThreadStore;
  workspaceRoot: string;
  input: string;
  model?: string;
  mode?: string;
  reasoningEffort?: ReasoningEffort;
  disabledTools?: readonly string[];
  permissionRules?: readonly PermissionRule[];
  threadId?: string;
  startDir?: string;
  maxIterations?: number;
  onTurnStart?: (prompt: string, line: number) => void | Promise<void>;
  onEvent?: (event: SessionEvent) => void | Promise<void>;
}

export interface RunStreamJsonInputSessionResult {
  content: string | null;
  thread: StoredThread;
  turns: number;
  iterations: number;
}

export async function runStreamJsonInputSession(
  opts: RunStreamJsonInputSessionOptions,
): Promise<RunStreamJsonInputSessionResult> {
  let threadId = opts.threadId;
  let result: { content: string | null; thread: StoredThread; iterations: number } | undefined;
  let turns = 0;
  let iterations = 0;

  for (const { line, lineNumber } of inputLines(opts.input)) {
    const prompt = parseStreamJsonInputLine(line, lineNumber);
    turns++;
    await opts.onTurnStart?.(prompt, lineNumber);
    result = await runSessionTurn({
      chat: opts.chat,
      store: opts.store,
      workspaceRoot: opts.workspaceRoot,
      prompt,
      threadId,
      startDir: opts.startDir,
      maxIterations: opts.maxIterations,
      model: opts.model,
      mode: opts.mode,
      reasoningEffort: opts.reasoningEffort,
      disabledTools: opts.disabledTools,
      permissionRules: opts.permissionRules,
      onEvent: opts.onEvent,
    });
    threadId = result.thread.id;
    iterations += result.iterations;
  }

  if (!result) {
    throw new StreamJsonInputError(
      "stream-json-input did not contain any user messages",
      1,
    );
  }

  return {
    content: result.content,
    thread: result.thread,
    turns,
    iterations,
  };
}

export function parseStreamJsonInputLine(line: string, lineNumber: number): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (e) {
    throw new StreamJsonInputError(
      `Malformed stream-json-input at line ${lineNumber}: ${(e as Error).message}`,
      lineNumber,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw malformed(lineNumber, 'expected a JSON object with type "user"');
  }
  const input = parsed as {
    type?: unknown;
    message?: unknown;
  };
  if (input.type !== "user") {
    throw malformed(lineNumber, 'expected a JSON object with type "user"');
  }
  if (!input.message || typeof input.message !== "object") {
    throw malformed(lineNumber, "message must be an object");
  }
  const message = input.message as { role?: unknown; content?: unknown };
  if (message.role !== "user") {
    throw malformed(lineNumber, 'message.role must be "user"');
  }

  const content = message.content;
  if (typeof content === "string") {
    return requireText(content, lineNumber);
  }
  if (!Array.isArray(content)) {
    throw malformed(lineNumber, "message.content must be a string or an array of text blocks");
  }

  const texts: string[] = [];
  for (const [index, block] of content.entries()) {
    if (!block || typeof block !== "object") {
      throw malformed(lineNumber, `message.content[${index}] must be an object`);
    }
    const contentBlock = block as { type?: unknown; text?: unknown };
    if (contentBlock.type !== "text" || typeof contentBlock.text !== "string") {
      throw malformed(
        lineNumber,
        `message.content[${index}] must be a text block; multimodal input is not supported yet`,
      );
    }
    texts.push(contentBlock.text);
  }
  return requireText(texts.join("\n"), lineNumber);
}

function* inputLines(input: string): Iterable<{ line: string; lineNumber: number }> {
  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    yield { line, lineNumber: i + 1 };
  }
}

function requireText(text: string, line: number): string {
  if (text.length === 0) {
    throw malformed(line, "message.content must contain non-empty text");
  }
  return text;
}

function malformed(line: number, detail: string): StreamJsonInputError {
  return new StreamJsonInputError(
    `Malformed stream-json-input at line ${line}: ${detail}`,
    line,
  );
}
