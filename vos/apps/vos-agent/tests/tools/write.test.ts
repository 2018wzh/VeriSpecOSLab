import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createWriteTool, writeTool } from "../../app/tools/write.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("writeTool", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("schema advertises file_path + content as required", () => {
    expect(writeTool.schema.function.name).toBe("Write");
    const params = writeTool.schema.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties.file_path).toBeDefined();
    expect(params.properties.content).toBeDefined();
    expect(params.required.sort()).toEqual(["content", "file_path"]);
  });

  test("creates a new file with exact content", async () => {
    const path = join(tmp, "out.py");
    const tool = createWriteTool({ rootDir: tmp });
    const result = await tool.execute(
      JSON.stringify({ file_path: "out.py", content: 'print("Hello world")' }),
    );
    expect(result).toBe("OK");
    expect(readFileSync(path, "utf8")).toBe('print("Hello world")');
  });

  test("overwrites an existing file", async () => {
    const path = writeFixture(tmp, "existing.txt", "old contents");
    const tool = createWriteTool({ rootDir: tmp });
    const result = await tool.execute(
      JSON.stringify({ file_path: "existing.txt", content: "new contents" }),
    );
    expect(result).toBe("OK");
    expect(readFileSync(path, "utf8")).toBe("new contents");
  });

  test("creates parent directories as needed", async () => {
    const path = join(tmp, "deeply", "nested", "file.txt");
    const tool = createWriteTool({ rootDir: tmp });
    const result = await tool.execute(
      JSON.stringify({ file_path: path, content: "hello" }),
    );
    expect(result).toBe("OK");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("hello");
  });

  test("returns descriptive error when target is a directory", async () => {
    const tool = createWriteTool({ rootDir: tmp });
    const result = await tool.execute(
      JSON.stringify({ file_path: ".", content: "x" }),
    );
    expect(result).toContain("Error writing file");
  });

  test("returns parse and validation errors instead of throwing", async () => {
    const tool = createWriteTool({ rootDir: tmp });
    expect(await tool.execute("not json")).toContain(
      "Error parsing Write arguments",
    );
    expect(
      await tool.execute(JSON.stringify({ file_path: "x.txt", content: 1 })),
    ).toContain('"content" must be a string');
  });

  test("allows writing empty string content", async () => {
    const tool = createWriteTool({ rootDir: tmp });
    const result = await tool.execute(
      JSON.stringify({ file_path: "empty.txt", content: "" }),
    );
    expect(result).toBe("OK");
    expect(readFileSync(join(tmp, "empty.txt"), "utf8")).toBe("");
  });

  test("rejects paths outside the workspace root", async () => {
    const tool = createWriteTool({ rootDir: tmp });
    const outside = join(tmp, "..", `outside-${basename(tmp)}.txt`);
    const result = await tool.execute(
      JSON.stringify({ file_path: `../outside-${basename(tmp)}.txt`, content: "x" }),
    );
    expect(result).toContain("Error writing file");
    expect(result).toContain("escapes workspace root");
    expect(existsSync(outside)).toBe(false);
  });
});
