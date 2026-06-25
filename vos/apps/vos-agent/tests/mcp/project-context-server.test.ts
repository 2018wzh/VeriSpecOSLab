import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("project context MCP server", () => {
  test("serves readonly spec and evidence summaries", () => {
    const projectRoot = makeProjectContextFixture();
    try {
      const lines = callProjectContextMcp(projectRoot, [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "spec_summary", arguments: { path: "spec/modules/kernel/boot.yaml" } },
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "evidence_summary", arguments: { limit: 5 } },
        },
      ]);

      expect(lines[1].result.tools.map((tool: { name: string }) => tool.name)).toEqual([
        "spec_summary",
        "evidence_summary",
      ]);
      expect(lines[2].result.isError).toBe(false);
      expect(lines[2].result.content[0].text).toContain("boot module");
      expect(lines[3].result.isError).toBe(false);
      expect(lines[3].result.content[0].text).toContain("run-1");
      expect(lines[3].result.content[0].text).toContain("serial.log");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects traversal and hidden runtime paths", () => {
    const projectRoot = makeProjectContextFixture();
    try {
      const lines = callProjectContextMcp(projectRoot, [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "spec_summary", arguments: { path: "../package.json" } },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "spec_summary", arguments: { path: ".vos/worktrees/x" } },
        },
      ]);

      expect(lines[0].result.isError).toBe(true);
      expect(lines[0].result.content[0].text).toContain("outside spec");
      expect(lines[1].result.isError).toBe(true);
      expect(lines[1].result.content[0].text).toContain("outside spec");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

function callProjectContextMcp(projectRoot: string, messages: unknown[]): Array<any> {
  const proc = spawnSync(process.execPath, [
    join(import.meta.dir, "..", "..", "app", "main.ts"),
    "internal",
    "project-context-mcp",
  ], {
    input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    encoding: "utf8",
    env: { ...process.env, VOS_PROJECT_ROOT: projectRoot },
  });
  expect(proc.stderr).toBe("");
  return proc.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function makeProjectContextFixture(): string {
  const root = join(tmpdir(), `vos-project-context-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, "spec", "modules", "kernel"), { recursive: true });
  mkdirSync(join(root, ".vos", "runs", "run-1", "artifacts"), { recursive: true });
  mkdirSync(join(root, ".vos", "worktrees"), { recursive: true });
  writeFileSync(join(root, "spec", "modules", "kernel", "boot.yaml"), "id: boot\nsummary: boot module\n");
  writeFileSync(join(root, ".vos", "runs", "run-1", "manifest.json"), JSON.stringify({
    run_id: "run-1",
    status: "failed",
    artifacts: [{ kind: "qemu_log", path: "artifacts/serial.log", summary: "boot serial" }],
  }, null, 2));
  writeFileSync(join(root, ".vos", "runs", "run-1", "artifacts", "serial.log"), "boot failed\n");
  return root;
}
