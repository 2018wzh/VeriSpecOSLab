import { parse as parseYaml } from "yaml";

interface ParsedYaml {
  [key: string]: unknown;
}

export interface TimelineStage {
  stage?: string;
  slice?: string;
  title?: string;
  validation_gate?: string[];
}

export function parseTopLevelYaml(text: string): ParsedYaml {
  const parsed = parseYaml(text);
  if (!isRecord(parsed)) return {};
  return parsed;
}

export function parseYamlScalar(raw: string): unknown {
  return parseYaml(raw);
}

export function extractTimelineStages(text: string): TimelineStage[] {
  const parsed = parseTopLevelYaml(text);
  const timeline = parsed.timeline;
  if (!Array.isArray(timeline)) return [];
  return timeline
    .filter(isRecord)
    .map((stage) => ({
      stage: optionalString(stage.stage),
      slice: optionalString(stage.slice),
      title: optionalString(stage.title),
      validation_gate: stringArray(stage.validation_gate),
    }))
    .filter((stage) => stage.stage || stage.slice || stage.title || stage.validation_gate);
}

export function formatSafeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function collectStringListByKey(value: unknown, key: string): string[] {
  const out: string[] = [];
  walkYaml(value, (record) => {
    const candidate = record[key];
    if (typeof candidate === "string") {
      out.push(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string") out.push(item);
      }
    }
  });
  return [...new Set(out)];
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string");
  return out.length > 0 ? out : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function walkYaml(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkYaml(item, visit);
    return;
  }
  if (!isRecord(value)) return;
  visit(value);
  for (const child of Object.values(value)) {
    walkYaml(child, visit);
  }
}
