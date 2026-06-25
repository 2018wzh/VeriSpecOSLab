import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

const SPEC_TOOL = "spec_summary";
const EVIDENCE_TOOL = "evidence_summary";
const MAX_BYTES = 16_384;

interface JsonRpcMessage {
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

export async function runProjectContextMcpServer(projectRoot = process.env.VOS_PROJECT_ROOT ?? process.cwd()): Promise<void> {
  const root = resolve(projectRoot);
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      continue;
    }
    await handleMessage(root, message);
  }
}

async function handleMessage(projectRoot: string, message: JsonRpcMessage): Promise<void> {
  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "project-context", version: "0.1.0" },
    });
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [
        {
          name: SPEC_TOOL,
          description: "Read a bounded public spec file or list spec files.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Optional path under spec/" },
            },
            required: [],
          },
        },
        {
          name: EVIDENCE_TOOL,
          description: "List recent public VOS run manifests and artifact refs.",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "integer", description: "Maximum run manifests to return" },
            },
            required: [],
          },
        },
      ],
    });
    return;
  }
  if (message.method === "tools/call") {
    const result = await handleToolCall(projectRoot, message.params);
    respond(message.id, { content: [{ type: "text", text: result.text }], isError: !result.ok });
    return;
  }
  if (message.id !== undefined) respondError(message.id, -32601, "unknown method");
}

async function handleToolCall(projectRoot: string, params: unknown): Promise<{ ok: boolean; text: string }> {
  if (!params || typeof params !== "object" || Array.isArray(params)) return error("params must be an object");
  const raw = params as { name?: unknown; arguments?: unknown };
  if (raw.name === SPEC_TOOL) return readSpec(projectRoot, raw.arguments);
  if (raw.name === EVIDENCE_TOOL) return readEvidence(projectRoot, raw.arguments);
  return error(`unknown tool ${String(raw.name)}`);
}

async function readSpec(projectRoot: string, value: unknown): Promise<{ ok: boolean; text: string }> {
  const args = isRecord(value) ? value : {};
  const specRoot = resolve(projectRoot, "spec");
  const requested = typeof args.path === "string" && args.path.trim()
    ? resolve(projectRoot, args.path)
    : specRoot;
  if (!inside(requested, specRoot)) return error("path is outside spec/");
  if (!existsSync(requested)) return error(`spec path not found: ${relative(projectRoot, requested)}`);
  const info = await stat(requested);
  if (info.isDirectory()) {
    const entries = await listFiles(requested, specRoot);
    return ok(JSON.stringify({ root: "spec", files: entries.slice(0, 200) }, null, 2));
  }
  if (!info.isFile()) return error(`spec path is not a file: ${relative(projectRoot, requested)}`);
  const text = await readFile(requested, "utf8");
  return ok(JSON.stringify({
    path: relative(projectRoot, requested),
    content: truncate(text, MAX_BYTES),
  }, null, 2));
}

async function readEvidence(projectRoot: string, value: unknown): Promise<{ ok: boolean; text: string }> {
  const args = isRecord(value) ? value : {};
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit)
    ? Math.max(1, Math.min(50, Math.floor(args.limit)))
    : 10;
  const runsRoot = resolve(projectRoot, ".vos", "runs");
  if (!existsSync(runsRoot)) return ok(JSON.stringify({ runs: [] }, null, 2));
  const entries = (await readdir(runsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, limit);
  const runs = [];
  for (const name of entries) {
    const manifestPath = resolve(runsRoot, name, "manifest.json");
    if (!inside(manifestPath, runsRoot) || !existsSync(manifestPath)) continue;
    const manifest = safeJson(await readFile(manifestPath, "utf8"));
    runs.push({
      run_id: isRecord(manifest) && typeof manifest.run_id === "string" ? manifest.run_id : name,
      status: isRecord(manifest) && typeof manifest.status === "string" ? manifest.status : "unknown",
      artifacts: isRecord(manifest) && Array.isArray(manifest.artifacts)
        ? manifest.artifacts.slice(0, 20)
        : [],
    });
  }
  return ok(JSON.stringify({ runs }, null, 2));
}

async function listFiles(path: string, root: string): Promise<string[]> {
  const statEntries = await readdir(path, { withFileTypes: true }).catch(() => []);
  if (statEntries.length === 0) return [];
  const out: string[] = [];
  for (const entry of statEntries) {
    const child = resolve(path, entry.name);
    if (!inside(child, root)) continue;
    if (entry.isDirectory()) {
      out.push(...await listFiles(child, root));
    } else if (entry.isFile()) {
      out.push(relative(root, child));
    }
  }
  return out.sort();
}

function inside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.includes("/../"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
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
