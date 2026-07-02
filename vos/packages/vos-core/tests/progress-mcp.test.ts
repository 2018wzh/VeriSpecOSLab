import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("vos-cli progress MCP server", () => {
  test("lists and calls report_progress", async () => {
    const proc = spawnSync(process.execPath, [
      join(import.meta.dir, "..", "src", "main.ts"),
      "internal",
      "progress-mcp",
    ], {
      input: [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "report_progress",
            arguments: {
              stage: "agent",
              status: "running",
              message: "reading context",
              percent: 25,
            },
          },
        }),
        "",
      ].join("\n"),
      encoding: "utf8",
    });

    const stdout = proc.stdout;
    const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[1].result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "report_progress",
      "submit_result",
    ]);
    expect(lines[2].result.content[0].text).toContain("\"vos-progress\"");
  }, 20_000);

  test("returns validation errors as MCP tool results", async () => {
    const proc = spawnSync(process.execPath, [
      join(import.meta.dir, "..", "src", "main.ts"),
      "internal",
      "progress-mcp",
    ], {
      input: `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "report_progress", arguments: { stage: "agent" } },
      })}\n`,
      encoding: "utf8",
    });

    const stdout = proc.stdout;
    const line = JSON.parse(stdout.trim());
    expect(line.result.isError).toBe(true);
    expect(line.result.content[0].text).toContain("status is invalid");
  }, 20_000);

  test("accepts schema-valid submitted results", async () => {
    const line = callProgressMcp({
      name: "submit_result",
      arguments: {
        schema_id: "plan_draft.v1",
        result: {
          task: "demo",
          related_specs: [],
          suspected_files: [],
          required_validations: [],
          notes: [],
        },
      },
    });

    expect(line.result.isError).toBe(false);
    expect(JSON.parse(line.result.content[0].text)).toMatchObject({
      type: "vos-result-submission",
      schema_id: "plan_draft.v1",
      accepted: true,
    });
  }, 20_000);

  test("rejects submitted results with schema errors", async () => {
    const line = callProgressMcp({
      name: "submit_result",
      arguments: {
        schema_id: "plan_draft.v1",
        result: { task: "demo" },
      },
    });

    expect(line.result.isError).toBe(true);
    expect(line.result.content[0].text).toContain("related_specs");
  }, 20_000);

  test("rejects unknown submitted result schemas", async () => {
    const line = callProgressMcp({
      name: "submit_result",
      arguments: {
        schema_id: "unknown.v1",
        result: {},
      },
    });

    expect(line.result.isError).toBe(true);
    expect(line.result.content[0].text).toContain("unknown schema");
  }, 20_000);
});

function callProgressMcp(params: Record<string, unknown>): { result: { isError: boolean; content: Array<{ text: string }> } } {
  const proc = spawnSync(process.execPath, [
    join(import.meta.dir, "..", "src", "main.ts"),
    "internal",
    "progress-mcp",
  ], {
    input: `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params,
    })}\n`,
    encoding: "utf8",
  });
  return JSON.parse(proc.stdout.trim());
}
