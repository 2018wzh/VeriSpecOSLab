import { resolve } from "node:path";
import type { ToolPolicy } from "./tools/types.ts";
import { loadConfig } from "./config.ts";
import { resolveActiveModelSettings } from "./resolve-model.ts";
import { runSessionTurn, type RunSessionTurnOptions } from "./session/run-turn.ts";
import { createThreadStore } from "./session/thread-store.ts";
import { createChatClientFromConfig } from "./llm/providers.ts";
import { loadSettings } from "./settings.ts";
import type { SessionEvent } from "./session/types.ts";
import type { Config } from "./config.ts";
import { serveAgentHttp } from "./server/http.ts";

export interface HeadlessAgentOptions {
  projectRoot: string;
  prompt: string;
  model?: string;
  mode?: string;
  threadId?: string;
  maxIterations?: number;
  disabledTools?: readonly string[];
  courseMode?: boolean;
  allowedVosCommands?: readonly string[];
  toolPolicy?: ToolPolicy;
  env?: Record<string, string | undefined>;
  onEvent?: (event: SessionEvent) => void | Promise<void>;
}

export interface HeadlessAgentResult {
  content: string | null;
  events: SessionEvent[];
}

export interface AgentHttpPackageServerOptions {
  projectRoot: string;
  host?: string;
  port?: number;
  env?: Record<string, string | undefined>;
}

export interface AgentHttpPackageServerResult {
  server: Bun.Server<undefined>;
  host: string;
  port: number;
  url: string;
}

export type { Config, SessionEvent, ToolPolicy };

export async function runHeadlessAgentPrompt(
  options: HeadlessAgentOptions,
): Promise<HeadlessAgentResult> {
  const workspaceRoot = resolve(options.projectRoot);
  const settings = loadSettings({ workspaceRoot, env: options.env ?? process.env });
  const config = loadConfig(options.env ?? process.env, settings);
  const chat = createChatClientFromConfig(config);
  const modelSettings = options.model
    ? { model: options.model, mode: options.mode }
    : resolveActiveModelSettings(config, {
      model: undefined,
      mode: options.mode,
    });

  const store = createThreadStore({ workspaceRoot });
  const events: SessionEvent[] = [];
  const runOptions: RunSessionTurnOptions = {
    chat,
    store,
    workspaceRoot,
    prompt: options.prompt,
    model: modelSettings.model,
    mode: modelSettings.mode,
    reasoningEffort: modelSettings.reasoningEffort,
    disabledTools: options.disabledTools,
    threadId: options.threadId,
    maxIterations: options.maxIterations,
    courseMode: options.courseMode,
    allowedVosCommands: options.allowedVosCommands,
    toolPolicy: options.toolPolicy,
    startDir: workspaceRoot,
    onEvent: async (event) => {
      events.push(event);
      await options.onEvent?.(event);
    },
  };

  const result = await runSessionTurn(runOptions);
  return {
    content: result.content,
    events,
  };
}

export function startAgentHttpServer(
  options: AgentHttpPackageServerOptions,
): AgentHttpPackageServerResult {
  const workspaceRoot = resolve(options.projectRoot);
  const env = options.env ?? process.env;
  const settings = loadSettings({ workspaceRoot, env });
  const config = loadConfig(env, settings);
  const chat = createChatClientFromConfig(config);
  const store = createThreadStore({ workspaceRoot });
  const host = options.host ?? env.VOS_AGENT_HOST ?? "127.0.0.1";
  const port = options.port ?? readPortEnv(env.VOS_AGENT_PORT) ?? 8787;
  const server = serveAgentHttp({ chat, config, store, workspaceRoot, host, port });

  return {
    server,
    host: server.hostname,
    port: server.port,
    url: `http://${server.hostname}:${server.port}`,
  };
}

function readPortEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("VOS_AGENT_PORT must be a TCP port from 1 to 65535");
  }
  return parsed;
}
