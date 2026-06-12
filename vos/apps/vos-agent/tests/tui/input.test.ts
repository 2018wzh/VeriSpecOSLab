import { describe, expect, test } from "bun:test";
import {
  applyPromptKey,
  emptyPromptState,
} from "../../app/tui/prompt-editor.ts";
import { TerminalInputParser } from "../../app/tui/input.ts";
import { renderStarsViewFrame } from "../../app/tui/stars-view.ts";
import type { PromptEditorState } from "../../app/tui/prompt-editor.ts";
import type { ScreenBuffer } from "../../app/tui/screen.ts";
import type { TerminalInputEvent } from "../../app/tui/input.ts";

function parseChunks(chunks: readonly string[]): TerminalInputEvent[] {
  const parser = new TerminalInputParser();

  return chunks.flatMap((chunk) => parser.parse(chunk));
}

function screenRows(screen: ScreenBuffer): string[] {
  return Array.from({ length: screen.height }, (_, y) => (
    Array.from({ length: screen.width }, (_, x) => screen.getCell(x, y).char).join("")
  ));
}

describe("Terminal input parser", () => {
  test("groups printable ASCII text into prompt key events", () => {
    expect(parseChunks(["hello, stars!"])).toEqual([
      { type: "key", key: { type: "text", text: "hello, stars!" } },
    ]);
  });

  test("preserves printable Unicode text for prompt submission", () => {
    expect(parseChunks(["fix café 中文 🙂"])).toEqual([
      { type: "key", key: { type: "text", text: "fix café 中文 🙂" } },
    ]);
  });

  test("maps enter, backspace, interrupt, and EOF controls", () => {
    expect(parseChunks(["\r\n\x7f\b\x03\x04"])).toEqual([
      { type: "key", key: { type: "enter" } },
      { type: "key", key: { type: "enter" } },
      { type: "key", key: { type: "backspace" } },
      { type: "key", key: { type: "backspace" } },
      { type: "interrupt" },
      { type: "eof" },
    ]);
  });

  test("maps common CSI and SS3 editing escapes", () => {
    expect(parseChunks([
      "\x1b[A\x1b[B\x1b[D\x1b[C\x1b[H\x1b[F"
        + "\x1b[1~\x1b[4~\x1b[7~\x1b[8~\x1b[3~"
        + "\x1bOA\x1bOB\x1bOD\x1bOC\x1bOH\x1bOF",
    ])).toEqual([
      { type: "key", key: { type: "up" } },
      { type: "key", key: { type: "down" } },
      { type: "key", key: { type: "left" } },
      { type: "key", key: { type: "right" } },
      { type: "key", key: { type: "home" } },
      { type: "key", key: { type: "end" } },
      { type: "key", key: { type: "home" } },
      { type: "key", key: { type: "end" } },
      { type: "key", key: { type: "home" } },
      { type: "key", key: { type: "end" } },
      { type: "key", key: { type: "delete" } },
      { type: "key", key: { type: "up" } },
      { type: "key", key: { type: "down" } },
      { type: "key", key: { type: "left" } },
      { type: "key", key: { type: "right" } },
      { type: "key", key: { type: "home" } },
      { type: "key", key: { type: "end" } },
    ]);
  });

  test("maps SGR mouse wheel, PageUp/PageDown, and Ctrl-Up/Ctrl-Down to scroll events", () => {
    expect(parseChunks([
      "\x1b[<64;10;5M\x1b[<65;10;5M\x1b[5~\x1b[6~\x1b[1;5A\x1b[1;5B",
    ])).toEqual([
      { type: "scroll", direction: "up", amount: "line" },
      { type: "scroll", direction: "down", amount: "line" },
      { type: "scroll", direction: "up", amount: "page" },
      { type: "scroll", direction: "down", amount: "page" },
      { type: "scroll", direction: "up", amount: "line" },
      { type: "scroll", direction: "down", amount: "line" },
    ]);
  });

  test("maps common control-key editing shortcuts", () => {
    expect(parseChunks(["ab\x01c\x05\x15de\x17fg\x0b"])).toEqual([
      { type: "key", key: { type: "text", text: "ab" } },
      { type: "key", key: { type: "home" } },
      { type: "key", key: { type: "text", text: "c" } },
      { type: "key", key: { type: "end" } },
      { type: "key", key: { type: "clear-before-cursor" } },
      { type: "key", key: { type: "text", text: "de" } },
      { type: "key", key: { type: "delete-word-backward" } },
      { type: "key", key: { type: "text", text: "fg" } },
      { type: "key", key: { type: "clear-after-cursor" } },
    ]);
  });

  test("ignores unknown escape sequences without inserting escape junk", () => {
    expect(parseChunks(["\x1b[31mX"])).toEqual([
      { type: "key", key: { type: "text", text: "X" } },
    ]);
    expect(parseChunks(["\x1b]0;bad-title\x07X"])).toEqual([
      { type: "key", key: { type: "text", text: "X" } },
    ]);
    expect(parseChunks(["\x1b]0;bad-title\x1b\\X"])).toEqual([
      { type: "key", key: { type: "text", text: "X" } },
    ]);
    expect(parseChunks(["\x1b(BX"])).toEqual([
      { type: "key", key: { type: "text", text: "X" } },
    ]);
    expect(parseChunks(["\x1b%GX"])).toEqual([
      { type: "key", key: { type: "text", text: "X" } },
    ]);
    expect(parseChunks(["\x1b#8X"])).toEqual([
      { type: "key", key: { type: "text", text: "X" } },
    ]);
  });

  test("emits split escape sequence events only after completion", () => {
    const parser = new TerminalInputParser();

    expect(parser.parse("\x1b[")).toEqual([]);
    expect(parser.parse("D")).toEqual([
      { type: "key", key: { type: "left" } },
    ]);

    const deleteParser = new TerminalInputParser();
    expect(deleteParser.parse("\x1b")).toEqual([]);
    expect(deleteParser.parse("[")).toEqual([]);
    expect(deleteParser.parse("3")).toEqual([]);
    expect(deleteParser.parse("~")).toEqual([
      { type: "key", key: { type: "delete" } },
    ]);

    const unknownParser = new TerminalInputParser();
    expect(unknownParser.parse("\x1b[31")).toEqual([]);
    expect(unknownParser.parse("mX")).toEqual([
      { type: "key", key: { type: "text", text: "X" } },
    ]);

    const oscParser = new TerminalInputParser();
    expect(oscParser.parse("\x1b]0;bad")).toEqual([]);
    expect(oscParser.parse(" title\x07X")).toEqual([
      { type: "key", key: { type: "text", text: "X" } },
    ]);

    const genericParser = new TerminalInputParser();
    expect(genericParser.parse("\x1b%")).toEqual([]);
    expect(genericParser.parse("GX")).toEqual([
      { type: "key", key: { type: "text", text: "X" } },
    ]);
  });

  test("pending escape sequences do not swallow interrupt or EOF", () => {
    const csiInterrupt = new TerminalInputParser();
    expect(csiInterrupt.parse("\x1b[")).toEqual([]);
    expect(csiInterrupt.parse("\x03")).toEqual([{ type: "interrupt" }]);

    const ss3Eof = new TerminalInputParser();
    expect(ss3Eof.parse("\x1bO")).toEqual([]);
    expect(ss3Eof.parse("\x04")).toEqual([{ type: "eof" }]);

    const oscInterrupt = new TerminalInputParser();
    expect(oscInterrupt.parse("\x1b]0;title")).toEqual([]);
    expect(oscInterrupt.parse("\x03")).toEqual([{ type: "interrupt" }]);
  });

  test("documents unsupported lone escape behavior and constrained CSI arrows", () => {
    const parser = new TerminalInputParser();

    expect(parser.parse("\x1b")).toEqual([]);
    expect(parser.parse("a")).toEqual([]);
    expect(parseChunks(["\x1b[999D"])).toEqual([]);
    expect(parseChunks(["\x1b[1;5D"])).toEqual([
      { type: "key", key: { type: "left" } },
    ]);
  });

  test("keeps parser key events compatible with prompt editing and rendering", () => {
    const parser = new TerminalInputParser();
    let prompt: PromptEditorState = emptyPromptState();

    for (const event of ["hello", "\x1b[D", "!"].flatMap((chunk) => parser.parse(chunk))) {
      if (event.type === "key") {
        prompt = applyPromptKey(prompt, event.key).state;
      }
    }

    const frame = renderStarsViewFrame({
      status: {},
      transcript: [],
      prompt,
    }, { width: 12, height: 5 });

    expect(prompt).toEqual({ text: "hell!o", cursor: 5 });
    expect(screenRows(frame.screen)[1]).toBe("│ hell!o   │");
    expect(frame.cursor).toEqual({ x: 7, y: 1 });

    let submitted: string | undefined;
    for (const event of parser.parse("\r")) {
      if (event.type === "key") {
        const result = applyPromptKey(prompt, event.key);
        prompt = result.state;
        submitted = result.submitted;
      }
    }

    expect(submitted).toBe("hell!o");
    expect(prompt).toEqual({ text: "", cursor: 0 });
  });
});
