import type { StageId } from "vos-core";

export type AdapterKind = "build" | "run" | "test" | "debug" | "trace" | "verify";

export interface ToolchainSpec {
  id: string;
  kind: AdapterKind;
  command: string;
  args?: string[];
  stage?: StageId;
  options?: Record<string, unknown>;
}

export interface AdapterContext {
  projectRoot: string;
  command: string;
  profile?: string;
  stage?: StageId;
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

export interface ExecutionNode {
  id: string;
  kind: AdapterKind | "test-suite";
  adapter: string;
  inputs: Record<string, unknown>;
  depends_on?: string[];
  resource_locks?: string[];
  timeout_ms?: number;
}

export interface ExecutionPlan {
  id: string;
  command: string;
  nodes: ExecutionNode[];
}

export interface ToolchainAdapter {
  name: string;
  kind: AdapterKind;
  supports(spec: ToolchainSpec): boolean;
  prepare(spec: ToolchainSpec, context?: AdapterContext): AdapterPlan;
}

export interface BuildAdapter extends ToolchainAdapter {
  kind: "build";
  prepare(spec: ToolchainSpec, context?: AdapterContext): AdapterPlan;
}

export interface RunAdapter extends ToolchainAdapter {
  kind: "run";
  prepare(spec: ToolchainSpec, context?: AdapterContext): AdapterPlan;
}

export interface TestAdapter extends ToolchainAdapter {
  kind: "test";
  prepare(spec: ToolchainSpec, context?: AdapterContext): AdapterPlan;
}

export interface DebugAdapter extends ToolchainAdapter {
  kind: "debug";
  prepare(spec: ToolchainSpec, context?: AdapterContext): AdapterPlan;
}

export interface TraceAdapter extends ToolchainAdapter {
  kind: "trace";
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
