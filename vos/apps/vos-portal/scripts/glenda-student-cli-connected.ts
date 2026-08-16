import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { HttpPortalClient } from "vos-core";
import { CourseManifestV1Schema } from "vos-core/portal-contracts";
import { parse } from "yaml";

const source = path.resolve(
  process.env.VOS_GLENDA_SPEC_ROOT ??
    path.join(import.meta.dirname, "../../../../../glenda-spec"),
);
if (process.argv.includes("--prepare-history-journal")) {
  const output = path.resolve(required("VOS_GLENDA_HISTORY_JOURNAL_OUT"));
  const journal = await readHistoryReplayJournal(source);
  if (!journal) throw new Error("source .vos/report.json is required to prepare a history journal");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(journal, null, 2)}\n`);
  const value = journal as Record<string, unknown>;
  console.log(JSON.stringify({ output, run_count: value.run_count, status_counts: value.status_counts }));
  process.exit(0);
}
const portalUrl = required("VOS_PORTAL_URL").replace(/\/$/, "");
const projectId = required("VOS_PORTAL_PROJECT_ID");
const sourceRef = process.env.VOS_GLENDA_STUDENT_REF ?? "course/lab10-complete";
const expectedStage = process.env.VOS_GLENDA_STUDENT_STAGE ?? "lab10";
const courseManifest = CourseManifestV1Schema.parse(
  parse(
    await readFile(
      path.join(import.meta.dirname, "../../../../courses/glenda-spec/course.yaml"),
      "utf8",
    ),
  ),
);
const requestedStages = (process.env.VOS_GLENDA_STUDENT_ALL === "1" || process.argv.includes("--all"))
  ? courseManifest.stages
  : [
      courseManifest.stages.find((stage) => stage.key === expectedStage) ??
        ({ key: expectedStage, source_ref: sourceRef } as (typeof courseManifest.stages)[number]),
    ];
const through = process.env.VOS_GLENDA_STUDENT_THROUGH?.trim();
const throughIndex = through
  ? requestedStages.findIndex((stage) => stage.key === through)
  : requestedStages.length - 1;
if (through && throughIndex < 0)
  throw new Error(`VOS_GLENDA_STUDENT_THROUGH does not select a requested stage: ${through}`);
const allowCandidateRefs = process.env.VOS_GLENDA_ALLOW_CANDIDATE_REFS === "1";
const stages = requestedStages.slice(0, throughIndex + 1).map((stage) => {
  if (refExists(source, stage.source_ref)) return stage;
  const candidate = stage.source_ref.replace(/-complete$/, "-candidate");
  if (allowCandidateRefs && candidate !== stage.source_ref && refExists(source, candidate))
    return { ...stage, source_ref: candidate };
  throw new Error(`Glenda source ref is unavailable: ${stage.source_ref}`);
});
if (stages.length === 0) throw new Error("glenda course manifest has no stages");
const giteaOrigin = process.env.VOS_GITEA_PUBLIC_ORIGIN?.replace(/\/$/, "");
if (!giteaOrigin)
  throw new Error("VOS_GITEA_PUBLIC_ORIGIN is required for the student CLI simulation");

const workspace = await mkdtemp(path.join(os.tmpdir(), "vos-glenda-student-cli-"));
const authStore = path.join(workspace, "auth.json");
const client = new HttpPortalClient();

try {
  const suppliedToken = process.env.VOS_PORTAL_TOKEN?.trim();
  const webSession = suppliedToken
    ? { token: suppliedToken, cookies: "", csrf: "" }
    : await webLogin(portalUrl);
  const token = webSession.token;
  const cli = path.resolve(import.meta.dirname, "../../vos-cli/app/main.ts");
  const env = withGitShellPath({
    ...process.env,
    VOS_AUTH_STORE: authStore,
    ...(process.env.VOS_PORTAL_TOKEN ? { VOS_PORTAL_TOKEN: process.env.VOS_PORTAL_TOKEN } : {}),
    GIT_AUTHOR_NAME: "Glenda Student",
    GIT_AUTHOR_EMAIL: "glenda-student@vos.invalid",
    GIT_COMMITTER_NAME: "Glenda Student",
    GIT_COMMITTER_EMAIL: "glenda-student@vos.invalid",
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSL_NO_VERIFY: process.env.GIT_SSL_NO_VERIFY ?? "1",
  });
  const results: Array<Record<string, string | number>> = [];
  const sessionTimeline: ShowcaseEvent[] = [];
  const historyReplayJournal = await readHistoryReplayJournal(source);
  const historyAudit = await readHistoryAudit(source);
  const firstBinding = await client.getProjectBinding(portalUrl, token, projectId);
  const startIndex = stages.findIndex((stage) => stage.key === firstBinding.current_stage.key);
  if (startIndex < 0)
    throw new Error(`project ${projectId} current stage ${firstBinding.current_stage.key} is outside the requested replay range`);
  const activeStages = stages.slice(startIndex);
  const studentCheckout = path.join(workspace, "student-main");
  let worktreeAdded = false;
  try {
    if (startIndex === 0) {
      git(source, ["worktree", "add", "--detach", studentCheckout, activeStages[0].source_ref]);
      worktreeAdded = true;
    } else {
      cloneStudentRepository(studentCheckout, publicRepositoryUrl(firstBinding.repo_url), env);
      recordShowcaseEvent(sessionTimeline, "portal-resume", {
        status: "passed",
        stage: activeStages[0].key,
        commit_sha: git(studentCheckout, ["rev-parse", "HEAD"]).trim(),
      });
      const resumeBaseRef = process.env.VOS_GLENDA_RESUME_BASE_REF?.trim();
      if (resumeBaseRef) {
        await applyStageDelta(source, studentCheckout, resumeBaseRef, activeStages[0].source_ref);
        if (!hasStagedChanges(studentCheckout))
          throw new Error(
            `resume repair ${resumeBaseRef} to ${activeStages[0].source_ref} produced no staged changes`,
          );
        git(studentCheckout, ["commit", "-m", `[course][replay] Repair glenda ${activeStages[0].key} source`]);
        recordShowcaseEvent(sessionTimeline, "source-repair", {
          status: "passed",
          stage: activeStages[0].key,
          from_ref: resumeBaseRef,
          source_ref: activeStages[0].source_ref,
          commit_sha: git(studentCheckout, ["rev-parse", "HEAD"]).trim(),
        });
      } else {
        const latestSubject = git(studentCheckout, ["log", "-1", "--format=%s"]).trim();
        if (latestSubject === `[course][replay] Repair glenda ${activeStages[0].key} source`)
          recordShowcaseEvent(sessionTimeline, "source-repair", {
            status: "passed",
            stage: activeStages[0].key,
            already_applied: true,
            commit_sha: git(studentCheckout, ["rev-parse", "HEAD"]).trim(),
          });
      }
    }
    const privateAgentConfig = path.join(source, ".vos", "config.toml");
    if (await Bun.file(privateAgentConfig).exists()) {
      await mkdir(path.join(studentCheckout, ".vos"), { recursive: true });
      await copyFile(privateAgentConfig, path.join(studentCheckout, ".vos", "config.toml"));
    }
    if (process.env.VOS_PORTAL_TOKEN?.trim())
      await runCli(cli, studentCheckout, env, ["portal", "login", portalUrl]);
    else
      await runCliDeviceLogin(cli, studentCheckout, env, portalUrl, webSession);
    recordShowcaseEvent(sessionTimeline, "portal-login", { status: "passed" });
    await runCli(cli, studentCheckout, env, ["portal", "whoami", portalUrl]);
    recordShowcaseEvent(sessionTimeline, "portal-whoami", { status: "passed" });
    if (startIndex === 0) {
      await runCli(cli, studentCheckout, env, ["portal", "bind", portalUrl, projectId]);
      git(studentCheckout, ["add", ".gitignore", ".vos/project.yaml"]);
      git(studentCheckout, ["commit", "-m", `[course][portal] Bind glenda ${activeStages[0].key} project`]);
      recordShowcaseEvent(sessionTimeline, "portal-bind", {
        status: "passed",
        project_id: projectId,
        commit_sha: git(studentCheckout, ["rev-parse", "HEAD"]).trim(),
      });
    } else if (!(await Bun.file(path.join(studentCheckout, ".vos", "project.yaml")).exists())) {
      throw new Error("resumed student history has no committed Portal binding");
    }
    const remote = publicRepositoryUrl(firstBinding.repo_url);
    configurePortalRemote(studentCheckout, remote);

    for (let index = 0; index < activeStages.length; index++) {
      const stage = activeStages[index];
      const binding = await client.getProjectBinding(portalUrl, token, projectId);
      if (binding.current_stage.key !== stage.key)
        throw new Error(
          `project ${projectId} is at ${binding.current_stage.key}, expected ${stage.key}`,
        );
      if (index > 0) {
        await applyStageDelta(source, studentCheckout, activeStages[index - 1].source_ref, stage.source_ref);
        git(studentCheckout, ["commit", "-m", `[course][replay] Advance glenda ${stage.key}`]);
      }
      const portalTimeline: ShowcaseEvent[] = sessionTimeline.map((event) => ({ ...event }));
      recordShowcaseEvent(portalTimeline, "stage-checkout", {
        status: "passed",
        stage: stage.key,
        source_ref: stage.source_ref,
        commit_sha: git(studentCheckout, ["rev-parse", "HEAD"]).trim(),
      });
      await pushMain(studentCheckout, env, startIndex === 0 && index === 0);
      recordShowcaseEvent(portalTimeline, "gitea-push-main", {
        status: "passed",
        commit_sha: git(studentCheckout, ["rev-parse", "HEAD"]).trim(),
      });
      await Bun.sleep(1_500);

      const publicRun = await runWithLedgerRetry(cli, studentCheckout, env, [
        "portal", "run", "--stage", stage.key, "--watch",
      ]);
      const publicRunId = findRunId(publicRun);
      recordShowcaseEvent(portalTimeline, "portal-public-run", { status: "passed", run_id: publicRunId });
      const evidence = await runCli(cli, studentCheckout, env, [
        "portal", "evidence", publicRunId, "--out", `.vos/student-public-evidence/${stage.key}`,
      ]);
      const evidenceStatus = String((parseJson(evidence.stdout) as Record<string, unknown>).status ?? "unknown");
      recordShowcaseEvent(portalTimeline, "portal-evidence", { status: evidenceStatus, run_id: publicRunId });
      const replay = await runReplay(
        cli,
        studentCheckout,
        env,
        stage.key,
        stage.source_ref,
        publicRunId,
        evidenceStatus,
        stage.key === "lab10" ? historyReplayJournal : null,
        stage.key === "lab10" ? historyAudit?.report ?? null : null,
      );
      const historyAuditArtifact = stage.key === "lab10" && historyAudit
        ? await writeHistoryAuditArtifact(studentCheckout, historyAudit.report)
        : null;
      await uploadArtifact(cli, studentCheckout, env, publicRunId, replay.path, `${stage.key}-replay-bundle`);
      recordShowcaseEvent(portalTimeline, "portal-replay-upload", {
        status: "verified",
        run_id: publicRunId,
        label: `${stage.key}-replay-bundle`,
      });
      if (historyAuditArtifact) {
        await uploadArtifact(cli, studentCheckout, env, publicRunId, historyAuditArtifact, "glenda-history-audit");
        recordShowcaseEvent(portalTimeline, "portal-history-audit-upload", {
          status: "verified",
          run_id: publicRunId,
          label: "glenda-history-audit",
        });
      }
      if (replay.status !== "passed")
        throw new Error(`${stage.key} local replay failed after its failure bundle was uploaded`);

      const submission = await runCli(cli, studentCheckout, env, [
        "portal", "submit", "--stage", stage.key,
      ]);
      const submissionValue = parseJson(submission.stdout) as Record<string, unknown>;
      const submissionDetails = submissionValue.details as Record<string, unknown>;
      const submissionRecord = submissionDetails.submission as Record<string, unknown>;
      const submissionId = String(submissionRecord.id ?? "");
      const submissionRunId = String(submissionRecord.run_id ?? "");
      if (!submissionId || !submissionRunId)
        throw new Error("CLI submission response did not contain submission and run ids");
      recordShowcaseEvent(portalTimeline, "portal-submit", {
        status: "created",
        submission_id: submissionId,
        run_id: submissionRunId,
      });
      await uploadArtifact(cli, studentCheckout, env, submissionRunId, replay.path, `${stage.key}-replay-bundle`);
      if (historyAuditArtifact)
        await uploadArtifact(cli, studentCheckout, env, submissionRunId, historyAuditArtifact, "glenda-history-audit");
      await uploadRequiredReviewArtifacts(cli, studentCheckout, env, submissionRunId, stage.key, stage.required_review_artifacts);
      recordShowcaseEvent(portalTimeline, "portal-submission-artifacts", {
        status: "verified",
        run_id: submissionRunId,
        labels: [`${stage.key}-replay-bundle`, ...stage.required_review_artifacts],
      });
      const status = await runCli(cli, studentCheckout, env, [
        "portal", "status", submissionRunId, "--watch",
      ]);
      const terminal = nestedRunStatus(parseJson(status.stdout));
      recordShowcaseEvent(portalTimeline, "portal-authoritative-run", { status: terminal, run_id: submissionRunId });
      if (terminal !== "passed")
        throw new Error(`authoritative student CLI run ended with ${terminal}`);
      const evaluated = await submissionStatus(portalUrl, token, submissionId);
      const finalStatus = stage.manual_review_required
        ? await waitForTeacherApproval(portalUrl, token, submissionId, evaluated)
        : evaluated;
      recordShowcaseEvent(portalTimeline, "portal-stage-closure", {
        status: finalStatus,
        submission_id: submissionId,
        review: stage.manual_review_required ? "teacher-approved" : "not-required",
      });
      if (finalStatus !== "complete")
        throw new Error(`${stage.source_ref} submission ended with ${finalStatus}, expected complete`);
      const showcaseIndex = await writeShowcaseIndex(studentCheckout, stage.key, {
        source_ref: stage.source_ref,
        project_id: projectId,
        commit_sha: git(studentCheckout, ["rev-parse", "HEAD"]).trim(),
        public_run_id: publicRunId,
        submission_id: submissionId,
        submission_run_id: submissionRunId,
        evidence_status: evidenceStatus,
        submission_status: finalStatus,
        replay_bundle_label: `${stage.key}-replay-bundle`,
        history_audit_label: historyAuditArtifact ? "glenda-history-audit" : null,
        portal_timeline: portalTimeline,
      });
      await uploadArtifact(cli, studentCheckout, env, submissionRunId, showcaseIndex, `${stage.key}-showcase-index`);
      results.push({
        stage: stage.key,
        source_ref: stage.source_ref,
        commit_sha: git(studentCheckout, ["rev-parse", "HEAD"]).trim(),
        public_run_id: publicRunId,
        submission_run_id: submissionRunId,
        evidence_status: evidenceStatus,
        submission_status: finalStatus,
        showcase_index_label: `${stage.key}-showcase-index`,
        pushed_branch: "main",
      });
    }
  } finally {
    if (worktreeAdded)
      git(source, ["worktree", "remove", "--force", studentCheckout]);
  }
  console.log(JSON.stringify({
    flow: ["portal login", "portal whoami", "portal bind", "local replay", "push main", "portal run", "portal evidence", "portal artifact upload", "portal submit", "portal status", "teacher approval"],
    project_id: projectId,
    stages: results,
  }));
} finally {
  await rm(workspace, { recursive: true, force: true }).catch((error) => console.error(String(error))); 
}

async function runReplay(
  cli: string,
  cwd: string,
  env: Record<string, string | undefined>,
  stage: string,
  sourceRef: string,
  publicRunId: string,
  evidenceStatus: string,
  historyReplayJournal: unknown,
  historyAudit: unknown,
): Promise<{ path: string; status: "passed" | "failed" }> {
  const commands: Array<{ name: string; args: string[]; result: unknown; artifacts: Record<string, unknown> }> = [];
  let status: "passed" | "failed" = "passed";
  const execute = async (name: string, args: string[], requireModel = false): Promise<boolean> => {
    try {
      const result = await runCli(cli, cwd, env, args, true);
      const parsed = parseJson(result.stdout);
      const commandRecord = {
        name,
        args,
        result: sanitizeShowcase(parsed, cwd),
        artifacts: await collectRunArtifacts(cwd, parsed),
      };
      if (result.exitCode !== 0) {
        commands.push(commandRecord);
        status = "failed";
        return false;
      }
      if (requireModel) assertModelResult(parsed, name);
      commands.push(commandRecord);
      return true;
    } catch (error) {
      status = "failed";
      commands.push({
        name,
        args,
        result: { status: "failed", error: redact(error instanceof Error ? error.message : String(error)) },
        artifacts: {},
      });
      return false;
    }
  };
  for (const step of [
    { name: "spec-lint", args: ["spec", "lint", "all"], model: false },
    { name: "agent-ask", args: ["agent", "ask", `Review the ${stage} design boundary and identify only mechanisms introduced by this checkpoint.`], model: true },
    { name: "agent-review", args: ["agent", "review", "all"], model: true },
    { name: "build", args: ["build"], model: false },
    { name: "qemu", args: ["run", "qemu"], model: false },
    { name: "verify", args: ["verify"], model: false },
    { name: "report", args: ["report"], model: false },
  ])
    if (!(await execute(step.name, step.args, step.model))) break;
  const reportPath = path.join(cwd, ".vos", "report.json");
  const report = await Bun.file(reportPath).exists()
    ? sanitizeShowcase(JSON.parse(await readFile(reportPath, "utf8")), cwd)
    : null;
  const directory = path.join(cwd, ".vos", "showcase", stage);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, "replay-bundle.json");
  await writeFile(
    target,
    `${JSON.stringify({
      version: "glenda-replay-bundle.v1",
      stage,
      source_ref: sourceRef,
      commit_sha: git(cwd, ["rev-parse", "HEAD"]).trim(),
      tree_sha: git(cwd, ["rev-parse", "HEAD^{tree}"]).trim(),
      history: git(cwd, ["log", "--reverse", "--format=%H%x09%P%x09%s"]).trim().split("\n").filter(Boolean).map((line) => {
        const [commit_sha, parent_shas, ...subject] = line.split("\t");
        return { commit_sha, parent_shas: parent_shas ? parent_shas.split(" ") : [], subject: subject.join("\t") };
      }),
      portal: { project_id: projectId, public_run_id: publicRunId, evidence_status: evidenceStatus },
      status,
      commands,
      report,
      history_replay_journal: historyReplayJournal,
      history_audit: historyAudit,
    }, null, 2)}\n`,
  );
  return { path: path.relative(cwd, target), status };
}

async function readHistoryAudit(
  sourceRoot: string,
): Promise<{ path: string; report: Record<string, unknown> } | null> {
  const configured = process.env.VOS_GLENDA_HISTORY_AUDIT?.trim();
  const auditPath = path.resolve(sourceRoot, configured || path.join(".vos", "history-audit.json"));
  if (!(await Bun.file(auditPath).exists())) {
    if (process.env.VOS_GLENDA_HISTORY_AUDIT_REQUIRED === "1")
      throw new Error("VOS_GLENDA_HISTORY_AUDIT_REQUIRED requires a history audit report");
    return null;
  }
  const report = JSON.parse(await readFile(auditPath, "utf8")) as Record<string, unknown>;
  if (report.version !== "glenda-history-audit.v1" || report.status !== "passed")
    throw new Error("Glenda history audit must be a passing glenda-history-audit.v1 report");
  return { path: auditPath, report: sanitizeShowcase(report, sourceRoot) as Record<string, unknown> };
}

async function writeHistoryAuditArtifact(
  projectRoot: string,
  report: Record<string, unknown>,
): Promise<string> {
  const directory = path.join(projectRoot, ".vos", "showcase", "lab10");
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, "history-audit.json");
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  return path.relative(projectRoot, target);
}

async function readHistoryReplayJournal(sourceRoot: string): Promise<unknown> {
  const reportPath = path.join(sourceRoot, ".vos", "report.json");
  if (!(await Bun.file(reportPath).exists())) {
    if (process.env.VOS_GLENDA_HISTORY_REPORT_REQUIRED === "1")
      throw new Error("VOS_GLENDA_HISTORY_REPORT_REQUIRED requires source .vos/report.json");
    return null;
  }
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>;
  const evidence = report.evidence as Record<string, unknown> | undefined;
  const reportRuns = Array.isArray(evidence?.runs) ? evidence.runs : [];
  const runs: Array<Record<string, unknown>> = [];
  const statusCounts: Record<string, number> = {};
  for (const item of reportRuns) {
    const run = item as Record<string, unknown>;
    const runId = typeof run.run_id === "string" ? run.run_id : "";
    if (!runId || !/^[a-zA-Z0-9-]+$/.test(runId))
      throw new Error("source history report contains an invalid run id");
    const manifestPath = path.join(sourceRoot, ".vos", "runs", runId, "manifest.json");
    if (!(await Bun.file(manifestPath).exists()))
      throw new Error(`source history run has no manifest: ${runId}`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const status = String(manifest.status ?? run.status ?? "unknown");
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const artifactRecords: Record<string, unknown> = {};
    const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
    for (const artifactValue of artifacts) {
      const artifact = artifactValue as Record<string, unknown>;
      const artifactPath = typeof artifact.path === "string" ? artifact.path : "";
      const prefix = `.vos/runs/${runId}/artifacts/`;
      if (!artifactPath.startsWith(prefix) || !artifactPath.endsWith(".json")) continue;
      const absolute = path.join(sourceRoot, ...artifactPath.split("/"));
      const file = Bun.file(absolute);
      if (!(await file.exists()) || file.size > 1024 * 1024) continue;
      artifactRecords[artifactPath.slice(prefix.length)] = sanitizeShowcase(
        JSON.parse(await file.text()),
        sourceRoot,
      );
    }
    runs.push({
      run_id: runId,
      command: manifest.command ?? run.command ?? [],
      status,
      git_rev: manifest.git_rev,
      parent_sha: manifest.parent_sha,
      spec_hash: manifest.spec_hash,
      started_at: manifest.started_at ?? run.started_at,
      finished_at: manifest.finished_at ?? run.finished_at,
      manifest: sanitizeShowcase(manifest, sourceRoot),
      artifact_records: artifactRecords,
    });
  }
  return {
    version: "glenda-history-replay-journal.v1",
    commit_sha: report.commit_sha,
    spec_hash: report.spec_hash,
    generated_at: report.generated_at,
    run_count: runs.length,
    status_counts: statusCounts,
    failed_run_ids: runs.filter((run) => run.status !== "passed").map((run) => run.run_id),
    runs,
  };
}

async function writeShowcaseIndex(
  cwd: string,
  stage: string,
  record: Record<string, unknown>,
): Promise<string> {
  const directory = path.join(cwd, ".vos", "showcase", stage);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, "portal-index.json");
  await writeFile(target, `${JSON.stringify({ version: "glenda-showcase-index.v1", stage, ...record }, null, 2)}\n`);
  return path.relative(cwd, target);
}

function recordShowcaseEvent(
  timeline: ShowcaseEvent[],
  action: string,
  details: Record<string, unknown>,
): void {
  timeline.push({ recorded_at: new Date().toISOString(), action, details });
}

async function collectRunArtifacts(projectRoot: string, commandResult: unknown): Promise<Record<string, unknown>> {
  const root = commandResult as Record<string, unknown>;
  const runId = typeof root.run_id === "string" ? root.run_id : undefined;
  if (!runId) return {};
  const runRoot = path.join(projectRoot, ".vos", "runs", runId);
  if (!(await Bun.file(path.join(runRoot, "manifest.json")).exists())) return {};
  const collected: Record<string, unknown> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "artifacts") await visit(absolute);
        continue;
      }
      if (!/\.(?:json|jsonl|log|txt)$/i.test(entry.name)) continue;
      const relative = path.relative(runRoot, absolute).split(path.sep).join("/");
      if (relative === "events.jsonl") continue;
      const file = Bun.file(absolute);
      if (file.size > 5 * 1024 * 1024)
        throw new Error(`showcase artifact exceeds 5 MiB: ${relative}`);
      const text = await file.text();
      if (entry.name.endsWith(".json"))
        collected[relative] = sanitizeShowcase(JSON.parse(text), projectRoot);
      else
        collected[relative] = sanitizeShowcase(text, projectRoot);
    }
  };
  await visit(runRoot);
  return collected;
}

function assertModelResult(value: unknown, command: string): void {
  const root = value as Record<string, unknown>;
  const details = root.details as Record<string, unknown> | undefined;
  if (
    command === "agent-ask" &&
    details?.answer &&
    Array.isArray(details.raw_events) &&
    details.raw_events.length > 0
  )
    return;
  const review = details?.agent_review as Record<string, unknown> | undefined;
  if (details?.model_used !== true || review?.status === "unavailable")
    throw new Error(`${command} did not produce real model evidence`);
}

function sanitizeShowcase(value: unknown, projectRoot: string): unknown {
  const denied = new Set(["raw_text", "project_root", "portal_url", "token", "authorization", "credentials"]);
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (current && typeof current === "object")
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>)
          .filter(([key]) => !denied.has(key.toLowerCase()))
          .map(([key, nested]) => [key, visit(nested)]),
      );
    if (typeof current === "string") {
      const withoutProject = current
        .replaceAll(projectRoot, "<project>")
        .replaceAll(projectRoot.replaceAll("\\", "/"), "<project>");
      return redact(withoutProject)
        .replace(/[A-Za-z]:[\\/][^\s"'<>]*/g, "<local-path>")
        .replace(/\/(?:home|Users|mnt\/[a-z])\/[^\s"'<>]*/g, "<local-path>");
    }
    return current;
  };
  return visit(value);
}

async function uploadArtifact(
  cli: string,
  cwd: string,
  env: Record<string, string | undefined>,
  runId: string,
  artifactPath: string,
  label: string,
): Promise<void> {
  await runCli(cli, cwd, env, ["portal", "artifact", "upload", runId, artifactPath, "--label", label]);
}

async function uploadRequiredReviewArtifacts(
  cli: string,
  cwd: string,
  env: Record<string, string | undefined>,
  runId: string,
  stage: string,
  labels: string[],
): Promise<void> {
  const directory = path.join(cwd, ".vos", "showcase", stage, "review");
  await mkdir(directory, { recursive: true });
  for (const label of labels) {
    const variable = `VOS_GLENDA_ARTIFACT_${label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
    const sourcePath = required(variable);
    const extension = path.extname(sourcePath).slice(0, 16);
    const target = path.join(directory, `${label}${extension}`);
    await copyFile(sourcePath, target);
    await uploadArtifact(cli, cwd, env, runId, path.relative(cwd, target), label);
  }
}

async function submissionStatus(base: string, token: string, submissionId: string): Promise<string> {
  const value = (await request(
    base,
    `/submissions/${encodeURIComponent(submissionId)}`,
    { headers: { authorization: `Bearer ${token}` } },
  ).then((response) => response.json())) as { status?: string };
  return String(value.status ?? "unknown");
}

async function waitForTeacherApproval(base: string, token: string, submissionId: string, initial: string): Promise<string> {
  if (initial !== "candidate") return initial;
  const timeoutMs = Number(process.env.VOS_GLENDA_REVIEW_TIMEOUT_MS ?? 1_800_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000)
    throw new Error("VOS_GLENDA_REVIEW_TIMEOUT_MS must be at least 1000");
  console.error(`submission ${submissionId} is waiting for Portal teacher approval`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await Bun.sleep(5_000);
    const status = await submissionStatus(base, token, submissionId);
    if (status !== "candidate") return status;
  }
  throw new Error(`submission ${submissionId} remained candidate until the teacher approval timeout`);
}

async function applyStageDelta(sourceRoot: string, checkout: string, from: string, to: string): Promise<void> {
  const producer = Bun.spawn(["git", "diff", "--binary", from, to, "--", "."], {
    cwd: sourceRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const consumer = Bun.spawn(["git", "apply", "--index", "--3way", "-"], {
    cwd: checkout,
    stdin: producer.stdout,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [producerError, consumerOutput, consumerError, producerCode, consumerCode] = await Promise.all([
    new Response(producer.stderr).text(),
    new Response(consumer.stdout).text(),
    new Response(consumer.stderr).text(),
    producer.exited,
    consumer.exited,
  ]);
  if (producerCode !== 0 || consumerCode !== 0)
    throw new Error(`failed to advance ${from} to ${to}: ${redact(producerError || consumerError || consumerOutput)}`);
}

async function runWithLedgerRetry(
  cli: string,
  cwd: string,
  env: Record<string, string | undefined>,
  args: string[],
): Promise<CliResult> {
  let last: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await runCli(cli, cwd, env, args, true);
    if (result.exitCode === 0) return result;
    const root = parseJson(result.stdout) as Record<string, unknown>;
    const details = root.details as Record<string, unknown> | undefined;
    const run = details?.run as Record<string, unknown> | undefined;
    const retryable = run?.failure_class === "infra_failure" &&
      String(run.public_message ?? "").includes("commit ledger");
    if (!retryable)
      throw new Error(`vos ${args.join(" ")} failed: ${redact(result.stderr || result.stdout)}`);
    last = result.stderr || result.stdout;
    await Bun.sleep(500);
  }
  throw new Error(`commit ledger did not become visible: ${String(last)}`);
}

async function runCli(
  cli: string,
  cwd: string,
  env: Record<string, string | undefined>,
  args: string[],
  allowFailure = false,
): Promise<CliResult> {
  const child = Bun.spawn(
    ["bun", cli, "--project-root", cwd, "--progress", "never", "--json", ...args],
    { cwd, env, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  if (code !== 0 && !allowFailure)
    throw new Error(`vos ${args.join(" ")} failed: ${redact(stderr || stdout)}`);
  return { stdout, stderr, exitCode: code };
}

async function pushMain(
  cwd: string,
  env: Record<string, string | undefined>,
  firstPush: boolean,
): Promise<void> {
  const authEnv = giteaAuthEnv(env);
  let lease: string[] = [];
  if (firstPush) {
    const remote = runGit(cwd, ["ls-remote", "portal", "refs/heads/main"], authEnv, true);
    if (remote.exitCode !== 0)
      throw new Error(`git ls-remote failed: ${redact(remote.stderr || remote.stdout)}`);
    const sha = remote.stdout.trim().split(/\s+/, 1)[0] ?? "";
    lease = [`--force-with-lease=refs/heads/main:${sha}`];
  }
  const pushed = runGit(cwd, ["push", ...lease, "portal", "HEAD:refs/heads/main"], authEnv, true);
  if (pushed.exitCode !== 0)
    throw new Error(`git push failed: ${redact(pushed.stderr || pushed.stdout)}`);
}

function cloneStudentRepository(
  target: string,
  remote: string,
  env: Record<string, string | undefined>,
): void {
  const parent = path.dirname(target);
  const cloned = runGit(parent, ["clone", "--no-checkout", remote, target], giteaAuthEnv(env), true);
  if (cloned.exitCode !== 0)
    throw new Error(`git clone failed: ${redact(cloned.stderr || cloned.stdout)}`);
  git(target, ["checkout", "--detach", "origin/main"]);
}

function giteaAuthEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const username = process.env.VOS_GITEA_USERNAME ?? "student";
  const password = process.env.VOS_GITEA_PASSWORD ?? process.env.VOS_GITEA_TOKEN ?? "student";
  return {
    ...env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
  };
}

function publicRepositoryUrl(repoUrl: string | undefined): string {
  if (!repoUrl) throw new Error("Portal project has no active Gitea repository");
  const parsed = new URL(repoUrl);
  return `${giteaOrigin}${parsed.pathname}`;
}

function configurePortalRemote(cwd: string, remote: string): void {
  const existing = runGit(cwd, ["remote", "get-url", "portal"], process.env, true);
  if (existing.exitCode === 0) {
    git(cwd, ["remote", "set-url", "portal", remote]);
    return;
  }
  git(cwd, ["remote", "add", "portal", remote]);
}

function withGitShellPath(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (process.platform !== "win32") return env;
  const currentPath = env.PATH ?? "";
  const direct = Bun.spawnSync(["sh", "-c", "exit 0"], {
    env,
    stdout: "ignore",
    stderr: "ignore",
  });
  if (direct.exitCode === 0) return env;
  const gitExecPath = runGit(process.cwd(), ["--exec-path"], env, true);
  if (gitExecPath.exitCode !== 0)
    throw new Error(`cannot locate Git shell: ${redact(gitExecPath.stderr || gitExecPath.stdout)}`);
  const gitRoot = path.resolve(gitExecPath.stdout.trim(), "../../..");
  const candidates = [path.join(gitRoot, "usr", "bin"), path.join(gitRoot, "bin")];
  const shellDirectory = candidates.find((candidate) => existsSync(path.join(candidate, "sh.exe")));
  if (!shellDirectory)
    throw new Error("Git for Windows does not provide sh.exe; install a complete Git distribution");
  return { ...env, PATH: [shellDirectory, currentPath].filter(Boolean).join(path.delimiter) };
}

function hasStagedChanges(cwd: string): boolean {
  const result = runGit(cwd, ["diff", "--cached", "--quiet"], process.env, true);
  if (result.exitCode === 0) return false;
  if (result.exitCode === 1) return true;
  throw new Error(`failed to inspect staged replay changes: ${redact(result.stderr || result.stdout)}`);
}

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${redact(result.stderr.toString())}`);
  return result.stdout.toString();
}

function refExists(cwd: string, reference: string): boolean {
  return Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", reference], {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode === 0;
}

function runGit(
  cwd: string,
  args: string[],
  env: Record<string, string | undefined>,
  allowFailure = false,
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const output = { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  if (output.exitCode !== 0 && !allowFailure)
    throw new Error(`git ${args.join(" ")} failed: ${redact(output.stderr || output.stdout)}`);
  return output;
}

function findRunId(result: CliResult): string {
  const value = parseJson(result.stdout) as Record<string, unknown>;
  const details = value.details as Record<string, unknown> | undefined;
  const run = details?.run as Record<string, unknown> | undefined;
  const runId = String(run?.id ?? details?.run_id ?? "");
  if (!runId) throw new Error("CLI response did not contain a run id");
  return runId;
}

function nestedRunStatus(value: unknown): string {
  const root = value as Record<string, unknown>;
  const details = root.details as Record<string, unknown> | undefined;
  const run = details?.run as Record<string, unknown> | undefined;
  return String(run?.status ?? "unknown");
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output.trim());
  } catch {
    throw new Error("CLI did not return JSON output");
  }
}

async function webLogin(base: string): Promise<WebSession> {
  const username = process.env.VOS_PORTAL_USERNAME ?? "student";
  const password = process.env.VOS_PORTAL_PASSWORD ?? "student";
  const login = await request(base, "/auth/login", {
    method: "POST",
    headers: { "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ username, password }),
  });
  const cookies = cookieHeader(login.headers);
  const sessionToken = cookieValue(cookies, "vos_session");
  const csrf = cookieValue(cookies, "vos_csrf");
  if (!sessionToken || !csrf) throw new Error("Portal login did not return session cookies");
  return { token: sessionToken, cookies, csrf };
}

async function runCliDeviceLogin(
  cli: string,
  cwd: string,
  env: Record<string, string | undefined>,
  base: string,
  webSession: WebSession,
): Promise<void> {
  const loginEnv = { ...env };
  delete loginEnv.VOS_PORTAL_TOKEN;
  const child = Bun.spawn(
    ["bun", cli, "--project-root", cwd, "--progress", "never", "portal", "login", base],
    { cwd, env: loginEnv, stdout: "pipe", stderr: "pipe" },
  );
  const reader = child.stderr.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let userCode: string | undefined;
  const readTask = (async () => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += decoder.decode(chunk.value, { stream: true });
      userCode ??= output.match(/enter code ([A-Z0-9-]+)/i)?.[1];
    }
  })();
  const deadline = Date.now() + 15_000;
  while (!userCode && Date.now() < deadline) {
    await Promise.race([readTask, Bun.sleep(100)]);
    userCode ??= output.match(/enter code ([A-Z0-9-]+)/i)?.[1];
  }
  if (!userCode) {
    child.kill();
    throw new Error(`CLI device login did not expose a user code: ${redact(output)}`);
  }
  await request(base, "/auth/device/approve", {
    method: "POST",
    headers: {
      cookie: webSession.cookies,
      "x-csrf-token": webSession.csrf,
      "x-idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({ user_code: userCode }),
  });
  await readTask;
  const stdout = await new Response(child.stdout).text();
  const stderr = output;
  if ((await child.exited) !== 0)
    throw new Error(`vos portal login failed: ${redact(`${stderr}${stdout}`)}`);
}

type WebSession = { token: string; cookies: string; csrf: string };

async function request(base: string, route: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${base}/api/v1${route}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok)
    throw new Error(`Portal ${route} failed with HTTP ${response.status}`);
  return response;
}

function cookieHeader(headers: Headers): string {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = typeof getSetCookie === "function"
    ? getSetCookie.call(headers)
    : [headers.get("set-cookie") ?? ""];
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

function cookieValue(header: string, name: string): string | undefined {
  return header.split("; ").find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function redact(value: string): string {
  let redacted = value.replace(/Bearer\s+[^\s]+/gi, "Bearer <redacted>");
  for (const secret of [process.env.VOS_PORTAL_TOKEN, process.env.VOS_GITEA_TOKEN, process.env.VOS_GITEA_PASSWORD])
    if (secret) redacted = redacted.replaceAll(secret, "<redacted>");
  return redacted.slice(0, 800);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

type CliResult = { stdout: string; stderr: string; exitCode: number };
type ShowcaseEvent = { recorded_at: string; action: string; details: Record<string, unknown> };
