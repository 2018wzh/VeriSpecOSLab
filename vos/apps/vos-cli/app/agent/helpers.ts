import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function scanRecentEvidenceRefs(projectRoot: string, limit = 10): Promise<Array<{ run_id: string; manifest: string }>> {
  const evidenceRuns = path.resolve(projectRoot, ".vos", "runs");
  if (!existsSync(evidenceRuns)) {
    return [];
  }
  const dirs = await readdir(evidenceRuns, { withFileTypes: true });
  const withStats: Array<{ run_id: string; manifest: string; mtimeMs: number }> = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const manifestPath = path.join(evidenceRuns, dir.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const stat = await import("node:fs/promises").then((m) => m.stat(manifestPath));
    withStats.push({ run_id: dir.name, manifest: manifestPath, mtimeMs: stat.mtimeMs });
  }
  return withStats
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((entry) => ({
      run_id: entry.run_id,
      manifest: entry.manifest,
    }));
}

export async function appendLogEntry(logPath: string, entry: unknown): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  const { appendFileSync } = await import("node:fs");
  appendFileSync(logPath, line);
}

export async function readLogEntries(logPath: string): Promise<unknown[]> {
  if (!existsSync(logPath)) return [];
  const text = await readFile(logPath, "utf8");
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      out.push({ raw: line });
    }
  }
  return out;
}
