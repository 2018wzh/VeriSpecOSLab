import type { Sql, TransactionSql } from "postgres";
import type {
  AppealRecordV1, AppealSubmitV1, AppealTransitionV1, PortalActor, ScoreAdjustmentInputV1,
  ScoreCalculationV1, ScoreSnapshotV1, ScoreTransitionV1,
} from "vos-core/portal-contracts";
import { AppealSubmitV1Schema, AppealTransitionV1Schema, ScoreAdjustmentInputV1Schema, ScoreCalculationV1Schema, ScoreTransitionV1Schema } from "vos-core/portal-contracts";
import { transitionCourse, transitionProject, type CourseState, type ProjectState } from "../domain/state-machines.ts";
import { assertStaff, assertTeacher } from "../domain/repository.ts";

type Row = Record<string, unknown>;
function id(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function score(value: number): number { return Math.round(value * 100) / 100; }

export class GradingService {
  constructor(private readonly sql: Sql) {}

  async transitionCourseState(actor: PortalActor, courseId: string, target: CourseState, reason: string, traceId: string, idempotencyKey: string, requestHash: string): Promise<CourseState> {
    assertTeacher(actor);
    if (reason.trim().length < 10) throw new Error("课程状态变更理由至少需要 10 个字符");
    return await this.idempotent(actor, idempotencyKey, requestHash, async (tx) => {
      await this.assertCourseTeacher(tx,actor,courseId);
      const rows = await tx`select status from courses where id=${courseId} and deleted_at is null for update`;
      if (!rows[0]) throw new Error("课程不存在");
      const from = String(rows[0].status) as CourseState;
      transitionCourse(from, target);
      await tx`update courses set status=${target}, version=version+1, updated_at=now() where id=${courseId}`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${actor.id},'course.state.transition','course',${courseId},${reason},${traceId},${tx.json({from,to:target})})`;
      return target;
    });
  }

  async calculateScore(actor: PortalActor, raw: ScoreCalculationV1, traceId: string, idempotencyKey: string, requestHash: string): Promise<ScoreSnapshotV1> {
    assertTeacher(actor);
    const input = ScoreCalculationV1Schema.parse(raw);
    return await this.idempotent(actor, idempotencyKey, requestHash, async (tx) => {
      const projects = await tx`select p.status,e.course_id from projects p join experiments e on e.id=p.experiment_id where p.id=${input.project_id} and p.deleted_at is null for update`;
      if (!projects[0]) throw new Error("项目不存在");
      await this.assertProjectCourseRole(tx,actor,input.project_id,"teacher");
      const projectState = String(projects[0].status) as ProjectState;
      if (projectState !== "active") throw new Error("只有 active 项目可以生成自动评分草稿");
      const runs = await tx`select distinct on(stage_key) id,passed,total,status from pipeline_runs where project_id=${input.project_id} and status in ('passed','failed') and total>0 order by stage_key,created_at desc,id desc`;
      if (!runs.length) throw new Error("项目没有可用于评分的已完成运行");
      const total = runs.reduce((sum, row) => sum + Number(row.total), 0);
      const passed = runs.reduce((sum, row) => sum + Number(row.passed), 0);
      const baseline = score(passed / total * 100);
      const snapshotId = id("score");
      await tx`insert into score_snapshots(id,project_id,baseline,final_score,state,evidence_refs,created_by,snapshot_version,transition_reason) values(${snapshotId},${input.project_id},${baseline},${baseline},'draft',${tx.json(runs.map(row=>String(row.id)))},${actor.id},1,${input.reason})`;
      transitionProject(projectState, "frozen");
      await tx`update projects set status='frozen', version=version+1, updated_at=now() where id=${input.project_id}`;
      const courses = await tx`select status from courses where id=${String(projects[0].course_id)} for update`;
      if (courses[0]?.status === "active") {
        transitionCourse("active", "grading");
        await tx`update courses set status='grading',version=version+1,updated_at=now() where id=${String(projects[0].course_id)}`;
      }
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${actor.id},'grade.calculate','score',${snapshotId},${input.reason},${traceId},${tx.json({project_id:input.project_id,baseline,run_ids:runs.map(row=>String(row.id))})})`;
      return await this.snapshot(tx, snapshotId);
    });
  }

  async adjustScore(actor: PortalActor, raw: ScoreAdjustmentInputV1, traceId: string, idempotencyKey: string, requestHash: string): Promise<ScoreSnapshotV1> {
    assertTeacher(actor);
    const input = ScoreAdjustmentInputV1Schema.parse(raw);
    return await this.idempotent(actor, idempotencyKey, requestHash, async (tx) => {
      const previous = await this.latestSnapshot(tx, input.project_id, true);
      await this.assertProjectCourseRole(tx,actor,input.project_id,"teacher");
      if (String(previous.state) !== "draft") throw new Error("只有最新的 draft 成绩快照可以调整");
      const members = await tx`select 1 from project_members where project_id=${input.project_id} and user_id=${input.member_id}`;
      if (!members.length) throw new Error("调整对象不是项目成员");
      await this.assertEvidenceRefs(tx, input.project_id, input.evidence_refs);
      const currentAdjustments = await tx`select * from member_adjustments where score_snapshot_id=${String(previous.id)} order by created_at,id`;
      const nextFinal = score(Number(previous.final_score) + input.delta);
      if (nextFinal < 0 || nextFinal > 100) throw new Error("调整后的成绩必须在 0 到 100 之间");
      const nextId = await this.cloneSnapshot(tx, previous, actor.id, "draft", input.reason);
      await this.copyAdjustments(tx, currentAdjustments, nextId);
      await tx`insert into member_adjustments(id,score_snapshot_id,member_id,delta,reason,evidence_refs,actor_id) values(${id("adjustment")},${nextId},${input.member_id},${input.delta},${input.reason},${tx.json(input.evidence_refs)},${actor.id})`;
      await tx`update score_snapshots set final_score=${nextFinal},evidence_refs=${tx.json([...new Set([...(previous.evidence_refs as string[]),...input.evidence_refs])])} where id=${nextId}`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${actor.id},'grade.adjust','score',${nextId},${input.reason},${traceId},${tx.json({member_id:input.member_id,delta:input.delta,previous_snapshot_id:String(previous.id)})})`;
      return await this.snapshot(tx, nextId);
    });
  }

  async transitionScore(actor: PortalActor, raw: ScoreTransitionV1, traceId: string, idempotencyKey: string, requestHash: string): Promise<ScoreSnapshotV1> {
    assertTeacher(actor);
    const input = ScoreTransitionV1Schema.parse(raw);
    return await this.idempotent(actor, idempotencyKey, requestHash, async (tx) => {
      const rows = await tx`select * from score_snapshots where id=${input.score_snapshot_id} for update`;
      const previous = rows[0] as Row | undefined;
      if (!previous) throw new Error("成绩快照不存在");
      await this.assertProjectCourseRole(tx,actor,String(previous.project_id),"teacher");
      const latest = await this.latestSnapshot(tx, String(previous.project_id), false);
      if (String(latest.id) !== input.score_snapshot_id) throw new Error("只能转换项目最新的成绩快照");
      const expected = input.target_state === "frozen" ? "draft" : "frozen";
      if (String(previous.state) !== expected) throw new Error(`成绩状态不能从 ${String(previous.state)} 转换到 ${input.target_state}`);
      const adjustments = await tx`select * from member_adjustments where score_snapshot_id=${input.score_snapshot_id} order by created_at,id`;
      const nextId = await this.cloneSnapshot(tx, previous, actor.id, input.target_state, input.reason);
      await this.copyAdjustments(tx, adjustments, nextId);
      if (input.target_state === "published") {
        const projects = await tx`select status from projects where id=${String(previous.project_id)} for update`;
        transitionProject(String(projects[0].status) as ProjectState, "graded");
        await tx`update projects set status='graded',version=version+1,updated_at=now() where id=${String(previous.project_id)}`;
        const members = await tx`select user_id from project_members where project_id=${String(previous.project_id)}`;
        for (const member of members) await tx`insert into notifications(id,user_id,title,body) values(${id("notification")},${String(member.user_id)},'成绩已发布',${`项目成绩 ${Number(previous.final_score).toFixed(2)} 已发布，可在申诉窗口开放后提交申诉。`})`;
      }
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${actor.id},${`grade.${input.target_state}`},'score',${nextId},${input.reason},${traceId},${tx.json({previous_snapshot_id:input.score_snapshot_id})})`;
      return await this.snapshot(tx, nextId);
    });
  }

  async submitAppeal(actor: PortalActor, raw: AppealSubmitV1, traceId: string, idempotencyKey: string, requestHash: string): Promise<AppealRecordV1> {
    if (actor.role !== "student") throw new Error("仅学生可以提交申诉");
    const input = AppealSubmitV1Schema.parse(raw);
    return await this.idempotent(actor, idempotencyKey, requestHash, async (tx) => {
      const projects = await tx`select c.status course_status from projects p join experiments e on e.id=p.experiment_id join courses c on c.id=e.course_id join project_members pm on pm.project_id=p.id and pm.user_id=${actor.id} where p.id=${input.project_id} and p.status='graded' and p.deleted_at is null for update`;
      if (!projects[0]) throw new Error("项目未发布成绩或不属于当前学生");
      if (projects[0].course_status !== "appeal") throw new Error("课程申诉窗口尚未开放");
      await this.assertEvidenceRefs(tx, input.project_id, input.evidence_refs);
      const scoreSnapshot = await this.latestSnapshot(tx, input.project_id, false);
      if (scoreSnapshot.state !== "published") throw new Error("项目没有已发布成绩快照");
      const appealId = id("appeal");
      await tx`insert into appeals(id,project_id,member_id,status,statement,evidence_refs,score_snapshot_id) values(${appealId},${input.project_id},${actor.id},'submitted',${input.statement},${tx.json(input.evidence_refs)},${String(scoreSnapshot.id)})`;
      await tx`insert into appeal_events(id,appeal_id,from_status,to_status,actor_id,reason,score_snapshot_id) values(${id("appeal-event")},${appealId},null,'submitted',${actor.id},'student submitted grade appeal',${String(scoreSnapshot.id)})`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${actor.id},'appeal.submit','appeal',${appealId},${input.statement},${traceId},${tx.json({score_snapshot_id:String(scoreSnapshot.id),evidence_refs:input.evidence_refs})})`;
      await tx`insert into outbox_events(id,topic,aggregate_id,payload) values(${id("outbox")},'appeal.submitted',${appealId},${tx.json({appeal_id:appealId,project_id:input.project_id})})`;
      return await this.appeal(tx, appealId);
    });
  }

  async transitionAppeal(actor: PortalActor, raw: AppealTransitionV1, traceId: string, idempotencyKey: string, requestHash: string): Promise<AppealRecordV1> {
    assertStaff(actor);
    const input = AppealTransitionV1Schema.parse(raw);
    return await this.idempotent(actor, idempotencyKey, requestHash, async (tx) => {
      const rows = await tx`select * from appeals where id=${input.appeal_id} for update`;
      const appeal = rows[0] as Row | undefined;
      if (!appeal) throw new Error("申诉不存在");
      await this.assertProjectCourseRole(tx,actor,String(appeal.project_id),input.target_status==="fact_check"?"staff":"teacher");
      const current = String(appeal.status);
      const expected = input.target_status === "fact_check" ? "submitted" : input.target_status === "decision" ? "fact_check" : "decision";
      if (current !== expected) throw new Error(`申诉状态不能从 ${current} 转换到 ${input.target_status}`);
      if (input.target_status !== "fact_check") assertTeacher(actor);
      let resolvedSnapshotId: string | undefined;
      if (input.target_status === "decision") {
        const previous = await this.latestSnapshot(tx, String(appeal.project_id), false);
        if (previous.state !== "published") throw new Error("申诉项目没有最新的已发布成绩");
        const adjustments = await tx`select * from member_adjustments where score_snapshot_id=${String(previous.id)} order by created_at,id`;
        const nextFinal = score(Number(previous.final_score) + (input.score_delta ?? 0));
        if (nextFinal < 0 || nextFinal > 100) throw new Error("申诉裁决后的成绩必须在 0 到 100 之间");
        resolvedSnapshotId = await this.cloneSnapshot(tx, previous, actor.id, "published", input.reason, input.appeal_id);
        await this.copyAdjustments(tx, adjustments, resolvedSnapshotId);
        if (input.score_delta !== undefined && input.score_delta !== 0) await tx`insert into member_adjustments(id,score_snapshot_id,member_id,delta,reason,evidence_refs,actor_id) values(${id("adjustment")},${resolvedSnapshotId},${String(appeal.member_id)},${input.score_delta},${input.decision!},${tx.json([input.appeal_id])},${actor.id})`;
        await tx`update score_snapshots set final_score=${nextFinal},evidence_refs=${tx.json([...new Set([...(previous.evidence_refs as string[]),input.appeal_id])])} where id=${resolvedSnapshotId}`;
      }
      await tx`update appeals set status=${input.target_status},decision=coalesce(${input.decision ?? null},decision),resolved_score_snapshot_id=coalesce(${resolvedSnapshotId ?? null},resolved_score_snapshot_id),updated_at=now() where id=${input.appeal_id}`;
      await tx`insert into appeal_events(id,appeal_id,from_status,to_status,actor_id,reason,decision,score_delta,score_snapshot_id) values(${id("appeal-event")},${input.appeal_id},${current},${input.target_status},${actor.id},${input.reason},${input.decision ?? null},${input.score_delta ?? null},${resolvedSnapshotId ?? null})`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${actor.id},${`appeal.${input.target_status}`},'appeal',${input.appeal_id},${input.reason},${traceId},${tx.json({decision:input.decision,score_delta:input.score_delta,resolved_score_snapshot_id:resolvedSnapshotId})})`;
      if (input.target_status === "decision") await tx`insert into notifications(id,user_id,title,body) values(${id("notification")},${String(appeal.member_id)},'申诉已裁决',${input.decision!})`;
      return await this.appeal(tx, input.appeal_id);
    });
  }

  async appeals(actor: PortalActor, projectId: string): Promise<AppealRecordV1[]> {
    if(actor.role!=="student")await this.assertProjectCourseRole(this.sql,actor,projectId,"staff");
    const rows = actor.role === "student"
      ? await this.sql`select a.id from appeals a join project_members pm on pm.project_id=a.project_id and pm.user_id=${actor.id} where a.project_id=${projectId} and a.member_id=${actor.id} order by a.created_at desc`
      : await this.sql`select id from appeals where project_id=${projectId} order by created_at desc`;
    return await Promise.all(rows.map(row => this.appeal(this.sql, String(row.id))));
  }

  private async assertProjectCourseRole(tx:Sql|TransactionSql,actor:PortalActor,projectId:string,required:"staff"|"teacher"):Promise<void>{const rows=await tx`select p.id,cm.role,cm.status from projects p join experiments e on e.id=p.experiment_id left join course_memberships cm on cm.course_id=e.course_id and cm.user_id=${actor.id} where p.id=${projectId} and p.deleted_at is null`;const row=rows[0] as Row|undefined;if(actor.role==="admin"&&row)return;if(!row||row.status!=="active"||(required==="teacher"?row.role!=="teacher":!["teacher","ta"].includes(String(row.role))))throw new Error("项目不存在或无课程操作权限");}

  private async assertCourseTeacher(tx:Sql|TransactionSql,actor:PortalActor,courseId:string):Promise<void>{const rows=await tx`select c.id,cm.role,cm.status from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${actor.id} where c.id=${courseId} and c.deleted_at is null`;const row=rows[0] as Row|undefined;if(actor.role==="admin"&&row)return;if(!row||row.role!=="teacher"||row.status!=="active")throw new Error("课程不存在或无管理权限");}

  private async idempotent<T>(actor: PortalActor, key: string, requestHash: string, work: (tx: TransactionSql) => Promise<T>): Promise<T> {
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${actor.id}:${key}`}))`;
      const existing = await tx`select request_hash,response from idempotency_keys where actor_id=${actor.id} and key=${key} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash) throw new Error("幂等键已被不同请求使用");
        return existing[0].response as T;
      }
      const response = await work(tx);
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${actor.id},${key},${requestHash},200,${tx.json(response as never)},now()+interval '24 hours')`;
      return response;
    }) as unknown as T;
  }

  private async assertEvidenceRefs(tx: TransactionSql, projectId: string, refs: string[]): Promise<void> {
    for (const ref of refs) {
      const rows = await tx`select 1 from pipeline_runs where id=${ref} and project_id=${projectId} union all select 1 from evidence_records er join pipeline_runs pr on pr.id=er.run_id where er.id=${ref} and pr.project_id=${projectId} union all select 1 from object_refs where id=${ref} and project_id=${projectId} and deleted_at is null limit 1`;
      if (!rows.length) throw new Error(`证据引用不属于项目: ${ref}`);
    }
  }

  private async latestSnapshot(tx: TransactionSql, projectId: string, lock: boolean): Promise<Row> {
    const rows = lock
      ? await tx`select * from score_snapshots where project_id=${projectId} order by snapshot_version desc limit 1 for update`
      : await tx`select * from score_snapshots where project_id=${projectId} order by snapshot_version desc limit 1`;
    if (!rows[0]) throw new Error("项目没有成绩快照");
    return rows[0] as Row;
  }

  private async cloneSnapshot(tx: TransactionSql, previous: Row, actorId: string, state: ScoreSnapshotV1["state"], reason: string, sourceAppealId?: string): Promise<string> {
    const nextId = id("score");
    await tx`insert into score_snapshots(id,project_id,baseline,final_score,state,evidence_refs,created_by,snapshot_version,previous_snapshot_id,transition_reason,source_appeal_id) values(${nextId},${String(previous.project_id)},${Number(previous.baseline)},${Number(previous.final_score)},${state},${tx.json(previous.evidence_refs as string[])},${actorId},${Number(previous.snapshot_version)+1},${String(previous.id)},${reason},${sourceAppealId ?? null})`;
    return nextId;
  }

  private async copyAdjustments(tx: TransactionSql, rows: Row[], snapshotId: string): Promise<void> {
    for (const row of rows) await tx`insert into member_adjustments(id,score_snapshot_id,member_id,delta,reason,evidence_refs,actor_id,created_at) values(${id("adjustment")},${snapshotId},${String(row.member_id)},${Number(row.delta)},${String(row.reason)},${tx.json(row.evidence_refs as string[])},${String(row.actor_id)},${row.created_at as Date})`;
  }

  private async snapshot(tx: Sql | TransactionSql, snapshotId: string): Promise<ScoreSnapshotV1> {
    const rows = await tx`select * from score_snapshots where id=${snapshotId}`;
    const row = rows[0] as Row | undefined;
    if (!row) throw new Error("成绩快照不存在");
    const adjustments = await tx`select member_id,delta,reason,evidence_refs from member_adjustments where score_snapshot_id=${snapshotId} order by created_at,id`;
    return { version:"score-snapshot.v1",id:snapshotId,project_id:String(row.project_id),baseline:Number(row.baseline),adjustments:adjustments.map(item=>({member_id:String(item.member_id),delta:Number(item.delta),reason:String(item.reason),evidence_refs:item.evidence_refs as string[]})),final_score:Number(row.final_score),state:row.state as ScoreSnapshotV1["state"],evidence_refs:row.evidence_refs as string[],snapshot_version:Number(row.snapshot_version),previous_snapshot_id:row.previous_snapshot_id?String(row.previous_snapshot_id):undefined,created_at:new Date(String(row.created_at)).toISOString() };
  }

  private async appeal(tx: Sql | TransactionSql, appealId: string): Promise<AppealRecordV1> {
    const rows = await tx`select * from appeals where id=${appealId}`;
    const row = rows[0] as Row | undefined;
    if (!row) throw new Error("申诉不存在");
    return {version:"appeal.v1",id:appealId,project_id:String(row.project_id),member_id:String(row.member_id),status:row.status as AppealRecordV1["status"],statement:String(row.statement),evidence_refs:row.evidence_refs as string[],score_snapshot_id:String(row.score_snapshot_id),resolved_score_snapshot_id:row.resolved_score_snapshot_id?String(row.resolved_score_snapshot_id):undefined,decision:row.decision?String(row.decision):undefined,created_at:new Date(String(row.created_at)).toISOString(),updated_at:new Date(String(row.updated_at)).toISOString()};
  }
}
