import { createInterface } from "node:readline";
import type { ProgressStatus, ProgressUpdate } from "./types.ts";

const TOOL_NAME = "report_progress";
const STATUSES = new Set<ProgressStatus>([
  "starting",
  "running",
  "blocked",
  "completed",
  "failed",
]);

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

export async function runProgressMcpServer(): Promise<void> {
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
      serverInfo: { name: "vos-progress", version: "0.1.0" },
    });
    return;
  }
  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [{
        name: TOOL_NAME,
        description: "Report concise task progress to the VOS CLI progress UI.",
        inputSchema: {
          type: "object",
          properties: {
            stage: { type: "string" },
            phase: { type: "string" },
            step: { type: "string" },
            current: { type: "number" },
            total: { type: "number" },
            percent: { type: "number", minimum: 0, maximum: 100 },
            status: {
              type: "string",
              enum: ["starting", "running", "blocked", "completed", "failed"],
            },
            message: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["stage", "status", "message"],
        },
      }],
    });
    return;
  }
  if (message.method === "tools/call") {
    const result = handleToolCall(message.params);
    respond(message.id, {
      content: [{ type: "text", text: result }],
      isError: result.startsWith("Error "),
    });
    return;
  }
  if (message.id !== undefined) {
    respondError(message.id, -32601, "unknown method");
  }
}

function handleToolCall(params: unknown): string {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return "Error validating report_progress arguments: params must be an object";
  }
  const raw = params as { name?: unknown; arguments?: unknown };
  if (raw.name !== TOOL_NAME) {
    return `Error validating report_progress arguments: unknown tool ${String(raw.name)}`;
  }
  const parsed = parseProgressUpdate(raw.arguments);
  if (!parsed.ok) return parsed.error;
  return JSON.stringify({ type: "vos-progress", progress: parsed.value });
}

function parseProgressUpdate(value: unknown): { ok: true; value: ProgressUpdate } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Error validating report_progress arguments: arguments must be an object" };
  }
  const raw = value as Record<string, unknown>;
  const stage = stringField(raw, "stage");
  const status = stringField(raw, "status");
  const message = stringField(raw, "message");
  if (!stage) return { ok: false, error: "Error validating report_progress arguments: stage is required" };
  if (!status || !STATUSES.has(status as ProgressStatus)) {
    return { ok: false, error: "Error validating report_progress arguments: status is invalid" };
  }
  if (!message) return { ok: false, error: "Error validating report_progress arguments: message is required" };

  const update: ProgressUpdate = {
    stage,
    status: status as ProgressStatus,
    message,
  };
  copyOptionalString(raw, update, "phase");
  copyOptionalString(raw, update, "step");
  copyOptionalNumber(raw, update, "current");
  copyOptionalNumber(raw, update, "total");
  copyOptionalNumber(raw, update, "percent");
  copyOptionalNumber(raw, update, "confidence");
  return { ok: true, value: update };
}

function stringField(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function copyOptionalString(raw: Record<string, unknown>, out: ProgressUpdate, key: keyof ProgressUpdate): void {
  const value = stringField(raw, key);
  if (!value) return;
  if (key === "phase") out.phase = value;
  if (key === "step") out.step = value;
}

function copyOptionalNumber(raw: Record<string, unknown>, out: ProgressUpdate, key: keyof ProgressUpdate): void {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  if (key === "current") out.current = value;
  if (key === "total") out.total = value;
  if (key === "percent") out.percent = value;
  if (key === "confidence") out.confidence = value;
}

function respond(id: JsonRpcMessage["id"], result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id: JsonRpcMessage["id"], code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}
