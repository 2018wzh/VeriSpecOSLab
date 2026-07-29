import { expect, test } from "bun:test";
import postgres from "postgres";
import { PostgresPortalRepository } from "../server/postgres-repository.ts";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
async function expectError(operation:Promise<unknown>,message:string):Promise<void>{try{await operation;throw new Error("expected operation to fail");}catch(error){expect(error).toBeInstanceOf(Error);expect((error as Error).message).toContain(message);}}

integration("course groups enforce course ownership, revisions, idempotency, and unique membership", async () => {
  const sql = postgres(databaseUrl!, { max: 8, prepare: false });
  const prefix = `course-groups-${crypto.randomUUID()}`;
  const courseId = `${prefix}-course`;
  const teacherId = `${prefix}-teacher`;
  const outsiderId = `${prefix}-outsider`;
  const taId = `${prefix}-ta`;
  const studentIds = [`${prefix}-student-1`, `${prefix}-student-2`, `${prefix}-student-3`];
  const teacher = { id: teacherId, username: teacherId, display_name: "Course Teacher", role: "teacher" as const };
  const outsider = { id: outsiderId, username: outsiderId, display_name: "Outside Teacher", role: "teacher" as const };
  const ta = { id: taId, username: taId, display_name: "Course TA", role: "ta" as const };
  try {
    await sql`insert into users(id,username,display_name,role,status) values
      (${teacherId},${teacherId},'Course Teacher','teacher','active'),
      (${outsiderId},${outsiderId},'Outside Teacher','teacher','active'),
      (${taId},${taId},'Course TA','ta','active'),
      (${studentIds[0]},${studentIds[0]},'Student One','student','active'),
      (${studentIds[1]},${studentIds[1]},'Student Two','student','active'),
      (${studentIds[2]},${studentIds[2]},'Student Three','student','active')`;
    await sql`insert into courses(id,code,name,term,status) values(${courseId},${prefix},'Group Management Integration','test','active')`;
    await sql`insert into course_memberships(course_id,user_id,role,status,source) values
      (${courseId},${teacherId},'teacher','active','manual'),
      (${courseId},${taId},'ta','active','manual'),
      (${courseId},${studentIds[0]},'student','active','manual'),
      (${courseId},${studentIds[1]},'student','active','manual'),
      (${courseId},${studentIds[2]},'student','inactive','manual')`;

    const repository = new PostgresPortalRepository(sql);
    const create = { name: "Team Alpha", member_ids: [studentIds[0]], expected_revision: 0, reason: "create the first audited course group" };
    const created = await repository.createCourseGroup(teacher, courseId, create, `${prefix}-trace-create`, `${prefix}-create`, `${prefix}-create-hash`);
    const replayed = await repository.createCourseGroup(teacher, courseId, create, `${prefix}-trace-replay`, `${prefix}-create`, `${prefix}-create-hash`);
    expect(replayed).toEqual(created);
    expect((await repository.courseGroups(ta, courseId))[0]).toMatchObject({ id: created.id, revision: 1, member_ids: [studentIds[0]] });
    await expectError(repository.courseGroups(outsider, courseId),"无分组查看权限");
    await expectError(repository.createCourseGroup(outsider, courseId, { ...create, name: "Outside" }, `${prefix}-trace-outside`, `${prefix}-outside`, `${prefix}-outside-hash`),"无管理权限");

    const updated = await repository.updateCourseGroup(teacher, courseId, created.id, { name: "Team Alpha Revised", member_ids: [studentIds[0], studentIds[1]], expected_revision: created.revision, reason: "add the second student after teacher review" }, `${prefix}-trace-update`, `${prefix}-update`, `${prefix}-update-hash`);
    expect(updated).toMatchObject({ revision: 2, member_ids: studentIds.slice(0, 2) });
    await expectError(repository.updateCourseGroup(teacher, courseId, created.id, { name: "Stale", member_ids: [studentIds[0]], expected_revision: 1, reason: "attempt a stale optimistic group update" }, `${prefix}-trace-stale`, `${prefix}-stale`, `${prefix}-stale-hash`),"并发更新");
    await expectError(repository.createCourseGroup(teacher, courseId, { name: "Conflicting Team", member_ids: [studentIds[1]], expected_revision: 0, reason: "attempt duplicate course group membership" }, `${prefix}-trace-conflict`, `${prefix}-conflict`, `${prefix}-conflict-hash`),"已属于分组");
    await expectError(repository.createCourseGroup(teacher, courseId, { name: "Inactive Team", member_ids: [studentIds[2]], expected_revision: 0, reason: "attempt adding an inactive course student" }, `${prefix}-trace-inactive`, `${prefix}-inactive`, `${prefix}-inactive-hash`),"活跃学生");
    expect(Number((await sql`select count(*)::int count from audit_events where resource_id=${created.id} and action in ('course.group.create','course.group.update')`)[0].count)).toBe(2);
  } finally {
    await sql`delete from audit_events where actor_id in ${sql([teacherId, outsiderId])}`;
    await sql`delete from idempotency_keys where actor_id in ${sql([teacherId, outsiderId])}`;
    await sql`delete from course_group_members where course_id=${courseId}`;
    await sql`delete from course_groups where course_id=${courseId}`;
    await sql`delete from course_memberships where course_id=${courseId}`;
    await sql`delete from courses where id=${courseId}`;
    await sql`delete from users where id in ${sql([teacherId, outsiderId, taId, ...studentIds])}`;
    await sql.end({ timeout: 5 });
  }
}, 30_000);
