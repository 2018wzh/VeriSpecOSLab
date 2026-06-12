import type { ChatClient } from "../agent/loop.ts";
import { runAgent } from "../agent/loop.ts";
import type { ReasoningEffort } from "../config.ts";
import type { Tool } from "./types.ts";
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
  registryFactory: () => ToolRegistry;
}

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
      },
      required: ["description", "prompt"],
    },
  },
};

export function createTaskTool(opts: TaskToolOptions): Tool {
  return {
    name: "Task",
    schema: taskToolSchema,
    async execute(argumentsJson: string): Promise<string> {
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

      try {
        const result = await runAgent({
          chat: opts.chat,
          registry: opts.registryFactory(),
          prompt: prompt.value,
          model: opts.model,
          reasoningEffort: opts.reasoningEffort,
          maxIterations: opts.maxIterations,
        });
        return result.content ?? "(subagent returned no text response)";
      } catch (e) {
        return `Error running subagent "${description.value}": ${(e as Error).message}`;
      }
    },
  };
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
