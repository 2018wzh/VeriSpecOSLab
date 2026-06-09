import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createGlobTool, globTool } from "../../app/tools/glob.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("globTool", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir("glob-tool-");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("schema advertises pattern as required", () => {
    expect(globTool.schema.function.name).toBe("Glob");
    const params = globTool.schema.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties.pattern).toBeDefined();
    expect(params.properties.max_results).toBeDefined();
    expect(params.required).toEqual(["pattern"]);
  });

  test("returns sorted file matches under the workspace root", async () => {
    writeFixture(tmp, "src/b.ts", "b");
    writeFixture(tmp, "src/a.ts", "a");
    writeFixture(tmp, "README.md", "doc");
    const tool = createGlobTool({ rootDir: tmp });

    const result = JSON.parse(await tool.execute(JSON.stringify({
      pattern: "src/**/*.ts",
    })));

    expect(result).toEqual({
      matches: ["src/a.ts", "src/b.ts"],
      count: 2,
      truncated: false,
    });
  });

  test("applies max_results and reports truncation", async () => {
    writeFixture(tmp, "a.txt", "a");
    writeFixture(tmp, "b.txt", "b");
    const tool = createGlobTool({ rootDir: tmp });

    const result = JSON.parse(await tool.execute(JSON.stringify({
      pattern: "*.txt",
      max_results: 1,
    })));

    expect(result).toEqual({
      matches: ["a.txt"],
      count: 2,
      truncated: true,
    });
  });

  test("returns validation errors instead of throwing", async () => {
    const tool = createGlobTool({ rootDir: tmp });
    expect(await tool.execute("not json")).toContain("Error parsing Glob arguments");
    expect(await tool.execute(JSON.stringify({ pattern: "../*.ts" }))).toContain(
      "escapes workspace root",
    );
    expect(await tool.execute(JSON.stringify({
      pattern: "*.ts",
      max_results: 0,
    }))).toContain("max_results");
  });
});
