import { spawnSync } from "node:child_process";
import type { RequiredToolV2 } from "./manifest.ts";

export interface ToolVersionProbe {
  name: string;
  command: string;
  kind: string;
  version_constraint: string;
  detected_version: string;
  raw_output: string;
}

export function probeRequiredTools(requiredTools: RequiredToolV2[]): ToolVersionProbe[] {
  return requiredTools.map((tool) => {
    const args = tool.version_args.length > 0 ? tool.version_args : ["--version"];
    const proc = spawnSync(tool.command, args, { encoding: "utf8" });
    if (proc.error) {
      throw new Error(`required tool ${tool.name} not available: ${proc.error.message}`);
    }
    if (proc.status !== 0) {
      throw new Error(`required tool ${tool.name} version probe failed`);
    }
    const raw = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
    const detected = extractVersion(raw, tool.version_regex);
    if (!satisfiesVersion(detected, tool.version_constraint)) {
      throw new Error(`required tool ${tool.name} version ${detected} does not satisfy ${tool.version_constraint}`);
    }
    return {
      name: tool.name,
      command: tool.command,
      kind: tool.kind,
      version_constraint: tool.version_constraint,
      detected_version: detected,
      raw_output: raw,
    };
  });
}

function extractVersion(raw: string, regex?: string): string {
  if (regex) {
    const match = new RegExp(regex).exec(raw);
    if (match?.[1]) return match[1];
  }
  const match = /(\d+(?:\.\d+){0,3})/.exec(raw);
  if (!match) throw new Error(`could not parse tool version from: ${raw.slice(0, 120)}`);
  return match[1];
}

function satisfiesVersion(version: string, constraint: string): boolean {
  const trimmed = constraint.trim();
  const match = /^(>=|<=|>|<|=|==)?\s*v?(\d+(?:\.\d+){0,3})$/.exec(trimmed);
  if (!match) throw new Error(`unsupported version constraint: ${constraint}`);
  const op = match[1] ?? ">=";
  const cmp = compareVersions(version, match[2]);
  if (op === ">=") return cmp >= 0;
  if (op === "<=") return cmp <= 0;
  if (op === ">") return cmp > 0;
  if (op === "<") return cmp < 0;
  return cmp === 0;
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number(part));
  const b = right.split(".").map((part) => Number(part));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
