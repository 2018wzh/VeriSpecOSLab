#!/usr/bin/env bun
import { createInterface } from "node:readline";
import { z } from "zod";
import {
  addKbSource,
  clearKbSources,
  createOpenAICompatibleEmbedder,
  listKbSources,
  lookupKb,
  removeKbSource,
  searchKb,
  type KbEmbedder,
  type KbSourceKind,
} from "./index.ts";

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

const sourceKindSchema = z.enum(["course", "project", "external"]);
const searchSchema = z.object({ query: z.string(), stage_key: z.string().optional(), limit: z.number().optional() });
const lookupSchema = z.object({ id: z.string() });
const addSchema = z.object({
  uri: z.string(),
  source_kind: sourceKindSchema,
  stage_key: z.string().optional(),
  title: z.string().optional(),
  recursive: z.boolean().optional(),
  branch: z.string().optional(),
  tag: z.string().optional(),
});
const listSchema = z.object({ source_kind: sourceKindSchema.optional(), stage_key: z.string().optional() }).optional();
const idSchema = z.object({ id: z.string() });

export async function runKbMcpServer(options: { projectRoot?: string } = {}): Promise<void> {
  const projectRoot = options.projectRoot ?? process.env.VOS_PROJECT_ROOT ?? process.cwd();
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      await handleMessage(JSON.parse(line) as JsonRpcMessage, projectRoot);
    } catch {
      // Ignore malformed notifications; request parse errors are handled below when possible.
    }
  }
}

async function handleMessage(message: JsonRpcMessage, projectRoot: string): Promise<void> {
  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "vos-kb", version: "0.1.0" },
    });
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") {
    respond(message.id, { tools: toolDefinitions() });
    return;
  }
  if (message.method === "tools/call") {
    const result = await callTool(projectRoot, message.params);
    respond(message.id, {
      content: [{ type: "text", text: result.text }],
      isError: result.isError,
    });
    return;
  }
  if (message.id !== undefined) respondError(message.id, -32601, "unknown method");
}

async function callTool(projectRoot: string, params: unknown): Promise<{ text: string; isError: boolean }> {
  const raw = params && typeof params === "object" && !Array.isArray(params)
    ? params as { name?: unknown; arguments?: unknown }
    : {};
  try {
    if (raw.name === "kb_search") {
      const args = searchSchema.parse(raw.arguments);
      return ok(await searchKb(projectRoot, args.query, { stage: args.stage_key, limit: args.limit, embedder: embedderFromEnv() }));
    }
    if (raw.name === "kb_lookup") {
      const args = lookupSchema.parse(raw.arguments);
      return ok(await lookupKb(projectRoot, args.id));
    }
    if (raw.name === "kb_add_source") {
      const args = addSchema.parse(raw.arguments);
      return ok(await addKbSource(projectRoot, {
        source: args.uri,
        sourceKind: args.source_kind as KbSourceKind,
        stage: args.stage_key,
        title: args.title,
        recursive: args.recursive,
        branch: args.branch,
        tag: args.tag,
      }, { embedder: embedderFromEnv() }));
    }
    if (raw.name === "kb_list_sources") {
      const args = listSchema.parse(raw.arguments);
      return ok(await listKbSources(projectRoot, { sourceKind: args?.source_kind, stage: args?.stage_key }));
    }
    if (raw.name === "kb_remove_source") {
      const args = idSchema.parse(raw.arguments);
      return ok({ removed: await removeKbSource(projectRoot, args.id) });
    }
    if (raw.name === "kb_clear") {
      await clearKbSources(projectRoot);
      return ok({ cleared: true });
    }
    return { text: `Error validating vos-kb tool arguments: unknown tool ${String(raw.name)}`, isError: true };
  } catch (error) {
    return { text: `Error validating vos-kb tool arguments: ${error instanceof Error ? error.message : String(error)}`, isError: true };
  }
}

function embedderFromEnv(): KbEmbedder {
  const baseUrl = process.env.VOS_KB_EMBEDDING_BASE_URL;
  const model = process.env.VOS_KB_EMBEDDING_MODEL;
  const apiKey = process.env.VOS_KB_EMBEDDING_API_KEY;
  if (!baseUrl || !model || !apiKey) {
    throw new Error("KB embedding provider is not configured");
  }
  return createOpenAICompatibleEmbedder({ baseUrl, model, apiKey });
}

function toolDefinitions(): Array<Record<string, unknown>> {
  return [
    { name: "kb_search", description: "Search VOS knowledge base sources.", inputSchema: { type: "object", properties: { query: { type: "string" }, stage_key: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
    { name: "kb_lookup", description: "Lookup a KB chunk or source by id.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "kb_add_source", description: "Add a KB source.", inputSchema: { type: "object", properties: { uri: { type: "string" }, source_kind: { type: "string", enum: ["course", "project", "external"] }, stage_key: { type: "string" }, title: { type: "string" }, recursive: { type: "boolean" }, branch: { type: "string" }, tag: { type: "string" } }, required: ["uri", "source_kind"] } },
    { name: "kb_list_sources", description: "List KB sources.", inputSchema: { type: "object", properties: { source_kind: { type: "string", enum: ["course", "project", "external"] }, stage_key: { type: "string" } }, required: [] } },
    { name: "kb_remove_source", description: "Remove a KB source.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "kb_clear", description: "Clear the project KB.", inputSchema: { type: "object", properties: {}, required: [] } },
  ];
}

function ok(value: unknown): { text: string; isError: boolean } {
  return { text: JSON.stringify(value), isError: false };
}

function respond(idValue: JsonRpcMessage["id"], result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: idValue, result })}\n`);
}

function respondError(idValue: JsonRpcMessage["id"], code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: idValue, error: { code, message } })}\n`);
}

if (import.meta.main) {
  await runKbMcpServer();
}
