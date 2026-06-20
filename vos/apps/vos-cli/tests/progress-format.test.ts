import { describe, expect, test } from "bun:test";
import {
  formatBar,
  formatCompletionLine,
  formatElapsed,
  formatProgressLine,
} from "../app/progress/format.ts";
import { shouldEnableProgress } from "../app/progress/index.ts";

describe("vos-cli progress formatting", () => {
  test("formats ASCII progress bars and elapsed durations", () => {
    expect(formatBar(50, 10)).toBe("[#####-----]");
    expect(formatElapsed(12_000)).toBe("12s");
    expect(formatElapsed(80_000)).toBe("1m 20s");
    expect(formatElapsed(3_720_000)).toBe("1h 02m");
  });

  test("truncates dynamic lines to one terminal line", () => {
    const line = formatProgressLine({
      stage: "agent generate",
      status: "running",
      message: "this is a very long agent supplied status message that must not wrap",
      percent: 42,
      elapsedMs: 12_000,
      columns: 48,
      color: false,
    });

    expect(line.length).toBeLessThanOrEqual(48);
    expect(line).toEndWith("...");
    expect(line).not.toContain("\n");
  });

  test("omits ANSI color when disabled and formats completion lines", () => {
    const ok = formatCompletionLine({
      status: "passed",
      stage: "agent generate",
      elapsedMs: 80_000,
      columns: 80,
      color: false,
    });
    const failed = formatCompletionLine({
      status: "failed",
      stage: "build",
      elapsedMs: 12_000,
      message: "compiler failed badly",
      columns: 80,
      color: false,
    });

    expect(ok).toBe("OK agent generate completed in 1m 20s");
    expect(failed).toBe("FAIL build failed in 12s: compiler failed badly");
    expect(ok).not.toContain("\u001b[");
  });

  test("enables progress according to tty/json/CI policy", () => {
    expect(shouldEnableProgress("auto", false, { isTty: true })).toBe(true);
    expect(shouldEnableProgress("auto", false, { isTty: true, ci: "1" })).toBe(false);
    expect(shouldEnableProgress("always", true, { isTty: true })).toBe(false);
    expect(shouldEnableProgress("always", false, { isTty: false })).toBe(true);
    expect(shouldEnableProgress("never", false, { isTty: true })).toBe(false);
  });
});
