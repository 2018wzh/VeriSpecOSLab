import { createHash } from "node:crypto";
import type { NormalizedModule, SpecDiagnostic } from "./types.ts";

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isSpecYamlPath(value: string): boolean {
  return value.startsWith("spec/") && /\.ya?ml$/i.test(value);
}

export function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export function byPath(a: { path: string }, b: { path: string }): number {
  return a.path.localeCompare(b.path);
}

export function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorDiagnostic(code: string, message: string, pathValue?: string, ref?: string): SpecDiagnostic {
  return { severity: "error", code, message, path: pathValue, ref };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function inferVisibility(pathValue: string): "public" | "agent-only" | "platform-only" {
  if (pathValue.includes("/hidden") || pathValue.includes("staff")) return "platform-only";
  if (pathValue.includes("/evolution/")) return "agent-only";
  return "public";
}

export function moduleMatches(candidate: string, ref: string): boolean {
  return candidate === ref || candidate.startsWith(`${ref}/`) || ref.startsWith(`${candidate}/`);
}

export function expandModuleRefs(refs: string[], modules: NormalizedModule[]): string[] {
  if (refs.length === 0) return modules.map((module) => module.module);
  const out = new Set<string>();
  for (const ref of refs) {
    for (const module of modules) {
      if (moduleMatches(module.module, ref)) out.add(module.module);
    }
  }
  return [...out].sort();
}

export function normalizeStringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (!isRecord(item)) return undefined;
      for (const key of ["id", "ref", "path", "module", "operation", "name", "test", "tag", "description"]) {
        const candidate = item[key];
        if (typeof candidate === "string" && candidate.trim()) return candidate;
      }
      return JSON.stringify(item);
    })
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
