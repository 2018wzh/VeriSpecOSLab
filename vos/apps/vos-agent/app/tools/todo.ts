import type { TodoItem, TodoStatus } from "../session/types.ts";
import {
  parseToolArguments,
  requireStringArgument,
} from "./common.ts";
import type { Tool } from "./types.ts";

const TODO_STATUSES = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
]);

export class TodoState {
  private value: TodoItem[];

  constructor(items: readonly TodoItem[] = []) {
    this.value = items.map((item) => ({ ...item }));
  }

  get items(): TodoItem[] {
    return this.value.map((item) => ({ ...item }));
  }

  replace(items: readonly TodoItem[]): void {
    this.value = items.map((item) => ({ ...item }));
  }
}

export function createTodoReadTool(state: TodoState): Tool {
  return {
    name: "TodoRead",
    schema: {
      type: "function",
      function: {
        name: "TodoRead",
        description: "Read the current thread-scoped todo list",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    execute(): string {
      return JSON.stringify(state.items, null, 2);
    },
  };
}

export function createTodoWriteTool(state: TodoState): Tool {
  return {
    name: "TodoWrite",
    schema: {
      type: "function",
      function: {
        name: "TodoWrite",
        description:
          "Replace the current thread-scoped todo list. Use this to track multi-step work for the user.",
        parameters: {
          type: "object",
          properties: {
            todos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  content: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["pending", "in_progress", "completed"],
                  },
                },
                required: ["id", "content", "status"],
              },
            },
          },
          required: ["todos"],
        },
      },
    },
    execute(argumentsJson: string): string {
      const parsed = parseToolArguments("TodoWrite", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const rawTodos = parsed.args.todos;
      if (!Array.isArray(rawTodos)) {
        return 'Error validating TodoWrite arguments: "todos" must be an array';
      }

      const todos: TodoItem[] = [];
      const seenIds = new Set<string>();
      for (let i = 0; i < rawTodos.length; i++) {
        const raw = rawTodos[i];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          return `Error validating TodoWrite arguments: todo ${i} must be an object`;
        }
        const record = raw as Record<string, unknown>;
        const id = requireStringArgument("TodoWrite", record, "id");
        if (!id.ok) return id.error;
        const content = requireStringArgument("TodoWrite", record, "content");
        if (!content.ok) return content.error;
        const status = requireStringArgument("TodoWrite", record, "status");
        if (!status.ok) return status.error;
        if (!TODO_STATUSES.has(status.value as TodoStatus)) {
          return `Error validating TodoWrite arguments: invalid status "${status.value}"`;
        }
        const normalizedId = id.value.trim();
        const normalizedContent = content.value.trim();
        if (!normalizedId) {
          return `Error validating TodoWrite arguments: todo ${i} id must be non-empty`;
        }
        if (!normalizedContent) {
          return `Error validating TodoWrite arguments: todo ${i} content must be non-empty`;
        }
        if (seenIds.has(normalizedId)) {
          return `Error validating TodoWrite arguments: duplicate todo id "${normalizedId}"`;
        }
        seenIds.add(normalizedId);
        todos.push({
          id: normalizedId,
          content: normalizedContent,
          status: status.value as TodoStatus,
        });
      }

      state.replace(todos);
      return "OK";
    },
  };
}
