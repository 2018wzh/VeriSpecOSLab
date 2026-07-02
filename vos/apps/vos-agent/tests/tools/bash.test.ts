import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isWindows } from "vos-platform";
import { bashTool, createBashTool } from "../../app/tools/bash.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("bashTool", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("schema advertises command as required", () => {
    expect(bashTool.schema.function.name).toBe("Bash");
    const params = bashTool.schema.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties.command).toBeDefined();
    expect(params.required).toEqual(["command"]);
  });

  test("captures stdout of a successful command", async () => {
    const result = await bashTool.execute(
      JSON.stringify({ command: shellCommand("echo hello", "Write-Output \"hello\"") }),
    );
    expect(normalizeNewlines(result)).toBe("hello\n");
  });

  test("captures stderr of a failing command and does not throw", async () => {
    const result = await bashTool.execute(
      JSON.stringify({
        command: shellCommand(
          "echo to-out; echo to-err 1>&2; exit 3",
          "[Console]::Out.WriteLine(\"to-out\"); [Console]::Error.WriteLine(\"to-err\"); exit 3",
        ),
      }),
    );
    expect(result).toContain("to-out");
    expect(result).toContain("to-err");
    expect(result).toContain("Command exited with status 3");
  });

  test("runs commands in the configured cwd", async () => {
    writeFixture(tmp, "marker.txt", "x");
    const tool = createBashTool({ cwd: tmp });
    const result = await tool.execute(JSON.stringify({
      command: shellCommand("ls", "Get-ChildItem -Name"),
    }));
    expect(result).toContain("marker.txt");
  });

  test("rm via shell actually deletes the file", async () => {
    const path = writeFixture(tmp, "to-delete.txt", "bye");
    const tool = createBashTool({ cwd: tmp });
    const result = await tool.execute(
      JSON.stringify({
        command: shellCommand("rm to-delete.txt", "Remove-Item -LiteralPath \"to-delete.txt\""),
      }),
    );
    expect(result).toBe("");
    expect(existsSync(path)).toBe(false);
  });

  test("respects per-command timeout (returns error string, no throw)", async () => {
    const fast = createBashTool({ timeoutMs: 50 });
    const result = await fast.execute(JSON.stringify({
      command: shellCommand("sleep 1", "Start-Sleep -Seconds 1"),
    }));
    expect(result).toContain("Command timed out after 50ms");
  });

  test("handles pipes and chained commands", async () => {
    const result = await bashTool.execute(
      JSON.stringify({
        command: shellCommand(
          "printf 'a\\nb\\nc\\n' | wc -l | tr -d ' '",
          "\"a\", \"b\", \"c\" | Measure-Object | ForEach-Object { $_.Count }",
        ),
      }),
    );
    expect(result.trim()).toBe("3");
  });

  test("works for the cwd join path", () => {
    // Sanity-check the join helper used elsewhere — keeps the imports honest.
    expect(join(tmp, "x")).toContain(tmp);
  });

  test("returns parse and validation errors instead of throwing", async () => {
    expect(await bashTool.execute("not json")).toContain(
      "Error parsing Bash arguments",
    );
    expect(await bashTool.execute(JSON.stringify({ command: 42 }))).toContain(
      '"command" must be a string',
    );
  });

  test("reports non-zero exit status even when output is empty", async () => {
    const result = await bashTool.execute(JSON.stringify({ command: "exit 7" }));
    expect(result).toContain("Command exited with status 7");
  });

  test("truncates large output with an explicit marker", async () => {
    const tool = createBashTool({ maxOutputBytes: 5 });
    const result = await tool.execute(
      JSON.stringify({
        command: shellCommand("printf 'hello world'", "[Console]::Out.Write(\"hello world\")"),
      }),
    );
    expect(result).toContain("hello");
    expect(result).toContain("output truncated");
  });
});

function shellCommand(posix: string, windows: string): string {
  return isWindows() ? windows : posix;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
