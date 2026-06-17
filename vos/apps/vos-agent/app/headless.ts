import { resolve } from "node:path";
import type { ToolPolicy } from "./tools/types.ts";
import { loadConfig } from "./config.ts";
import { resolveActiveModelSettings } from "./resolve-model.ts";
import { runSessionTurn, type RunSessionTurnOptions } from "./session/run-turn.ts";
import { createThreadStore } from "./session/thread-store.ts";
import { createChatClientFromConfig } from "./llm/providers.ts";
import { loadSettings } from "./settings.ts";
import type { SessionEvent } from "./session/types.ts";
import type { Config, ReasoningEffort } from "./config.ts";
import { serveAgentHttp } from "./server/http.ts";
import {
  buildAgentTaskSystemPrompt,
  buildAgentTaskUserPrompt,
  createProfileToolPolicy,
  publicAgentTaskProfile,
  resolveAgentTaskProfile as resolveInternalAgentTaskProfile,
  resolveProfileVosCommands,
  type AgentTaskProfile,
  type AgentTaskProfileInput,
} from "./agent/profiles.ts";

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

export interface AgentTaskRequest {
  projectRoot: string;
  task: string;
  taskKind?: string;
  requestedScope?: string;
  agentProfile?: AgentTaskProfileInput;
  context?: unknown;
  contextRefs?: readonly string[];
  evidenceRefs?: readonly string[];
  allowedPaths?: readonly string[];
  requiredValidations?: readonly string[];
  policyFlags?: readonly string[];
  promptOverride?: string;
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

export interface AgentTaskResult {
  content: string | null;
  structuredOutput?: unknown;
  events: SessionEvent[];
  threadId: string;
  agentProfile: AgentTaskProfile;
  model: string;
  mode?: string;
  reasoningEffort?: ReasoningEffort;
  prompt: string;
}

export interface ResolveAgentTaskProfileOptions {
  taskKind?: string;
  agentProfile?: AgentTaskProfileInput;
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
export type { AgentTaskProfile, AgentTaskProfileInput };

export function resolveAgentTaskProfile(
  options: ResolveAgentTaskProfileOptions = {},
): AgentTaskProfile {
  return publicAgentTaskProfile(
    resolveInternalAgentTaskProfile({
      taskKind: options.taskKind,
    }, options.agentProfile),
  );
}

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

export async function runAgentTask(
  options: AgentTaskRequest,
): Promise<AgentTaskResult> {
  const workspaceRoot = resolve(options.projectRoot);
  const env = options.env ?? process.env;
  const settings = loadSettings({ workspaceRoot, env });
  const config = loadConfig(env, settings);
  const chat = createChatClientFromConfig(config);
  const profile = resolveInternalAgentTaskProfile({
    taskKind: options.taskKind,
  }, options.agentProfile);
  const modelSettings = options.model
    ? { model: options.model, mode: options.mode }
    : resolveActiveModelSettings(config, {
      model: undefined,
      mode: options.mode ?? profile.mode,
    });

  const prompt = buildAgentTaskUserPrompt({
    profile,
    task: options.task,
    taskKind: options.taskKind,
    requestedScope: options.requestedScope,
    context: options.context,
    contextRefs: options.contextRefs,
    evidenceRefs: options.evidenceRefs,
    allowedPaths: options.allowedPaths,
    requiredValidations: options.requiredValidations,
    policyFlags: options.policyFlags,
    promptOverride: options.promptOverride,
  });
  const store = createThreadStore({ workspaceRoot });
  const events: SessionEvent[] = [];
  const result = await runSessionTurn({
    chat,
    store,
    workspaceRoot,
    prompt,
    model: modelSettings.model,
    mode: modelSettings.mode,
    reasoningEffort: modelSettings.reasoningEffort,
    disabledTools: mergeDisabledTools(config.tools.disabled, options.disabledTools),
    threadId: options.threadId,
    maxIterations: options.maxIterations,
    courseMode: options.courseMode ?? true,
    allowedVosCommands: resolveProfileVosCommands(profile, options.allowedVosCommands),
    toolPolicy: composeToolPolicies(createProfileToolPolicy(profile), options.toolPolicy),
    startDir: workspaceRoot,
    fixedSystemPrompt: buildAgentTaskSystemPrompt(profile),
    onEvent: async (event) => {
      events.push(event);
      await options.onEvent?.(event);
    },
  });

  return {
    content: result.content,
    structuredOutput: parseJsonFromText(result.content ?? ""),
    events,
    threadId: result.thread.id,
    agentProfile: publicAgentTaskProfile(profile),
    model: modelSettings.model,
    mode: modelSettings.mode,
    reasoningEffort: modelSettings.reasoningEffort,
    prompt,
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
  const resolvedHost = server.hostname ?? host;
  const resolvedPort = server.port ?? port;

  return {
    server,
    host: resolvedHost,
    port: resolvedPort,
    url: `http://${resolvedHost}:${resolvedPort}`,
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

function mergeDisabledTools(
  configDisabledTools: readonly string[],
  requestDisabledTools: readonly string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...configDisabledTools, ...(requestDisabledTools ?? [])]) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    out.push(normalized);
  }
  return out;
}

function composeToolPolicies(
  ...policies: Array<ToolPolicy | undefined>
): ToolPolicy | undefined {
  const activePolicies = policies.filter((policy): policy is ToolPolicy => Boolean(policy));
  if (activePolicies.length === 0) return undefined;
  return {
    canAdvertise: (tool) => activePolicies.every((policy) =>
      !policy.canAdvertise || policy.canAdvertise(tool)
    ),
    canExecute: async (request) => {
      for (const policy of activePolicies) {
        if (!policy.canExecute) continue;
        const decision = await policy.canExecute(request);
        if (!decision.allowed) return decision;
      }
      return { allowed: true };
    },
  };
}

function parseJsonFromText(text: string): unknown | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      return undefined;
    }
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return undefined;
    }
  }
}
