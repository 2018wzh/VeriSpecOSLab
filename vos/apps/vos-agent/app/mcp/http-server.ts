import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const TOOL_NAME = "publish_html";
const MAX_HTML_BYTES = 1_000_000;

interface JsonRpcMessage {
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

interface PublishedHtml {
  title: string;
  html: string;
}

export async function runHttpServerMcpServer(): Promise<void> {
  const published = new Map<string, PublishedHtml>();
  let server: Bun.Server<undefined> | undefined;
  const ensureServer = () => {
    server ??= Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const id = new URL(request.url).pathname.replace(/^\/+/, "");
        const page = published.get(id);
        if (!page) return new Response("not found", { status: 404 });
        return new Response(page.html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-vos-visualization-title": page.title,
          },
        });
      },
    });
    return server;
  };

  try {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        continue;
      }
      await handleMessage(message, published, ensureServer);
    }
  } finally {
    server?.stop(true);
  }
}

async function handleMessage(
  message: JsonRpcMessage,
  published: Map<string, PublishedHtml>,
  ensureServer: () => Bun.Server<undefined>,
): Promise<void> {
  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "http-server", version: "0.1.0" },
    });
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: TOOL_NAME,
        description: "Publish self-contained HTML and return a local URL for viewing it.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            html: { type: "string" },
          },
          required: ["html"],
        },
      }],
    });
    return;
  }
  if (message.method === "tools/call") {
    const result = handleToolCall(message.params, published, ensureServer);
    respond(message.id, { content: [{ type: "text", text: result.text }], isError: !result.ok });
    return;
  }
  if (message.id !== undefined) respondError(message.id, -32601, "unknown method");
}

function handleToolCall(
  params: unknown,
  published: Map<string, PublishedHtml>,
  ensureServer: () => Bun.Server<undefined>,
): { ok: boolean; text: string } {
  if (!params || typeof params !== "object" || Array.isArray(params)) return error("params must be an object");
  const raw = params as { name?: unknown; arguments?: unknown };
  if (raw.name !== TOOL_NAME) return error(`unknown tool ${String(raw.name)}`);
  const args = raw.arguments && typeof raw.arguments === "object" && !Array.isArray(raw.arguments)
    ? raw.arguments as Record<string, unknown>
    : {};
  const html = typeof args.html === "string" ? args.html : "";
  if (!html.trim()) return error("html is required");
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
    return error(`html exceeds ${MAX_HTML_BYTES} bytes`);
  }
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "Visualization";
  const id = `viz-${randomUUID()}`;
  published.set(id, { title, html });
  const server = ensureServer();
  return ok(JSON.stringify({ id, url: `http://127.0.0.1:${server.port}/${id}`, title }, null, 2));
}

function ok(text: string): { ok: true; text: string } {
  return { ok: true, text };
}

function error(text: string): { ok: false; text: string } {
  return { ok: false, text };
}

function respond(id: JsonRpcMessage["id"], result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id: JsonRpcMessage["id"], code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}
