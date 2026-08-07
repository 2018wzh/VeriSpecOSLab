import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeCommand } from "../src/dispatch.ts";
import { EvidenceWriter } from "../src/evidence/index.ts";
import type { CommandProgress, ProgressUpdate } from "../src/progress/types.ts";

describe("kb add progress", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("routes indexing phases through the shared command progress UI", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.json() as { input: string[] };
        return Response.json({
          data: body.input.map(() => ({ embedding: [1, 0, 0] })),
        });
      },
    });
    const projectRoot = mkdtempSync(path.join(tmpdir(), "vos-kb-progress-"));
    roots.push(projectRoot);
    mkdirSync(path.join(projectRoot, ".vos"), { recursive: true });
    writeFileSync(path.join(projectRoot, ".env"), "TEST_KB_EMBEDDING_KEY=test-key\n");
    writeFileSync(path.join(projectRoot, ".vos", "config.toml"), [
      "[kb.embedding]",
      "provider = \"openai-compatible\"",
      "model = \"fake\"",
      `base_url = \"http://127.0.0.1:${server.port}\"`,
      "",
      "[kb.embedding.auth]",
      "env = \"TEST_KB_EMBEDDING_KEY\"",
      "",
    ].join("\n"));
    writeFileSync(path.join(projectRoot, "manual.md"), "# Memory\n\nallocator ownership invariant\n");
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["kb", "add", "manual.md"],
      args: ["kb", "add", "manual.md"],
    });
    const updates: ProgressUpdate[] = [];
    const progress: CommandProgress = {
      mode: "always",
      enabled: true,
      start() { },
      update(update) {
        updates.push(update);
      },
      finish() { },
      hide() { },
    };

    try {
      const result = await executeCommand({
        kind: "kb_add",
        source: "manual.md",
        sourceKind: "course",
        recursive: false,
      }, {
        projectRoot,
        global: { projectRoot, json: false },
        evidence,
        progress,
      });

      expect(result.status).toBe("passed");
      expect(updates.every((update) => update.stage === "kb add")).toBe(true);
      expect(updates.map((update) => update.phase)).toContain("embedding");
      expect(updates).toContainEqual(expect.objectContaining({
        phase: "indexed",
        current: 1,
        total: 1,
        percent: 95,
      }));
      expect(updates.at(-1)).toMatchObject({ phase: "artifacts", percent: 96 });
    } finally {
      await server.stop(true);
    }
  });
});
