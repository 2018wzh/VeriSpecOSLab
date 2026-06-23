export type ModelProvider = "anthropic" | "openai";

export interface ModelPricing {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export interface ModelCatalogEntry {
  id: string;
  provider: ModelProvider;
  contextWindowTokens: number;
  pricing?: ModelPricing;
  aliases?: readonly string[];
}

export interface ModelUsageForPricing {
  inputTokens: number;
  outputTokens: number;
}

export const modelCatalog = Object.freeze([
  {
    id: "opus4.7",
    provider: "anthropic",
    contextWindowTokens: 200_000,
    pricing: { inputUsdPerMillionTokens: 15, outputUsdPerMillionTokens: 75 },
  },
  {
    id: "sonnet4.6",
    provider: "anthropic",
    contextWindowTokens: 200_000,
    pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
  },
  {
    id: "haiku4.6",
    provider: "anthropic",
    contextWindowTokens: 200_000,
    pricing: { inputUsdPerMillionTokens: 0.8, outputUsdPerMillionTokens: 4 },
    aliases: ["claude-haiku-4.6"],
  },
  {
    id: "gpt5.5",
    provider: "openai",
    contextWindowTokens: 400_000,
  },
] satisfies readonly ModelCatalogEntry[]);

export function lookupModel(model: string): ModelCatalogEntry | undefined {
  const normalized = normalizeModelId(model);
  return modelCatalog.find((entry) =>
    normalizeModelId(entry.id) === normalized ||
    (entry.aliases ?? []).some((alias) => normalizeModelId(alias) === normalized)
  );
}

export function estimateModelUsageCostUsd(
  model: string,
  usage: ModelUsageForPricing,
): number | undefined {
  const pricing = lookupModel(model)?.pricing;
  if (!pricing) return undefined;
  const inputCost = usage.inputTokens / 1_000_000 * pricing.inputUsdPerMillionTokens;
  const outputCost = usage.outputTokens / 1_000_000 * pricing.outputUsdPerMillionTokens;
  return roundUsd(inputCost + outputCost);
}

export function contextWindowUsage(
  model: string,
  inputTokens: number,
): number | undefined {
  const contextWindowTokens = lookupModel(model)?.contextWindowTokens;
  if (!contextWindowTokens) return undefined;
  return inputTokens / contextWindowTokens;
}

export function normalizeModelId(model: string): string {
  const trimmed = model.trim().toLowerCase();
  if (trimmed.startsWith("anthropic:")) return trimmed.slice("anthropic:".length);
  if (trimmed.startsWith("openai:")) return trimmed.slice("openai:".length);
  return trimmed;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}
