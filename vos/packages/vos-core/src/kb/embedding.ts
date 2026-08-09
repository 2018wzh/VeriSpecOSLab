import { createOpenAICompatibleEmbedder, type KbEmbedder, type OpenAICompatibleEmbeddingConfig } from "vos-kb";
import { readAgentConfig } from "../agent/config.ts";
import { readProjectEnv } from "../utils/dotenv.ts";

export function buildKbEmbeddingConfig(projectRoot: string, env: NodeJS.ProcessEnv = process.env): OpenAICompatibleEmbeddingConfig {
  const config = readAgentConfig(projectRoot).embedding;
  const merged: Record<string, string | undefined> = { ...readProjectEnv(projectRoot), ...env };
  if (!config) throw new Error("KB embedding provider is not configured; run `vos agent config --with-embedding`");
  const authEnv = config.authEnv;
  if (!authEnv) throw new Error("KB embedding provider credential environment variable is not configured");
  const apiKey = merged[authEnv];
  if (!apiKey) throw new Error(`KB embedding provider missing credential env ${authEnv}`);
  return {
    baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
    model: config.model,
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
