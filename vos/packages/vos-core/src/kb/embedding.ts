import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createOpenAICompatibleEmbedder, type KbEmbedder, type OpenAICompatibleEmbeddingConfig } from "vos-kb";
import { readProjectEnv } from "../utils/dotenv.ts";

interface ProviderConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
  authEnv?: string;
}

export function buildKbEmbeddingConfig(projectRoot: string, env: NodeJS.ProcessEnv = process.env): OpenAICompatibleEmbeddingConfig {
  const raw = readConfig(projectRoot);
  const merged: Record<string, string | undefined> = { ...readProjectEnv(projectRoot), ...env };
  const config = raw?.kbEmbedding ?? openAICompatible(raw?.agent) ?? null;
  if (!config) throw new Error("KB embedding provider is not configured");
  const authEnv = config.authEnv ?? "OPENAI_API_KEY";
  const apiKey = merged[authEnv];
  if (!apiKey) throw new Error(`KB embedding provider missing credential env ${authEnv}`);
  return {
    baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
    model: config.model ?? "text-embedding-3-small",
    apiKey,
  };
}

export function createKbEmbedder(projectRoot: string, env: NodeJS.ProcessEnv = process.env): KbEmbedder {
  return createOpenAICompatibleEmbedder(buildKbEmbeddingConfig(projectRoot, env));
}

export function kbEmbeddingEnv(projectRoot: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const config = buildKbEmbeddingConfig(projectRoot, env);
  return {
    VOS_KB_EMBEDDING_BASE_URL: config.baseUrl,
    VOS_KB_EMBEDDING_MODEL: config.model,
    VOS_KB_EMBEDDING_API_KEY: config.apiKey,
  };
}

function readConfig(projectRoot: string): { agent?: ProviderConfig; kbEmbedding?: ProviderConfig } | null {
  const configPath = path.join(projectRoot, ".vos", "config.toml");
  if (!existsSync(configPath)) return null;
  const parsed = Bun.TOML.parse(readFileSync(configPath, "utf8"));
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  return {
    agent: providerConfig(root.agent),
    kbEmbedding: providerConfig((root.kb as Record<string, unknown> | undefined)?.embedding),
  };
}

function providerConfig(value: unknown): ProviderConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const auth = raw.auth && typeof raw.auth === "object" && !Array.isArray(raw.auth)
    ? raw.auth as Record<string, unknown>
    : {};
  const config: ProviderConfig = {
    provider: stringValue(raw.provider),
    model: stringValue(raw.model),
    baseUrl: stringValue(raw.base_url),
    authEnv: stringValue(auth.env),
  };
  return config.provider || config.model || config.baseUrl || config.authEnv ? config : undefined;
}

function openAICompatible(config: ProviderConfig | undefined): ProviderConfig | undefined {
  const provider = config?.provider?.toLowerCase();
  return provider === "openai" || provider === "openai-compatible" || provider === "deepseek" ? {
    ...config,
    model: "text-embedding-3-small",
  } : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
