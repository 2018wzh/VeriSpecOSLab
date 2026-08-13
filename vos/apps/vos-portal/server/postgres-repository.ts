import type { Sql, TransactionSql } from "postgres";
import type { AssessmentReviewV1 } from "vos-core/portal-contracts";
import { AssessmentReviewV1Schema } from "vos-core/portal-contracts";
import type {
  AgentAuditV1,
  AppealRecordV1,
  AppealSubmitV1,
  AppealTransitionV1,
  AssessmentSubmissionRequestV1,
  AssessmentSubmissionV1,
  CourseGroupMutationV1,
  CourseGroupV1,
  CourseManifestDryRunV1,
  CourseManifestV1,
  CourseManifestVersionV1,
  CourseOperationsV1,
  DesignReviewInputV1,
  DesignSubmissionInputV1,
  DesignSubmissionV1,
  EnrollmentCsvImportV1,
  EnrollmentImportResultV1,
  EnrollmentInviteCreateV1,
  EnrollmentInviteIssuedV1,
  EnrollmentInviteRedeemV1,
  EnrollmentInviteRedemptionV1,
  EnrollmentInviteSummaryV1,
  EvidenceBundleV1,
  NotificationV1,
  ObjectManifestV1,
  PipelineEventV1,
  PipelineRequestV1,
  PipelineSummaryV1,
  PolicySnapshotV1,
  PortalActor,
  PortalContextV1,
  PortalDashboard,
  RunReproductionV1,
  ProjectBindingV1,
  ProjectProvisionOptionsV1,
  ProjectProvisionRequestV1,
  ProjectProvisionStatusV1,
  QaThreadV1,
  ScoreAdjustmentInputV1,
  ScoreCalculationV1,
  ScoreSnapshotV1,
  ScoreTransitionV1,
  ServiceTokenCreateV1,
  ServiceTokenIssuedV1,
  ServiceTokenSummaryV1,
  StageGate,
} from "vos-core/portal-contracts";
import {
  AssessmentSubmissionRequestV1Schema,
  CourseGroupMutationV1Schema,
  CourseManifestV1Schema,
  DesignReviewInputV1Schema,
  DesignSubmissionInputV1Schema,
  EnrollmentCsvImportV1Schema,
  EnrollmentInviteCreateV1Schema,
  EnrollmentInviteRedeemV1Schema,
  PipelineRequestV1Schema,
  ProjectProvisionRequestV1Schema,
  ServiceTokenCreateV1Schema,
} from "vos-core/portal-contracts";
import type { LoginInput, ReviewInput } from "../domain/repository.ts";
import { assertStaff, assertTeacher } from "../domain/repository.ts";
import { parseEnrollmentCsv } from "../domain/enrollment-csv.ts";
import type { CourseState } from "../domain/state-machines.ts";
import { GradingService } from "./grading-service.ts";
import { reserveModelUsage } from "./model-control.ts";

type Row = Record<string, unknown>;
function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
async function digest(value: string): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}
function serviceTokenValue(actorId: string, idempotencyKey: string): string {
  const key = process.env.VOS_PORTAL_MASTER_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "VOS_PORTAL_MASTER_KEY must contain at least 32 characters",
    );
  const encoded = new Bun.CryptoHasher("sha256", key)
    .update(`service-token:${actorId}:${idempotencyKey}`)
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
  return `voss_${encoded}`;
}
function enrollmentInviteValue(
  actorId: string,
  idempotencyKey: string,
): string {
  const key = process.env.VOS_PORTAL_MASTER_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "VOS_PORTAL_MASTER_KEY must contain at least 32 characters",
    );
  const encoded = new Bun.CryptoHasher("sha256", key)
    .update(`enrollment-invite:${actorId}:${idempotencyKey}`)
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
  return `vosi_${encoded}`;
}
function deviceFlowValue(
  kind: "device-code" | "user-code" | "access-token",
  value: string,
): string {
  const key = process.env.VOS_PORTAL_MASTER_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "VOS_PORTAL_MASTER_KEY must contain at least 32 characters",
    );
  const encoded = new Bun.CryptoHasher("sha256", key)
    .update(`device-flow:${kind}:${value}`)
    .digest(kind === "user-code" ? "hex" : "base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
  return kind === "user-code"
    ? encoded.slice(0, 8).toUpperCase()
    : kind === "access-token"
      ? `vosd_${encoded}`
      : `vosdc_${encoded}`;
}
function webSessionValue(
  kind: "token" | "csrf" | "request",
  actorId: string,
  idempotencyKey: string,
  value = "",
): string {
  const key = process.env.VOS_PORTAL_MASTER_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "VOS_PORTAL_MASTER_KEY must contain at least 32 characters",
    );
  const encoded = new Bun.CryptoHasher("sha256", key)
    .update(`web-session:${kind}:${actorId}:${idempotencyKey}:${value}`)
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
  return kind === "token" ? `vosw_${encoded}` : encoded;
}
function actor(row: Row): PortalActor {
  return {
    id: String(row.id),
    username: String(row.username),
    display_name: String(row.display_name),
    role: row.role as PortalActor["role"],
  };
}

export class PostgresPortalRepository {
  private readonly grading: GradingService;
  constructor(private readonly sql: Sql) {
    this.grading = new GradingService(sql);
  }
  private async idempotent<T>(
    current: PortalActor,
    key: string,
    requestHash: string,
    statusCode: number,
    work: (tx: TransactionSql) => Promise<T>,
  ): Promise<T> {
    const result = await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${key}`}))`;
      const existing =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${key} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return existing[0].response as T;
      }
      const response = await work(tx);
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${key},${requestHash},${statusCode},${tx.json(response as never)},now()+interval '24 hours')`;
      return response;
    });
    return result as T;
  }
  async cachedMutation<T>(
    current: PortalActor,
    key: string,
    requestHash: string,
  ): Promise<T | undefined> {
    const rows = await this
      .sql`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${key} and expires_at>now()`;
    if (!rows[0]) return undefined;
    if (rows[0].request_hash !== requestHash)
      throw new Error("幂等键已被不同请求使用");
    return rows[0].response as T;
  }
  async assertProjectAccess(
    current: PortalActor,
    projectId: string,
    required: "read" | "staff" | "teacher" = "read",
  ): Promise<void> {
    const rows = await this
      .sql`select p.id,pm.user_id project_member,cm.role course_role,cm.status course_status from projects p join experiments e on e.id=p.experiment_id left join project_members pm on pm.project_id=p.id and pm.user_id=${current.id} left join course_memberships cm on cm.course_id=e.course_id and cm.user_id=${current.id} where p.id=${projectId} and p.deleted_at is null`;
    const row = rows[0] as Row | undefined;
    let allowed = false;
    if (row && current.role === "admin") allowed = true;
    else if (row && current.role === "student")
      allowed = required === "read" && Boolean(row.project_member);
    else if (row && row.course_status === "active")
      allowed =
        required === "teacher"
          ? row.course_role === "teacher"
          : ["teacher", "ta"].includes(String(row.course_role));
    if (!allowed) throw new Error("项目不存在或无资源访问权限");
  }
  async assertRunAccess(
    current: PortalActor,
    runId: string,
    required: "read" | "staff" = "read",
  ): Promise<void> {
    const rows = await this
      .sql`select project_id,scope,requested_by from pipeline_runs where id=${runId}`;
    const row = rows[0] as Row | undefined;
    if (!row) throw new Error("运行不存在或无资源访问权限");
    await this.assertProjectAccess(current, String(row.project_id), required);
    if (
      current.role === "student" &&
      row.scope !== "public" &&
      !(row.scope === "final" && String(row.requested_by) === current.id)
    )
      throw new Error("运行不存在或无资源访问权限");
  }
  async assertDesignReviewAccess(
    current: PortalActor,
    submissionId: string,
    required: "staff" | "teacher",
  ): Promise<void> {
    const rows = await this
      .sql`select project_id from design_submissions where id=${submissionId}`;
    if (!rows[0]) throw new Error("设计提交不存在或无资源访问权限");
    await this.assertProjectAccess(
      current,
      String(rows[0].project_id),
      required,
    );
  }
  async assertObjectAccess(
    current: PortalActor,
    objectId: string,
  ): Promise<void> {
    const rows = await this
      .sql`select o.id,pm.user_id project_member,cm.role course_role,cm.status course_status from object_refs o join projects p on p.id=o.project_id join experiments e on e.id=p.experiment_id left join project_members pm on pm.project_id=p.id and pm.user_id=${current.id} left join course_memberships cm on cm.course_id=e.course_id and cm.user_id=${current.id} where o.id=${objectId} and o.deleted_at is null and p.deleted_at is null`;
    const row = rows[0] as Row | undefined;
    const allowed = Boolean(
      row &&
      (current.role === "admin" ||
        (current.role === "student" && row.project_member) ||
        (current.role !== "student" &&
          row.course_status === "active" &&
          ["teacher", "ta"].includes(String(row.course_role)))),
    );
    if (!allowed) throw new Error("对象不存在或无资源访问权限");
  }
  async assertExperimentAccess(
    current: PortalActor,
    experimentId: string,
    required: "staff" | "teacher",
  ): Promise<void> {
    const rows = await this
      .sql`select e.course_id from experiments e join courses c on c.id=e.course_id where e.id=${experimentId} and e.deleted_at is null and c.deleted_at is null`;
    if (!rows[0]) throw new Error("实验版本不存在或无资源访问权限");
    if (current.role === "admin") return;
    const memberships = await this
      .sql`select role from course_memberships where course_id=${String(rows[0].course_id)} and user_id=${current.id} and status='active'`;
    const role = String(memberships[0]?.role ?? "");
    if (
      required === "teacher"
        ? role !== "teacher"
        : !["teacher", "ta"].includes(role)
    )
      throw new Error("实验版本不存在或无资源访问权限");
  }
  async authenticate(
    input: LoginInput,
    idempotencyKey: string,
  ): Promise<{ actor: PortalActor; token: string; csrf: string }> {
    const rows = await this
      .sql`select id, username, display_name, role, password_hash from users where lower(username) = lower(${input.username}) and deleted_at is null and status = 'active' limit 1`;
    const row = rows[0] as Row | undefined;
    if (
      !row?.password_hash ||
      !(await Bun.password.verify(input.password, String(row.password_hash)))
    )
      throw new Error("账号或密码错误");
    const current = actor(row);
    const token = webSessionValue("token", current.id, idempotencyKey);
    const csrf = webSessionValue("csrf", current.id, idempotencyKey);
    const requestHash = webSessionValue(
      "request",
      current.id,
      idempotencyKey,
      input.username.toLowerCase(),
    );
    const cached = await this.cachedMutation<PortalActor>(
      current,
      idempotencyKey,
      requestHash,
    );
    if (cached) {
      if (!(await this.authorizationForToken(token)))
        throw new Error("登录幂等键对应的会话已失效，请重新提交登录");
      return { actor: cached, token, csrf };
    }
    await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      200,
      async (tx) => {
        const sessionId = id("session");
        await tx`insert into sessions (id, user_id, token_hash, csrf_hash, expires_at) values (${sessionId}, ${current.id}, ${await digest(token)}, ${await digest(csrf)}, now() + interval '12 hours')`;
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'auth.local.login','user',${current.id},'local password authentication succeeded',${id("trace")},${tx.json({ username: String(row.username), session_id: sessionId })})`;
        return current;
      },
    );
    return { actor: current, token, csrf };
  }
  async actorForToken(token: string): Promise<PortalActor | null> {
    const rows = await this
      .sql`select u.id, u.username, u.display_name, u.role from sessions s join users u on u.id = s.user_id where s.token_hash = ${await digest(token)} and s.revoked_at is null and s.expires_at > now() and u.deleted_at is null limit 1`;
    return rows[0] ? actor(rows[0] as Row) : null;
  }
  async authorizationForToken(token: string): Promise<{
    actor: PortalActor;
    token_kind: "web" | "cli" | "service";
    scopes: string[];
  } | null> {
    const rows = await this
      .sql`select u.id,u.username,u.display_name,u.role,s.token_kind,s.scopes from sessions s join users u on u.id=s.user_id where s.token_hash=${await digest(token)} and s.revoked_at is null and s.expires_at>now() and u.deleted_at is null and u.status='active' limit 1`;
    const row = rows[0] as Row | undefined;
    return row
      ? {
          actor: actor(row),
          token_kind: row.token_kind as "web" | "cli" | "service",
          scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
        }
      : null;
  }
  async serviceTokens(current: PortalActor): Promise<ServiceTokenSummaryV1[]> {
    if (current.role !== "admin")
      throw new Error("administrator access required");
    const rows = await this
      .sql`select id,label,scopes,expires_at,created_at,revoked_at from sessions where user_id=${current.id} and token_kind='service' order by created_at desc`;
    return rows.map((row) => this.serviceTokenSummary(row as Row));
  }
  async createServiceToken(
    current: PortalActor,
    raw: ServiceTokenCreateV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ServiceTokenIssuedV1> {
    if (current.role !== "admin")
      throw new Error("administrator access required");
    const input = ServiceTokenCreateV1Schema.parse(raw);
    const token = serviceTokenValue(current.id, idempotencyKey);
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return {
          ...(existing[0].response as ServiceTokenSummaryV1),
          version: "service-token-issued.v1",
          token,
        };
      }
      const sessionId = id("service-token");
      const expiresAt = new Date(
        Date.now() + input.expires_in_minutes * 60_000,
      );
      const rows =
        await tx`insert into sessions(id,user_id,token_hash,csrf_hash,expires_at,token_kind,scopes,label,created_by) values(${sessionId},${current.id},${await digest(token)},${await digest(crypto.randomUUID())},${expiresAt},'service',${tx.json(input.scopes)},${input.name},${current.id}) returning *`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'service_token.create','service_token',${sessionId},${input.reason},${traceId},${tx.json({ name: input.name, scopes: input.scopes, expires_at: expiresAt.toISOString() })})`;
      const summary = this.serviceTokenSummary(rows[0] as Row);
      const response: ServiceTokenIssuedV1 = {
        ...summary,
        version: "service-token-issued.v1",
        token,
      };
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},201,${tx.json(summary)},now()+interval '24 hours')`;
      return response;
    });
  }
  async revokeServiceToken(
    current: PortalActor,
    tokenId: string,
    reason: string,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ServiceTokenSummaryV1> {
    if (current.role !== "admin")
      throw new Error("administrator access required");
    if (reason.trim().length < 10)
      throw new Error("撤销理由至少需要 10 个字符");
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      200,
      async (tx) => {
        const rows =
          await tx`update sessions set revoked_at=coalesce(revoked_at,now()) where id=${tokenId} and user_id=${current.id} and token_kind='service' returning *`;
        if (!rows[0]) throw new Error("service token 不存在");
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id) values(${id("audit")},${current.id},'service_token.revoke','service_token',${tokenId},${reason},${traceId})`;
        return this.serviceTokenSummary(rows[0] as Row);
      },
    );
  }
  async verifyCsrf(token: string, csrf: string): Promise<boolean> {
    const rows = await this
      .sql`select 1 from sessions where token_hash = ${await digest(token)} and csrf_hash = ${await digest(csrf)} and revoked_at is null and expires_at > now()`;
    return rows.length > 0;
  }
  async revoke(
    current: PortalActor,
    token: string,
    reason: string,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{ ok: true }> {
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      200,
      async (tx) => {
        const rows =
          await tx`update sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=${await digest(token)} and user_id=${current.id} returning id`;
        if (!rows[0]) throw new Error("会话不存在或不属于当前用户");
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id) values(${id("audit")},${current.id},'auth.session.revoke','session',${String(rows[0].id)},${reason},${traceId})`;
        return { ok: true as const };
      },
    );
  }
  async createDeviceAuthorization(
    clientName: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }> {
    const deviceCode = deviceFlowValue("device-code", idempotencyKey);
    const userCode = deviceFlowValue("user-code", idempotencyKey);
    const requestKeyHash = await digest(idempotencyKey);
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`device:${idempotencyKey}`}))`;
      const existing =
        await tx`select * from device_authorizations where request_key_hash=${requestKeyHash} for update`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        const remaining = Math.floor(
          (new Date(String(existing[0].expires_at)).getTime() - Date.now()) /
            1000,
        );
        if (remaining <= 0)
          throw new Error("设备授权幂等键已过期，请重新发起登录");
        return {
          device_code: deviceCode,
          user_code: String(existing[0].user_code),
          verification_uri: "/device",
          expires_in: remaining,
          interval: Number(existing[0].interval_seconds),
        };
      }
      const deviceId = id("device");
      await tx`insert into device_authorizations(id,device_code_hash,user_code,client_name,status,expires_at,request_key_hash,request_hash) values(${deviceId},${await digest(deviceCode)},${userCode},${clientName},'pending',now()+interval '10 minutes',${requestKeyHash},${requestHash})`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},null,'auth.device.create','device_authorization',${deviceId},'CLI initiated device authorization',${id("trace")},${tx.json({ client_name: clientName })})`;
      return {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: "/device",
        expires_in: 600,
        interval: 5,
      };
    });
  }
  async approveDevice(
    current: PortalActor,
    userCode: string,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{ ok: true }> {
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      200,
      async (tx) => {
        const rows =
          await tx`update device_authorizations set status='approved',user_id=${current.id},approved_at=now() where user_code=${userCode.toUpperCase()} and status='pending' and expires_at>now() returning id`;
        if (!rows.length) throw new Error("设备代码不存在或已过期");
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id) values(${id("audit")},${current.id},'auth.device.approve','device_authorization',${String(rows[0].id)},'user approved CLI device authorization',${traceId})`;
        return { ok: true as const };
      },
    );
  }
  async exchangeDeviceCode(deviceCode: string): Promise<
    | { status: "authorization_pending" | "expired_token" | "access_denied" }
    | {
        status: "approved";
        access_token: string;
        token_type: "Bearer";
        expires_in: number;
      }
  > {
    return await this.sql.begin(async (tx) => {
      const rows =
        await tx`select * from device_authorizations where device_code_hash=${await digest(deviceCode)} for update`;
      const row = rows[0] as Row | undefined;
      if (!row) return { status: "expired_token" as const };
      const token = deviceFlowValue("access-token", deviceCode);
      if (row.status === "consumed" && row.user_id) {
        const sessions =
          await tx`select expires_at from sessions where token_hash=${await digest(token)} and user_id=${String(row.user_id)} and revoked_at is null and expires_at>now()`;
        if (!sessions[0]) return { status: "expired_token" as const };
        return {
          status: "approved" as const,
          access_token: token,
          token_type: "Bearer" as const,
          expires_in: Math.max(
            1,
            Math.floor(
              (new Date(String(sessions[0].expires_at)).getTime() -
                Date.now()) /
                1000,
            ),
          ),
        };
      }
      if (
        new Date(String(row.expires_at)).getTime() <= Date.now() ||
        row.status === "expired"
      ) {
        await tx`update device_authorizations set status='expired' where id=${String(row.id)}`;
        return { status: "expired_token" as const };
      }
      if (row.status === "pending")
        return { status: "authorization_pending" as const };
      if (row.status === "denied") return { status: "access_denied" as const };
      if (row.status !== "approved" || !row.user_id)
        return { status: "expired_token" as const };
      const sessionId = id("session");
      await tx`insert into sessions(id,user_id,token_hash,csrf_hash,expires_at,token_kind,scopes) values(${sessionId},${String(row.user_id)},${await digest(token)},${await digest(crypto.randomUUID())},now()+interval '8 hours','cli',${tx.json(["project:read", "pipeline:write", "evidence:read"])})`;
      await tx`update device_authorizations set status='consumed',consumed_at=now() where id=${String(row.id)}`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${String(row.user_id)},'auth.device.exchange','session',${sessionId},'approved device code exchanged for CLI token',${id("trace")},${tx.json({ device_authorization_id: String(row.id) })})`;
      return {
        status: "approved" as const,
        access_token: token,
        token_type: "Bearer" as const,
        expires_in: 28800,
      };
    });
  }
  async dryRunCourseManifest(
    current: PortalActor,
    raw: unknown,
  ): Promise<CourseManifestDryRunV1> {
    assertTeacher(current);
    const parsed = CourseManifestV1Schema.safeParse(raw);
    if (!parsed.success)
      return {
        version: "course-manifest-dry-run.v1",
        valid: false,
        changes: [],
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
    const manifest = parsed.data;
    const checksum = await digest(JSON.stringify(manifest));
    const courses = await this
      .sql`select c.id from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.code=${manifest.course.code} and c.term=${manifest.course.term} and c.deleted_at is null and (${current.role === "admin"} or (cm.role='teacher' and cm.status='active'))`;
    const courseId = courses[0] ? String(courses[0].id) : undefined;
    if (!courseId && current.role !== "admin") {
      const hidden = await this
        .sql`select 1 from courses where code=${manifest.course.code} and term=${manifest.course.term} and deleted_at is null`;
      if (hidden[0]) throw new Error("课程不存在或无管理权限");
    }
    const versions = courseId
      ? await this
          .sql`select coalesce(max(version),0)+1 next_version from course_manifest_versions where course_id=${courseId}`
      : [];
    return {
      version: "course-manifest-dry-run.v1",
      valid: true,
      course_id: courseId,
      next_manifest_version: Number(versions[0]?.next_version ?? 1),
      checksum,
      changes: [
        courseId
          ? "为现有课程创建新的不可变草稿版本"
          : "创建新课程及首个草稿版本",
        `发布实验 ${manifest.experiment.title} (${manifest.experiment.spec_version})`,
        `配置 ${manifest.stages.length} 个 StageGate、${manifest.rubric.length} 个 rubric 项`,
      ],
      issues: [],
    };
  }
  async importCourseManifest(
    current: PortalActor,
    raw: CourseManifestV1,
    reason: string,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CourseManifestVersionV1> {
    assertTeacher(current);
    const manifest = CourseManifestV1Schema.parse(raw);
    if (reason.trim().length < 10)
      throw new Error("导入理由至少需要 10 个字符");
    const checksum = await digest(JSON.stringify(manifest));
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return existing[0].response as CourseManifestVersionV1;
      }
      let courses =
        await tx`select * from courses where code=${manifest.course.code} and term=${manifest.course.term} and deleted_at is null for update`;
      let courseId: string;
      if (!courses[0]) {
        courseId = id("course");
        await tx`insert into courses(id,code,name,term,status,manifest_version,manifest) values(${courseId},${manifest.course.code},${manifest.course.name},${manifest.course.term},'draft',1,${tx.json({})})`;
        courses = await tx`select * from courses where id=${courseId}`;
      } else {
        courseId = String(courses[0].id);
        const allowed =
          await tx`select 1 from course_memberships where course_id=${courseId} and user_id=${current.id} and role='teacher' and status='active'`;
        if (current.role !== "admin" && !allowed[0])
          throw new Error("课程不存在或无管理权限");
      }
      await tx`insert into course_memberships(course_id,user_id,role,status,source) values(${courseId},${current.id},'teacher','active','manual') on conflict(course_id,user_id) do update set role='teacher',status='active',version=course_memberships.version+1,updated_at=now()`;
      const duplicate =
        await tx`select 1 from course_manifest_versions where course_id=${courseId} and checksum=${checksum}`;
      if (duplicate.length) throw new Error("相同内容的课程清单版本已存在");
      await tx`update course_manifest_versions set state='superseded' where course_id=${courseId} and state='draft'`;
      const next =
        await tx`select coalesce(max(version),0)+1 version from course_manifest_versions where course_id=${courseId}`;
      const version = Number(next[0].version);
      const created =
        await tx`insert into course_manifest_versions(course_id,version,state,manifest,checksum,created_by,reason) values(${courseId},${version},'draft',${tx.json(manifest)},${checksum},${current.id},${reason}) returning *`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'course.manifest.import','course',${courseId},${reason},${traceId},${tx.json({ manifest_version: version, checksum })})`;
      const response = this.courseManifestVersion(created[0] as Row);
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},201,${tx.json(response)},now()+interval '24 hours')`;
      return response;
    });
  }
  async courseManifestVersions(
    current: PortalActor,
    courseId: string,
  ): Promise<CourseManifestVersionV1[]> {
    assertTeacher(current);
    const allowed = await this
      .sql`select c.id from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.id=${courseId} and c.deleted_at is null and (${current.role === "admin"} or (cm.role='teacher' and cm.status='active'))`;
    if (!allowed[0]) throw new Error("课程不存在或无管理权限");
    const rows = await this
      .sql`select * from course_manifest_versions where course_id=${courseId} order by version desc`;
    return rows.map((row) => this.courseManifestVersion(row as Row));
  }
  async publishCourseManifest(
    current: PortalActor,
    courseId: string,
    manifestVersion: number,
    reason: string,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CourseManifestVersionV1> {
    assertTeacher(current);
    if (reason.trim().length < 10)
      throw new Error("发布理由至少需要 10 个字符");
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      200,
      (tx) =>
        this.materializeCourseManifest(
          tx,
          current,
          courseId,
          manifestVersion,
          reason,
          traceId,
          "course.manifest.publish",
        ),
    );
  }
  async rollbackCourseManifest(
    current: PortalActor,
    courseId: string,
    targetVersion: number,
    reason: string,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CourseManifestVersionV1> {
    assertTeacher(current);
    if (reason.trim().length < 10)
      throw new Error("回滚理由至少需要 10 个字符");
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      200,
      async (tx) => {
        const courses =
          await tx`select c.id from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.id=${courseId} and c.status in ('published','active') and c.deleted_at is null and (${current.role === "admin"} or (cm.role='teacher' and cm.status='active')) for update of c`;
        if (!courses.length)
          throw new Error("课程当前状态不允许回滚或无管理权限");
        const target =
          await tx`select manifest from course_manifest_versions where course_id=${courseId} and version=${targetVersion} and state='superseded'`;
        if (!target[0]) throw new Error("目标历史版本不存在或不能回滚");
        const manifest = CourseManifestV1Schema.parse(target[0].manifest);
        const checksum = await digest(JSON.stringify(manifest));
        await tx`update course_manifest_versions set state='superseded' where course_id=${courseId} and state='draft'`;
        const next =
          await tx`select coalesce(max(version),0)+1 version from course_manifest_versions where course_id=${courseId}`;
        const version = Number(next[0].version);
        await tx`insert into course_manifest_versions(course_id,version,state,manifest,checksum,rollback_of,created_by,reason) values(${courseId},${version},'draft',${tx.json(manifest)},${checksum},${targetVersion},${current.id},${reason})`;
        return await this.materializeCourseManifest(
          tx,
          current,
          courseId,
          version,
          reason,
          traceId,
          "course.manifest.rollback",
        );
      },
    );
  }
  async importEnrollmentCsv(
    current: PortalActor,
    raw: EnrollmentCsvImportV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<EnrollmentImportResultV1> {
    assertTeacher(current);
    const input = EnrollmentCsvImportV1Schema.parse(raw);
    const allowed = await this
      .sql`select c.id from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.id=${input.course_id} and c.status in ('draft','published','active') and c.deleted_at is null and (${current.role === "admin"} or (cm.role='teacher' and cm.status='active'))`;
    if (!allowed[0])
      throw new Error("课程不存在、当前状态不能导入成员或无管理权限");
    const parsed = parseEnrollmentCsv(input.csv);
    const base = {
      version: "enrollment-import-result.v1" as const,
      course_id: input.course_id,
      dry_run: input.dry_run,
      accepted: parsed.rows.length,
      created_users: 0,
      updated_memberships: 0,
      issues: parsed.issues,
    };
    if (parsed.issues.length || input.dry_run) return base;
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      200,
      async (tx) => {
        const courses =
          await tx`select c.id from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.id=${input.course_id} and c.status in ('draft','published','active') and c.deleted_at is null and (${current.role === "admin"} or (cm.role='teacher' and cm.status='active')) for update of c`;
        if (!courses.length)
          throw new Error("课程不存在、当前状态不能导入成员或无管理权限");
        let createdUsers = 0;
        let updatedMemberships = 0;
        const groups = new Map<string, string>();
        for (const row of parsed.rows) {
          let users =
            await tx`select id,role from users where lower(username)=lower(${row.username}) and deleted_at is null for update`;
          let userId: string;
          if (!users[0]) {
            userId = id("user");
            await tx`insert into users(id,username,display_name,role,status) values(${userId},${row.username},${row.display_name},${row.role},'active')`;
            createdUsers += 1;
          } else {
            userId = String(users[0].id);
            const globalRole = String(users[0].role);
            if (globalRole !== row.role && globalRole !== "admin")
              throw new Error(`成员 ${row.username} 的全局角色与 CSV 冲突`);
          }
          await tx`insert into course_memberships(course_id,user_id,role,status,source) values(${input.course_id},${userId},${row.role},'active','csv') on conflict(course_id,user_id) do update set role=excluded.role,status='active',source='csv',version=course_memberships.version+1,updated_at=now()`;
          updatedMemberships += 1;
          if (row.group) {
            let groupId = groups.get(row.group);
            if (!groupId) {
              const existing =
                await tx`select id from course_groups where course_id=${input.course_id} and name=${row.group}`;
              groupId = existing[0] ? String(existing[0].id) : id("group");
              if (!existing[0])
                await tx`insert into course_groups(id,course_id,name) values(${groupId},${input.course_id},${row.group})`;
              groups.set(row.group, groupId);
            }
            await tx`insert into course_group_members(group_id,course_id,user_id) values(${groupId},${input.course_id},${userId}) on conflict(course_id,user_id) do update set group_id=excluded.group_id`;
          }
        }
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'course.enrollment.import','course',${input.course_id},${input.reason},${traceId},${tx.json({ accepted: parsed.rows.length, created_users: createdUsers, updated_memberships: updatedMemberships })})`;
        return {
          ...base,
          created_users: createdUsers,
          updated_memberships: updatedMemberships,
        };
      },
    );
  }
  async enrollmentInvites(
    current: PortalActor,
    courseId: string,
  ): Promise<EnrollmentInviteSummaryV1[]> {
    assertTeacher(current);
    const allowed = await this
      .sql`select c.id from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.id=${courseId} and c.deleted_at is null and (${current.role === "admin"} or (cm.role='teacher' and cm.status='active'))`;
    if (!allowed[0]) throw new Error("课程不存在或无邀请码管理权限");
    const rows = await this
      .sql`select * from enrollment_invites where course_id=${courseId} order by created_at desc,id`;
    return rows.map((row) => this.enrollmentInvite(row as Row));
  }
  async createEnrollmentInvite(
    current: PortalActor,
    raw: EnrollmentInviteCreateV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<EnrollmentInviteIssuedV1> {
    assertTeacher(current);
    const input = EnrollmentInviteCreateV1Schema.parse(raw);
    const expiresAt = new Date(input.expires_at);
    const lifetime = expiresAt.getTime() - Date.now();
    if (lifetime < 5 * 60_000 || lifetime > 180 * 24 * 60 * 60_000)
      throw new Error("邀请码有效期必须在 5 分钟到 180 天之间");
    const code = enrollmentInviteValue(current.id, idempotencyKey);
    const codeHash = await digest(code);
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return {
          ...(existing[0].response as EnrollmentInviteSummaryV1),
          version: "enrollment-invite-issued.v1",
          code,
        };
      }
      const courses =
        await tx`select c.id from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.id=${input.course_id} and c.status in ('draft','published','active') and c.deleted_at is null and (${current.role === "admin"} or (cm.role='teacher' and cm.status='active')) for update of c`;
      if (!courses[0])
        throw new Error("课程不存在、当前状态不能创建邀请码或无管理权限");
      const inviteId = id("invite");
      const rows =
        await tx`insert into enrollment_invites(id,course_id,code_hash,role,expires_at,max_uses,created_by) values(${inviteId},${input.course_id},${codeHash},${input.role},${expiresAt},${input.max_uses},${current.id}) returning *`;
      const summary = this.enrollmentInvite(rows[0] as Row);
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'course.enrollment.invite.create','enrollment_invite',${inviteId},${input.reason},${traceId},${tx.json({ course_id: input.course_id, role: input.role, expires_at: input.expires_at, max_uses: input.max_uses })})`;
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},201,${tx.json(summary)},now()+interval '24 hours')`;
      return { ...summary, version: "enrollment-invite-issued.v1", code };
    });
  }
  async redeemEnrollmentInvite(
    current: PortalActor,
    raw: EnrollmentInviteRedeemV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<EnrollmentInviteRedemptionV1> {
    const input = EnrollmentInviteRedeemV1Schema.parse(raw);
    if (current.role !== "student" && current.role !== "ta")
      throw new Error("只有学生或助教账户可以兑换课程邀请码");
    const codeHash = await digest(input.code);
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const cached =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (cached[0]) {
        if (cached[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return cached[0].response as EnrollmentInviteRedemptionV1;
      }
      const rows =
        await tx`select ei.* from enrollment_invites ei join courses c on c.id=ei.course_id where ei.code_hash=${codeHash} and c.status in ('published','active') and c.deleted_at is null for update of ei`;
      const invite = rows[0] as Row | undefined;
      if (
        !invite ||
        invite.revoked_at ||
        new Date(String(invite.expires_at)).getTime() <= Date.now() ||
        Number(invite.uses) >= Number(invite.max_uses)
      )
        throw new Error("邀请码不存在、已失效或已用尽");
      if (invite.role !== current.role)
        throw new Error("邀请码角色与当前账户角色不一致");
      const previous =
        await tx`select redeemed_at from enrollment_invite_redemptions where invite_id=${String(invite.id)} and user_id=${current.id}`;
      let redeemedAt: Date;
      if (previous[0]) redeemedAt = new Date(String(previous[0].redeemed_at));
      else {
        const memberships =
          await tx`select role,status from course_memberships where course_id=${String(invite.course_id)} and user_id=${current.id} for update`;
        if (memberships[0] && memberships[0].role !== invite.role)
          throw new Error("当前账户已以其他角色加入该课程");
        if (memberships[0])
          await tx`update course_memberships set status='active',source='invite',version=version+1,updated_at=now() where course_id=${String(invite.course_id)} and user_id=${current.id}`;
        else
          await tx`insert into course_memberships(course_id,user_id,role,status,source) values(${String(invite.course_id)},${current.id},${String(invite.role)},'active','invite')`;
        const redeemed =
          await tx`insert into enrollment_invite_redemptions(invite_id,user_id) values(${String(invite.id)},${current.id}) returning redeemed_at`;
        redeemedAt = new Date(String(redeemed[0].redeemed_at));
        await tx`update enrollment_invites set uses=uses+1,version=version+1 where id=${String(invite.id)}`;
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'course.enrollment.invite.redeem','enrollment_invite',${String(invite.id)},${input.reason},${traceId},${tx.json({ course_id: String(invite.course_id), role: String(invite.role) })})`;
      }
      const response: EnrollmentInviteRedemptionV1 = {
        version: "enrollment-invite-redemption.v1",
        invite_id: String(invite.id),
        course_id: String(invite.course_id),
        user_id: current.id,
        role: invite.role as EnrollmentInviteRedemptionV1["role"],
        redeemed_at: redeemedAt.toISOString(),
      };
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},200,${tx.json(response)},now()+interval '24 hours')`;
      return response;
    });
  }
  async courseGroups(
    current: PortalActor,
    courseId: string,
  ): Promise<CourseGroupV1[]> {
    assertStaff(current);
    const allowed = await this
      .sql`select c.id from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.id=${courseId} and c.deleted_at is null and (${current.role === "admin"} or cm.role in ('teacher','ta')) and (${current.role === "admin"} or cm.status='active')`;
    if (!allowed[0]) throw new Error("课程不存在或无分组查看权限");
    const rows = await this
      .sql`select cg.*,coalesce(array_agg(cgm.user_id order by cgm.user_id) filter(where cgm.user_id is not null),'{}'::text[]) member_ids from course_groups cg left join course_group_members cgm on cgm.group_id=cg.id where cg.course_id=${courseId} group by cg.id order by cg.name,cg.id`;
    return rows.map((row) => this.courseGroup(row as Row));
  }
  async createCourseGroup(
    current: PortalActor,
    courseId: string,
    raw: CourseGroupMutationV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CourseGroupV1> {
    const input = CourseGroupMutationV1Schema.parse(raw);
    if (input.expected_revision !== 0)
      throw new Error("新建分组的 expected_revision 必须为 0");
    return await this.mutateCourseGroup(
      current,
      courseId,
      undefined,
      input,
      traceId,
      idempotencyKey,
      requestHash,
    );
  }
  async updateCourseGroup(
    current: PortalActor,
    courseId: string,
    groupId: string,
    raw: CourseGroupMutationV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CourseGroupV1> {
    const input = CourseGroupMutationV1Schema.parse(raw);
    if (input.expected_revision < 1)
      throw new Error("更新分组必须提供当前 revision");
    return await this.mutateCourseGroup(
      current,
      courseId,
      groupId,
      input,
      traceId,
      idempotencyKey,
      requestHash,
    );
  }
  async createProject(
    current: PortalActor,
    raw: ProjectProvisionRequestV1,
    idempotencyKey: string,
    requestHash: string,
    traceId: string,
  ): Promise<ProjectProvisionStatusV1> {
    assertTeacher(current);
    const input = ProjectProvisionRequestV1Schema.parse(raw);
    await this.assertExperimentAccess(current, input.experiment_id, "teacher");
    if (new Set(input.member_ids).size !== input.member_ids.length)
      throw new Error("项目成员不能重复");
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return existing[0].response as ProjectProvisionStatusV1;
      }
      const experiments =
        await tx`select e.id,e.course_id,e.spec_version,sg.id first_stage_id from experiments e join courses c on c.id=e.course_id left join course_memberships staff on staff.course_id=c.id and staff.user_id=${current.id} join lateral(select id from stage_gates where experiment_id=e.id and deleted_at is null order by sequence limit 1) sg on true where e.id=${input.experiment_id} and e.publish_state='published' and e.deleted_at is null and c.status in ('published','active') and c.deleted_at is null and (${current.role === "admin"} or (staff.role='teacher' and staff.status='active'))`;
      if (!experiments[0]) throw new Error("实验版本未发布或课程不可创建项目");
      const members =
        await tx`select u.id from users u join course_memberships cm on cm.user_id=u.id and cm.course_id=${String(experiments[0].course_id)} where u.id in ${tx(input.member_ids)} and u.status='active' and u.deleted_at is null and cm.status='active' and cm.role='student'`;
      if (members.length !== input.member_ids.length)
        throw new Error("项目成员必须是该课程的活跃学生");
      const projectId = id("project");
      const policyRef = `policy-${String(experiments[0].spec_version)}-${crypto.randomUUID()}`;
      await tx`insert into projects(id,experiment_id,current_stage_id,repo_url,status,policy_snapshot_ref) values(${projectId},${input.experiment_id},${String(experiments[0].first_stage_id)},null,'provisioning',${policyRef})`;
      for (const memberId of input.member_ids.toSorted())
        await tx`insert into project_members(project_id,user_id) values(${projectId},${memberId})`;
      await tx`insert into project_repositories(project_id,provider,owner_name,repository_name,template_owner,template_repository,description,is_private,status) values(${projectId},'gitea',${input.owner},${input.repository},${input.template_owner},${input.template_repository},${input.description},true,'queued')`;
      await tx`insert into outbox_events(id,topic,aggregate_id,payload) values(${id("outbox")},'project.provision.requested',${projectId},${tx.json({ project_id: projectId })})`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'project.create','project',${projectId},${input.reason},${traceId},${tx.json({ experiment_id: input.experiment_id, member_ids: input.member_ids, repository: `${input.owner}/${input.repository}` })})`;
      const response = this.provisionStatusRow({
        project_id: projectId,
        status: "queued",
        owner_name: input.owner,
        repository_name: input.repository,
        attempts: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},202,${tx.json(response)},now()+interval '24 hours')`;
      return response;
    });
  }
  async projectProvisionOptions(
    current: PortalActor,
  ): Promise<ProjectProvisionOptionsV1> {
    assertTeacher(current);
    const [experiments, members] = await Promise.all([
      this
        .sql`select e.id,e.course_id,e.title,e.spec_version from experiments e join courses c on c.id=e.course_id left join course_memberships staff on staff.course_id=c.id and staff.user_id=${current.id} where e.publish_state='published' and e.deleted_at is null and c.status in ('published','active') and c.deleted_at is null and (${current.role === "admin"} or (staff.role='teacher' and staff.status='active')) order by c.code,e.title`,
      this
        .sql`select u.id,cm.course_id,u.username,u.display_name from course_memberships cm join users u on u.id=cm.user_id left join course_memberships staff on staff.course_id=cm.course_id and staff.user_id=${current.id} where cm.role='student' and cm.status='active' and u.status='active' and u.deleted_at is null and (${current.role === "admin"} or (staff.role='teacher' and staff.status='active')) order by cm.course_id,u.username`,
    ]);
    return {
      version: "project-provision-options.v1",
      experiments: experiments.map((row) => ({
        id: String(row.id),
        course_id: String(row.course_id),
        title: String(row.title),
        spec_version: String(row.spec_version),
      })),
      members: members.map((row) => ({
        id: String(row.id),
        course_id: String(row.course_id),
        username: String(row.username),
        display_name: String(row.display_name),
      })),
    };
  }
  async projectProvisioning(
    current: PortalActor,
    projectId: string,
  ): Promise<ProjectProvisionStatusV1> {
    await this.assertProjectAccess(current, projectId, "read");
    const rows = await this
      .sql`select pr.* from project_repositories pr where pr.project_id=${projectId} limit 1`;
    if (!rows[0]) throw new Error("项目供应记录不存在或不可见");
    const status = this.provisionStatusRow(rows[0] as Row);
    if (current.role === "student" && status.last_error)
      status.last_error = "仓库供应失败，请联系课程团队";
    return status;
  }
  async retryProjectProvisioning(
    current: PortalActor,
    projectId: string,
    reason: string,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ProjectProvisionStatusV1> {
    assertTeacher(current);
    await this.assertProjectAccess(current, projectId, "teacher");
    if (reason.trim().length < 10)
      throw new Error("重试理由至少需要 10 个字符");
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return existing[0].response as ProjectProvisionStatusV1;
      }
      const rows =
        await tx`update project_repositories set status='queued',last_error=null,updated_at=now() where project_id=${projectId} and status='failed' returning *`;
      if (!rows[0]) throw new Error("只有失败的供应任务可以重试");
      const reset =
        await tx`update outbox_events set next_attempt_at=now(),lease_owner=null,leased_until=null,last_error=null where topic='project.provision.requested' and aggregate_id=${projectId} and published_at is null returning id`;
      if (!reset.length)
        await tx`insert into outbox_events(id,topic,aggregate_id,payload) values(${id("outbox")},'project.provision.requested',${projectId},${tx.json({ project_id: projectId })})`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id) values(${id("audit")},${current.id},'project.provision.retry','project',${projectId},${reason},${traceId})`;
      const response = this.provisionStatusRow(rows[0] as Row);
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},202,${tx.json(response)},now()+interval '24 hours')`;
      return response;
    });
  }
  async projectBinding(
    current: PortalActor,
    projectId: string,
  ): Promise<ProjectBindingV1> {
    await this.assertProjectAccess(current, projectId, "read");
    const rows = await this
      .sql`select p.*,e.course_id,e.id experiment_id,sg.key stage_key,sg.name stage_name,sg.sequence stage_sequence,sg.status stage_status,sg.config stage_config from projects p join experiments e on e.id=p.experiment_id join stage_gates sg on sg.id=p.current_stage_id where p.id=${projectId} and p.repo_url is not null and p.status in ('active','frozen','graded','archived') and p.deleted_at is null limit 1`;
    const row = rows[0] as Row | undefined;
    if (!row) throw new Error("项目不存在、尚未供应完成或不可见");
    const members = await this
      .sql`select user_id from project_members where project_id=${projectId} order by user_id`;
    const config = row.stage_config as {
      required_artifacts?: string[];
      required_evidence?: StageGate["required_evidence"];
      manual_review_required?: boolean;
    };
    return {
      version: "project-binding.v1",
      project_id: projectId,
      course_id: String(row.course_id),
      experiment_id: String(row.experiment_id),
      repo_url: String(row.repo_url),
      member_ids: members.map((item) => String(item.user_id)),
      current_stage: {
        id: String(row.current_stage_id),
        key: String(row.stage_key),
        name: String(row.stage_name),
        sequence: Number(row.stage_sequence),
        status: row.stage_status as StageGate["status"],
        required_artifacts: config.required_artifacts ?? [],
        required_evidence: config.required_evidence ?? [],
        manual_review_required: config.manual_review_required ?? false,
      },
      policy_snapshot_ref: String(row.policy_snapshot_ref),
    };
  }
  async projectPolicy(
    current: PortalActor,
    projectId: string,
  ): Promise<PolicySnapshotV1> {
    const binding = await this.projectBinding(current, projectId);
    return {
      version: "policy-snapshot.v1",
      ref: binding.policy_snapshot_ref,
      project_id: projectId,
      user_id: current.id,
      stage_key: binding.current_stage.key,
      allowed_commands: [
        "stage show",
        "spec lint",
        "arch lint",
        "build",
        "run qemu",
        "test",
        "verify public",
        "pipeline trigger",
        "pipeline status",
        "pipeline watch",
        "pipeline evidence",
        "pipeline cancel",
        "pipeline submit",
      ],
      allowed_paths: ["spec", "src", "kernel", "user", "tests", ".vos"],
      visibility:
        current.role === "student"
          ? ["public", "student"]
          : ["public", "student", "staff"],
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
  }
  async objectManifest(
    current: PortalActor,
    projectId: string,
  ): Promise<ObjectManifestV1> {
    await this.projectBinding(current, projectId);
    const allowed =
      current.role === "student"
        ? ["public", "student"]
        : ["public", "student", "staff"];
    const rows = await this
      .sql`select * from object_refs where project_id=${projectId} and visibility in ${this.sql(allowed)} and upload_status='verified' and deleted_at is null order by created_at`;
    return {
      version: "object-manifest.v1",
      project_id: projectId,
      objects: rows.map((row) => ({
        id: String(row.id),
        uri: String(row.uri),
        sha256: String(row.sha256),
        size_bytes: Number(row.size_bytes),
        content_type: String(row.content_type),
        visibility: row.visibility as "public" | "student" | "staff",
        label: String(row.label),
      })),
    };
  }
  async registerObject(
    current: PortalActor,
    input: {
      project_id: string;
      run_id?: string;
      object_id: string;
      object_key: string;
      uri: string;
      sha256: string;
      size_bytes: number;
      content_type: string;
      visibility: "public" | "student" | "staff";
      label: string;
      lineage: Record<string, unknown>;
    },
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{ object_id: string; object_key: string }> {
    await this.projectBinding(current, input.project_id);
    if (current.role === "student" && input.visibility === "staff")
      throw new Error("学生不能创建 staff 可见对象");
    if (input.run_id) {
      const rows = await this
        .sql`select 1 from pipeline_runs where id=${input.run_id} and project_id=${input.project_id}`;
      if (!rows.length) throw new Error("运行不属于指定项目");
    }
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      201,
      async (tx) => {
        await tx`insert into object_refs(id,project_id,run_id,uri,object_key,sha256,size_bytes,content_type,visibility,label,upload_status,lineage) values(${input.object_id},${input.project_id},${input.run_id ?? null},${input.uri},${input.object_key},${input.sha256},${input.size_bytes},${input.content_type},${input.visibility},${input.label},'pending',${tx.json(input.lineage as never)})`;
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'object.upload.request','object',${input.object_id},'authorized object upload requested',${traceId},${tx.json({ project_id: input.project_id, run_id: input.run_id ?? null, sha256: input.sha256, size_bytes: input.size_bytes, content_type: input.content_type, visibility: input.visibility, label: input.label })})`;
        return { object_id: input.object_id, object_key: input.object_key };
      },
    );
  }
  async pendingObject(
    current: PortalActor,
    objectId: string,
  ): Promise<{
    id: string;
    object_key: string;
    sha256: string;
    size_bytes: number;
    content_type: string;
  }> {
    await this.assertObjectAccess(current, objectId);
    const rows = await this
      .sql`select o.* from object_refs o where o.id=${objectId} and o.upload_status='pending' and o.deleted_at is null limit 1`;
    const row = rows[0] as Row | undefined;
    if (!row?.object_key) throw new Error("待确认对象不存在或不可见");
    return {
      id: String(row.id),
      object_key: String(row.object_key),
      sha256: String(row.sha256),
      size_bytes: Number(row.size_bytes),
      content_type: String(row.content_type),
    };
  }
  async completeObject(
    current: PortalActor,
    objectId: string,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<{ ok: true; object_id: string }> {
    await this.assertObjectAccess(current, objectId);
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      200,
      async (tx) => {
        const rows =
          await tx`update object_refs set upload_status='verified' where id=${objectId} and upload_status='pending' and deleted_at is null returning id,project_id,run_id,sha256,size_bytes`;
        if (!rows.length) throw new Error("对象状态已变化或权限不足");
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'object.upload.complete','object',${objectId},'uploaded object checksum and metadata verified',${traceId},${tx.json({ project_id: String(rows[0].project_id), run_id: rows[0].run_id ?? null, sha256: String(rows[0].sha256), size_bytes: Number(rows[0].size_bytes) })})`;
        return { ok: true as const, object_id: objectId };
      },
    );
  }
  async objectForDownload(
    current: PortalActor,
    objectId: string,
  ): Promise<{ object_key: string; sha256: string }> {
    await this.assertObjectAccess(current, objectId);
    const allowed =
      current.role === "student"
        ? ["public", "student"]
        : ["public", "student", "staff"];
    const rows = await this
      .sql`select object_key,sha256 from object_refs where id=${objectId} and visibility in ${this.sql(allowed)} and upload_status='verified' and deleted_at is null limit 1`;
    const row = rows[0] as Row | undefined;
    if (!row?.object_key) throw new Error("对象不存在或不可见");
    return { object_key: String(row.object_key), sha256: String(row.sha256) };
  }
  async recordGiteaWebhook(
    input: {
      delivery_id: string;
      event_type: "push";
      repository_full_name: string;
      ref_name: string;
      before_sha?: string;
      after_sha: string;
      pusher_username?: string;
      payload: Record<string, unknown>;
    },
    traceId: string,
  ): Promise<boolean> {
    return await this.sql.begin(async (tx) => {
      const inserted =
        await tx`insert into gitea_webhook_deliveries(delivery_id,event_type,repository_full_name,payload) values(${input.delivery_id},${input.event_type},${input.repository_full_name},${tx.json(input.payload as never)}) on conflict do nothing returning delivery_id`;
      if (!inserted.length) return false;
      const repositories =
        await tx`select pr.project_id from project_repositories pr join projects p on p.id=pr.project_id where pr.provider='gitea' and pr.owner_name||'/'||pr.repository_name=${input.repository_full_name} and pr.status='active' and p.status in ('active','frozen')`;
      if (repositories.length !== 1)
        throw new Error(
          "Gitea push repository is not bound to exactly one active project",
        );
      const projectId = String(repositories[0].project_id);
      await tx`insert into project_commit_ledger(id,project_id,delivery_id,ref_name,before_sha,after_sha,pusher_username) values(${id("commit")},${projectId},${input.delivery_id},${input.ref_name},${input.before_sha ?? null},${input.after_sha},${input.pusher_username ?? null})`;
      const notificationPrefix = id("notification");
      await tx`insert into notifications(id,user_id,title,body) select ${notificationPrefix}||'-'||user_id,user_id,'仓库收到新的 push',${`${input.ref_name} 已更新到 ${input.after_sha.slice(0, 12)}`} from project_members where project_id=${projectId}`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},null,'gitea.push.receive','project',${projectId},'signed Gitea push webhook',${traceId},${tx.json({ delivery_id: input.delivery_id, ref_name: input.ref_name, after_sha: input.after_sha, pusher_username: input.pusher_username ?? null })})`;
      return true;
    });
  }
  async contexts(current: PortalActor): Promise<PortalContextV1[]> {
    const rows =
      current.role === "student"
        ? await this
            .sql`select p.id project_id,p.status project_status,e.id experiment_id,c.id course_id,c.code,c.name,c.term,sg.key stage_key,sg.name stage_name from projects p join experiments e on e.id=p.experiment_id join courses c on c.id=e.course_id join stage_gates sg on sg.id=p.current_stage_id join project_members pm on pm.project_id=p.id where pm.user_id=${current.id} and p.deleted_at is null and e.deleted_at is null and c.deleted_at is null order by c.term desc,c.code,p.created_at,p.id`
        : current.role === "admin"
          ? await this
              .sql`select p.id project_id,p.status project_status,e.id experiment_id,c.id course_id,c.code,c.name,c.term,sg.key stage_key,sg.name stage_name from projects p join experiments e on e.id=p.experiment_id join courses c on c.id=e.course_id join stage_gates sg on sg.id=p.current_stage_id where p.deleted_at is null and e.deleted_at is null and c.deleted_at is null order by c.term desc,c.code,p.created_at,p.id`
          : await this
              .sql`select p.id project_id,p.status project_status,e.id experiment_id,c.id course_id,c.code,c.name,c.term,sg.key stage_key,sg.name stage_name from projects p join experiments e on e.id=p.experiment_id join courses c on c.id=e.course_id join stage_gates sg on sg.id=p.current_stage_id join course_memberships cm on cm.course_id=e.course_id and cm.user_id=${current.id} where cm.role in ('teacher','ta') and cm.status='active' and p.deleted_at is null and e.deleted_at is null and c.deleted_at is null order by c.term desc,c.code,p.created_at,p.id`;
    return rows.map((row) => ({
      version: "portal-context.v1",
      course: {
        id: String(row.course_id),
        code: String(row.code),
        name: String(row.name),
        term: String(row.term),
      },
      project: {
        id: String(row.project_id),
        status: row.project_status as PortalContextV1["project"]["status"],
        experiment_id: String(row.experiment_id),
        stage_key: String(row.stage_key),
        stage_name: String(row.stage_name),
      },
    }));
  }
  async dashboard(
    current: PortalActor,
    projectId?: string,
  ): Promise<PortalDashboard> {
    const selectedProjectId =
      projectId ?? (await this.contexts(current))[0]?.project.id;
    if (!selectedProjectId) throw new Error("当前用户没有可访问的项目");
    await this.assertProjectAccess(current, selectedProjectId, "read");
    const projectRows = await this
      .sql`select p.*,e.course_id,e.id experiment_id from projects p join experiments e on e.id=p.experiment_id where p.id=${selectedProjectId} and p.deleted_at is null and e.deleted_at is null`;
    const project = projectRows[0] as Row | undefined;
    if (!project) throw new Error("当前用户没有可访问的项目");
    const [courses, stagesRows, members, runsRows, scores, notifications] =
      await Promise.all([
        this
          .sql`select id, code, name, term, status from courses where id=${String(project.course_id)}`,
        this
          .sql`select * from stage_gates where experiment_id=${String(project.experiment_id)} and deleted_at is null order by sequence`,
        this
          .sql`select user_id from project_members where project_id=${String(project.id)} order by user_id`,
        this
          .sql`select * from pipeline_runs where project_id=${String(project.id)} and (${current.role !== "student"} or scope='public') order by created_at desc limit 20`,
        this
          .sql`select * from score_snapshots where project_id=${String(project.id)} order by snapshot_version desc limit 1`,
        this
          .sql`select * from notifications where user_id=${current.id} order by created_at desc limit 20`,
      ]);
    const stageMap = (row: Row): StageGate => {
      const config = row.config as {
        required_artifacts?: string[];
        required_evidence?: StageGate["required_evidence"];
        manual_review_required?: boolean;
      };
      return {
        id: String(row.id),
        key: String(row.key),
        name: String(row.name),
        sequence: Number(row.sequence),
        status: row.status as StageGate["status"],
        required_artifacts: config.required_artifacts ?? [],
        required_evidence: config.required_evidence ?? [],
        manual_review_required: config.manual_review_required ?? false,
      };
    };
    const stages = stagesRows.map((row) => stageMap(row as Row));
    const currentStage =
      stages.find((item) => item.id === project.current_stage_id) ?? stages[0];
    const runs = runsRows.map((row) => this.run(row as Row));
    const scoreRow = scores[0] as Row | undefined;
    const adjustments = scoreRow
      ? current.role === "student"
        ? await this
            .sql`select member_id,delta,reason,evidence_refs from member_adjustments where score_snapshot_id=${String(scoreRow.id)} and member_id=${current.id} order by created_at,id`
        : await this
            .sql`select member_id,delta,reason,evidence_refs from member_adjustments where score_snapshot_id=${String(scoreRow.id)} order by created_at,id`
      : [];
    return {
      actor: current,
      course: courses[0] as PortalDashboard["course"],
      project: {
        version: "project-binding.v1",
        project_id: String(project.id),
        course_id: String(project.course_id),
        experiment_id: String(project.experiment_id),
        repo_url: String(project.repo_url),
        member_ids: members.map((row) => String(row.user_id)),
        current_stage: currentStage,
        policy_snapshot_ref: String(project.policy_snapshot_ref),
      },
      stages,
      runs,
      score: scoreRow
        ? {
            version: "score-snapshot.v1",
            id: String(scoreRow.id),
            project_id: String(project.id),
            baseline: Number(scoreRow.baseline),
            adjustments: adjustments.map((row) => ({
              member_id: String(row.member_id),
              delta: Number(row.delta),
              reason: String(row.reason),
              evidence_refs: row.evidence_refs as string[],
            })),
            final_score: Number(scoreRow.final_score),
            state: scoreRow.state as ScoreSnapshotV1["state"],
            evidence_refs: scoreRow.evidence_refs as string[],
            snapshot_version: Number(scoreRow.snapshot_version),
            previous_snapshot_id: scoreRow.previous_snapshot_id
              ? String(scoreRow.previous_snapshot_id)
              : undefined,
            created_at: new Date(String(scoreRow.created_at)).toISOString(),
          }
        : {
            version: "score-snapshot.v1",
            id: "score-none",
            project_id: String(project.id),
            baseline: 0,
            adjustments: [],
            final_score: 0,
            state: "draft",
            evidence_refs: [],
            snapshot_version: 0,
            created_at: new Date().toISOString(),
          },
      notifications: notifications.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        body: String(row.body),
        read: Boolean(row.read_at),
        created_at: new Date(String(row.created_at)).toISOString(),
      })),
    };
  }
  async setNotificationRead(
    current: PortalActor,
    notificationId: string,
    read: boolean,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<NotificationV1> {
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      200,
      async (tx) => {
        const rows =
          await tx`update notifications set read_at=${read ? tx`coalesce(read_at,now())` : null} where id=${notificationId} and user_id=${current.id} returning *`;
        const row = rows[0] as Row | undefined;
        if (!row) throw new Error("通知不存在或不属于当前用户");
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'notification.read_state','notification',${notificationId},'user changed notification read state',${traceId},${tx.json({ read })})`;
        return {
          id: String(row.id),
          title: String(row.title),
          body: String(row.body),
          read: Boolean(row.read_at),
          created_at: new Date(String(row.created_at)).toISOString(),
        };
      },
    );
  }
  async courseOperations(
    current: PortalActor,
    courseId: string,
  ): Promise<CourseOperationsV1> {
    assertStaff(current);
    const allowed = await this
      .sql`select c.id from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.id=${courseId} and c.deleted_at is null and (${current.role === "admin"} or cm.role in ('teacher','ta'))`;
    if (!allowed[0]) throw new Error("课程不存在或无运营权限");
    const rows = await this
      .sql`select p.id project_id,p.status,sg.key stage_key,sg.name stage_name,coalesce((select jsonb_agg(u.display_name order by u.display_name,u.id) from project_members pm join users u on u.id=pm.user_id where pm.project_id=p.id),'[]'::jsonb) member_names,(select pr.status from pipeline_runs pr where pr.project_id=p.id order by pr.created_at desc,pr.id desc limit 1) latest_run_status,(select ss.state from score_snapshots ss where ss.project_id=p.id order by ss.snapshot_version desc limit 1) score_state,(select ss.final_score from score_snapshots ss where ss.project_id=p.id order by ss.snapshot_version desc limit 1) final_score,(select count(*)::int from pipeline_runs pr where pr.project_id=p.id and pr.status='failed') failed_runs,(select count(*)::int from appeals a where a.project_id=p.id and a.status<>'closed') open_appeals,(select ds.status from design_submissions ds where ds.project_id=p.id and ds.stage_gate_id=p.current_stage_id order by ds.revision desc limit 1) design_status from projects p join experiments e on e.id=p.experiment_id join stage_gates sg on sg.id=p.current_stage_id where e.course_id=${courseId} and p.deleted_at is null order by sg.sequence,p.id`;
    return {
      version: "course-operations.v1",
      course_id: courseId,
      generated_at: new Date().toISOString(),
      projects: rows.map((row) => ({
        project_id: String(row.project_id),
        status: row.status as CourseOperationsV1["projects"][number]["status"],
        stage_key: String(row.stage_key),
        stage_name: String(row.stage_name),
        member_names: (row.member_names as string[]) ?? [],
        latest_run_status:
          row.latest_run_status as CourseOperationsV1["projects"][number]["latest_run_status"],
        score_state:
          row.score_state as CourseOperationsV1["projects"][number]["score_state"],
        final_score:
          row.final_score === null || row.final_score === undefined
            ? undefined
            : Number(row.final_score),
        failed_runs: Number(row.failed_runs),
        open_appeals: Number(row.open_appeals),
        design_status:
          row.design_status as CourseOperationsV1["projects"][number]["design_status"],
      })),
    };
  }
  async designSubmissions(
    current: PortalActor,
    projectId: string,
  ): Promise<DesignSubmissionV1[]> {
    await this.assertProjectAccess(current, projectId, "read");
    const rows = await this
      .sql`select ds.*,sg.key stage_key from design_submissions ds join stage_gates sg on sg.id=ds.stage_gate_id where ds.project_id=${projectId} order by sg.sequence,ds.revision desc`;
    return rows.map((row) => this.designSubmission(row as Row));
  }
  async submitDesign(
    current: PortalActor,
    raw: DesignSubmissionInputV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<DesignSubmissionV1> {
    const input = DesignSubmissionInputV1Schema.parse(raw);
    await this.assertProjectAccess(current, input.project_id, "read");
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return existing[0].response as DesignSubmissionV1;
      }
      const projects =
        await tx`select p.id,p.current_stage_id,sg.id stage_gate_id,sg.key stage_key from projects p join stage_gates sg on sg.experiment_id=p.experiment_id and sg.key=${input.stage_key} left join project_members pm on pm.project_id=p.id and pm.user_id=${current.id} where p.id=${input.project_id} and p.status='active' and p.current_stage_id=sg.id and (${current.role !== "student"} or pm.user_id is not null) for update of p`;
      if (!projects[0]) throw new Error("项目不在可提交的当前阶段或权限不足");
      const commits =
        await tx`select id from project_commit_ledger where project_id=${input.project_id} and after_sha=${input.commit_sha} limit 1`;
      if (!commits[0])
        throw new Error("设计提交 commit 不在项目 commit ledger 中");
      const latest =
        await tx`select status,revision from design_submissions where project_id=${input.project_id} and stage_gate_id=${String(projects[0].stage_gate_id)} order by revision desc limit 1 for update`;
      if (
        latest[0] &&
        !["changes_requested"].includes(String(latest[0].status))
      )
        throw new Error("当前设计提交尚未要求修改或已经通过，不能创建新修订");
      const submissionId = id("design");
      const revision = Number(latest[0]?.revision ?? 0) + 1;
      const inserted =
        await tx`insert into design_submissions(id,project_id,stage_gate_id,commit_sha,revision,title,summary,invariants,interfaces,evidence_refs,status,submitted_by) values(${submissionId},${input.project_id},${String(projects[0].stage_gate_id)},${input.commit_sha},${revision},${input.title},${input.summary},${tx.json(input.invariants)},${tx.json(input.interfaces)},${tx.json(input.evidence_refs)},'submitted',${current.id}) returning *,${input.stage_key}::text stage_key`;
      await tx`insert into design_submission_events(id,submission_id,actor_id,to_status,reason,trace_id) values(${id("design-event")},${submissionId},${current.id},'submitted',${input.reason},${traceId})`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'design.submit','design_submission',${submissionId},${input.reason},${traceId},${tx.json({ project_id: input.project_id, stage_key: input.stage_key, commit_sha: input.commit_sha, revision })})`;
      const response = this.designSubmission(inserted[0] as Row);
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},201,${tx.json(response)},now()+interval '24 hours')`;
      return response;
    });
  }
  async reviewDesign(
    current: PortalActor,
    raw: DesignReviewInputV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<DesignSubmissionV1> {
    assertStaff(current);
    const input = DesignReviewInputV1Schema.parse(raw);
    if (input.target_status === "frozen") assertTeacher(current);
    await this.assertDesignReviewAccess(
      current,
      input.submission_id,
      input.target_status === "frozen" ? "teacher" : "staff",
    );
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return existing[0].response as DesignSubmissionV1;
      }
      const rows =
        await tx`select ds.*,sg.key stage_key from design_submissions ds join stage_gates sg on sg.id=ds.stage_gate_id where ds.id=${input.submission_id} for update`;
      const row = rows[0] as Row | undefined;
      if (!row) throw new Error("设计提交不存在");
      const from = String(row.status);
      const allowed: Record<string, string[]> = {
        submitted: ["review", "changes_requested"],
        review: ["passed", "changes_requested"],
        passed: ["frozen"],
      };
      if (!allowed[from]?.includes(input.target_status))
        throw new Error(
          `设计提交状态不能从 ${from} 转换到 ${input.target_status}`,
        );
      const updated =
        await tx`update design_submissions set status=${input.target_status},reviewed_by=${current.id},review_feedback=${input.feedback},version=version+1,updated_at=now() where id=${input.submission_id} and version=${Number(row.version)} returning *,${String(row.stage_key)}::text stage_key`;
      if (!updated[0]) throw new Error("设计提交已被并发更新");
      await tx`insert into design_submission_events(id,submission_id,actor_id,from_status,to_status,reason,feedback,trace_id) values(${id("design-event")},${input.submission_id},${current.id},${from},${input.target_status},${input.reason},${input.feedback},${traceId})`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'design.review','design_submission',${input.submission_id},${input.reason},${traceId},${tx.json({ from_status: from, to_status: input.target_status })})`;
      const notificationPrefix = id("notification");
      await tx`insert into notifications(id,user_id,title,body) select ${notificationPrefix}||'-'||user_id,user_id,'设计提交状态已更新',${`${String(row.title)}：${input.feedback}`} from project_members where project_id=${String(row.project_id)}`;
      const response = this.designSubmission(updated[0] as Row);
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},200,${tx.json(response)},now()+interval '24 hours')`;
      return response;
    });
  }
  async evidence(
    current: PortalActor,
    runId: string,
  ): Promise<EvidenceBundleV1> {
    await this.assertRunAccess(current, runId, "read");
    const runs = await this
      .sql`select pr.* from pipeline_runs pr join projects p on p.id=pr.project_id left join project_members pm on pm.project_id=p.id and pm.user_id=${current.id} where pr.id=${runId} and (${current.role !== "student"} or (pm.user_id is not null and (pr.scope='public' or (pr.scope='final' and pr.requested_by=${current.id}))))`;
    if (!runs[0]) throw new Error("运行不存在或不可见");
    const run = this.run(runs[0] as Row);
    const allowed =
      current.role === "student"
        ? ["public", "student"]
        : ["public", "student", "staff"];
    const [records, objects] = await Promise.all([
      this
        .sql`select * from evidence_records where run_id=${runId} and visibility in ${this.sql(allowed)} order by suite, case_name`,
      this
        .sql`select * from object_refs where run_id=${runId} and visibility in ${this.sql(allowed)} and upload_status='verified' and deleted_at is null order by created_at`,
    ]);
    return {
      version: "evidence-bundle.v1",
      run,
      evidence: records.map((row) => ({
        id: String(row.id),
        run_id: runId,
        suite: String(row.suite),
        case_name: String(row.case_name),
        result: row.result as "pass" | "fail" | "error" | "skipped",
        visibility: row.visibility as "public" | "student" | "staff",
        metrics: row.metrics as Record<string, unknown>,
        public_message: row.public_message
          ? String(row.public_message)
          : undefined,
        artifact_ids: [],
      })),
      artifacts: objects.map((row) => ({
        id: String(row.id),
        uri: String(row.uri),
        sha256: String(row.sha256),
        size_bytes: Number(row.size_bytes),
        content_type: String(row.content_type),
        visibility: row.visibility as "public" | "student" | "staff",
        label: String(row.label),
      })),
    };
  }
  async trigger(
    current: PortalActor,
    input: PipelineRequestV1,
    idempotencyKey: string,
    requestHash: string,
    traceId: string,
  ): Promise<PipelineSummaryV1> {
    const parsed = PipelineRequestV1Schema.parse(input);
    if (parsed.scope !== "public" || parsed.retry_of) assertStaff(current);
    await this.assertProjectAccess(
      current,
      parsed.project_id,
      parsed.scope === "public" && !parsed.retry_of ? "read" : "staff",
    );
    const project = await this
      .sql`select p.id, p.policy_snapshot_ref from projects p left join project_members pm on pm.project_id=p.id and pm.user_id=${current.id} where p.id=${parsed.project_id} and p.status='active' and (${current.role !== "student"} or pm.user_id is not null)`;
    if (!project[0]) throw new Error("项目不可提交或权限不足");
    const runId = id("run");
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return existing[0].response as PipelineSummaryV1;
      }
      if (parsed.retry_of) {
        const originals =
          await tx`select id from pipeline_runs where id=${parsed.retry_of} and project_id=${parsed.project_id} and commit_sha=${parsed.commit_sha} and stage_key=${parsed.stage_key} and status in ('failed','cancelled','timed_out') for update`;
        if (!originals[0])
          throw new Error("补跑来源不存在、不属于同一提交阶段或不允许补跑");
      }
      if (parsed.model_credential_id) {
        const credentials =
          await tx`select mc.id from model_credentials mc join projects p on p.id=${parsed.project_id} join experiments e on e.id=p.experiment_id join courses c on c.id=e.course_id join course_ai_policies cap on cap.course_id=c.id and cap.manifest_version=c.published_manifest_version where mc.id=${parsed.model_credential_id} and mc.owner_id=${current.id} and mc.revoked_at is null and p.status='active' and c.status in ('published','active','grading','appeal') and (cap.policy->>'allow_byok')::boolean=true and cap.policy->'allowed_models' ? mc.provider`;
        if (!credentials[0])
          throw new Error("模型凭据不存在、无权使用或不符合当前课程策略");
      }
      await tx`insert into pipeline_runs (id,project_id,commit_sha,stage_key,scope,status,retry_of,policy_snapshot_ref,requested_by,reason,model_credential_id) values (${runId},${parsed.project_id},${parsed.commit_sha},${parsed.stage_key},${parsed.scope},'queued',${parsed.retry_of ?? null},${String(project[0].policy_snapshot_ref)},${current.id},${parsed.reason},${parsed.model_credential_id ?? null})`;
      await tx`insert into pipeline_events(run_id,sequence,event_type,visibility,payload) values(${runId},0,'queued','student',${tx.json({ message: "运行已进入队列", model_credential_attached: Boolean(parsed.model_credential_id) })})`;
      await tx`insert into outbox_events (id,topic,aggregate_id,payload) values (${id("outbox")},'pipeline.queued',${runId},${tx.json({ run_id: runId })})`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'pipeline.trigger','pipeline',${runId},${parsed.reason},${traceId},${tx.json({ project_id: parsed.project_id, commit_sha: parsed.commit_sha, stage_key: parsed.stage_key, scope: parsed.scope, retry_of: parsed.retry_of ?? null, model_credential_id: parsed.model_credential_id ?? null })})`;
      const rows = await tx`select * from pipeline_runs where id=${runId}`;
      const response = this.run(rows[0] as Row);
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},202,${tx.json(response)},now()+interval '24 hours')`;
      return response;
    });
  }
  async pipeline(
    current: PortalActor,
    runId: string,
  ): Promise<PipelineSummaryV1> {
    await this.assertRunAccess(current, runId, "read");
    const rows = await this
      .sql`select pr.* from pipeline_runs pr where pr.id=${runId}`;
    if (!rows[0]) throw new Error("运行不存在或不可见");
    return this.run(rows[0] as Row);
  }
  async createAssessmentSubmission(
    current: PortalActor,
    raw: AssessmentSubmissionRequestV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<AssessmentSubmissionV1> {
    const input = AssessmentSubmissionRequestV1Schema.parse(raw);
    if (current.role !== "student")
      throw new Error("权威课程提交只能由项目学生创建");
    await this.assertProjectAccess(current, input.project_id, "read");
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      202,
      async (tx) => {
        const projects =
          await tx`select p.id,p.policy_snapshot_ref,p.current_stage_id,sg.key stage_key from projects p join stage_gates sg on sg.id=p.current_stage_id join project_members pm on pm.project_id=p.id and pm.user_id=${current.id} where p.id=${input.project_id} and p.status='active' and sg.key=${input.stage_key} for update of p`;
        const project = projects[0] as Row | undefined;
        if (!project) throw new Error("项目不在可提交的当前阶段或权限不足");
        const commits =
          await tx`select id from project_commit_ledger where project_id=${input.project_id} and after_sha=${input.commit_sha} limit 1`;
        if (!commits[0])
          throw new Error("提交 commit 不在绑定项目的 Gitea commit ledger 中");
        const existing =
          await tx`select * from assessment_submissions where project_id=${input.project_id} and commit_sha=${input.commit_sha} and stage_key=${input.stage_key} and manifest_hash=${input.manifest_hash} for update`;
        if (existing[0]) {
          const row = existing[0] as Row;
          if (
            String(row.spec_hash) !== input.spec_hash ||
            String(row.config_hash) !== input.config_hash ||
            String(row.policy_snapshot_ref) !==
              String(project.policy_snapshot_ref)
          )
            throw new Error("相同提交的权威课程提交输入与当前策略不一致");
          return this.assessmentSubmissionRow(row);
        }
        const submissionId = id("submission");
        const runId = id("run");
        await tx`insert into pipeline_runs(id,project_id,commit_sha,stage_key,scope,status,policy_snapshot_ref,requested_by,reason) values(${runId},${input.project_id},${input.commit_sha},${input.stage_key},'final','queued',${String(project.policy_snapshot_ref)},${current.id},${input.reason})`;
        await tx`insert into assessment_submissions(id,project_id,run_id,commit_sha,stage_key,spec_hash,config_hash,manifest_hash,policy_snapshot_ref,status,submitted_by) values(${submissionId},${input.project_id},${runId},${input.commit_sha},${input.stage_key},${input.spec_hash},${input.config_hash},${input.manifest_hash},${String(project.policy_snapshot_ref)},'queued',${current.id})`;
        await tx`insert into pipeline_events(run_id,sequence,event_type,visibility,payload) values(${runId},0,'queued','student',${tx.json({ message: "权威课程提交已进入测评队列", submission_id: submissionId })})`;
        await tx`insert into outbox_events(id,topic,aggregate_id,payload) values(${id("outbox")},'pipeline.queued',${runId},${tx.json({ run_id: runId, submission_id: submissionId })})`;
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'assessment.submit','assessment_submission',${submissionId},${input.reason},${traceId},${tx.json({ project_id: input.project_id, run_id: runId, stage_key: input.stage_key, commit_sha: input.commit_sha, spec_hash: input.spec_hash, config_hash: input.config_hash, manifest_hash: input.manifest_hash, policy_snapshot_ref: String(project.policy_snapshot_ref) })})`;
        const rows =
          await tx`select * from assessment_submissions where id=${submissionId}`;
        return this.assessmentSubmissionRow(rows[0] as Row);
      },
    );
  }
  async assessmentSubmission(
    current: PortalActor,
    submissionId: string,
  ): Promise<AssessmentSubmissionV1> {
    const rows = await this
      .sql`select * from assessment_submissions where id=${submissionId}`;
    const row = rows[0] as Row | undefined;
    if (!row) throw new Error("权威课程提交不存在或不可见");
    await this.assertProjectAccess(current, String(row.project_id), "read");
    return this.assessmentSubmissionRow(row);
  }
  async reviewAssessmentSubmission(
    current: PortalActor,
    raw: AssessmentReviewV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<AssessmentSubmissionV1> {
    assertTeacher(current);
    const input = AssessmentReviewV1Schema.parse(raw);
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      200,
      async (tx) => {
        const rows =
          await tx`select a.*,sg.config from assessment_submissions a join projects p on p.id=a.project_id join stage_gates sg on sg.id=p.current_stage_id join experiments e on e.id=p.experiment_id left join course_memberships cm on cm.course_id=e.course_id and cm.user_id=${current.id} where a.id=${input.submission_id} and a.status='candidate' and (${current.role === "admin"} or (cm.role='teacher' and cm.status='active')) for update of a`;
        const row = rows[0] as Row | undefined;
        if (!row) throw new Error("候选提交不存在、状态已变化或无教师权限");
        if (input.decision === "approve") {
          const required =
            (
              row.config as {
                required_evidence?: Array<{
                  suite: string;
                  case_name: string;
                  required_result: string;
                }>;
              }
            ).required_evidence ?? [];
          const evidence =
            await tx`select suite,case_name,result from evidence_records where run_id=${String(row.run_id)}`;
          for (const item of required)
            if (
              !evidence.some(
                (record) =>
                  record.suite === item.suite &&
                  record.case_name === item.case_name &&
                  record.result === item.required_result,
              )
            )
              throw new Error(
                `人工门禁缺少证据 ${item.suite}/${item.case_name}:${item.required_result}`,
              );
          await tx`update assessment_submissions set status='complete',completed_at=now() where id=${input.submission_id}`;
          const next =
            await tx`select next.id from projects p join stage_gates current on current.id=p.current_stage_id join stage_gates next on next.experiment_id=p.experiment_id and next.sequence=current.sequence+1 where p.id=${String(row.project_id)}`;
          if (next[0]) {
            await tx`update stage_gates set status='open',version=version+1 where id=${String(next[0].id)} and status='locked'`;
            await tx`update projects set current_stage_id=${String(next[0].id)},version=version+1,updated_at=now() where id=${String(row.project_id)}`;
          }
        } else
          await tx`update assessment_submissions set status='failed',completed_at=now() where id=${input.submission_id}`;
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},${`assessment.review.${input.decision}`},'assessment_submission',${input.submission_id},${input.reason},${traceId},${tx.json({ run_id: String(row.run_id), project_id: String(row.project_id) })})`;
        const updated =
          await tx`select * from assessment_submissions where id=${input.submission_id}`;
        return this.assessmentSubmissionRow(updated[0] as Row);
      },
    );
  }
  async reproduction(
    current: PortalActor,
    runId: string,
  ): Promise<RunReproductionV1> {
    await this.pipeline(current, runId);
    const runs = await this.sql`select * from pipeline_runs where id=${runId}`;
    const run = runs[0] as Row;
    const allowed =
      current.role === "student"
        ? ["public", "student"]
        : ["public", "student", "staff"];
    const artifacts = await this
      .sql`select id,sha256,size_bytes,label from object_refs where run_id=${runId} and visibility in ${this.sql(allowed)} and upload_status='verified' and deleted_at is null order by created_at,id`;
    const audits = await this
      .sql`select payload from audit_events where resource_type='pipeline' and resource_id=${runId} and action='runner.complete' order by created_at desc limit 1`;
    const payload = (audits[0]?.payload ?? {}) as Record<string, unknown>;
    return {
      version: "run-reproduction.v1",
      run_id: runId,
      project_id: String(run.project_id),
      commit_sha: String(run.commit_sha),
      stage_key: String(run.stage_key),
      scope: run.scope as RunReproductionV1["scope"],
      policy_snapshot_ref: String(run.policy_snapshot_ref),
      command: {
        program: "vos",
        arguments: ["verify", run.scope === "public" ? "public" : "full"],
      },
      runner_image_id:
        typeof payload.runner_image_id === "string"
          ? payload.runner_image_id
          : undefined,
      artifacts: artifacts.map((row) => ({
        id: String(row.id),
        sha256: String(row.sha256),
        size_bytes: Number(row.size_bytes),
        label: String(row.label),
      })),
      created_at: new Date(String(run.created_at)).toISOString(),
      finished_at: run.finished_at
        ? new Date(String(run.finished_at)).toISOString()
        : undefined,
    };
  }
  async pipelineEvents(
    current: PortalActor,
    runId: string,
    after: number,
  ): Promise<PipelineEventV1[]> {
    await this.pipeline(current, runId);
    const allowed =
      current.role === "student"
        ? ["public", "student"]
        : ["public", "student", "staff"];
    const rows = await this
      .sql`select * from pipeline_events where run_id=${runId} and sequence>${after} and visibility in ${this.sql(allowed)} order by sequence limit 200`;
    return rows.map((row) => ({
      version: "pipeline-event.v1",
      run_id: runId,
      sequence: Number(row.sequence),
      type: row.event_type as PipelineEventV1["type"],
      visibility: row.visibility as PipelineEventV1["visibility"],
      occurred_at: new Date(String(row.occurred_at)).toISOString(),
      payload: row.payload as Record<string, unknown>,
    }));
  }
  async cancelPipeline(
    current: PortalActor,
    runId: string,
    reason: string,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PipelineSummaryV1> {
    if (reason.trim().length < 10)
      throw new Error("取消理由至少需要 10 个字符");
    await this.pipeline(current, runId);
    return await this.idempotent(
      current,
      idempotencyKey,
      requestHash,
      202,
      async (tx) => {
        const rows =
          await tx`update pipeline_runs set status='cancelled',finished_at=now(),public_message='运行已取消' where id=${runId} and status in ('queued','leased','running') returning *`;
        if (!rows[0]) throw new Error("运行已结束，不能取消");
        await tx`update assessment_submissions set status='failed',completed_at=now() where run_id=${runId} and status in ('queued','evaluating')`;
        const seq =
          await tx`select coalesce(max(sequence),-1)+1 sequence from pipeline_events where run_id=${runId}`;
        await tx`insert into pipeline_events(run_id,sequence,event_type,visibility,payload) values(${runId},${Number(seq[0].sequence)},'finished','student',${tx.json({ status: "cancelled" })})`;
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id) values(${id("audit")},${current.id},'pipeline.cancel','pipeline',${runId},${reason},${traceId})`;
        return this.run(rows[0] as Row);
      },
    );
  }
  async review(
    current: PortalActor,
    input: ReviewInput,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<void> {
    assertStaff(current);
    if (input.reason.trim().length < 10)
      throw new Error("操作理由至少需要 10 个字符");
    await this.assertRunAccess(current, input.run_id, "staff");
    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing =
        await tx`select request_hash from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return;
      }
      const rows =
        await tx`select * from pipeline_runs where id=${input.run_id} for update`;
      const run = rows[0] as Row | undefined;
      if (
        !run ||
        !["passed", "failed", "cancelled", "timed_out"].includes(
          String(run.status),
        )
      )
        throw new Error("只有已结束的运行可以审核");
      let status: "assigned" | "approved" | "escalated" | "rerun_approved";
      let retryRunId: string | undefined;
      if (input.action === "approve") {
        if (run.status !== "passed") throw new Error("只有通过的运行可以批准");
        const evidence =
          await tx`select 1 from evidence_records where run_id=${input.run_id} limit 1`;
        if (!evidence.length) throw new Error("没有证据的运行不能批准");
        status = "approved";
      } else if (input.action === "rerun") {
        if (run.status === "passed") throw new Error("通过的运行不需要补跑");
        retryRunId = id("run");
        await tx`insert into pipeline_runs(id,project_id,commit_sha,stage_key,scope,status,retry_of,policy_snapshot_ref,requested_by,reason,model_credential_id) values(${retryRunId},${String(run.project_id)},${String(run.commit_sha)},${String(run.stage_key)},${String(run.scope)},'queued',${input.run_id},${String(run.policy_snapshot_ref)},${run.model_credential_id ? String(run.requested_by) : current.id},${input.reason},${run.model_credential_id ? String(run.model_credential_id) : null})`;
        await tx`insert into pipeline_events(run_id,sequence,event_type,visibility,payload) values(${retryRunId},0,'queued','student',${tx.json({ message: "课程团队已批准补跑", retry_of: input.run_id })})`;
        await tx`insert into outbox_events(id,topic,aggregate_id,payload) values(${id("outbox")},'pipeline.queued',${retryRunId},${tx.json({ run_id: retryRunId, retry_of: input.run_id })})`;
        status = "rerun_approved";
      } else status = input.action === "assign" ? "assigned" : "escalated";
      await tx`insert into pipeline_reviews(run_id,status,assigned_to,reason) values(${input.run_id},${status},${input.action === "assign" ? current.id : null},${input.reason}) on conflict(run_id) do update set status=excluded.status,assigned_to=coalesce(excluded.assigned_to,pipeline_reviews.assigned_to),reason=excluded.reason,version=pipeline_reviews.version+1,updated_at=now()`;
      await tx`insert into pipeline_review_events(id,run_id,action,actor_id,reason,retry_run_id) values(${id("review-event")},${input.run_id},${input.action},${current.id},${input.reason},${retryRunId ?? null})`;
      await tx`insert into audit_events (id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values (${id("audit")},${current.id},${`review.${input.action}`},'pipeline',${input.run_id},${input.reason},${traceId},${tx.json({ review_status: status, retry_run_id: retryRunId ?? null })})`;
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},200,${tx.json({ ok: true, retry_run_id: retryRunId ?? null })},now()+interval '24 hours')`;
    });
  }
  async transitionCourseState(
    current: PortalActor,
    courseId: string,
    target: CourseState,
    reason: string,
    traceId: string,
    key: string,
    hash: string,
  ): Promise<CourseState> {
    return await this.grading.transitionCourseState(
      current,
      courseId,
      target,
      reason,
      traceId,
      key,
      hash,
    );
  }
  async calculateScore(
    current: PortalActor,
    input: ScoreCalculationV1,
    traceId: string,
    key: string,
    hash: string,
  ): Promise<ScoreSnapshotV1> {
    return await this.grading.calculateScore(
      current,
      input,
      traceId,
      key,
      hash,
    );
  }
  async adjustScore(
    current: PortalActor,
    input: ScoreAdjustmentInputV1,
    traceId: string,
    key: string,
    hash: string,
  ): Promise<ScoreSnapshotV1> {
    return await this.grading.adjustScore(current, input, traceId, key, hash);
  }
  async transitionScore(
    current: PortalActor,
    input: ScoreTransitionV1,
    traceId: string,
    key: string,
    hash: string,
  ): Promise<ScoreSnapshotV1> {
    return await this.grading.transitionScore(
      current,
      input,
      traceId,
      key,
      hash,
    );
  }
  async submitAppeal(
    current: PortalActor,
    input: AppealSubmitV1,
    traceId: string,
    key: string,
    hash: string,
  ): Promise<AppealRecordV1> {
    return await this.grading.submitAppeal(current, input, traceId, key, hash);
  }
  async transitionAppeal(
    current: PortalActor,
    input: AppealTransitionV1,
    traceId: string,
    key: string,
    hash: string,
  ): Promise<AppealRecordV1> {
    return await this.grading.transitionAppeal(
      current,
      input,
      traceId,
      key,
      hash,
    );
  }
  async appeals(
    current: PortalActor,
    projectId: string,
  ): Promise<AppealRecordV1[]> {
    return await this.grading.appeals(current, projectId);
  }
  async ask(
    current: PortalActor,
    input: { content: string; project_id?: string },
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<QaThreadV1> {
    const content = input.content.trim();
    if (!content || content.length > 8000)
      throw new Error("问答内容长度必须在 1 到 8000 字符之间");
    const result = await this.idempotent<{ thread_id: string }>(
      current,
      idempotencyKey,
      requestHash,
      202,
      async (tx) => {
        const dash = await this.dashboard(current, input.project_id);
        const threadId = `qa-${dash.project.project_id}-${dash.project.current_stage.key}`;
        const messageId = id("message");
        await tx`insert into qa_threads (id,project_id,stage_key) values (${threadId},${dash.project.project_id},${dash.project.current_stage.key}) on conflict (project_id,stage_key) do nothing`;
        await tx`insert into qa_messages (id,thread_id,role,content,requested_by) values (${messageId},${threadId},'user',${content},${current.id})`;
        const reservation = await reserveModelUsage(
          tx,
          current,
          dash.project.project_id,
          messageId,
          content,
        );
        await tx`insert into outbox_events(id,topic,aggregate_id,payload) values(${id("outbox")},'qa.agent.requested',${threadId},${tx.json({ thread_id: threadId, message_id: messageId, actor_id: current.id, provider_id: reservation.providerId, model: reservation.model, usage_id: reservation.usageId })})`;
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},'model_usage.reserve','qa_message',${messageId},'用户提交课程问答',${traceId},${tx.json({ usage_id: reservation.usageId, provider_id: reservation.providerId, model: reservation.model })})`;
        return { thread_id: threadId };
      },
    );
    return await this.qaThread(current, result.thread_id);
  }
  async qaThread(current: PortalActor, threadId: string): Promise<QaThreadV1> {
    const threads = await this
      .sql`select qt.* from qa_threads qt join projects p on p.id=qt.project_id join experiments e on e.id=p.experiment_id left join project_members pm on pm.project_id=qt.project_id and pm.user_id=${current.id} left join course_memberships cm on cm.course_id=e.course_id and cm.user_id=${current.id} where qt.id=${threadId} and (${current.role === "admin"} or (${current.role === "student"} and pm.user_id is not null) or (${current.role !== "student"} and cm.role in ('teacher','ta') and cm.status='active'))`;
    if (!threads[0]) throw new Error("问答线程不存在或不可见");
    const row = threads[0];
    const messages = await this
      .sql`select * from qa_messages where thread_id=${threadId} order by created_at,id`;
    return {
      version: "qa-thread.v1",
      id: threadId,
      project_id: String(row.project_id),
      stage_key: String(row.stage_key),
      messages: messages.map((message) => ({
        id: String(message.id),
        role: message.role as "user" | "assistant" | "system",
        content: String(message.content),
        object_refs: message.object_refs as string[],
        created_at: new Date(String(message.created_at)).toISOString(),
      })),
    };
  }
  async agentAudits(current: PortalActor): Promise<AgentAuditV1[]> {
    assertStaff(current);
    const rows = await this
      .sql`select aa.* from agent_audits aa join projects p on p.id=aa.project_id join experiments e on e.id=p.experiment_id left join course_memberships cm on cm.course_id=e.course_id and cm.user_id=${current.id} where ${current.role === "admin"} or (cm.role in ('teacher','ta') and cm.status='active') order by aa.created_at desc limit 100`;
    return rows.map((row) => ({
      version: "agent-audit.v1",
      id: String(row.id),
      project_id: String(row.project_id),
      actor_id: String(row.actor_id),
      model: String(row.model),
      task_kind: String(row.task_kind),
      risk_level: row.risk_level as AgentAuditV1["risk_level"],
      risk_flags: row.risk_flags as string[],
      prompt_summary: String(row.prompt_summary),
      response_summary: row.response_summary
        ? String(row.response_summary)
        : undefined,
      provider: row.provider ? String(row.provider) : undefined,
      provider_session_id: row.provider_session_id
        ? String(row.provider_session_id)
        : undefined,
      input_tokens:
        row.input_tokens === null ? undefined : Number(row.input_tokens),
      output_tokens:
        row.output_tokens === null ? undefined : Number(row.output_tokens),
      total_tokens:
        row.total_tokens === null ? undefined : Number(row.total_tokens),
      actual_cost_usd:
        row.actual_cost_usd === null ? undefined : Number(row.actual_cost_usd),
      created_at: new Date(String(row.created_at)).toISOString(),
    }));
  }
  private async materializeCourseManifest(
    tx: TransactionSql,
    current: PortalActor,
    courseId: string,
    manifestVersion: number,
    reason: string,
    traceId: string,
    action: "course.manifest.publish" | "course.manifest.rollback",
  ): Promise<CourseManifestVersionV1> {
    const courses =
      await tx`select c.* from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.id=${courseId} and c.deleted_at is null and (${current.role === "admin"} or (cm.role='teacher' and cm.status='active')) for update of c`;
    const course = courses[0] as Row | undefined;
    if (
      !course ||
      !["draft", "published", "active"].includes(String(course.status))
    )
      throw new Error("课程当前状态不允许发布或无管理权限");
    const rows =
      await tx`select * from course_manifest_versions where course_id=${courseId} and version=${manifestVersion} and state='draft' for update`;
    if (!rows[0]) throw new Error("待发布课程清单版本不存在");
    const manifest = CourseManifestV1Schema.parse(rows[0].manifest);
    await tx`update course_manifest_versions set state='superseded' where course_id=${courseId} and state='published'`;
    const published =
      await tx`update course_manifest_versions set state='published',published_at=now() where course_id=${courseId} and version=${manifestVersion} returning *`;
    await tx`update experiments set publish_state='superseded' where course_id=${courseId} and publish_state='published'`;
    const experimentId = `${manifest.experiment.id}-mv${manifestVersion}-${courseId}`;
    await tx`insert into experiments(id,course_id,title,spec_version,publish_state) values(${experimentId},${courseId},${manifest.experiment.title},${manifest.experiment.spec_version},'published')`;
    for (const stage of manifest.stages)
      await tx`insert into stage_gates(id,experiment_id,key,name,sequence,status,config) values(${`${experimentId}-${stage.id}`},${experimentId},${stage.key},${stage.name},${stage.sequence},${stage.sequence === 0 ? "open" : "locked"},${tx.json({ source_ref: stage.source_ref, spec_refs: stage.spec_refs, test_sets: stage.test_sets, rubric_ids: stage.rubric_ids, hardware_gate: stage.hardware_gate, human_review_required: stage.human_review_required, required_artifacts: stage.required_artifacts, required_evidence: stage.required_evidence, manual_review_required: stage.manual_review_required })})`;
    for (const item of manifest.rubric)
      await tx`insert into course_rubric_items(course_id,manifest_version,item_id,name,weight) values(${courseId},${manifestVersion},${item.id},${item.name},${item.weight})`;
    await tx`insert into course_ai_policies(course_id,manifest_version,policy) values(${courseId},${manifestVersion},${tx.json(manifest.ai_policy)})`;
    await tx`update courses set code=${manifest.course.code},name=${manifest.course.name},term=${manifest.course.term},status=case when status='draft' then 'published' else status end,manifest_version=${manifestVersion},published_manifest_version=${manifestVersion},manifest=${tx.json(manifest)},version=version+1,updated_at=now() where id=${courseId}`;
    await tx`insert into outbox_events(id,topic,aggregate_id,payload) values(${id("outbox")},'course.published',${courseId},${tx.json({ course_id: courseId, manifest_version: manifestVersion, experiment_id: experimentId })})`;
    await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},${action},'course',${courseId},${reason},${traceId},${tx.json({ manifest_version: manifestVersion, checksum: rows[0].checksum, rollback_of: rows[0].rollback_of ?? null })})`;
    return this.courseManifestVersion(published[0] as Row);
  }
  private async mutateCourseGroup(
    current: PortalActor,
    courseId: string,
    groupId: string | undefined,
    input: CourseGroupMutationV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CourseGroupV1> {
    assertTeacher(current);
    return await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing =
        await tx`select request_hash,response from idempotency_keys where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()`;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return existing[0].response as CourseGroupV1;
      }
      const allowed =
        await tx`select c.id from courses c left join course_memberships cm on cm.course_id=c.id and cm.user_id=${current.id} where c.id=${courseId} and c.deleted_at is null and c.status in ('draft','published','active') and (${current.role === "admin"} or (cm.role='teacher' and cm.status='active')) for update of c`;
      if (!allowed[0])
        throw new Error("课程不存在、状态不允许调整分组或无管理权限");
      const members =
        await tx`select cm.user_id from course_memberships cm join users u on u.id=cm.user_id where cm.course_id=${courseId} and cm.user_id in ${tx(input.member_ids)} and cm.role='student' and cm.status='active' and u.status='active' and u.deleted_at is null`;
      if (members.length !== input.member_ids.length)
        throw new Error("分组成员必须是该课程的活跃学生");
      const conflicts =
        await tx`select cgm.user_id,cg.name from course_group_members cgm join course_groups cg on cg.id=cgm.group_id where cgm.course_id=${courseId} and cgm.user_id in ${tx(input.member_ids)} and (${groupId ?? null}::text is null or cgm.group_id<>${groupId ?? null})`;
      if (conflicts[0])
        throw new Error(
          `成员 ${String(conflicts[0].user_id)} 已属于分组 ${String(conflicts[0].name)}`,
        );
      let idValue = groupId;
      let action = "course.group.create";
      if (groupId) {
        const updated =
          await tx`update course_groups set name=${input.name},version=version+1,updated_at=now() where id=${groupId} and course_id=${courseId} and version=${input.expected_revision} returning id`;
        if (!updated[0]) throw new Error("分组不存在或已被并发更新");
        await tx`delete from course_group_members where group_id=${groupId}`;
        action = "course.group.update";
      } else {
        idValue = id("group");
        await tx`insert into course_groups(id,course_id,name) values(${idValue},${courseId},${input.name})`;
      }
      for (const memberId of input.member_ids.toSorted())
        await tx`insert into course_group_members(group_id,course_id,user_id) values(${idValue!},${courseId},${memberId})`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${current.id},${action},'course_group',${idValue!},${input.reason},${traceId},${tx.json({ course_id: courseId, name: input.name, member_ids: input.member_ids })})`;
      const rows =
        await tx`select cg.*,array_agg(cgm.user_id order by cgm.user_id) member_ids from course_groups cg join course_group_members cgm on cgm.group_id=cg.id where cg.id=${idValue!} group by cg.id`;
      const response = this.courseGroup(rows[0] as Row);
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${current.id},${idempotencyKey},${requestHash},${groupId ? 200 : 201},${tx.json(response)},now()+interval '24 hours')`;
      return response;
    });
  }
  private courseGroup(row: Row): CourseGroupV1 {
    return {
      version: "course-group.v1",
      id: String(row.id),
      course_id: String(row.course_id),
      name: String(row.name),
      member_ids: (row.member_ids as unknown[]).map(String),
      revision: Number(row.version),
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString(),
    };
  }
  private enrollmentInvite(row: Row): EnrollmentInviteSummaryV1 {
    return {
      version: "enrollment-invite-summary.v1",
      id: String(row.id),
      course_id: String(row.course_id),
      role: row.role as EnrollmentInviteSummaryV1["role"],
      expires_at: new Date(String(row.expires_at)).toISOString(),
      max_uses: Number(row.max_uses),
      uses: Number(row.uses),
      revoked: Boolean(row.revoked_at),
      created_at: new Date(String(row.created_at)).toISOString(),
    };
  }
  private serviceTokenSummary(row: Row): ServiceTokenSummaryV1 {
    return {
      version: "service-token-summary.v1",
      id: String(row.id),
      name: String(row.label),
      scopes: row.scopes as string[] as ServiceTokenSummaryV1["scopes"],
      expires_at: new Date(String(row.expires_at)).toISOString(),
      created_at: new Date(String(row.created_at)).toISOString(),
      ...(row.revoked_at
        ? { revoked_at: new Date(String(row.revoked_at)).toISOString() }
        : {}),
    };
  }
  private courseManifestVersion(row: Row): CourseManifestVersionV1 {
    return {
      version: "course-manifest-version.v1",
      course_id: String(row.course_id),
      manifest_version: Number(row.version),
      state: row.state as CourseManifestVersionV1["state"],
      manifest: CourseManifestV1Schema.parse(row.manifest),
      checksum: String(row.checksum),
      rollback_of: row.rollback_of ? Number(row.rollback_of) : undefined,
      created_at: new Date(String(row.created_at)).toISOString(),
      published_at: row.published_at
        ? new Date(String(row.published_at)).toISOString()
        : undefined,
    };
  }
  private provisionStatusRow(row: Row): ProjectProvisionStatusV1 {
    return {
      version: "project-provision-status.v1",
      project_id: String(row.project_id),
      status: row.status as ProjectProvisionStatusV1["status"],
      owner: String(row.owner_name),
      repository: String(row.repository_name),
      repo_url: row.clone_url ? String(row.clone_url) : undefined,
      attempts: Number(row.attempts),
      last_error: row.last_error ? String(row.last_error) : undefined,
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString(),
    };
  }
  private designSubmission(row: Row): DesignSubmissionV1 {
    return {
      version: "design-submission.v1",
      id: String(row.id),
      project_id: String(row.project_id),
      stage_key: String(row.stage_key),
      commit_sha: String(row.commit_sha),
      revision: Number(row.revision),
      title: String(row.title),
      summary: String(row.summary),
      invariants: row.invariants as string[],
      interfaces: row.interfaces as DesignSubmissionV1["interfaces"],
      evidence_refs: row.evidence_refs as string[],
      status: row.status as DesignSubmissionV1["status"],
      submitted_by: String(row.submitted_by),
      reviewed_by: row.reviewed_by ? String(row.reviewed_by) : undefined,
      review_feedback: row.review_feedback
        ? String(row.review_feedback)
        : undefined,
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString(),
    };
  }
  private assessmentSubmissionRow(row: Row): AssessmentSubmissionV1 {
    return {
      version: "assessment-submission.v1",
      id: String(row.id),
      project_id: String(row.project_id),
      run_id: String(row.run_id),
      commit_sha: String(row.commit_sha),
      stage_key: String(row.stage_key),
      spec_hash: String(row.spec_hash),
      config_hash: String(row.config_hash),
      manifest_hash: String(row.manifest_hash),
      policy_snapshot_ref: String(row.policy_snapshot_ref),
      status: row.status as AssessmentSubmissionV1["status"],
      submitted_by: String(row.submitted_by),
      submitted_at: new Date(String(row.submitted_at)).toISOString(),
      ...(row.completed_at
        ? { completed_at: new Date(String(row.completed_at)).toISOString() }
        : {}),
    };
  }
  private run(row: Row): PipelineSummaryV1 {
    return {
      version: "pipeline-summary.v1",
      id: String(row.id),
      project_id: String(row.project_id),
      commit_sha: String(row.commit_sha),
      stage_key: String(row.stage_key),
      status: row.status as PipelineSummaryV1["status"],
      passed: Number(row.passed),
      total: Number(row.total),
      failure_class: row.failure_class ? String(row.failure_class) : undefined,
      public_message: String(row.public_message ?? ""),
      created_at: new Date(String(row.created_at)).toISOString(),
      finished_at: row.finished_at
        ? new Date(String(row.finished_at)).toISOString()
        : undefined,
      retry_of: row.retry_of ? String(row.retry_of) : undefined,
    };
  }
}
