export type RunId = `run-${string}`;

export type CommandStatus =
  | "passed"
  | "ok"
  | "partial"
  | "agent_output_error"
  | "planned"
  | "not_implemented"
  | "policy_blocked"
  | "validation_failed"
  | "cancelled"
  | "timed_out"
  | "failed";

export interface CommandOutcome {
  run_id: RunId;
  status: CommandStatus;
  message?: string;
  code?: number;
  details?: Record<string, unknown>;
}

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
  status: CommandStatus;
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

export type AdapterKind = "build" | "run" | "test" | "debug" | "trace" | "verify";

export interface ToolchainSpec {
  id: string;
  kind: AdapterKind;
  command: string;
  args?: string[];
  stage?: string;
  options?: Record<string, unknown>;
}

export interface AdapterContext {
  projectRoot: string;
  command: string;
  profile?: string;
  stage?: string;
}

export interface AdapterCommand {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface AdapterPlan {
  command: AdapterCommand;
}

export interface ToolchainAdapter {
  name: string;
  kind: AdapterKind;
  supports(spec: ToolchainSpec): boolean;
  prepare(spec: ToolchainSpec, context?: AdapterContext): AdapterPlan;
}

export interface AdapterRegistry {
  register(adapter: ToolchainAdapter): void;
  resolve(spec: ToolchainSpec): ToolchainAdapter;
}

export class InMemoryAdapterRegistry implements AdapterRegistry {
  private readonly adapters: ToolchainAdapter[] = [];

  register(adapter: ToolchainAdapter): void {
    this.adapters.push(adapter);
  }

  resolve(spec: ToolchainSpec): ToolchainAdapter {
    const match = this.adapters.find((adapter) => adapter.supports(spec));
    if (!match) {
      throw new Error(`No adapter found for spec kind ${spec.kind}`);
    }
    return match;
  }
}
