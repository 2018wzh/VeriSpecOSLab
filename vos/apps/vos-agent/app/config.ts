import type { SettingsInput, SettingsModeDefinition } from "./settings.ts";
import type { PermissionRule } from "./tools/permissions.ts";

/**
 * Built-in mode names. Modes are presets that resolve to a model
 * identifier. The default `smart` mode targets Opus, `deep` targets
 * gpt5.5, and `rush` targets Sonnet with medium reasoning effort.
 * Users can override models via env vars or supply their own modes
 * programmatically. Reasoning effort is mode/config driven, not a
 * CLI/TUI flag.
 */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export const DEFAULT_MODE = "smart";
export const DEFAULT_SMART_MODEL = "opus4.7";
export const DEFAULT_DEEP_MODEL = "gpt5.5";
export const DEFAULT_RUSH_MODEL = "sonnet4.6";
export const DEFAULT_RUSH_REASONING_EFFORT: ReasoningEffort = "medium";

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export interface ModeDefinition {
  /** Model identifier passed on every request when this mode is active. */
  model: string;
  /** Optional provider reasoning-effort hint for this mode. */
  reasoningEffort?: ReasoningEffort;
}

export interface OpenAIConfig {
  apiKey: string;
  baseURL?: string;
  /** Max retries on transient errors. SDK default is provider-specific. */
  maxRetries?: number;
}

export type OpenAICompatibleResponseFormat = "json_object" | "json_schema" | "none";
export type OpenAICompatibleReasoningEffort = "off" | "passthrough";
export type OpenAICompatibleStreamUsage = "off" | "include_usage";

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseURL?: string;
  responseFormat: OpenAICompatibleResponseFormat;
  reasoningEffort: OpenAICompatibleReasoningEffort;
  streamUsage: OpenAICompatibleStreamUsage;
  input: Record<"text" | "image" | "pdf", boolean>;
  extraHeaders?: Record<string, string>;
  /** Max retries on transient errors. SDK default is provider-specific. */
  maxRetries?: number;
}

export interface DeepSeekConfig {
  apiKey: string;
  baseURL?: string;
  betaBaseURL?: string;
  /** Max retries on transient errors. SDK default is provider-specific. */
  maxRetries?: number;
}

export type OllamaThink = "off" | "passthrough";

export interface OllamaConfig {
  baseURL: string;
  apiKey?: string;
  think: OllamaThink;
  keepAlive?: string;
}

export interface AnthropicConfig {
  apiKey?: string;
  authToken?: string;
  baseURL?: string;
  /** Anthropic requires max_tokens; provider client supplies a default. */
  maxTokens?: number;
  /** Max retries on transient errors. SDK default is provider-specific. */
  maxRetries?: number;
}

export interface ToolConfig {
  disabled: string[];
  permissions?: PermissionRule[];
}

export interface ChatRetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface Config {
  /** Mode used when nothing more specific is set. */
  defaultMode: string;
  /** Available modes by name. */
  modes: Record<string, ModeDefinition>;
  /** Tool policy selected from settings. */
  tools: ToolConfig;
  /** Provider-neutral retry policy wrapped around the routed ChatClient. */
  chatRetry?: ChatRetryConfig;
  /** Present iff OPENAI_API_KEY is set. */
  openai?: OpenAIConfig;
  /** Present iff OPENAI_COMPATIBLE_API_KEY is set, or legacy OPENAI_BASE_URL is set. */
  openaiCompatible?: OpenAICompatibleConfig;
  /** Present iff DEEPSEEK_API_KEY is set. */
  deepseek?: DeepSeekConfig;
  /** Present iff OLLAMA_ENABLED, OLLAMA_BASE_URL, or OLLAMA_API_KEY is set. */
  ollama?: OllamaConfig;
  /** Present iff ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set. */
  anthropic?: AnthropicConfig;
}

/**
 * Build a Config from a (potentially partial) environment map.
 *
 * Recognised variables:
 *   ANTHROPIC_API_KEY     enable Anthropic provider
 *   ANTHROPIC_AUTH_TOKEN  enable Anthropic Bearer-token provider auth
 *   ANTHROPIC_BASE_URL    optional override for the Anthropic endpoint
 *   OPENAI_API_KEY        enable OpenAI / OpenAI-compatible provider
 *   OPENAI_BASE_URL       legacy OpenAI-compatible endpoint override
 *   OPENAI_COMPATIBLE_API_KEY enable OpenAI-compatible provider
 *   OPENAI_COMPATIBLE_BASE_URL optional OpenAI-compatible endpoint override
 *   DEEPSEEK_API_KEY      enable DeepSeek provider
 *   DEEPSEEK_BASE_URL     optional override for the DeepSeek endpoint
 *   DEEPSEEK_BETA_BASE_URL optional override for DeepSeek beta endpoint
 *   OLLAMA_ENABLED        set to 1/true to enable local Ollama
 *   OLLAMA_BASE_URL       optional Ollama native API base URL
 *   OLLAMA_API_KEY        optional Bearer token for remote Ollama
 *   OLLAMA_THINK          off or passthrough
 *   OLLAMA_KEEP_ALIVE     optional Ollama keep_alive value
 *   SMART_MODEL           override the model bound to the 'smart' mode
 *   DEEP_MODEL            override the model bound to the 'deep' mode
 *   RUSH_MODEL            override the model bound to the 'rush' mode
 *   ANTHROPIC_DEFAULT_OPUS_MODEL   Anthropic-provider fallback for 'smart'
 *   ANTHROPIC_DEFAULT_SONNET_MODEL Anthropic-provider fallback for 'rush'
 *   ANTHROPIC_DEFAULT_HAIKU_MODEL  Anthropic-provider fallback for 'rush' if Sonnet is unset
 *   SMART_REASONING_EFFORT optional reasoning effort for 'smart'
 *   DEEP_REASONING_EFFORT  optional reasoning effort for 'deep'
 *   RUSH_REASONING_EFFORT  optional reasoning effort for 'rush' (default medium)
 *   VOS_LLM_MAX_RETRIES    provider-neutral retries above routing (default 0)
 *
 * Throws if no provider is configured.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  settings: SettingsInput = {},
): Config {
  const openaiApiKey = trimToUndefined(env.OPENAI_API_KEY);
  const openaiBaseUrl = trimToUndefined(env.OPENAI_BASE_URL);
  const openaiCompatibleApiKey = trimToUndefined(env.OPENAI_COMPATIBLE_API_KEY) ?? (openaiBaseUrl ? openaiApiKey : undefined);
  const deepseekApiKey = trimToUndefined(env.DEEPSEEK_API_KEY);
  const ollamaEnabled = truthyEnv(env.OLLAMA_ENABLED);
  const ollamaBaseUrl = trimToUndefined(env.OLLAMA_BASE_URL);
  const ollamaApiKey = trimToUndefined(env.OLLAMA_API_KEY);
  const anthropicApiKey = trimToUndefined(env.ANTHROPIC_API_KEY);
  const anthropicAuthToken = trimToUndefined(env.ANTHROPIC_AUTH_TOKEN);

  const openai = openaiApiKey && !openaiBaseUrl
    ? { apiKey: openaiApiKey, baseURL: undefined }
    : undefined;
  const openaiCompatible = openaiCompatibleApiKey
    ? {
        apiKey: openaiCompatibleApiKey,
        baseURL: trimToUndefined(env.OPENAI_COMPATIBLE_BASE_URL) ?? openaiBaseUrl,
        responseFormat: readOpenAICompatibleResponseFormat(env),
        reasoningEffort: readOpenAICompatibleReasoningEffort(env),
        streamUsage: readOpenAICompatibleStreamUsage(env),
        input: readOpenAICompatibleInput(env),
        extraHeaders: readOpenAICompatibleExtraHeaders(env),
      }
    : undefined;
  const deepseek = deepseekApiKey
    ? {
        apiKey: deepseekApiKey,
        baseURL: trimToUndefined(env.DEEPSEEK_BASE_URL),
        betaBaseURL: trimToUndefined(env.DEEPSEEK_BETA_BASE_URL),
      }
    : undefined;
  const ollama = ollamaEnabled || ollamaBaseUrl || ollamaApiKey
    ? {
        baseURL: ollamaBaseUrl ?? "http://localhost:11434/api",
        apiKey: ollamaApiKey,
        think: readOllamaThink(env),
        keepAlive: trimToUndefined(env.OLLAMA_KEEP_ALIVE),
      }
    : undefined;
  const anthropic = anthropicApiKey || anthropicAuthToken
    ? {
        ...(anthropicApiKey
          ? { apiKey: anthropicApiKey }
          : { authToken: anthropicAuthToken }),
        baseURL: trimToUndefined(env.ANTHROPIC_BASE_URL),
      }
    : undefined;

  if (!openai && !openaiCompatible && !deepseek && !ollama && !anthropic) {
    throw new Error(
      "no provider configured: set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY, OPENAI_COMPATIBLE_API_KEY, DEEPSEEK_API_KEY, and/or OLLAMA_ENABLED",
    );
  }

  const anthropicDefaultOpusModel = anthropic
    ? readAnthropicDefaultModel(env, "ANTHROPIC_DEFAULT_OPUS_MODEL")
    : undefined;
  const anthropicDefaultSonnetModel = anthropic
    ? readAnthropicDefaultModel(env, "ANTHROPIC_DEFAULT_SONNET_MODEL")
    : undefined;
  const anthropicDefaultHaikuModel = anthropic
    ? readAnthropicDefaultModel(env, "ANTHROPIC_DEFAULT_HAIKU_MODEL")
    : undefined;

  const modes = mergeSettingsModes({
    smart: modeDefinition(DEFAULT_SMART_MODEL, undefined),
    deep: modeDefinition(DEFAULT_DEEP_MODEL, undefined),
    rush: modeDefinition(DEFAULT_RUSH_MODEL, DEFAULT_RUSH_REASONING_EFFORT),
  }, settings.modes ?? {});

  applyModeEnvOverrides(
    modes,
    "smart",
    trimToUndefined(env.SMART_MODEL) ?? anthropicDefaultOpusModel,
    readReasoningEffort(env, "SMART_REASONING_EFFORT"),
  );
  applyModeEnvOverrides(
    modes,
    "deep",
    trimToUndefined(env.DEEP_MODEL),
    readReasoningEffort(env, "DEEP_REASONING_EFFORT"),
  );
  applyModeEnvOverrides(
    modes,
    "rush",
    trimToUndefined(env.RUSH_MODEL)
      ?? anthropicDefaultSonnetModel
      ?? anthropicDefaultHaikuModel,
    readReasoningEffort(env, "RUSH_REASONING_EFFORT"),
  );

  return {
    defaultMode: trimToUndefined(settings.defaultMode) ?? DEFAULT_MODE,
    modes,
    tools: {
      disabled: uniqueStrings(settings.disabledTools ?? []),
      permissions: [...(settings.permissionRules ?? [])],
    },
    chatRetry: {
      maxRetries: readNonNegativeInteger(env, "VOS_LLM_MAX_RETRIES", 0),
      initialDelayMs: readNonNegativeInteger(
        env,
        "VOS_LLM_RETRY_INITIAL_DELAY_MS",
        200,
      ),
      maxDelayMs: readNonNegativeInteger(
        env,
        "VOS_LLM_RETRY_MAX_DELAY_MS",
        2_000,
      ),
    },
    openai,
    openaiCompatible,
    deepseek,
    ollama,
    anthropic,
  };
}

function truthyEnv(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase();
  return trimmed === "1" || trimmed === "true" || trimmed === "yes";
}

function readOllamaThink(env: Record<string, string | undefined>): OllamaThink {
  return readEnumEnv(env, "OLLAMA_THINK", ["off", "passthrough"], "off");
}

function readOpenAICompatibleResponseFormat(
  env: Record<string, string | undefined>,
): OpenAICompatibleResponseFormat {
  return readEnumEnv(env, "OPENAI_COMPATIBLE_RESPONSE_FORMAT", [
    "json_object",
    "json_schema",
    "none",
  ], "json_object");
}

function readOpenAICompatibleReasoningEffort(
  env: Record<string, string | undefined>,
): OpenAICompatibleReasoningEffort {
  return readEnumEnv(env, "OPENAI_COMPATIBLE_REASONING_EFFORT", [
    "off",
    "passthrough",
  ], "off");
}

function readOpenAICompatibleStreamUsage(
  env: Record<string, string | undefined>,
): OpenAICompatibleStreamUsage {
  return readEnumEnv(env, "OPENAI_COMPATIBLE_STREAM_USAGE", [
    "off",
    "include_usage",
  ], "off");
}

function readEnumEnv<T extends string>(
  env: Record<string, string | undefined>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = trimToUndefined(env[key]);
  if (!raw) return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`invalid ${key}: expected one of ${allowed.join(", ")}`);
}

function readOpenAICompatibleInput(
  env: Record<string, string | undefined>,
): Record<"text" | "image" | "pdf", boolean> {
  const raw = trimToUndefined(env.OPENAI_COMPATIBLE_INPUTS);
  const result = { text: false, image: false, pdf: false };
  if (!raw) {
    result.text = true;
    return result;
  }
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value !== "text" && value !== "image" && value !== "pdf") {
      throw new Error("invalid OPENAI_COMPATIBLE_INPUTS: expected comma-separated text, image, pdf");
    }
    result[value] = true;
  }
  return result;
}

function readOpenAICompatibleExtraHeaders(
  env: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const raw = trimToUndefined(env.OPENAI_COMPATIBLE_EXTRA_HEADERS_JSON);
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid OPENAI_COMPATIBLE_EXTRA_HEADERS_JSON: expected a JSON object with string values");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid OPENAI_COMPATIBLE_EXTRA_HEADERS_JSON: expected a JSON object with string values");
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error("invalid OPENAI_COMPATIBLE_EXTRA_HEADERS_JSON: expected a JSON object with string values");
    }
    headers[key] = value;
  }
  return headers;
}

/**
 * Resolve a mode name to its model identifier. Throws with a clear
 * message listing the known modes if the name is unrecognised.
 */
export function resolveMode(config: Config, mode: string): string {
  return resolveModeDefinition(config, mode).model;
}

export function resolveModeDefinition(config: Config, mode: string): ModeDefinition {
  const def = config.modes[mode];
  if (!def) {
    const known = Object.keys(config.modes).sort().join(", ");
    throw new Error(`unknown mode "${mode}". known modes: ${known}`);
  }
  return def;
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readAnthropicDefaultModel(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const model = trimToUndefined(env[key]);
  if (!model) return undefined;
  if (model.startsWith("anthropic:") || model.startsWith("anthropic/")) {
    return model;
  }
  return `anthropic:${model}`;
}

function modeDefinition(
  model: string,
  reasoningEffort: ReasoningEffort | undefined,
): ModeDefinition {
  return {
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

function mergeSettingsModes(
  base: Record<string, ModeDefinition>,
  settingsModes: Record<string, SettingsModeDefinition>,
): Record<string, ModeDefinition> {
  const modes: Record<string, ModeDefinition> = {};
  for (const [name, def] of Object.entries(base)) {
    modes[name] = { ...def };
  }
  for (const [name, def] of Object.entries(settingsModes)) {
    const existing = modes[name];
    const model = trimToUndefined(def.model) ?? existing?.model;
    if (!model) {
      throw new Error(
        `invalid settings mode "${name}": model is required for custom modes`,
      );
    }
    const reasoningEffort = def.reasoningEffort ?? existing?.reasoningEffort;
    if (reasoningEffort !== undefined && !isReasoningEffort(reasoningEffort)) {
      throw new Error(`invalid settings mode "${name}": reasoningEffort is invalid`);
    }
    modes[name] = modeDefinition(model, reasoningEffort);
  }
  return modes;
}

function applyModeEnvOverrides(
  modes: Record<string, ModeDefinition>,
  name: string,
  model: string | undefined,
  reasoningEffort: ReasoningEffort | undefined,
): void {
  const existing = modes[name];
  modes[name] = modeDefinition(
    model ?? existing.model,
    reasoningEffort ?? existing.reasoningEffort,
  );
}

function readReasoningEffort(
  env: Record<string, string | undefined>,
  key: string,
): ReasoningEffort | undefined {
  const value = trimToUndefined(env[key]);
  if (!value) return undefined;
  if (isReasoningEffort(value)) {
    return value;
  }
  const known = Array.from(REASONING_EFFORTS).join(", ");
  throw new Error(`invalid ${key}: "${value}". known reasoning efforts: ${known}`);
}

function readNonNegativeInteger(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: number,
): number {
  const value = trimToUndefined(env[key]);
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`invalid ${key}: expected a non-negative integer`);
  }
  return parsed;
}

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORTS.has(value as ReasoningEffort);
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
