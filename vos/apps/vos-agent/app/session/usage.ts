import type { ChatUsage } from "../agent/loop.ts";
import {
  contextWindowUsage,
  estimateModelUsageCostUsd,
  lookupModel,
  normalizeModelId,
} from "../llm/model-registry.ts";
import type {
  ModelUsageEvent,
  StoredModelUsage,
  StoredThreadUsage,
} from "./types.ts";

export function emptyThreadUsage(): StoredThreadUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    byModel: [],
  };
}

export function cloneThreadUsage(
  usage: StoredThreadUsage | undefined,
): StoredThreadUsage {
  return usage ? JSON.parse(JSON.stringify(usage)) as StoredThreadUsage : emptyThreadUsage();
}

export function addModelUsage(
  threadUsage: StoredThreadUsage,
  model: string,
  usage: ChatUsage,
): ModelUsageEvent {
  const normalized = normalizeUsage(usage);
  const modelInfo = lookupModel(model);
  const estimatedCostUsd = estimateModelUsageCostUsd(model, normalized);
  const modelContextWindowUsage = contextWindowUsage(model, normalized.inputTokens);
  const event: ModelUsageEvent = {
    model,
    ...(modelInfo?.provider ? { provider: modelInfo.provider } : {}),
    inputTokens: normalized.inputTokens,
    outputTokens: normalized.outputTokens,
    totalTokens: normalized.totalTokens,
    ...(normalized.cachedInputTokens ? { cachedInputTokens: normalized.cachedInputTokens } : {}),
    ...(normalized.cacheCreationInputTokens
      ? { cacheCreationInputTokens: normalized.cacheCreationInputTokens }
      : {}),
    ...(modelInfo?.contextWindowTokens
      ? { contextWindowTokens: modelInfo.contextWindowTokens }
      : {}),
    ...(modelContextWindowUsage !== undefined
      ? { contextWindowUsage: modelContextWindowUsage }
      : {}),
    ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
  };

  threadUsage.inputTokens += normalized.inputTokens;
  threadUsage.outputTokens += normalized.outputTokens;
  threadUsage.totalTokens += normalized.totalTokens;
  if (normalized.cachedInputTokens) {
    threadUsage.cachedInputTokens =
      (threadUsage.cachedInputTokens ?? 0) + normalized.cachedInputTokens;
  }
  if (normalized.cacheCreationInputTokens) {
    threadUsage.cacheCreationInputTokens =
      (threadUsage.cacheCreationInputTokens ?? 0) + normalized.cacheCreationInputTokens;
  }
  if (estimatedCostUsd !== undefined) {
    threadUsage.estimatedCostUsd =
      roundUsd((threadUsage.estimatedCostUsd ?? 0) + estimatedCostUsd);
  }

  const normalizedModel = normalizeModelId(model);
  const existing = threadUsage.byModel.find((entry) =>
    normalizeModelId(entry.model) === normalizedModel
  );
  if (existing) {
    addUsageTotals(existing, normalized);
    if (estimatedCostUsd !== undefined) {
      existing.estimatedCostUsd =
        roundUsd((existing.estimatedCostUsd ?? 0) + estimatedCostUsd);
    }
    if (modelContextWindowUsage !== undefined) {
      existing.lastContextWindowUsage = modelContextWindowUsage;
    }
    if (modelInfo?.contextWindowTokens) {
      existing.contextWindowTokens = modelInfo.contextWindowTokens;
    }
    if (modelInfo?.provider) {
      existing.provider = modelInfo.provider;
    }
  } else {
    threadUsage.byModel.push({
      model,
      ...(modelInfo?.provider ? { provider: modelInfo.provider } : {}),
      inputTokens: normalized.inputTokens,
      outputTokens: normalized.outputTokens,
      totalTokens: normalized.totalTokens,
      ...(normalized.cachedInputTokens ? { cachedInputTokens: normalized.cachedInputTokens } : {}),
      ...(normalized.cacheCreationInputTokens
        ? { cacheCreationInputTokens: normalized.cacheCreationInputTokens }
        : {}),
      ...(modelInfo?.contextWindowTokens
        ? { contextWindowTokens: modelInfo.contextWindowTokens }
        : {}),
      ...(modelContextWindowUsage !== undefined
        ? { lastContextWindowUsage: modelContextWindowUsage }
        : {}),
      ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
    });
  }

  return event;
}

export function validateStoredThreadUsage(
  value: unknown,
  path: string,
): StoredThreadUsage {
  if (value === undefined) return emptyThreadUsage();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid thread file ${path}: usage must be an object`);
  }
  const raw = value as Partial<StoredThreadUsage>;
  const usage: StoredThreadUsage = {
    inputTokens: requireNonNegativeNumber(raw.inputTokens, path, "usage.inputTokens"),
    outputTokens: requireNonNegativeNumber(raw.outputTokens, path, "usage.outputTokens"),
    totalTokens: requireNonNegativeNumber(raw.totalTokens, path, "usage.totalTokens"),
    byModel: [],
  };
  if (raw.cachedInputTokens !== undefined) {
    usage.cachedInputTokens = requireNonNegativeNumber(
      raw.cachedInputTokens,
      path,
      "usage.cachedInputTokens",
    );
  }
  if (raw.cacheCreationInputTokens !== undefined) {
    usage.cacheCreationInputTokens = requireNonNegativeNumber(
      raw.cacheCreationInputTokens,
      path,
      "usage.cacheCreationInputTokens",
    );
  }
  if (raw.estimatedCostUsd !== undefined) {
    usage.estimatedCostUsd = requireNonNegativeNumber(
      raw.estimatedCostUsd,
      path,
      "usage.estimatedCostUsd",
    );
  }
  if (raw.byModel !== undefined) {
    if (!Array.isArray(raw.byModel)) {
      throw new Error(`invalid thread file ${path}: usage.byModel must be an array`);
    }
    usage.byModel = raw.byModel.map((entry, index) =>
      validateStoredModelUsage(entry, path, `usage.byModel[${index}]`)
    );
  }
  return usage;
}

export function formatModelUsage(event: ModelUsageEvent): string {
  const parts = [
    `usage: ${event.model}`,
    `${event.inputTokens} in`,
    `${event.outputTokens} out`,
    `${event.totalTokens} total`,
  ];
  if (event.contextWindowUsage !== undefined && event.contextWindowTokens !== undefined) {
    parts.push(`${formatPercent(event.contextWindowUsage)} of ${event.contextWindowTokens} context`);
  }
  if (event.estimatedCostUsd !== undefined) {
    parts.push(`est. $${event.estimatedCostUsd.toFixed(6)}`);
  }
  return parts.join(" | ");
}

type NormalizedUsage =
  Required<Pick<ChatUsage, "inputTokens" | "outputTokens" | "totalTokens">> &
  Pick<ChatUsage, "cachedInputTokens" | "cacheCreationInputTokens">;

function normalizeUsage(usage: ChatUsage): NormalizedUsage {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    ...(usage.cachedInputTokens ? { cachedInputTokens: usage.cachedInputTokens } : {}),
    ...(usage.cacheCreationInputTokens
      ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
      : {}),
  };
}

function addUsageTotals(target: StoredModelUsage, usage: NormalizedUsage): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.totalTokens += usage.totalTokens;
  if (usage.cachedInputTokens) {
    target.cachedInputTokens = (target.cachedInputTokens ?? 0) + usage.cachedInputTokens;
  }
  if (usage.cacheCreationInputTokens) {
    target.cacheCreationInputTokens =
      (target.cacheCreationInputTokens ?? 0) + usage.cacheCreationInputTokens;
  }
}

function validateStoredModelUsage(
  value: unknown,
  path: string,
  settingPath: string,
): StoredModelUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid thread file ${path}: ${settingPath} must be an object`);
  }
  const raw = value as Partial<StoredModelUsage>;
  if (typeof raw.model !== "string" || raw.model.trim().length === 0) {
    throw new Error(`invalid thread file ${path}: ${settingPath}.model must be a non-empty string`);
  }
  const usage: StoredModelUsage = {
    model: raw.model,
    inputTokens: requireNonNegativeNumber(
      raw.inputTokens,
      path,
      `${settingPath}.inputTokens`,
    ),
    outputTokens: requireNonNegativeNumber(
      raw.outputTokens,
      path,
      `${settingPath}.outputTokens`,
    ),
    totalTokens: requireNonNegativeNumber(
      raw.totalTokens,
      path,
      `${settingPath}.totalTokens`,
    ),
  };
  if (raw.provider !== undefined) {
    if (raw.provider !== "anthropic" && raw.provider !== "openai") {
      throw new Error(`invalid thread file ${path}: ${settingPath}.provider is invalid`);
    }
    usage.provider = raw.provider;
  }
  if (raw.cachedInputTokens !== undefined) {
    usage.cachedInputTokens = requireNonNegativeNumber(
      raw.cachedInputTokens,
      path,
      `${settingPath}.cachedInputTokens`,
    );
  }
  if (raw.cacheCreationInputTokens !== undefined) {
    usage.cacheCreationInputTokens = requireNonNegativeNumber(
      raw.cacheCreationInputTokens,
      path,
      `${settingPath}.cacheCreationInputTokens`,
    );
  }
  if (raw.contextWindowTokens !== undefined) {
    usage.contextWindowTokens = requireNonNegativeNumber(
      raw.contextWindowTokens,
      path,
      `${settingPath}.contextWindowTokens`,
    );
  }
  if (raw.lastContextWindowUsage !== undefined) {
    usage.lastContextWindowUsage = requireNonNegativeNumber(
      raw.lastContextWindowUsage,
      path,
      `${settingPath}.lastContextWindowUsage`,
    );
  }
  if (raw.estimatedCostUsd !== undefined) {
    usage.estimatedCostUsd = requireNonNegativeNumber(
      raw.estimatedCostUsd,
      path,
      `${settingPath}.estimatedCostUsd`,
    );
  }
  return usage;
}

function requireNonNegativeNumber(
  value: unknown,
  path: string,
  settingPath: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid thread file ${path}: ${settingPath} must be a non-negative number`);
  }
  return value;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
