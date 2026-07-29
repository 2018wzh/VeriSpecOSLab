import postgres from "postgres";
import { expect, test } from "bun:test";
import { DockerRunnerRuntime, type RunnerSession } from "../worker/docker-runner.ts";

const enabled = process.env.VOS_TEST_RUNNER_LOAD === "1";
const loadTest = enabled ? test : test.skip;

loadTest("100 students can queue work while 20 isolated runners start concurrently", async () => {
  const databaseUrl = required("PORTAL_TEST_DATABASE_URL");
  const gitea = required("VOS_GITEA_URL").replace(/\/$/, "");
  const token = required("VOS_GITEA_TOKEN");
  const sql = postgres(databaseUrl, { max: 24, prepare: false });
  const prefix = `load-${crypto.randomUUID()}`;
  const course = `${prefix}-course`;
  const experiment = `${prefix}-experiment`;
  const stage = `${prefix}-stage`;
  const repositoryName = `${prefix.slice(0, 32)}-repo`;
  let repositoryPath: string | undefined;
  const sessions: RunnerSession[] = [];
  try {
    const meResponse = await fetch(`${gitea}/api/v1/user`, { headers: giteaHeaders(token) });
    if (!meResponse.ok) throw new Error(`Gitea user lookup failed: HTTP ${meResponse.status}`);
    const me = (await meResponse.json()) as { login: string };
    repositoryPath = `${me.login}/${repositoryName}`;
    const createResponse = await fetch(`${gitea}/api/v1/user/repos`, {
      method: "POST",
      headers: { ...giteaHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ name: repositoryName, private: true, auto_init: true, default_branch: "main", readme: "Default" }),
    });
    if (createResponse.status !== 201) throw new Error(`Gitea load repository creation failed: HTTP ${createResponse.status}`);
    const repository = (await createResponse.json()) as { default_branch: string };
    const branchResponse = await fetch(`${gitea}/api/v1/repos/${encodeURIComponent(me.login)}/${encodeURIComponent(repositoryName)}/branches/${encodeURIComponent(repository.default_branch)}`, { headers: giteaHeaders(token) });
    if (!branchResponse.ok) throw new Error(`Gitea branch lookup failed: HTTP ${branchResponse.status}`);
    const commitSha = ((await branchResponse.json()) as { commit: { id: string } }).commit.id;
    const repositoryUrl = `${gitea}/${repositoryPath}.git`;

    await sql.begin(async (tx) => {
      await tx`insert into courses(id,code,name,term,status) values(${course},${prefix},'Runner Load Course','load','active')`;
      await tx`insert into experiments(id,course_id,title,spec_version,publish_state) values(${experiment},${course},'Runner Load Lab','v1','published')`;
      await tx`insert into stage_gates(id,experiment_id,key,name,sequence,status,config) values(${stage},${experiment},'boot','Boot',0,'open',${tx.json({ required_artifacts: [], required_evidence: [], manual_review_required: false })})`;
      for (let index = 0; index < 100; index++) {
        const user = `${prefix}-user-${index}`;
        const project = `${prefix}-project-${index}`;
        await tx`insert into users(id,username,display_name,role,status) values(${user},${user},${`Load Student ${index}`},'student','active')`;
        await tx`insert into projects(id,experiment_id,current_stage_id,repo_url,status,policy_snapshot_ref) values(${project},${experiment},${stage},${repositoryUrl},'active','policy-load-v1')`;
        await tx`insert into project_members(project_id,user_id) values(${project},${user})`;
        await tx`insert into project_repositories(project_id,provider,owner_name,repository_name,template_owner,template_repository,description,is_private,status,clone_url) values(${project},'gitea',${me.login},${`${repositoryName}-${index}`},${me.login},${repositoryName},'load test binding',true,'active',${repositoryUrl})`;
        await tx`insert into pipeline_runs(id,project_id,commit_sha,stage_key,scope,status,policy_snapshot_ref,requested_by,reason) values(${`${prefix}-run-${index}`},${project},${commitSha},'boot','public','queued','policy-load-v1',${user},'runner load integration request')`;
      }
    });
    const claimed = await Promise.all(Array.from({ length: 20 }, () => sql.begin(async (tx) => (await tx`update pipeline_runs set status='leased',leased_at=now() where id=(select id from pipeline_runs where id like ${`${prefix}-run-%`} and status='queued' order by created_at,id limit 1 for update skip locked) returning *`)[0])));
    expect(new Set(claimed.map((row) => String(row.id))).size).toBe(20);
    expect(Number((await sql`select count(*)::int count from pipeline_runs where id like ${`${prefix}-run-%`} and status='queued'`)[0].count)).toBe(80);

    const runtime = DockerRunnerRuntime.fromEnv();
    const startedAt = performance.now();
    sessions.push(...await Promise.all(claimed.map((run) => runtime.start({
      portalRunId: String(run.id),
      projectId: String(run.project_id),
      repositoryUrl,
      commitSha,
      stageKey: "boot",
      scope: "public",
      policySnapshotRef: "policy-load-v1",
      actor: { id: String(run.requested_by), username: String(run.requested_by), role: "student" },
      commitLedger: { commit_sha:commitSha,actor:"human",run_id:`gitea-load-${String(run.id)}`,spec_refs:[],changed_targets:[],evidence_refs:[],collaboration_intent:"signed Gitea load fixture push",created_at:new Date().toISOString() },
    }))));
    const elapsedMs = performance.now() - startedAt;
    expect(sessions).toHaveLength(20);
    expect(elapsedMs).toBeLessThan(Number(process.env.VOS_RUNNER_LOAD_MAX_START_MS ?? 120_000));
    const active = await Promise.all(sessions.map(async (session) => {
      const response = await fetch(`${session.endpoint}/health`);
      return response.ok;
    }));
    expect(active.every(Boolean)).toBe(true);
  } finally {
    await Promise.allSettled(sessions.map((session) => session.cleanup()));
    await sql`delete from pipeline_events where run_id like ${`${prefix}-run-%`}`;
    await sql`delete from pipeline_runs where id like ${`${prefix}-run-%`}`;
    await sql`delete from project_repositories where project_id like ${`${prefix}-project-%`}`;
    await sql`delete from project_members where project_id like ${`${prefix}-project-%`}`;
    await sql`delete from projects where id like ${`${prefix}-project-%`}`;
    await sql`delete from stage_gates where id=${stage}`;
    await sql`delete from experiments where id=${experiment}`;
    await sql`delete from courses where id=${course}`;
    await sql`delete from users where id like ${`${prefix}-user-%`}`;
    await sql.end({ timeout: 5 });
    if (repositoryPath) await fetch(`${gitea}/api/v1/repos/${repositoryPath}`, { method: "DELETE", headers: giteaHeaders(token) });
  }
}, 180_000);

function giteaHeaders(token: string): Record<string, string> {
  return { authorization: `token ${token}`, accept: "application/json" };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
