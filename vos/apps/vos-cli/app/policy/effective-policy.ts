import path from "node:path";
import { CliError } from "../errors.ts";
import type { EffectivePolicy, PolicySnapshot } from "../types.ts";
import type { PolicyConfig } from "../utils/project.ts";

export function mergeEffectivePolicy(params: {
  portal?: PolicySnapshot;
  local: PolicyConfig;
}): EffectivePolicy {
  const localCommands = normalizeCommands(params.local.allowed_commands ?? []);
  const localPaths = normalizePaths(params.local.allowed_paths ?? []);
  if (!params.portal) {
    return {
      source: "local",
      allowedCommands: localCommands,
      allowedPaths: localPaths,
      visibilityScope: params.local.visibility_scope ?? "public",
    };
  }

  const portalCommands = normalizeCommands(params.portal.allowedCommands);
  const portalPaths = normalizePaths(params.portal.allowedPaths);
  return {
    source: "portal",
    snapshotRef: params.portal.ref,
    allowedCommands: intersect(portalCommands, localCommands.length > 0 ? localCommands : portalCommands),
    allowedPaths: localPaths.length > 0
      ? localPaths.filter((entry) => isPathCoveredByAny(entry, portalPaths))
      : portalPaths,
    visibilityScope: stricterVisibility(params.portal.visibilityScope, params.local.visibility_scope ?? "public"),
  };
}

export function assertCommandAllowed(command: string[], policy: EffectivePolicy, localPolicy?: PolicyConfig): void {
  const intent = matchCommandIntent(command);
  const denied = normalizeCommands(localPolicy?.denied_commands ?? []);
  if (denied.includes(intent)) {
    throw new CliError("policy_blocked: command_denied", "policy_blocked", {
      reason: "command_denied",
      command: intent,
    });
  }
  if (policy.source === "portal" && policy.allowedCommands.length === 0) {
    throw new CliError("policy_blocked: command_denied", "policy_blocked", {
      reason: "command_denied",
      command: intent,
    });
  }
  if (policy.allowedCommands.length > 0 && !policy.allowedCommands.includes(intent)) {
    throw new CliError("policy_blocked: command_denied", "policy_blocked", {
      reason: "command_denied",
      command: intent,
    });
  }
}

export function matchCommandIntent(command: readonly string[]): string {
  if (command.length === 0) return "";
  if (command[0] === "spec" && command[1] === "lint") return "spec lint";
  if (command[0] === "spec" && command[1] === "normalize") return "spec normalize";
  if (command[0] === "spec" && command[1] === "check-consistency") return "spec check-consistency";
  if (command[0] === "spec" && command[1] === "patch" && command[2] === "lint") return "spec patch lint";
  if (command[0] === "spec" && command[1] === "patch" && command[2] === "apply") return "spec patch apply";
  if (command[0] === "arch" && command[1] === "lint") return "arch lint";
  if (command[0] === "arch" && command[1] === "compose") return "arch compose";
  if (command[0] === "arch" && command[1] === "derive-tests") return "arch derive-tests";
  if (command[0] === "build" && command[1] === "generate") return "build generate";
  if (command[0] === "run" && command[1] === "qemu") return "run qemu";
  if (command[0] === "ledger" && command[1] === "record") return "ledger record";
  if (command[0] === "verify" && command[1]) return `verify ${command[1]}`;
  if (command[0] === "trace" && command[1] === "syscall") return "trace syscall";
  if (command[0] === "debug" && command[1] === "explain-log") return "debug explain-log";
  if (command[0] === "report" && command[1] === "generate") return "report generate";
  if (command[0] === "submit" && command[1] === "pack") return "submit pack";
  if (command[0] === "agent" && command[1]) return `agent ${command[1]}`;
  return command[0] ?? "";
}

function normalizeCommands(commands: readonly string[]): string[] {
  return [...new Set(commands.map((command) => command.trim().replace(/\s+/g, " ")).filter(Boolean))];
}

function normalizePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizePath).filter(Boolean))];
}

function normalizePath(raw: string): string {
  return path.normalize(raw.trim()).replace(/\\/g, "/").replace(/^\.\//, "");
}

function intersect<T>(left: readonly T[], right: readonly T[]): T[] {
  const rightSet = new Set(right);
  return left.filter((entry) => rightSet.has(entry));
}

function isPathCoveredByAny(candidate: string, allowed: readonly string[]): boolean {
  const normalized = normalizePath(candidate);
  return allowed.some((entry) => {
    const prefix = normalizePath(entry);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

function stricterVisibility(left: "public" | "agent-only", right: "public" | "agent-only"): "public" | "agent-only" {
  return left === "agent-only" || right === "agent-only" ? "agent-only" : "public";
}
