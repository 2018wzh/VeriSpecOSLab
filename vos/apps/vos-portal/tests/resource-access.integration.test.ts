import { expect, test } from "bun:test";
import postgres from "postgres";
import { PostgresPortalRepository } from "../server/postgres-repository.ts";

const databaseUrl=process.env.PORTAL_TEST_DATABASE_URL;
const integration=databaseUrl?test:test.skip;
async function expectError(operation:Promise<unknown>):Promise<void>{try{await operation;throw new Error("expected operation to fail");}catch(error){expect(error).toBeInstanceOf(Error);expect((error as Error).message).toContain("无资源访问权限");}}

integration("project and run access is scoped to project membership or active course staff",async()=>{
  const sql=postgres(databaseUrl!,{max:6,prepare:false});const prefix=`resource-access-${crypto.randomUUID()}`;const courseId=`${prefix}-course`;const experimentId=`${prefix}-experiment`;const stageId=`${prefix}-stage`;const projectId=`${prefix}-project`;const secondProjectId=`${prefix}-project-2`;const publicRunId=`${prefix}-public-run`;const staffRunId=`${prefix}-staff-run`;const pendingObjectId=`${prefix}-pending-object`;const verifiedObjectId=`${prefix}-verified-object`;const designId=`${prefix}-design`;const teacherId=`${prefix}-teacher`;const taId=`${prefix}-ta`;const studentId=`${prefix}-student`;const otherStudentId=`${prefix}-other`;const outsiderId=`${prefix}-outsider`;
  const actors={teacher:{id:teacherId,username:teacherId,display_name:"Teacher",role:"teacher" as const},ta:{id:taId,username:taId,display_name:"TA",role:"ta" as const},student:{id:studentId,username:studentId,display_name:"Student",role:"student" as const},other:{id:otherStudentId,username:otherStudentId,display_name:"Other",role:"student" as const},outsider:{id:outsiderId,username:outsiderId,display_name:"Outside",role:"teacher" as const}};
  try{
    await sql`insert into users(id,username,display_name,role,status) values (${teacherId},${teacherId},'Teacher','teacher','active'),(${taId},${taId},'TA','ta','active'),(${studentId},${studentId},'Student','student','active'),(${otherStudentId},${otherStudentId},'Other','student','active'),(${outsiderId},${outsiderId},'Outside','teacher','active')`;
    await sql`insert into courses(id,code,name,term,status) values(${courseId},${prefix},'Resource Access','test','active')`;
    await sql`insert into course_memberships(course_id,user_id,role,status,source) values(${courseId},${teacherId},'teacher','active','manual'),(${courseId},${taId},'ta','active','manual'),(${courseId},${studentId},'student','active','manual'),(${courseId},${otherStudentId},'student','active','manual')`;
    await sql`insert into experiments(id,course_id,title,spec_version,publish_state) values(${experimentId},${courseId},'Access Lab','v1','published')`;
    await sql`insert into stage_gates(id,experiment_id,key,name,sequence,status,config) values(${stageId},${experimentId},'boot','Boot',0,'open',${sql.json({required_artifacts:[],required_evidence:[],manual_review_required:false})})`;
    await sql`insert into projects(id,experiment_id,current_stage_id,repo_url,status,policy_snapshot_ref) values(${projectId},${experimentId},${stageId},'https://gitea.invalid/course/project.git','active','policy-test')`;
    await sql`insert into projects(id,experiment_id,current_stage_id,repo_url,status,policy_snapshot_ref) values(${secondProjectId},${experimentId},${stageId},'https://gitea.invalid/course/project-2.git','active','policy-test-2')`;
    await sql`insert into project_members(project_id,user_id) values(${projectId},${studentId})`;
    await sql`insert into project_members(project_id,user_id) values(${secondProjectId},${studentId})`;
    await sql`insert into project_repositories(project_id,provider,owner_name,repository_name,template_owner,template_repository,description,is_private,status) values(${projectId},'gitea','course',${prefix},'templates','xv6','resource access fixture',true,'active')`;
    await sql`insert into pipeline_runs(id,project_id,commit_sha,stage_key,scope,status,policy_snapshot_ref,reason,requested_by) values(${publicRunId},${projectId},${"a".repeat(40)},'boot','public','queued','policy-test','public access test',${studentId}),(${staffRunId},${projectId},${"b".repeat(40)},'boot','staff','queued','policy-test','staff access test',${teacherId})`;
    await sql`insert into pipeline_events(run_id,sequence,event_type,visibility,payload) values(${publicRunId},0,'queued','student',${sql.json({message:"queued"})})`;
    await sql`insert into evidence_records(id,run_id,suite,case_name,result,visibility,metrics) values(${`${prefix}-evidence`},${publicRunId},'boot','kernel-ready','pass','student',${sql.json({})})`;
    await sql`insert into object_refs(id,project_id,run_id,uri,object_key,sha256,size_bytes,content_type,visibility,label,upload_status) values(${pendingObjectId},${projectId},${publicRunId},${`s3://test/${pendingObjectId}`},${pendingObjectId},${"c".repeat(64)},1,'text/plain','student','pending','pending'),(${verifiedObjectId},${projectId},${publicRunId},${`s3://test/${verifiedObjectId}`},${verifiedObjectId},${"d".repeat(64)},1,'text/plain','staff','verified','verified')`;
    await sql`insert into design_submissions(id,project_id,stage_gate_id,commit_sha,revision,title,summary,invariants,interfaces,evidence_refs,status,submitted_by) values(${designId},${projectId},${stageId},${"a".repeat(40)},1,'Design','Design summary',${sql.json([])},${sql.json([])},${sql.json([])},'submitted',${studentId})`;
    const repository=new PostgresPortalRepository(sql);
    await repository.assertProjectAccess(actors.teacher,projectId,"teacher");await repository.assertProjectAccess(actors.ta,projectId,"staff");await repository.assertProjectAccess(actors.student,projectId,"read");await repository.assertRunAccess(actors.student,publicRunId,"read");await repository.assertRunAccess(actors.ta,staffRunId,"staff");
    expect((await repository.contexts(actors.student)).map(item=>item.project.id)).toEqual([projectId,secondProjectId]);
    expect((await repository.dashboard(actors.student,secondProjectId)).project.project_id).toBe(secondProjectId);
    await expectError(repository.assertProjectAccess(actors.outsider,projectId,"read"));await expectError(repository.assertProjectAccess(actors.other,projectId,"read"));await expectError(repository.assertProjectAccess(actors.ta,projectId,"teacher"));await expectError(repository.assertRunAccess(actors.student,staffRunId,"read"));
    await expectError(repository.dashboard(actors.outsider,secondProjectId));
    await expectError(repository.projectProvisioning(actors.outsider,projectId));
    await expectError(repository.projectBinding(actors.outsider,projectId));
    await expectError(repository.pendingObject(actors.outsider,pendingObjectId));
    await expectError(repository.completeObject(actors.outsider,pendingObjectId));
    await expectError(repository.objectForDownload(actors.outsider,verifiedObjectId));
    await expectError(repository.designSubmissions(actors.outsider,projectId));
    await expectError(repository.evidence(actors.outsider,publicRunId));
    await expectError(repository.pipeline(actors.outsider,publicRunId));
    await expectError(repository.createProject(actors.outsider,{version:"project-provision-request.v1",experiment_id:experimentId,member_ids:[studentId],owner:"course",repository:`denied-${prefix.slice(-8)}`,template_owner:"templates",template_repository:"xv6",description:"must not be created",private:true,reason:"verify cross-course project creation is denied"},`${prefix}-create-key`,`${prefix}-create-hash`,`${prefix}-create-trace`));
    await expectError(repository.submitDesign(actors.outsider,{version:"design-submission-input.v1",project_id:projectId,stage_key:"boot",commit_sha:"a".repeat(40),title:"Denied design",summary:"A cross-course actor must not submit a design for this project.",invariants:["Only project members may submit."],interfaces:[{name:"denied",contract:"No mutation occurs."}],evidence_refs:[],reason:"verify cross-course design submission is denied"},`${prefix}-submit-trace`,`${prefix}-submit-key`,`${prefix}-submit-hash`));
    await expectError(repository.reviewDesign(actors.outsider,{version:"design-review-input.v1",submission_id:designId,target_status:"review",feedback:"This review must not be accepted.",reason:"verify cross-course design review is denied"},`${prefix}-design-review-trace`,`${prefix}-design-review-key`,`${prefix}-design-review-hash`));
    await expectError(repository.trigger(actors.outsider,{version:"pipeline-request.v1",project_id:projectId,commit_sha:"a".repeat(40),stage_key:"boot",scope:"public",reason:"verify cross-course pipeline trigger is denied"},`${prefix}-pipeline-key`,`${prefix}-pipeline-hash`,`${prefix}-pipeline-trace`));
    await expectError(repository.review(actors.outsider,{run_id:publicRunId,action:"assign",reason:"attempt cross-course review"},`${prefix}-trace`,`${prefix}-key`,`${prefix}-hash`));
    expect((await repository.pendingObject(actors.student,pendingObjectId)).id).toBe(pendingObjectId);
    expect((await repository.objectForDownload(actors.teacher,verifiedObjectId)).object_key).toBe(verifiedObjectId);
  }finally{
    await sql`delete from design_submissions where id=${designId}`;await sql`delete from object_refs where project_id=${projectId}`;await sql`delete from evidence_records where run_id in ${sql([publicRunId,staffRunId])}`;await sql`delete from pipeline_events where run_id in ${sql([publicRunId,staffRunId])}`;await sql`delete from pipeline_runs where id in ${sql([publicRunId,staffRunId])}`;await sql`delete from project_repositories where project_id=${projectId}`;await sql`delete from project_members where project_id in ${sql([projectId,secondProjectId])}`;await sql`delete from projects where id in ${sql([projectId,secondProjectId])}`;await sql`delete from stage_gates where id=${stageId}`;await sql`delete from experiments where id=${experimentId}`;await sql`delete from course_memberships where course_id=${courseId}`;await sql`delete from courses where id=${courseId}`;await sql`delete from users where id in ${sql([teacherId,taId,studentId,otherStudentId,outsiderId])}`;await sql.end({timeout:5});
  }
},30_000);
