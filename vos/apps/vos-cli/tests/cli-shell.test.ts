import { describe, expect, test } from "bun:test";
import { executeCliInvocation, parseArgs } from "../app/main.ts";

describe("vos-cli shell", () => {
  test("re-exports core parser and executor for the bin wrapper", () => {
    expect(parseArgs(["bun", "vos", "--help"]).command.kind).toBe("help");
    expect(typeof executeCliInvocation).toBe("function");
  });
});
