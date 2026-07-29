import { describe, expect, test } from "bun:test";
import { portalRunStatus } from "../worker/worker.ts";

describe("runner status projection", () => {
  test("projects both core success statuses to a passed pipeline", () => {
    expect(portalRunStatus("ok")).toBe("passed");
    expect(portalRunStatus("passed")).toBe("passed");
  });

  test("preserves cancellation and timeout while failing closed otherwise", () => {
    expect(portalRunStatus("cancelled")).toBe("cancelled");
    expect(portalRunStatus("timed_out")).toBe("timed_out");
    for (const status of [
      "partial",
      "agent_output_error",
      "planned",
      "not_implemented",
      "policy_blocked",
      "validation_failed",
      "failed",
      "unexpected",
    ]) {
      expect(portalRunStatus(status)).toBe("failed");
    }
  });
});
