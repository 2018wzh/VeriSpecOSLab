import { describe, expect, test } from "bun:test";
import { isVosCommand } from "../src/index.ts";

describe("VosCommand boundary", () => {
  test("excludes CLI-only commands from shared execution", () => {
    expect(isVosCommand({ kind: "build", dryRun: true })).toBe(true);
    expect(isVosCommand({ kind: "serve", portalUrl: "http://portal.test", projectId: "project-1" })).toBe(false);
    expect(isVosCommand({ kind: "login", portalUrl: "http://portal.test", tokenStdin: false })).toBe(false);
    expect(isVosCommand({ kind: "whoami" })).toBe(false);
    expect(isVosCommand({ kind: "agent_serve" })).toBe(false);
  });
});
