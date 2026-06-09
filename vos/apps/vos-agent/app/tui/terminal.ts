import {
  beginSynchronizedOutput,
  clearScreen,
  cursorTo,
  endSynchronizedOutput,
  enterAlternateScreen,
  hideCursor,
  leaveAlternateScreen,
  showCursor,
} from "./ansi.ts";
import { renderScreenDiff } from "./screen.ts";
import type { ScreenBuffer } from "./screen.ts";

export type TerminalOutput = {
  write(value: string): void;
};

export type TerminalCursor = Readonly<{
  x: number;
  y: number;
}>;

/** A fully-rendered terminal frame. Cursor coordinates are zero-based cells. */
export type TerminalFrame = Readonly<{
  screen: ScreenBuffer;
  cursor?: TerminalCursor;
}>;

/**
 * Owns the alternate-screen lifecycle and applies screen-buffer diffs to a
 * terminal output stream. The higher-level view stays pure and hands complete
 * frames to this driver; this class is the only TUI layer that writes ANSI.
 */
export class TerminalDriver {
  private previous: ScreenBuffer | undefined;
  private previousCursor: TerminalCursor | undefined;
  private presenting = false;

  constructor(private readonly output: TerminalOutput) {}

  start(): void {
    if (this.presenting) {
      return;
    }

    this.presenting = true;
    this.previous = undefined;
    this.previousCursor = undefined;

    try {
      this.output.write(enterAlternateScreen() + hideCursor() + clearScreen());
    } catch (e) {
      this.restoreAfterFailedStart();
      throw e;
    }
  }

  render(screen: ScreenBuffer): void {
    this.renderFrame({ screen });
  }

  renderFrame(frame: TerminalFrame): void {
    if (!this.presenting) {
      throw new Error("terminal driver must be started before render");
    }

    // A resized terminal invalidates every previous cell coordinate. Drop the
    // old buffer instead of asking renderScreenDiff to compare incompatible
    // geometries.
    const dimensionsChanged = !hasSameDimensions(this.previous, frame.screen);
    const previous = dimensionsChanged ? undefined : this.previous;
    const previousCursor = dimensionsChanged ? undefined : this.previousCursor;
    const hadCursor = this.previousCursor !== undefined;
    const diff = renderScreenDiff(previous, frame.screen);
    let cursorDiff = "";

    if (frame.cursor !== undefined) {
      if (diff.length > 0 || !cursorsEqual(previousCursor, frame.cursor)) {
        cursorDiff = cursorTo(frame.cursor.y + 1, frame.cursor.x + 1) + showCursor();
      }
    } else if (hadCursor) {
      cursorDiff = hideCursor();
    }

    if (diff.length === 0 && cursorDiff.length === 0) {
      return;
    }

    this.output.write(
      beginSynchronizedOutput() + diff + cursorDiff + endSynchronizedOutput(),
    );
    this.previous = frame.screen.clone();
    this.previousCursor = copyCursor(frame.cursor);
  }

  close(): void {
    if (!this.presenting) {
      return;
    }

    this.output.write(endSynchronizedOutput() + showCursor() + leaveAlternateScreen());
    this.previous = undefined;
    this.previousCursor = undefined;
    this.presenting = false;
  }

  private restoreAfterFailedStart(): void {
    try {
      this.output.write(endSynchronizedOutput() + showCursor() + leaveAlternateScreen());
    } catch {
      // Preserve the original setup failure. The restore attempt is best-effort
      // because the output path may be the failing component.
    }
    this.previous = undefined;
    this.previousCursor = undefined;
    this.presenting = false;
  }
}

function hasSameDimensions(
  previous: ScreenBuffer | undefined,
  current: ScreenBuffer,
): previous is ScreenBuffer {
  return previous !== undefined
    && previous.width === current.width
    && previous.height === current.height;
}

function cursorsEqual(
  left: TerminalCursor | undefined,
  right: TerminalCursor,
): boolean {
  return left !== undefined && left.x === right.x && left.y === right.y;
}

function copyCursor(cursor: TerminalCursor | undefined): TerminalCursor | undefined {
  return cursor === undefined ? undefined : { x: cursor.x, y: cursor.y };
}
