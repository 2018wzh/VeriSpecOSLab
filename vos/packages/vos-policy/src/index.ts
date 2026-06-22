import type { CommandStatus, RunEvent } from "vos-core";

export type VisibilityScope = "public" | "agent-only" | "staff-only";
export type PathScope = VisibilityScope;

export interface AssertionPolicy {
  source: "portal" | "local" | "runtime";
  allowedCommands: string[];
  allowedPaths: string[];
  visibilityScope: VisibilityScope;
  deniedCommands: string[];
  snapshotRef?: string;
}

export interface ToolWhitelist {
  commands: string[];
  paths: string[];
  visibility: VisibilityScope;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  visibility?: VisibilityScope;
}

export interface PolicyDecisionEvent extends Omit<RunEvent, "type"> {
  type: "policy_allowed" | "policy_denied";
  status: CommandStatus;
}

export function assertCommandAllowed(command: string[], policy: AssertionPolicy): PolicyDecision {
  const intent = command.join(" ").trim();
  if (!intent) {
    return { allowed: false, reason: "empty_command" };
  }
  if (policy.deniedCommands.includes(intent)) {
    return { allowed: false, reason: "denied_by_policy" };
  }
  if (policy.allowedCommands.length > 0 && !policy.allowedCommands.includes(intent)) {
    return { allowed: false, reason: "not_in_allowed_commands" };
  }
  return { allowed: true, visibility: policy.visibilityScope };
}

export function mergeEffectivePolicy(local: AssertionPolicy, portal?: AssertionPolicy): AssertionPolicy {
  if (!portal) return local;
  const portalSet = new Set(portal.allowedCommands);
  const allowedCommands = local.allowedCommands.length > 0
    ? local.allowedCommands.filter((command) => portalSet.has(command) || portalSet.size === 0)
    : local.allowedCommands;
  const localPaths = new Set(local.allowedPaths);
  const allowedPaths = [...new Set([...portal.allowedPaths.filter((path) => localPaths.has(path)), ...local.allowedPaths])];

  return {
    source: "local",
    allowedCommands: local.allowedCommands.length > 0
      ? allowedCommands
      : [...portal.allowedCommands],
    allowedPaths,
    visibilityScope: stricterVisibility(portal.visibilityScope, local.visibilityScope),
    deniedCommands: [...new Set([...local.deniedCommands, ...portal.deniedCommands])],
    snapshotRef: portal.snapshotRef,
  };
}

function stricterVisibility(left: VisibilityScope, right: VisibilityScope): VisibilityScope {
  const rank = { public: 0, "agent-only": 1, "staff-only": 2 };
  return rank[left] >= rank[right] ? left : right;
}

export function defaultPolicy(): AssertionPolicy {
  return {
    source: "local",
    allowedCommands: [],
    allowedPaths: ["src", "spec", "tests", ".vos"],
    visibilityScope: "public",
    deniedCommands: [],
  };
}
