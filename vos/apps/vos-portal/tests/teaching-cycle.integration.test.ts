import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "bun:test";
import postgres from "postgres";
import type { CourseManifestV1, PortalActor } from "vos-core/portal-contracts";
import { PostgresPortalRepository } from "../server/postgres-repository.ts";
import { ModelCredentialService } from "../server/model-credentials.ts";
import { GiteaClient } from "../storage/gitea.ts";
import { collectExpiredObjects } from "../storage/gc.ts";
import { S3ObjectStore } from "../storage/s3.ts";
import { provisionOne, runWorker } from "../worker/worker.ts";

const enabled = process.env.VOS_TEST_TEACHING_CYCLE === "1";
const integration = enabled ? test : test.skip;

integration("enrollment, Gitea push, isolated verification, immutable grading and appeal form one teaching cycle", async () => {
  const databaseUrl = required("PORTAL_TEST_DATABASE_URL");
  const giteaUrl = required("PORTAL_TEST_GITEA_URL").replace(/\/$/, "");
  const token = required("PORTAL_TEST_GITEA_TOKEN");
  const admin = required("PORTAL_TEST_GITEA_USERNAME");
  const webhookSecret = required("PORTAL_TEST_GITEA_WEBHOOK_SECRET");
  const sql = postgres(databaseUrl, { max: 12, prepare: false });
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const teacherId = `teaching-${suffix}-teacher`;
  const taUsername = `ta-${suffix}`;
  const studentUsername = admin;
  const template = `teaching-template-${suffix}`;
  const organization = `teaching-course-${suffix}`;
  const repositoryName = `team-${suffix}`;
  const teacher: PortalActor = { id:teacherId,username:teacherId,display_name:"Teaching E2E Teacher",role:"teacher" };
  const request = async (pathname:string, init:RequestInit={}) => {
    const response = await fetch(`${giteaUrl}${pathname}`, { ...init, headers:{authorization:`token ${token}`,accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...init.headers} });
    if (!response.ok) throw new Error(`Gitea teaching cycle HTTP ${response.status}: ${(await response.text()).slice(0,500)}`);
    return response;
  };
  let courseId = "";
  let experimentId = "";
  let studentId = "";
  let taId = "";
  let projectId = "";
  let runId = "";
  let workerPromise: Promise<void> | undefined;
  const workerController = new AbortController();
  try {
    await request("/api/v1/user/repos", {method:"POST",body:JSON.stringify({name:template,description:"VOS connected teaching fixture",private:true,template:true,auto_init:true,default_branch:"main"})});
    await uploadFixture(request, admin, template);
    await request("/api/v1/orgs", {method:"POST",body:JSON.stringify({username:organization,full_name:"VOS connected teaching course",visibility:"private"})});

    await sql`insert into users(id,username,display_name,role,status) values(${teacherId},${teacherId},'Teaching E2E Teacher','teacher','active')`;
    const portal = new PostgresPortalRepository(sql);
    const manifest:CourseManifestV1={version:"course-manifest.v1",course:{code:`VOS-${suffix}`,name:"Connected Teaching Cycle",term:"e2e"},experiment:{id:`lab-${suffix}`,title:"Portal teaching fixture",spec_version:"v1"},stages:[{id:"boot",key:"boot",name:"Boot",sequence:0,source_ref:"course/lab1-complete",spec_refs:["kernel.boot"],test_sets:["boot.public"],rubric_ids:["public-verification"],hardware_gate:"none",human_review_required:false,required_artifacts:["build/result.txt"],required_evidence:[],required_review_artifacts:[],manual_review_required:false}],rubric:[{id:"public-verification",name:"Public verification",weight:100}],ai_policy:{allowed_models:["school-default"],monthly_budget:10,allow_byok:true}};
    const imported = await portal.importCourseManifest(teacher,manifest,"create connected teaching course manifest",`trace-${suffix}-import`,`key-${suffix}-import`,`hash-${suffix}-import`);
    courseId = imported.course_id;
    await portal.publishCourseManifest(teacher,courseId,imported.manifest_version,"publish connected teaching course",`trace-${suffix}-publish`,`key-${suffix}-publish`,`hash-${suffix}-publish`);
    await portal.transitionCourseState(teacher,courseId,"active","start connected teaching course",`trace-${suffix}-active`,`key-${suffix}-active`,`hash-${suffix}-active`);
    await portal.importEnrollmentCsv(teacher,{course_id:courseId,csv:`username,display_name,role,group\n${studentUsername},Connected Student,student,Team A\n${taUsername},Connected TA,ta,\n`,dry_run:false,reason:"enroll connected teaching participants"},`trace-${suffix}-enrollment`,`key-${suffix}-enrollment`,`hash-${suffix}-enrollment`);
    const identities = await sql`select id,username from users where username in (${studentUsername},${taUsername})`;
    studentId = String(identities.find(row=>row.username===studentUsername)?.id ?? "");
    taId = String(identities.find(row=>row.username===taUsername)?.id ?? "");
    expect(studentId).not.toBe("");
    expect(taId).not.toBe("");
    experimentId = String((await sql`select id from experiments where course_id=${courseId} and publish_state='published'`)[0].id);
    const created = await portal.createProject(teacher,{version:"project-provision-request.v1",experiment_id:experimentId,member_ids:[studentId],owner:organization,repository:repositoryName,template_owner:admin,template_repository:template,description:"Connected teaching team repository",private:true,reason:"create connected teaching project"},`key-${suffix}-project`,`hash-${suffix}-project`,`trace-${suffix}-project`);
    projectId = created.project_id;
    expect(await provisionOne(sql,new GiteaClient(giteaUrl,token),`worker-${suffix}`,"http://vos-portal:8787/api/v1/internal/gitea/webhook",webhookSecret)).toBe(true);
    expect((await portal.projectProvisioning(teacher,projectId)).status).toBe("active");

    const repository = await (await request(`/api/v1/repos/${organization}/${repositoryName}`)).json() as {default_branch:string};
    await request(`/api/v1/repos/${organization}/${repositoryName}/contents/submission.txt`,{method:"POST",body:JSON.stringify({branch:repository.default_branch,content:Buffer.from("connected teaching submission\n").toString("base64"),message:"feat: submit connected teaching work"})});
    const ledger = await waitFor(async()=>{const rows=await sql`select after_sha from project_commit_ledger where project_id=${projectId} order by received_at desc limit 1`;return rows[0]?.after_sha?String(rows[0].after_sha):undefined;},20_000);
    const student:PortalActor={id:studentId,username:studentUsername,display_name:"Connected Student",role:"student"};
    const design=await portal.submitDesign(student,{version:"design-submission-input.v1",project_id:projectId,stage_key:"boot",commit_sha:ledger,title:"Connected boot architecture",summary:"Defines the observable boot contract, failure boundary and evidence needed before entering later stages.",invariants:["The kernel ready marker is emitted only after required subsystems are initialized."],interfaces:[{name:"kernel_boot",contract:"Returns control only by emitting the documented ready marker or a structured failure."}],evidence_refs:[],reason:"submit connected stage architecture"},`trace-${suffix}-design`,`key-${suffix}-design`,`hash-${suffix}-design`);
    const ta:PortalActor={id:taId,username:taUsername,display_name:"Connected TA",role:"ta"};
    expect((await portal.reviewDesign(ta,{version:"design-review-input.v1",submission_id:design.id,target_status:"review",feedback:"Architecture is complete enough for evidence-oriented review.",reason:"start connected design review"},`trace-${suffix}-design-review`,`key-${suffix}-design-review`,`hash-${suffix}-design-review`)).status).toBe("review");
    expect((await portal.reviewDesign(ta,{version:"design-review-input.v1",submission_id:design.id,target_status:"passed",feedback:"Architecture invariants and interface contract are accepted.",reason:"accept connected design revision"},`trace-${suffix}-design-pass`,`key-${suffix}-design-pass`,`hash-${suffix}-design-pass`)).status).toBe("passed");
    expect((await portal.courseOperations(teacher,courseId)).projects.find(item=>item.project_id===projectId)?.design_status).toBe("passed");
    const credentials=await ModelCredentialService.create(sql,required("PORTAL_TEST_MASTER_KEY"));
    const secret=`sk-connected-${suffix}-private`;
    const credentialInput={version:"model-credential-input.v1" as const,provider:"school-default",label:`connected-${suffix}`,secret,reason:"store connected teaching BYOK credential"};
    const credential=await credentials.save(student,credentialInput,`trace-${suffix}-credential`,`key-${suffix}-credential`,`hash-${suffix}-credential`);
    expect((await credentials.save(student,credentialInput,`trace-${suffix}-credential-replay`,`key-${suffix}-credential`,`hash-${suffix}-credential`)).id).toBe(credential.id);
    const sealed=(await sql`select secret_cipher from model_credentials where id=${credential.id}`)[0].secret_cipher as Uint8Array;
    expect(Buffer.from(sealed).toString("utf8")).not.toContain(secret);
    expect((await credentials.list(student))[0].last_four).toBe(secret.slice(-4));
    const queued = await portal.trigger(student,{version:"pipeline-request.v1",project_id:projectId,commit_sha:ledger,stage_key:"boot",scope:"public",model_credential_id:credential.id,reason:"submit connected public verification"},`key-${suffix}-pipeline`,`hash-${suffix}-pipeline`,`trace-${suffix}-pipeline`);
    runId = queued.id;
    workerPromise = runWorker(workerController.signal);
    const terminal = await waitFor(async()=>{const row=(await sql`select status from pipeline_runs where id=${runId}`)[0];return ["passed","failed","cancelled","timed_out"].includes(String(row?.status))?String(row.status):undefined;},120_000);
    workerController.abort();
    await Promise.race([workerPromise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("worker did not stop after abort")),5_000))]);
    if (terminal !== "passed") {
      const summary = (
        await sql`select status,failure_class,public_message,passed,total from pipeline_runs where id=${runId}`
      )[0];
      const evidence =
        await sql`select suite,case_name,result,public_message,metrics from evidence_records where run_id=${runId}`;
      const completion = (
        await sql`select payload from audit_events where resource_type='pipeline' and resource_id=${runId} and action='runner.complete' order by created_at desc limit 1`
      )[0]?.payload;
      throw new Error(
        `connected verification did not pass: ${JSON.stringify({ summary, evidence, completion })}`,
      );
    }
    expect(Number((await sql`select count(*)::int count from evidence_records where run_id=${runId}`)[0].count)).toBeGreaterThan(0);
    expect(Number((await sql`select count(*)::int count from object_refs where run_id=${runId} and upload_status='verified'`)[0].count)).toBeGreaterThan(0);
    const credentialLease=(await sql`select expires_at,consumed_at,revoked_at from model_credential_leases where run_id=${runId}`)[0];
    expect(credentialLease.consumed_at).toBeTruthy();
    expect(credentialLease.revoked_at).toBeTruthy();
    expect(new Date(String(credentialLease.expires_at)).getTime()).toBeGreaterThan(Date.now()-60_000);
    const unsealAudit=(await sql`select payload::text payload from audit_events where action='model_credential.runner_unseal' and resource_id=${runId}`)[0];
    expect(String(unsealAudit.payload)).not.toContain(secret);
    expect((await credentials.revoke(student,credential.id,"revoke connected teaching credential",`trace-${suffix}-credential-revoke`,`key-${suffix}-credential-revoke`,`hash-${suffix}-credential-revoke`)).revoked_at).toBeTruthy();

    await portal.review({id:taId,username:taUsername,display_name:"Connected TA",role:"ta"},{run_id:runId,action:"approve",reason:"approve connected verification evidence"},`trace-${suffix}-review`,`key-${suffix}-review`,`hash-${suffix}-review`);
    await portal.review({id:taId,username:taUsername,display_name:"Connected TA",role:"ta"},{run_id:runId,action:"approve",reason:"approve connected verification evidence"},`trace-${suffix}-review-replay`,`key-${suffix}-review`,`hash-${suffix}-review`);
    expect(Number((await sql`select count(*)::int count from pipeline_review_events where run_id=${runId} and action='approve'`)[0].count)).toBe(1);
    const draft = await portal.calculateScore(teacher,{project_id:projectId,reason:"calculate score from connected evidence"},`trace-${suffix}-score`,`key-${suffix}-score`,`hash-${suffix}-score`);
    const replayedDraft = await portal.calculateScore(teacher,{project_id:projectId,reason:"calculate score from connected evidence"},`trace-${suffix}-score-replay`,`key-${suffix}-score`,`hash-${suffix}-score`);
    expect(replayedDraft.id).toBe(draft.id);
    expect(draft.baseline).toBe(100);
    const adjusted = await portal.adjustScore(teacher,{project_id:projectId,member_id:studentId,delta:-2,reason:"apply documented individual adjustment",evidence_refs:[runId]},`trace-${suffix}-adjust`,`key-${suffix}-adjust`,`hash-${suffix}-adjust`);
    const frozen = await portal.transitionScore(teacher,{score_snapshot_id:adjusted.id,target_state:"frozen",reason:"freeze connected project grade"},`trace-${suffix}-freeze`,`key-${suffix}-freeze`,`hash-${suffix}-freeze`);
    const published = await portal.transitionScore(teacher,{score_snapshot_id:frozen.id,target_state:"published",reason:"publish connected project grade"},`trace-${suffix}-grade-publish`,`key-${suffix}-grade-publish`,`hash-${suffix}-grade-publish`);
    expect(published.final_score).toBe(98);
    await portal.transitionCourseState(teacher,courseId,"appeal","open connected appeal window",`trace-${suffix}-appeal-open`,`key-${suffix}-appeal-open`,`hash-${suffix}-appeal-open`);
    const appeal = await portal.submitAppeal(student,{project_id:projectId,statement:"The individual adjustment should be reconsidered against the attached verification evidence.",evidence_refs:[runId]},`trace-${suffix}-appeal`,`key-${suffix}-appeal`,`hash-${suffix}-appeal`);
    const checked = await portal.transitionAppeal({id:taId,username:taUsername,display_name:"Connected TA",role:"ta"},{appeal_id:appeal.id,target_status:"fact_check",reason:"verify connected appeal evidence"},`trace-${suffix}-fact-check`,`key-${suffix}-fact-check`,`hash-${suffix}-fact-check`);
    expect(checked.status).toBe("fact_check");
    const decided = await portal.transitionAppeal(teacher,{appeal_id:appeal.id,target_status:"decision",reason:"decide connected grade appeal",decision:"Evidence confirms partial restoration of the individual adjustment.",score_delta:1},`trace-${suffix}-decision`,`key-${suffix}-decision`,`hash-${suffix}-decision`);
    expect(decided.resolved_score_snapshot_id).toBeTruthy();
    const closed = await portal.transitionAppeal(teacher,{appeal_id:appeal.id,target_status:"closed",reason:"close connected grade appeal"},`trace-${suffix}-appeal-close`,`key-${suffix}-appeal-close`,`hash-${suffix}-appeal-close`);
    expect(closed.status).toBe("closed");
    await portal.transitionCourseState(teacher,courseId,"closed","close connected teaching course",`trace-${suffix}-course-close`,`key-${suffix}-course-close`,`hash-${suffix}-course-close`);
    const snapshots = await sql`select id,snapshot_version,state,previous_snapshot_id from score_snapshots where project_id=${projectId} order by snapshot_version`;
    expect(snapshots.map(row=>Number(row.snapshot_version))).toEqual([1,2,3,4,5]);
    expect(snapshots.slice(1).every((row,index)=>String(row.previous_snapshot_id)===String(snapshots[index].id))).toBe(true);
    expect(Number((await sql`select count(*)::int count from appeal_events where appeal_id=${appeal.id}`)[0].count)).toBe(4);
    expect(Number((await sql`select count(*)::int count from audit_events where resource_id in (${projectId},${runId},${appeal.id})`)[0].count)).toBeGreaterThan(5);
    const expiredObjects=await sql`update object_refs set created_at=now()-interval '31 days' where project_id=${projectId} and deleted_at is null returning object_key,sha256`;
    const garbage=await collectExpiredObjects(sql,S3ObjectStore.fromEnv());
    expect(garbage).toEqual({deleted:expiredObjects.length,failed:0});
    expect(Number((await sql`select count(*)::int count from object_refs where project_id=${projectId} and deleted_at is null`)[0].count)).toBe(0);
    for(const object of expiredObjects)await expect(S3ObjectStore.fromEnv().readVerified(String(object.object_key),String(object.sha256),16*1024*1024)).rejects.toThrow();
  } finally {
    workerController.abort();
    if (workerPromise) await Promise.race([workerPromise.catch(()=>undefined),Bun.sleep(3_000)]);
    if (projectId) {
      const objectKeys =
        await sql`select object_key from object_refs where project_id=${projectId}`;
      const store = S3ObjectStore.fromEnv();
      for (const object of objectKeys) await store.delete(String(object.object_key));
      await sql`update score_snapshots set source_appeal_id=null where project_id=${projectId}`;
      await sql`delete from appeal_events where appeal_id in(select id from appeals where project_id=${projectId})`;
      await sql`delete from appeals where project_id=${projectId}`;
      await sql`delete from member_adjustments where score_snapshot_id in(select id from score_snapshots where project_id=${projectId})`;
      await sql`delete from score_snapshots where project_id=${projectId}`;
      await sql`delete from evidence_records where run_id in(select id from pipeline_runs where project_id=${projectId})`;
      await sql`delete from object_refs where project_id=${projectId}`;
      await sql`delete from pipeline_review_events where run_id in(select id from pipeline_runs where project_id=${projectId})`;
      await sql`delete from pipeline_reviews where run_id in(select id from pipeline_runs where project_id=${projectId})`;
      await sql`delete from pipeline_events where run_id in(select id from pipeline_runs where project_id=${projectId})`;
      await sql`delete from model_credential_leases where run_id in(select id from pipeline_runs where project_id=${projectId})`;
      await sql`delete from pipeline_runs where project_id=${projectId}`;
      await sql`delete from design_submission_events where submission_id in(select id from design_submissions where project_id=${projectId})`;
      await sql`delete from design_submissions where project_id=${projectId}`;
      await sql`delete from project_commit_ledger where project_id=${projectId}`;
      await sql`delete from gitea_webhook_deliveries where repository_full_name=${`${organization}/${repositoryName}`}`;
      await sql`delete from project_repositories where project_id=${projectId}`;
      await sql`delete from project_members where project_id=${projectId}`;
      await sql`delete from projects where id=${projectId}`;
    }
    await sql`delete from notifications where user_id in (${teacherId},${studentId||"missing"},${taId||"missing"})`;
    await sql`delete from audit_events where actor_id in (${teacherId},${studentId||"missing"},${taId||"missing"}) or trace_id like ${`trace-${suffix}-%`} or resource_id in (${projectId||"missing"},${runId||"missing"}) or payload->>'project_id'=${projectId||"missing"}`;
    await sql`delete from outbox_events where aggregate_id in (${courseId||"missing"},${projectId||"missing"},${runId||"missing"}) or payload->>'project_id'=${projectId||"missing"}`;
    await sql`delete from idempotency_keys where actor_id in (${teacherId},${studentId||"missing"},${taId||"missing"})`;
    await sql`delete from model_credentials where owner_id in (${teacherId},${studentId||"missing"},${taId||"missing"}) and label like ${`connected-${suffix}%`}`;
    if (courseId) {
      await sql`delete from course_group_members where course_id=${courseId}`;
      await sql`delete from course_groups where course_id=${courseId}`;
      await sql`delete from course_memberships where course_id=${courseId}`;
      await sql`delete from course_rubric_items where course_id=${courseId}`;
      await sql`delete from course_ai_policies where course_id=${courseId}`;
      await sql`delete from stage_gates where experiment_id in(select id from experiments where course_id=${courseId})`;
      await sql`delete from experiments where course_id=${courseId}`;
      await sql`delete from course_manifest_versions where course_id=${courseId}`;
      await sql`delete from courses where id=${courseId}`;
    }
    await sql`delete from users where id in (${teacherId},${taId||"missing"})`;
    await sql.end({timeout:5});
    await request(`/api/v1/repos/${organization}/${repositoryName}`,{method:"DELETE"}).catch(()=>undefined);
    await request(`/api/v1/orgs/${organization}`,{method:"DELETE"}).catch(()=>undefined);
    await request(`/api/v1/repos/${admin}/${template}`,{method:"DELETE"}).catch(()=>undefined);
  }
},180_000);

async function uploadFixture(request:(path:string,init?:RequestInit)=>Promise<Response>,owner:string,repository:string):Promise<void>{
  const root=path.join(import.meta.dir,"fixtures","teaching-project");
  for(const relative of await files(root)){
    const repositoryPath=relative.startsWith("vos/")?`.vos/${relative.slice(4)}`:relative;
    const content=await readFile(path.join(root,...relative.split("/")));
    await request(`/api/v1/repos/${owner}/${repository}/contents/${repositoryPath.split("/").map(encodeURIComponent).join("/")}`,{method:"POST",body:JSON.stringify({branch:"main",content:content.toString("base64"),message:`test: add ${repositoryPath}`})});
  }
}

async function files(root:string,current=""):Promise<string[]>{const entries=await readdir(path.join(root,current),{withFileTypes:true});const output:string[]=[];for(const entry of entries.toSorted((a,b)=>a.name.localeCompare(b.name))){const relative=current?`${current}/${entry.name}`:entry.name;if(entry.isDirectory())output.push(...await files(root,relative));else output.push(relative);}return output;}

async function waitFor<T>(read:()=>Promise<T|undefined>,timeoutMs:number):Promise<T>{const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const value=await read();if(value!==undefined)return value;await Bun.sleep(250);}throw new Error(`condition was not met within ${timeoutMs} ms`);}
function required(name:string):string{const value=process.env[name]?.trim();if(!value)throw new Error(`${name} is required`);return value;}
