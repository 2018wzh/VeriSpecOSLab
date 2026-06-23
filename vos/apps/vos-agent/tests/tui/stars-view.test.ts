import { describe, expect, test } from "bun:test";
import { beginSynchronizedOutput, cursorTo, endSynchronizedOutput } from "../../app/tui/ansi.ts";
import { renderScreenDiff } from "../../app/tui/screen.ts";
import { renderStarsView, renderStarsViewFrame } from "../../app/tui/stars-view.ts";
import type { StarsTuiState } from "../../app/tui/stars-view.ts";
import type { ScreenBuffer } from "../../app/tui/screen.ts";
import { defaultStyle } from "../../app/tui/style.ts";
import { TerminalDriver } from "../../app/tui/terminal.ts";
import { logoColumnsForHeight, logoRowsForColumns } from "../../app/tui/welcome-logo.ts";

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

function screenRows(screen: ScreenBuffer): string[] {
  return Array.from({ length: screen.height }, (_, y) => (
    Array.from({ length: screen.width }, (_, x) => screen.getCell(x, y).char).join("")
  ));
}

function row(width: number, text: string): string {
  return text.slice(0, width).padEnd(width, " ");
}

describe("Stars TUI view", () => {
  test("uses the 1280x720 shader aspect ratio for terminal logo scaling", () => {
    expect(logoColumnsForHeight(9)).toBe(32);
    expect(logoRowsForColumns(32)).toBe(9);
  });

  test("renders wrapped transcript rows and an Amp-like prompt box in a 40x8 view", () => {
    const state: StarsTuiState = {
      status: { threadId: "T1", mode: "smart", cwd: "/" },
      transcript: [
        { type: "user", text: "fix tests" },
        { type: "assistant", text: "on it" },
        { type: "command", text: "bun test tests/tui" },
        { type: "error", text: "expected fail" },
        { type: "tool-call", name: "Read", text: "app/tui/screen.ts" },
        { type: "tool-result", name: "Read", text: "ok" },
      ],
      prompt: { text: "add renderer" },
    };

    const screen = renderStarsView(state, { width: 40, height: 8 });

    expect(screenRows(screen)).toEqual([
      row(40, "error: expected fail"),
      row(40, "› Exploring Read app/tui/screen.ts"),
      row(40, "✓ Explored 1 file"),
      "╭──────────────────────────── smart ───╮",
      "│ add renderer                         │",
      "│                                      │",
      "│                                      │",
      "╰──────────────────────────────── / ───╯",
    ]);
  });

  test("applies semantic styles for status, transcript, tools, and prompt", () => {
    const screen = renderStarsView({
      status: { threadId: "T1", mode: "smart" },
      transcript: [
        { type: "assistant", text: "answer" },
        { type: "error", text: "bad" },
        { type: "tool-call", name: "Bash", text: "bun test" },
      ],
      prompt: { text: "next" },
    }, { width: 32, height: 8 });

    expect(screen.getCell(0, 0).style).toBe(defaultStyle);
    expect(screen.getCell(0, 1).style).toEqual({ bold: true, fg: "red" });
    expect(screen.getCell(0, 2).style).toEqual({ bold: true, fg: "green" });
    expect(screen.getCell(2, 2).style).toBe(defaultStyle);
    expect(screen.getCell(0, 3).style).toBe(defaultStyle);
    expect(screen.getCell(0, 4).style).toBe(defaultStyle);
  });

  test("renders shader logo welcome frames", () => {
    const first = renderStarsView({
      welcomeFrame: 0,
      transcript: [],
      prompt: { text: "" },
    }, { width: 72, height: 16 });
    const second = renderStarsView({
      welcomeFrame: 1,
      transcript: [],
      prompt: { text: "" },
    }, { width: 72, height: 16 });

    const firstRows = screenRows(first);
    const firstText = firstRows.join("\n");
    const artY = firstRows.findIndex((line) => /[·•●]/.test(line));
    const artX = artY >= 0 ? firstRows[artY]?.search(/[·•●]/) ?? -1 : -1;
    const titleY = firstRows.findIndex((line) => line.includes("Welcome to VOS Agent"));
    const titleX = titleY >= 0 ? firstRows[titleY]?.indexOf("Welcome") ?? -1 : -1;

    expect(firstText).toContain("Welcome to VOS Agent");
    expect(firstText).not.toContain("/\\__/\\");
    expect(artY).toBeGreaterThanOrEqual(0);
    expect(artX).toBeGreaterThanOrEqual(0);
    expect(titleY).toBeGreaterThanOrEqual(0);
    expect(titleX).toBeGreaterThanOrEqual(0);
    expect(first.getCell(artX, artY).style.fg).toMatch(/^#[0-9a-f]{6}$/);
    expect(first.getCell(titleX, titleY).style).toEqual({ bold: true, fg: "brightGreen" });
    expect(screenRows(second).join("\n")).not.toBe(firstText);
  });

  test("wraps long transcript and prompt content instead of clipping it", () => {
    const screen = renderStarsView({
      status: { mode: "smart" },
      transcript: [
        {
          type: "assistant",
          text: "I can help work on this Bun TypeScript repository and run commands like bunx tsc.",
        },
      ],
      prompt: { text: "ok", cursor: 2 },
    }, { width: 32, height: 9 });

    expect(screenRows(screen)).toEqual([
      "I can help work on this Bun     ",
      "TypeScript repository and run   ",
      "commands like bunx tsc.         ",
      "                                ",
      "╭──────────────────── smart ───╮",
      "│ ok                           │",
      "│                              │",
      "│                              │",
      "╰──────────────────────────────╯",
    ]);
  });

  test("returns prompt cursor metadata and wraps long prompt text", () => {
    const frame = renderStarsViewFrame({
      status: {},
      transcript: [],
      prompt: { text: "abcdefghijklmnopqrstuvwxyz", cursor: 20 },
    }, { width: 12, height: 7 });

    expect(screenRows(frame.screen).slice(1)).toEqual([
      "╭──────────╮",
      "│ abcdefgh │",
      "│ ijklmnop │",
      "│ qrstuvwx │",
      "│ yz       │",
      "╰──────────╯",
    ]);
    expect(frame.cursor).toEqual({ x: 6, y: 4 });
  });

  test("renders Chinese prompt and transcript text using wide terminal cells", () => {
    const frame = renderStarsViewFrame({
      status: {},
      transcript: [{ type: "user", text: "你好世界" }],
      prompt: { text: "中文输入", cursor: 4 },
    }, { width: 14, height: 7 });

    const terminalText = stripAnsi(renderScreenDiff(undefined, frame.screen));

    expect(terminalText).toContain("│ 你好世界");
    expect(terminalText).toContain("│ 中文输入   │");
    expect(frame.cursor).toEqual({ x: 10, y: 3 });
  });

  test("wraps Chinese prompt text by display cells and keeps the cursor visible", () => {
    const frame = renderStarsViewFrame({
      status: {},
      transcript: [],
      prompt: { text: "你好世界啊", cursor: 5 },
    }, { width: 12, height: 7 });

    const terminalText = stripAnsi(renderScreenDiff(undefined, frame.screen));

    expect(terminalText).toContain("│ 你好世界 │");
    expect(terminalText).toContain("│ 啊       │");
    expect(frame.cursor).toEqual({ x: 4, y: 4 });
  });

  test("expands multi-line transcript entries before taking latest visible rows", () => {
    const screen = renderStarsView({
      status: {},
      transcript: [
        { type: "user", text: "one" },
        { type: "assistant", text: "line1\nline2\nline3" },
      ],
      prompt: { text: "ok" },
    }, { width: 24, height: 8 });

    expect(screenRows(screen)).toEqual([
      row(24, "line1"),
      row(24, "line2"),
      row(24, "line3"),
      "╭──────────────────────╮",
      "│ ok                   │",
      "│                      │",
      "│                      │",
      "╰──────────────────────╯",
    ]);
  });

  test("styles submitted user prompts with a slim green rail and green italic text", () => {
    const screen = renderStarsView({
      status: { mode: "smart" },
      transcript: [{ type: "user", text: "fix the failing tests" }],
      prompt: { text: "" },
    }, { width: 32, height: 6 });

    expect(screenRows(screen)[0]).toBe(row(32, "│ fix the failing tests"));
    expect(screen.getCell(0, 0).style).toEqual({ bold: true, fg: "green" });
    expect(screen.getCell(2, 0).style).toEqual({ italic: true, fg: "green" });
  });

  test("adds breathing room around submitted user prompts", () => {
    const screen = renderStarsView({
      status: { mode: "smart" },
      transcript: [
        { type: "assistant", text: "previous response" },
        { type: "user", text: "question" },
        { type: "assistant", text: "new answer" },
      ],
      prompt: { text: "" },
    }, { width: 36, height: 10 });

    expect(screenRows(screen)).toEqual([
      row(36, "previous response"),
      row(36, ""),
      row(36, "│ question"),
      row(36, ""),
      row(36, "new answer"),
      "╭──────────────────────── smart ───╮",
      "│                                  │",
      "│                                  │",
      "│                                  │",
      "╰──────────────────────────────────╯",
    ]);
  });

  test("renders Bash commands with a shell prompt and run status", () => {
    const screen = renderStarsView({
      status: { mode: "smart" },
      transcript: [
        {
          type: "tool-call",
          name: "Bash",
          text: JSON.stringify({ command: "git status --short --branch" }),
        },
        {
          type: "tool-result",
          name: "Bash",
          text: "fatal: not a git repo\n[Command exited with status 128]",
        },
      ],
      prompt: { text: "" },
    }, { width: 44, height: 8 });

    expect(screenRows(screen)).toEqual([
      row(44, "$ git status --short --branch"),
      row(44, "✗ Ran command (exit code: 128)"),
      row(44, "  fatal: not a git repo"),
      "╭──────────────────────────────── smart ───╮",
      "│                                          │",
      "│                                          │",
      "│                                          │",
      "╰──────────────────────────────────────────╯",
    ]);
    expect(screen.getCell(0, 0).style).toEqual({ bold: true, fg: "green" });
    expect(screen.getCell(0, 1).style).toEqual({ fg: "red" });
    expect(screen.getCell(2, 2).style).toBe(defaultStyle);
  });

  test("shows assistant labels only when debug labels are enabled", () => {
    const release = renderStarsView({
      transcript: [{ type: "assistant", text: "final answer" }],
      prompt: { text: "" },
    }, { width: 32, height: 6 });
    const debug = renderStarsView({
      debugLabels: true,
      transcript: [{ type: "assistant", text: "final answer" }],
      prompt: { text: "" },
    }, { width: 32, height: 6 });

    expect(screenRows(release)[0]).toBe(row(32, "final answer"));
    expect(screenRows(debug)[0]).toBe(row(32, "assistant: final answer"));
  });

  test("renders assistant markdown with styled cells in release views", () => {
    const screen = renderStarsView({
      transcript: [{ type: "assistant", text: "Use **strong** and `code`." }],
      prompt: { text: "" },
    }, { width: 40, height: 6 });
    const firstRow = screenRows(screen)[0] ?? "";
    const strongX = firstRow.indexOf("strong");
    const codeX = firstRow.indexOf("`code`");

    expect(firstRow).toBe(row(40, "Use strong and `code`."));
    expect(screen.getCell(strongX, 0).style).toEqual({ bold: true });
    expect(screen.getCell(codeX, 0).style).toEqual({ fg: "yellow" });
  });

  test("uses Stars-neutral markdown heading styles", () => {
    const screen = renderStarsView({
      transcript: [{ type: "assistant", text: "# Result" }],
      prompt: { text: "" },
    }, { width: 40, height: 6 });

    expect(screenRows(screen)[0]).toBe(row(40, "Result"));
    expect(screen.getCell(0, 0).style).toEqual({ bold: true });
  });

  test("uses light-theme-safe assistant markdown accents", () => {
    const screen = renderStarsView({
      theme: "light",
      transcript: [{ type: "assistant", text: "Read [docs](https://example.com) and `code`." }],
      prompt: { text: "" },
    }, { width: 72, height: 6 });
    const firstRow = screenRows(screen)[0] ?? "";
    const linkX = firstRow.indexOf("docs");
    const codeX = firstRow.indexOf("`code`");

    expect(firstRow).toContain("Read docs https://example.com and `code`.");
    expect(screen.getCell(linkX, 0).style).toEqual({ fg: "blue" });
    expect(screen.getCell(linkX, 0).link).toBe("https://example.com");
    expect(screen.getCell(codeX, 0).style).toEqual({ fg: "blue" });
    expect(screen.getCell(codeX, 0).link).toBeUndefined();
  });

  test("soft-wraps long assistant code fence rows instead of clipping them", () => {
    const screen = renderStarsView({
      transcript: [{ type: "assistant", text: "```ts\nalpha beta gamma delta\n```" }],
      prompt: { text: "" },
    }, { width: 20, height: 7 });

    expect(screenRows(screen)[0]).toBe(row(20, " alpha beta gamma"));
    expect(screenRows(screen)[1]).toBe(row(20, " delta"));
    expect(screen.getCell(0, 0).style).toEqual({ fg: "cyan" });
    expect(screen.getCell(0, 1).style).toEqual({ fg: "cyan" });
  });

  test("preserves styled trailing spaces inside assistant code fences", () => {
    const screen = renderStarsView({
      transcript: [{ type: "assistant", text: "```ts\nalpha  \n```" }],
      prompt: { text: "" },
    }, { width: 20, height: 6 });

    expect(screenRows(screen)[0]).toBe(row(20, " alpha  "));
    expect(screen.getCell(6, 0).style).toEqual({ fg: "cyan" });
    expect(screen.getCell(7, 0).style).toEqual({ fg: "cyan" });
    expect(screen.getCell(8, 0).style).toBe(defaultStyle);
  });

  test("renders wide assistant markdown cells without column drift", () => {
    const screen = renderStarsView({
      transcript: [{ type: "assistant", text: "**你好** ok" }],
      prompt: { text: "" },
    }, { width: 20, height: 6 });

    expect(screenRows(screen)[0]).toBe("你 好  ok             ");
    expect(screen.getCell(0, 0).style).toEqual({ bold: true });
    expect(screen.getCell(2, 0).style).toEqual({ bold: true });
    expect(screen.getCell(4, 0).char).toBe(" ");
    expect(screen.getCell(5, 0).char).toBe("o");
  });

  test("colors mode labels differently for smart and deep prompt borders", () => {
    const smart = renderStarsView({
      status: { mode: "smart" },
      transcript: [],
      prompt: { text: "" },
    }, { width: 24, height: 4 });
    const deep = renderStarsView({
      status: { mode: "deep" },
      transcript: [],
      prompt: { text: "" },
    }, { width: 24, height: 4 });

    const smartX = screenRows(smart)[0].indexOf("smart");
    const deepX = screenRows(deep)[0].indexOf("deep");

    expect(smart.getCell(smartX, 0).style).toEqual({ fg: "brightGreen" });
    expect(deep.getCell(deepX, 0).style).toEqual({ fg: "green" });
  });

  test("uses terminal default foreground for neutral UI so light and dark themes stay readable", () => {
    const screen = renderStarsView({
      status: { mode: "smart" },
      transcript: [{ type: "assistant", text: "readable output" }],
      prompt: { text: "/" },
      commandPalette: {
        title: "Command Palette",
        selectedIndex: 1,
        entries: [
          { group: "stars", command: "help", hint: "Show this help" },
          { group: "stars", command: "new thread", hint: "Start a new local thread" },
        ],
      },
    }, { width: 72, height: 14 });

    const rows = screenRows(screen);
    const borderY = rows.findIndex((line) => line.includes("Command Palette"));
    const bodyY = rows.findIndex((line) => line.includes("stars  help"));
    const promptY = rows.findIndex((line) => line.includes("│ /"));

    expect(screen.getCell(2, 0).style).toBe(defaultStyle);
    expect(screen.getCell(12, borderY).style).toBe(defaultStyle);
    expect(screen.getCell(14, bodyY).style).toBe(defaultStyle);
    expect(screen.getCell(2, promptY).style).toBe(defaultStyle);
  });

  test("renders a centered command palette overlay above the prompt", () => {
    const screen = renderStarsView({
      status: { mode: "smart" },
      transcript: [{ type: "assistant", text: "Need help?" }],
      prompt: { text: "/m", cursor: 2 },
      commandPalette: {
        title: "Command Palette",
        query: "m",
        selectedIndex: 0,
        entries: [
          { group: "mode", command: "show current", hint: "Show current mode" },
          { group: "mode", command: "switch <name>", hint: "Switch mode (smart, deep, rush)" },
        ],
      },
    }, { width: 72, height: 14 });

    const text = screenRows(screen).join("\n");
    expect(text).toContain("Command Palette");
    expect(text).toContain("> m");
    expect(text).toContain("mode  show current");
    expect(text).toContain("│ /m");
    expect(screen.getCell(14, 4).style).toEqual({ bold: true, fg: "black", bg: "yellow" });
  });

  test("shows latest transcript rows when there are too many entries", () => {
    const screen = renderStarsView({
      status: {},
      transcript: [
        { type: "user", text: "one" },
        { type: "assistant", text: "two" },
        { type: "system", text: "three" },
        { type: "status", text: "four" },
        { type: "error", text: "five" },
      ],
      prompt: { text: "ok" },
    }, { width: 24, height: 8 });

    expect(screenRows(screen)).toEqual([
      row(24, "system: three"),
      row(24, "status: four"),
      row(24, "error: five"),
      "╭──────────────────────╮",
      "│ ok                   │",
      "│                      │",
      "│                      │",
      "╰──────────────────────╯",
    ]);
  });

  test("can render older transcript rows with a scroll offset", () => {
    const screen = renderStarsView({
      status: {},
      transcript: [
        { type: "user", text: "one" },
        { type: "assistant", text: "two" },
        { type: "system", text: "three" },
        { type: "status", text: "four" },
        { type: "error", text: "five" },
      ],
      transcriptScrollOffset: 1,
      prompt: { text: "ok" },
    }, { width: 24, height: 9 });

    expect(screenRows(screen)).toEqual([
      row(24, "│ one"),
      row(24, ""),
      row(24, "two"),
      row(24, "system: three"),
      "╭─────── history -1 ───╮",
      "│ ok                   │",
      "│                      │",
      "│                      │",
      "╰──────────────────────╯",
    ]);
  });

  test("makes active tools and running state visible in the prompt border", () => {
    const screen = renderStarsView({
      status: {
        threadId: "T2",
        mode: "deep",
        model: "gpt5.5",
        cwd: "/repo",
        activeTools: ["Bash", "Read"],
      },
      transcript: [],
      prompt: { text: "" },
      running: true,
    }, { width: 80, height: 3 });

    const statusRow = screenRows(screen)[0];

    expect(statusRow).toContain("Bash,Read - deep");
    expect(screenRows(screen).at(-1)).toContain("/repo");
  });

  test("prioritizes live prompt status before long stable identifiers", () => {
    const screen = renderStarsView({
      status: {
        threadId: "T-thread-with-a-very-long-id",
        mode: "smart",
        model: "model-with-a-long-name",
        activeTools: ["Bash"],
      },
      transcript: [],
      prompt: { text: "" },
      running: true,
    }, { width: 30, height: 4 });

    expect(screenRows(screen)[0]).toBe("╭─────────── Bash - smart ───╮");
  });

  test("handles minimal heights while preserving the prompt", () => {
    expect(screenRows(renderStarsView({
      status: { mode: "smart" },
      transcript: [{ type: "user", text: "hidden" }],
      prompt: { text: "prompt" },
    }, { width: 10, height: 1 }))).toEqual([
      "> prompt  ",
    ]);

    expect(screenRows(renderStarsView({
      status: { mode: "smart" },
      transcript: [{ type: "user", text: "hidden" }],
      prompt: { text: "prompt" },
    }, { width: 10, height: 2 }))).toEqual([
      "          ",
      "> prompt  ",
    ]);
  });

  test("changing only prompt text emits only changed prompt cells through TerminalDriver", () => {
    const output = new FakeOutput();
    const terminal = new TerminalDriver(output);
    const baseState: StarsTuiState = {
      status: { threadId: "T1", mode: "smart" },
      transcript: [
        { type: "user", text: "hello" },
        { type: "assistant", text: "hi" },
      ],
      prompt: { text: "abc" },
    };

    terminal.start();
    output.drain();

    terminal.render(renderStarsView(baseState, { width: 40, height: 8 }));
    output.drain();

    terminal.render(renderStarsView({ ...baseState, prompt: { text: "abc!" } }, { width: 40, height: 8 }));
    const diff = output.drain();

    expect(diff).toContain(beginSynchronizedOutput());
    expect(diff).toContain(endSynchronizedOutput());
    expect(diff).toContain(cursorTo(5, 6));
    expect(diff).not.toContain(cursorTo(1, 1));
    expect(diff).not.toContain(cursorTo(2, 1));
    expect(diff).not.toContain(cursorTo(3, 1));
    expect(stripAnsi(diff)).toBe("!");
  });
});
