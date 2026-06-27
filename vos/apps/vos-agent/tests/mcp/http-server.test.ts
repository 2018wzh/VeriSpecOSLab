import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

describe("HTTP server MCP server", () => {
  test("lists publish_html", () => {
    const lines = callHttpServerMcp([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]);

    expect(lines[1].result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "publish_html",
    ]);
  });

  test("publishes HTML and serves it from localhost", async () => {
    const html = "<!doctype html><html><body><h1>Memory Map</h1></body></html>";
    const mcp = startHttpServerMcp();
    try {
      const line = await mcp.call({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "publish_html", arguments: { title: "Memory Map", html } },
      });

      expect(line.result.isError).toBe(false);
      const published = JSON.parse(line.result.content[0].text) as {
        id: string;
        url: string;
        title: string;
      };
      expect(published.id).toMatch(/^viz-/);
      expect(published.url).toStartWith("http://127.0.0.1:");
      expect(published.title).toBe("Memory Map");
      expect(await fetch(published.url).then((response) => response.text())).toBe(html);
    } finally {
      await mcp.close();
    }
  });

  test("rejects empty and oversized HTML", () => {
    const lines = callHttpServerMcp([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "publish_html", arguments: { html: "" } },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "publish_html", arguments: { html: "x".repeat(1_000_001) } },
      },
    ]);

    expect(lines[0].result.isError).toBe(true);
    expect(lines[0].result.content[0].text).toContain("html is required");
    expect(lines[1].result.isError).toBe(true);
    expect(lines[1].result.content[0].text).toContain("html exceeds");
  });
});

function callHttpServerMcp(messages: unknown[]): Array<any> {
  const proc = spawnSync(process.execPath, [
    join(import.meta.dir, "..", "..", "app", "main.ts"),
    "internal",
    "http-server-mcp",
  ], {
    input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    encoding: "utf8",
  });
  expect(proc.stderr).toBe("");
  return proc.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function startHttpServerMcp(): {
  call(message: Record<string, unknown>): Promise<any>;
  close(): Promise<void>;
} {
  const proc = spawn(process.execPath, [
    join(import.meta.dir, "..", "..", "app", "main.ts"),
    "internal",
    "http-server-mcp",
  ], {
    stdio: "pipe",
  });
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  const waiters: Array<(value: any) => void> = [];
  proc.stdout.on("data", (chunk) => {
    stdout += String(chunk);
    while (true) {
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (!line) continue;
      waiters.shift()?.(JSON.parse(line));
    }
  });
  proc.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  return {
    call(message) {
      proc.stdin.write(`${JSON.stringify(message)}\n`);
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    close() {
      proc.stdin.end();
      proc.kill("SIGTERM");
      return new Promise((resolve) => {
        proc.once("close", () => {
          expect(stderr).toBe("");
          resolve();
        });
      });
    },
  };
}
