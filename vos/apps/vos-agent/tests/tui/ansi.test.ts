import { describe, expect, test } from "bun:test";
import {
  beginSynchronizedOutput,
  clearScreen,
  cursorTo,
  endSynchronizedOutput,
  sgr,
} from "../../app/tui/ansi.ts";
import { defaultStyle, stylesEqual } from "../../app/tui/style.ts";

describe("TUI ANSI helpers", () => {
  test("builds cursor positioning and terminal mode escapes", () => {
    expect(cursorTo(2, 3)).toBe("\x1b[2;3H");
    expect(beginSynchronizedOutput()).toBe("\x1b[?2026h");
    expect(endSynchronizedOutput()).toBe("\x1b[?2026l");
    expect(clearScreen()).toBe("\x1b[2J");
  });

  test("builds complete SGR for bold foreground background and reset", () => {
    expect(sgr({ bold: true, fg: "red", bg: "blue" })).toBe("\x1b[0;1;31;44m");
    expect(sgr({ dim: true, fg: "#9cffd4", bg: "#102030" })).toBe("\x1b[0;2;38;2;156;255;212;48;2;16;32;48m");
    expect(sgr({ italic: true, fg: "brightGreen" })).toBe("\x1b[0;3;92m");
    expect(sgr({ fg: "green" })).toBe("\x1b[0;32m");
    expect(sgr(defaultStyle)).toBe("\x1b[0m");
    expect(sgr({ bold: false, fg: "default", bg: "default" })).toBe("\x1b[0m");
  });

  test("compares default-equivalent styles", () => {
    expect(stylesEqual(undefined, defaultStyle)).toBe(true);
    expect(stylesEqual({ bold: false, fg: "default" }, defaultStyle)).toBe(true);
    expect(stylesEqual({ bold: true }, defaultStyle)).toBe(false);
    expect(stylesEqual({ dim: true }, defaultStyle)).toBe(false);
    expect(stylesEqual({ italic: true }, defaultStyle)).toBe(false);
  });
});
