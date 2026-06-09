import type { SessionEvent } from "../session/types.ts";
import { builtinSlashCommandPaletteEntries } from "../terminal/slash-commands.ts";
import type { InteractiveStatus, InteractiveView } from "../terminal/repl.ts";
import {
  measureStarsTranscriptViewport,
  renderStarsViewFrame,
  type StarsCommandPaletteAction,
  type StarsCommandPalette,
  type StarsCommandPaletteEntry,
  type StarsPromptState,
  type StarsTranscriptItem,
  type StarsTuiState,
  type StarsTuiStatus,
  type StarsViewFrame,
  type StarsViewSize,
} from "./stars-view.ts";

export type StarsTuiPresenter = {
  renderFrame(frame: StarsViewFrame): void;
};

export type StarsTuiInteractiveViewOptions = Readonly<{
  presenter: StarsTuiPresenter;
  size: () => StarsViewSize;
  maxTranscriptItems?: number;
  debugLabels?: boolean;
  welcomeAnimation?: boolean;
  welcomeAnimationFrameDelayMs?: number;
}>;

const maxInlineLength = 160;
const defaultMaxTranscriptItems = 500;
const transcriptScrollStepRows = 3;
const defaultWelcomeAnimationFrameDelayMs = 70;

/**
 * Adapts the line-mode InteractiveView callbacks and session events into the
 * semantic state consumed by `renderStarsViewFrame`.
 */
export class StarsTuiInteractiveView implements InteractiveView {
  // Keyed by tool-call id so duplicate concurrent calls are tracked correctly;
  // status rendering deduplicates the visible names afterward.
  private readonly activeTools = new Map<string, string>();
  private readonly maxTranscriptItems: number;
  private readonly debugLabels: boolean;
  private readonly welcomeAnimation: boolean;
  private readonly welcomeAnimationFrameDelayMs: number;
  private currentStatus: StarsTuiStatus = {};
  private transcript: StarsTranscriptItem[] = [];
  private transcriptScrollOffset = 0;
  private currentPrompt: StarsPromptState = { text: "", cursor: 0 };
  private welcomeFrame: number | undefined;
  private welcomeAnimationTimer: ReturnType<typeof setTimeout> | undefined;
  private inputHint: string | undefined;
  private commandPalette: StarsCommandPalette | undefined;
  private running = false;
  private busy = false;
  private closed = false;
  private streamingAssistantIndex: number | undefined;
  private streamingAssistantText: string | undefined;

  constructor(private readonly opts: StarsTuiInteractiveViewOptions) {
    this.maxTranscriptItems = Math.max(1, Math.trunc(opts.maxTranscriptItems ?? defaultMaxTranscriptItems));
    this.debugLabels = opts.debugLabels === true;
    this.welcomeAnimation = opts.welcomeAnimation === true;
    this.welcomeAnimationFrameDelayMs = Math.max(
      1,
      Math.trunc(opts.welcomeAnimationFrameDelayMs ?? defaultWelcomeAnimationFrameDelayMs),
    );
  }

  welcome(input: InteractiveStatus): void {
    this.applyInteractiveStatus(input);
    if (this.welcomeAnimation && this.transcript.length === 0) {
      this.startWelcomeAnimation();
      return;
    }

    this.stopWelcomeAnimation(true);
    this.render();
  }

  prompt(message: string): void {
    this.clearInputHint();
    this.clearStreamingAssistant();
    this.appendTranscript({ type: "user", text: message });
    this.render();
  }

  command(message: string): void {
    this.clearInputHint();
    const commandPalette = commandPaletteFromHelp(message);
    if (commandPalette) {
      this.commandPalette = commandPalette;
      this.render();
      return;
    }

    this.clearCommandPalette();
    this.appendTranscript({ type: "command", text: message });
    this.render();
  }

  status(input: InteractiveStatus): void {
    this.clearInputHint();
    this.clearCommandPalette();
    this.applyInteractiveStatus(input);
    this.render();
  }

  error(message: string): void {
    this.clearInputHint();
    this.clearCommandPalette();
    this.running = false;
    this.busy = false;
    this.activeTools.clear();
    this.refreshActiveTools();
    this.appendTranscript({ type: "error", text: message });
    this.render();
  }

  onSessionEvent(event: SessionEvent): void {
    this.clearInputHint();
    this.clearCommandPalette();
    switch (event.type) {
      case "thread.created":
      case "thread.loaded": {
        this.activeTools.clear();
        this.running = true;
        this.busy = true;
        this.currentStatus = {
          threadId: event.thread_id,
          mode: event.mode,
          model: event.model,
          cwd: event.cwd,
          activeTools: [],
        };
        this.clearStreamingAssistant();
        break;
      }
      case "assistant.delta":
        this.appendAssistantDelta(event.delta);
        break;
      case "assistant.message": {
        if (event.toolCalls.length > 0) {
          const content = this.streamingAssistantText !== undefined
            ? event.content ?? ""
            : summarize(event.content ?? "");
          if (content) {
            this.completeAssistantText(content);
          }
          this.clearStreamingAssistant();
        }
        break;
      }
      case "tool.call":
        this.activeTools.set(event.id, event.name);
        this.busy = true;
        this.refreshActiveTools();
        this.appendTranscript({
          type: "tool-call",
          name: event.name,
          text: event.arguments,
        });
        break;
      case "tool.result":
        this.activeTools.delete(event.id);
        this.busy = this.activeTools.size > 0;
        this.refreshActiveTools();
        this.appendTranscript({
          type: "tool-result",
          name: event.name,
          text: summarize(event.content) || "(empty)",
        });
        break;
      case "agent.done":
        this.busy = false;
        this.refreshActiveTools();
        break;
      case "thread.saved":
        break;
      case "done":
        this.running = false;
        this.busy = false;
        this.activeTools.clear();
        this.currentStatus = {
          ...this.currentStatus,
          threadId: event.thread_id,
          activeTools: [],
        };
        this.completeAssistantText(event.content ?? "(no text response)");
        this.clearStreamingAssistant();
        break;
    }

    this.render();
  }

  setPrompt(prompt: StarsPromptState): void {
    this.commandPalette = commandPaletteFromPrompt(prompt.text);
    this.currentPrompt = { text: prompt.text, cursor: prompt.cursor ?? prompt.text.length };
    this.render();
  }

  moveCommandPaletteSelection(direction: "previous" | "next"): boolean {
    if (this.commandPalette === undefined || this.commandPalette.entries.length === 0) {
      return false;
    }

    const current = clampInteger(
      this.commandPalette.selectedIndex ?? 0,
      0,
      this.commandPalette.entries.length - 1,
    );
    const delta = direction === "previous" ? -1 : 1;
    const selectedIndex = modulo(current + delta, this.commandPalette.entries.length);
    this.commandPalette = { ...this.commandPalette, selectedIndex };
    this.render();
    return true;
  }

  acceptCommandPaletteSelection(): StarsCommandPaletteAction | undefined {
    const palette = this.commandPalette;
    if (palette === undefined || palette.entries.length === 0) {
      return undefined;
    }

    const selectedIndex = clampInteger(
      palette.selectedIndex ?? 0,
      0,
      palette.entries.length - 1,
    );
    return palette.entries[selectedIndex]?.action;
  }

  setInputHint(message: string | undefined): void {
    this.inputHint = message;
    this.render();
  }

  restoreTranscript(items: readonly StarsTranscriptItem[]): void {
    if (items.length > 0) {
      this.stopWelcomeAnimation(true);
    }
    this.transcript = items.slice(-this.maxTranscriptItems);
    this.transcriptScrollOffset = 0;
    this.render();
  }

  scrollTranscript(direction: "up" | "down", amount: "line" | "page" = "line"): void {
    const step = amount === "page" ? this.transcriptPageStepRows() : transcriptScrollStepRows;
    const delta = direction === "up" ? step : -step;
    this.transcriptScrollOffset = Math.max(0, this.transcriptScrollOffset + delta);
    this.clampTranscriptScroll();
    this.render();
  }

  frame(): StarsViewFrame {
    return renderStarsViewFrame(this.state(), this.opts.size());
  }

  close(): void {
    this.closed = true;
    this.stopWelcomeAnimation(true);
  }

  refresh(): void {
    this.clampTranscriptScroll();
    this.render();
  }

  private render(): void {
    this.opts.presenter.renderFrame(this.frame());
  }

  private state(): StarsTuiState {
    return {
      status: this.currentStatus,
      transcript: this.transcript,
      transcriptScrollOffset: this.transcriptScrollOffset,
      prompt: this.currentPrompt,
      busy: this.busy,
      running: this.running,
      debugLabels: this.debugLabels,
      welcomeFrame: this.welcomeFrame,
      inputHint: this.inputHint,
      commandPalette: this.commandPalette,
    };
  }

  private applyInteractiveStatus(input: InteractiveStatus): void {
    this.currentStatus = {
      threadId: input.threadId,
      mode: input.mode,
      model: input.model,
      cwd: input.cwd,
      activeTools: activeToolNames(this.activeTools),
    };
  }

  private refreshActiveTools(): void {
    this.currentStatus = {
      ...this.currentStatus,
      activeTools: activeToolNames(this.activeTools),
    };
  }

  private appendTranscript(item: StarsTranscriptItem): void {
    this.stopWelcomeAnimation(true);
    const wasScrolled = this.transcriptScrollOffset > 0;
    const beforeRows = wasScrolled ? this.transcriptRowsFor(this.transcript) : 0;
    this.transcript.push(item);
    if (this.transcript.length > this.maxTranscriptItems) {
      // Keep render cost bounded for long interactive sessions.
      this.transcript = this.transcript.slice(-this.maxTranscriptItems);
    }
    if (wasScrolled) {
      const afterRows = this.transcriptRowsFor(this.transcript);
      this.transcriptScrollOffset += Math.max(0, afterRows - beforeRows);
    }
    this.clampTranscriptScroll();
  }

  private appendAssistantDelta(delta: string): void {
    if (delta.length === 0) {
      return;
    }

    const text = `${this.streamingAssistantText ?? ""}${delta}`;
    this.replaceStreamingAssistantText(text);
  }

  private completeAssistantText(text: string): void {
    if (this.streamingAssistantText !== undefined) {
      this.replaceStreamingAssistantText(text);
      return;
    }

    this.appendTranscript({ type: "assistant", text });
  }

  private replaceStreamingAssistantText(text: string): void {
    this.stopWelcomeAnimation(true);
    const wasScrolled = this.transcriptScrollOffset > 0;
    const beforeRows = wasScrolled ? this.transcriptRowsFor(this.transcript) : 0;
    const index = this.streamingAssistantIndex;

    if (index !== undefined && this.transcript[index]?.type === "assistant") {
      this.transcript[index] = { type: "assistant", text };
    } else {
      this.transcript.push({ type: "assistant", text });
      if (this.transcript.length > this.maxTranscriptItems) {
        this.transcript = this.transcript.slice(-this.maxTranscriptItems);
      }
      this.streamingAssistantIndex = this.transcript.length - 1;
    }

    this.streamingAssistantText = text;
    if (wasScrolled) {
      const afterRows = this.transcriptRowsFor(this.transcript);
      this.transcriptScrollOffset += Math.max(0, afterRows - beforeRows);
    }
    this.clampTranscriptScroll();
  }

  private clearStreamingAssistant(): void {
    this.streamingAssistantIndex = undefined;
    this.streamingAssistantText = undefined;
  }

  private clearInputHint(): void {
    this.inputHint = undefined;
  }

  private clearCommandPalette(): void {
    this.commandPalette = undefined;
  }

  private clampTranscriptScroll(): void {
    const metrics = measureStarsTranscriptViewport(this.state(), this.opts.size());
    this.transcriptScrollOffset = Math.max(
      0,
      Math.min(this.transcriptScrollOffset, metrics.maxScrollOffset),
    );
  }

  private transcriptRowsFor(items: readonly StarsTranscriptItem[]): number {
    const metrics = measureStarsTranscriptViewport({
      ...this.state(),
      transcript: items,
      transcriptScrollOffset: 0,
    }, this.opts.size());
    return metrics.renderedRows;
  }

  private transcriptPageStepRows(): number {
    const metrics = measureStarsTranscriptViewport(this.state(), this.opts.size());
    return Math.max(transcriptScrollStepRows, metrics.visibleRows - 1);
  }

  private startWelcomeAnimation(): void {
    if (!this.shouldAnimateWelcome()) {
      this.stopWelcomeAnimation(true);
      this.render();
      return;
    }

    if (this.welcomeFrame === undefined) {
      this.welcomeFrame = 0;
    }
    this.render();

    if (this.welcomeAnimationTimer === undefined) {
      this.scheduleNextWelcomeFrame();
    }
  }

  private scheduleNextWelcomeFrame(): void {
    const timer = setTimeout(() => {
      this.welcomeAnimationTimer = undefined;
      if (!this.shouldAnimateWelcome()) {
        this.stopWelcomeAnimation(true);
        return;
      }

      this.welcomeFrame = (this.welcomeFrame ?? 0) + 1;
      this.render();
      this.scheduleNextWelcomeFrame();
    }, this.welcomeAnimationFrameDelayMs);
    if (typeof timer === "object" && timer !== null && "unref" in timer && typeof timer.unref === "function") {
      timer.unref();
    }
    this.welcomeAnimationTimer = timer;
  }

  private stopWelcomeAnimation(resetFrame: boolean): void {
    if (this.welcomeAnimationTimer !== undefined) {
      clearTimeout(this.welcomeAnimationTimer);
      this.welcomeAnimationTimer = undefined;
    }
    if (resetFrame) {
      this.welcomeFrame = undefined;
    }
  }

  private shouldAnimateWelcome(): boolean {
    return !this.closed && this.welcomeAnimation && this.transcript.length === 0;
  }
}

function activeToolNames(activeTools: ReadonlyMap<string, string>): string[] {
  return Array.from(new Set(activeTools.values()));
}

function summarize(value: string): string {
  // Tool payloads can be huge. Inline a stable one-line preview so the TUI
  // remains responsive while still showing useful progress.
  const oneLine = value.trim().replace(/\s+/g, " ");
  if (oneLine.length <= maxInlineLength) {
    return oneLine;
  }

  return `${oneLine.slice(0, maxInlineLength - 1)}...`;
}

function commandPaletteFromHelp(message: string): StarsCommandPalette | undefined {
  const lines = message.split(/\r?\n/);
  if (lines[0] !== "VOS Agent commands:") {
    return undefined;
  }

  const projectCommands: string[] = [];
  let projectSection = false;
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed === "Project commands:") {
      projectSection = true;
      continue;
    }
    if (!trimmed.startsWith("/")) {
      continue;
    }

    if (projectSection) {
      projectCommands.push(trimmed.replace(/^\//, ""));
    }
  }

  return {
    title: "Command Palette",
    query: "help",
    selectedIndex: 0,
    entries: [
      ...builtinSlashCommandPaletteEntries(),
      ...projectCommands.map((name) => projectPaletteEntry(`/${name}`)),
    ],
  };
}

function commandPaletteFromPrompt(text: string): StarsCommandPalette | undefined {
  if (!text.startsWith("/")) {
    return undefined;
  }

  const query = text.slice(1).trimStart();
  const entries = builtinSlashCommandPaletteEntries()
    .filter((entry) => commandPaletteEntryMatches(entry, query));

  return {
    title: "Command Palette",
    query,
    selectedIndex: 0,
    entries,
  };
}

function commandPaletteEntryMatches(entry: StarsCommandPaletteEntry, query: string): boolean {
  if (query.length === 0) {
    return true;
  }

  const normalizedQuery = query.toLocaleLowerCase();
  return entry.group.toLocaleLowerCase().includes(normalizedQuery)
    || entry.command.toLocaleLowerCase().includes(normalizedQuery)
    || (entry.hint?.toLocaleLowerCase().includes(normalizedQuery) ?? false);
}

function projectPaletteEntry(line: string): StarsCommandPaletteEntry {
  const name = line.replace(/^\//, "");
  return {
    group: "project",
    command: name,
    action: insertSlashAction(`/${name} `),
  };
}

function insertSlashAction(text: string): StarsCommandPaletteAction {
  return { text, submit: false };
}

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return max;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}
