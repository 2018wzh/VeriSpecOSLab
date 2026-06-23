import type OpenAI from "openai";
import { isAbortError, throwIfAborted } from "../cancellation.ts";
import { formatError } from "./common.ts";

/**
 * A Tool advertises a JSON schema to the LLM and executes calls.
 *
 * `execute` receives the raw `function.arguments` JSON string from the
 * OpenAI tool_call envelope, so each tool decides how strictly to validate.
 * It returns the string the agent loop should send back as the `tool`
 * message's `content`. Tools should never throw for "expected" failures
 * (file not found, command non-zero) — return an error string instead so
 * the agent can reason about it.
 */
export interface Tool {
  readonly name: string;
  readonly schema: OpenAI.Chat.ChatCompletionFunctionTool;
  execute(
    argumentsJson: string,
    context?: ToolExecutionContext,
  ): string | Promise<string>;
}

export interface ToolExecutionContext {
  signal?: AbortSignal;
}

export interface ToolExecutionRequest {
  name: string;
  argumentsJson: string;
}

export type ToolPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason?: string };

export interface ToolPolicy {
  /** Return false to hide a registered tool from model-visible schemas. */
  canAdvertise?: (tool: Tool) => boolean;
  /** Return allowed:false to deny an execution while still returning tool text. */
  canExecute?: (
    request: ToolExecutionRequest,
  ) => ToolPolicyDecision | Promise<ToolPolicyDecision>;
}

export interface ToolRegistryOptions {
  policy?: ToolPolicy;
}

/**
 * Holds the set of tools available to an agent and provides:
 *   - the schema list to send with each chat request
 *   - a single `execute(name, args)` dispatch entry-point
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly policy: ToolPolicy | undefined;

  constructor(tools: readonly Tool[] = [], opts: ToolRegistryOptions = {}) {
    this.policy = opts.policy;
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    const tool = this.tools.get(name);
    return tool !== undefined && this.canAdvertise(tool);
  }

  names(): string[] {
    return Array.from(this.tools.values())
      .filter((tool) => this.canAdvertise(tool))
      .map((tool) => tool.name);
  }

  schemas(): OpenAI.Chat.ChatCompletionFunctionTool[] {
    return Array.from(this.tools.values())
      .filter((tool) => this.canAdvertise(tool))
      .map((t) => t.schema);
  }

  async execute(
    name: string,
    argumentsJson: string,
    context: ToolExecutionContext = {},
  ): Promise<string> {
    throwIfAborted(context.signal);
    const tool = this.tools.get(name);
    if (!tool) {
      return `Unknown tool: ${name}`;
    }
    const policyDecision = await this.evaluatePolicy({ name, argumentsJson });
    throwIfAborted(context.signal);
    if (!policyDecision.allowed) {
      return formatPolicyDenied(name, policyDecision.reason);
    }
    try {
      const result = await tool.execute(argumentsJson, context);
      throwIfAborted(context.signal);
      return result;
    } catch (e) {
      throwIfAborted(context.signal);
      if (isAbortError(e)) throw e;
      return `Error executing tool "${name}": ${formatError(e)}`;
    }
  }

  private canAdvertise(tool: Tool): boolean {
    return this.policy?.canAdvertise?.(tool) ?? true;
  }

  private async evaluatePolicy(
    request: ToolExecutionRequest,
  ): Promise<ToolPolicyDecision> {
    try {
      return await this.policy?.canExecute?.(request) ?? { allowed: true };
    } catch (e) {
      return {
        allowed: false,
        reason: `policy error: ${formatError(e)}`,
      };
    }
  }
}

export function createDisabledToolsPolicy(
  disabledTools: readonly string[],
): ToolPolicy | undefined {
  const disabled = new Set(disabledTools.map(normalizeToolName).filter(Boolean));
  if (disabled.size === 0) return undefined;
  return {
    canAdvertise: (tool) => !disabled.has(normalizeToolName(tool.name)),
    canExecute: ({ name }) => disabled.has(normalizeToolName(name))
      ? { allowed: false, reason: "disabled by settings" }
      : { allowed: true },
  };
}

export function composeToolPolicies(
  ...policies: Array<ToolPolicy | undefined>
): ToolPolicy | undefined {
  const activePolicies = policies.filter((policy): policy is ToolPolicy => Boolean(policy));
  if (activePolicies.length === 0) {
    return undefined;
  }

  return {
    canAdvertise: (tool) => {
      return activePolicies.every((policy) =>
        !policy.canAdvertise || policy.canAdvertise(tool),
      );
    },
    canExecute: async (request) => {
      for (const policy of activePolicies) {
        if (!policy.canExecute) continue;
        const decision = await policy.canExecute(request);
        if (!decision.allowed) return decision;
      }
      return { allowed: true };
    },
  };
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function formatPolicyDenied(name: string, reason: string | undefined): string {
  return `Tool "${name}" denied by policy${reason ? `: ${reason}` : ""}`;
}
