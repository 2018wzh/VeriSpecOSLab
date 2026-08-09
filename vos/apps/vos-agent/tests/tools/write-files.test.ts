import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createWriteFilesTool } from "../../app/tools/write-files.ts";
import { makeTmpDir, removeTmpDir } from "../helpers/tmp.ts";

describe("WriteFiles", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { removeTmpDir(tmp); });

  test("writes a validated file batch", async () => {
    const tool = createWriteFilesTool({ rootDir: tmp });
    expect(await tool.execute(JSON.stringify({ files: [
      { file_path: "src/a.ts", content: "export const a = 1;\n" },
      { file_path: "tests/a.test.ts", content: "test('a', () => {});\n" },
    ] }))).toBe("OK (2 files)");
    expect(readFileSync(join(tmp, "src/a.ts"), "utf8")).toContain("a = 1");
    expect(readFileSync(join(tmp, "tests/a.test.ts"), "utf8")).toContain("test('a'");
  });

  test("validates every path before writing any file", async () => {
    const tool = createWriteFilesTool({ rootDir: tmp });
    const result = await tool.execute(JSON.stringify({ files: [
      { file_path: "safe.txt", content: "safe" },
      { file_path: "../escape.txt", content: "escape" },
    ] }));
    expect(result).toContain("escapes workspace root");
    expect(existsSync(join(tmp, "safe.txt"))).toBe(false);
  });

  test("rejects duplicate and malformed entries", async () => {
    const tool = createWriteFilesTool({ rootDir: tmp });
    expect(await tool.execute(JSON.stringify({ files: [
      { file_path: "same", content: "a" },
      { file_path: "same", content: "b" },
    ] }))).toContain("duplicate path");
    expect(await tool.execute(JSON.stringify({ files: [] }))).toContain("1 to 64");
  });
});
