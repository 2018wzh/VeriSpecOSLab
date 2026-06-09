import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { formatError } from "../tools/common.ts";
import type { McpServerConfig } from "../plugins/manifest.ts";

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const DEFAULT_CLOSE_TIMEOUT_MS = 1_000;

export class McpStdioClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private closed = false;
  private processClosed = false;

  constructor(
    private readonly server: McpServerConfig,
    private readonly requestTimeoutMs = 10_000,
  ) {
    this.process = spawn(server.command, server.args ?? [], {
      cwd: server.cwd,
      env: { ...process.env, ...(server.env ?? {}) },
      stdio: "pipe",
    });
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
      this.onStdout(String(chunk));
    });
    this.process.stderr.on("data", (chunk) => {
      this.stderrBuffer += String(chunk);
    });
    this.process.on("error", (error) => {
      this.rejectAll(new Error(`MCP server "${server.name}" failed: ${formatError(error)}`));
    });
    this.process.on("exit", (code, signal) => {
      if (this.closed) return;
      this.rejectAll(new Error(
        `MCP server "${server.name}" exited${code !== null ? ` with status ${code}` : ""}${signal ? ` by signal ${signal}` : ""}${this.stderrBuffer ? `: ${this.stderrBuffer.trim()}` : ""}`,
      ));
    });
    this.process.on("close", () => {
      this.processClosed = true;
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vos-agent", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request("tools/list", {});
    if (!result || typeof result !== "object" || !Array.isArray((result as { tools?: unknown }).tools)) {
      throw new Error(`MCP server "${this.server.name}" returned invalid tools/list result`);
    }
    return (result as { tools: unknown[] }).tools.map((tool, index) =>
      validateToolDefinition(this.server.name, tool, index)
    );
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return await this.request("tools/call", { name, arguments: args });
  }

  async close(timeoutMs = DEFAULT_CLOSE_TIMEOUT_MS): Promise<void> {
    this.closed = true;
    this.rejectAll(new Error(`MCP server "${this.server.name}" closed`));
    if (this.processClosed) return;
    try {
      this.process.stdin.end();
    } catch {
      // Ignore close-time stream errors; the process is being torn down.
    }
    this.kill("SIGTERM");
    if (await this.waitForClose(timeoutMs)) return;
    this.kill("SIGKILL");
    await this.waitForClose(Math.min(timeoutMs, DEFAULT_CLOSE_TIMEOUT_MS));
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP server "${this.server.name}" request "${method}" timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new Error(`Error writing to MCP server "${this.server.name}": ${formatError(error)}`));
      });
    });
  }

  private notify(method: string, params: unknown): void {
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      this.onMessage(line);
    }
  }

  private onMessage(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch (e) {
      this.rejectAll(new Error(`MCP server "${this.server.name}" sent invalid JSON: ${formatError(e)}`));
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(
        `MCP server "${this.server.name}" error: ${message.error.message ?? JSON.stringify(message.error)}`,
      ));
      return;
    }
    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private kill(signal: NodeJS.Signals): void {
    if (this.processClosed) return;
    try {
      this.process.kill(signal);
    } catch {
      // The process may already be gone between the closed check and kill.
    }
  }

  private waitForClose(timeoutMs: number): Promise<boolean> {
    if (this.processClosed) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onClose = () => {
        cleanup();
        resolve(true);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.process.off("close", onClose);
      };
      this.process.once("close", onClose);
    });
  }
}

function validateToolDefinition(
  serverName: string,
  value: unknown,
  index: number,
): McpToolDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`MCP server "${serverName}" tools[${index}] must be an object`);
  }
  const raw = value as { name?: unknown; description?: unknown; inputSchema?: unknown };
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    throw new Error(`MCP server "${serverName}" tools[${index}].name must be a non-empty string`);
  }
  return {
    name: raw.name,
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    ...(raw.inputSchema !== undefined ? { inputSchema: raw.inputSchema } : {}),
  };
}
