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
  const authEnvCandidates = resolveEmbeddingAuthEnvCandidates(config, raw?.agent);
  const authEnv = findExistingAuthEnv(authEnvCandidates, merged);
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

function resolveEmbeddingAuthEnvCandidates(config: ProviderConfig, agent?: ProviderConfig): string[] {
  if (config.authEnv) return [config.authEnv];
  const provider = config.provider?.toLowerCase() ?? "openai-compatible";
  const agentProvider = agent?.provider?.toLowerCase();

  if (provider === "openai") return uniqueStrings(["OPENAI_API_KEY", "OPENAI_COMPATIBLE_API_KEY", agent?.authEnv]);

  const fallback = ["OPENAI_COMPATIBLE_API_KEY", agent?.authEnv];
  return uniqueStrings(fallback);
}

function findExistingAuthEnv(candidates: string[], merged: Record<string, string | undefined>): string {
  for (const candidate of candidates) {
    if (candidate && merged[candidate]) return candidate;
  }
  return candidates[0] ?? "OPENAI_API_KEY";
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function openAICompatible(config: ProviderConfig | undefined): ProviderConfig | undefined {
  if (!config) return undefined;
  const provider = config.provider?.toLowerCase();
  if (provider === "openai" || provider === "openai-compatible") {
    return { ...config, model: config.model ?? "text-embedding-3-small" };
  }
  if (provider === "deepseek") {
    throw new Error(
      "DeepSeek does not provide an embeddings API. " +
      "Add a [kb.embedding] section to .vos/config.toml with an OpenAI-compatible embedding provider, " +
      "or set provider = \"openai\" and provide OPENAI_API_KEY.",
    );
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
