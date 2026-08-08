import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { buildNormalizedSpecBundle } from "vos-spec";
import { CliError } from "../errors.ts";
import { currentHead, git, parentSha } from "../repro/ledger.ts";
import { verifyAuditChain } from "../audit/chain.ts";

export async function createStudentSubmitPack(params: { projectRoot: string; reportPath: string }): Promise<{ archivePath: string; manifestPath: string; manifest: Record<string, unknown> }> {
  const projectRoot = params.projectRoot;
  const commitSha = currentHead(projectRoot);
  if (!commitSha) throw new CliError("submit requires a committed Git HEAD", "policy_blocked", { reason: "head_missing" });
  const dirty = git(projectRoot, ["status", "--porcelain", "--untracked-files=all"])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !isRuntimeArtifact(line.slice(3).trim()));
  if (dirty.length > 0) throw new CliError("submit requires a clean HEAD", "policy_blocked", { reason: "dirty_worktree", changed_targets: dirty });
  const bundle = await buildNormalizedSpecBundle({ projectRoot });
  const shortSha = commitSha.slice(0, 12);
  const submitRoot = path.join(projectRoot, ".vos", "submit");
  const staging = path.join(submitRoot, `student-staging-${shortSha}`);
  const repoRoot = path.join(staging, "repo");
  await rm(staging, { recursive: true, force: true });
  await mkdir(repoRoot, { recursive: true });
  const headTar = path.join(staging, "head.tar");
  git(projectRoot, ["archive", "--format=tar", "-o", headTar, "HEAD"]);
  await tar.x({ file: headTar, cwd: repoRoot });
  await rm(headTar, { force: true });

  const auditRoot = path.join(projectRoot, ".vos", "audit");
  const auditChain = verifyAuditChain(projectRoot);
  if (!auditChain.ok) {
    throw new CliError("submit requires an intact audit hash chain", "validation_failed", {
      reason: auditChain.reason,
      sequence: auditChain.sequence,
    });
  }
  const exportRoot = path.join(staging, "audit");
  await mkdir(exportRoot, { recursive: true });
  if (existsSync(auditRoot)) await copyRedactedTree(auditRoot, exportRoot);
  const reportSource = path.join(projectRoot, params.reportPath);
  await mkdir(path.join(staging, "report"), { recursive: true });
  if (existsSync(reportSource)) {
    await mkdir(path.join(staging, "report"), { recursive: true });
    await writeFile(
      path.join(staging, "report", "report.json"),
      redactSecrets(await readFile(reportSource, "utf8")),
    );
  }
  const specHash = createHash("sha256").update(JSON.stringify(bundle.hashes)).digest("hex");
  const configHash = await hashFile(path.join(projectRoot, "vos.yaml"));
  const manifest: Record<string, unknown> = {
    version: "vos.submit.v2",
    kind: "student-submission",
    generated_at: new Date().toISOString(),
    commit_sha: commitSha,
    parent_sha: parentSha(projectRoot),
    spec_hash: specHash,
    config_hash: configHash,
    report_path: "report/report.json",
    audit_path: "audit",
    reproducible: true,
    hardware_status: "pending_human_review",
    audit_chain: auditChain,
  };
  const manifestPath = path.join(staging, "submit-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const archivePath = path.join(submitRoot, `student-submit-${shortSha}.tar.gz`);
  await mkdir(submitRoot, { recursive: true });
  await tar.c({ gzip: true, cwd: staging, file: archivePath }, ["repo", "audit", "report", "submit-manifest.json"]);
  await rm(staging, { recursive: true, force: true });
  const packedManifest = { ...manifest, pack_path: path.relative(projectRoot, archivePath).replace(/\\/g, "/"), pack_sha256: await hashFile(archivePath), pack_size: (await stat(archivePath)).size };
  const packedPath = path.join(submitRoot, `student-submit-${shortSha}.json`);
  await writeFile(packedPath, `${JSON.stringify(packedManifest, null, 2)}\n`);
  return { archivePath, manifestPath: packedPath, manifest: packedManifest };
}

async function copyRedactedTree(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyRedactedTree(sourcePath, targetPath);
    } else if (entry.isFile() && entry.name === "chain.jsonl") {
      await writeFile(targetPath, redactAuditChain(await readFile(sourcePath, "utf8")));
    } else if (entry.isFile()) {
      const text = await readFile(sourcePath, "utf8");
      await writeFile(targetPath, redactSecrets(text));
    }
  }
}

function redactAuditChain(text: string): string {
  let previous: string | null = null;
  const lines = text.split(/\r?\n/).filter(Boolean);
  return `${lines.map((line) => {
    const original = JSON.parse(line) as Record<string, unknown>;
    const redacted = JSON.parse(redactSecrets(JSON.stringify(original))) as Record<string, unknown>;
    const sourceHash = typeof redacted.hash === "string" ? redacted.hash : undefined;
    redacted.previous_hash = previous;
    const unsigned = {
      sequence: redacted.sequence,
      previous_hash: redacted.previous_hash,
      recorded_at: redacted.recorded_at,
      event: redacted.event,
    };
    const hash = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
    redacted.hash = hash;
    if (sourceHash) redacted.source_hash = sourceHash;
    previous = hash;
    return JSON.stringify(redacted);
  }).join("\n")}\n`;
}

function redactSecrets(text: string): string {
  return text
    .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)([^\s,;"'}]+)/gi, "$1<redacted>")
    .replace(/\b(?:sk|key|tok)_[A-Za-z0-9_-]{12,}\b/g, "<redacted>")
    .replace(/[A-Za-z]:\\[^\r\n"']+|\/(?:Users|home|mnt|private|tmp)\/[^\r\n"']+/g, "<project-path>");
}

async function hashFile(file: string): Promise<string> {
  if (!existsSync(file)) throw new CliError(`required submission file missing: ${path.basename(file)}`, "validation_failed");
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function isRuntimeArtifact(file: string): boolean {
  return file.replace(/\\/g, "/").startsWith(".vos/");
}
