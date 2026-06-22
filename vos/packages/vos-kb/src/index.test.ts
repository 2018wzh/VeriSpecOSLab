import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addKbSource,
  clearKbSources,
  exportKbManifest,
  importKbManifest,
  type KbEmbedder,
  listKbSources,
  lookupKb,
  removeKbSource,
  searchKb,
} from "./index.ts";

const fakeEmbedder: KbEmbedder = {
  model: "fake",
  async embed(texts: string[]) {
    return texts.map((text) => {
      const lower = text.toLowerCase();
      return [
        lower.includes("allocator") || lower.includes("page") ? 1 : 0,
        lower.includes("trap") || lower.includes("syscall") ? 1 : 0,
        lower.includes("ignored") ? 1 : 0,
      ];
    });
  },
};

describe("vos-kb local registry", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "vos-kb-"));
    writeFileSync(path.join(root, "manual.md"), "allocator invariant and page ownership\n");
    mkdirSync(path.join(root, "course"), { recursive: true });
    writeFileSync(path.join(root, "course", "trap.md"), "# trap\n\ntrapframe design notes\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("adds files and directories, searches chunks, removes, and clears cached objects", async () => {
    const source = await addKbSource(root, { source: "manual.md", sourceKind: "course", stage: "memory", title: "Memory Manual" }, { embedder: fakeEmbedder });
    await addKbSource(root, { source: "course", sourceKind: "course", recursive: true }, { embedder: fakeEmbedder });

    expect(source.id).toStartWith("kb-");
    expect(source.object_ref?.uri).toStartWith("s3://vos-demo/kb/");
    expect(await listKbSources(root)).toHaveLength(2);
    expect(existsSync(path.join(root, ".vos", "kb", "vectors.sqlite"))).toBe(true);
    const hit = (await searchKb(root, "allocator ownership", { embedder: fakeEmbedder })).at(0);
    expect(hit?.source.id).toBe(source.id);
    expect(hit?.chunk_id).toStartWith(`${source.id}:`);
    expect(hit?.citation).toMatchObject({ source_id: source.id, title: "Memory Manual" });
    expect((await lookupKb(root, hit!.chunk_id!))?.content).toContain("allocator invariant");
    expect(await removeKbSource(root, source.id)).toBe(true);
    expect(existsSync(path.join(root, ".vos", "kb", "objects", `${source.id}.txt`))).toBe(false);

    await addKbSource(root, { source: "manual.md", sourceKind: "course" }, { embedder: fakeEmbedder });
    await clearKbSources(root);
    expect(await listKbSources(root)).toEqual([]);
    expect(existsSync(path.join(root, ".vos", "kb", "index.json"))).toBe(false);
    expect(existsSync(path.join(root, ".vos", "kb", "vectors.sqlite"))).toBe(false);
  });

  test("exports and imports an object manifest with sha256 verification", async () => {
    await addKbSource(root, { source: "manual.md", sourceKind: "course", stage: "memory" }, { embedder: fakeEmbedder });
    const manifest = await exportKbManifest(root);
    const clone = mkdtempSync(path.join(tmpdir(), "vos-kb-clone-"));
    try {
      await importKbManifest(clone, manifest, { embedder: fakeEmbedder });
      expect((await searchKb(clone, "page ownership", { embedder: fakeEmbedder })).at(0)?.source.source_kind).toBe("course");

      const broken = structuredClone(manifest);
      broken.objects[0].sha256 = "bad";
      await expect(importKbManifest(clone, broken, { embedder: fakeEmbedder })).rejects.toThrow(/sha256 mismatch/);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  test("ingests URL snapshots and strips html text", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("<html><body><h1>Pipe Design</h1><p>pipe buffer invariant</p></body></html>", {
        headers: { "content-type": "text/html" },
      }),
    });
    try {
      const source = await addKbSource(root, { source: `http://127.0.0.1:${server.port}/pipe`, sourceKind: "external", title: "Pipe Reference" }, { embedder: fakeEmbedder });
      const cached = readFileSync(path.join(root, ".vos", "kb", "objects", `${source.id}.txt`), "utf8");
      expect(cached).toContain("pipe buffer invariant");
      expect(cached).not.toContain("<body>");
    } finally {
      await server.stop(true);
    }
  });

  test("serves MCP search and lookup tools over stdio", async () => {
    await addKbSource(root, { source: "manual.md", sourceKind: "course" }, { embedder: fakeEmbedder });
    const embeddingServer = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.json() as { input: string[] };
        return Response.json({ data: await Promise.all(body.input.map(async (text) => ({ embedding: (await fakeEmbedder.embed([text]))[0] }))) });
      },
    });
    const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "mcp.ts")], {
      env: {
        ...process.env,
        VOS_PROJECT_ROOT: root,
        VOS_KB_EMBEDDING_BASE_URL: `http://127.0.0.1:${embeddingServer.port}`,
        VOS_KB_EMBEDDING_MODEL: "fake",
        VOS_KB_EMBEDDING_API_KEY: "test-key",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    let id = 1;
    async function request(method: string, params: unknown): Promise<any> {
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      id++;
      const { value } = await reader.read();
      return JSON.parse(new TextDecoder().decode(value));
    }
    await request("initialize", {});
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    const tools = await request("tools/list", {});
    expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toContain("kb_search");
    const search = await request("tools/call", { name: "kb_search", arguments: { query: "allocator" } });
    expect(JSON.parse(search.result.content[0].text)[0].citation.source_id).toStartWith("kb-");
    proc.kill();
    await proc.exited;
    await embeddingServer.stop(true);
  });

  test("indexes git-tracked code recursively while respecting ignored and generated paths", async () => {
    writeFileSync(path.join(root, ".gitignore"), "ignored.c\n");
    writeFileSync(path.join(root, "kernel.c"), "allocator code path\n");
    writeFileSync(path.join(root, "ignored.c"), "ignored allocator code\n");
    mkdirSync(path.join(root, ".vos", "kb"), { recursive: true });
    writeFileSync(path.join(root, ".vos", "kb", "secret.txt"), "ignored allocator secret\n");
    const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    git(["init"]);
    git(["add", ".gitignore", "kernel.c"]);

    await addKbSource(root, { source: ".", sourceKind: "project", recursive: true }, { embedder: fakeEmbedder });

    const sources = await listKbSources(root);
    expect(sources.map((source) => source.source).sort()).toEqual(["course/trap.md", "kernel.c", "manual.md"]);
    expect((await searchKb(root, "ignored allocator", { embedder: fakeEmbedder })).some((hit) => hit.excerpt.includes("ignored"))).toBe(false);
  });

  test("requires an embedder for indexing and searching", async () => {
    await expect(addKbSource(root, { source: "manual.md", sourceKind: "course" })).rejects.toThrow(/embedding/i);
    await expect(searchKb(root, "allocator")).rejects.toThrow(/embedding/i);
  });
});
