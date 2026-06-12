import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createReadTool, readTool } from "../../app/tools/read.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("readTool", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("schema advertises file_path as required", () => {
    expect(readTool.schema.type).toBe("function");
    expect(readTool.schema.function.name).toBe("Read");
    const params = readTool.schema.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties.file_path).toBeDefined();
    expect(params.required).toEqual(["file_path"]);
  });

  test("returns raw file contents on success", async () => {
    const path = writeFixture(tmp, "hello.py", "print('Hello, World!')");
    const tool = createReadTool({ rootDir: tmp });
    const result = await tool.execute(JSON.stringify({ file_path: path }));
    expect(result).toBe("print('Hello, World!')");
  });

  test("preserves multi-line file contents byte-for-byte", async () => {
    const body = "line one\nline two\nno trailing newline";
    writeFixture(tmp, "multi.txt", body);
    const tool = createReadTool({ rootDir: tmp });
    const result = await tool.execute(
      JSON.stringify({ file_path: "multi.txt" }),
    );
    expect(result).toBe(body);
  });

  test("returns descriptive error when file does not exist", async () => {
    const tool = createReadTool({ rootDir: tmp });
    const result = await tool.execute(
      JSON.stringify({ file_path: "does-not-exist.txt" }),
    );
    expect(result).toContain("Error reading file");
    expect(result).toContain("ENOENT");
  });

  test("returns parse and validation errors instead of throwing", async () => {
    const tool = createReadTool({ rootDir: tmp });
    expect(await tool.execute("not json")).toContain(
      "Error parsing Read arguments",
    );
    expect(await tool.execute(JSON.stringify({ file_path: 42 }))).toContain(
      '"file_path" must be a string',
    );
  });

  test("rejects paths outside the workspace root", async () => {
    const tool = createReadTool({ rootDir: tmp });
    const result = await tool.execute(JSON.stringify({ file_path: "../x.txt" }));
    expect(result).toContain("Error reading file");
    expect(result).toContain("escapes workspace root");
  });

  test("truncates large file contents with an explicit marker", async () => {
    writeFixture(tmp, "large.txt", "hello world");
    const tool = createReadTool({ rootDir: tmp, maxBytes: 5 });
    const result = await tool.execute(JSON.stringify({ file_path: "large.txt" }));
    expect(result).toContain("hello");
    expect(result).toContain("file contents truncated");
  });

  test("works for absolute paths inside the workspace root", async () => {
    const path = writeFixture(tmp, "absolute.txt", "abs");
    const tool = createReadTool({ rootDir: tmp });
    const result = await tool.execute(JSON.stringify({ file_path: path }));
    expect(result).toBe("abs");
  });

  test("works for the cwd join path", () => {
    // Sanity-check the join helper used elsewhere — keeps the imports honest.
    expect(join(tmp, "x")).toContain(tmp);
  });
});
