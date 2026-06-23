import { posix } from "node:path";
import { parseToolArguments } from "./common.ts";
import type {
  ToolExecutionRequest,
  ToolPolicy,
  ToolPolicyDecision,
} from "./types.ts";

export type PermissionAction = "allow" | "ask" | "reject";
export type PermissionTarget = "tool" | "path" | "command";
export type PermissionMatcher = "glob" | "regex";

export interface PermissionRule {
  action: PermissionAction;
  /** Optional tool name. Omit to match every tool. Compared case-insensitively. */
  tool?: string;
  /** Target value to match. Defaults to the request's path/command when a pattern is present. */
  target?: PermissionTarget;
  /** Pattern matcher. Defaults to glob for non-command targets and regex for command targets. */
  match?: PermissionMatcher;
  /** Optional pattern matched against the selected target. Omit to match the whole tool call. */
  pattern?: string;
  /** Human-facing explanation returned when the rule rejects or cannot be approved. */
  reason?: string;
}

export interface ToolApprovalRequest {
  toolName: string;
  argumentsJson: string;
  rule: PermissionRule;
  target: PermissionTarget;
  targetValue: string;
  reason?: string;
}

export type ToolApprovalHandler = (
  request: ToolApprovalRequest,
) => boolean | Promise<boolean>;

export interface PermissionPolicyOptions {
  /** User/workspace rules, evaluated before built-in guarded-file rules. */
  rules?: readonly PermissionRule[];
  /** Extra path patterns converted to ask-rules for Write/Edit. */
  guardedFilePatterns?: readonly string[];
  /** Interactive approval hook for ask-rules. Absence means ask-rules deny safely. */
  approve?: ToolApprovalHandler;
}

export const defaultGuardedFilePatterns = Object.freeze([
  ".env*",
  "**/.env*",
  "*.pem",
  "**/*.pem",
  "*.key",
  "**/*.key",
  "id_rsa",
  "**/id_rsa",
  "id_ed25519",
  "**/id_ed25519",
  ".ssh/**",
  "**/.ssh/**",
]);

const defaultDangerousCommandRules = Object.freeze([
  {
    action: "reject",
    tool: "Vos",
    target: "command",
    match: "regex",
    pattern: "(^|[;&|])\\s*sudo\\b",
    reason: "sudo requires manual shell approval",
  },
  {
    action: "reject",
    tool: "Vos",
    target: "command",
    match: "regex",
    pattern: "(^|[;&|])\\s*rm\\s+-rf\\s+(/|~|\\$HOME)(\\s|$)",
    reason: "refusing destructive rm -rf target",
  },
  {
    action: "reject",
    tool: "Bash",
    target: "command",
    match: "regex",
    pattern: "(^|[;&|])\\s*sudo\\b",
    reason: "sudo requires manual shell approval",
  },
  {
    action: "reject",
    tool: "Bash",
    target: "command",
    match: "regex",
    pattern: "(^|[;&|])\\s*rm\\s+-rf\\s+(/|~|\\$HOME)(\\s|$)",
    reason: "refusing destructive rm -rf target",
  },
] satisfies readonly PermissionRule[]);

export function createDefaultPermissionPolicy(
  opts: Omit<PermissionPolicyOptions, "guardedFilePatterns"> = {},
): ToolPolicy {
  return createPermissionPolicy({
    ...opts,
    guardedFilePatterns: defaultGuardedFilePatterns,
    rules: [
      ...(opts.rules ?? []),
      ...defaultDangerousCommandRules,
    ],
  });
}

export function createPermissionPolicy(
  opts: PermissionPolicyOptions = {},
): ToolPolicy {
  const rules = [
    ...(opts.rules ?? []),
    ...guardedFileRules(opts.guardedFilePatterns ?? []),
  ];

  return {
    canExecute: async (request) => evaluatePermissionRules(request, rules, opts.approve),
  };
}

async function evaluatePermissionRules(
  request: ToolExecutionRequest,
  rules: readonly PermissionRule[],
  approve: ToolApprovalHandler | undefined,
): Promise<ToolPolicyDecision> {
  for (const rule of rules) {
    const match = matchRule(request, rule);
    if (!match) continue;

    if (rule.action === "allow") {
      return { allowed: true };
    }
    if (rule.action === "reject") {
      return {
        allowed: false,
        reason: rule.reason ?? defaultRejectReason(request.name, match),
      };
    }

    if (!approve) {
      return {
        allowed: false,
        reason: rule.reason ?? `requires approval for ${request.name} on ${match.value}`,
      };
    }

    const approved = await approve({
      toolName: request.name,
      argumentsJson: request.argumentsJson,
      rule,
      target: match.target,
      targetValue: match.value,
      ...(rule.reason ? { reason: rule.reason } : {}),
    });
    if (approved) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: rule.reason ?? `approval denied for ${request.name} on ${match.value}`,
    };
  }
  return { allowed: true };
}

function guardedFileRules(patterns: readonly string[]): PermissionRule[] {
  return patterns.flatMap((pattern) => [
    {
      action: "ask" as const,
      tool: "Write",
      target: "path" as const,
      match: "glob" as const,
      pattern,
    },
    {
      action: "ask" as const,
      tool: "Edit",
      target: "path" as const,
      match: "glob" as const,
      pattern,
    },
  ]);
}

type RuleMatch = { target: PermissionTarget; value: string };

function matchRule(
  request: ToolExecutionRequest,
  rule: PermissionRule,
): RuleMatch | undefined {
  if (
    rule.tool !== undefined &&
    normalizeToolName(rule.tool) !== normalizeToolName(request.name)
  ) {
    return undefined;
  }

  const target = selectTarget(request, rule);
  if (!target) return undefined;
  if (rule.pattern === undefined) return target;

  const matcher = rule.match ?? defaultMatcher(target.target);
  if (matcher === "regex") {
    return new RegExp(rule.pattern).test(target.value) ? target : undefined;
  }

  const glob = new Bun.Glob(rule.pattern);
  return glob.match(target.value) ? target : undefined;
}

function selectTarget(
  request: ToolExecutionRequest,
  rule: PermissionRule,
): RuleMatch | undefined {
  if (rule.target === "tool") {
    return { target: "tool", value: request.name };
  }

  const args = parseArguments(request.argumentsJson);
  const requestedTarget = rule.target;
  if (requestedTarget === "command") {
    return stringArg(args, "command", "command");
  }
  if (requestedTarget === "path") {
    return pathTarget(args);
  }

  return stringArg(args, "command", "command")
    ?? pathTarget(args)
    ?? { target: "tool", value: request.name };
}

function parseArguments(argumentsJson: string): Record<string, unknown> | undefined {
  const parsed = parseToolArguments("permission policy", argumentsJson);
  return parsed.ok ? parsed.args : undefined;
}

function pathTarget(args: Record<string, unknown> | undefined): RuleMatch | undefined {
  return stringArg(args, "file_path", "path")
    ?? stringArg(args, "path", "path");
}

function stringArg(
  args: Record<string, unknown> | undefined,
  key: string,
  target: PermissionTarget,
): RuleMatch | undefined {
  const value = args?.[key];
  if (typeof value !== "string") return undefined;
  return { target, value: target === "path" ? normalizePathTarget(value) : value };
}

function normalizePathTarget(path: string): string {
  let normalized = posix.normalize(path.replace(/\\/g, "/"));
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function defaultMatcher(target: PermissionTarget): PermissionMatcher {
  return target === "command" ? "regex" : "glob";
}

function defaultRejectReason(toolName: string, match: RuleMatch): string {
  return `rejected by permission rule for ${toolName} on ${match.value}`;
}
