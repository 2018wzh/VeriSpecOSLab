import type { InteractiveInput } from "../terminal/repl.ts";
import {
  applyPromptKey,
  emptyPromptState,
  type PromptEditorState,
} from "./prompt-editor.ts";
import { TerminalInputParser } from "./input.ts";
import type { StarsCommandPaletteAction, StarsPromptState } from "./stars-view.ts";

export type StarsTuiPromptView = {
  setPrompt(prompt: StarsPromptState): void;
  setInputHint?(message: string | undefined): void;
  moveCommandPaletteSelection?(direction: "previous" | "next"): boolean;
  acceptCommandPaletteSelection?(): StarsCommandPaletteAction | undefined;
  scrollTranscript?(direction: "up" | "down", amount?: "line" | "page"): void;
};

/** Minimal raw-stdin surface used by the TUI prompt input. */
export type StarsRawInput = {
  setEncoding(encoding: BufferEncoding): unknown;
  on(event: "data" | "end" | "error", listener: (...args: any[]) => void): unknown;
  off(event: "data" | "end" | "error", listener: (...args: any[]) => void): unknown;
  resume(): unknown;
  pause(): unknown;
  setRawMode?: (enabled: boolean) => unknown;
};

export type StarsTuiPromptInputOptions = Readonly<{
  input: StarsRawInput;
  view: StarsTuiPromptView;
}>;

type WaitingRead = Readonly<{
  resolve: (line: string | undefined) => void;
  reject: (error: unknown) => void;
}>;

/**
 * Bridges raw terminal input to the line-oriented InteractiveInput contract.
 *
 * It owns raw-mode setup/teardown, prompt history, and live prompt rendering,
 * while preserving the controller's simple `readLine()` pull model.
 */
export class StarsTuiPromptInput implements InteractiveInput {
  private readonly parser = new TerminalInputParser();
  private prompt: PromptEditorState = emptyPromptState();
  private history: string[] = [];
  private historyIndex: number | undefined;
  // The in-progress prompt before history navigation started, restored when
  // the user arrows back past the newest history item.
  private historyDraft = emptyPromptState();
  private queuedLines: string[] = [];
  private waiting: WaitingRead | undefined;
  private started = false;
  private closed = false;
  private rawModeEnabled = false;
  private failure: unknown;
  private interruptArmed = false;

  constructor(private readonly opts: StarsTuiPromptInputOptions) {}

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.closed = false;

    try {
      this.opts.input.setEncoding("utf8");
      if (this.opts.input.setRawMode) {
        this.opts.input.setRawMode(true);
        this.rawModeEnabled = true;
      }
      this.opts.input.on("data", this.onData);
      this.opts.input.on("end", this.onEnd);
      this.opts.input.on("error", this.onError);
      this.opts.input.resume();
      this.renderPrompt();
    } catch (e) {
      this.restoreAfterFailedStart();
      throw e;
    }
  }

  readLine(): Promise<string | undefined> {
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    const queued = this.queuedLines.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    if (this.closed) {
      return Promise.resolve(undefined);
    }
    if (this.waiting !== undefined) {
      return Promise.reject(new Error("TUI prompt input already has a pending read"));
    }

    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  close(): void {
    if (!this.started && this.closed) {
      return;
    }

    this.closed = true;
    this.detachListeners();
    this.restoreInputMode();
    this.opts.input.pause();
    this.started = false;
    this.resolveWaiting(undefined);
  }

  private readonly onData = (chunk: string | Buffer | Uint8Array): void => {
    if (this.closed) {
      return;
    }

    try {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      for (const event of this.parser.parse(text)) {
        if (event.type === "key") {
          this.disarmInterruptExit();
          if (this.handleCommandPaletteKey(event.key)) {
            continue;
          }
          if (this.handleHistoryKey(event.key)) {
            continue;
          }
          this.leaveHistoryOnEdit(event.key);
          const result = applyPromptKey(this.prompt, event.key);
          this.prompt = result.state;
          this.renderPrompt();
          if (result.submitted !== undefined) {
            this.rememberSubmittedLine(result.submitted);
            this.enqueueLine(result.submitted);
          }
        } else if (event.type === "scroll") {
          this.disarmInterruptExit();
          this.opts.view.scrollTranscript?.(event.direction, event.amount);
        } else if (event.type === "interrupt") {
          this.handleInterrupt();
        } else if (event.type === "eof") {
          this.disarmInterruptExit();
          this.handleEof();
        }
      }
    } catch (e) {
      this.fail(e);
    }
  };

  private readonly onEnd = (): void => {
    try {
      this.finishInput();
    } catch (e) {
      this.fail(e);
    }
  };

  private readonly onError = (error: unknown): void => {
    this.fail(error);
  };

  private handleInterrupt(): void {
    if (this.prompt.text.length === 0 && this.interruptArmed) {
      this.finishInput();
      return;
    }

    this.armInterruptExit();
    if (this.prompt.text.length > 0) {
      this.prompt = emptyPromptState();
      this.resetHistoryNavigation();
      this.renderPrompt();
    }
  }

  private handleEof(): void {
    if (this.prompt.text.length === 0) {
      this.finishInput();
      return;
    }

    const result = applyPromptKey(this.prompt, { type: "delete" });
    this.prompt = result.state;
    this.renderPrompt();
  }

  private handleHistoryKey(key: { type: string }): boolean {
    if (key.type === "up") {
      this.showPreviousHistoryItem();
      return true;
    }
    if (key.type === "down") {
      this.showNextHistoryItem();
      return true;
    }

    return false;
  }

  private handleCommandPaletteKey(key: { type: string }): boolean {
    if (isSlashCommandArgumentPrompt(this.prompt.text)) {
      return false;
    }

    if (key.type === "up" || key.type === "left") {
      return this.opts.view.moveCommandPaletteSelection?.("previous") ?? false;
    }
    if (key.type === "down" || key.type === "right") {
      return this.opts.view.moveCommandPaletteSelection?.("next") ?? false;
    }
    if (key.type !== "enter") {
      return false;
    }

    const action = this.opts.view.acceptCommandPaletteSelection?.();
    if (action === undefined) {
      return false;
    }

    this.resetHistoryNavigation();
    if (action.submit) {
      this.prompt = emptyPromptState();
      this.renderPrompt();
      this.rememberSubmittedLine(action.text);
      this.enqueueLine(action.text);
      return true;
    }

    this.prompt = { text: action.text, cursor: action.text.length };
    this.renderPrompt();
    return true;
  }

  private showPreviousHistoryItem(): void {
    if (this.history.length === 0) {
      return;
    }

    if (this.historyIndex === undefined) {
      this.historyDraft = { text: this.prompt.text, cursor: this.prompt.cursor };
      this.historyIndex = this.history.length - 1;
    } else {
      this.historyIndex = Math.max(0, this.historyIndex - 1);
    }

    this.prompt = historyPrompt(this.history[this.historyIndex] ?? "");
    this.renderPrompt();
  }

  private showNextHistoryItem(): void {
    if (this.historyIndex === undefined) {
      return;
    }

    if (this.historyIndex >= this.history.length - 1) {
      this.prompt = this.historyDraft;
      this.resetHistoryNavigation();
    } else {
      this.historyIndex += 1;
      this.prompt = historyPrompt(this.history[this.historyIndex] ?? "");
    }

    this.renderPrompt();
  }

  private leaveHistoryOnEdit(key: { type: string }): void {
    if (key.type === "enter") {
      this.resetHistoryNavigation();
      return;
    }
    if (key.type !== "up" && key.type !== "down") {
      this.resetHistoryNavigation();
    }
  }

  private resetHistoryNavigation(): void {
    this.historyIndex = undefined;
    this.historyDraft = emptyPromptState();
  }

  private rememberSubmittedLine(line: string): void {
    if (this.history.at(-1) === line) {
      return;
    }

    this.history.push(line);
  }

  private finishInput(): void {
    this.clearInputHint();
    this.closed = true;
    this.detachListeners();
    this.restoreInputMode();
    this.opts.input.pause();
    this.started = false;
    // Preserve already-submitted queued lines. `readLine()` should drain those
    // before reporting EOF to the interactive controller.
    if (this.queuedLines.length === 0) {
      this.resolveWaiting(undefined);
    }
  }

  private enqueueLine(line: string): void {
    if (this.waiting !== undefined) {
      this.resolveWaiting(line);
      return;
    }

    this.queuedLines.push(line);
  }

  private fail(error: unknown): void {
    this.failure = error;
    this.closed = true;
    this.detachListeners();
    this.restoreInputModeBestEffort();
    this.pauseBestEffort();
    this.started = false;
    if (this.waiting !== undefined) {
      const waiting = this.waiting;
      this.waiting = undefined;
      waiting.reject(error);
    }
  }

  private renderPrompt(): void {
    this.opts.view.setPrompt(this.prompt);
  }

  private armInterruptExit(): void {
    this.interruptArmed = true;
    this.opts.view.setInputHint?.("Press Ctrl-C again to exit.");
  }

  private disarmInterruptExit(): void {
    if (!this.interruptArmed) {
      return;
    }

    this.interruptArmed = false;
    this.clearInputHint();
  }

  private clearInputHint(): void {
    this.opts.view.setInputHint?.(undefined);
  }

  private resolveWaiting(value: string | undefined): void {
    if (this.waiting === undefined) {
      return;
    }

    const waiting = this.waiting;
    this.waiting = undefined;
    waiting.resolve(value);
  }

  private restoreAfterFailedStart(): void {
    this.detachListeners();
    this.restoreInputModeBestEffort();
    this.pauseBestEffort();
    this.started = false;
    this.closed = true;
  }

  private detachListeners(): void {
    this.opts.input.off("data", this.onData);
    this.opts.input.off("end", this.onEnd);
    this.opts.input.off("error", this.onError);
  }

  private restoreInputMode(): void {
    if (!this.rawModeEnabled) {
      return;
    }

    this.opts.input.setRawMode?.(false);
    this.rawModeEnabled = false;
  }

  private restoreInputModeBestEffort(): void {
    try {
      this.restoreInputMode();
    } catch {
      // Preserve the original input/rendering failure.
    }
  }

  private pauseBestEffort(): void {
    try {
      this.opts.input.pause();
    } catch {
      // Preserve the original input/rendering failure.
    }
  }
}

function historyPrompt(text: string): PromptEditorState {
  return { text, cursor: text.length };
}

function isSlashCommandArgumentPrompt(text: string): boolean {
  return /^\/\S+\s/.test(text);
}
