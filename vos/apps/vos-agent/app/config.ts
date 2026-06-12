import type { SettingsInput, SettingsModeDefinition } from "./settings.ts";

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
}

export interface Config {
  /** Mode used when nothing more specific is set. */
  defaultMode: string;
  /** Available modes by name. */
  modes: Record<string, ModeDefinition>;
  /** Tool policy selected from settings. */
  tools: ToolConfig;
  /** Present iff OPENAI_API_KEY is set. */
  openai?: OpenAIConfig;
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
 *   OPENAI_BASE_URL       override for OpenRouter, vLLM, Ollama, …
 *   SMART_MODEL           override the model bound to the 'smart' mode
 *   DEEP_MODEL            override the model bound to the 'deep' mode
 *   RUSH_MODEL            override the model bound to the 'rush' mode
 *   ANTHROPIC_DEFAULT_OPUS_MODEL   Anthropic-provider fallback for 'smart'
 *   ANTHROPIC_DEFAULT_SONNET_MODEL Anthropic-provider fallback for 'rush'
 *   ANTHROPIC_DEFAULT_HAIKU_MODEL  Anthropic-provider fallback for 'rush' if Sonnet is unset
 *   SMART_REASONING_EFFORT optional reasoning effort for 'smart'
 *   DEEP_REASONING_EFFORT  optional reasoning effort for 'deep'
 *   RUSH_REASONING_EFFORT  optional reasoning effort for 'rush' (default medium)
 *
 * Throws if no provider is configured.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  settings: SettingsInput = {},
): Config {
  const openaiApiKey = trimToUndefined(env.OPENAI_API_KEY);
  const anthropicApiKey = trimToUndefined(env.ANTHROPIC_API_KEY);
  const anthropicAuthToken = trimToUndefined(env.ANTHROPIC_AUTH_TOKEN);

  const openai = openaiApiKey
    ? { apiKey: openaiApiKey, baseURL: trimToUndefined(env.OPENAI_BASE_URL) }
    : undefined;
  const anthropic = anthropicApiKey || anthropicAuthToken
    ? {
        ...(anthropicApiKey
          ? { apiKey: anthropicApiKey }
          : { authToken: anthropicAuthToken }),
        baseURL: trimToUndefined(env.ANTHROPIC_BASE_URL),
      }
    : undefined;

  if (!openai && !anthropic) {
    throw new Error(
      "no provider configured: set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, and/or OPENAI_API_KEY",
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
    tools: { disabled: uniqueStrings(settings.disabledTools ?? []) },
    openai,
    anthropic,
  };
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
