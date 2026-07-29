import { expect, test } from "bun:test";
import postgres from "postgres";
import type { CourseManifestV1 } from "vos-core/portal-contracts";
import { PostgresPortalRepository } from "../server/postgres-repository.ts";
import { dispatchCoursePublishedOne } from "../worker/worker.ts";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
async function expectError(operation:Promise<unknown>,message:string):Promise<void>{try{await operation;throw new Error("expected operation to fail");}catch(error){expect(error).toBeInstanceOf(Error);expect((error as Error).message).toContain(message);}}

integration("course manifests publish immutable snapshots, rollback, and import grouped enrollment", async () => {
  const sql = postgres(databaseUrl!, { max: 12, prepare: false });
  const prefix = `course-control-${crypto.randomUUID()}`;
  const teacherId = `${prefix}-teacher`;
  const outsiderId = `${prefix}-outside-teacher`;
  const actor = { id: teacherId, username: teacherId, display_name: "Course Teacher", role: "teacher" as const };
  const outsider = { id: outsiderId, username: outsiderId, display_name: "Outside Teacher", role: "teacher" as const };
  let courseId = "";
  const studentUsernames = [`${prefix}-student-1`, `${prefix}-student-2`];
  const manifest = (specVersion: string): CourseManifestV1 => ({
    version: "course-manifest.v1",
    course: { code: prefix, name: "Course Control Integration", term: "test" },
    experiment: { id: `${prefix}-lab`, title: `Kernel Lab ${specVersion}`, spec_version: specVersion },
    stages: [
      { id: "boot", key: "boot", name: "Boot", sequence: 0, required_artifacts: ["serial.log"], required_evidence: [], manual_review_required: false },
      { id: "memory", key: "memory", name: "Memory", sequence: 1, required_artifacts: [], required_evidence: [{ suite: "memory", case_name: "map", required_result: "pass" }], manual_review_required: true },
    ],
    rubric: [{ id: "correctness", name: "Correctness", weight: 80 }, { id: "design", name: "Design", weight: 20 }],
    ai_policy: { allowed_models: ["school-default"], monthly_budget: 100, allow_byok: false },
  });
  try {
    await sql`insert into users(id,username,display_name,role,status) values(${teacherId},${teacherId},'Course Teacher','teacher','active'),(${outsiderId},${outsiderId},'Outside Teacher','teacher','active')`;
    const repository = new PostgresPortalRepository(sql);
    const dryRun = await repository.dryRunCourseManifest(actor, manifest("v1"));
    expect(dryRun.valid).toBe(true);
    expect(dryRun.next_manifest_version).toBe(1);
    const imported = await Promise.all(Array.from({ length: 4 }, () => repository.importCourseManifest(actor, manifest("v1"), "import initial course manifest", `${prefix}-import-trace`, "course-import-key", "course-import-hash")));
    courseId = imported[0].course_id;
    expect(new Set(imported.map(item => item.manifest_version)).size).toBe(1);
    expect((await repository.publishCourseManifest(actor, courseId, 1, "publish initial teaching version", `${prefix}-publish-1`,`${prefix}-publish-key-1`,`${prefix}-publish-hash-1`)).state).toBe("published");
    expect(Number((await sql`select count(*)::int count from stage_gates sg join experiments e on e.id=sg.experiment_id where e.course_id=${courseId} and e.publish_state='published'`)[0].count)).toBe(2);
    expect(Number((await sql`select count(*)::int count from course_rubric_items where course_id=${courseId} and manifest_version=1`)[0].count)).toBe(2);
    const second = await repository.importCourseManifest(actor, manifest("v2"), "import revised course manifest", `${prefix}-import-2`, "course-import-key-2", "course-import-hash-2");
    expect(second.manifest_version).toBe(2);
    await repository.publishCourseManifest(actor, courseId, 2, "publish revised teaching version", `${prefix}-publish-2`,`${prefix}-publish-key-2`,`${prefix}-publish-hash-2`);
    const rollback = await repository.rollbackCourseManifest(actor, courseId, 1, "restore the first published teaching snapshot", `${prefix}-rollback`,`${prefix}-rollback-key`,`${prefix}-rollback-hash`);
    expect(rollback.manifest_version).toBe(3);
    expect(rollback.rollback_of).toBe(1);
    expect(rollback.state).toBe("published");
    const versions = await repository.courseManifestVersions(actor, courseId);
    expect(versions.map(item => item.state)).toEqual(["published", "superseded", "superseded"]);
    await expectError(repository.courseManifestVersions(outsider,courseId),"无管理权限");
    await expectError(repository.dryRunCourseManifest(outsider,manifest("v3")),"无管理权限");
    await expectError(repository.importCourseManifest(outsider,manifest("v3"),"attempt to import another course manifest",`${prefix}-outside-import`,`${prefix}-outside-key`,`${prefix}-outside-hash`),"无管理权限");
    await expectError(repository.importEnrollmentCsv(outsider,{course_id:courseId,csv:`username,display_name,role\n${studentUsernames[0]},Student One,student\n`,dry_run:true,reason:"attempt to inspect another course enrollment"},`${prefix}-outside-enrollment`,`${prefix}-outside-key`,`${prefix}-outside-hash`),"无管理权限");
    let dispatched=0;while(await dispatchCoursePublishedOne(sql,`${prefix}-worker`))dispatched+=1;expect(dispatched).toBe(3);expect((await sql`select body from notifications where user_id=${teacherId} order by body`).map(row=>String(row.body))).toEqual(["Course Control Integration v1 已发布","Course Control Integration v2 已发布","Course Control Integration v3 已发布"]);expect(Number((await sql`select count(*)::int count from outbox_events where aggregate_id=${courseId} and published_at is not null`)[0].count)).toBe(3);
    const csv = `username,display_name,role,group\n${studentUsernames[0]},\"Student, One\",student,Team A\n${studentUsernames[1]},Student Two,student,Team A\n`;
    const preview = await repository.importEnrollmentCsv(actor, { course_id: courseId, csv, dry_run: true, reason: "preview grouped course enrollment" }, `${prefix}-enrollment-preview`,`${prefix}-preview-key`,`${prefix}-preview-hash`);
    expect(preview).toMatchObject({ accepted: 2, created_users: 0, updated_memberships: 0, issues: [] });
    const applied = await repository.importEnrollmentCsv(actor, { course_id: courseId, csv, dry_run: false, reason: "apply grouped course enrollment" }, `${prefix}-enrollment-apply`,`${prefix}-apply-key`,`${prefix}-apply-hash`);
    expect(applied).toMatchObject({ accepted: 2, created_users: 2, updated_memberships: 2, issues: [] });
    expect(Number((await sql`select count(*)::int count from course_group_members where course_id=${courseId}`)[0].count)).toBe(2);
    await expect(repository.dryRunCourseManifest({ ...actor, id: studentUsernames[0], role: "student" }, manifest("v3"))).rejects.toThrow("teacher access required");
  } finally {
    if (courseId) {
      await sql`delete from notifications where user_id=${teacherId} or user_id in (select user_id from course_memberships where course_id=${courseId})`;
      await sql`delete from course_group_members where course_id=${courseId}`;
      await sql`delete from course_groups where course_id=${courseId}`;
      await sql`delete from course_memberships where course_id=${courseId}`;
      await sql`delete from course_ai_policies where course_id=${courseId}`;
      await sql`delete from course_rubric_items where course_id=${courseId}`;
      await sql`delete from stage_gates where experiment_id in (select id from experiments where course_id=${courseId})`;
      await sql`delete from experiments where course_id=${courseId}`;
      await sql`delete from outbox_events where aggregate_id=${courseId}`;
      await sql`delete from audit_events where resource_id=${courseId} or actor_id in ${sql([teacherId,outsiderId])}`;
      await sql`delete from idempotency_keys where actor_id in ${sql([teacherId,outsiderId])}`;
      await sql`delete from course_manifest_versions where course_id=${courseId}`;
      await sql`delete from courses where id=${courseId}`;
    }
    await sql`delete from users where id in ${sql([teacherId,outsiderId])} or username in ${sql(studentUsernames)}`;
    await sql.end({ timeout: 5 });
  }
}, 30_000);
