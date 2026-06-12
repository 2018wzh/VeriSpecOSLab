import type OpenAI from "openai";
import { createHash } from "node:crypto";
import { DEFAULT_TOOL_OUTPUT_MAX_BYTES, formatError, parseToolArguments, truncateUtf8 } from "../tools/common.ts";
import type { Tool } from "../tools/types.ts";
import type { McpServerConfig } from "../plugins/manifest.ts";
import { McpStdioClient, type McpToolDefinition } from "./client.ts";

const MAX_PROVIDER_TOOL_NAME_LENGTH = 64;

export interface McpToolProvider {
  tools: Tool[];
  serverNames: string[];
  close(): Promise<void>;
}

export interface CreateMcpToolProviderOptions {
  servers: readonly McpServerConfig[];
  requestTimeoutMs?: number;
  maxOutputBytes?: number;
}

interface ActiveMcpServer {
  name: string;
  client: McpStdioClient;
}

export async function createMcpToolProvider(
  opts: CreateMcpToolProviderOptions,
): Promise<McpToolProvider> {
  const activeServers: ActiveMcpServer[] = [];
  const tools: Tool[] = [];
  const seenToolNames = new Set<string>();
  try {
    for (const server of opts.servers) {
      const client = new McpStdioClient(server, opts.requestTimeoutMs);
      activeServers.push({ name: server.name, client });
      await client.initialize();
      const serverTools = await client.listTools();
      for (const mcpTool of serverTools) {
        const tool = createMcpTool({
          server,
          client,
          tool: mcpTool,
          maxOutputBytes: opts.maxOutputBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES,
        });
        if (seenToolNames.has(tool.name)) {
          throw new Error(`duplicate MCP tool name after namespacing: ${tool.name}`);
        }
        seenToolNames.add(tool.name);
        tools.push(tool);
      }
    }
  } catch (e) {
    await closeServers(activeServers);
    throw e;
  }
  return {
    tools,
    serverNames: activeServers.map((server) => server.name),
    async close() {
      await closeServers(activeServers);
    },
  };
}

function createMcpTool(opts: {
  server: McpServerConfig;
  client: McpStdioClient;
  tool: McpToolDefinition;
  maxOutputBytes: number;
}): Tool {
  const name = namespacedToolName(opts.server.name, opts.tool.name);
  return {
    name,
    schema: {
      type: "function",
      function: {
        name,
        description: `[MCP ${opts.server.name}] ${opts.tool.description ?? opts.tool.name}`,
        parameters: normalizeInputSchema(opts.tool.inputSchema),
      },
    },
    async execute(argumentsJson: string): Promise<string> {
      const parsed = parseToolArguments(name, argumentsJson);
      if (!parsed.ok) return parsed.error;
      try {
        const result = await opts.client.callTool(opts.tool.name, parsed.args);
        return truncateUtf8(formatMcpToolResult(result), opts.maxOutputBytes, "MCP output");
      } catch (e) {
        return `Error calling MCP tool "${name}": ${formatError(e)}`;
      }
    },
  };
}

function namespacedToolName(serverName: string, toolName: string): string {
  const name = `mcp__${sanitizeToolName(serverName)}__${sanitizeToolName(toolName)}`;
  if (name.length <= MAX_PROVIDER_TOOL_NAME_LENGTH) return name;
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  const prefixLength = MAX_PROVIDER_TOOL_NAME_LENGTH - hash.length - 2;
  return `${name.slice(0, prefixLength)}__${hash}`;
}

function sanitizeToolName(name: string): string {
  const sanitized = name.trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "tool";
}

function normalizeInputSchema(schema: unknown): OpenAI.Chat.ChatCompletionFunctionTool["function"]["parameters"] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {}, required: [] };
  }
  const raw = schema as Record<string, unknown>;
  if (raw.type !== "object") {
    return withDefaultRequired({
      ...raw,
      type: "object",
    }) as OpenAI.Chat.ChatCompletionFunctionTool["function"]["parameters"];
  }
  return withDefaultRequired(raw) as OpenAI.Chat.ChatCompletionFunctionTool["function"]["parameters"];
}

function withDefaultRequired(schema: Record<string, unknown>): Record<string, unknown> {
  return Array.isArray(schema.required)
    ? schema
    : { ...schema, required: [] };
}

function formatMcpToolResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return stringifyUnknown(result);
  }
  const raw = result as { content?: unknown; isError?: unknown };
  if (!Array.isArray(raw.content)) {
    return stringifyUnknown(result);
  }
  const text = raw.content.map(formatContentBlock).join("\n");
  if (raw.isError === true) {
    return text ? `${text}\n[MCP tool returned error]` : "[MCP tool returned error]";
  }
  return text;
}

function formatContentBlock(block: unknown): string {
  if (block && typeof block === "object") {
    const raw = block as { type?: unknown; text?: unknown };
    if (raw.type === "text" && typeof raw.text === "string") {
      return raw.text;
    }
  }
  return stringifyUnknown(block);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

async function closeServers(servers: readonly ActiveMcpServer[]): Promise<void> {
  for (const server of servers) {
    await server.client.close();
  }
}
