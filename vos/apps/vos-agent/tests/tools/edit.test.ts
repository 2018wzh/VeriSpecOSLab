import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createEditTool, editTool } from "../../app/tools/edit.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("editTool", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir("edit-tool-");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("schema advertises file_path, old_str, and new_str as required", () => {
    expect(editTool.schema.function.name).toBe("Edit");
    const params = editTool.schema.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties.file_path).toBeDefined();
    expect(params.properties.old_str).toBeDefined();
    expect(params.properties.new_str).toBeDefined();
    expect(params.properties.replace_all).toBeDefined();
    expect(params.required.sort()).toEqual(["file_path", "new_str", "old_str"]);
  });

  test("replaces one exact occurrence", async () => {
    const path = writeFixture(tmp, "app.ts", "const answer = 41;\n");
    const tool = createEditTool({ rootDir: tmp });

    const result = await tool.execute(JSON.stringify({
      file_path: "app.ts",
      old_str: "41",
      new_str: "42",
    }));

    expect(result).toBe("OK");
    expect(readFileSync(path, "utf8")).toBe("const answer = 42;\n");
  });

  test("can delete text by replacing with an empty string", async () => {
    const path = writeFixture(tmp, "notes.txt", "keep remove keep");
    const tool = createEditTool({ rootDir: tmp });

    const result = await tool.execute(JSON.stringify({
      file_path: "notes.txt",
      old_str: " remove",
      new_str: "",
    }));

    expect(result).toBe("OK");
    expect(readFileSync(path, "utf8")).toBe("keep keep");
  });

  test("requires replace_all for ambiguous matches", async () => {
    const path = writeFixture(tmp, "app.ts", "x = 1\ny = 1\n");
    const tool = createEditTool({ rootDir: tmp });

    const ambiguous = await tool.execute(JSON.stringify({
      file_path: "app.ts",
      old_str: "1",
      new_str: "2",
    }));
    expect(ambiguous).toContain("matched 2 times");
    expect(readFileSync(path, "utf8")).toBe("x = 1\ny = 1\n");

    const all = await tool.execute(JSON.stringify({
      file_path: "app.ts",
      old_str: "1",
      new_str: "2",
      replace_all: true,
    }));
    expect(all).toBe("OK");
    expect(readFileSync(path, "utf8")).toBe("x = 2\ny = 2\n");
  });

  test("returns descriptive errors for missing matches and invalid args", async () => {
    writeFixture(tmp, "app.ts", "hello");
    const tool = createEditTool({ rootDir: tmp });

    expect(await tool.execute("not json")).toContain("Error parsing Edit arguments");
    expect(await tool.execute(JSON.stringify({
      file_path: "app.ts",
      old_str: "",
      new_str: "x",
    }))).toContain('"old_str" must be non-empty');
    expect(await tool.execute(JSON.stringify({
      file_path: "app.ts",
      old_str: "missing",
      new_str: "x",
    }))).toContain("old_str not found");
  });

  test("rejects paths outside the workspace root", async () => {
    const tool = createEditTool({ rootDir: tmp });
    const outside = join(tmp, "..", `outside-${basename(tmp)}.txt`);
    const result = await tool.execute(JSON.stringify({
      file_path: `../outside-${basename(tmp)}.txt`,
      old_str: "x",
      new_str: "y",
    }));

    expect(result).toContain("Error editing file");
    expect(result).toContain("escapes workspace root");
    expect(existsSync(outside)).toBe(false);
  });
});
