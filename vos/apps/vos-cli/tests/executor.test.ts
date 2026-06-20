import { describe, expect, test } from "bun:test";
import { runCommand } from "../app/runtime/executor.ts";

describe("runtime executor", () => {
  test("can delay stdin until output matches a ready pattern", async () => {
    const result = await runCommand({
      command: ["python3", "-u", "-c", [
        "import sys;",
        "import time;",
        "sys.stdout.write('READY\\n');",
        "sys.stdout.flush();",
        "time.sleep(0.05);",
        "line = sys.stdin.readline();",
        "sys.stdout.write('GOT:' + line.strip() + '\\n');",
      ].join("")],
      stdinAfter: {
        pattern: "READY",
        text: "after-ready\n",
      },
      timeoutMs: 1000,
    });

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("READY");
  });
});
