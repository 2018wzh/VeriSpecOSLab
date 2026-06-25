import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { resolve } from "node:path";
import type { ToolPolicy } from "./tools/types.ts";
import type { McpServerConfig } from "./plugins/manifest.ts";
import { loadConfig } from "./config.ts";
import { resolveActiveModelSettings } from "./resolve-model.ts";
import { runSessionTurn, type RunSessionTurnOptions } from "./session/run-turn.ts";
import { createThreadStore } from "./session/thread-store.ts";
import { createChatClientFromConfig } from "./llm/providers.ts";
import type { ChatClient } from "./agent/loop.ts";
import { loadSettings } from "./settings.ts";
import type { SessionEvent } from "./session/types.ts";
import type { Config, ReasoningEffort } from "./config.ts";
import { serveAgentHttp } from "./server/http.ts";
import { linkAbortSignal } from "./cancellation.ts";
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
import { resolveBuiltInSkills } from "./skills/index.ts";
import { StarsTuiInteractiveView } from "./tui/interactive-view.ts";
import type { StarsViewSize } from "./tui/stars-view.ts";
import { TerminalDriver } from "./tui/terminal.ts";
import { resolveStarsTuiTheme } from "./tui/theme.ts";
import { formatError } from "./tools/common.ts";
import { runInteractive } from "./terminal/repl.ts";

export interface HeadlessAgentOptions {
  projectRoot: string;
  prompt: string;
  model?: string;
  mode?: string;
  threadId?: string;
  maxIterations?: number;
  disabledTools?: readonly string[];
  allowedPaths?: readonly string[];
  requiredValidations?: readonly string[];
  policyFlags?: readonly string[];
  courseMode?: boolean;
  allowedVosCommands?: readonly string[];
  extraMcpServers?: readonly McpServerConfig[];
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
  extraMcpServers?: readonly McpServerConfig[];
  toolPolicy?: ToolPolicy;
  chat?: ChatClient;
  env?: Record<string, string | undefined>;
  streamAssistant?: boolean;
  signal?: AbortSignal;
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

export type ControlledTuiOutputStream = NodeJS.WritableStream & {
  columns?: number;
  rows?: number;
  on?(event: "resize", listener: () => void): unknown;
  off?(event: "resize", listener: () => void): unknown;
};

export type ControlledTuiInputStream = NodeJS.ReadableStream & {
  setEncoding?(encoding: BufferEncoding): unknown;
  setRawMode?: (enabled: boolean) => unknown;
  resume?(): unknown;
  pause?(): unknown;
  on(event: "data" | "end" | "error", listener: (...args: any[]) => void): unknown;
  off(event: "data" | "end" | "error", listener: (...args: any[]) => void): unknown;
};

export interface ControlledTuiAgentTaskOptions extends AgentTaskRequest {
  output?: ControlledTuiOutputStream;
  /**
   * Input is consumed and ignored so users cannot submit prompts or slash
   * commands. Pass false when the embedding app owns input elsewhere.
   */
  input?: ControlledTuiInputStream | false;
  debugLabels?: boolean;
  welcomeAnimation?: boolean;
  closeOnComplete?: boolean;
  allowKeyboardInterrupt?: boolean;
}

export interface ControlledTuiAgentTaskHandle {
  readonly result: Promise<AgentTaskResult>;
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
  close(): void;
}

export interface InteractiveAgentTaskOptions {
  projectRoot: string;
  taskKind: string;
  requestedScope?: string;
  initialTask?: string;
  agentProfile?: AgentTaskProfileInput;
  context?: unknown;
  contextRefs?: readonly string[];
  evidenceRefs?: readonly string[];
  allowedPaths?: readonly string[];
  requiredValidations?: readonly string[];
  policyFlags?: readonly string[];
  model?: string;
  mode?: string;
  threadId?: string;
  maxIterations?: number;
  disabledTools?: readonly string[];
  courseMode?: boolean;
  allowedVosCommands?: readonly string[];
  extraMcpServers?: readonly McpServerConfig[];
  toolPolicy?: ToolPolicy;
  chat?: ChatClient;
  env?: Record<string, string | undefined>;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  error?: NodeJS.WritableStream;
  debugLabels?: boolean;
  welcomeAnimation?: boolean;
}

export interface ReadonlyAgentDisplayProgress {
  stage: string;
  status?: string;
  message?: string;
  phase?: string;
  step?: string;
  current?: number;
  total?: number;
  percent?: number;
}

export interface ReadonlyAgentDisplayOptions {
  projectRoot: string;
  title?: string;
  mode?: string;
  model?: string;
  output?: ControlledTuiOutputStream;
  debugLabels?: boolean;
  welcomeAnimation?: boolean;
}

export interface ReadonlyAgentDisplayHandle {
  command(message: string): void;
  error(message: string): void;
  progress(update: ReadonlyAgentDisplayProgress): void;
  onSessionEvent(event: SessionEvent): void;
  close(): void;
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

export type { ChatClient, Config, SessionEvent, ToolPolicy };
export type { AgentTaskProfile, AgentTaskProfileInput };
export type { McpServerConfig };

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
    permissionRules: config.tools.permissions,
    threadId: options.threadId,
    maxIterations: options.maxIterations,
    courseMode: options.courseMode,
    allowedVosCommands: options.allowedVosCommands,
    extraMcpServers: options.extraMcpServers,
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
  const chat = options.chat ?? createChatClientFromConfig(config);
  const profile = resolveInternalAgentTaskProfile({
    taskKind: options.taskKind,
  }, options.agentProfile);
  const builtInSkills = resolveBuiltInSkills(profile.skills, { workspaceRoot });
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
    permissionRules: config.tools.permissions,
    threadId: options.threadId,
    maxIterations: options.maxIterations,
    courseMode: options.courseMode ?? true,
    allowedVosCommands: resolveProfileVosCommands(profile, options.allowedVosCommands),
    extraMcpServers: [...builtInSkills.mcpServers, ...(options.extraMcpServers ?? [])],
    toolPolicy: composeToolPolicies(createProfileToolPolicy(profile), options.toolPolicy),
    startDir: workspaceRoot,
    fixedSystemPrompt: buildAgentTaskSystemPrompt(profile),
    streamAssistant: options.streamAssistant ?? false,
    signal: options.signal,
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

export function startControlledTuiAgentTask(
  options: ControlledTuiAgentTaskOptions,
): ControlledTuiAgentTaskHandle {
  const workspaceRoot = resolve(options.projectRoot);
  const taskKind = options.taskKind ?? "knowledgebase_qa";
  const profile = resolveInternalAgentTaskProfile({ taskKind }, options.agentProfile);
  const output = options.output ?? defaultStdout as ControlledTuiOutputStream;
  const driver = new TerminalDriver(output);
  const view = new StarsTuiInteractiveView({
    presenter: driver,
    size: () => controlledTuiSize(output),
    debugLabels: options.debugLabels,
    displayOnly: true,
    theme: resolveStarsTuiTheme(),
    welcomeAnimation: options.welcomeAnimation ?? false,
  });
  const controller = new AbortController();
  const unlinkAbortSignal = linkAbortSignal(options.signal, controller);
  const inputBlocker = options.input === false
    ? undefined
    : new ControlledTuiInputBlocker({
        input: (options.input ?? defaultStdin) as ControlledTuiInputStream,
        controller,
        allowKeyboardInterrupt: options.allowKeyboardInterrupt ?? true,
      });
  const onResize = (): void => view.refresh();
  let resizeAttached = false;
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (resizeAttached) {
      output.off?.("resize", onResize);
      resizeAttached = false;
    }
    inputBlocker?.close();
    view.close();
    driver.close();
    unlinkAbortSignal();
  };

  driver.start();
  try {
    if (output.on) {
      output.on("resize", onResize);
      resizeAttached = true;
    }
    inputBlocker?.start();
    view.welcome({
      mode: options.mode ?? profile.mode,
      model: options.model,
      cwd: workspaceRoot,
    });
    view.prompt(options.task);
  } catch (e) {
    close();
    throw e;
  }

  const result = (async (): Promise<AgentTaskResult> => {
    try {
      return await runAgentTask({
        ...options,
        projectRoot: workspaceRoot,
        taskKind,
        signal: controller.signal,
        streamAssistant: options.streamAssistant ?? true,
        onEvent: async (event) => {
          view.onSessionEvent(event);
          await options.onEvent?.(event);
        },
      });
    } catch (e) {
      view.error(formatError(e));
      throw e;
    } finally {
      if (options.closeOnComplete !== false) {
        close();
      } else {
        inputBlocker?.close();
        unlinkAbortSignal();
      }
    }
  })();

  return {
    result,
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    close,
  };
}

export async function runControlledTuiAgentTask(
  options: ControlledTuiAgentTaskOptions,
): Promise<AgentTaskResult> {
  return await startControlledTuiAgentTask(options).result;
}

export async function runInteractiveAgentTask(
  options: InteractiveAgentTaskOptions,
): Promise<void> {
  const workspaceRoot = resolve(options.projectRoot);
  const env = options.env ?? process.env;
  const settings = loadSettings({ workspaceRoot, env });
  const config = loadConfig(env, settings);
  const chat = options.chat ?? createChatClientFromConfig(config);
  const profile = resolveInternalAgentTaskProfile({
    taskKind: options.taskKind,
  }, options.agentProfile);
  const builtInSkills = resolveBuiltInSkills(profile.skills, { workspaceRoot });
  const modelSettings = options.model
    ? { model: options.model, mode: options.mode }
    : resolveActiveModelSettings(config, {
      model: undefined,
      mode: options.mode ?? profile.mode,
    });

  await runInteractive({
    chat,
    config,
    store: createThreadStore({ workspaceRoot }),
    workspaceRoot,
    mode: modelSettings.mode,
    model: options.model,
    threadId: options.threadId,
    maxIterations: options.maxIterations,
    disabledTools: options.disabledTools,
    input: options.input,
    output: options.output,
    error: options.error,
    debugLabels: options.debugLabels,
    welcomeAnimation: options.welcomeAnimation,
    initialPrompt: options.initialTask,
    fixedSystemPrompt: buildAgentTaskSystemPrompt(profile),
    promptBuilder: (task) => buildAgentTaskUserPrompt({
      profile,
      task,
      taskKind: options.taskKind,
      requestedScope: options.requestedScope,
      context: options.context,
      contextRefs: options.contextRefs,
      evidenceRefs: options.evidenceRefs,
      allowedPaths: options.allowedPaths,
      requiredValidations: options.requiredValidations,
      policyFlags: options.policyFlags,
    }),
    toolPolicy: composeToolPolicies(createProfileToolPolicy(profile), options.toolPolicy),
    courseMode: options.courseMode ?? true,
    allowedVosCommands: resolveProfileVosCommands(profile, options.allowedVosCommands),
    extraMcpServers: [...builtInSkills.mcpServers, ...(options.extraMcpServers ?? [])],
    allowedSlashCommands: ["help", "quit", "new", "thread-show", "thread-switch", "todos"],
  });
}

export function startReadonlyAgentDisplay(
  options: ReadonlyAgentDisplayOptions,
): ReadonlyAgentDisplayHandle {
  const workspaceRoot = resolve(options.projectRoot);
  const output = options.output ?? defaultStdout as ControlledTuiOutputStream;
  const driver = new TerminalDriver(output);
  const view = new StarsTuiInteractiveView({
    presenter: driver,
    size: () => controlledTuiSize(output),
    debugLabels: options.debugLabels,
    displayOnly: true,
    theme: resolveStarsTuiTheme(),
    welcomeAnimation: options.welcomeAnimation ?? false,
  });
  const onResize = (): void => view.refresh();
  let resizeAttached = false;
  let closed = false;

  driver.start();
  try {
    if (output.on) {
      output.on("resize", onResize);
      resizeAttached = true;
    }
    view.welcome({
      mode: options.mode,
      model: options.model,
      cwd: workspaceRoot,
    });
    if (options.title) {
      view.command(options.title);
    }
  } catch (e) {
    close();
    throw e;
  }

  function close(): void {
    if (closed) return;
    closed = true;
    if (resizeAttached) {
      output.off?.("resize", onResize);
      resizeAttached = false;
    }
    view.close();
    driver.close();
  }

  return {
    command: (message) => view.command(message),
    error: (message) => view.error(message),
    progress: (update) => view.command(formatReadonlyProgress(update)),
    onSessionEvent: (event) => view.onSessionEvent(event),
    close,
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

function controlledTuiSize(output: ControlledTuiOutputStream): StarsViewSize {
  return {
    width: Math.max(1, Math.trunc(output.columns ?? 80)),
    height: Math.max(1, Math.trunc(output.rows ?? 24)),
  };
}

function formatReadonlyProgress(update: ReadonlyAgentDisplayProgress): string {
  const parts = [
    update.stage,
    update.phase,
    update.step,
    update.status,
    update.message,
  ].filter((value): value is string => Boolean(value));
  const counters = [
    typeof update.current === "number" && typeof update.total === "number"
      ? `${update.current}/${update.total}`
      : undefined,
    typeof update.percent === "number" ? `${Math.round(update.percent)}%` : undefined,
  ].filter((value): value is string => Boolean(value));
  return [...parts, ...counters].join(" · ");
}

class ControlledTuiInputBlocker {
  private started = false;
  private closed = false;
  private rawModeEnabled = false;

  constructor(
    private readonly opts: {
      input: ControlledTuiInputStream;
      controller: AbortController;
      allowKeyboardInterrupt: boolean;
    },
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.closed = false;
    const { input } = this.opts;
    input.setEncoding?.("utf8");
    if (input.setRawMode) {
      input.setRawMode(true);
      this.rawModeEnabled = true;
    }
    input.on("data", this.onData);
    input.on("end", this.onEnd);
    input.on("error", this.onError);
    input.resume?.();
  }

  close(): void {
    if (!this.started && this.closed) return;
    this.closed = true;
    const { input } = this.opts;
    input.off("data", this.onData);
    input.off("end", this.onEnd);
    input.off("error", this.onError);
    if (this.rawModeEnabled) {
      input.setRawMode?.(false);
      this.rawModeEnabled = false;
    }
    input.pause?.();
    this.started = false;
  }

  private readonly onData = (chunk: string | Buffer | Uint8Array): void => {
    if (this.closed || !this.opts.allowKeyboardInterrupt) return;
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (text.includes("\u0003")) {
      this.opts.controller.abort(abortError("controlled TUI interrupted"));
    }
  };

  private readonly onEnd = (): void => {
    // EOF is not a user prompt in controlled mode. Keep the agent run alive until
    // the model finishes or the caller aborts it.
  };

  private readonly onError = (error: unknown): void => {
    this.opts.controller.abort(error);
  };
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
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
