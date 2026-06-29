import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import officeparser from "officeparser";
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

  test("returns no search hits for an empty knowledge base", async () => {
    expect(await searchKb(root, "allocator", { embedder: fakeEmbedder })).toEqual([]);
  });

  test("rejects branch and tag specified together", async () => {
    await expect(addKbSource(root, {
      source: "manual.md",
      sourceKind: "course",
      branch: "main",
      tag: "v1.0",
    }, { embedder: fakeEmbedder })).rejects.toThrow(/cannot specify both branch and tag/i);
  });

  test("clones a git remote repo and indexes its files", async () => {
    // Create a bare repo as "remote"
    const remoteDir = mkdtempSync(path.join(tmpdir(), "vos-kb-remote-"));
    const bareDir = path.join(remoteDir, "bare.git");
    mkdirSync(bareDir, { recursive: true });
    Bun.spawnSync(["git", "init", "--bare", bareDir], { stdout: "pipe", stderr: "pipe" });

    // Create a working clone to push content
    const workDir = mkdtempSync(path.join(tmpdir(), "vos-kb-work-"));
    const workGit = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: workDir, stdout: "pipe", stderr: "pipe" });
    workGit(["init", "--initial-branch=main"]);
    workGit(["config", "user.email", "test@example.com"]);
    workGit(["config", "user.name", "VOS Test"]);
    writeFileSync(path.join(workDir, "README.md"), "# Remote Repo\n\nremote allocator patterns\n");
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(path.join(workDir, "src", "alloc.c"), "// kernel allocator\nvoid* kalloc(void) { return NULL; }\n");
    workGit(["add", "."]);
    workGit(["commit", "-m", "initial"]);
    workGit(["remote", "add", "origin", bareDir]);
    workGit(["push", "-u", "origin", "main"]);

    try {
      await addKbSource(root, { source: `file://${bareDir}`, sourceKind: "external", recursive: true, branch: "main" }, { embedder: fakeEmbedder });

      const sources = await listKbSources(root);
      expect(sources.length).toBeGreaterThanOrEqual(2);
      expect(sources.some((s) => s.source.includes("README.md"))).toBe(true);
      expect(sources.some((s) => s.source.includes("alloc.c"))).toBe(true);
      expect((await searchKb(root, "allocator patterns", { embedder: fakeEmbedder })).some((h) => h.excerpt.toLowerCase().includes("allocator"))).toBe(true);
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("clones with branch and indexes the correct branch content", async () => {
    // Create bare repo with main and feature branches
    const remoteDir = mkdtempSync(path.join(tmpdir(), "vos-kb-branch-remote-"));
    const bareDir = path.join(remoteDir, "bare.git");
    mkdirSync(bareDir, { recursive: true });
    Bun.spawnSync(["git", "init", "--bare", bareDir], { stdout: "pipe", stderr: "pipe" });

    const workDir = mkdtempSync(path.join(tmpdir(), "vos-kb-branch-work-"));
    const workGit = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: workDir, stdout: "pipe", stderr: "pipe" });
    workGit(["init", "--initial-branch=main"]);
    workGit(["config", "user.email", "test@example.com"]);
    workGit(["config", "user.name", "VOS Test"]);
    writeFileSync(path.join(workDir, "main.txt"), "main branch content\n");
    workGit(["add", "."]);
    workGit(["commit", "-m", "main commit"]);
    workGit(["checkout", "-b", "feature"]);
    writeFileSync(path.join(workDir, "feature.txt"), "feature branch content with special allocator\n");
    workGit(["add", "."]);
    workGit(["commit", "-m", "feature commit"]);
    workGit(["remote", "add", "origin", bareDir]);
    workGit(["push", "-u", "origin", "main"]);
    workGit(["push", "-u", "origin", "feature"]);

    try {
      await addKbSource(root, { source: `file://${bareDir}`, sourceKind: "external", recursive: true, branch: "feature" }, { embedder: fakeEmbedder });

      const sources = await listKbSources(root);
      expect(sources.some((s) => s.source.includes("feature.txt"))).toBe(true);
      expect(sources.some((s) => s.source.includes("main.txt"))).toBe(true);
      expect((await searchKb(root, "special allocator", { embedder: fakeEmbedder })).some((h) => h.excerpt.includes("special"))).toBe(true);
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("updates an existing git checkout on re-add", async () => {
    const remoteDir = mkdtempSync(path.join(tmpdir(), "vos-kb-update-remote-"));
    const bareDir = path.join(remoteDir, "bare.git");
    mkdirSync(bareDir, { recursive: true });
    Bun.spawnSync(["git", "init", "--bare", bareDir], { stdout: "pipe", stderr: "pipe" });

    const workDir = mkdtempSync(path.join(tmpdir(), "vos-kb-update-work-"));
    const workGit = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: workDir, stdout: "pipe", stderr: "pipe" });
    workGit(["init", "--initial-branch=main"]);
    workGit(["config", "user.email", "test@example.com"]);
    workGit(["config", "user.name", "VOS Test"]);
    writeFileSync(path.join(workDir, "v1.txt"), "version one allocator\n");
    workGit(["add", "."]);
    workGit(["commit", "-m", "v1"]);
    workGit(["remote", "add", "origin", bareDir]);
    workGit(["push", "-u", "origin", "main"]);

    try {
      // First add
      await addKbSource(root, { source: `file://${bareDir}`, sourceKind: "external", recursive: true, branch: "main" }, { embedder: fakeEmbedder });
      expect((await searchKb(root, "version one", { embedder: fakeEmbedder })).some((h) => h.excerpt.includes("version one"))).toBe(true);
      expect((await searchKb(root, "version two", { embedder: fakeEmbedder })).some((h) => h.excerpt.includes("version two"))).toBe(false);

      // Update remote
      writeFileSync(path.join(workDir, "v2.txt"), "version two allocator\n");
      workGit(["add", "."]);
      workGit(["commit", "-m", "v2"]);
      workGit(["push", "origin", "main"]);

      // Re-add (should update)
      await addKbSource(root, { source: `file://${bareDir}`, sourceKind: "external", recursive: true, branch: "main" }, { embedder: fakeEmbedder });
      expect((await searchKb(root, "version two", { embedder: fakeEmbedder })).some((h) => h.excerpt.includes("version two"))).toBe(true);
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("clones with a tag and indexes tag content", async () => {
    const remoteDir = mkdtempSync(path.join(tmpdir(), "vos-kb-tag-remote-"));
    const bareDir = path.join(remoteDir, "bare.git");
    mkdirSync(bareDir, { recursive: true });
    Bun.spawnSync(["git", "init", "--bare", bareDir], { stdout: "pipe", stderr: "pipe" });

    const workDir = mkdtempSync(path.join(tmpdir(), "vos-kb-tag-work-"));
    const workGit = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: workDir, stdout: "pipe", stderr: "pipe" });
    workGit(["init", "--initial-branch=main"]);
    workGit(["config", "user.email", "test@example.com"]);
    workGit(["config", "user.name", "VOS Test"]);
    writeFileSync(path.join(workDir, "released.md"), "# v1.0 Release\n\nstable allocator API\n");
    workGit(["add", "."]);
    workGit(["commit", "-m", "release commit"]);
    workGit(["tag", "v1.0"]);
    writeFileSync(path.join(workDir, "wip.md"), "# draft\nunstable work in progress\n");
    workGit(["add", "."]);
    workGit(["commit", "-m", "wip commit"]);
    workGit(["remote", "add", "origin", bareDir]);
    workGit(["push", "-u", "origin", "main"]);
    workGit(["push", "origin", "--tags"]);

    try {
      await addKbSource(root, { source: `file://${bareDir}`, sourceKind: "external", recursive: true, tag: "v1.0" }, { embedder: fakeEmbedder });

      const sources = await listKbSources(root);
      expect(sources.some((s) => s.source.includes("released.md"))).toBe(true);
      expect(sources.some((s) => s.source.includes("wip.md"))).toBe(false);
      expect((await searchKb(root, "stable allocator", { embedder: fakeEmbedder })).some((h) => h.excerpt.includes("stable"))).toBe(true);
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("keeps officeparser PDF extraction working", async () => {
    const pdfPath = path.resolve(import.meta.dir, "../../../../docs/fast26-liu-qingyuan.pdf");
    expect(existsSync(pdfPath)).toBe(true);
    const ast = await officeparser.parseOffice(pdfPath, { ocr: false });
    const text = ast.toText().replace(/\s+/g, " ").trim();
    expect(text.length).toBeGreaterThan(1000);
  });
});
