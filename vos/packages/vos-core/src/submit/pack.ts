import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { CliError } from "../errors.ts";
import type { EvidenceWriter } from "../evidence/index.ts";
import { currentHead, git, parentSha } from "../repro/ledger.ts";
import { loadToolchainManifest } from "../runtime/manifest.ts";

export async function createSubmitPack(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
}): Promise<{
  archivePath: string;
  manifestPath: string;
  manifest: Record<string, unknown>;
}> {
  const projectRoot = params.projectRoot;
  const commitSha = currentHead(projectRoot);
  if (!commitSha) throw new CliError("submit pack requires a git HEAD", "policy_blocked");
  const { manifest: toolchain } = await loadToolchainManifest({ projectRoot });
  if (!toolchain.environment?.required_tools?.length) {
    throw new CliError("submit pack requires .vos/toolchain.json environment.required_tools", "validation_failed");
  }

  const required = await validateSubmissionInputs(projectRoot);
  const shortSha = commitSha.slice(0, 12);
  const submitRoot = path.join(projectRoot, ".vos", "submit");
  const staging = path.join(submitRoot, `staging-${shortSha}`);
  const repoRoot = path.join(staging, "repo");
  await rm(staging, { recursive: true, force: true });
  await mkdir(repoRoot, { recursive: true });

  const headTar = path.join(staging, "head.tar");
  git(projectRoot, ["archive", "--format=tar", "-o", headTar, "HEAD"]);
  await tar.x({ file: headTar, cwd: repoRoot });
  await rm(headTar, { force: true });
  await removeBuildProducts(repoRoot);

  await copyMetadata(projectRoot, path.join(staging, "metadata", "vos"));
  const evidenceSummary = await buildEvidenceSummary(projectRoot, params.evidence.run_id);
  const manifest = {
    version: 1,
    kind: "vos.submit_pack",
    generated_at: new Date().toISOString(),
    commit_sha: commitSha,
    parent_sha: parentSha(projectRoot),
    image_included: false,
    rebuild_required: true,
    rebuild_entrypoint: "vos build && vos verify public",
    toolchain_environment: toolchain.environment,
    required_inputs: required,
    optional_inputs: await optionalInputs(projectRoot),
    evidence_summary: evidenceSummary,
  };
  const manifestPath = path.join(staging, "submit-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const archivePath = path.join(submitRoot, `submit-pack-${shortSha}.tar.gz`);
  await mkdir(path.dirname(archivePath), { recursive: true });
  await tar.c({ gzip: true, cwd: staging, file: archivePath }, ["repo", "metadata", "submit-manifest.json"]);
  await rm(staging, { recursive: true, force: true });
  const packHash = await hashFile(archivePath);
  const packManifestPath = path.join(submitRoot, `submit-pack-${shortSha}.json`);
  const packedManifest = {
    ...manifest,
    pack_path: path.relative(projectRoot, archivePath),
    pack_sha256: packHash,
    pack_size: (await stat(archivePath)).size,
  };
  await writeFile(packManifestPath, `${JSON.stringify(packedManifest, null, 2)}\n`);
  return { archivePath, manifestPath: packManifestPath, manifest: packedManifest };
}

async function validateSubmissionInputs(projectRoot: string): Promise<Record<string, unknown>> {
  const requiredPaths = ["spec", "tests/public", "spec/reports", ".vos/commit-ledger.jsonl", ".vos/toolchain.json", ".vos/index/evidence.json"];
  const missing = requiredPaths.filter((rel) => !existsSync(path.join(projectRoot, rel)));
  if (missing.length > 0) throw new CliError(`submit pack missing required inputs: ${missing.join(", ")}`, "validation_failed");
  const repoFiles = git(projectRoot, ["ls-tree", "-r", "--name-only", "HEAD"]).split(/\r?\n/).filter(Boolean);
  if (!repoFiles.some((file) => isSourceFile(file))) {
    throw new CliError("submit pack requires tracked source code in HEAD", "validation_failed");
  }
  return {
    spec: "present",
    source_code: "present",
    tests_public: "present",
    reports: "present",
    commit_ledger: "present",
    toolchain_manifest: "present",
    evidence_summary: "present",
  };
}

async function optionalInputs(projectRoot: string): Promise<Record<string, string>> {
  return {
    tests_generated: existsSync(path.join(projectRoot, "tests", "generated")) ? "present" : "missing",
    ai_collaboration_log: existsSync(path.join(projectRoot, ".vos", "agent-log.jsonl")) ||
        existsSync(path.join(projectRoot, "spec", "reports", "ai-collaboration-log.md"))
      ? "present"
      : "missing",
    spec_patch_history: existsSync(path.join(projectRoot, "spec", "evolution")) ? "present" : "missing",
  };
}

async function copyMetadata(projectRoot: string, targetRoot: string): Promise<void> {
  await mkdir(targetRoot, { recursive: true });
  for (const rel of [".vos/commit-ledger.jsonl", ".vos/project.yaml", ".vos/policy.yaml", ".vos/toolchain.json", ".vos/toolchain.meta.json"]) {
    const src = path.join(projectRoot, rel);
    if (!existsSync(src)) continue;
    const dest = path.join(targetRoot, rel.replace(/^\.vos\//, ""));
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest);
  }
}

async function buildEvidenceSummary(projectRoot: string, currentRunId: string): Promise<Record<string, unknown>> {
  const indexPath = path.join(projectRoot, ".vos", "index", "evidence.json");
  const index = JSON.parse(await readFile(indexPath, "utf8")) as { runs?: Array<{ run_id?: string; status?: string; manifest?: string }> };
  const runs = (index.runs ?? []).filter((run) => run.run_id && run.run_id !== currentRunId);
  if (runs.length === 0) throw new CliError("submit pack requires prior evidence runs", "validation_failed");
  return {
    index: ".vos/index/evidence.json",
    runs: runs.map((run) => ({
      run_id: run.run_id,
      status: run.status,
      manifest: run.manifest,
    })),
  };
}

async function removeBuildProducts(repoRoot: string): Promise<void> {
  for (const rel of ["build", "fs.img"]) await rm(path.join(repoRoot, rel), { recursive: true, force: true });
  await removeMatching(repoRoot, repoRoot);
}

async function removeMatching(root: string, current: string): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await removeMatching(root, full);
      continue;
    }
    const rel = path.relative(root, full).replace(/\\/g, "/");
    if (/\.(bin|elf|img|o|d|asm|sym)$/.test(rel) || rel.startsWith(".git/") || rel.startsWith(".vos/runs/")) {
      await rm(full, { force: true });
    }
  }
}

function isSourceFile(file: string): boolean {
  if (file.startsWith("spec/") || file.startsWith("tests/") || file.startsWith(".vos/") || file.startsWith("build/")) return false;
  return /\.(c|h|S|s|rs|ts|js|py|sh|mk)$/.test(file) || file === "Makefile";
}

async function hashFile(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
