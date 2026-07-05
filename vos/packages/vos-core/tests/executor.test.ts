import { describe, expect, test } from "bun:test";
import { runCommand } from "../src/runtime/executor.ts";

describe("runtime executor", () => {
  test("passes immediate stdin to commands that read at startup", async () => {
    const result = await runCommand({
      command: ["python", "-u", "-c", "import sys; print('GOT:' + sys.stdin.readline().strip())"],
      stdin: "startup\n",
      timeoutMs: 1000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("GOT:startup");
  });

  test("can delay stdin until output matches a ready pattern", async () => {
    const result = await runCommand({
      command: ["python", "-u", "-c", [
        "import os",
        "import sys;",
        "import time;",
        "fd = sys.stdin.fileno()",
        "os.set_blocking(fd, False)",
        "try:",
        "    early = os.read(fd, 1)",
        "except BlockingIOError:",
        "    early = b''",
        "assert early == b'', 'stdin arrived before READY'",
        "sys.stdout.write('READY\\n');",
        "sys.stdout.flush();",
        "time.sleep(0.05);",
        "os.set_blocking(fd, True)",
        "line = sys.stdin.readline();",
        "sys.stdout.write('GOT:' + line.strip() + '\\n');",
      ].join("\n")],
      stdinAfter: {
        pattern: "READY",
        text: "after-ready\n",
      },
      timeoutMs: 1000,
    });

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("READY");
    expect(result.stdout).toContain("GOT:after-ready");
  });
});
