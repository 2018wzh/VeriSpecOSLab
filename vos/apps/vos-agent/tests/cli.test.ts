import { describe, expect, test } from "bun:test";
import { parseArgs } from "../app/cli.ts";

describe("parseArgs", () => {
  test("no args starts interactive mode", () => {
    expect(parseArgs(["bun", "app/main.ts"])).toEqual({
      kind: "interactive",
      mode: undefined,
      model: undefined,
      threadId: undefined,
    });
  });

  test("extracts the prompt after -p as execute mode", () => {
    const r = parseArgs(["bun", "app/main.ts", "-p", "hello"]);
    expect(r).toEqual({
      kind: "execute",
      prompt: "hello",
      mode: undefined,
      model: undefined,
      threadId: undefined,
      streamJson: false,
      streamJsonInput: false,
    });
  });

  test("accepts --prompt and --prompt=value", () => {
    expect(parseArgs(["bun", "app/main.ts", "--prompt", "hi"])).toMatchObject({
      kind: "execute",
      prompt: "hi",
    });
    expect(parseArgs(["bun", "app/main.ts", "--prompt=hi"])).toMatchObject({
      kind: "execute",
      prompt: "hi",
    });
  });

  test("parses exec subcommand and --execute aliases", () => {
    expect(parseArgs(["bun", "app/main.ts", "exec", "-p", "hi"])).toMatchObject({
      kind: "execute",
      prompt: "hi",
      streamJson: false,
    });
    expect(parseArgs(["bun", "app/main.ts", "--execute", "hi"])).toMatchObject({
      kind: "execute",
      prompt: "hi",
      streamJson: false,
    });
    expect(parseArgs(["bun", "app/main.ts", "-x", "hi"])).toMatchObject({
      kind: "execute",
      prompt: "hi",
      streamJson: false,
    });
    expect(parseArgs(["bun", "app/main.ts", "--execute=hi"])).toMatchObject({
      kind: "execute",
      prompt: "hi",
      streamJson: false,
    });
    expect(parseArgs(["bun", "app/main.ts", "run", "-p", "hi"])).toMatchObject({
      kind: "execute",
      prompt: "hi",
      streamJson: false,
    });
    expect(parseArgs(["bun", "app/main.ts", "ask", "-p", "hi"])).toMatchObject({
      kind: "execute",
      prompt: "hi",
      streamJson: false,
    });
  });

  test("parses HTTP serve mode", () => {
    expect(parseArgs(["bun", "app/main.ts", "serve"])).toEqual({
      kind: "serve",
      host: undefined,
      port: undefined,
    });
    expect(parseArgs([
      "bun",
      "app/main.ts",
      "serve",
      "--host",
      "0.0.0.0",
      "--port=8787",
    ])).toEqual({
      kind: "serve",
      host: "0.0.0.0",
      port: 8787,
    });
  });

  test("parses mode, model, thread, and stream-json", () => {
    const r = parseArgs([
      "bun",
      "app/main.ts",
      "exec",
      "--mode=rush",
      "--model",
      "anthropic:gpt-5.5",
      "--thread",
      "T-abc123",
      "--stream-json",
      "-p",
      "hi",
    ]);
    expect(r).toEqual({
      kind: "execute",
      prompt: "hi",
      mode: "rush",
      model: "anthropic:gpt-5.5",
      threadId: "T-abc123",
      streamJson: true,
      streamJsonInput: false,
    });
  });

  test("parses stream-json-input automation mode", () => {
    expect(parseArgs([
      "bun",
      "app/main.ts",
      "--stream-json",
      "--stream-json-input",
      "--mode",
      "rush",
    ])).toEqual({
      kind: "execute",
      prompt: undefined,
      mode: "rush",
      model: undefined,
      threadId: undefined,
      streamJson: true,
      streamJsonInput: true,
    });
  });

  test("parses interactive mode selection and thread", () => {
    expect(
      parseArgs(["bun", "app/main.ts", "--mode", "deep", "--thread=T-1"]),
    ).toEqual({
      kind: "interactive",
      mode: "deep",
      model: undefined,
      threadId: "T-1",
    });
  });

  test("parses help, version, and thread commands without prompt", () => {
    expect(parseArgs(["bun", "app/main.ts", "--help"])).toEqual({
      kind: "help",
    });
    expect(parseArgs(["bun", "app/main.ts", "--version"])).toEqual({
      kind: "version",
    });
    expect(parseArgs(["bun", "app/main.ts", "threads", "list"])).toEqual({
      kind: "threads-list",
      archived: "active",
    });
    expect(parseArgs(["bun", "app/main.ts", "--list-threads"])).toEqual({
      kind: "threads-list",
      archived: "active",
    });
    expect(parseArgs(["bun", "app/main.ts", "threads", "list", "--archived"])).toEqual({
      kind: "threads-list",
      archived: "archived",
    });
    expect(parseArgs(["bun", "app/main.ts", "threads", "list", "--all"])).toEqual({
      kind: "threads-list",
      archived: "all",
    });
    expect(parseArgs(["bun", "app/main.ts", "threads", "continue", "T-abc123"])).toEqual({
      kind: "interactive",
      mode: undefined,
      model: undefined,
      threadId: "T-abc123",
    });
    expect(parseArgs(["bun", "app/main.ts", "threads", "archive", "T-abc123"])).toEqual({
      kind: "threads-archive",
      threadId: "T-abc123",
    });
    expect(parseArgs(["bun", "app/main.ts", "threads", "fork", "T-abc123"])).toEqual({
      kind: "threads-fork",
      threadId: "T-abc123",
    });
  });

  test("throws when prompt-like values are empty or missing", () => {
    expect(() => parseArgs(["bun", "app/main.ts", "-p", ""])).toThrow(
      /-p requires a non-empty value/,
    );
    expect(() => parseArgs(["bun", "app/main.ts", "-p"])).toThrow(
      /-p requires a value/,
    );
    expect(() => parseArgs(["bun", "app/main.ts", "--prompt="])).toThrow(
      /--prompt requires a non-empty value/,
    );
    expect(parseArgs(["bun", "app/main.ts", "-p", "- [ ] fix this"])).toMatchObject({
      kind: "execute",
      prompt: "- [ ] fix this",
    });
    expect(() =>
      parseArgs(["bun", "app/main.ts", "--mode", "--stream-json"]),
    ).toThrow(/--mode requires a value/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "--thread", "--help"]),
    ).toThrow(/--thread requires a value/);
  });

  test("throws on invalid flag combinations and unknown arguments", () => {
    expect(() =>
      parseArgs(["bun", "app/main.ts", "--stream-json"]),
    ).toThrow(/--stream-json requires execute mode/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "--stream-json-input"]),
    ).toThrow(/--stream-json-input requires --stream-json/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "--stream-json", "--stream-json-input", "-p", "hi"]),
    ).toThrow(/--stream-json-input cannot be combined/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "--stream-json", "--help"]),
    ).toThrow(/--help cannot be combined/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "--reasoning-effort", "high", "-p", "hi"]),
    ).toThrow(/unknown argument: --reasoning-effort/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "threads", "list", "-p", "hi"]),
    ).toThrow(/threads list cannot be combined/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "threads", "list", "--archived", "--all"]),
    ).toThrow(/threads list filters cannot be combined/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "threads", "continue"]),
    ).toThrow(/threads continue requires a thread id/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "threads", "archive", "T-1", "extra"]),
    ).toThrow(/threads archive cannot be combined/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "-p", "hi", "--bogus"]),
    ).toThrow(/unknown argument: --bogus/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "serve", "--port", "0"]),
    ).toThrow(/requires a TCP port/);
    expect(() =>
      parseArgs(["bun", "app/main.ts", "serve", "--bogus"]),
    ).toThrow(/unknown serve argument/);
  });
});
