import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { buildNormalizedSpecBundle } from "vos-spec";
import {
  AssessmentSubmissionV1Schema,
  CourseManifestV1Schema,
} from "vos-core/portal-contracts";
import { HttpPortalClient } from "vos-core";

const portal = required("VOS_PORTAL_URL");
const token = required("VOS_PORTAL_TOKEN");
const projectId = required("VOS_PORTAL_PROJECT_ID");
const source = path.resolve(
  process.env.VOS_GLENDA_SPEC_ROOT ??
    path.join(import.meta.dirname, "../../../../../glenda-spec"),
);
const manifestBytes = await readFile(
  path.resolve(import.meta.dirname, "../../../../courses/glenda-spec/course.yaml"),
);
const manifest = CourseManifestV1Schema.parse(
  parse(manifestBytes.toString("utf8")),
);
const client = new HttpPortalClient();
const workspace = await mkdtemp(path.join(os.tmpdir(), "vos-glenda-connected-"));
const includeCandidate = process.env.VOS_GLENDA_INCLUDE_CANDIDATES === "1";
const startStage = process.env.VOS_GLENDA_START_STAGE?.trim();
const startSequence = startStage
  ? manifest.stages.find((stage) => stage.key === startStage)?.sequence
  : undefined;
if (startStage && startSequence === undefined)
  throw new Error(`unknown VOS_GLENDA_START_STAGE: ${startStage}`);
const stages = manifest.stages
  .filter(
    (stage) => !stage.source_ref.endsWith("candidate") || includeCandidate,
  )
  .slice(0, includeCandidate ? 5 : 4)
  .filter((stage) => startSequence === undefined || stage.sequence >= startSequence)

try {
  const binding = await client.getProjectBinding(portal, token, projectId);
  if (binding.project_id !== projectId || binding.member_ids.length === 0)
    throw new Error("Portal returned an invalid project binding");
  for (const stage of stages) {
    const current = await client.getProjectBinding(portal, token, projectId);
    if (current.current_stage.key !== stage.key)
      throw new Error(
        `${stage.source_ref} is not the current Portal stage (${current.current_stage.key})`,
      );
    const checkout = path.join(workspace, stage.id);
    git(source, ["worktree", "add", "--detach", checkout, stage.source_ref]);
    try {
      const commit = git(checkout, ["rev-parse", "HEAD"]).trim();
      const bundle = await buildNormalizedSpecBundle({ projectRoot: checkout });
      const config = await readBytes(checkout, "vos.yaml");
      const publicRun = await client.triggerPipeline!(portal, token, {
        version: "pipeline-request.v1",
        project_id: projectId,
        commit_sha: commit,
        stage_key: stage.key,
        scope: "public",
        reason: `connected public verification for ${stage.source_ref}`,
      });
      const publicEvents = await client.watchPipeline!(
        portal,
        token,
        publicRun.id,
      );
      const publicStatus = await client.getPipeline!(
        portal,
        token,
        publicRun.id,
      );
      const publicEvidence = await client.getEvidence!(
        portal,
        token,
        publicRun.id,
      );
      if (
        publicStatus.status !== "passed" ||
        publicEvidence.evidence.length === 0
      )
        throw new Error(
          `${stage.source_ref} public run did not pass with evidence`,
        );
      const submission = await client.createAssessmentSubmission!(
        portal,
        token,
        {
          version: "assessment-submission-request.v1",
          project_id: projectId,
          commit_sha: commit,
          stage_key: stage.key,
          spec_hash: sha(JSON.stringify(bundle.hashes)),
          config_hash: sha(config),
          manifest_hash: sha(manifestBytes),
          reason: `connected authoritative assessment for ${stage.source_ref}`,
        },
      );
      const events = await client.watchPipeline!(
        portal,
        token,
        submission.run_id,
      );
      const run = await client.getPipeline!(portal, token, submission.run_id);
      const evidence = await client.getEvidence!(
        portal,
        token,
        submission.run_id,
      );
      if (run.status !== "passed" || evidence.evidence.length === 0)
        throw new Error(
          `${stage.source_ref} authoritative run did not pass with evidence`,
        );
      const completed = AssessmentSubmissionV1Schema.parse(
        await portalJson(
          `${portal}/api/v1/submissions/${encodeURIComponent(submission.id)}`,
          token,
        ),
      );
      const expected = stage.source_ref.endsWith("candidate")
        ? "candidate"
        : "complete";
      if (completed.status !== expected)
        throw new Error(
          `${stage.source_ref} terminal submission status was ${completed.status}, expected ${expected}`,
        );
      console.log(
        JSON.stringify({
          tag: stage.source_ref,
          commit,
          public_run_id: publicRun.id,
          public_events: publicEvents.length,
          run_id: run.id,
          events: events.length,
          evidence: evidence.evidence.length,
          status: completed.status,
        }),
      );
    } finally {
      git(source, ["worktree", "remove", "--force", checkout]);
    }
  }
  if (!includeCandidate)
    console.log(
      JSON.stringify({
        candidate_boundary:
          "M5 remains candidate; rerun with VOS_GLENDA_INCLUDE_CANDIDATES=1 only for Orange Pi Prime hardware and manual review preparation",
      }),
    );
} finally {
  await rm(workspace, { recursive: true, force: true });
}

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
    );
  return result.stdout.toString();
}
async function readBytes(root: string, relative: string): Promise<Uint8Array> {
  const file = await readFile(path.join(root, relative));
  return new Uint8Array(file);
}
function sha(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
async function portalJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(`${url.replace(/\/$/, "")}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Portal request failed: HTTP ${response.status}`);
  return await response.json();
}
