import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import postgres from "postgres";
import { WorkerControlService } from "../server/worker-control.ts";
import { collectRunnerEvidence, type RunnerObjectStore } from "../worker/runner-evidence.ts";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration("runner evidence is uploaded first and committed through the worker control boundary", async () => {
  const sql = postgres(databaseUrl!, { max: 4, prepare: false });
  const prefix = `runner-${crypto.randomUUID()}`;
  const user = `${prefix}-user`;
  const course = `${prefix}-course`;
  const experiment = `${prefix}-experiment`;
  const stage = `${prefix}-stage`;
  const project = `${prefix}-project`;
  const run = `${prefix}-run`;
  const remote = `${prefix}-remote`;
  const workerId = "runner-evidence-test";
  const commit = "a".repeat(40);
  const artifact = new TextEncoder().encode("verified runner output\n");
  const digest = createHash("sha256").update(artifact).digest("hex");
  const manifest = { run_id: remote, command: ["verify"], arguments: ["public"], git_rev: commit, started_at: "2026-07-18T01:00:00.000Z", finished_at: "2026-07-18T01:00:01.000Z", status: "passed", artifacts: [{ kind: "verify-log", path: `.vos/runs/${remote}/artifacts/verify.log`, size: artifact.byteLength, sha256: digest, summary: "public verification log" }], evidence_refs: [{ id: "boot.public", kind: "public-check", path: `.vos/runs/${remote}/artifacts/verify.log` }], project_root: "/workspace/project", project_id: project, policy_snapshot_ref: "policy-runner" };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { const url = new URL(request.url); if (url.pathname.endsWith("/manifest")) return Response.json(manifest); if (url.pathname.endsWith("/artifacts")) return new Response(artifact, { headers: { "content-length": String(artifact.byteLength) } }); return new Response("not found", { status: 404 }); } });
  const objects = new Map<string, Uint8Array>();
  const store: RunnerObjectStore = { async putVerified(key, bytes) { const copy = Uint8Array.from(bytes); objects.set(key, copy); return { uri: `s3://test/${key}`, sha256: createHash("sha256").update(copy).digest("hex"), size_bytes: copy.byteLength }; } };
  try {
    await sql.begin(async (tx) => {
      await tx`insert into users(id,username,display_name,role,status) values(${user},${user},'Runner Student','student','active')`;
      await tx`insert into courses(id,code,name,term,status) values(${course},${prefix},'Runner Course','test','active')`;
      await tx`insert into experiments(id,course_id,title,spec_version,publish_state) values(${experiment},${course},'Runner Lab','v1','published')`;
      await tx`insert into stage_gates(id,experiment_id,key,name,sequence,status,config) values(${stage},${experiment},'boot','Boot',0,'open',${tx.json({ required_artifacts: [], required_evidence: [], manual_review_required: false })})`;
      await tx`insert into projects(id,experiment_id,current_stage_id,repo_url,status,policy_snapshot_ref) values(${project},${experiment},${stage},'https://git.example/runner.git','active','policy-runner')`;
      await tx`insert into project_members(project_id,user_id) values(${project},${user})`;
      await tx`insert into pipeline_runs(id,project_id,commit_sha,stage_key,scope,status,policy_snapshot_ref,requested_by,reason,lease_owner,leased_until) values(${run},${project},${commit},'boot','public','running','policy-runner',${user},'runner evidence integration',${workerId},now()+interval '2 minutes')`;
    });
    const result = await collectRunnerEvidence({ store, workerId, endpoint: `http://${server.hostname}:${server.port}`, remoteRunId: remote, portalRun: { id: run, project_id: project, commit_sha: commit, policy_snapshot_ref: "policy-runner", scope: "public" } });
    expect(result.report.objects).toHaveLength(2);
    expect(result.report.evidence).toHaveLength(1);
    expect(objects.size).toBe(2);
    const control = new WorkerControlService(sql, "https://git.example");
    await control.reportEvidence(run, result.report);
    await control.reportEvidence(run, result.report);
    expect((await sql`select count(*)::int count from object_refs where run_id=${run} and upload_status='verified'`)[0].count).toBe(2);
    expect((await sql`select visibility,result from evidence_records where run_id=${run}`)[0]).toMatchObject({ visibility: "student", result: "pass" });
    expect((await sql`select passed,total from pipeline_runs where id=${run}`)[0]).toMatchObject({ passed: 1, total: 1 });
    await control.complete(run, { version: "worker-run-complete.v1", worker_id: workerId, remote_run_id: remote, status: "passed", evidence_records: 1, objects: 2, runner_image_id: "runner-image", runner_container_id: "runner-container" });
    expect((await sql`select status,lease_owner from pipeline_runs where id=${run}`)[0]).toMatchObject({ status: "passed", lease_owner: null });
  } finally {
    server.stop(true);
    await sql`delete from audit_events where resource_type='pipeline' and resource_id=${run}`;
    await sql`delete from evidence_records where run_id=${run}`;
    await sql`delete from object_refs where run_id=${run}`;
    await sql`delete from pipeline_events where run_id=${run}`;
    await sql`delete from pipeline_runs where id=${run}`;
    await sql`delete from project_members where project_id=${project}`;
    await sql`delete from projects where id=${project}`;
    await sql`delete from stage_gates where id=${stage}`;
    await sql`delete from experiments where id=${experiment}`;
    await sql`delete from courses where id=${course}`;
    await sql`delete from users where id=${user}`;
    await sql.end({ timeout: 5 });
  }
}, 30_000);
