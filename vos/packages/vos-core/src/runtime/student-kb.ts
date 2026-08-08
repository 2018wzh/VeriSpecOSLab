import { createHash } from "node:crypto";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ProjectManifest } from "vos-spec";

export interface StudentKbLock {
  version: "vos.kb.lock.v1";
  generated_at: string;
  sources: Array<{
    id: string;
    path: string;
    origin: string;
    revision?: string;
    sha256: string;
  }>;
}

/** Materialize manifest-locked KB inputs below gitignored .vos/kb-sources. */
export async function syncStudentKbSources(projectRoot: string, manifest: ProjectManifest): Promise<StudentKbLock> {
  const root = path.join(projectRoot, ".vos", "kb-sources");
  await mkdir(root, { recursive: true });
  const sources: StudentKbLock["sources"] = [];
  for (const source of manifest.knowledge.sources) {
    const sourceDir = path.join(root, safeSourceId(source.id));
    await rm(sourceDir, { recursive: true, force: true });
    if (source.path) {
      const sourcePath = resolveProjectPath(projectRoot, source.path);
      if (!existsSync(sourcePath)) throw new Error(`KB source path does not exist: ${source.path}`);
      await cp(sourcePath, sourceDir, { recursive: true });
      const actual = await hashPath(sourcePath, [".git"]);
      if (actual.toLowerCase() !== source.sha256.toLowerCase()) {
        throw new Error(`KB source hash mismatch for ${source.id}: expected ${source.sha256}, got ${actual}`);
      }
      sources.push({ id: source.id, path: path.relative(projectRoot, sourceDir).replace(/\\/g, "/"), origin: source.path, revision: source.revision, sha256: actual });
      continue;
    }
    if (!source.url) throw new Error(`KB source ${source.id} has neither path nor url`);
    await runGit(projectRoot, ["clone", "--no-checkout", source.url, sourceDir]);
    // URL sources are schema-required to carry a pinned revision. Checkout is
    // explicit so the content hash never silently follows a moving default
    // branch.
    await runGit(sourceDir, ["checkout", "--force", source.revision!]);
    const actual = await hashGitTree(sourceDir);
    if (actual.toLowerCase() !== source.sha256.toLowerCase()) {
      throw new Error(`KB source hash mismatch for ${source.id}: expected ${source.sha256}, got ${actual}`);
    }
    sources.push({ id: source.id, path: path.relative(projectRoot, sourceDir).replace(/\\/g, "/"), origin: source.url, revision: source.revision, sha256: actual });
  }
  const lock: StudentKbLock = { version: "vos.kb.lock.v1", generated_at: new Date().toISOString(), sources };
  await writeFile(path.join(root, "lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

function resolveProjectPath(projectRoot: string, relative: string): string {
  const resolved = path.resolve(projectRoot, relative);
  const relativeResolved = path.relative(projectRoot, resolved);
  if (path.isAbsolute(relativeResolved) || relativeResolved === ".." || relativeResolved.startsWith(`..${path.sep}`)) {
    throw new Error(`KB source path escapes project root: ${relative}`);
  }
  return resolved;
}

function safeSourceId(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe) throw new Error(`invalid KB source id: ${id}`);
  return safe;
}

async function hashGitTree(root: string): Promise<string> {
  return hashPath(root, [".git"]);
}

async function hashPath(target: string, ignored: string[] = []): Promise<string> {
  const info = await stat(target);
  if (info.isFile()) return createHash("sha256").update(await Bun.file(target).bytes()).digest("hex");
  if (!info.isDirectory()) throw new Error(`KB source must be a file or directory: ${target}`);
  const hash = createHash("sha256");
  await hashDirectory(target, target, hash, new Set(ignored));
  return hash.digest("hex");
}

async function hashDirectory(root: string, current: string, hash: ReturnType<typeof createHash>, ignored = new Set<string>()): Promise<void> {
  const entries = (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      hash.update(`dir:${rel}\0`);
      await hashDirectory(root, full, hash, ignored);
    } else if (entry.isFile()) {
      hash.update(`file:${rel}\0`);
      hash.update(await Bun.file(full).bytes());
      hash.update("\0");
    } else {
      throw new Error(`KB source contains unsupported filesystem entry: ${rel}`);
    }
  }
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) throw new Error(stderr.trim() || stdout.trim() || `git ${args[0]} failed`);
}
