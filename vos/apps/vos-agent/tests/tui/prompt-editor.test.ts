import { describe, expect, test } from "bun:test";
import {
  applyPromptAction,
  applyPromptKey,
  emptyPromptState,
} from "../../app/tui/prompt-editor.ts";
import { renderStarsViewFrame } from "../../app/tui/stars-view.ts";
import type { ScreenBuffer } from "../../app/tui/screen.ts";
import type { StarsPromptState } from "../../app/tui/stars-view.ts";

function screenRows(screen: ScreenBuffer): string[] {
  return Array.from({ length: screen.height }, (_, y) => (
    Array.from({ length: screen.width }, (_, x) => screen.getCell(x, y).char).join("")
  ));
}

describe("Prompt editor", () => {
  test("inserts printable ASCII text at the cursor, including paste-like chunks", () => {
    let prompt = emptyPromptState();

    prompt = applyPromptKey(prompt, { type: "text", text: "abc" }).state;
    prompt = applyPromptKey(prompt, { type: "left" }).state;
    prompt = applyPromptKey(prompt, { type: "text", text: "X Y" }).state;

    expect(prompt).toEqual({ text: "abX Yc", cursor: 5 });
  });

  test("moves within bounds and supports backspace/delete", () => {
    let prompt: StarsPromptState = { text: "abcd", cursor: 2 };

    prompt = applyPromptAction(prompt, { type: "move", direction: "home" }).state;
    prompt = applyPromptAction(prompt, { type: "move", direction: "left" }).state;
    prompt = applyPromptAction(prompt, { type: "backspace" }).state;
    expect(prompt).toEqual({ text: "abcd", cursor: 0 });

    prompt = applyPromptAction(prompt, { type: "delete" }).state;
    prompt = applyPromptAction(prompt, { type: "move", direction: "right" }).state;
    prompt = applyPromptAction(prompt, { type: "move", direction: "end" }).state;
    prompt = applyPromptAction(prompt, { type: "move", direction: "right" }).state;
    prompt = applyPromptAction(prompt, { type: "backspace" }).state;

    expect(prompt).toEqual({ text: "bc", cursor: 2 });
  });

  test("supports shell-like clear and word-delete editing actions", () => {
    let prompt: StarsPromptState = { text: "alpha beta gamma", cursor: 11 };

    prompt = applyPromptKey(prompt, { type: "delete-word-backward" }).state;
    expect(prompt).toEqual({ text: "alpha gamma", cursor: 6 });

    prompt = applyPromptKey(prompt, { type: "clear-before-cursor" }).state;
    expect(prompt).toEqual({ text: "gamma", cursor: 0 });

    prompt = applyPromptKey({ text: "alpha beta gamma", cursor: 10 }, {
      type: "clear-after-cursor",
    }).state;
    expect(prompt).toEqual({ text: "alpha beta", cursor: 10 });
  });

  test("sanitizes paste text by ignoring controls while preserving Unicode prompt text", () => {
    const result = applyPromptKey({ text: "a", cursor: 1 }, {
      type: "text",
      text: "b\nc\r\t\u001bdé🙂~\u007f",
    });

    expect(result).toEqual({
      state: { text: "abcdé🙂~", cursor: 8 },
    });
  });

  test("submits non-blank prompt text and clears the prompt", () => {
    const result = applyPromptKey({ text: "  run tests  ", cursor: 4 }, { type: "enter" });

    expect(result).toEqual({
      state: { text: "", cursor: 0 },
      submitted: "  run tests  ",
    });
  });

  test("blank submit emits nothing and clears whitespace like the current line REPL", () => {
    const result = applyPromptKey({ text: "  \t  ", cursor: 2 }, { type: "enter" });

    expect(result).toEqual({
      state: { text: "", cursor: 0 },
    });
  });

  test("rendered long prompt viewport keeps the editor cursor and newly typed character visible", () => {
    const prompt = applyPromptKey(
      { text: "abcdefghijklmnopqrstuvwxyz", cursor: 25 },
      { type: "text", text: "!" },
    ).state;

    const frame = renderStarsViewFrame({
      status: {},
      transcript: [],
      prompt,
    }, { width: 12, height: 7 });

    expect(screenRows(frame.screen).slice(1)).toEqual([
      "╭──────────╮",
      "│ abcdefgh │",
      "│ ijklmnop │",
      "│ qrstuvwx │",
      "│ y!z      │",
      "╰──────────╯",
    ]);
    expect(frame.cursor).toEqual({ x: 4, y: 5 });
  });
});
