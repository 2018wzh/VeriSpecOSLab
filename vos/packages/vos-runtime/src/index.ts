import type { CommandOutcome, RunId } from "vos-core";

export interface RunEvent {
  run_id: RunId;
  ts: string;
  type:
    | "run_started"
    | "node_started"
    | "stdout_line"
    | "stderr_line"
    | "progress"
    | "node_finished"
    | "run_finished"
    | "run_cancelled";
  node_id?: string;
  payload?: Record<string, unknown>;
}

export type ExecutionNodeId = `node-${string}`;

export interface ExecutionNode {
  node_id: ExecutionNodeId;
  kind: string;
  adapter: string;
  inputs: Record<string, unknown>;
  timeout?: number;
  depends_on: ExecutionNodeId[];
  resource_locks: string[];
}

export interface ExecutionPlan {
  plan_id: string;
  command_name: string;
  nodes: ExecutionNode[];
  artifacts_root: string;
  concurrency_profile: "serial" | "parallel";
}

export interface VosCommand {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface ExecutionResult {
  run_id: RunId;
  plan_id: string;
  status: CommandOutcome["status"];
  started_at: string;
  finished_at: string;
  event_count: number;
}

export interface ExecutionEngine {
  run(plan: ExecutionPlan): Promise<ExecutionResult>;
  runNode(node: ExecutionNode, command: VosCommand): Promise<CommandOutcome>;
}

export interface ExecutionOptions {
  onEvent?: (event: RunEvent) => void | Promise<void>;
}

export class InMemoryExecutionEngine implements ExecutionEngine {
  async run(plan: ExecutionPlan): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();
    const finishedAt = new Date(startedAt);
    finishedAt.setSeconds(finishedAt.getSeconds() + plan.nodes.length);
    return {
      run_id: (`run-${Date.now().toString(36)}` as RunId),
      plan_id: plan.plan_id,
      status: plan.nodes.length > 0 ? "ok" : "failed",
      started_at: startedAt,
      finished_at: finishedAt.toISOString(),
      event_count: plan.nodes.length,
    };
  }

  async runNode(node: ExecutionNode): Promise<CommandOutcome> {
    return {
      run_id: (`run-${Date.now().toString(36)}` as RunId),
      status: node.node_id ? "ok" : "failed",
      code: node.timeout ? 0 : undefined,
    };
  }
}
