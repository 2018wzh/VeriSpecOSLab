import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import postgres from "postgres";
import { startPortalServer, type PortalServer } from "../server/fastify.ts";
import { S3ObjectStore } from "../storage/s3.ts";
import { WorkerControlClient } from "../worker/control-client.ts";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const integration = databaseUrl && process.env.PORTAL_TEST_S3_ENDPOINT ? test : test.skip;

integration("worker evidence control HTTP path verifies MinIO metadata before committing evidence", async () => {
  const sql = postgres(databaseUrl!, { max: 4, prepare: false });
  const prefix = `worker-http-${crypto.randomUUID()}`;
  const workerId = "worker-http-test";
  const user = `${prefix}-user`;
  const course = `${prefix}-course`;
  const experiment = `${prefix}-experiment`;
  const stage = `${prefix}-stage`;
  const project = `${prefix}-project`;
  const run = `${prefix}-run`;
  const publicRun = `${prefix}-public-run`;
  const remoteRun = `${prefix}-remote`;
  const missingRun = `${prefix}-missing-run`;
  const missingRemoteRun = `${prefix}-missing-remote`;
  const previous = {
    database: process.env.DATABASE_URL,
    master: process.env.VOS_PORTAL_MASTER_KEY,
    gitea: process.env.VOS_GITEA_URL,
    giteaToken: process.env.VOS_GITEA_TOKEN,
    webhook: process.env.VOS_GITEA_WEBHOOK_SECRET,
    workerUrl: process.env.VOS_WORKER_CONTROL_URL,
  };
  let server: PortalServer | undefined;
  try {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.VOS_PORTAL_MASTER_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";
    process.env.VOS_GITEA_URL = "http://gitea:3000";
    process.env.VOS_GITEA_TOKEN = "worker-control-http-test-token";
    process.env.VOS_GITEA_WEBHOOK_SECRET = "worker-control-http-webhook-secret";
    await sql.begin(async (tx) => {
      await tx`insert into users(id,username,display_name,role,status) values(${user},${user},'Worker HTTP Student','student','active')`;
      await tx`insert into courses(id,code,name,term,status) values(${course},${prefix},'Worker HTTP Course','test','active')`;
      await tx`insert into experiments(id,course_id,title,spec_version,publish_state) values(${experiment},${course},'Worker HTTP Lab','v1','published')`;
      await tx`insert into stage_gates(id,experiment_id,key,name,sequence,status,config) values(${stage},${experiment},'boot','Boot',0,'open',${tx.json({ required_artifacts: [], required_evidence: [], required_showcase_artifacts: ["boot-replay-bundle"], manual_review_required: false })})`;
      await tx`insert into projects(id,experiment_id,current_stage_id,repo_url,status,policy_snapshot_ref) values(${project},${experiment},${stage},'https://git.example/worker-http.git','active','policy-worker-http')`;
      await tx`insert into project_members(project_id,user_id) values(${project},${user})`;
      await tx`insert into pipeline_runs(id,project_id,commit_sha,stage_key,scope,status,policy_snapshot_ref,requested_by,reason,lease_owner,leased_until) values(${run},${project},${"b".repeat(40)},'boot','final','running','policy-worker-http',${user},'worker HTTP integration',${workerId},now()+interval '2 minutes')`;
      await tx`insert into pipeline_runs(id,project_id,commit_sha,stage_key,scope,status,policy_snapshot_ref,requested_by,reason,finished_at) values(${publicRun},${project},${"b".repeat(40)},'boot','public','passed','policy-worker-http',${user},'recorded showcase replay',now())`;
      await tx`insert into object_refs(id,project_id,run_id,uri,object_key,sha256,size_bytes,content_type,visibility,label,upload_status,lineage) values(${`${prefix}-showcase-object`},${project},${publicRun},${`s3://vos-artifacts/${prefix}/replay-bundle`},${`${prefix}/replay-bundle`},${"a".repeat(64)},42,'application/json','student','boot-replay-bundle','verified',${tx.json({ source: "vos-cli" })})`;
      await tx`insert into assessment_submissions(id,project_id,run_id,commit_sha,stage_key,spec_hash,config_hash,manifest_hash,policy_snapshot_ref,submitted_by,status) values(${`${prefix}-submission`},${project},${run},${"b".repeat(40)},'boot',${"c".repeat(64)},${"d".repeat(64)},${"e".repeat(64)},'policy-worker-http',${user},'evaluating')`;
    });
    const store = S3ObjectStore.fromEnv();
    const key = `projects/${project}/runs/${run}/artifacts/http.log`;
    const bytes = new TextEncoder().encode("worker HTTP object\n");
    const stored = await store.putVerified(key, bytes, "text/plain");
    server = await startPortalServer({ host: "127.0.0.1", port: 0 });
    process.env.VOS_WORKER_CONTROL_URL = `${server.url}api/v1/internal/worker`;
    const client = WorkerControlClient.fromEnv(workerId);
    await client.reportEvidence(run, {
      version: "worker-evidence-report.v1",
      worker_id: workerId,
      remote_run_id: remoteRun,
      objects: [{ id: `${prefix}-object`, key, uri: stored.uri, sha256: stored.sha256, size_bytes: stored.size_bytes, content_type: "text/plain", visibility: "student", label: "HTTP evidence", lineage: { source: "worker-http", remote_run_id: remoteRun } }],
      evidence: [{ id: `${prefix}-evidence`, suite: "public", case_name: "http", result: "pass", visibility: "student", metrics: { source: "worker-http" }, public_message: "verified through internal control API" }],
    });
    await client.complete(run, { version: "worker-run-complete.v1", worker_id: workerId, remote_run_id: remoteRun, status: "passed", evidence_records: 1, objects: 1, runner_image_id: "http-runner-image", runner_container_id: "http-runner-container" });
    expect((await sql`select status,passed,total,lease_owner from pipeline_runs where id=${run}`)[0]).toMatchObject({ status: "passed", passed: 1, total: 1, lease_owner: null });
    expect((await sql`select count(*)::int count from object_refs where run_id=${run} and upload_status='verified'`)[0].count).toBe(1);
    expect((await sql`select status from assessment_submissions where run_id=${run}`)[0].status).toBe("complete");
    expect((await sql`select baseline,state,evidence_refs from score_snapshots where project_id=${project}`)[0]).toMatchObject({ baseline: "100.00", state: "draft", evidence_refs: [run] });
    await sql`insert into pipeline_runs(id,project_id,commit_sha,stage_key,scope,status,policy_snapshot_ref,requested_by,reason,lease_owner,leased_until) values(${missingRun},${project},${"f".repeat(40)},'boot','final','running','policy-worker-http',${user},'missing showcase integration',${workerId},now()+interval '2 minutes')`;
    await sql`insert into assessment_submissions(id,project_id,run_id,commit_sha,stage_key,spec_hash,config_hash,manifest_hash,policy_snapshot_ref,submitted_by,status) values(${`${prefix}-missing-submission`},${project},${missingRun},${"f".repeat(40)},'boot',${"1".repeat(64)},${"2".repeat(64)},${"3".repeat(64)},'policy-worker-http',${user},'evaluating')`;
    await client.reportEvidence(missingRun, {
      version: "worker-evidence-report.v1",
      worker_id: workerId,
      remote_run_id: missingRemoteRun,
      objects: [],
      evidence: [{ id: `${prefix}-missing-evidence`, suite: "public", case_name: "http", result: "pass", visibility: "student", metrics: {}, public_message: "runner passed without a replay bundle" }],
    });
    await client.complete(missingRun, { version: "worker-run-complete.v1", worker_id: workerId, remote_run_id: missingRemoteRun, status: "passed", evidence_records: 1, objects: 0 });
    expect((await sql`select status,public_message from pipeline_runs where id=${missingRun}`)[0]).toMatchObject({ status: "failed", public_message: "缺少课程重放展示材料：boot-replay-bundle" });
    expect((await sql`select status from assessment_submissions where run_id=${missingRun}`)[0].status).toBe("failed");
  } finally {
    await server?.stop(true);
    await sql`delete from audit_events where resource_id in (${run},${`${prefix}-submission`})`;
    await sql`delete from score_snapshots where project_id=${project}`;
    await sql`delete from assessment_submissions where project_id=${project}`;
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
    if (previous.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.database;
    if (previous.master === undefined) delete process.env.VOS_PORTAL_MASTER_KEY; else process.env.VOS_PORTAL_MASTER_KEY = previous.master;
    if (previous.gitea === undefined) delete process.env.VOS_GITEA_URL; else process.env.VOS_GITEA_URL = previous.gitea;
    if (previous.giteaToken === undefined) delete process.env.VOS_GITEA_TOKEN; else process.env.VOS_GITEA_TOKEN = previous.giteaToken;
    if (previous.webhook === undefined) delete process.env.VOS_GITEA_WEBHOOK_SECRET; else process.env.VOS_GITEA_WEBHOOK_SECRET = previous.webhook;
    if (previous.workerUrl === undefined) delete process.env.VOS_WORKER_CONTROL_URL; else process.env.VOS_WORKER_CONTROL_URL = previous.workerUrl;
  }
}, 30_000);
