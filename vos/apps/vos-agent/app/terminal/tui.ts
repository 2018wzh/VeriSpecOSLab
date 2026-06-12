import type { SessionEvent } from "../session/types.ts";

export interface TerminalRenderState {
  activeTools: Map<string, string>;
  debugLabels: boolean;
}

export interface TerminalRendererOptions {
  output: NodeJS.WritableStream;
  debugLabels?: boolean;
}

export interface WelcomeInput {
  mode?: string;
  model?: string;
  threadId?: string;
  cwd?: string;
  disabledTools?: readonly string[];
}

const MAX_INLINE = 160;

export function createTerminalRenderState(options: { debugLabels?: boolean } = {}): TerminalRenderState {
  return { activeTools: new Map(), debugLabels: options.debugLabels === true };
}

/**
 * Minimal line-oriented interactive renderer.
 *
 * It intentionally avoids readline internals and terminal-control escape
 * sequences so it can be replaced by a richer TUI without changing the
 * session or agent layers.
 */
export class TerminalRenderer {
  private readonly state: TerminalRenderState;

  constructor(private readonly opts: TerminalRendererOptions) {
    this.state = createTerminalRenderState({ debugLabels: opts.debugLabels });
  }

  welcome(input: WelcomeInput): void {
    this.write([
      "VOS Agent interactive mode. Type /help for commands, /quit to exit.",
      formatInlineStatus(input),
    ]);
  }

  command(message: string): void {
    this.write([message]);
  }

  status(input: WelcomeInput): void {
    this.write([formatInlineStatus(input)]);
  }

  error(message: string): void {
    this.write([`error: ${message}`]);
  }

  onSessionEvent(event: SessionEvent): void {
    this.write(renderSessionEvent(event, this.state));
  }

  private write(lines: readonly string[]): void {
    for (const line of lines) {
      this.opts.output.write(`${line}\n`);
    }
  }
}

export function renderSessionEvent(
  event: SessionEvent,
  state: TerminalRenderState = createTerminalRenderState(),
): string[] {
  if (event.type === "thread.created" || event.type === "thread.loaded") {
    state.activeTools.clear();
    const kind = event.type === "thread.created" ? "new" : "loaded";
    return [
      "╭─ VOS Agent turn ─────────────────────────────",
      `│ thread: ${event.thread_id} (${kind})`,
      `│ mode: ${event.mode ?? "raw model"}`,
      `│ model: ${event.model}${event.reasoningEffort ? ` (${event.reasoningEffort})` : ""}`,
      `│ cwd: ${event.cwd}`,
      `│ tools: ${event.tools.length > 0 ? event.tools.join(", ") : "none"}`,
      ...(event.mcpServers && event.mcpServers.length > 0
        ? [`│ mcp: ${event.mcpServers.join(", ")}`]
        : []),
      "╰─ running",
    ];
  }

  if (event.type === "assistant.message") {
    if (event.toolCalls.length === 0) return [];
    const lines = [`assistant requested ${event.toolCalls.length} tool call(s)`];
    const content = summarize(event.content ?? "");
    if (content) lines.push(`assistant note: ${content}`);
    for (const toolCall of event.toolCalls) {
      lines.push(`  • ${toolCall.name} ${summarize(toolCall.arguments)}`.trimEnd());
    }
    return lines;
  }

  if (event.type === "assistant.delta") {
    return [];
  }

  if (event.type === "tool.call") {
    state.activeTools.set(event.id, event.name);
    return [
      `tool call: ${event.name} (${event.id})`,
      `args: ${summarize(event.arguments)}`,
      `active tools: ${activeToolsSummary(state)}`,
    ];
  }

  if (event.type === "tool.result") {
    state.activeTools.delete(event.id);
    const lines = [
      `tool done: ${event.name} (${event.id})`,
      `result: ${summarize(event.content) || "(empty)"}`,
    ];
    const active = activeToolsSummary(state);
    if (active) lines.push(`active tools: ${active}`);
    return lines;
  }

  if (event.type === "agent.done") {
    return [`turn complete after ${event.iteration} iteration(s)`];
  }

  if (event.type === "thread.saved") {
    return [`saved thread: ${event.thread_id}`];
  }

  if (event.type === "done") {
    const content = event.content ?? "(no text response)";
    return state.debugLabels ? ["assistant:", content] : [content];
  }

  return [];
}

function formatInlineStatus(input: WelcomeInput): string {
  const mode = input.mode ?? (input.model ? `raw model (${input.model})` : "default");
  const parts = [
    `thread: ${input.threadId ?? "new"}`,
    `mode: ${mode}`,
  ];
  if (input.model) parts.push(`model: ${input.model}`);
  if (input.cwd) parts.push(`cwd: ${input.cwd}`);
  if (input.disabledTools && input.disabledTools.length > 0) {
    parts.push(`disabled tools: ${input.disabledTools.join(", ")}`);
  }
  return `status: ${parts.join(" | ")}`;
}

function activeToolsSummary(state: TerminalRenderState): string {
  return Array.from(new Set(state.activeTools.values())).join(", ");
}

function summarize(value: string): string {
  const oneLine = value.trim().replace(/\s+/g, " ");
  if (oneLine.length <= MAX_INLINE) return oneLine;
  return `${oneLine.slice(0, MAX_INLINE - 1)}…`;
}
