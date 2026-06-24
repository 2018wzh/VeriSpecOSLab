import { describe, expect, test } from "bun:test";
import { StarsTuiInteractiveView } from "../../app/tui/interactive-view.ts";
import { TerminalDriver } from "../../app/tui/terminal.ts";
import type { ScreenBuffer } from "../../app/tui/screen.ts";
import type { StarsTranscriptItem, StarsViewFrame, StarsViewSize } from "../../app/tui/stars-view.ts";

class RecordingPresenter {
  readonly frames: StarsViewFrame[] = [];

  renderFrame(frame: StarsViewFrame): void {
    this.frames.push(frame);
  }

  latestText(): string {
    const frame = this.frames.at(-1);
    if (!frame) return "";
    return screenText(frame.screen);
  }
}

class CapturingOutput {
  value = "";

  write(chunk: string): void {
    this.value += chunk;
  }
}

const size: StarsViewSize = { width: 48, height: 9 };

async function waitFor(condition: () => boolean, timeoutMs = 100): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("condition was not met before timeout");
    }
    await delay(1);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Stars TUI interactive view", () => {
  test("renders welcome, command, status, error, and prompt through TUI frames", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({ presenter, size: () => size });

    view.welcome({ mode: "smart", disabledTools: ["Bash"] });
    view.command("new thread");
    view.status({ threadId: "T-session", mode: "smart", disabledTools: ["Bash"] });
    view.error("unknown command: /wat");
    view.setPrompt({ text: "hello", cursor: 5 });

    const text = presenter.latestText();
    expect(text).toContain("command: new thread");
    expect(text).not.toContain("status: thread: T-session | mode: smart |");
    expect(text).not.toContain("disabled tools: Bash");
    expect(text).toContain("error: unknown command: /wat");
    expect(text).toContain("╭──────────────────────────────────── smart ───╮");
    expect(text).toContain("│ hello");
    expect(presenter.frames.at(-1)?.cursor).toEqual({ x: 7, y: 5 });
  });

  test("maps session events to running status, active tools, and final answer once", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({ presenter, size: () => size });

    view.welcome({ mode: "smart" });
    view.onSessionEvent({
      type: "thread.created",
      thread_id: "T-session",
      mode: "smart",
      model: "test-model",
      tools: ["Read", "Bash"],
      cwd: "/tmp/project",
    });
    view.onSessionEvent({
      type: "assistant.message",
      thread_id: "T-session",
      iteration: 1,
      content: null,
      toolCalls: [{ id: "bash-1", name: "Bash", arguments: "{}" }],
    });
    view.onSessionEvent({
      type: "tool.call",
      thread_id: "T-session",
      iteration: 1,
      id: "bash-1",
      name: "Bash",
      arguments: JSON.stringify({ command: "printf hi" }),
    });

    const running = presenter.latestText();
    expect(running).toContain("Bash - smart");
    expect(running).toContain("$ printf hi");
    expect(running).toContain("printf hi");

    view.onSessionEvent({
      type: "tool.result",
      thread_id: "T-session",
      iteration: 1,
      id: "bash-1",
      name: "Bash",
      content: "hi\n",
    });
    view.onSessionEvent({
      type: "agent.done",
      thread_id: "T-session",
      iteration: 2,
      content: "final answer",
    });
    view.onSessionEvent({ type: "thread.saved", thread_id: "T-session" });
    view.onSessionEvent({ type: "done", thread_id: "T-session", content: "final answer" });

    const complete = presenter.latestText();
    expect(complete).toContain("smart");
    expect(complete).not.toContain("Bash - smart");
    expect(complete).toContain("✓ Ran command");
    expect(complete).not.toContain("status: turn complete after 2 iteration(s)");
    expect(complete).not.toContain("status: saved thread: T-session");
    expect(complete).not.toContain("assistant:");
    expect(countOccurrences(complete, "final answer")).toBe(1);
  });

  test("renders model usage events in the full-screen transcript", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({ presenter, size: () => ({ width: 96, height: 10 }) });

    view.onSessionEvent({
      type: "model.usage",
      thread_id: "T-session",
      iteration: 1,
      model: "sonnet4.6",
      provider: "anthropic",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      contextWindowTokens: 200000,
      contextWindowUsage: 0.005,
      estimatedCostUsd: 0.006,
    });

    const text = presenter.latestText();
    expect(text).toContain("usage: sonnet4.6");
    expect(text).toContain("1000 in");
    expect(text).toContain("0.5% of 200000 context");
    expect(text).toContain("est. $0.006000");
    expect(text).not.toContain("status: usage");
  });

  test("streams assistant deltas into one transcript entry without final duplication", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({ presenter, size: () => ({ width: 64, height: 10 }) });

    view.prompt("explain streaming");
    view.onSessionEvent({
      type: "thread.created",
      thread_id: "T-session",
      mode: "smart",
      model: "test-model",
      tools: [],
      cwd: "/tmp/project",
    });
    view.onSessionEvent({
      type: "assistant.delta",
      thread_id: "T-session",
      iteration: 1,
      delta: "streamed ",
    });
    view.onSessionEvent({
      type: "assistant.delta",
      thread_id: "T-session",
      iteration: 1,
      delta: "answer",
    });

    expect(presenter.latestText()).toContain("streamed answer");

    view.onSessionEvent({
      type: "assistant.message",
      thread_id: "T-session",
      iteration: 1,
      content: "streamed answer",
      toolCalls: [],
    });
    view.onSessionEvent({ type: "agent.done", thread_id: "T-session", iteration: 1, content: "streamed answer" });
    view.onSessionEvent({ type: "thread.saved", thread_id: "T-session" });
    view.onSessionEvent({ type: "done", thread_id: "T-session", content: "streamed answer" });

    expect(countOccurrences(presenter.latestText(), "streamed answer")).toBe(1);
  });

  test("keeps assistant labels available for debug views", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({ presenter, size: () => size, debugLabels: true });

    view.onSessionEvent({ type: "done", thread_id: "T-session", content: "final answer" });

    expect(presenter.latestText()).toContain("assistant: final answer");
  });

  test("passes the configured theme to assistant markdown rendering", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({
      presenter,
      size: () => ({ width: 40, height: 6 }),
      theme: "light",
    });

    view.onSessionEvent({ type: "done", thread_id: "T-session", content: "Use `code`." });

    const frame = presenter.frames.at(-1);
    const firstLine = frame ? screenLine(frame.screen, 0) : "";
    const codeX = firstLine.indexOf("`code`");
    expect(codeX).toBeGreaterThanOrEqual(0);
    expect(frame?.screen.getCell(codeX, 0).style).toEqual({ fg: "blue" });
  });

  test("loops the shader logo welcome animation until closed", async () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({
      presenter,
      size: () => ({ width: 72, height: 16 }),
      welcomeAnimation: true,
      welcomeAnimationFrameDelayMs: 1,
    });

    view.welcome({ mode: "smart" });
    await waitFor(() => presenter.frames.length >= 5);

    const renderedTexts = presenter.frames.map((frame) => screenText(frame.screen));
    expect(presenter.frames.length).toBeGreaterThanOrEqual(5);
    expect(new Set(renderedTexts).size).toBeGreaterThan(1);
    expect(renderedTexts[4]).not.toBe(renderedTexts[0]);
    expect(renderedTexts.at(0)).toMatch(/[·•●]/);
    expect(presenter.latestText()).toContain("Welcome to VOS Agent");

    const framesBeforeClose = presenter.frames.length;
    view.close();
    await delay(5);
    expect(presenter.frames.length).toBe(framesBeforeClose);
  });

  test("records submitted user prompts in the transcript", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({ presenter, size: () => ({ width: 40, height: 6 }) });

    view.welcome({ mode: "smart" });
    view.prompt("fix the failing tests");

    expect(presenter.latestText()).toContain("│ fix the failing tests");
  });

  test("shows the command palette while typing slash commands", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({ presenter, size: () => ({ width: 72, height: 14 }) });

    view.welcome({ mode: "smart" });
    view.setPrompt({ text: "/m", cursor: 2 });

    expect(presenter.latestText()).toContain("Command Palette");
    expect(presenter.latestText()).toContain("> m");
    expect(presenter.latestText()).toContain("mode  show current");

    view.setPrompt({ text: "regular prompt", cursor: 14 });

    expect(presenter.latestText()).not.toContain("Command Palette");
  });

  test("moves and accepts command palette selection", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({ presenter, size: () => ({ width: 72, height: 14 }) });

    view.welcome({ mode: "smart" });
    view.setPrompt({ text: "/", cursor: 1 });

    expect(view.acceptCommandPaletteSelection()).toEqual({ text: "/help", submit: true });
    expect(view.moveCommandPaletteSelection("next")).toBe(true);
    expect(view.acceptCommandPaletteSelection()).toEqual({ text: "/new", submit: true });
    expect(view.moveCommandPaletteSelection("previous")).toBe(true);
    expect(view.acceptCommandPaletteSelection()).toEqual({ text: "/help", submit: true });

    view.setPrompt({ text: "/mode", cursor: 5 });

    expect(view.moveCommandPaletteSelection("next")).toBe(true);
    expect(view.acceptCommandPaletteSelection()).toEqual({ text: "/mode ", submit: false });
  });

  test("errors clear running and active tool status", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({ presenter, size: () => size });

    view.onSessionEvent({
      type: "thread.loaded",
      thread_id: "T-session",
      mode: "smart",
      model: "test-model",
      tools: ["Bash"],
      cwd: "/tmp/project",
    });
    view.onSessionEvent({
      type: "tool.call",
      thread_id: "T-session",
      iteration: 1,
      id: "bash-1",
      name: "Bash",
      arguments: "{}",
    });
    view.error("model failed");

    const text = presenter.latestText();
    expect(text).toContain("error: model failed");
    expect(text).not.toContain("running");
    expect(text).not.toContain("tools:Bash");
  });

  test("keeps the newest transcript items visible when the view is busy", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({
      presenter,
      size: () => ({ width: 44, height: 6 }),
      maxTranscriptItems: 4,
    });

    view.welcome({ mode: "smart" });
    view.command("older command");
    view.command("middle command");
    view.onSessionEvent({
      type: "thread.loaded",
      thread_id: "T-session",
      mode: "smart",
      model: "test-model",
      tools: [],
      cwd: "/tmp/project",
    });
    view.onSessionEvent({
      type: "tool.call",
      thread_id: "T-session",
      iteration: 1,
      id: "read-1",
      name: "Read",
      arguments: JSON.stringify({ file_path: "README.md" }),
    });

    const text = presenter.latestText();
    expect(text).toContain("Read - smart");
    expect(text).toContain("› Exploring Read README.md");
    expect(text).toContain("README.md");
    expect(text).not.toContain("older command");
  });

  test("scrolls transcript history and keeps the viewport anchored while new events arrive", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({
      presenter,
      size: () => ({ width: 48, height: 9 }),
    });

    view.restoreTranscript([
      { type: "assistant", text: "old one" },
      { type: "assistant", text: "old two" },
      { type: "assistant", text: "middle" },
      { type: "assistant", text: "newer" },
      { type: "assistant", text: "latest" },
    ]);
    view.scrollTranscript("up");

    expect(presenter.latestText()).toContain("old one");
    expect(presenter.latestText()).toContain("old two");
    expect(presenter.latestText()).toContain("history -1");

    view.onSessionEvent({ type: "done", thread_id: "T-session", content: "live answer" });

    expect(presenter.latestText()).toContain("old one");
    expect(presenter.latestText()).not.toContain("live answer");

    view.scrollTranscript("down");
    view.scrollTranscript("down");

    expect(presenter.latestText()).toContain("live answer");
  });

  test("page scrolling moves by the transcript viewport and keeps assistant rows visible", () => {
    const presenter = new RecordingPresenter();
    const view = new StarsTuiInteractiveView({
      presenter,
      size: () => ({ width: 48, height: 10 }),
    });
    const transcript: StarsTranscriptItem[] = [];
    for (let index = 1; index <= 8; index += 1) {
      transcript.push({ type: "user", text: `question ${index}` });
      transcript.push({ type: "assistant", text: `answer ${index} first\nanswer ${index} second` });
    }

    view.restoreTranscript(transcript);
    view.scrollTranscript("up", "page");

    const page = presenter.latestText();
    expect(page).toContain("history -4");
    expect(page).toContain("│ question 7");
    expect(page).toContain("answer 7 first");
    expect(page).toContain("answer 7 second");

    view.scrollTranscript("down", "page");

    expect(presenter.latestText()).not.toContain("history -");
    expect(presenter.latestText()).toContain("│ question 8");
  });

  test("refresh clamps transcript history after resize exposes all rows", () => {
    const presenter = new RecordingPresenter();
    let currentSize: StarsViewSize = { width: 48, height: 9 };
    const view = new StarsTuiInteractiveView({
      presenter,
      size: () => currentSize,
    });

    view.restoreTranscript([
      { type: "assistant", text: "old one" },
      { type: "assistant", text: "old two" },
      { type: "assistant", text: "middle" },
      { type: "assistant", text: "newer" },
      { type: "assistant", text: "latest" },
    ]);
    view.scrollTranscript("up");

    expect(presenter.latestText()).toContain("history -1");

    currentSize = { width: 48, height: 20 };
    view.refresh();

    expect(presenter.latestText()).not.toContain("history -");
    expect(presenter.latestText()).toContain("latest");
  });

  test("refresh redraws the current state for a resized terminal", () => {
    const presenter = new RecordingPresenter();
    let currentSize: StarsViewSize = { width: 24, height: 5 };
    const view = new StarsTuiInteractiveView({ presenter, size: () => currentSize });

    view.welcome({ mode: "smart" });
    expect(presenter.frames.at(-1)?.screen.width).toBe(24);

    currentSize = { width: 36, height: 7 };
    view.refresh();

    const frame = presenter.frames.at(-1);
    expect(frame?.screen.width).toBe(36);
    expect(frame?.screen.height).toBe(7);
    expect(presenter.latestText()).toContain("Welcome to VOS Agent");
    expect(presenter.latestText()).toContain("smart");
  });

  test("typing through the view updates only prompt cells after the initial frame", () => {
    const output = new CapturingOutput();
    const driver = new TerminalDriver(output);
    driver.start();
    const view = new StarsTuiInteractiveView({
      presenter: driver,
      size: () => ({ width: 40, height: 6 }),
    });

    view.welcome({ mode: "smart" });
    const afterWelcome = output.value.length;
    view.setPrompt({ text: "h", cursor: 1 });
    const firstTyped = output.value.slice(afterWelcome);
    const afterFirstTyped = output.value.length;
    view.setPrompt({ text: "hi", cursor: 2 });
    const secondTyped = output.value.slice(afterFirstTyped);

    expect(firstTyped).toContain("h");
    expect(firstTyped).not.toContain("VOS Agent interactive mode");
    expect(secondTyped).toContain("i");
    expect(secondTyped).not.toContain("VOS Agent interactive mode");
    expect(secondTyped.length).toBeLessThan(50);
    driver.close();
  });
});

function screenText(screen: ScreenBuffer): string {
  const lines: string[] = [];
  for (let y = 0; y < screen.height; y += 1) {
    lines.push(screenLine(screen, y).trimEnd());
  }
  return lines.join("\n");
}

function screenLine(screen: ScreenBuffer, y: number): string {
  let line = "";
  for (let x = 0; x < screen.width; x += 1) {
    line += screen.getCell(x, y).char;
  }
  return line;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
