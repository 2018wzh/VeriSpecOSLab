import { describe, expect, test } from "bun:test";
import { runCommand } from "../app/runtime/executor.ts";

describe("runtime executor", () => {
  test("can delay stdin until output matches a ready pattern", async () => {
    const result = await runCommand({
      command: ["sh", "-c", "printf READY; IFS= read -r line; printf '\\nGOT:%s\\n' \"$line\""],
      stdinAfter: {
        pattern: "READY",
        text: "after-ready\n",
      },
      timeoutMs: 1000,
    });

    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain("READY");
    expect(result.stdout).toContain("GOT:after-ready");
  });
});
