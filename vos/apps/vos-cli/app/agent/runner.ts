import path from "node:path";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import type {
  AgentHttpPackageServerOptions,
  AgentHttpPackageServerResult,
  AgentTaskProfileInput,
  AgentTaskRequest,
  HeadlessAgentOptions,
  HeadlessAgentResult,
  McpServerConfig,
  ToolPolicy,
} from "vos-agent/headless";
import {
  runAgentTask,
  runHeadlessAgentPrompt,
  startAgentHttpServer,
} from "vos-agent/headless";
import { readProjectEnv } from "../utils/dotenv.ts";

export interface AgentRunResult {
  resultText: string;
  parsedResult?: unknown;
  rawEvents: Array<Record<string, unknown>>;
  exitCode: number | null;
}

export type HeadlessAgentRunner = (options: HeadlessAgentOptions) => Promise<HeadlessAgentResult>;
export type HeadlessAgentTaskRunner = (options: AgentTaskRequest) => Promise<{
  content: string | null;
  structuredOutput?: unknown;
  events: unknown[];
}>;

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
  extraMcpServers?: readonly McpServerConfig[];
  onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
  runner?: HeadlessAgentRunner;
  taskRunner?: HeadlessAgentTaskRunner;
}): Promise<AgentRunResult> {
  const bootstrap = buildAgentEnv({
    projectRoot: params.projectRoot,
    env: process.env,
  });

  const result = params.runner
    ? await params.runner({
      projectRoot: params.projectRoot,
      prompt: params.taskPrompt,
      model: params.model ?? bootstrap.model,
      mode: params.mode,
      threadId: params.threadId,
      maxIterations: params.maxIterations,
      disabledTools: params.disabledTools,
      allowedPaths: params.allowedPaths,
      requiredValidations: params.requiredValidations,
      policyFlags: params.policyFlags,
      courseMode: params.courseMode,
      toolPolicy: params.toolPolicy,
      allowedVosCommands: params.allowedVosCommands,
      extraMcpServers: params.extraMcpServers,
      env: bootstrap.env,
      onEvent: async (event) => {
        if (event) {
          await (params.onEvent?.(event as Record<string, unknown>));
        }
      },
    })
    : await (params.taskRunner ?? runAgentTask)({
      projectRoot: params.projectRoot,
      task: params.taskPrompt,
      promptOverride: params.taskPrompt,
      taskKind: params.taskKind,
      requestedScope: params.requestedScope,
      agentProfile: params.agentProfile,
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
      extraMcpServers: params.extraMcpServers,
      env: bootstrap.env,
      onEvent: async (event) => {
        if (event) {
          await (params.onEvent?.(event as Record<string, unknown>));
        }
      },
    });

  return {
    resultText: result.content ?? "",
    parsedResult: "structuredOutput" in result ? result.structuredOutput : undefined,
    rawEvents: result.events.map((event) => event as Record<string, unknown>),
    exitCode: 0,
  };
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

export function parseJsonFromText(text: string): unknown | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) {
      return undefined;
    }
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return undefined;
    }
  }
}

interface ProjectAgentToml {
  provider?: string;
  model?: string;
  baseUrl?: string;
  authEnv?: string;
}

export function buildAgentEnv(params: {
  projectRoot: string;
  env: NodeJS.ProcessEnv;
}): { env: Record<string, string | undefined>; model?: string } {
  const config = readLocalAgentConfig(params.projectRoot);

  const mapped: Record<string, string | undefined> = {
    ...readProjectEnv(params.projectRoot),
    ...params.env,
  };
  if (!config) return { env: mapped };

  if (config.provider) {
    const provider = config.provider.toLowerCase();
    if (provider === "deepseek" || provider === "openai" || provider === "openai-compatible") {
      if (!mapped.OPENAI_API_KEY && config.authEnv) {
        mapped.OPENAI_API_KEY = mapped[config.authEnv];
      }
      if (config.baseUrl) {
        mapped.OPENAI_BASE_URL = config.baseUrl;
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

function readLocalAgentConfig(projectRoot: string): ProjectAgentToml | null {
  const configPath = path.join(projectRoot, ".vos", "config.toml");
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, "utf8");
    return parseTomlConfig(raw);
  } catch {
    return null;
  }
}

function parseTomlConfig(raw: string): ProjectAgentToml | null {
  try {
    const parsed = Bun.TOML.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const agentSection = (parsed as Record<string, unknown>).agent;
    if (!agentSection || typeof agentSection !== "object" || Array.isArray(agentSection)) {
      return null;
    }
    const normalized: ProjectAgentToml = {};
    const agent = agentSection as Record<string, unknown>;
    if (typeof agent.provider === "string" && agent.provider.trim()) {
      normalized.provider = agent.provider.trim();
    }
    if (typeof agent.model === "string" && agent.model.trim()) {
      normalized.model = agent.model.trim();
    }
    if (typeof agent.base_url === "string" && agent.base_url.trim()) {
      normalized.baseUrl = agent.base_url.trim();
    }
    const authSection = agent.auth;
    if (authSection && typeof authSection === "object" && !Array.isArray(authSection)) {
      const auth = authSection as Record<string, unknown>;
      if (typeof auth.env === "string" && auth.env.trim()) {
        normalized.authEnv = auth.env.trim();
      }
    }
    if (!normalized.provider && !normalized.model && !normalized.baseUrl && !normalized.authEnv) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}
