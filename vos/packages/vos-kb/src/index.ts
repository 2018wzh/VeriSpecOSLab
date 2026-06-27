import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import * as cheerio from "cheerio";
import mime from "mime";
import officeparser from "officeparser";
import simpleGit, { type SimpleGit } from "simple-git";
import * as sqliteVec from "sqlite-vec";
import { z } from "zod";

export type KbSourceKind = "course" | "project" | "external";

export interface ObjectRef {
  id: string;
  uri: string;
  sha256: string;
  content_type: string;
  size: number;
  visibility: "student" | "staff";
  content?: string;
}

export interface KbSource {
  id: string;
  title: string;
  source: string;
  source_kind: KbSourceKind;
  sha256: string;
  object_ref?: ObjectRef;
  stage_scope?: string;
  added_at: string;
}

export interface KbChunk {
  id: string;
  source_id: string;
  title: string;
  content: string;
  stage_scope?: string;
}

export interface KbIndex {
  version: 1;
  sources: KbSource[];
  chunks?: KbChunk[];
}

export interface KbCitation {
  source_id: string;
  title: string;
  object_ref?: string;
  chunk_id?: string;
}

export interface KbSearchHit {
  source: KbSource;
  score: number;
  excerpt: string;
  chunk_id?: string;
  citation: KbCitation;
}

export interface KbManifest {
  version: 1;
  objects: ObjectRef[];
  sources: KbSource[];
}

export interface AddKbSourceInput {
  source: string;
  sourceKind: KbSourceKind;
  stage?: string;
  title?: string;
  recursive?: boolean;
  branch?: string;
  tag?: string;
}

export interface ListKbSourcesFilter {
  sourceKind?: KbSourceKind;
  stage?: string;
}

export interface SearchKbOptions {
  limit?: number;
  stage?: string;
  embedder?: KbEmbedder;
}

export interface KbEmbedder {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface KbEmbeddingOptions {
  embedder?: KbEmbedder;
}

export interface OpenAICompatibleEmbeddingConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const sourceKindSchema = z.enum(["course", "project", "external"]);
const objectRefSchema = z.object({
  id: z.string(),
  uri: z.string(),
  sha256: z.string(),
  content_type: z.string(),
  size: z.number(),
  visibility: z.enum(["student", "staff"]),
  content: z.string().optional(),
});
const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  source_kind: sourceKindSchema,
  sha256: z.string(),
  object_ref: objectRefSchema.optional(),
  stage_scope: z.string().optional(),
  added_at: z.string(),
});
const manifestSchema = z.object({
  version: z.literal(1),
  objects: z.array(objectRefSchema),
  sources: z.array(sourceSchema),
});

export function createOpenAICompatibleEmbedder(config: OpenAICompatibleEmbeddingConfig): KbEmbedder {
  return {
    model: config.model,
    async embed(texts: string[]): Promise<number[][]> {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: config.model, input: texts }),
      });
      if (!response.ok) {
        throw new Error(`embedding provider failed: ${response.status} ${await response.text()}`);
      }
      const body = await response.json() as { data?: Array<{ embedding?: unknown }> };
      const vectors = body.data?.map((item) => Array.isArray(item.embedding) ? item.embedding.map(Number) : undefined) ?? [];
      if (vectors.some((vector) => !vector)) throw new Error("embedding provider returned invalid vectors");
      return vectors as number[][];
    },
  };
}

export async function addKbSource(
  projectRoot: string,
  sourceOrInput: string | AddKbSourceInput,
  legacySourceKindOrOptions?: KbSourceKind | KbEmbeddingOptions,
): Promise<KbSource> {
  const options = typeof legacySourceKindOrOptions === "object" ? legacySourceKindOrOptions : {};
  const input = typeof sourceOrInput === "string"
    ? { source: sourceOrInput, sourceKind: typeof legacySourceKindOrOptions === "string" ? legacySourceKindOrOptions : "project" }
    : sourceOrInput;
  if (input.branch && input.tag) throw new Error("cannot specify both branch and tag for KB git source");
  const embedder = requireEmbedder(options.embedder);
  const gitRef = input.branch || input.tag ? { branch: input.branch, tag: input.tag } : undefined;
  const files = await expandSources(projectRoot, input.source, input.recursive ?? false, gitRef);
  let first: KbSource | undefined;
  for (const file of files) {
    const item = await addOne(projectRoot, { ...input, source: file }, embedder);
    first ??= item;
  }
  if (!first) throw new Error(`no KB source matched ${input.source}`);
  return first;
}

export async function listKbSources(projectRoot: string, filter: ListKbSourcesFilter = {}): Promise<KbSource[]> {
  return (await readKbIndex(projectRoot)).sources.filter((source) =>
    (!filter.sourceKind || source.source_kind === filter.sourceKind) &&
    (!filter.stage || source.stage_scope === filter.stage)
  );
}

export async function lookupKb(projectRoot: string, id: string): Promise<(KbChunk & { source: KbSource }) | undefined> {
  const index = await readKbIndex(projectRoot);
  const chunk = (index.chunks ?? []).find((item) => item.id === id || item.source_id === id);
  if (!chunk) return undefined;
  const source = index.sources.find((item) => item.id === chunk.source_id);
  return source ? { ...chunk, source } : undefined;
}

export async function removeKbSource(projectRoot: string, id: string): Promise<boolean> {
  const index = await readKbIndex(projectRoot);
  const before = index.sources.length;
  const removed = index.sources.find((source) => source.id === id);
  index.sources = index.sources.filter((source) => source.id !== id);
  index.chunks = (index.chunks ?? []).filter((chunk) => chunk.source_id !== id);
  await writeKbIndex(projectRoot, index);
  removeVectorsForSource(projectRoot, id);
  if (removed) await rm(cachedObjectPath(projectRoot, removed), { force: true });
  return index.sources.length !== before;
}

export async function clearKbSources(projectRoot: string): Promise<void> {
  await writeKbIndex(projectRoot, { version: 1, sources: [], chunks: [] });
  await rm(path.join(projectRoot, ".vos", "kb", "index.json"), { force: true });
  await rm(path.join(projectRoot, ".vos", "kb", "objects"), { recursive: true, force: true });
  await rm(vectorDbPath(projectRoot), { force: true });
}

export async function searchKb(
  projectRoot: string,
  query: string,
  limitOrOptions: number | SearchKbOptions = 5,
): Promise<KbSearchHit[]> {
  const options = typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const embedder = requireEmbedder(options.embedder);
  const index = await readKbIndex(projectRoot);
  const sources = new Map(index.sources.map((source) => [source.id, source]));
  const chunks = index.chunks ?? await hydrateChunks(projectRoot, index.sources);
  if (chunks.length > 0 && !existsSync(vectorDbPath(projectRoot))) {
    await rebuildVectorIndex(projectRoot, chunks, embedder);
  }
  const queryVector = (await embedder.embed([query]))[0];
  if (!queryVector) throw new Error("embedding provider returned no query vector");
  const db = openVectorDb(projectRoot);
  const hits: KbSearchHit[] = [];
  try {
    const rows = db.query(`
      SELECT meta.id, meta.source_id, meta.title, meta.content, meta.stage_scope, vectors.distance
      FROM kb_vectors AS vectors
      JOIN kb_chunk_meta AS meta ON meta.rowid = vectors.rowid
      WHERE vectors.embedding MATCH ? AND k = ?
      ORDER BY vectors.distance
    `).all(vectorBlob(queryVector), options.limit ?? 5) as Array<KbChunk & { distance: number }>;
    for (const row of rows.filter((chunk) => !options.stage || chunk.stage_scope === options.stage)) {
      const source = sources.get(row.source_id);
      if (!source) continue;
      hits.push({
        source,
        score: 1 / (1 + row.distance),
        excerpt: excerpt(row.content, query),
        chunk_id: row.id,
        citation: {
          source_id: source.id,
          title: source.title,
          object_ref: source.object_ref?.uri,
          chunk_id: row.id,
        },
      });
    }
  } finally {
    db.close();
  }
  return hits
    .sort((left, right) => right.score - left.score || left.source.title.localeCompare(right.source.title) || left.source.id.localeCompare(right.source.id))
    .slice(0, options.limit ?? 5);
}

export async function exportKbManifest(projectRoot: string): Promise<KbManifest> {
  const sources = await listKbSources(projectRoot);
  return {
    version: 1,
    objects: await Promise.all(sources.flatMap((source) => source.object_ref ? [source] : []).map(async (source) => ({
      ...source.object_ref!,
      content: await cachedContent(projectRoot, source),
    }))),
    sources,
  };
}

export async function importKbManifest(projectRoot: string, raw: unknown, options: KbEmbeddingOptions = {}): Promise<KbManifest> {
  const embedder = requireEmbedder(options.embedder);
  const manifest = manifestSchema.parse(raw);
  const existing = await readKbIndex(projectRoot);
  const byId = new Map(existing.sources.map((source) => [source.id, source]));
  for (const source of manifest.sources) {
    const object = manifest.objects.find((candidate) => candidate.id === (source.object_ref?.id ?? `obj-${source.id}`)) ?? source.object_ref;
    if (!object) throw new Error(`object ref missing for ${source.id}`);
    const content = object.content ?? "";
    if (object.sha256 !== source.sha256 || (content && hash(content) !== object.sha256)) throw new Error(`sha256 mismatch for ${source.id}`);
    byId.set(source.id, { ...source, object_ref: object });
    await writeCachedObject(projectRoot, source, content || `Restored object ${object.uri}\nsha256: ${object.sha256}\n`);
  }
  const sources = [...byId.values()];
  const chunks = await hydrateChunks(projectRoot, sources);
  await writeKbIndex(projectRoot, { version: 1, sources, chunks });
  await rebuildVectorIndex(projectRoot, chunks, embedder);
  return manifest;
}

async function addOne(projectRoot: string, input: AddKbSourceInput, embedder: KbEmbedder): Promise<KbSource> {
  const index = await readKbIndex(projectRoot);
  const loaded = await readSource(projectRoot, input.source);
  const sha256 = hash(loaded.content);
  const id = `kb-${sha256.slice(0, 12)}`;
  const item: KbSource = {
    id,
    title: input.title ?? titleFor(input.source),
    source: input.source,
    source_kind: input.sourceKind,
    sha256,
    object_ref: objectRefFor(id, input.source, loaded.content, loaded.contentType),
    stage_scope: input.stage,
    added_at: new Date().toISOString(),
  };
  const chunks = chunkText(item, loaded.content);
  if (chunks.length === 0) throw new Error(`KB source has no extractable text: ${input.source}`);
  index.sources = [item, ...index.sources.filter((existing) => existing.id !== id)];
  index.chunks = [...chunks, ...(index.chunks ?? []).filter((chunk) => chunk.source_id !== id)];
  await writeKbIndex(projectRoot, index);
  await writeCachedObject(projectRoot, item, loaded.content);
  await upsertVectors(projectRoot, chunks, embedder);
  return item;
}

// --- Git remote repository support ---

const GIT_REMOTE_RE = /^(?:https?:\/\/|git@|file:\/\/)[^\s]+\.git(?:\/[^\s]*)?$/i;

function isGitRemoteUrl(source: string): boolean {
  return GIT_REMOTE_RE.test(source);
}

function gitCacheDir(projectRoot: string, url: string): string {
  return path.join(projectRoot, ".vos", "kb", "repos", hash(url).slice(0, 16));
}

function readGitAuthConfig(projectRoot: string): { sshKeyPath?: string; token?: string } {
  const configPath = path.join(projectRoot, ".vos", "config.toml");
  if (!existsSync(configPath)) return {};
  const parsed = Bun.TOML.parse(readFileSync(configPath, "utf8"));
  if (!parsed || typeof parsed !== "object") return {};
  const root = parsed as Record<string, unknown>;
  const gitSection = (root.kb as Record<string, unknown> | undefined)?.git as Record<string, unknown> | undefined
    ?? (root.git as Record<string, unknown> | undefined);
  if (!gitSection || typeof gitSection !== "object") return {};
  return {
    sshKeyPath: typeof gitSection.ssh_key_path === "string" ? gitSection.ssh_key_path : undefined,
    token: typeof gitSection.token === "string" ? gitSection.token : undefined,
  };
}

async function cloneOrUpdateRepo(
  projectRoot: string,
  url: string,
  cacheDir: string,
  options: { branch?: string; tag?: string },
): Promise<string> {
  let resolvedUrl = url;
  const auth = readGitAuthConfig(projectRoot);

  // Resolve auth URL once; env vars only needed when auth is present.
  if (auth.token) {
    resolvedUrl = url.replace(/^https?:\/\//, (match) => `${match}oauth2:${auth.token}@`);
  }

  // Build a minimal env for git auth, avoiding process.env spread so
  // simple-git's vulnerability checks don't flag inherited GIT_EDITOR etc.
  const buildAuthEnv = (): Record<string, string> | undefined => {
    const pairs: Record<string, string> = {};
    if (auth.sshKeyPath) {
      const resolved = auth.sshKeyPath.replace(/^~/, process.env.HOME ?? "/root");
      pairs.GIT_SSH_COMMAND = `ssh -i ${resolved} -o StrictHostKeyChecking=accept-new`;
    }
    if (auth.token) pairs.GIT_TERMINAL_PROMPT = "0";
    return Object.keys(pairs).length > 0 ? pairs : undefined;
  };
  const authEnv = buildAuthEnv();

  const withEnv = (git: SimpleGit): SimpleGit => authEnv ? git.env(authEnv) : git;

  if (existsSync(cacheDir) && existsSync(path.join(cacheDir, ".git"))) {
    // Update existing checkout
    const git = simpleGit(cacheDir);
    if (options.tag) {
      await withEnv(git).fetch(["origin", `refs/tags/${options.tag}:refs/tags/${options.tag}`, "--force"]);
      await withEnv(git).checkout(options.tag);
    } else if (options.branch) {
      await withEnv(git).fetch(["origin", options.branch]);
      // Force local branch to match updated remote tracking ref
      await withEnv(git).raw(["checkout", "-B", options.branch, `origin/${options.branch}`]);
    } else {
      await withEnv(git).fetch(["origin"]);
      const head = await git.revparse(["HEAD"]);
      await withEnv(git).checkout(head);
    }
  } else {
    // Fresh clone
    if (existsSync(cacheDir)) await rm(cacheDir, { recursive: true, force: true });
    await mkdir(path.dirname(cacheDir), { recursive: true });
    const cloneArgs: string[] = ["--depth", "1"];
    if (options.branch) cloneArgs.push("--branch", options.branch);
    await withEnv(simpleGit({ baseDir: path.dirname(cacheDir) })).clone(resolvedUrl, path.basename(cacheDir), cloneArgs);
    if (options.tag) {
      const git = simpleGit(cacheDir);
      // Shallow clones skip tags; fetch the tag explicitly
      await withEnv(git).fetch(["origin", `refs/tags/${options.tag}:refs/tags/${options.tag}`]);
      await withEnv(git).checkout(options.tag);
    }
  }
  return cacheDir;
}

async function expandGitRemoteSource(
  projectRoot: string,
  url: string,
  recursive: boolean,
  gitRef?: { branch?: string; tag?: string },
): Promise<string[]> {
  const cacheDir = gitCacheDir(projectRoot, url);
  await cloneOrUpdateRepo(projectRoot, url, cacheDir, {
    branch: gitRef?.branch,
    tag: gitRef?.tag,
  });

  if (!recursive) {
    // Index only files in the repo root
    const out: string[] = [];
    for (const entry of await readdir(cacheDir, { withFileTypes: true })) {
      if (entry.isDirectory() && shouldSkipDirectory(entry.name)) continue;
      if (entry.isFile() && isIndexableFile(path.join(cacheDir, entry.name))) {
        out.push(path.relative(projectRoot, path.join(cacheDir, entry.name)));
      }
    }
    return out.sort();
  }

  // Recursive: prefer git ls-files when available
  const gitFiles = gitListFiles(cacheDir);
  if (gitFiles) {
    return gitFiles
      .filter((file) => !isIgnoredKbPath(file) && isIndexableFile(path.join(cacheDir, file)))
      .map((file) => path.relative(projectRoot, path.join(cacheDir, file)))
      .sort();
  }
  // Fallback: manual recursive walk
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && shouldSkipDirectory(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      if (entry.isFile() && isIndexableFile(full)) out.push(path.relative(projectRoot, full));
    }
  };
  await walk(cacheDir);
  return out.sort();
}

// --- End git remote repository support ---

async function expandSources(projectRoot: string, source: string, recursive: boolean, gitRef?: { branch?: string; tag?: string }): Promise<string[]> {
  if (isGitRemoteUrl(source)) {
    return expandGitRemoteSource(projectRoot, source, recursive, gitRef);
  }
  if (/^https?:\/\//.test(source)) return [source];
  const resolved = path.resolve(projectRoot, source);
  if (!existsSync(resolved)) throw new Error(`KB source not found: ${source}`);
  const stat = await Bun.file(resolved).stat();
  if (stat.isFile()) return [source];
  if (!stat.isDirectory() || !recursive) return [source];
  const gitFiles = gitListFiles(resolved);
  if (gitFiles) {
    return gitFiles
      .filter((file) => !isIgnoredKbPath(file) && isIndexableFile(path.join(resolved, file)))
      .map((file) => path.relative(projectRoot, path.join(resolved, file)))
      .sort();
  }
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && shouldSkipDirectory(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      if (entry.isFile() && isIndexableFile(full)) out.push(path.relative(projectRoot, full));
    }
  };
  await walk(resolved);
  return out.sort();
}

async function readKbIndex(projectRoot: string): Promise<KbIndex> {
  const file = indexPath(projectRoot);
  if (!existsSync(file)) return { version: 1, sources: [], chunks: [] };
  const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<KbIndex>;
  return {
    version: 1,
    sources: Array.isArray(parsed.sources) ? parsed.sources as KbSource[] : [],
    chunks: Array.isArray(parsed.chunks) ? parsed.chunks as KbChunk[] : [],
  };
}

async function writeKbIndex(projectRoot: string, index: KbIndex): Promise<void> {
  const file = indexPath(projectRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(index, null, 2)}\n`);
  await writeFile(path.join(projectRoot, ".vos", "kb", "index.json"), `${JSON.stringify(index.chunks ?? [], null, 2)}\n`);
}

async function readSource(projectRoot: string, source: string): Promise<{ content: string; contentType: string }> {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`failed to fetch ${source}: ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "text/plain";
    const text = await response.text();
    return { content: contentType.includes("html") ? htmlToText(text) : text, contentType };
  }
  const resolved = path.resolve(projectRoot, source);
  const type = mime.getType(resolved) ?? "text/plain";
  if (isOfficeFile(resolved, type)) {
    const ast = await officeparser.parseOffice(resolved, { ocr: false });
    const content = ast.toText().replace(/\s+/g, " ").trim();
    if (!content) throw new Error(`KB source has no extractable text: ${source}`);
    return { content, contentType: type };
  }
  return {
    content: await readFile(resolved, "utf8"),
    contentType: type,
  };
}

async function writeCachedObject(projectRoot: string, source: KbSource, content: string): Promise<void> {
  const file = cachedObjectPath(projectRoot, source);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function cachedContent(projectRoot: string, source: KbSource): Promise<string> {
  const cached = cachedObjectPath(projectRoot, source);
  if (existsSync(cached)) return await readFile(cached, "utf8");
  return (await readSource(projectRoot, source.source)).content;
}

async function hydrateChunks(projectRoot: string, sources: KbSource[]): Promise<KbChunk[]> {
  const chunks: KbChunk[] = [];
  for (const source of sources) {
    chunks.push(...chunkText(source, await cachedContent(projectRoot, source)));
  }
  return chunks;
}

function chunkText(source: KbSource, content: string): KbChunk[] {
  const parts = content.split(/\n{2,}|(?=^#\s+)/m).map((part) => part.trim()).filter(Boolean);
  const MAX_CHUNK = 8000; // characters per chunk to stay within embedding token limits
  const chunks: KbChunk[] = [];
  let index = 0;
  for (const part of parts.length ? parts : [content]) {
    if (part.length <= MAX_CHUNK) {
      chunks.push(makeChunk(source, part, ++index));
    } else {
      for (let offset = 0; offset < part.length; offset += MAX_CHUNK) {
        chunks.push(makeChunk(source, part.slice(offset, offset + MAX_CHUNK), ++index));
      }
    }
  }
  return chunks;
}

function makeChunk(source: KbSource, content: string, index: number): KbChunk {
  return {
    id: `${source.id}:${index}`,
    source_id: source.id,
    title: source.title,
    content,
    stage_scope: source.stage_scope,
  };
}

function indexPath(projectRoot: string): string {
  return path.join(projectRoot, ".vos", "kb", "sources.json");
}

function cachedObjectPath(projectRoot: string, source: KbSource): string {
  return path.join(projectRoot, ".vos", "kb", "objects", `${source.id}.txt`);
}

function vectorDbPath(projectRoot: string): string {
  return path.join(projectRoot, ".vos", "kb", "vectors.sqlite");
}

function objectRefFor(id: string, source: string, content: string, contentType: string): ObjectRef {
  return {
    id: `obj-${id}`,
    uri: `s3://vos-demo/kb/${id}/${encodeURIComponent(titleFor(source))}`,
    sha256: hash(content),
    content_type: contentType,
    size: Buffer.byteLength(content),
    visibility: "student",
  };
}

function titleFor(source: string): string {
  return path.basename(new URLish(source).pathname) || source;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function excerpt(content: string, query: string): string {
  const term = query.toLowerCase().split(/\s+/).find(Boolean) ?? "";
  const index = term ? content.toLowerCase().indexOf(term) : -1;
  const start = Math.max(0, index < 0 ? 0 : index - 80);
  return content.slice(start, start + 240).replace(/\s+/g, " ").trim();
}

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function isIndexableFile(file: string): boolean {
  const type = mime.getType(file) ?? "text/plain";
  return type.startsWith("text/") || type === "application/json" || isOfficeFile(file, type);
}

function isOfficeFile(file: string, type: string): boolean {
  return [".pdf", ".docx", ".pptx", ".odt", ".odp", ".rtf"].includes(path.extname(file).toLowerCase()) ||
    [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(type);
}

function shouldSkipDirectory(name: string): boolean {
  return [".git", ".vos", "node_modules", "dist", "build"].includes(name);
}

function isIgnoredKbPath(file: string): boolean {
  return file === ".gitignore" ||
    file.startsWith(".git/") ||
    file.startsWith(".vos/") ||
    file.includes("/.vos/") ||
    file.includes("/node_modules/") ||
    file.includes("/dist/") ||
    file.includes("/build/");
}

function gitListFiles(dir: string): string[] | undefined {
  const result = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  return new TextDecoder().decode(result.stdout).split(/\r?\n/).filter(Boolean);
}

function requireEmbedder(embedder: KbEmbedder | undefined): KbEmbedder {
  if (!embedder) throw new Error("KB embedding provider is required");
  return embedder;
}

async function rebuildVectorIndex(projectRoot: string, chunks: KbChunk[], embedder: KbEmbedder): Promise<void> {
  await rm(vectorDbPath(projectRoot), { force: true });
  await upsertVectors(projectRoot, chunks, embedder);
}

async function upsertVectors(projectRoot: string, chunks: KbChunk[], embedder: KbEmbedder): Promise<void> {
  if (chunks.length === 0) return;
  const vectors = await embedder.embed(chunks.map((chunk) => `${chunk.title}\n${chunk.content}`));
  if (vectors.length !== chunks.length) throw new Error("embedding provider returned wrong vector count");
  const dim = vectors[0]?.length;
  if (!dim) throw new Error("embedding provider returned empty vectors");
  if (!vectors.every((vector) => vector.length === dim)) throw new Error("embedding provider returned inconsistent vector dimensions");
  const db = openVectorDb(projectRoot, dim);
  try {
    const removeMeta = db.query("DELETE FROM kb_chunk_meta WHERE source_id = ?");
    const removeVec = db.query("DELETE FROM kb_vectors WHERE rowid IN (SELECT rowid FROM kb_chunk_meta WHERE source_id = ?)");
    for (const sourceId of new Set(chunks.map((chunk) => chunk.source_id))) {
      removeVec.run(sourceId);
      removeMeta.run(sourceId);
    }
    const insertMeta = db.query("INSERT INTO kb_chunk_meta(id, source_id, title, content, stage_scope) VALUES (?, ?, ?, ?, ?) RETURNING rowid");
    const insertVector = db.query("INSERT INTO kb_vectors(rowid, embedding) VALUES (?, ?)");
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const row = insertMeta.get(chunk.id, chunk.source_id, chunk.title, chunk.content, chunk.stage_scope ?? null) as { rowid: number };
      insertVector.run(row.rowid, vectorBlob(vectors[index]));
    }
  } finally {
    db.close();
  }
}

function removeVectorsForSource(projectRoot: string, sourceId: string): void {
  if (!existsSync(vectorDbPath(projectRoot))) return;
  const db = openVectorDb(projectRoot);
  try {
    const ids = db.query("SELECT rowid FROM kb_chunk_meta WHERE source_id = ?").all(sourceId) as Array<{ rowid: number }>;
    const removeVec = db.query("DELETE FROM kb_vectors WHERE rowid = ?");
    for (const row of ids) removeVec.run(row.rowid);
    db.query("DELETE FROM kb_chunk_meta WHERE source_id = ?").run(sourceId);
  } finally {
    db.close();
  }
}

function openVectorDb(projectRoot: string, dimension?: number): Database {
  const dbPath = vectorDbPath(projectRoot);
  mkdirSyncForDb(dbPath);
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.run("CREATE TABLE IF NOT EXISTS kb_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS kb_chunk_meta(id TEXT UNIQUE NOT NULL, source_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, stage_scope TEXT)");
  const existing = db.query("SELECT value FROM kb_meta WHERE key = 'dimension'").get() as { value: string } | null;
  if (dimension !== undefined) {
    if (existing && Number(existing.value) !== dimension) {
      db.close();
      throw new Error(`embedding dimension changed from ${existing.value} to ${dimension}; clear or rebuild KB`);
    }
    if (!existing) {
      db.run(`CREATE VIRTUAL TABLE kb_vectors USING vec0(embedding float[${dimension}])`);
      db.query("INSERT INTO kb_meta(key, value) VALUES ('dimension', ?)").run(String(dimension));
    }
  }
  return db;
}

function vectorBlob(vector: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vector).buffer);
}

function mkdirSyncForDb(file: string): void {
  const dir = path.dirname(file);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

class URLish {
  readonly pathname: string;
  constructor(value: string) {
    try {
      this.pathname = new URL(value).pathname;
    } catch {
      this.pathname = value;
    }
  }
}
