import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { buildAskDemoTask, buildDebugDemoTask, collectDebugArtifactExcerpts } from "../app/demo-context.ts";

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

  test("debug prompt forbids published visualization URLs", () => {
    const task = buildDebugDemoTask("show the boot flow");

    expect(task).toContain("visualization_html must be literal HTML");
    expect(task).toContain("Do not claim that you started, hosted, published, or opened a local visualization page");
    expect(task).toContain("Do not include localhost, 127.0.0.1, or external visualization links");
  });

  test("ask prompt prefers html visualization without published URLs", () => {
    const task = buildAskDemoTask("请详细可视化解析整个系统从上电开始的启动流程");

    expect(task).toContain("prefer a complete self-contained visualization_html document");
    expect(task).toContain("visualization_html must be literal HTML");
    expect(task).toContain("summarize the same visual narrative in rich markdown tables");
    expect(task).toContain("Do not claim that you started, hosted, published, or opened a local visualization page");
    expect(task).toContain("Do not include localhost, 127.0.0.1, or external visualization links");
  });
});
