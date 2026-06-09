import { resolve } from "node:path";
import { createReadTool } from "./read.ts";
import { createWriteTool } from "./write.ts";
import { createEditTool } from "./edit.ts";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";
import { createVosTool } from "./vos.ts";
import { createTodoReadTool, createTodoWriteTool, type TodoState } from "./todo.ts";
import { createTaskTool, type TaskToolOptions } from "./task.ts";
import { createDisabledToolsPolicy, ToolRegistry, type Tool } from "./types.ts";

export interface BuiltinToolRegistryOptions {
  /** Workspace root for file tools and cwd for Bash. Defaults to process.cwd(). */
  rootDir?: string;
  /** Tool names to hide from the model and deny if called. */
  disabledTools?: readonly string[];
  /** Optional externally supplied tools, e.g. plugin/MCP adapters. */
  extraTools?: readonly Tool[];
  /** Optional thread-scoped todo state. Enables TodoRead/TodoWrite tools. */
  todos?: TodoState;
  /** Optional subagent configuration. Enables Task. */
  task?: Omit<TaskToolOptions, "registryFactory">;
}

/**
 * Default set of tools shipped with the agent.
 */
export function createBuiltinToolRegistry(
  opts: BuiltinToolRegistryOptions = {},
): ToolRegistry {
  const rootDir = resolve(opts.rootDir ?? process.cwd());
  const tools = [
    createReadTool({ rootDir }),
    createWriteTool({ rootDir }),
    createEditTool({ rootDir }),
    createGlobTool({ rootDir }),
    createGrepTool({ rootDir }),
    createVosTool({ rootDir }),
  ];
  tools.push(...(opts.extraTools ?? []));
  if (opts.todos) {
    tools.push(createTodoReadTool(opts.todos), createTodoWriteTool(opts.todos));
  }
  if (opts.task) {
    tools.push(createTaskTool({
      ...opts.task,
      registryFactory: () => createBuiltinToolRegistry({
        rootDir,
        disabledTools: opts.disabledTools,
        extraTools: opts.extraTools,
      }),
    }));
  }
  return new ToolRegistry(tools, {
    policy: createDisabledToolsPolicy(opts.disabledTools ?? []),
  });
}
