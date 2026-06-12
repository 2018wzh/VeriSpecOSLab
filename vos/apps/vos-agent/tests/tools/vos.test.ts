import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createVosTool } from "../../app/tools/vos.ts";
import { makeTmpDir, removeTmpDir } from "../helpers/tmp.ts";

describe("Vos tool", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir("vos-tool-");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("rejects malformed arguments", () => {
    const tool = createVosTool({ rootDir: tmp });
    expect(tool.execute("not json")).toContain("Error parsing Vos arguments");
    expect(tool.execute("{}")).toContain('"command" must be a string');
  });

  test("blocks recursive and interactive VOS commands", () => {
    const tool = createVosTool({ rootDir: tmp });
    expect(tool.execute(JSON.stringify({ command: "vos agent serve" }))).toContain(
      "is not allowed",
    );
    expect(tool.execute(JSON.stringify({ command: "agent dev" }))).toContain(
      "is not allowed",
    );
    expect(tool.execute(JSON.stringify({ command: "web dev" }))).toContain(
      "is not allowed",
    );
  });

  test("reports missing VOS workspace before spawning package scripts", () => {
    const tool = createVosTool({ rootDir: tmp });
    expect(tool.execute(JSON.stringify({ command: "agent test" }))).toContain(
      "could not find VOS TypeScript workspace",
    );
  });

  test("lists portal routes without spawning a process", () => {
    const tool = createVosTool({ rootDir: tmp });
    const output = tool.execute(JSON.stringify({ command: "portal routes" }));
    expect(output).toContain("/api/v1/auth/login");
    expect(output).toContain("/v1/chat/completions");
  });
});
