import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("vos-cli progress MCP server", () => {
  test("lists and calls report_progress", async () => {
    const proc = spawnSync(process.execPath, [
      join(import.meta.dir, "..", "app", "main.ts"),
      "internal",
      "progress-mcp",
    ], {
      input: [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "report_progress",
            arguments: {
              stage: "agent",
              status: "running",
              message: "reading context",
              percent: 25,
            },
          },
        }),
        "",
      ].join("\n"),
      encoding: "utf8",
    });

    const stdout = proc.stdout;
    const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[1].result.tools[0].name).toBe("report_progress");
    expect(lines[2].result.content[0].text).toContain("\"vos-progress\"");
  });

  test("returns validation errors as MCP tool results", async () => {
    const proc = spawnSync(process.execPath, [
      join(import.meta.dir, "..", "app", "main.ts"),
      "internal",
      "progress-mcp",
    ], {
      input: `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "report_progress", arguments: { stage: "agent" } },
      })}\n`,
      encoding: "utf8",
    });

    const stdout = proc.stdout;
    const line = JSON.parse(stdout.trim());
    expect(line.result.isError).toBe(true);
    expect(line.result.content[0].text).toContain("status is invalid");
  });
});
