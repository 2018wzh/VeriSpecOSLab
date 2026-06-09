import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { StarsTuiPromptInput } from "../../app/tui/prompt-input.ts";
import type { StarsCommandPaletteAction, StarsPromptState } from "../../app/tui/stars-view.ts";

class FakeRawInput extends EventEmitter {
  rawModeValues: boolean[] = [];
  resumed = 0;
  paused = 0;
  encoding: BufferEncoding | undefined;

  setEncoding(encoding: BufferEncoding): this {
    this.encoding = encoding;
    return this;
  }

  setRawMode(enabled: boolean): this {
    this.rawModeValues.push(enabled);
    return this;
  }

  resume(): this {
    this.resumed += 1;
    return this;
  }

  pause(): this {
    this.paused += 1;
    return this;
  }

  pushData(chunk: string): void {
    this.emit("data", chunk);
  }

  end(): void {
    this.emit("end");
  }
}

class RecordingPromptView {
  readonly prompts: StarsPromptState[] = [];
  readonly hints: Array<string | undefined> = [];
  readonly paletteMoves: Array<"previous" | "next"> = [];
  readonly transcriptScrolls: Array<Readonly<{ direction: "up" | "down"; amount?: "line" | "page" }>> = [];
  paletteMoveResult = false;
  paletteAction: StarsCommandPaletteAction | undefined;

  setPrompt(prompt: StarsPromptState): void {
    this.prompts.push({ text: prompt.text, cursor: prompt.cursor });
  }

  setInputHint(message: string | undefined): void {
    this.hints.push(message);
  }

  moveCommandPaletteSelection(direction: "previous" | "next"): boolean {
    this.paletteMoves.push(direction);
    return this.paletteMoveResult;
  }

  acceptCommandPaletteSelection(): StarsCommandPaletteAction | undefined {
    return this.paletteAction;
  }

  scrollTranscript(direction: "up" | "down", amount?: "line" | "page"): void {
    this.transcriptScrolls.push({ direction, amount });
  }
}

describe("Stars TUI prompt input", () => {
  test("turns raw key chunks into live prompt updates and submitted lines", async () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    const line = promptInput.readLine();
    input.pushData("hello\x1b[D!\r");

    expect(await line).toBe("hell!o");
    expect(view.prompts).toContainEqual({ text: "hello", cursor: 5 });
    expect(view.prompts).toContainEqual({ text: "hello", cursor: 4 });
    expect(view.prompts).toContainEqual({ text: "hell!o", cursor: 5 });
    expect(view.prompts.at(-1)).toEqual({ text: "", cursor: 0 });
  });

  test("accepts and submits UTF-8 Chinese prompt text", async () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    const line = promptInput.readLine();
    input.pushData("你好，Stars\r");

    expect(await line).toBe("你好，Stars");
    expect(view.prompts).toContainEqual({ text: "你好，Stars", cursor: 8 });
    expect(view.prompts.at(-1)).toEqual({ text: "", cursor: 0 });
  });

  test("blank enter redraws an empty prompt but waits for a real line", async () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    const line = promptInput.readLine();
    input.pushData("   \rnext\r");

    expect(await line).toBe("next");
    expect(view.prompts).toContainEqual({ text: "   ", cursor: 3 });
    expect(view.prompts.filter((prompt) => prompt.text === "").length).toBeGreaterThanOrEqual(2);
  });

  test("Ctrl-C clears a non-empty prompt without exiting", async () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    const line = promptInput.readLine();
    input.pushData("draft\x03next\r");

    expect(await line).toBe("next");
    expect(view.prompts).toContainEqual({ text: "draft", cursor: 5 });
    expect(view.prompts).toContainEqual({ text: "", cursor: 0 });
    expect(view.hints).toContain("Press Ctrl-C again to exit.");
    expect(view.hints).toContain(undefined);
    expect(view.prompts).not.toContainEqual({ text: "draftnext", cursor: 9 });
  });

  test("double Ctrl-C on an empty prompt and Ctrl-D end input", async () => {
    const interruptInput = new FakeRawInput();
    const interruptView = new RecordingPromptView();
    const interrupted = new StarsTuiPromptInput({ input: interruptInput, view: interruptView });
    interrupted.start();
    const interruptedLine = interrupted.readLine();
    interruptInput.pushData("\x03\x03");

    expect(await interruptedLine).toBeUndefined();
    expect(interruptView.hints).toEqual(["Press Ctrl-C again to exit.", undefined]);

    const disarmedInput = new FakeRawInput();
    const disarmedView = new RecordingPromptView();
    const disarmed = new StarsTuiPromptInput({ input: disarmedInput, view: disarmedView });
    disarmed.start();
    const disarmedLine = disarmed.readLine();
    disarmedInput.pushData("\x03next\r");

    expect(await disarmedLine).toBe("next");
    expect(disarmedView.hints).toEqual(["Press Ctrl-C again to exit.", undefined]);
    disarmed.close();

    const eofInput = new FakeRawInput();
    const eofView = new RecordingPromptView();
    const eof = new StarsTuiPromptInput({ input: eofInput, view: eofView });
    eof.start();
    const eofLine = eof.readLine();
    eofInput.pushData("\x04");

    expect(await eofLine).toBeUndefined();
  });

  test("Ctrl-D with a non-empty prompt does not exit", async () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    const line = promptInput.readLine();
    input.pushData("draft\x04\r");

    expect(await line).toBe("draft");
    expect(view.prompts).toContainEqual({ text: "draft", cursor: 5 });
    expect(input.rawModeValues).toEqual([true]);
    promptInput.close();
    expect(input.rawModeValues).toEqual([true, false]);
  });

  test("Up and Down navigate submitted prompt history and restore drafts", async () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    const first = promptInput.readLine();
    input.pushData("first\r");
    expect(await first).toBe("first");

    const second = promptInput.readLine();
    input.pushData("second\r");
    expect(await second).toBe("second");

    const recalled = promptInput.readLine();
    input.pushData("draft\x1b[A\x1b[A\x1b[B\x1b[Bdone\r");

    expect(await recalled).toBe("draftdone");
    expect(view.prompts).toContainEqual({ text: "second", cursor: 6 });
    expect(view.prompts).toContainEqual({ text: "first", cursor: 5 });
    expect(view.prompts).toContainEqual({ text: "draft", cursor: 5 });
    promptInput.close();
  });

  test("arrow keys navigate an active command palette and enter submits the selected command", async () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    view.paletteMoveResult = true;
    view.paletteAction = { text: "/help", submit: true };
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    const line = promptInput.readLine();
    input.pushData("/\x1b[B\x1b[C\x1b[A\x1b[D\r");

    expect(await line).toBe("/help");
    expect(view.paletteMoves).toEqual(["next", "next", "previous", "previous"]);
    expect(view.prompts).toContainEqual({ text: "/", cursor: 1 });
    expect(view.prompts.at(-1)).toEqual({ text: "", cursor: 0 });
    promptInput.close();
  });

  test("scroll shortcuts scroll the transcript without editing the prompt", () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    input.pushData("draft\x1b[5~\x1b[6~\x1b[1;5A\x1b[1;5B");

    expect(view.transcriptScrolls).toEqual([
      { direction: "up", amount: "page" },
      { direction: "down", amount: "page" },
      { direction: "up", amount: "line" },
      { direction: "down", amount: "line" },
    ]);
    expect(view.prompts.at(-1)).toEqual({ text: "draft", cursor: 5 });
    promptInput.close();
  });

  test("enter on an argument-taking palette entry fills the prompt without submitting", async () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    view.paletteAction = { text: "/mode ", submit: false };
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    const line = promptInput.readLine();
    input.pushData("/\rdeep\r");

    expect(await line).toBe("/mode deep");
    expect(view.prompts).toContainEqual({ text: "/mode ", cursor: 6 });
    promptInput.close();
  });

  test("editing a recalled prompt submits the edited text", async () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    const seed = promptInput.readLine();
    input.pushData("run tests\r");
    expect(await seed).toBe("run tests");

    const edited = promptInput.readLine();
    input.pushData("\x1b[A\x1b[D!\r");

    expect(await edited).toBe("run test!s");
    expect(view.prompts).toContainEqual({ text: "run tests", cursor: 9 });
    expect(view.prompts).toContainEqual({ text: "run test!s", cursor: 9 });
    promptInput.close();
  });

  test("start and close manage raw mode idempotently and unblock reads", async () => {
    const input = new FakeRawInput();
    const view = new RecordingPromptView();
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    promptInput.start();
    const line = promptInput.readLine();
    promptInput.close();
    promptInput.close();

    expect(await line).toBeUndefined();
    expect(input.encoding).toBe("utf8");
    expect(input.rawModeValues).toEqual([true, false]);
    expect(input.resumed).toBe(1);
    expect(input.paused).toBe(1);
  });

  test("view prompt failures reject the pending line and restore raw mode", async () => {
    const input = new FakeRawInput();
    const failure = new Error("render failed");
    const view = {
      setPrompt(prompt: StarsPromptState): void {
        if (prompt.text === "x") {
          throw failure;
        }
      },
    };
    const promptInput = new StarsTuiPromptInput({ input, view });

    promptInput.start();
    const line = promptInput.readLine();
    input.pushData("x");

    await expect(line).rejects.toThrow("render failed");
    expect(input.rawModeValues).toEqual([true, false]);
    expect(input.listenerCount("data")).toBe(0);
  });
});
