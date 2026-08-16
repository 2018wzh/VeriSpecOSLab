import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { buildNormalizedSpecBundle, parseQemuPortSpec, type NormalizedQemuPortSpec } from "vos-spec";
import type { ExecContext, CommandOutcome } from "../bootstrap.ts";
import type { EvidenceWriter } from "../evidence/index.ts";
import type { AgentQemuExecuteCommand, AgentQemuPreflightCommand } from "../types.ts";
import { CliError } from "../errors.ts";
import { runAgentWithValidatedSubmission } from "../agent/runner.ts";

interface MaterialInventoryEntry {
  id: string;
  role: string;
  path: string;
  sha256: string;
  size: number;
  caveats: string[];
}

interface RecoveryRecord {
  version: "vos.agent-recovery.v1";
  command: "qemu-preflight" | "qemu-execute";
  target: string;
  base_head: string;
  spec_hash: string;
  thread_id?: string;
  worktree?: string;
  status: "interrupted" | "validation_failed" | "blocked";
  created_at: string;
}

export async function executeAgentQemuPreflight(
  command: AgentQemuPreflightCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const spec = await resolveQemuSpec(projectRoot, command.target);
  if (spec.status !== "request") {
    throw new CliError("qemu preflight requires a request QemuSpec", "validation_failed", { target: spec.path });
  }
  const baseHead = requireCleanHead(projectRoot, "qemu preflight");
  const rawSpec = await readFile(path.join(projectRoot, spec.path), "utf8");
  requirePathAtHead(projectRoot, spec.path, rawSpec, "qemu preflight request");
  const specHash = sha256(rawSpec);
  const recovery = command.resumeRunId
    ? await loadRecovery(projectRoot, command.resumeRunId, "qemu-preflight", spec.path, baseHead, specHash)
    : undefined;
  const materialsDir = `references/qemu/${spec.id}`;
  const absoluteMaterials = path.join(projectRoot, materialsDir);
  const inventory = await inventoryMaterials(projectRoot, absoluteMaterials);
  if (inventory.length === 0) {
    return {
      status: "validation_failed",
      details: {
        target: spec.path,
        missing: [{ role: "student-supplied-hardware-materials", path: materialsDir }],
        reasons: [`materials directory is missing or contains no regular files: ${materialsDir}`],
        candidate_created: false,
      },
    };
  }
  const qemu = await inspectQemuSource(projectRoot, spec.qemu.source_path, spec.qemu.version);
  const prompt = [
    "Perform the evidence-gated preflight for a physical-board QEMU machine port.",
    "Hardware facts may come only from the supplied material inventory and files. Do not use WebSearch/WebFetch for hardware facts.",
    "Determine the material set required by the declared target. If anything needed to establish the boot path, register semantics, board wiring, or shell acceptance is missing or unreadable, submit status insufficient with exact missing items and reasons.",
    "If sufficient, inspect the real boot artifacts and pinned QEMU tree, run only bounded read-only/temporary diagnostics, and return the boot path, reuse matrix, findings, implementation phases, dependencies, and repository-relative owns paths.",
    "The accepted target permits a documented minimal firmware chain and preload shortcuts, but every bypass must be explicit.",
    `Request QemuSpec: ${rawSpec}`,
    `Materials directory: ${materialsDir}`,
    `Inventory: ${JSON.stringify(inventory, null, 2)}`,
    `QEMU inspection: ${JSON.stringify(qemu, null, 2)}`,
  ].join("\n\n");
  const events: Array<Record<string, unknown>> = [];
  let result;
  try {
    result = await runAgentWithValidatedSubmission({
      projectRoot,
      taskPrompt: prompt,
      taskKind: "qemu_port_preflight",
      requestedScope: `qemu-preflight:${spec.id}`,
      context: { spec, inventory, qemu },
      contextRefs: [spec.path, materialsDir, spec.qemu.source_path],
      allowedPaths: [],
      requiredValidations: ["material sufficiency", "boot-chain analysis", "QEMU reuse classification"],
      policyFlags: ["student-hardware-materials-only", "no-project-file-writes", "bounded-diagnostics"],
      threadId: recovery?.thread_id,
      maxIterations: 1000,
      courseMode: false,
      resultSubmissionSchema: "qemu_preflight_result.v1",
      taskRunner: context.agentRunner,
      onEvent: (event) => { events.push(event); },
      validateSubmission: (submission) => parsePreflightPayload(submission),
    });
  } catch (error) {
    await saveRecovery(projectRoot, evidence.run_id, {
      command: "qemu-preflight", target: spec.path, base_head: baseHead, spec_hash: specHash,
      status: "interrupted", created_at: new Date().toISOString(),
    });
    throw error;
  }
  const payload = result.validatedResult;
  if (payload.status === "insufficient") {
    await saveRecovery(projectRoot, evidence.run_id, {
      command: "qemu-preflight", target: spec.path, base_head: baseHead, spec_hash: specHash,
      thread_id: result.threadId, status: "validation_failed", created_at: new Date().toISOString(),
    });
    return {
      status: "validation_failed",
      details: {
        target: spec.path,
        missing: payload.missing,
        reasons: payload.reasons,
        candidate_created: false,
        resume: `vos agent qemu preflight ${command.target} --resume ${evidence.run_id}`,
      },
    };
  }
  const revision = await nextRevision(projectRoot, spec.id);
  const candidateId = `${spec.id}.r${revision}`;
  const candidatePath = path.join("spec", "qemu", `${safeName(spec.id)}.r${revision}.yaml`);
  const candidate = {
    version: "vos.qemu-port.v1",
    id: candidateId,
    request_id: spec.id,
    revision,
    status: "candidate",
    target: spec.target,
    qemu: { ...spec.qemu, commit: qemu.commit },
    materials_dir: materialsDir,
    materials: inventory,
    preflight: {
      run_id: evidence.run_id,
      boot_path: payload.boot_path,
      reuse_matrix: payload.reuse_matrix,
      findings: payload.findings,
      notes: payload.notes,
    },
    implementation: {
      owns: payload.owns,
      phases: payload.phases,
      dependencies: payload.dependencies,
    },
    acceptance: { goal: "shell", agent_defined: true },
  };
  parseQemuPortSpec(candidate);
  await writeAtomic(path.join(projectRoot, candidatePath), stringifyYaml(candidate, { lineWidth: 100 }));
  evidence.addArtifact("qemu-port-spec", candidatePath, "candidate QemuSpec generated after successful material preflight");
  return {
    status: "passed",
    details: {
      request: spec.path,
      candidate: candidatePath,
      candidate_id: candidateId,
      revision,
      materials: inventory.length,
      message: "review the candidate, set status to approved, and commit it before execute",
    },
  };
}

export async function executeAgentQemuExecute(
  command: AgentQemuExecuteCommand,
  context: ExecContext,
  evidence: EvidenceWriter,
): Promise<CommandOutcome> {
  const projectRoot = context.projectRoot;
  const spec = await resolveQemuSpec(projectRoot, command.target);
  if (spec.status !== "approved") {
    throw new CliError("qemu execute requires an approved QemuSpec", "policy_blocked", { target: spec.path, status: spec.status });
  }
  if (spec.findings.some((finding) => finding.severity === "blocker" && !finding.resolution)) {
    throw new CliError("approved QemuSpec contains an unresolved blocker", "validation_failed", { target: spec.path });
  }
  assertQemuOwnsPolicy(spec.owns, spec.materials_dir);
  const baseHead = requireCleanHead(projectRoot, "qemu execute");
  const rawSpec = await readFile(path.join(projectRoot, spec.path), "utf8");
  requirePathAtHead(projectRoot, spec.path, rawSpec, "qemu execute approved Spec");
  const specHash = sha256(rawSpec);
  await verifyApprovedInputs(projectRoot, spec);
  const recovery = command.resumeRunId
    ? await loadRecovery(projectRoot, command.resumeRunId, "qemu-execute", spec.path, baseHead, specHash)
    : undefined;
  const worktree = recovery?.worktree ?? path.join(projectRoot, ".vos", "worktrees", evidence.run_id, "project");
  if (!recovery) {
    await mkdir(path.dirname(worktree), { recursive: true });
    runGit(projectRoot, ["worktree", "add", "--detach", worktree, baseHead]);
    await prepareComponentWorktree(projectRoot, worktree, spec.qemu.source_path, spec.qemu.commit!);
  }
  const prompt = [
    `Implement approved QemuSpec ${spec.id} in this detached multi-repository worktree.`,
    `Write only these approved repository-relative paths: ${spec.owns.join(", ")}.`,
    "Work phase by phase. Reuse existing QEMU models before adding variants or new models. Do not fake ready/success semantics for unsupported devices.",
    "You may obtain missing TF-A, U-Boot, or other software only from their official project repositories, pin an immutable release-reachable commit, and record provenance. Never obtain hardware facts online.",
    "Autonomously build, boot, inspect, and repair in the loop until the approved minimal firmware path reaches a shell. The final acceptance definition belongs to this Agent loop.",
    "On success submit passed with changed_paths, validations, phase_commits, summary, diagnostics, and dependency_pins. If a real external condition prevents progress, submit blocked with an exact blocker and resume_steps. Do not modify vos.yaml and do not push.",
    `Approved QemuSpec:\n${rawSpec}`,
  ].join("\n\n");
  let result;
  try {
    result = await runAgentWithValidatedSubmission({
      projectRoot: worktree,
      configurationRoot: projectRoot,
      taskPrompt: prompt,
      taskKind: "qemu_port_execution",
      requestedScope: `qemu-execute:${spec.id}`,
      context: { spec },
      contextRefs: [spec.path, spec.materials_dir, spec.qemu.source_path],
      allowedPaths: spec.owns,
      requiredValidations: ["QEMU build", "neighbor regression", "Agent-defined boot-to-shell loop"],
      policyFlags: ["approved-qemu-spec-only", "official-software-dependencies-only", "no-push"],
      threadId: recovery?.thread_id,
      maxIterations: 1000,
      courseMode: false,
      resultSubmissionSchema: "qemu_execution_result.v1",
      taskRunner: context.agentRunner,
      validateSubmission: (submission) => parseExecutionPayload(submission),
    });
  } catch (error) {
    await saveRecovery(projectRoot, evidence.run_id, {
      command: "qemu-execute", target: spec.path, base_head: baseHead, spec_hash: specHash,
      worktree, status: "interrupted", created_at: new Date().toISOString(),
    });
    throw error;
  }
  const payload = result.validatedResult;
  if (payload.status !== "passed") {
    await saveRecovery(projectRoot, evidence.run_id, {
      command: "qemu-execute", target: spec.path, base_head: baseHead, spec_hash: specHash,
      thread_id: result.threadId, worktree, status: "blocked", created_at: new Date().toISOString(),
    });
    return {
      status: "policy_blocked",
      details: {
        target: spec.path,
        blocker: payload.blocker,
        resume_steps: payload.resume_steps,
        worktree,
        resume: `vos agent qemu execute ${command.target} --resume ${evidence.run_id}`,
      },
    };
  }
  assertChangedPathsAllowed(worktree, baseHead, spec.owns);
  commitNestedRepository(worktree, spec.qemu.source_path, spec.qemu.commit!, spec.id, spec.owns);
  runGit(worktree, ["add", "-A"]);
  const staged = runGit(worktree, ["diff", "--cached", "--quiet"], true);
  if (staged.exitCode === 0) {
    throw new CliError("qemu execution reported passed without any committable changes", "validation_failed");
  }
  runGit(worktree, ["commit", "-m", `[vos][qemu] Implement ${spec.id}`]);
  const implementationCommit = runGit(worktree, ["rev-parse", "HEAD"]).stdout.trim();
  const component = path.join(worktree, spec.qemu.source_path);
  const componentCommit = isGitRepository(component)
    ? runGit(component, ["rev-parse", "HEAD"]).stdout.trim()
    : undefined;
  requireCleanHead(projectRoot, "qemu execute landing");
  runGit(projectRoot, ["merge", "--ff-only", implementationCommit]);
  const originalComponent = path.join(projectRoot, spec.qemu.source_path);
  if (componentCommit && isGitRepository(originalComponent)) runGit(originalComponent, ["checkout", "--detach", componentCommit]);
  if (isGitRepository(originalComponent)) runGit(originalComponent, ["worktree", "remove", "--force", path.join(worktree, spec.qemu.source_path)], true);
  const cleanup = runGit(projectRoot, ["worktree", "remove", "--force", worktree], true);
  return {
    status: "passed",
    details: {
      target: spec.path,
      commit: implementationCommit,
      summary: payload.summary,
      validations: payload.validations,
      phase_commits: payload.phase_commits,
      completion_authority: "agent_structured_submission",
      worktree_removed: cleanup.exitCode === 0,
    },
  };
}

async function prepareComponentWorktree(projectRoot: string, worktree: string, sourcePath: string, commit: string): Promise<void> {
  const original = path.join(projectRoot, sourcePath);
  if (!isGitRepository(original)) return;
  const target = path.join(worktree, sourcePath);
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  runGit(original, ["worktree", "add", "--detach", target, commit]);
}

function isGitRepository(candidate: string): boolean {
  if (!existsSync(candidate)) return false;
  const result = runGit(candidate, ["rev-parse", "--show-toplevel"], true);
  return result.exitCode === 0 && path.resolve(result.stdout.trim()) === path.resolve(candidate);
}

async function resolveQemuSpec(projectRoot: string, target: string): Promise<NormalizedQemuPortSpec> {
  const bundle = await buildNormalizedSpecBundle({ projectRoot });
  const normalizedTarget = target.replace(/\\/g, "/");
  const exact = bundle.qemu_ports.filter((spec) => spec.id === target || spec.path === normalizedTarget);
  const matches = exact.length > 0 ? exact : bundle.qemu_ports.filter((spec) => spec.request_id === target);
  if (matches.length === 0) throw new CliError(`QemuSpec not found: ${target}`, "validation_failed");
  if (matches.length > 1) throw new CliError(`QemuSpec target is ambiguous; use an exact revision ID or path: ${target}`, "validation_failed", { matches: matches.map((item) => item.path) });
  return matches[0];
}

async function inventoryMaterials(projectRoot: string, root: string): Promise<MaterialInventoryEntry[]> {
  if (!existsSync(root)) return [];
  const files = await walkFiles(root);
  const entries: MaterialInventoryEntry[] = [];
  for (const file of files) {
    const info = await stat(file);
    const relative = path.relative(projectRoot, file).replace(/\\/g, "/");
    const handle = await open(file, "r");
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    await handle.close();
    entries.push({
      id: `material-${entries.length + 1}`,
      role: inferMaterialRole(file, header.subarray(0, bytesRead)),
      path: relative,
      sha256: await hashFile(file),
      size: info.size,
      caveats: [],
    });
  }
  return entries;
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...await walkFiles(absolute));
    else if (entry.isFile()) out.push(absolute);
  }
  return out.sort();
}

function inferMaterialRole(file: string, header: Uint8Array): string {
  const name = path.basename(file).toLowerCase();
  const ascii = Buffer.from(header).toString("ascii");
  if (ascii.startsWith("%PDF-")) {
    if (/schematic|原理图/.test(name)) return "board-schematic";
    return "hardware-manual";
  }
  if (header.length >= 4 && Buffer.from(header.subarray(0, 4)).toString("hex") === "d00dfeed") return "device-tree";
  if (header[0] === 0xfd && header[1] === 0x37 && header[2] === 0x7a && header[3] === 0x58) return "compressed-boot-media-or-document";
  if (/schematic|原理图/.test(name)) return "board-schematic";
  if (/datasheet|user.manual|用户手册|manual/.test(name)) return "hardware-manual";
  if (/\.dtb$|\.dts$/.test(name)) return "device-tree";
  if (/\.img(\.xz|\.gz)?$|\.iso$/.test(name)) return "boot-media";
  if (/\.bin$|u-boot|bl31|firmware/.test(name)) return "firmware";
  return "supporting-material";
}

async function inspectQemuSource(projectRoot: string, sourcePath: string, expectedVersion: string): Promise<{ path: string; commit: string; version: string }> {
  const absolute = path.resolve(projectRoot, sourcePath);
  assertInside(projectRoot, absolute, "QEMU source path");
  if (!existsSync(absolute)) throw new CliError(`QEMU source tree is missing: ${sourcePath}`, "validation_failed");
  if (!isGitRepository(absolute)) {
    throw new CliError(`QEMU source path must be the root of a Git worktree: ${sourcePath}`, "validation_failed");
  }
  const commit = runGit(absolute, ["rev-parse", "HEAD"]).stdout.trim();
  const versionFile = path.join(absolute, "VERSION");
  if (!existsSync(versionFile)) throw new CliError(`QEMU VERSION file is missing: ${sourcePath}/VERSION`, "validation_failed");
  const actualVersion = await readFile(versionFile, "utf8");
  if (actualVersion.trim() !== expectedVersion.trim()) {
    throw new CliError(`QEMU version mismatch: expected ${expectedVersion}, got ${actualVersion.trim()}`, "validation_failed", { source_path: sourcePath, commit });
  }
  return { path: sourcePath, commit, version: actualVersion.trim() };
}

async function verifyApprovedInputs(projectRoot: string, spec: NormalizedQemuPortSpec): Promise<void> {
  const qemu = await inspectQemuSource(projectRoot, spec.qemu.source_path, spec.qemu.version);
  if (qemu.commit !== spec.qemu.commit) throw new CliError("approved QemuSpec QEMU commit has drifted", "policy_blocked", { expected: spec.qemu.commit, actual: qemu.commit });
  for (const material of spec.materials) {
    const absolute = path.resolve(projectRoot, material.path);
    assertInside(projectRoot, absolute, "material path");
    if (!existsSync(absolute)) throw new CliError(`approved material is missing: ${material.path}`, "validation_failed");
    const digest = await hashFile(absolute);
    if (digest !== material.sha256) throw new CliError(`approved material hash mismatch: ${material.path}`, "validation_failed", { expected: material.sha256, actual: digest });
  }
}

function parsePreflightPayload(value: unknown): {
  status: "sufficient" | "insufficient"; missing: unknown[]; reasons: string[];
  boot_path: Record<string, unknown>; reuse_matrix: Record<string, unknown>[];
  findings: Record<string, unknown>[]; phases: Record<string, unknown>[];
  dependencies: Record<string, unknown>[]; owns: string[]; notes: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("invalid qemu preflight result", "agent_output_error");
  const item = value as Record<string, unknown>;
  if (item.status !== "sufficient" && item.status !== "insufficient") throw new CliError("qemu preflight result requires sufficient or insufficient status", "agent_output_error");
  const strings = (input: unknown) => Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string") : [];
  const records = (input: unknown) => Array.isArray(input) ? input.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) : [];
  const parsed = {
    status: item.status as "sufficient" | "insufficient", missing: Array.isArray(item.missing) ? item.missing : [], reasons: strings(item.reasons),
    boot_path: item.boot_path && typeof item.boot_path === "object" && !Array.isArray(item.boot_path) ? item.boot_path as Record<string, unknown> : {},
    reuse_matrix: records(item.reuse_matrix), findings: records(item.findings), phases: records(item.phases),
    dependencies: records(item.dependencies), owns: strings(item.owns), notes: strings(item.notes),
  };
  if (parsed.status === "sufficient" && (parsed.owns.length === 0 || parsed.phases.length === 0 || Object.keys(parsed.boot_path).length === 0)) {
    throw new Error("sufficient preflight requires a boot path, at least one implementation phase, and approved owns paths");
  }
  for (const owned of parsed.owns) {
    const normalized = owned.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
      throw new Error(`preflight owns path must be repository-relative and cannot traverse: ${owned}`);
    }
  }
  assertQemuOwnsPolicy(parsed.owns);
  for (const finding of parsed.findings) {
    if (typeof finding.id !== "string" || typeof finding.message !== "string"
      || !["info", "warning", "blocker"].includes(String(finding.severity))
      || !Array.isArray(finding.evidence) || !finding.evidence.every((entry) => typeof entry === "string")) {
      throw new Error("each preflight finding requires id, severity, message, and string evidence references");
    }
  }
  return parsed;
}

function parseExecutionPayload(value: unknown): { status: "passed" | "blocked"; blocker?: string; resume_steps: string[]; summary?: string; validations: string[]; phase_commits: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("invalid qemu execution result", "agent_output_error");
  const item = value as Record<string, unknown>;
  if (item.status !== "passed" && item.status !== "blocked") throw new CliError("qemu execution result requires passed or blocked status", "agent_output_error");
  const strings = (input: unknown) => Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string") : [];
  const parsed = { status: item.status as "passed" | "blocked", blocker: typeof item.blocker === "string" ? item.blocker : undefined, resume_steps: strings(item.resume_steps), summary: typeof item.summary === "string" ? item.summary : undefined, validations: strings(item.validations), phase_commits: strings(item.phase_commits) };
  if (parsed.status === "passed" && (!parsed.summary || parsed.validations.length === 0)) throw new Error("passed qemu execution requires a summary and at least one Agent validation");
  if (parsed.status === "blocked" && !parsed.blocker) throw new Error("blocked qemu execution requires an exact blocker");
  return parsed;
}

async function nextRevision(projectRoot: string, requestId: string): Promise<number> {
  const bundle = await buildNormalizedSpecBundle({ projectRoot });
  return Math.max(0, ...bundle.qemu_ports.filter((item) => item.request_id === requestId).map((item) => item.revision)) + 1;
}

async function writeAtomic(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { flag: "wx" });
  await rename(temporary, target);
}

function requireCleanHead(projectRoot: string, command: string): string {
  const head = runGit(projectRoot, ["rev-parse", "HEAD"]).stdout.trim();
  const status = runGit(projectRoot, ["status", "--porcelain", "--untracked-files=all"]).stdout.trim();
  if (status) throw new CliError(`${command} requires a clean committed HEAD`, "policy_blocked", { reason: "dirty_worktree", changed: status.split(/\r?\n/) });
  return head;
}

function requirePathAtHead(projectRoot: string, relativePath: string, content: string, label: string): void {
  const normalized = relativePath.replace(/\\/g, "/");
  const result = runGit(projectRoot, ["show", `HEAD:${normalized}`], true);
  if (result.exitCode !== 0 || result.stdout !== content) {
    throw new CliError(`${label} must be committed exactly at the current HEAD`, "policy_blocked", { path: normalized });
  }
}

function assertChangedPathsAllowed(worktree: string, baseHead: string, owns: string[]): void {
  const output = runGit(worktree, ["status", "--porcelain", "--untracked-files=all"]).stdout;
  const committed = runGit(worktree, ["diff", "--name-only", baseHead, "HEAD"]).stdout.split(/\r?\n/).filter(Boolean);
  const changed = [...new Set([...committed, ...output.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3))])].map((item) => item.replace(/\\/g, "/"));
  const violations = changed.filter((candidate) => !owns.some((owned) => {
    const normalized = owned.replace(/\/$/, "");
    return candidate === normalized || candidate.startsWith(`${normalized}/`) || normalized.startsWith(`${candidate}/`);
  }));
  if (violations.length > 0) throw new CliError("qemu execution changed paths outside approved owns", "policy_blocked", { violations });
}

function assertQemuOwnsPolicy(owns: string[], materialsDir = "references/qemu"): void {
  const protectedPaths = [".git", ".vos", "spec", "vos.yaml", materialsDir]
    .map((item) => item.replace(/\\/g, "/").replace(/\/$/, ""));
  const violations = owns.filter((owned) => {
    const normalized = owned.replace(/\\/g, "/").replace(/\/$/, "");
    return protectedPaths.some((protectedPath) => normalized === protectedPath
      || normalized.startsWith(`${protectedPath}/`)
      || protectedPath.startsWith(`${normalized}/`));
  });
  if (violations.length > 0) {
    throw new CliError("QEMU implementation owns protected project or evidence paths", "policy_blocked", { violations });
  }
}

function commitNestedRepository(worktree: string, sourcePath: string, baseCommit: string, specId: string, owns: string[]): void {
  const source = path.join(worktree, sourcePath);
  if (!existsSync(path.join(source, ".git"))) return;
  const status = runGit(source, ["status", "--porcelain", "--untracked-files=all"]).stdout.trim();
  const committed = runGit(source, ["diff", "--name-only", baseCommit, "HEAD"]).stdout.split(/\r?\n/).filter(Boolean);
  const changed = [...new Set([...committed, ...status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3))])].map((item) => `${sourcePath}/${item.replace(/\\/g, "/")}`);
  const violations = changed.filter((candidate) => !owns.some((owned) => candidate === owned || candidate.startsWith(`${owned.replace(/\/$/, "")}/`)));
  if (violations.length > 0) throw new CliError("QEMU component changed paths outside approved owns", "policy_blocked", { violations });
  if (!status) return;
  runGit(source, ["add", "-A"]);
  runGit(source, ["commit", "-m", `[vos][qemu] Implement machine for ${specId}`]);
}

async function hashFile(file: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return digest.digest("hex");
}

function runGit(cwd: string, args: string[], allowFailure = false): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
  const result = { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode };
  if (proc.exitCode !== 0 && !allowFailure) throw new CliError(`git ${args.join(" ")} failed: ${result.stderr.trim()}`, "failed");
  return result;
}

async function saveRecovery(projectRoot: string, runId: string, record: Omit<RecoveryRecord, "version">): Promise<void> {
  const target = recoveryPath(projectRoot, runId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify({ version: "vos.agent-recovery.v1", ...record }, null, 2)}\n`);
}

async function loadRecovery(projectRoot: string, runId: string, command: RecoveryRecord["command"], target: string, head: string, specHash: string): Promise<RecoveryRecord> {
  const file = recoveryPath(projectRoot, runId);
  if (!existsSync(file)) throw new CliError(`resume state was not found: ${runId}`, "validation_failed");
  const record = JSON.parse(await readFile(file, "utf8")) as RecoveryRecord;
  if (record.version !== "vos.agent-recovery.v1" || record.command !== command || record.target !== target || record.base_head !== head || record.spec_hash !== specHash) {
    throw new CliError("resume state does not match the command, target, HEAD, or Spec hash", "policy_blocked");
  }
  return record;
}

function recoveryPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, ".vos", "agent-runs", runId, "recovery.json");
}

function assertInside(root: string, candidate: string, label: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new CliError(`${label} escapes the project root`, "policy_blocked");
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "") || "qemu-port";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
