import { describe, expect, test } from "bun:test";
import { executeCliInvocation, isDemoInvocation, parseArgs, printHelp } from "../app/main.ts";

describe("vos-cli shell", () => {
  test("re-exports core parser and executor for the bin wrapper", () => {
    expect(parseArgs(["bun", "vos", "--help"]).command.kind).toBe("help");
    expect(typeof executeCliInvocation).toBe("function");
  });

  test("detects demo invocations before core parsing", () => {
    expect(isDemoInvocation(["bun", "vos", "demo", "--project-root", "../examples/xv6-spec"]))
      .toBe(true);
    expect(isDemoInvocation(["bun", "vos", "--project-root", "../examples/xv6-spec", "demo"]))
      .toBe(true);
    expect(isDemoInvocation(["bun", "vos", "agent", "ask", "demo"]))
      .toBe(false);
  });

  test("does not expose runtime self-update commands", () => {
    expect(printHelp("update")).toBe(false);
    expect(printHelp("self-update")).toBe(false);
  });
});
