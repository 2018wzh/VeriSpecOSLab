import { describe, expect, test } from "bun:test";
import { renderOutput } from "../src/output.ts";
import type { BaseCommandResult } from "../src/types.ts";

describe("vos-cli output rendering", () => {
  test("defaults to compact status, message, and run id", () => {
    const output = renderOutput(sampleResult());

    expect(output).toContain("status: passed");
    expect(output).toContain("message: ok");
    expect(output).toContain("run_id: run-1");
    expect(output).not.toContain("command:");
    expect(output).not.toContain("started:");
    expect(output).not.toContain(".vos/runs/run-1/artifacts/log.txt");
    expect(output).not.toContain("details:");
  });

  test("verbose output includes run details", () => {
    const output = renderOutput(sampleResult(), { verbose: true });

    expect(output).toContain("command: doctor");
    expect(output).toContain("started: 2026-06-23T00:00:00.000Z");
    expect(output).toContain("- log: .vos/runs/run-1/artifacts/log.txt");
    expect(output).toContain("evidence_refs: 1");
    expect(output).toContain("details:");
    expect(output).toContain("\"checks\": 3");
  });
});

function sampleResult(): BaseCommandResult {
  return {
    ok: true,
    run_id: "run-1",
    command: ["doctor"],
    status: "passed",
    artifacts: [{ kind: "log", path: ".vos/runs/run-1/artifacts/log.txt" }],
    evidence_refs: [{ kind: "manifest", path: ".vos/runs/run-1/manifest.json" }],
    started_at: "2026-06-23T00:00:00.000Z",
    finished_at: "2026-06-23T00:00:01.000Z",
    message: "ok",
    details: { checks: 3 },
  };
}
