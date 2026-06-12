import { describe, expect, test } from "bun:test";
import {
  beginSynchronizedOutput,
  clearScreen,
  cursorTo,
  disableMouseReporting,
  endSynchronizedOutput,
  enableMouseReporting,
  enterAlternateScreen,
  hideCursor,
  leaveAlternateScreen,
  showCursor,
} from "../../app/tui/ansi.ts";
import { ScreenBuffer } from "../../app/tui/screen.ts";
import { TerminalDriver } from "../../app/tui/terminal.ts";

class FakeOutput {
  readonly chunks: string[] = [];

  write(value: string): void {
    this.chunks.push(value);
  }

  drain(): string {
    const output = this.chunks.join("");
    this.chunks.length = 0;
    return output;
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

describe("TUI terminal driver", () => {
  test("exports alternate-screen and cursor visibility escapes", () => {
    expect(enterAlternateScreen()).toBe("\x1b[?1049h");
    expect(leaveAlternateScreen()).toBe("\x1b[?1049l");
    expect(enableMouseReporting()).toBe("\x1b[?1000h\x1b[?1006h");
    expect(disableMouseReporting()).toBe("\x1b[?1006l\x1b[?1000l");
    expect(hideCursor()).toBe("\x1b[?25l");
    expect(showCursor()).toBe("\x1b[?25h");
  });

  test("starts presentation and closes restore modes idempotently", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);

    terminal.start();
    terminal.start();
    expect(output.drain()).toBe(
      enterAlternateScreen() + hideCursor() + clearScreen(),
    );

    terminal.close();
    terminal.close();

    expect(output.drain()).toBe(
      endSynchronizedOutput() + showCursor() + leaveAlternateScreen(),
    );
  });

  test("render requires an active presentation lifecycle", () => {
    const terminal = new TerminalDriver(new FakeOutput());
    const screen = new ScreenBuffer(1, 1);

    expect(() => terminal.render(screen)).toThrow("terminal driver must be started before render");
    expect(() => terminal.renderFrame({ screen })).toThrow(
      "terminal driver must be started before render",
    );

    terminal.start();
    terminal.close();

    expect(() => terminal.render(screen)).toThrow("terminal driver must be started before render");
    expect(() => terminal.renderFrame({ screen })).toThrow(
      "terminal driver must be started before render",
    );
  });

  test("start failures attempt terminal restoration", () => {
    const chunks: string[] = [];
    const terminal = new TerminalDriver({
      write(value: string): void {
        chunks.push(value);
        if (chunks.length === 1) {
          throw new Error("start failed");
        }
      },
    });

    expect(() => terminal.start()).toThrow("start failed");
    expect(chunks.join("")).toBe(
      enterAlternateScreen() + hideCursor() + clearScreen()
        + endSynchronizedOutput() + showCursor() + leaveAlternateScreen(),
    );
  });

  test("wraps non-empty screen diffs and suppresses identical frames", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);
    const screen = new ScreenBuffer(5, 1);
    screen.writeText(0, 0, "stars");

    terminal.start();
    output.drain();

    terminal.render(screen);
    const firstRender = output.drain();

    expect(firstRender.startsWith(beginSynchronizedOutput())).toBe(true);
    expect(firstRender.endsWith(endSynchronizedOutput())).toBe(true);
    expect(stripAnsi(firstRender)).toBe("stars");

    terminal.render(screen.clone());

    expect(output.drain()).toBe("");
  });

  test("renderFrame appends cursor positioning after changed cells", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);
    const screen = new ScreenBuffer(5, 1);
    screen.writeText(0, 0, "stars");

    terminal.start();
    output.drain();

    terminal.renderFrame({ screen, cursor: { x: 2, y: 0 } });
    const render = output.drain();

    expect(render.startsWith(beginSynchronizedOutput())).toBe(true);
    expect(render.endsWith(cursorTo(1, 3) + showCursor() + endSynchronizedOutput())).toBe(true);
    expect(stripAnsi(render)).toBe("stars");
  });

  test("identical frames with the same cursor emit no output", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);
    const screen = new ScreenBuffer(5, 1);
    screen.writeText(0, 0, "stars");

    terminal.start();
    output.drain();

    terminal.renderFrame({ screen, cursor: { x: 2, y: 0 } });
    output.drain();
    terminal.renderFrame({ screen: screen.clone(), cursor: { x: 2, y: 0 } });

    expect(output.drain()).toBe("");
  });

  test("cursor-only movement emits only synchronized cursor positioning", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);
    const screen = new ScreenBuffer(5, 1);
    screen.writeText(0, 0, "stars");

    terminal.start();
    output.drain();

    terminal.renderFrame({ screen, cursor: { x: 2, y: 0 } });
    output.drain();
    terminal.renderFrame({ screen: screen.clone(), cursor: { x: 4, y: 0 } });

    expect(output.drain()).toBe(
      beginSynchronizedOutput() + cursorTo(1, 5) + showCursor() + endSynchronizedOutput(),
    );
  });

  test("frames without a cursor after a cursor frame hide without repainting", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);
    const screen = new ScreenBuffer(5, 1);
    screen.writeText(0, 0, "stars");

    terminal.start();
    output.drain();

    terminal.renderFrame({ screen, cursor: { x: 2, y: 0 } });
    output.drain();
    terminal.renderFrame({ screen: screen.clone() });

    expect(output.drain()).toBe(
      beginSynchronizedOutput() + hideCursor() + endSynchronizedOutput(),
    );
  });

  test("dimension resets redraw and re-position an unchanged cursor", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);
    const first = new ScreenBuffer(3, 1);
    first.writeText(0, 0, "abc");
    const resized = new ScreenBuffer(5, 1);
    resized.writeText(0, 0, "abcde");

    terminal.start();
    output.drain();

    terminal.renderFrame({ screen: first, cursor: { x: 1, y: 0 } });
    output.drain();
    terminal.renderFrame({ screen: resized, cursor: { x: 1, y: 0 } });
    const resizedRender = output.drain();

    expect(resizedRender.startsWith(beginSynchronizedOutput())).toBe(true);
    expect(resizedRender.endsWith(cursorTo(1, 2) + showCursor() + endSynchronizedOutput())).toBe(true);
    expect(stripAnsi(resizedRender)).toBe("abcde");
  });

  test("stores a cloned previous frame after rendering", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);
    const screen = new ScreenBuffer(3, 1);
    screen.writeText(0, 0, "abc");

    terminal.start();
    output.drain();

    terminal.render(screen);
    output.drain();

    screen.writeCell(1, 0, "Z");
    terminal.render(screen);
    const secondRender = output.drain();

    expect(secondRender).toContain(cursorTo(1, 2));
    expect(stripAnsi(secondRender)).toBe("Z");
  });

  test("emits only changed prompt cells on a second frame", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);
    const first = new ScreenBuffer(10, 1);
    first.writeText(0, 0, "> a");

    terminal.start();
    output.drain();

    terminal.render(first);
    output.drain();

    const second = first.clone();
    second.writeText(0, 0, "> ab");
    terminal.render(second);
    const secondRender = output.drain();

    expect(secondRender).toContain(beginSynchronizedOutput());
    expect(secondRender).toContain(endSynchronizedOutput());
    expect(secondRender).toContain(cursorTo(1, 4));
    expect(secondRender).not.toContain(cursorTo(1, 1));
    expect(stripAnsi(secondRender)).toBe("b");
  });

  test("dimension changes reset the previous frame for a full render", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);
    const first = new ScreenBuffer(3, 1);
    first.writeText(0, 0, "abc");
    const resized = new ScreenBuffer(5, 1);
    resized.writeText(0, 0, "abcde");

    terminal.start();
    output.drain();

    terminal.render(first);
    output.drain();

    terminal.render(resized);
    const resizedRender = output.drain();

    expect(resizedRender).toContain(cursorTo(1, 1));
    expect(stripAnsi(resizedRender)).toBe("abcde");
  });

  test("write failures propagate", () => {
    let writes = 0;
    const terminal = new TerminalDriver({
      write(): void {
        writes += 1;
        if (writes > 1) {
          throw new Error("write failed");
        }
      },
    });
    const screen = new ScreenBuffer(1, 1);

    terminal.start();

    expect(() => terminal.render(screen)).toThrow("write failed");
  });

  test("close defensively exits synchronized output after render write failure", () => {
    const chunks: string[] = [];
    let failNext = false;
    const terminal = new TerminalDriver({
      write(value: string): void {
        chunks.push(value);
        if (failNext) {
          failNext = false;
          throw new Error("write failed");
        }
      },
    });
    const screen = new ScreenBuffer(1, 1);

    terminal.start();
    failNext = true;
    expect(() => terminal.render(screen)).toThrow("write failed");

    terminal.close();

    expect(chunks.join("")).toContain(
      endSynchronizedOutput() + showCursor() + leaveAlternateScreen(),
    );
  });

  test("close write failures propagate", () => {
    let writes = 0;
    const terminal = new TerminalDriver({
      write(): void {
        writes += 1;
        if (writes > 1) {
          throw new Error("write failed");
        }
      },
    });

    terminal.start();

    expect(() => terminal.close()).toThrow("write failed");
  });

  test("start restore preserves original failure when restore also fails", () => {
    const terminal = new TerminalDriver({
      write(): void {
        throw new Error("write failed");
      },
    });

    expect(() => terminal.start()).toThrow("write failed");
  });
});
