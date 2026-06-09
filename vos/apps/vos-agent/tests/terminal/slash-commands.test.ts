import { describe, expect, test } from "bun:test";
import { parseSlashCommand } from "../../app/terminal/slash-commands.ts";

describe("parseSlashCommand", () => {
  test("non-slash input becomes a prompt", () => {
    expect(parseSlashCommand("fix the tests")).toEqual({
      kind: "prompt",
      prompt: "fix the tests",
    });
  });

  test("parses core slash commands", () => {
    expect(parseSlashCommand("/help")).toEqual({ kind: "help" });
    expect(parseSlashCommand("/quit")).toEqual({ kind: "quit" });
    expect(parseSlashCommand("/exit")).toEqual({ kind: "quit" });
    expect(parseSlashCommand("/new")).toEqual({ kind: "new" });
    expect(parseSlashCommand("/thread")).toEqual({ kind: "thread-show" });
    expect(parseSlashCommand("/thread T-1")).toEqual({
      kind: "thread-switch",
      threadId: "T-1",
    });
    expect(parseSlashCommand("/mode rush")).toEqual({
      kind: "mode-set",
      mode: "rush",
    });
    expect(parseSlashCommand("/mode")).toEqual({ kind: "mode-show" });
    expect(parseSlashCommand("/todos")).toEqual({ kind: "todos" });
  });

  test("unknown slash command returns an error command", () => {
    expect(parseSlashCommand("/wat")).toEqual({
      kind: "error",
      message: "unknown command: /wat",
    });
    expect(parseSlashCommand("/he")).toEqual({
      kind: "error",
      message: "unknown command: /he",
    });
  });
});
