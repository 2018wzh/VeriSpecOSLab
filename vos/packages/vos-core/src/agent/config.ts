import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CliError } from "../errors.ts";
import type { AgentEmbeddingProviderName, AgentProviderName } from "../types.ts";

export const AGENT_PROVIDER_NAMES = [
  "anthropic",
  "openai",
  "openai-compatible",
  "deepseek",
  "ollama",
] as const satisfies readonly AgentProviderName[];

export const AGENT_EMBEDDING_PROVIDER_NAMES = [
  "openai",
  "openai-compatible",
] as const satisfies readonly AgentEmbeddingProviderName[];

export const AGENT_PROVIDER_DEFAULTS: Record<AgentProviderName, { baseUrl?: string; authEnv?: string }> = {
  anthropic: { baseUrl: "https://api.anthropic.com", authEnv: "ANTHROPIC_API_KEY" },
  openai: { baseUrl: "https://api.openai.com/v1", authEnv: "OPENAI_API_KEY" },
  "openai-compatible": { authEnv: "OPENAI_COMPATIBLE_API_KEY" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", authEnv: "DEEPSEEK_API_KEY" },
  ollama: { baseUrl: "http://localhost:11434/api" },
};

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export interface ProviderConfig<TProvider extends string = string> {
  provider: TProvider;
  model: string;
  baseUrl?: string;
  authEnv?: string;
}

export interface AgentConfigSections {
  agent?: ProviderConfig<AgentProviderName>;
  embedding?: ProviderConfig<AgentEmbeddingProviderName>;
}

export interface AgentConfigCheck {
  name: string;
  ok: boolean;
  message: string;
  hint?: string;
}

export function agentConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".vos", "config.toml");
}

export function readAgentConfig(projectRoot: string): AgentConfigSections {
  const configPath = agentConfigPath(projectRoot);
  if (!existsSync(configPath)) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = Bun.TOML.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new CliError(
      `invalid TOML in .vos/config.toml: ${error instanceof Error ? error.message : String(error)}`,
      "validation_failed",
      { reason: "agent_config_invalid_toml" },
    );
  }
  if (!isRecord(parsed)) {
    throw configError(".vos/config.toml must contain TOML tables", "agent_config_invalid_root");
  }
  const kb = parsed.kb === undefined ? undefined : requireRecord(parsed.kb, "[kb]");
  return {
    agent: parseProviderSection(parsed.agent, "agent", AGENT_PROVIDER_NAMES),
    embedding: parseProviderSection(kb?.embedding, "kb.embedding", AGENT_EMBEDDING_PROVIDER_NAMES),
  };
}

export function writeAgentConfig(
  projectRoot: string,
  agent: ProviderConfig<AgentProviderName>,
  embedding?: ProviderConfig<AgentEmbeddingProviderName>,
): void {
  validateProviderConfig(agent, "agent");
  if (embedding) validateProviderConfig(embedding, "kb.embedding");
  const configPath = agentConfigPath(projectRoot);
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  // Parse before changing anything so malformed local configuration is never overwritten.
  if (existing) readAgentConfig(projectRoot);
  const kept = stripTomlBlocks(existing, ["agent", "kb.embedding"])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const sections = [
    serializeProvider("agent", agent),
    ...(embedding ? [serializeProvider("kb.embedding", embedding)] : []),
  ].join("\n\n");
  const content = kept ? `${kept}\n\n${sections}\n` : `${sections}\n`;
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, content);
}

export function resetAgentConfig(projectRoot: string): { agent: boolean; embedding: boolean } {
  const configPath = agentConfigPath(projectRoot);
  if (!existsSync(configPath)) return { agent: false, embedding: false };
  readAgentConfig(projectRoot);
  const existing = readFileSync(configPath, "utf8");
  const removed = {
    agent: hasTomlSection(existing, "agent"),
    embedding: hasTomlSection(existing, "kb.embedding"),
  };
  if (!removed.agent && !removed.embedding) return removed;
  const kept = stripTomlBlocks(existing, ["agent", "kb.embedding"])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  writeFileSync(configPath, kept ? `${kept}\n` : "");
  return removed;
}

export function checkAgentConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  options: { requireEmbedding: boolean },
): AgentConfigCheck[] {
  let sections: AgentConfigSections;
  try {
    sections = readAgentConfig(projectRoot);
  } catch (error) {
    return [{
      name: "agent-config",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      hint: "fix .vos/config.toml, then rerun `vos agent config --check`",
    }];
  }
  const checks: AgentConfigCheck[] = [];
  checks.push(providerCheck("agent", sections.agent, env, true));
  if (options.requireEmbedding || sections.embedding) {
    checks.push(providerCheck("kb-embedding", sections.embedding, env, options.requireEmbedding));
  }
  return checks;
}

export function defaultEmbeddingProvider(
  provider: AgentProviderName,
): AgentEmbeddingProviderName | undefined {
  if (provider === "openai") return "openai";
  if (provider === "openai-compatible") return "openai-compatible";
  return undefined;
}

export function defaultEmbeddingBaseUrl(
  provider: AgentEmbeddingProviderName,
  agent: ProviderConfig<AgentProviderName>,
): string | undefined {
  if (provider === "openai") return "https://api.openai.com/v1";
  return agent.provider === "openai-compatible" ? agent.baseUrl : undefined;
}

export function defaultEmbeddingAuthEnv(
  provider: AgentEmbeddingProviderName,
  agent: ProviderConfig<AgentProviderName>,
): string {
  if (provider === "openai") {
    return agent.provider === "openai" ? agent.authEnv ?? "OPENAI_API_KEY" : "OPENAI_API_KEY";
  }
  return agent.provider === "openai-compatible"
    ? agent.authEnv ?? "OPENAI_COMPATIBLE_API_KEY"
    : "OPENAI_COMPATIBLE_API_KEY";
}

function parseProviderSection<TProvider extends string>(
  value: unknown,
  section: string,
  providers: readonly TProvider[],
): ProviderConfig<TProvider> | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value, `[${section}]`);
  rejectUnknownKeys(record, ["provider", "model", "base_url", "auth"], `[${section}]`);
  const auth = record.auth === undefined ? undefined : requireRecord(record.auth, `[${section}.auth]`);
  if (auth) rejectUnknownKeys(auth, ["env"], `[${section}.auth]`);
  const provider = requiredString(record.provider, `[${section}].provider`).toLowerCase();
  if (!providers.includes(provider as TProvider)) {
    throw configError(
      `invalid provider "${provider}" in [${section}]; expected one of: ${providers.join(", ")}`,
      "agent_config_invalid_provider",
    );
  }
  const config: ProviderConfig<TProvider> = {
    provider: provider as TProvider,
    model: requiredString(record.model, `[${section}].model`),
    ...(optionalString(record.base_url, `[${section}].base_url`) ? { baseUrl: String(record.base_url).trim() } : {}),
    ...(auth && optionalString(auth.env, `[${section}.auth].env`) ? { authEnv: String(auth.env).trim() } : {}),
  };
  validateProviderConfig(config, section);
  return config;
}

function validateProviderConfig(config: ProviderConfig, section: string): void {
  if (!config.model.trim()) throw configError(`[${section}].model is required`, "agent_config_model_missing");
  if (config.provider === "openai-compatible" && !config.baseUrl) {
    throw configError(`[${section}] openai-compatible provider requires base_url`, "agent_config_base_url_missing");
  }
  if (config.baseUrl) {
    let url: URL;
    try {
      url = new URL(config.baseUrl);
    } catch {
      throw configError(`[${section}].base_url must be a valid URL`, "agent_config_invalid_base_url");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw configError(`[${section}].base_url must use http or https`, "agent_config_invalid_base_url");
    }
  }
  if (config.provider !== "ollama" && !config.authEnv) {
    throw configError(`[${section}].auth.env is required for ${config.provider}`, "agent_config_auth_env_missing");
  }
  if (config.authEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.authEnv)) {
    throw configError(`[${section}].auth.env must be an environment variable name`, "agent_config_invalid_auth_env");
  }
}

function providerCheck(
  name: string,
  config: ProviderConfig | undefined,
  env: NodeJS.ProcessEnv,
  required: boolean,
): AgentConfigCheck {
  if (!config) {
    return {
      name,
      ok: !required,
      message: required ? "not configured" : "not configured (optional)",
      ...(required ? { hint: "run `vos agent config`" } : {}),
    };
  }
  if (config.authEnv && !env[config.authEnv]) {
    return {
      name,
      ok: false,
      message: `${config.provider}/${config.model}: credential ${config.authEnv} is missing`,
      hint: `add ${config.authEnv} to the project .env file`,
    };
  }
  return {
    name,
    ok: true,
    message: `${config.provider}/${config.model}${config.authEnv ? `; credential ${config.authEnv} is present` : ""}`,
  };
}

function serializeProvider(section: string, config: ProviderConfig): string {
  const lines = [
    `[${section}]`,
    `provider = ${JSON.stringify(config.provider)}`,
    `model = ${JSON.stringify(config.model)}`,
  ];
  if (config.baseUrl) lines.push(`base_url = ${JSON.stringify(config.baseUrl)}`);
  if (config.authEnv) lines.push(`[${section}.auth]`, `env = ${JSON.stringify(config.authEnv)}`);
  return lines.join("\n");
}

function hasTomlSection(toml: string, root: string): boolean {
  return toml.split(/\r?\n/).some((line) => {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)?.[1]?.trim();
    return header === root || header?.startsWith(`${root}.`) === true;
  });
}

function stripTomlBlocks(toml: string, roots: readonly string[]): string {
  const kept: string[] = [];
  let removing = false;
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)?.[1]?.trim();
    if (header) {
      removing = roots.some((root) => header === root || header.startsWith(`${root}.`));
      if (removing) continue;
    }
    if (!removing) kept.push(line);
  }
  return kept.join("\n");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw configError(`${field} is required and must be a string`, "agent_config_field_missing");
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): value is string {
  if (value === undefined) return false;
  if (typeof value !== "string" || !value.trim()) {
    throw configError(`${field} must be a non-empty string`, "agent_config_invalid_field");
  }
  return true;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], section: string): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw configError(`${section} contains unknown field(s): ${unknown.join(", ")}`, "agent_config_unknown_field");
  }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw configError(`${field} must be a TOML table`, "agent_config_invalid_table");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configError(message: string, reason: string): CliError {
  return new CliError(message, "validation_failed", { reason });
}
