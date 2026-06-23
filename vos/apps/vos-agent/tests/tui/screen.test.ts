import { describe, expect, test } from "bun:test";
import { cursorTo, sgr } from "../../app/tui/ansi.ts";
import { defaultStyle, stylesEqual } from "../../app/tui/style.ts";
import { renderScreenDiff, ScreenBuffer } from "../../app/tui/screen.ts";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

describe("TUI screen buffer", () => {
  test("creates and writes cells into a buffer", () => {
    const screen = new ScreenBuffer(4, 2);

    screen.writeCell(1, 0, "A", { bold: true, fg: "red" });
    screen.writeText(0, 1, "ok", { fg: "green" });

    expect(screen.getCell(0, 0)).toEqual({ char: " ", style: defaultStyle });
    expect(screen.getCell(1, 0)).toEqual({
      char: "A",
      style: { bold: true, fg: "red" },
    });
    expect(screen.getCell(0, 1)).toEqual({ char: "o", style: { fg: "green" } });
    expect(screen.getCell(1, 1)).toEqual({ char: "k", style: { fg: "green" } });
  });

  test("sanitizes control cell input to single-cell spaces", () => {
    const screen = new ScreenBuffer(4, 1);

    screen.writeCell(0, 0, "~");
    screen.writeCell(1, 0, "\n");
    screen.writeCell(2, 0, "\t");
    screen.writeCell(3, 0, "\x1b[31mX");

    expect(Array.from({ length: 4 }, (_, x) => screen.getCell(x, 0).char)).toEqual([
      "~",
      " ",
      " ",
      " ",
    ]);
  });

  test("writes printable UTF-8 and tracks wide character continuations", () => {
    const screen = new ScreenBuffer(6, 1);

    screen.writeText(0, 0, "é界B🙂");

    expect(Array.from({ length: 6 }, (_, x) => screen.getCell(x, 0).char)).toEqual([
      "é",
      "界",
      " ",
      "B",
      "🙂",
      " ",
    ]);
    expect(Array.from({ length: 6 }, (_, x) => screen.getCellWidth(x, 0))).toEqual([
      1,
      2,
      0,
      1,
      2,
      0,
    ]);
    expect(stripAnsi(renderScreenDiff(undefined, screen))).toBe("é界B🙂");
  });

  test("clearing a wide character rewrites both occupied terminal cells", () => {
    const previous = new ScreenBuffer(3, 1);
    previous.writeText(0, 0, "界B");
    const current = previous.clone();

    current.clearCell(0, 0);
    const output = renderScreenDiff(previous, current);

    expect(output).toContain(cursorTo(1, 1));
    expect(stripAnsi(output)).toBe("  ");
    expect(Array.from({ length: 3 }, (_, x) => current.getCellWidth(x, 0))).toEqual([1, 1, 1]);
  });

  test("allows single-cell UI glyphs used by the prompt frame", () => {
    const screen = new ScreenBuffer(7, 1);

    screen.writeText(0, 0, "╭─╮│╰╯•");

    expect(Array.from({ length: 7 }, (_, x) => screen.getCell(x, 0).char)).toEqual([
      "╭",
      "─",
      "╮",
      "│",
      "╰",
      "╯",
      "•",
    ]);
  });

  test("rendered cell text does not include newline or ESC injection bytes", () => {
    const current = new ScreenBuffer(5, 1);

    current.writeText(0, 0, "A\nB\x1bC");
    const renderedText = stripAnsi(renderScreenDiff(undefined, current));

    expect(renderedText).toBe("A B C");
    expect(renderedText).not.toContain("\n");
    expect(renderedText).not.toContain("\x1b");
  });

  test("initial render contains cursor positioning and text", () => {
    const current = new ScreenBuffer(5, 1);
    current.writeText(0, 0, "stars");

    const output = renderScreenDiff(undefined, current);

    expect(output).toContain(cursorTo(1, 1));
    expect(stripAnsi(output)).toBe("stars");
  });

  test("rendering identical buffers emits no output", () => {
    const previous = new ScreenBuffer(3, 1);
    previous.writeText(0, 0, "hey");
    const current = previous.clone();

    expect(renderScreenDiff(previous, current)).toBe("");
  });

  test("changing one cell emits only that cell text plus controls", () => {
    const previous = new ScreenBuffer(4, 1);
    previous.writeText(0, 0, "abcd");
    const current = previous.clone();

    current.writeCell(2, 0, "Z");
    const output = renderScreenDiff(previous, current);

    expect(output).toContain(cursorTo(1, 3));
    expect(stripAnsi(output)).toBe("Z");
  });

  test("style-only changes rewrite the cell with its new SGR", () => {
    const previous = new ScreenBuffer(1, 1);
    previous.writeCell(0, 0, "x");
    const current = previous.clone();

    current.writeCell(0, 0, "x", { bold: true, fg: "green", bg: "blue" });
    const output = renderScreenDiff(previous, current);

    expect(output).toContain(cursorTo(1, 1));
    expect(output).toContain(sgr({ bold: true, fg: "green", bg: "blue" }));
    expect(output).toContain(sgr(defaultStyle));
    expect(stripAnsi(output)).toBe("x");
  });

  test("renders OSC-8 hyperlinks for linked cells and closes them before plain text", () => {
    const current = new ScreenBuffer(8, 1);

    current.writeText(0, 0, "docs", { fg: "blue" }, "https://example.com/docs");
    current.writeText(4, 0, " ok");
    const output = renderScreenDiff(undefined, current);

    expect(output).toContain("\x1b]8;;https://example.com/docs\x1b\\");
    expect(output.indexOf("docs")).toBeLessThan(output.indexOf("\x1b]8;;\x1b\\"));
    expect(output.indexOf("\x1b]8;;\x1b\\")).toBeLessThan(output.indexOf(" ok"));
    expect(stripAnsi(output).replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "")).toBe("docs ok ");
    expect(current.getCell(0, 0).link).toBe("https://example.com/docs");
    expect(current.getCell(4, 0).link).toBeUndefined();
  });

  test("clearing a cell rewrites it as a default styled space", () => {
    const previous = new ScreenBuffer(2, 1);
    previous.writeCell(1, 0, "X", { bold: true, fg: "red" });
    const current = previous.clone();

    current.clearCell(1, 0);
    const output = renderScreenDiff(previous, current);

    expect(output).toContain(cursorTo(1, 2));
    expect(output).toContain(sgr(defaultStyle));
    expect(stripAnsi(output)).toBe(" ");
    expect(stylesEqual(current.getCell(1, 0).style, defaultStyle)).toBe(true);
  });
});
