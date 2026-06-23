import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("QEMU monitor MCP server", () => {
  test("lists monitor tools", () => {
    const proc = spawnSync(process.execPath, [
      join(import.meta.dir, "..", "..", "app", "main.ts"),
      "internal",
      "qemu-monitor-mcp",
    ], {
      input: [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        "",
      ].join("\n"),
      encoding: "utf8",
    });

    const lines = proc.stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[1].result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "qmp_query",
      "hmp_info",
    ]);
  });

  test("rejects non-readonly QMP and HMP commands as tool errors", () => {
    const proc = spawnSync(process.execPath, [
      join(import.meta.dir, "..", "..", "app", "main.ts"),
      "internal",
      "qemu-monitor-mcp",
    ], {
      input: [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "qmp_query",
            arguments: { endpoint: "unix:/tmp/qmp.sock", command: "system_reset" },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "hmp_info",
            arguments: { endpoint: "tcp:127.0.0.1:4444", command: "cont" },
          },
        }),
        "",
      ].join("\n"),
      encoding: "utf8",
    });

    const lines = proc.stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0].result.isError).toBe(true);
    expect(lines[0].result.content[0].text).toContain("readonly");
    expect(lines[1].result.isError).toBe(true);
    expect(lines[1].result.content[0].text).toContain("readonly");
  });
});
