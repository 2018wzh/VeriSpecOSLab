import { expect, test } from "bun:test";
import postgres from "postgres";
import { PostgresPortalRepository } from "../server/postgres-repository.ts";

const databaseUrl=process.env.PORTAL_TEST_DATABASE_URL;
const integration=databaseUrl?test:test.skip;

integration("enrollment invites are role-bound, hash-only, auditable, and redemption-idempotent",async()=>{
  const sql=postgres(databaseUrl!,{max:4,prepare:false});
  const prefix=`invite-it-${crypto.randomUUID()}`;
  const courseId=`${prefix}-course`,teacherId=`${prefix}-teacher`,studentId=`${prefix}-student`,outsideId=`${prefix}-outside`;
  const teacher={id:teacherId,username:teacherId,display_name:"Teacher",role:"teacher" as const};
  const student={id:studentId,username:studentId,display_name:"Student",role:"student" as const};
  const outside={id:outsideId,username:outsideId,display_name:"Outside",role:"teacher" as const};
  const previousKey=process.env.VOS_PORTAL_MASTER_KEY;
  process.env.VOS_PORTAL_MASTER_KEY="integration-only-master-key-32-characters";
  try{
    await sql`insert into users(id,username,display_name,role,status) values(${teacherId},${teacherId},'Teacher','teacher','active'),(${studentId},${studentId},'Student','student','active'),(${outsideId},${outsideId},'Outside','teacher','active')`;
    await sql`insert into courses(id,code,name,term,status) values(${courseId},${prefix},'Invite Course','test','active')`;
    await sql`insert into course_memberships(course_id,user_id,role,status,source) values(${courseId},${teacherId},'teacher','active','manual')`;
    const repository=new PostgresPortalRepository(sql);
    const input={course_id:courseId,role:"student" as const,expires_at:new Date(Date.now()+86_400_000).toISOString(),max_uses:2,reason:"invite assigned students into the integration course"};
    const issued=await repository.createEnrollmentInvite(teacher,input,`${prefix}-create-trace`,`${prefix}-create-key`,`${prefix}-create-hash`);
    const replay=await repository.createEnrollmentInvite(teacher,input,`${prefix}-create-replay-trace`,`${prefix}-create-key`,`${prefix}-create-hash`);
    expect(replay.id).toBe(issued.id);expect(replay.code).toBe(issued.code);
    const stored=(await sql`select code_hash from enrollment_invites where id=${issued.id}`)[0];expect(stored.code_hash).not.toBe(issued.code);expect(String(stored.code_hash)).toHaveLength(64);
    expect((await repository.enrollmentInvites(teacher,courseId))[0]).not.toHaveProperty("code");
    await expect(repository.enrollmentInvites(outside,courseId)).rejects.toThrow("无邀请码管理权限");
    const redemption=await repository.redeemEnrollmentInvite(student,{code:issued.code,reason:"join the assigned integration course"},`${prefix}-redeem-trace`,`${prefix}-redeem-key`,`${prefix}-redeem-hash`);
    const replayed=await repository.redeemEnrollmentInvite(student,{code:issued.code,reason:"join the assigned integration course"},`${prefix}-redeem-replay-trace`,`${prefix}-redeem-key-2`,`${prefix}-redeem-hash-2`);
    expect(replayed.redeemed_at).toBe(redemption.redeemed_at);
    expect((await sql`select uses from enrollment_invites where id=${issued.id}`)[0].uses).toBe(1);
    expect((await sql`select role,status,source from course_memberships where course_id=${courseId} and user_id=${studentId}`)[0]).toMatchObject({role:"student",status:"active",source:"invite"});
  }finally{
    await sql`delete from idempotency_keys where actor_id in ${sql([teacherId,studentId,outsideId])}`;
    await sql`delete from audit_events where actor_id in ${sql([teacherId,studentId,outsideId])}`;
    await sql`delete from enrollment_invite_redemptions where user_id=${studentId}`;
    await sql`delete from enrollment_invites where course_id=${courseId}`;
    await sql`delete from course_memberships where course_id=${courseId}`;
    await sql`delete from courses where id=${courseId}`;
    await sql`delete from users where id in ${sql([teacherId,studentId,outsideId])}`;
    await sql.end({timeout:5});
    if(previousKey===undefined)delete process.env.VOS_PORTAL_MASTER_KEY;else process.env.VOS_PORTAL_MASTER_KEY=previousKey;
  }
},30_000);
