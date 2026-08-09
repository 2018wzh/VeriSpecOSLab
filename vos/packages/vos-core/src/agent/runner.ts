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
} from "vos-agent/headless";
import {
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
}

export type HeadlessAgentTaskRunner = (options: AgentTaskRequest) => Promise<{
  content: string | null;
  structuredOutput?: unknown;
  events: unknown[];
  agentProfile?: AgentTaskResult["agentProfile"];
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
    mode: params.mode,
    threadId: params.threadId,
    maxIterations: params.maxIterations,
    disabledTools: params.disabledTools,
    courseMode: params.courseMode,
    toolPolicy: params.toolPolicy,
    allowedVosCommands: params.allowedVosCommands,
    structuredOutput: false,
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
  };
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
  });
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
}): { env: Record<string, string | undefined>; model?: string } {
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
  };
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
