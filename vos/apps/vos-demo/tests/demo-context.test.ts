import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { collectDebugArtifactExcerpts } from "../app/demo-context.ts";

describe("vos-demo debug context", () => {
  test("collects safe text artifact excerpts and skips binary or escaped paths", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "vos-demo-context-"));
    const runRoot = path.join(projectRoot, ".vos", "runs", "run-a", "artifacts");
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(path.join(runRoot, "qemu.log"), "line one\n".repeat(900));
    writeFileSync(path.join(runRoot, "kernel.bin"), Buffer.from([0, 1, 2, 3]));

    const excerpts = await collectDebugArtifactExcerpts(projectRoot, "run-a", [
      { kind: "log", path: ".vos/runs/run-a/artifacts/qemu.log" },
      { kind: "binary", path: ".vos/runs/run-a/artifacts/kernel.bin" },
      { kind: "escape", path: "../secret.txt" },
    ]);

    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]).toMatchObject({
      kind: "log",
      path: ".vos/runs/run-a/artifacts/qemu.log",
      truncated: true,
    });
    expect(excerpts[0].text).toContain("line one");
    expect(JSON.stringify(excerpts)).not.toContain("kernel.bin");
    expect(JSON.stringify(excerpts)).not.toContain("secret");
  });
});
