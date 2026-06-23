import type { AgentEvent, ChatClient, ChatUsage } from "../agent/loop.ts";
import { runAgent } from "../agent/loop.ts";
import { resolve } from "node:path";
import type { ReasoningEffort } from "../config.ts";
import {
  buildAgentSystemPrompt,
  loadAgentGuidance,
  toAgentGuidanceRefs,
} from "../context/agents.ts";
import { createMcpToolProvider } from "../mcp/tools.ts";
import { loadPluginManifests, pluginMcpServers, type McpServerConfig } from "../plugins/manifest.ts";
import { createBuiltinToolRegistry } from "../tools/builtin.ts";
import { TodoState } from "../tools/todo.ts";
import type { SessionEvent, StoredThread } from "./types.ts";
import type { ThreadStore } from "./thread-store.ts";
import type { ToolPolicy } from "../tools/types.ts";
import { addModelUsage, cloneThreadUsage } from "./usage.ts";
import type { PermissionRule, ToolApprovalHandler } from "../tools/permissions.ts";

export interface RunSessionTurnOptions {
  chat: ChatClient;
  store: ThreadStore;
  workspaceRoot: string;
  prompt: string;
  model?: string;
  mode?: string;
  reasoningEffort?: ReasoningEffort;
  disabledTools?: readonly string[];
  permissionRules?: readonly PermissionRule[];
  approveToolExecution?: ToolApprovalHandler;
  threadId?: string;
  startDir?: string;
  maxIterations?: number;
  toolPolicy?: ToolPolicy;
  courseMode?: boolean;
  allowedVosCommands?: readonly string[];
  extraMcpServers?: readonly McpServerConfig[];
  streamAssistant?: boolean;
  fixedSystemPrompt?: string;
  onEvent?: (event: SessionEvent) => void | Promise<void>;
}

export interface RunSessionTurnResult {
  content: string | null;
  thread: StoredThread;
  iterations: number;
}

export function assertThreadCanContinue(thread: StoredThread, workspaceRoot: string): void {
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  if (resolve(thread.workspaceRoot) !== resolvedWorkspaceRoot) {
    throw new Error(
      `thread "${thread.id}" belongs to workspace "${thread.workspaceRoot}", not "${resolvedWorkspaceRoot}"`,
    );
  }
  if (thread.archivedAt) {
    throw new Error(
      `thread "${thread.id}" is archived; fork it before continuing`,
    );
  }
}

export async function runSessionTurn(
  opts: RunSessionTurnOptions,
): Promise<RunSessionTurnResult> {
  const {
    chat,
    store,
    workspaceRoot,
    prompt,
    model,
    mode,
    reasoningEffort,
    threadId,
    streamAssistant = false,
    onEvent,
  } = opts;
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const startDir = resolve(opts.startDir ?? workspaceRoot);

  let thread: StoredThread;
  let turnModel: string;
  let turnMode: string | undefined;
  let turnReasoningEffort: ReasoningEffort | undefined;
  let system: string | undefined;
  let threadEventType: "thread.created" | "thread.loaded";
  if (threadId) {
    thread = store.load(threadId);
    assertThreadCanContinue(thread, resolvedWorkspaceRoot);
    if (model !== undefined) {
      turnModel = model;
      turnMode = mode;
      turnReasoningEffort = reasoningEffort;
    } else {
      turnModel = thread.model;
      turnMode = thread.mode;
      turnReasoningEffort = thread.reasoningEffort;
    }
    threadEventType = "thread.loaded";
  } else {
    if (!model) {
      throw new Error("model is required when creating a new thread");
    }
    turnModel = model;
    turnMode = mode;
    turnReasoningEffort = reasoningEffort;
    threadEventType = "thread.created";
    const guidance = loadAgentGuidance({
      rootDir: resolvedWorkspaceRoot,
      startDir,
    });
    system = combineSystemPrompts(opts.fixedSystemPrompt, buildAgentSystemPrompt(guidance));
    thread = store.create({
      prompt,
      model: turnModel,
      mode: turnMode,
      reasoningEffort: turnReasoningEffort,
      guidanceFiles: toAgentGuidanceRefs(guidance),
    });
  }

  const pluginManifests = loadPluginManifests({ workspaceRoot: resolvedWorkspaceRoot });
  const mcpProvider = await createMcpToolProvider({
    servers: mergeMcpServers(pluginMcpServers(pluginManifests), opts.extraMcpServers ?? []),
  });
  try {
    const todos = new TodoState(thread.todos);
    const usage = cloneThreadUsage(thread.usage);
    const recordModelUsage = async (
      iteration: number,
      modelId: string,
      chatUsage: ChatUsage,
    ): Promise<void> => {
      const usageEvent = addModelUsage(usage, modelId, chatUsage);
      await onEvent?.({
        type: "model.usage",
        thread_id: thread.id,
        iteration,
        ...usageEvent,
      });
    };
    const handleAgentEvent = async (event: AgentEvent): Promise<void> => {
      if (event.type === "assistant.delta") {
        await onEvent?.({
          type: "assistant.delta",
          thread_id: thread.id,
          iteration: event.iteration,
          delta: event.delta,
        });
      } else if (event.type === "assistant.message") {
        await onEvent?.({
          type: "assistant.message",
          thread_id: thread.id,
          iteration: event.iteration,
          content: event.message.content,
          toolCalls: (event.message.tool_calls ?? []).flatMap((toolCall) =>
            toolCall.type === "function"
              ? [{
                  id: toolCall.id,
                  name: toolCall.function.name,
                  arguments: toolCall.function.arguments,
                }]
              : []
          ),
        });
      } else if (event.type === "tool.call") {
        await onEvent?.({
          type: "tool.call",
          thread_id: thread.id,
          iteration: event.iteration,
          id: event.toolCall.id,
          name: event.toolCall.function.name,
          arguments: event.toolCall.function.arguments,
        });
      } else if (event.type === "tool.result") {
        await onEvent?.({
          type: "tool.result",
          thread_id: thread.id,
          iteration: event.iteration,
          id: event.toolCallId,
          name: event.name,
          content: event.content,
        });
      } else if (event.type === "agent.done") {
        await onEvent?.({
          type: "agent.done",
          thread_id: thread.id,
          iteration: event.iteration,
          content: event.content,
        });
      } else if (event.type === "model.usage") {
        await recordModelUsage(event.iteration, event.model, event.usage);
      }
    };
    const registry = createBuiltinToolRegistry({
      rootDir: resolvedWorkspaceRoot,
      disabledTools: opts.disabledTools,
      permissionRules: opts.permissionRules,
      approveToolExecution: opts.approveToolExecution,
      toolPolicy: opts.toolPolicy,
      courseMode: opts.courseMode,
      allowedVosCommands: opts.allowedVosCommands,
      extraTools: mcpProvider.tools,
      todos,
      task: {
        chat,
        model: turnModel,
        reasoningEffort: turnReasoningEffort,
        maxIterations: opts.maxIterations,
        onEvent: handleAgentEvent,
      },
    });
    await onEvent?.({
      type: threadEventType,
      thread_id: thread.id,
      model: turnModel,
      ...(turnMode ? { mode: turnMode } : {}),
      ...(turnReasoningEffort ? { reasoningEffort: turnReasoningEffort } : {}),
      tools: registry.names(),
      mcpServers: mcpProvider.serverNames,
      cwd: startDir,
    });
    const result = await runAgent({
      chat,
      registry,
      prompt,
      model: turnModel,
      reasoningEffort: turnReasoningEffort,
      maxIterations: opts.maxIterations,
      streamAssistant,
      ...(threadId ? { history: thread.messages } : { system }),
      onEvent: handleAgentEvent,
    });

    thread.messages = result.messages;
    thread.model = turnModel;
    if (turnMode) {
      thread.mode = turnMode;
    } else {
      delete thread.mode;
    }
    if (turnReasoningEffort) {
      thread.reasoningEffort = turnReasoningEffort;
    } else {
      delete thread.reasoningEffort;
    }
    thread.todos = todos.items;
    thread.usage = usage;
    store.save(thread);
    await onEvent?.({ type: "thread.saved", thread_id: thread.id });
    await onEvent?.({ type: "done", thread_id: thread.id, content: result.content });

    return { content: result.content, thread, iterations: result.iterations };
  } finally {
    await mcpProvider.close();
  }
}

function mergeMcpServers(
  pluginServers: readonly McpServerConfig[],
  extraServers: readonly McpServerConfig[],
): McpServerConfig[] {
  const out: McpServerConfig[] = [];
  const seen = new Set<string>();
  for (const server of [...pluginServers, ...extraServers]) {
    const name = server.name.toLowerCase();
    if (seen.has(name)) {
      throw new Error(`duplicate MCP server name "${server.name}" between plugin manifests and task profile`);
    }
    seen.add(name);
    out.push(server);
  }
  return out;
}

function combineSystemPrompts(
  fixedSystemPrompt: string | undefined,
  workspaceSystemPrompt: string | undefined,
): string | undefined {
  if (fixedSystemPrompt && workspaceSystemPrompt) {
    return `${fixedSystemPrompt}\n\n${workspaceSystemPrompt}`;
  }
  return fixedSystemPrompt ?? workspaceSystemPrompt;
}
