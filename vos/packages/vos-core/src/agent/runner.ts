import type {
  AgentHttpPackageServerOptions,
  AgentHttpPackageServerResult,
  AgentTaskResult,
  AgentTaskProfileInput,
  AgentTaskRequest,
  InteractiveAgentTaskOptions,
  McpServerConfig,
  ReadonlyAgentDisplayHandle,
  ReadonlyAgentDisplayOptions,
  ToolPolicy,
  ChatClient,
} from "vos-agent/headless";
import {
  createChatClientFromRuntimeProvider,
  runAgentTask,
  runInteractiveAgentTask,
  startReadonlyAgentDisplay,
  startAgentHttpServer,
} from "vos-agent/headless";
import { AgentOutputError } from "../errors.ts";
import {
  appendAgentProgressInstructions,
  createProgressMcpServerConfig,
  SUBMIT_RESULT_MCP_TOOL_NAME,
} from "../progress/agent.ts";
import { readProjectEnv } from "../utils/dotenv.ts";
import { readAgentConfig } from "./config.ts";

export interface AgentRunResult {
  resultText: string;
  parsedResult: unknown;
  rawEvents: Array<Record<string, unknown>>;
  agentProfile?: AgentTaskResult["agentProfile"];
  exitCode: number | null;
  threadId?: string;
  iterations: number;
}

export type HeadlessAgentTaskRunner = (options: AgentTaskRequest) => Promise<{
  content: string | null;
  structuredOutput?: unknown;
  events: unknown[];
  agentProfile?: AgentTaskResult["agentProfile"];
  threadId?: string;
}>;
export type InteractiveAgentTaskRunner = (options: InteractiveAgentTaskOptions) => Promise<void>;
export type ReadonlyAgentDisplayStarter = (options: ReadonlyAgentDisplayOptions) => ReadonlyAgentDisplayHandle;
export type { ReadonlyAgentDisplayHandle, ReadonlyAgentDisplayOptions };

export async function runAgentWithPrompt(params: {
  projectRoot: string;
  taskPrompt: string;
  taskKind?: string;
  requestedScope?: string;
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
  completionReserveIterations?: number;
  disabledTools?: string[];
  courseMode?: boolean;
  toolPolicy?: ToolPolicy;
  allowedVosCommands?: readonly string[];
  resultSubmissionSchema: string;
  extraMcpServers?: readonly McpServerConfig[];
  onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
  taskRunner?: HeadlessAgentTaskRunner;
}): Promise<AgentRunResult> {
  const bootstrap = buildAgentEnv({
    projectRoot: params.projectRoot,
    env: process.env,
  });

  const result = await (params.taskRunner ?? runAgentTask)({
    projectRoot: params.projectRoot,
    task: appendAgentProgressInstructions(params.taskPrompt, params.resultSubmissionSchema),
    taskKind: params.taskKind,
    requestedScope: params.requestedScope,
    agentProfile: params.agentProfile ?? (params.resultSubmissionSchema
      ? { outputSchema: params.resultSubmissionSchema }
      : undefined),
    context: params.context,
    contextRefs: params.contextRefs,
    evidenceRefs: params.evidenceRefs,
    allowedPaths: params.allowedPaths,
    requiredValidations: params.requiredValidations,
    policyFlags: params.policyFlags,
    model: params.model ?? bootstrap.model,
    chat: bootstrap.chat,
    mode: params.mode,
    threadId: params.threadId,
    maxIterations: params.maxIterations,
    completionReserveIterations: params.completionReserveIterations,
    disabledTools: params.disabledTools,
    courseMode: params.courseMode,
    toolPolicy: params.toolPolicy,
    allowedVosCommands: params.allowedVosCommands,
    structuredOutput: false,
    requiredCompletionTool: SUBMIT_RESULT_MCP_TOOL_NAME,
    extraMcpServers: mergeMcpServers([
      createProgressMcpServerConfig(params.projectRoot),
      ...(params.extraMcpServers ?? []),
    ]),
    env: bootstrap.env,
    onEvent: async (event) => {
      if (event) {
        const raw = event as Record<string, unknown>;
        await (params.onEvent?.(raw));
      }
    },
  });
  const rawEvents = result.events.map((event) => event as Record<string, unknown>);
  const submitted = extractAcceptedMcpSubmission(rawEvents, params.resultSubmissionSchema);

  return {
    resultText: `${JSON.stringify(submitted, null, 2)}\n`,
    parsedResult: submitted,
    rawEvents,
    agentProfile: result.agentProfile,
    exitCode: 0,
    threadId: result.threadId ?? lastAgentThreadId(rawEvents),
    iterations: maxAgentIteration(rawEvents),
  };
}

function lastAgentThreadId(events: readonly Record<string, unknown>[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    if (typeof events[index]?.thread_id === "string") return events[index].thread_id as string;
  }
  return undefined;
}

function maxAgentIteration(events: readonly Record<string, unknown>[]): number {
  return events.reduce((highest, event) =>
    typeof event.iteration === "number" && Number.isInteger(event.iteration)
      ? Math.max(highest, event.iteration)
      : highest, 0);
}

function mergeMcpServers(servers: readonly McpServerConfig[]): McpServerConfig[] {
  const seen = new Set<string>();
  return servers.filter((server) => {
    const name = server.name.toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function extractAcceptedMcpSubmission(events: readonly Record<string, unknown>[], expectedSchemaId: string): unknown {
  const calls = new Map<string, { schemaId?: string; result?: unknown }>();
  let sawSubmission = false;
  let last: { accepted: boolean; result?: unknown; error: string } | undefined;

  for (const event of events) {
    if (event.name !== SUBMIT_RESULT_MCP_TOOL_NAME) continue;
    const id = typeof event.id === "string" ? event.id : undefined;
    if (!id) continue;
    if (event.type === "tool.call") {
      sawSubmission = true;
      const parsed = parseSubmitArguments(event.arguments);
      calls.set(id, parsed);
      last = { accepted: false, error: validateSubmitCall(parsed, expectedSchemaId) };
      continue;
    }
    if (event.type === "tool.result") {
      sawSubmission = true;
      const call = calls.get(id);
      const error = validateSubmitCall(call, expectedSchemaId);
      const accepted = !error && isAcceptedSubmitResult(event.content, expectedSchemaId);
      last = accepted
        ? { accepted: true, result: call?.result, error: "" }
        : { accepted: false, error: error || "submit_result was rejected" };
    }
  }

  if (!sawSubmission) {
    throw new AgentOutputError(`agent did not call accepted MCP submit_result for ${expectedSchemaId}`);
  }
  if (!last?.accepted) {
    throw new AgentOutputError(last?.error
      ? `last MCP submit_result was not accepted: ${last.error}`
      : "last MCP submit_result was not accepted");
  }
  return last.result;
}

function parseSubmitArguments(value: unknown): { schemaId?: string; result?: unknown } {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const raw = parsed as Record<string, unknown>;
    return {
      schemaId: typeof raw.schema_id === "string" ? raw.schema_id : undefined,
      result: raw.result,
    };
  } catch {
    return {};
  }
}

function validateSubmitCall(
  call: { schemaId?: string; result?: unknown } | undefined,
  expectedSchemaId: string,
): string {
  if (!call) return "submit_result call arguments are missing";
  if (call.schemaId !== expectedSchemaId) {
    return `submit_result schema_id must be ${expectedSchemaId}`;
  }
  if (call.result === undefined) return "submit_result result is required";
  return "";
}

function isAcceptedSubmitResult(value: unknown, expectedSchemaId: string): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const raw = parsed as Record<string, unknown>;
    return raw.type === "vos-result-submission" &&
      raw.schema_id === expectedSchemaId &&
      raw.accepted === true;
  } catch {
    return false;
  }
}

export function startAgentServer(
  params: AgentHttpPackageServerOptions,
): AgentHttpPackageServerResult {
  const bootstrap = buildAgentEnv({
    projectRoot: params.projectRoot,
    env: (params.env ?? process.env) as NodeJS.ProcessEnv,
  });
  return startAgentHttpServer({
    ...params,
    env: bootstrap.env,
  });
}

export async function runAgentInteractiveTask(
  params: InteractiveAgentTaskOptions & {
    runner?: InteractiveAgentTaskRunner;
  },
): Promise<void> {
  const bootstrap = buildAgentEnv({
    projectRoot: params.projectRoot,
    env: process.env,
  });
  const { runner, ...options } = params;
  await (runner ?? runInteractiveAgentTask)({
    ...options,
    model: options.model ?? bootstrap.model,
    env: bootstrap.env,
    chat: options.chat ?? bootstrap.chat,
  });
}

export async function runInteractiveAgentWithPrompt(params: {
  projectRoot: string;
  taskPrompt: string;
  taskKind: string;
  requestedScope: string;
  agentProfile: AgentTaskProfileInput;
  context?: unknown;
  allowedPaths?: readonly string[];
  policyFlags?: readonly string[];
  courseMode?: boolean;
  allowedVosCommands?: readonly string[];
  resultSubmissionSchema: string;
  extraMcpServers?: readonly McpServerConfig[];
  runner?: InteractiveAgentTaskRunner;
  onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
}): Promise<AgentRunResult> {
  const events: Array<Record<string, unknown>> = [];
  await runAgentInteractiveTask({
    projectRoot: params.projectRoot,
    taskKind: params.taskKind,
    requestedScope: params.requestedScope,
    initialTask: appendAgentProgressInstructions(params.taskPrompt, params.resultSubmissionSchema),
    agentProfile: params.agentProfile,
    context: params.context,
    allowedPaths: params.allowedPaths,
    policyFlags: params.policyFlags,
    courseMode: params.courseMode,
    allowedVosCommands: params.allowedVosCommands,
    extraMcpServers: mergeMcpServers([
      createProgressMcpServerConfig(params.projectRoot),
      ...(params.extraMcpServers ?? []),
    ]),
    runner: params.runner,
    onEvent: async (event) => {
      const raw = event as Record<string, unknown>;
      events.push(raw);
      await params.onEvent?.(raw);
    },
  });
  const submitted = extractAcceptedMcpSubmission(events, params.resultSubmissionSchema);
  return {
    resultText: `${JSON.stringify(submitted, null, 2)}\n`,
    parsedResult: submitted,
    rawEvents: events,
    exitCode: 0,
    threadId: lastAgentThreadId(events),
    iterations: maxAgentIteration(events),
  };
}

export function startAgentReadonlyDisplay(
  params: ReadonlyAgentDisplayOptions & {
    starter?: ReadonlyAgentDisplayStarter;
  },
): ReadonlyAgentDisplayHandle {
  const { starter, ...options } = params;
  return (starter ?? startReadonlyAgentDisplay)(options);
}

export function buildAgentEnv(params: {
  projectRoot: string;
  env: NodeJS.ProcessEnv;
}): { env: Record<string, string | undefined>; model?: string; chat?: ChatClient } {
  const config = readAgentConfig(params.projectRoot).agent;

  const mapped: Record<string, string | undefined> = {
    ...readProjectEnv(params.projectRoot),
    ...params.env,
  };
  if (!config) return { env: mapped };

  if (config.provider) {
    const provider = config.provider.toLowerCase();
    if (provider === "deepseek") {
      if (!mapped.DEEPSEEK_API_KEY && config.authEnv) {
        mapped.DEEPSEEK_API_KEY = mapped[config.authEnv];
      }
      if (config.baseUrl) {
        mapped.DEEPSEEK_BASE_URL = config.baseUrl;
      }
    } else if (provider === "openai-compatible") {
      if (!mapped.OPENAI_COMPATIBLE_API_KEY && config.authEnv) {
        mapped.OPENAI_COMPATIBLE_API_KEY = mapped[config.authEnv];
      }
      if (config.baseUrl) {
        mapped.OPENAI_COMPATIBLE_BASE_URL = config.baseUrl;
      }
    } else if (provider === "openai") {
      if (!mapped.OPENAI_API_KEY && config.authEnv) {
        mapped.OPENAI_API_KEY = mapped[config.authEnv];
      }
      if (config.baseUrl) {
        mapped.OPENAI_BASE_URL = config.baseUrl;
      }
    } else if (provider === "ollama") {
      mapped.OLLAMA_ENABLED = "1";
      if (!mapped.OLLAMA_API_KEY && config.authEnv) {
        mapped.OLLAMA_API_KEY = mapped[config.authEnv];
      }
      if (config.baseUrl) {
        mapped.OLLAMA_BASE_URL = config.baseUrl;
      }
    } else if (provider === "anthropic") {
      if (!mapped.ANTHROPIC_API_KEY && !mapped.ANTHROPIC_AUTH_TOKEN && config.authEnv) {
        mapped.ANTHROPIC_API_KEY = mapped[config.authEnv];
      }
      if (config.baseUrl) {
        mapped.ANTHROPIC_BASE_URL = config.baseUrl;
      }
    }
  }
  const model = normalizeAgentModelForProvider(config.model, config.provider);
  if (model && !mapped.SMART_MODEL) {
    mapped.SMART_MODEL = model;
  }

  return {
    env: mapped,
    model,
    chat: createConfiguredChatClient(config, mapped),
  };
}

function createConfiguredChatClient(
  config: NonNullable<ReturnType<typeof readAgentConfig>["agent"]>,
  env: Record<string, string | undefined>,
): ChatClient {
  const secret = config.authEnv ? env[config.authEnv] : undefined;
  if (config.provider !== "ollama" && !secret) {
    throw new Error(`configured ${config.provider} provider credential ${config.authEnv ?? "<unset>"} is missing; run \`vos agent config --check\``);
  }
  return createChatClientFromRuntimeProvider({
    kind: config.provider,
    base_url: config.baseUrl ?? defaultProviderBaseUrl(config.provider),
    ...(secret ? { secret } : {}),
    ...(config.provider === "anthropic" && config.authEnv === "ANTHROPIC_AUTH_TOKEN" ? { auth_kind: "bearer" as const } : {}),
    max_output_tokens: 16_384,
  });
}

function defaultProviderBaseUrl(provider: NonNullable<ReturnType<typeof readAgentConfig>["agent"]>["provider"]): string {
  switch (provider) {
    case "anthropic": return "https://api.anthropic.com";
    case "openai": return "https://api.openai.com/v1";
    case "openai-compatible": throw new Error("configured openai-compatible provider requires base_url");
    case "deepseek": return "https://api.deepseek.com/v1";
    case "ollama": return "http://localhost:11434/api";
  }
}

function normalizeAgentModelForProvider(
  model: string | undefined,
  provider: string | undefined,
): string | undefined {
  if (!model) return undefined;
  if (provider?.toLowerCase() !== "anthropic") return model;
  if (model.startsWith("anthropic:") || model.startsWith("anthropic/")) {
    return model;
  }
  return `anthropic:${model}`;
}
