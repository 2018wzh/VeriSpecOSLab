import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createMcpToolProvider } from "../../app/mcp/tools.ts";
import type { McpServerConfig } from "../../app/plugins/manifest.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

function fakeMcpServerScript(): string {
  return String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const toolName = process.env.TOOL_NAME || "echo";
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "fake", version: "1.0.0" }
    }});
    return;
  }
  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [{
      name: toolName,
      description: "Echo text",
      inputSchema: process.env.OMIT_REQUIRED ? {
        type: "object",
        properties: { text: { type: "string" } }
      } : {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"]
      }
    }] }});
    return;
  }
  if (message.method === "tools/call") {
    if (message.params.arguments.text === "empty-result") {
      send({ jsonrpc: "2.0", id: message.id });
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, result: {
      content: [{ type: "text", text: "echo:" + message.params.arguments.text }],
      isError: false
    }});
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown method" } });
});
`;
}

function slowExitMcpServerScript(): string {
  return String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
setInterval(() => {}, 1000);
function send(message) { process.stdout.write(JSON.stringify(message) + "\n"); }
process.on("SIGTERM", () => {
  setTimeout(() => {
    fs.writeFileSync(process.env.CLOSE_MARKER, "closed");
    process.exit(0);
  }, 20);
});
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "slow", version: "1.0.0" }
    }});
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [] } });
  }
});
`;
}

describe("MCP tool provider", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir("stars-mcp-");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("adapts MCP tools into Stars tools and calls them", async () => {
    const serverPath = writeFixture(tmp, "fake-mcp.js", fakeMcpServerScript());
    const servers: McpServerConfig[] = [{
      name: "fake",
      command: process.execPath,
      args: [serverPath],
      cwd: tmp,
    }];

    const provider = await createMcpToolProvider({ servers });
    try {
      expect(provider.serverNames).toEqual(["fake"]);
      expect(provider.tools.map((tool) => tool.name)).toEqual(["mcp__fake__echo"]);
      expect(provider.tools[0].schema.function.parameters).toEqual({
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      });
      await expect(provider.tools[0].execute(JSON.stringify({ text: "hello" }))).resolves.toBe(
        "echo:hello",
      );
      await expect(provider.tools[0].execute(JSON.stringify({ text: "empty-result" }))).resolves.toBe(
        "undefined",
      );
    } finally {
      await provider.close();
    }
  });

  test("bounds long MCP tool names and fills missing required schema fields", async () => {
    const serverPath = writeFixture(tmp, "fake-mcp.js", fakeMcpServerScript());
    const servers: McpServerConfig[] = [{
      name: "server".repeat(20),
      command: process.execPath,
      args: [serverPath],
      env: {
        TOOL_NAME: "tool".repeat(20),
        OMIT_REQUIRED: "1",
      },
      cwd: tmp,
    }];

    const provider = await createMcpToolProvider({ servers });
    try {
      expect(provider.tools[0].name.length).toBeLessThanOrEqual(64);
      expect(provider.tools[0].name).toMatch(/^mcp__[A-Za-z0-9_-]+$/);
      expect(provider.tools[0].schema.function.parameters).toEqual({
        type: "object",
        properties: { text: { type: "string" } },
        required: [],
      });
    } finally {
      await provider.close();
    }
  });

  test("waits for MCP subprocesses to close", async () => {
    const serverPath = writeFixture(tmp, "slow-mcp.js", slowExitMcpServerScript());
    const markerPath = join(tmp, "closed.txt");
    const provider = await createMcpToolProvider({
      servers: [{
        name: "slow",
        command: process.execPath,
        args: [serverPath],
        env: { CLOSE_MARKER: markerPath },
        cwd: tmp,
      }],
    });

    await provider.close();

    expect(existsSync(markerPath)).toBe(true);
  });
});
