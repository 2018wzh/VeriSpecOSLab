import { describe, expect, test } from "bun:test";
import {
  InMemoryAdapterRegistry,
  InMemoryExecutionEngine,
  type ToolchainSpec,
} from "../src/index.ts";

describe("vos-runtime", () => {
  test("exports execution engine and adapter registry contracts", async () => {
    const registry = new InMemoryAdapterRegistry();
    registry.register({
      name: "build-shell",
      kind: "build",
      supports: (spec: ToolchainSpec) => spec.kind === "build",
      prepare: (spec) => ({ command: { command: spec.command, args: spec.args ?? [] } }),
    });

    const adapter = registry.resolve({ id: "build", kind: "build", command: "make" });
    expect(adapter.name).toBe("build-shell");

    const engine = new InMemoryExecutionEngine();
    const result = await engine.run({
      plan_id: "plan-1",
      command_name: "build",
      artifacts_root: ".vos/runs/test",
      concurrency_profile: "serial",
      nodes: [{
        node_id: "node-build",
        kind: "build",
        adapter: "build-shell",
        inputs: {},
        depends_on: [],
        resource_locks: [],
      }],
    });
    expect(result.status).toBe("ok");
  });
});
