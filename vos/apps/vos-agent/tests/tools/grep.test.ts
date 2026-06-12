import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createGrepTool, grepTool } from "../../app/tools/grep.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("grepTool", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir("grep-tool-");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("schema advertises pattern as required", () => {
    expect(grepTool.schema.function.name).toBe("Grep");
    const params = grepTool.schema.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties.pattern).toBeDefined();
    expect(params.properties.path).toBeDefined();
    expect(params.properties.regex).toBeDefined();
    expect(params.required).toEqual(["pattern"]);
  });

  test("finds literal matches with file, line, column, and text", async () => {
    writeFixture(tmp, "src/b.txt", "skip\nneedle beta\n");
    writeFixture(tmp, "src/a.txt", "alpha needle\nnone\n");
    const tool = createGrepTool({ rootDir: tmp });

    const result = JSON.parse(await tool.execute(JSON.stringify({
      pattern: "needle",
      path: "src",
    })));

    expect(result).toEqual({
      matches: [
        { file_path: "src/a.txt", line: 1, column: 7, text: "alpha needle" },
        { file_path: "src/b.txt", line: 2, column: 1, text: "needle beta" },
      ],
      count: 2,
      truncated: false,
    });
  });

  test("supports regex, case-insensitive search, and max_results", async () => {
    writeFixture(tmp, "a.txt", "Alpha\nbeta\n");
    writeFixture(tmp, "b.txt", "ALPHA\n");
    const tool = createGrepTool({ rootDir: tmp });

    const result = JSON.parse(await tool.execute(JSON.stringify({
      pattern: "^alpha$",
      regex: true,
      case_sensitive: false,
      max_results: 1,
    })));

    expect(result).toEqual({
      matches: [{ file_path: "a.txt", line: 1, column: 1, text: "Alpha" }],
      count: 2,
      truncated: true,
    });
  });

  test("returns validation errors instead of throwing", async () => {
    const tool = createGrepTool({ rootDir: tmp });
    expect(await tool.execute("not json")).toContain("Error parsing Grep arguments");
    expect(await tool.execute(JSON.stringify({ pattern: "[", regex: true }))).toContain(
      "invalid regex",
    );
    expect(await tool.execute(JSON.stringify({ pattern: "x", path: ".." }))).toContain(
      "escapes workspace root",
    );
  });
});
