import type { AgentEvent, ChatClient } from "../agent/loop.ts";
import { runAgent } from "../agent/loop.ts";
import type { ReasoningEffort } from "../config.ts";
import type { Tool, ToolExecutionContext } from "./types.ts";
import { ToolRegistry } from "./types.ts";
import {
  parseToolArguments,
  requireStringArgument,
} from "./common.ts";

export interface TaskToolOptions {
  chat: ChatClient;
  model: string;
  reasoningEffort?: ReasoningEffort;
  maxIterations?: number;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  registryFactory: (spec: SubagentSpec) => ToolRegistry;
  specs?: readonly SubagentSpec[];
}

export interface SubagentSpec {
  name: string;
  description: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  maxIterations?: number;
  instructions?: string;
  disabledTools?: readonly string[];
}

export const generalSubagentSpec: SubagentSpec = Object.freeze({
  name: "general",
  description: "Default general-purpose subagent using the parent model and tools.",
});

export const taskToolSchema: Tool["schema"] = {
  type: "function",
  function: {
    name: "Task",
    description:
      "Launch a focused subagent with its own fresh tool registry. Use this for bounded investigation, review, verification, or independent implementation subtasks.",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Short label for the delegated task.",
        },
        prompt: {
          type: "string",
          description:
            "Detailed instructions for the subagent, including scope, constraints, and expected return shape.",
        },
        subagent_type: {
          type: "string",
          description:
            "Optional named subagent profile to use. Defaults to general.",
        },
      },
      required: ["description", "prompt"],
    },
  },
};

export function createTaskTool(opts: TaskToolOptions): Tool {
  const specs = normalizeSubagentSpecs(opts.specs);
  return {
    name: "Task",
    schema: taskToolSchemaForSpecs(specs),
    async execute(
      argumentsJson: string,
      context?: ToolExecutionContext,
    ): Promise<string> {
      const parsed = parseToolArguments("Task", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const description = requireStringArgument("Task", parsed.args, "description", {
        trimForEmptyCheck: true,
      });
      if (!description.ok) return description.error;

      const prompt = requireStringArgument("Task", parsed.args, "prompt", {
        trimForEmptyCheck: true,
      });
      if (!prompt.ok) return prompt.error;

      const spec = readSubagentSpec(parsed.args, specs);
      if (!spec.ok) return spec.error;

      try {
        const result = await runAgent({
          chat: opts.chat,
          registry: opts.registryFactory(spec.value),
          prompt: promptForSpec(spec.value, prompt.value),
          model: spec.value.model ?? opts.model,
          reasoningEffort: spec.value.reasoningEffort ?? opts.reasoningEffort,
          maxIterations: spec.value.maxIterations ?? opts.maxIterations,
          signal: context?.signal,
          onEvent: opts.onEvent
            ? async (event) => {
                if (event.type === "model.usage") {
                  await opts.onEvent?.(event);
                }
              }
            : undefined,
        });
        return result.content ?? "(subagent returned no text response)";
      } catch (e) {
        return `Error running subagent "${description.value}": ${(e as Error).message}`;
      }
    },
  };
}

function taskToolSchemaForSpecs(specs: readonly SubagentSpec[]): Tool["schema"] {
  return {
    ...taskToolSchema,
    function: {
      ...taskToolSchema.function,
      parameters: {
        ...(taskToolSchema.function.parameters as Record<string, unknown>),
        properties: {
          ...((taskToolSchema.function.parameters as { properties: Record<string, unknown> }).properties),
          subagent_type: {
            type: "string",
            enum: specs.map((spec) => spec.name),
            description:
              `Optional named subagent profile to use. Known profiles: ${
                specs.map((spec) => `${spec.name} (${spec.description})`).join(", ")
              }. Defaults to general.`,
          },
        },
      },
    },
  };
}

function normalizeSubagentSpecs(
  specs: readonly SubagentSpec[] | undefined,
): SubagentSpec[] {
  const byName = new Map<string, SubagentSpec>();
  byName.set(generalSubagentSpec.name, generalSubagentSpec);
  for (const spec of specs ?? []) {
    const name = spec.name.trim();
    if (!name) continue;
    byName.set(name, { ...spec, name });
  }
  return Array.from(byName.values());
}

function readSubagentSpec(
  args: Record<string, unknown>,
  specs: readonly SubagentSpec[],
): { ok: true; value: SubagentSpec } | { ok: false; error: string } {
  const raw = args.subagent_type;
  if (raw === undefined) {
    return { ok: true, value: specs[0] ?? generalSubagentSpec };
  }
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {
      ok: false,
      error: 'Error validating Task arguments: "subagent_type" must be a non-empty string',
    };
  }
  const name = raw.trim();
  const spec = specs.find((candidate) => candidate.name === name);
  if (!spec) {
    return {
      ok: false,
      error:
        `Error validating Task arguments: unknown subagent_type "${name}". known subagents: ${
          specs.map((candidate) => candidate.name).join(", ")
        }`,
    };
  }
  return { ok: true, value: spec };
}

function promptForSpec(spec: SubagentSpec, prompt: string): string {
  if (!spec.instructions) return prompt;
  return [
    `Subagent profile: ${spec.name}`,
    spec.instructions,
    "",
    prompt,
  ].join("\n");
}

export const taskTool: Tool = createTaskTool({
  chat: {
    async chat() {
      throw new Error("Task tool requires a configured ChatClient");
    },
  },
  model: "unconfigured",
  registryFactory: () => new ToolRegistry(),
});
