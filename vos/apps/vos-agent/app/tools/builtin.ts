import { resolve } from "node:path";
import { createReadTool } from "./read.ts";
import { createWriteTool } from "./write.ts";
import { createEditTool } from "./edit.ts";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";
import { createVosTool } from "./vos.ts";
import { createTodoReadTool, createTodoWriteTool, type TodoState } from "./todo.ts";
import { createTaskTool, type TaskToolOptions } from "./task.ts";
import {
  composeToolPolicies,
  createDisabledToolsPolicy,
  ToolRegistry,
  type Tool,
  type ToolPolicy,
} from "./types.ts";
import {
  createDefaultPermissionPolicy,
  type PermissionRule,
  type ToolApprovalHandler,
} from "./permissions.ts";

export interface BuiltinToolRegistryOptions {
  /** Workspace root for file tools and cwd for Bash. Defaults to process.cwd(). */
  rootDir?: string;
  /** Tool names to hide from the model and deny if called. */
  disabledTools?: readonly string[];
  /** Ordered allow/ask/reject rules evaluated before built-in guarded patterns. */
  permissionRules?: readonly PermissionRule[];
  /** Optional approval hook for ask-rules. Without it, ask-rules deny safely. */
  approveToolExecution?: ToolApprovalHandler;
  /** Optional externally supplied tools, e.g. plugin/MCP adapters. */
  extraTools?: readonly Tool[];
  /** Optional thread-scoped todo state. Enables TodoRead/TodoWrite tools. */
  todos?: TodoState;
  /** Optional subagent configuration. Enables Task. */
  task?: Omit<TaskToolOptions, "registryFactory">;
  /** Optional override policy before built-in disabled-tools filtering. */
  toolPolicy?: ToolPolicy;
  /** Enable course mode: disable write/edit and keep file-read + Vos/grep tools. */
  courseMode?: boolean;
  /** Optional Vos command whitelist for constrained courses. */
  allowedVosCommands?: readonly string[];
}

/**
 * Default set of tools shipped with the agent.
 */
export function createBuiltinToolRegistry(
  opts: BuiltinToolRegistryOptions = {},
): ToolRegistry {
  const rootDir = resolve(opts.rootDir ?? process.cwd());
  const tools: Tool[] = [
    createReadTool({ rootDir }),
    createGlobTool({ rootDir }),
    createGrepTool({ rootDir }),
    createVosTool({
      rootDir,
      allowedCommands: opts.allowedVosCommands,
    }),
  ];
  if (!opts.courseMode) {
    tools.push(createWriteTool({ rootDir }));
    tools.push(createEditTool({ rootDir }));
  }
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
        permissionRules: opts.permissionRules,
        approveToolExecution: opts.approveToolExecution,
        extraTools: opts.extraTools,
        toolPolicy: opts.toolPolicy,
        courseMode: opts.courseMode,
        allowedVosCommands: opts.allowedVosCommands,
      }),
    }));
  }
  const policy = composeToolPolicies(
    createDisabledToolsPolicy(opts.disabledTools ?? []),
    opts.toolPolicy,
    createDefaultPermissionPolicy({
      rules: opts.permissionRules ?? [],
      approve: opts.approveToolExecution,
    }),
  );
  return new ToolRegistry(tools, {
    policy,
  });
}
