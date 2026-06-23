import { createInterface } from "node:readline";
import { createConnection, type Socket } from "node:net";

const QMP_TOOL = "qmp_query";
const HMP_TOOL = "hmp_info";
const TIMEOUT_MS = 2_000;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

export async function runQemuMonitorMcpServer(): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      continue;
    }
    await handleMessage(message);
  }
}

async function handleMessage(message: JsonRpcMessage): Promise<void> {
  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "qemu-monitor", version: "0.1.0" },
    });
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [
        {
          name: QMP_TOOL,
          description: "Run a read-only QMP query-* command against a QEMU monitor endpoint.",
          inputSchema: {
            type: "object",
            properties: {
              endpoint: { type: "string", description: "unix:/path.sock or tcp:host:port" },
              command: { type: "string", description: "QMP query-* command, for example query-status" },
              arguments: { type: "object" },
            },
            required: ["endpoint", "command"],
          },
        },
        {
          name: HMP_TOOL,
          description: "Run a read-only HMP info/x/xp command against a QEMU monitor endpoint.",
          inputSchema: {
            type: "object",
            properties: {
              endpoint: { type: "string", description: "unix:/path.sock or tcp:host:port" },
              command: { type: "string", description: "HMP readonly command, for example info registers" },
            },
            required: ["endpoint", "command"],
          },
        },
      ],
    });
    return;
  }
  if (message.method === "tools/call") {
    const result = await handleToolCall(message.params);
    respond(message.id, {
      content: [{ type: "text", text: result.text }],
      isError: !result.ok,
    });
    return;
  }
  if (message.id !== undefined) respondError(message.id, -32601, "unknown method");
}

async function handleToolCall(params: unknown): Promise<{ ok: boolean; text: string }> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return error("params must be an object");
  }
  const raw = params as { name?: unknown; arguments?: unknown };
  if (raw.name === QMP_TOOL) return runQmpTool(raw.arguments);
  if (raw.name === HMP_TOOL) return runHmpTool(raw.arguments);
  return error(`unknown tool ${String(raw.name)}`);
}

async function runQmpTool(value: unknown): Promise<{ ok: boolean; text: string }> {
  const args = parseArgs(value);
  if (!args.ok) return args;
  if (!args.command.startsWith("query-")) {
    return error(`QMP command "${args.command}" is not readonly; only query-* commands are allowed`);
  }
  try {
    const socket = await connectEndpoint(args.endpoint);
    const messages = await readQmpGreeting(socket);
    socket.write(`${JSON.stringify({ execute: "qmp_capabilities" })}\n`);
    messages.push(...await readQmpUntil(socket, (item) => "return" in item));
    socket.write(`${JSON.stringify({
      execute: args.command,
      ...(isPlainObject(args.arguments) ? { arguments: args.arguments } : {}),
    })}\n`);
    messages.push(...await readQmpUntil(socket, (item) => "return" in item || "error" in item));
    socket.end();
    return ok(JSON.stringify({ endpoint: args.endpoint, command: args.command, messages }, null, 2));
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e));
  }
}

async function runHmpTool(value: unknown): Promise<{ ok: boolean; text: string }> {
  const args = parseArgs(value);
  if (!args.ok) return args;
  if (!isReadonlyHmp(args.command)) {
    return error(`HMP command "${args.command}" is not readonly`);
  }
  try {
    const socket = await connectEndpoint(args.endpoint);
    const out = await writeAndCollect(socket, `${args.command}\n`);
    socket.end();
    return ok(JSON.stringify({ endpoint: args.endpoint, command: args.command, output: out.trim() }, null, 2));
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e));
  }
}

function parseArgs(value: unknown): { ok: true; endpoint: string; command: string; arguments?: unknown } | { ok: false; text: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return error("arguments must be an object");
  const raw = value as Record<string, unknown>;
  if (typeof raw.endpoint !== "string" || raw.endpoint.length === 0) return error("endpoint is required");
  if (typeof raw.command !== "string" || raw.command.length === 0) return error("command is required");
  return { ok: true, endpoint: raw.endpoint, command: raw.command.trim(), arguments: raw.arguments };
}

function isReadonlyHmp(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return normalized.startsWith("info ") || normalized === "info" || /^x(p)?(\/|\s)/.test(normalized);
}

function connectEndpoint(endpoint: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = endpoint.startsWith("unix:")
      ? createConnection({ path: endpoint.slice("unix:".length) })
      : endpoint.startsWith("tcp:")
        ? createTcpConnection(endpoint)
        : undefined;
    if (!socket) {
      reject(new Error(`unsupported endpoint ${endpoint}; use unix:/path.sock or tcp:host:port`));
      return;
    }
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timeout connecting to ${endpoint}`));
    }, TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function createTcpConnection(endpoint: string): Socket {
  const rest = endpoint.slice("tcp:".length);
  const split = rest.lastIndexOf(":");
  if (split <= 0) throw new Error(`invalid tcp endpoint ${endpoint}`);
  return createConnection({ host: rest.slice(0, split), port: Number(rest.slice(split + 1)) });
}

function readQmpGreeting(socket: Socket): Promise<Record<string, unknown>[]> {
  return readQmpUntil(socket, (item) => "QMP" in item);
}

function readQmpUntil(socket: Socket, done: (item: Record<string, unknown>) => boolean): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    let buffer = "";
    const timer = setTimeout(() => cleanup(() => reject(new Error("timeout reading QMP response"))), TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const item = JSON.parse(line) as Record<string, unknown>;
        messages.push(item);
        if (done(item)) cleanup(() => resolve(messages));
      }
    };
    const onError = (e: Error) => cleanup(() => reject(e));
    const cleanup = (finish: () => void) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      finish();
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function writeAndCollect(socket: Socket, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => cleanup(() => resolve(out)), TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (out.includes("(qemu)")) cleanup(() => resolve(out));
    };
    const onError = (e: Error) => cleanup(() => reject(e));
    const cleanup = (finish: () => void) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      finish();
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(command);
  });
}

function respond(id: JsonRpcMessage["id"], result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id: JsonRpcMessage["id"], code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function ok(text: string): { ok: true; text: string } {
  return { ok: true, text };
}

function error(text: string): { ok: false; text: string } {
  return { ok: false, text: `Error validating qemu monitor arguments: ${text}` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
