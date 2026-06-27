import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "../errors.ts";
import type { CommitLedgerEntry, ReproducibilityVerdict } from "../types.ts";
import type { EvidenceRef } from "../evidence/manifest.ts";

export const LEDGER_PATH = ".vos/commit-ledger.jsonl";

export async function checkReproducibility(projectRoot: string): Promise<ReproducibilityVerdict> {
  const head = gitMaybe(projectRoot, ["rev-parse", "HEAD"]);
  if (!head.ok) {
    return { ok: false, reason: "not_git_repo" };
  }
  const commitSha = head.stdout.trim();
  if (!commitSha) {
    return { ok: false, reason: "head_missing" };
  }
  const status = gitMaybe(projectRoot, ["status", "--porcelain", "--untracked-files=all"]);
  if (!status.ok) {
    return { ok: false, reason: "not_git_repo" };
  }
  const dirty = status.stdout.split(/\r?\n/).filter(Boolean).filter((line) => {
    const file = line.slice(3).trim();
    return !isIgnoredRuntimeArtifact(file);
  });
  if (dirty.length > 0) {
    return { ok: false, reason: "dirty_worktree", commitSha };
  }
  const ledgerEntry = await findLedgerEntry(projectRoot, commitSha);
  if (!ledgerEntry) {
    return { ok: false, reason: "ledger_missing", commitSha, parentSha: parentSha(projectRoot) };
  }
  return {
    ok: true,
    commitSha,
    parentSha: parentSha(projectRoot),
    ledgerRef: `${LEDGER_PATH}#${commitSha}`,
  };
}

export async function assertReproducible(projectRoot: string): Promise<ReproducibilityVerdict> {
  const verdict = await checkReproducibility(projectRoot);
  if (!verdict.ok) {
    throw new CliError(`policy_blocked: ${verdict.reason}`, "policy_blocked", {
      reason: verdict.reason,
      commit_sha: verdict.commitSha,
      suggested_next_commands: ["vos stage save --intent \"record current stage state\""],
    });
  }
  return verdict;
}

export async function appendLedgerEntry(
  projectRoot: string,
  entry: Omit<CommitLedgerEntry, "created_at"> & { created_at?: string },
): Promise<CommitLedgerEntry> {
  const finalEntry: CommitLedgerEntry = {
    ...entry,
    created_at: entry.created_at ?? new Date().toISOString(),
  };
  const ledgerPath = path.join(projectRoot, LEDGER_PATH);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, `${JSON.stringify(finalEntry)}\n`);
  return finalEntry;
}

export async function ensureHeadLedgerEntry(params: {
  projectRoot: string;
  actor: "human" | "agent";
  intent: string;
  specRefs?: string[];
  changedTargets?: string[];
  runId?: string;
  evidenceRefs?: EvidenceRef[];
  agentSessionId?: string;
}): Promise<CommitLedgerEntry | undefined> {
  const commitSha = currentHead(params.projectRoot);
  if (!commitSha) return undefined;
  const existing = await findLedgerEntry(params.projectRoot, commitSha);
  if (existing) return existing;
  return appendLedgerEntry(params.projectRoot, {
    commit_sha: commitSha,
    parent_sha: parentSha(params.projectRoot),
    actor: params.actor,
    agent_session_id: params.agentSessionId,
    run_id: params.runId,
    spec_refs: params.specRefs ?? [],
    changed_targets: params.changedTargets ?? [],
    evidence_refs: params.evidenceRefs ?? [],
    collaboration_intent: params.intent,
  });
}

export async function writeEvidenceIndex(params: {
  projectRoot: string;
  runId: string;
  command: string[];
  status: string;
  manifestPath: string;
  startedAt: string;
  finishedAt: string;
}): Promise<void> {
  const indexPath = path.join(params.projectRoot, ".vos", "index", "evidence.json");
  await mkdir(path.dirname(indexPath), { recursive: true });
  const current = existsSync(indexPath)
    ? JSON.parse(await readFile(indexPath, "utf8")) as { version?: number; runs?: unknown[] }
    : { version: 1, runs: [] };
  const runs = Array.isArray(current.runs) ? current.runs.filter((run) =>
    !(run && typeof run === "object" && (run as { run_id?: unknown }).run_id === params.runId)
  ) : [];
  runs.push({
    run_id: params.runId,
    command: params.command,
    status: params.status,
    manifest: path.relative(params.projectRoot, params.manifestPath),
    started_at: params.startedAt,
    finished_at: params.finishedAt,
  });
  await writeFile(indexPath, `${JSON.stringify({ version: 1, runs }, null, 2)}\n`);
}

export function currentHead(projectRoot: string): string | undefined {
  const result = gitMaybe(projectRoot, ["rev-parse", "HEAD"]);
  return result.ok ? result.stdout.trim() || undefined : undefined;
}

export function parentSha(projectRoot: string): string | undefined {
  const result = gitMaybe(projectRoot, ["rev-parse", "HEAD^"]);
  return result.ok ? result.stdout.trim() || undefined : undefined;
}

export function git(projectRoot: string, args: string[]): string {
  const result = gitMaybe(projectRoot, args);
  if (!result.ok) {
    throw new CliError(`git ${args.join(" ")} failed: ${result.stderr.trim()}`, "failed");
  }
  return result.stdout;
}

async function findLedgerEntry(projectRoot: string, commitSha: string): Promise<CommitLedgerEntry | undefined> {
  const ledgerPath = path.join(projectRoot, LEDGER_PATH);
  if (!existsSync(ledgerPath)) return undefined;
  const lines = (await readFile(ledgerPath, "utf8")).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as CommitLedgerEntry;
      if (entry.commit_sha === commitSha) return entry;
    } catch {
      continue;
    }
  }
  return undefined;
}

function isIgnoredRuntimeArtifact(file: string): boolean {
  return file.startsWith(".vos/runs/") ||
    file.startsWith(".vos/index/") ||
    file === ".vos/commit-ledger.jsonl" ||
    file === ".gitignore";
}

function gitMaybe(projectRoot: string, args: string[]): { ok: true; stdout: string; stderr: string } | { ok: false; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
  return proc.exitCode === 0 ? { ok: true, ...out } : { ok: false, ...out };
}
