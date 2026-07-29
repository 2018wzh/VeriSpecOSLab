import type { Sql, TransactionSql } from "postgres";
import {
  ModelProviderInputV1Schema,
  ModelQuotaPolicyInputV1Schema,
  type ModelProviderInputV1,
  type ModelProviderKind,
  type ModelProviderSummaryV1,
  type ModelQuotaPolicyInputV1,
  type ModelQuotaPolicyV1,
  type PortalActor,
} from "vos-core/portal-contracts";
import { EnvelopeEncryption } from "../storage/envelope.ts";

type Row = Record<string, unknown>;

export interface RuntimeModelProvider {
  id: string;
  kind: ModelProviderKind;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  secret?: string;
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
  maxOutputTokens: number;
}

export interface ReservedModelUsage {
  usageId: string;
  providerId: string;
  model: string;
}

export async function reserveModelUsage(
  tx: TransactionSql,
  actor: PortalActor,
  projectId: string,
  messageId: string,
  content: string,
): Promise<ReservedModelUsage> {
  const contextRows = await tx`select c.id course_id,cap.policy
    from projects p
    join experiments e on e.id=p.experiment_id
    join courses c on c.id=e.course_id and c.deleted_at is null
    join course_ai_policies cap on cap.course_id=c.id and cap.manifest_version=c.published_manifest_version
    where p.id=${projectId} and p.deleted_at is null and c.status in ('published','active')
    for update of c`;
  const context = contextRows[0] as Row | undefined;
  if (!context) throw new Error("项目没有可用的已发布课程 AI policy");
  const policy = context.policy as { allowed_models?: unknown };
  const allowedModels = Array.isArray(policy.allowed_models)
    ? policy.allowed_models.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  if (!allowedModels.length) throw new Error("课程未授权任何问答模型");
  const providers =
    await tx`select * from model_providers where enabled=true order by name,id`;
  let selected: Row | undefined;
  let model: string | undefined;
  for (const candidate of providers as Row[]) {
    const supported = candidate.models as string[];
    const allowed = allowedModels.find((item) => supported.includes(item));
    if (allowed) {
      selected = candidate;
      model = allowed;
      break;
    }
  }
  if (!selected || !model)
    throw new Error("没有启用且满足课程白名单的模型 Provider");
  const courseId = String(context.course_id);
  const periodRows = await tx`select date_trunc('month',now())::date period`;
  const period = String(periodRows[0].period);
  await tx`select pg_advisory_xact_lock(hashtext(${`model-quota:${courseId}:${period}`}))`;
  const quotas = await tx`select * from model_quota_policies
    where course_id=${courseId} and enabled=true and (user_id is null or user_id=${actor.id})
    order by user_id nulls first for update`;
  const courseQuota = quotas.find((row) => row.user_id === null) as
    | Row
    | undefined;
  if (!courseQuota) throw new Error("课程尚未配置启用的模型额度");
  const historyRows =
    await tx`select coalesce(sum(octet_length(m.content)),0)::bigint bytes
    from qa_messages m join qa_threads t on t.id=m.thread_id where t.project_id=${projectId}`;
  const maxAgentIterations = 6;
  const inputTokens =
    (Math.ceil(
      (Number(historyRows[0].bytes) +
        new TextEncoder().encode(content).byteLength) /
        3,
    ) +
      1024) *
    maxAgentIterations;
  const outputTokens = Number(selected.max_output_tokens) * maxAgentIterations;
  const reservedTokens = inputTokens + outputTokens;
  const reservedCost =
    (inputTokens / 1_000_000) * Number(selected.input_cost_per_million_usd) +
    (outputTokens / 1_000_000) * Number(selected.output_cost_per_million_usd);
  for (const quota of quotas as Row[]) {
    const usageRows = await tx`select
      count(*) filter(where status in ('reserved','settled'))::int requests,
      coalesce(sum(case when status='settled' then total_tokens else reserved_tokens end) filter(where status in ('reserved','settled')),0)::bigint tokens,
      coalesce(sum(case when status='settled' then actual_cost_usd else reserved_cost_usd end) filter(where status in ('reserved','settled')),0)::numeric cost
      from model_usage_ledger where course_id=${courseId} and period=${period}::date
      ${quota.user_id === null ? tx`` : tx`and user_id=${actor.id}`}`;
    const usage = usageRows[0] as Row;
    if (
      Number(usage.requests) + 1 > Number(quota.monthly_request_limit) ||
      Number(usage.tokens) + reservedTokens >
        Number(quota.monthly_token_limit) ||
      Number(usage.cost) + reservedCost > Number(quota.monthly_cost_limit_usd)
    ) {
      throw new Error(
        quota.user_id === null
          ? "课程模型月度额度不足"
          : "用户模型月度额度不足",
      );
    }
  }
  const usageId = identifier("model-usage");
  await tx`insert into model_usage_ledger(id,request_message_id,course_id,user_id,provider_id,model,period,status,reserved_tokens,reserved_cost_usd)
    values(${usageId},${messageId},${courseId},${actor.id},${String(selected.id)},${model},${period}::date,'reserved',${reservedTokens},${reservedCost})`;
  return { usageId, providerId: String(selected.id), model };
}

export class ModelControlService {
  private constructor(
    private readonly sql: Sql,
    private readonly envelope: EnvelopeEncryption,
  ) {}

  static async create(
    sql: Sql,
    masterKey: string,
  ): Promise<ModelControlService> {
    return new ModelControlService(
      sql,
      await EnvelopeEncryption.fromBase64Url(masterKey),
    );
  }

  async providers(actor: PortalActor): Promise<ModelProviderSummaryV1[]> {
    assertAdmin(actor);
    const rows = await this.sql`select * from model_providers order by name,id`;
    return rows.map((row) => providerSummary(row as Row));
  }

  async saveProvider(
    actor: PortalActor,
    raw: ModelProviderInputV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ModelProviderSummaryV1> {
    assertAdmin(actor);
    const input = ModelProviderInputV1Schema.parse(raw);
    const sealed = input.secret
      ? await this.envelope.seal(input.secret, `model-provider:${input.id}`)
      : undefined;
    return await this.sql.begin(async (tx) => {
      const replay = await idempotentReplay<ModelProviderSummaryV1>(
        tx,
        actor.id,
        idempotencyKey,
        requestHash,
      );
      if (replay) return replay;
      const current =
        await tx`select * from model_providers where id=${input.id} for update`;
      if (current[0] && Number(current[0].revision) !== input.expected_revision)
        throw new Error("模型 Provider 已被并发更新，请刷新后重试");
      if (!current[0] && input.expected_revision !== 0)
        throw new Error("新模型 Provider 的 expected_revision 必须为 0");
      if (!current[0] && input.kind !== "ollama" && !sealed)
        throw new Error("远程模型 Provider 首次配置必须提供凭据");
      if (
        current[0] &&
        input.kind !== "ollama" &&
        !sealed &&
        !current[0].secret_cipher
      )
        throw new Error("远程模型 Provider 必须配置凭据");
      const rows = current[0]
        ? await tx`update model_providers set name=${input.name},kind=${input.kind},base_url=${input.base_url},models=${input.models},default_model=${input.default_model},secret_cipher=coalesce(${sealed?.cipher ?? null},secret_cipher),secret_iv=coalesce(${sealed?.iv ?? null},secret_iv),input_cost_per_million_usd=${input.input_cost_per_million_usd},output_cost_per_million_usd=${input.output_cost_per_million_usd},max_output_tokens=${input.max_output_tokens},enabled=${input.enabled},revision=revision+1,updated_by=${actor.id},updated_at=now() where id=${input.id} and revision=${input.expected_revision} returning *`
        : await tx`insert into model_providers(id,name,kind,base_url,models,default_model,secret_cipher,secret_iv,input_cost_per_million_usd,output_cost_per_million_usd,max_output_tokens,enabled,updated_by) values(${input.id},${input.name},${input.kind},${input.base_url},${input.models},${input.default_model},${sealed?.cipher ?? null},${sealed?.iv ?? null},${input.input_cost_per_million_usd},${input.output_cost_per_million_usd},${input.max_output_tokens},${input.enabled},${actor.id}) returning *`;
      if (!rows[0]) throw new Error("模型 Provider 更新冲突");
      const response = providerSummary(rows[0] as Row);
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${identifier("audit")},${actor.id},'model_provider.upsert','model_provider',${input.id},${input.reason},${traceId},${tx.json({ kind: input.kind, base_url: input.base_url, models: input.models, default_model: input.default_model, enabled: input.enabled, revision: response.revision, credential_replaced: Boolean(input.secret) })})`;
      await storeIdempotency(
        tx,
        actor.id,
        idempotencyKey,
        requestHash,
        response,
      );
      return response;
    });
  }

  async quotas(actor: PortalActor): Promise<ModelQuotaPolicyV1[]> {
    assertAdmin(actor);
    const rows = await this
      .sql`select q.*,to_char(date_trunc('month',now()),'YYYY-MM') period,
      coalesce(sum(case when u.status='settled' then 1 else 0 end),0)::int used_requests,
      coalesce(sum(case when u.status='settled' then u.total_tokens else 0 end),0)::bigint used_tokens,
      coalesce(sum(case when u.status='settled' then u.actual_cost_usd else 0 end),0)::numeric used_cost_usd,
      coalesce(sum(case when u.status='reserved' then 1 else 0 end),0)::int reserved_requests,
      coalesce(sum(case when u.status='reserved' then u.reserved_tokens else 0 end),0)::bigint reserved_tokens,
      coalesce(sum(case when u.status='reserved' then u.reserved_cost_usd else 0 end),0)::numeric reserved_cost_usd
      from model_quota_policies q left join model_usage_ledger u on u.course_id=q.course_id and (q.user_id is null or u.user_id=q.user_id) and u.period=date_trunc('month',now())::date
      group by q.id order by q.course_id,q.user_id nulls first`;
    return rows.map((row) => quotaPolicy(row as Row));
  }

  async saveQuota(
    actor: PortalActor,
    raw: ModelQuotaPolicyInputV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ModelQuotaPolicyV1> {
    assertAdmin(actor);
    const input = ModelQuotaPolicyInputV1Schema.parse(raw);
    return await this.sql.begin(async (tx) => {
      const replay = await idempotentReplay<ModelQuotaPolicyV1>(
        tx,
        actor.id,
        idempotencyKey,
        requestHash,
      );
      if (replay) return replay;
      const course =
        await tx`select c.id,cap.policy from courses c join course_ai_policies cap on cap.course_id=c.id and cap.manifest_version=c.published_manifest_version where c.id=${input.course_id} and c.deleted_at is null for update of c`;
      if (!course[0]) throw new Error("课程不存在或尚未发布 AI policy");
      const policy = course[0].policy as { monthly_budget?: unknown };
      const manifestBudget = Number(policy.monthly_budget);
      if (
        input.enabled &&
        (!Number.isFinite(manifestBudget) ||
          manifestBudget <= 0 ||
          input.monthly_cost_limit_usd > manifestBudget)
      )
        throw new Error("模型额度不得超过已发布课程清单的 monthly_budget");
      if (input.user_id) {
        const membership =
          await tx`select 1 from course_memberships where course_id=${input.course_id} and user_id=${input.user_id} and status='active'`;
        if (!membership[0]) throw new Error("用户不是该课程的活跃成员");
        const courseQuota =
          await tx`select * from model_quota_policies where course_id=${input.course_id} and user_id is null and enabled=true`;
        if (courseQuota[0] && exceeds(input, courseQuota[0] as Row))
          throw new Error("用户额度不得超过课程总额度");
      } else {
        const userQuotas =
          await tx`select * from model_quota_policies where course_id=${input.course_id} and user_id is not null and enabled=true`;
        if (
          input.enabled &&
          userQuotas.some((row) => exceedsRow(row as Row, input))
        )
          throw new Error("课程总额度不得低于已启用的用户额度");
      }
      const current =
        await tx`select * from model_quota_policies where course_id=${input.course_id} and user_id is not distinct from ${input.user_id ?? null} for update`;
      if (current[0] && Number(current[0].revision) !== input.expected_revision)
        throw new Error("模型额度已被并发更新，请刷新后重试");
      if (!current[0] && input.expected_revision !== 0)
        throw new Error("新模型额度的 expected_revision 必须为 0");
      const quotaId = current[0]
        ? String(current[0].id)
        : identifier("model-quota");
      const rows = current[0]
        ? await tx`update model_quota_policies set monthly_request_limit=${input.monthly_request_limit},monthly_token_limit=${input.monthly_token_limit},monthly_cost_limit_usd=${input.monthly_cost_limit_usd},enabled=${input.enabled},revision=revision+1,updated_by=${actor.id},updated_at=now() where id=${quotaId} and revision=${input.expected_revision} returning id`
        : await tx`insert into model_quota_policies(id,course_id,user_id,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,enabled,updated_by) values(${quotaId},${input.course_id},${input.user_id ?? null},${input.monthly_request_limit},${input.monthly_token_limit},${input.monthly_cost_limit_usd},${input.enabled},${actor.id}) returning id`;
      if (!rows[0]) throw new Error("模型额度更新冲突");
      const summary = await quotaSummary(tx, quotaId);
      const response = quotaPolicy(summary);
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${identifier("audit")},${actor.id},'model_quota.upsert','model_quota',${quotaId},${input.reason},${traceId},${tx.json({ course_id: input.course_id, user_id: input.user_id ?? null, monthly_request_limit: input.monthly_request_limit, monthly_token_limit: input.monthly_token_limit, monthly_cost_limit_usd: input.monthly_cost_limit_usd, enabled: input.enabled, revision: response.revision })})`;
      await storeIdempotency(
        tx,
        actor.id,
        idempotencyKey,
        requestHash,
        response,
      );
      return response;
    });
  }

  async runtime(providerId: string): Promise<RuntimeModelProvider> {
    const rows = await this
      .sql`select * from model_providers where id=${providerId} and enabled=true`;
    const row = rows[0] as Row | undefined;
    if (!row) throw new Error("Q&A 模型 Provider 不存在或已停用");
    const secret = row.secret_cipher
      ? await this.envelope.open(
          row.secret_cipher as Uint8Array,
          row.secret_iv as Uint8Array,
          `model-provider:${providerId}`,
        )
      : undefined;
    if (String(row.kind) !== "ollama" && !secret)
      throw new Error("Q&A 模型 Provider 缺少凭据");
    return {
      id: providerId,
      kind: String(row.kind) as ModelProviderKind,
      baseUrl: String(row.base_url),
      models: row.models as string[],
      defaultModel: String(row.default_model),
      secret,
      inputCostPerMillionUsd: Number(row.input_cost_per_million_usd),
      outputCostPerMillionUsd: Number(row.output_cost_per_million_usd),
      maxOutputTokens: Number(row.max_output_tokens),
    };
  }
}

async function quotaSummary(
  sql: Sql | TransactionSql,
  quotaId: string,
): Promise<Row> {
  const rows =
    await sql`select q.*,to_char(date_trunc('month',now()),'YYYY-MM') period,
  coalesce(sum(case when u.status='settled' then 1 else 0 end),0)::int used_requests,
  coalesce(sum(case when u.status='settled' then u.total_tokens else 0 end),0)::bigint used_tokens,
  coalesce(sum(case when u.status='settled' then u.actual_cost_usd else 0 end),0)::numeric used_cost_usd,
  coalesce(sum(case when u.status='reserved' then 1 else 0 end),0)::int reserved_requests,
  coalesce(sum(case when u.status='reserved' then u.reserved_tokens else 0 end),0)::bigint reserved_tokens,
  coalesce(sum(case when u.status='reserved' then u.reserved_cost_usd else 0 end),0)::numeric reserved_cost_usd
  from model_quota_policies q left join model_usage_ledger u on u.course_id=q.course_id and (q.user_id is null or u.user_id=q.user_id) and u.period=date_trunc('month',now())::date
  where q.id=${quotaId} group by q.id`;
  if (!rows[0]) throw new Error("模型额度不存在");
  return rows[0] as Row;
}

function assertAdmin(actor: PortalActor): void {
  if (actor.role !== "admin") throw new Error("administrator access required");
}
function identifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
function providerSummary(row: Row): ModelProviderSummaryV1 {
  return {
    version: "model-provider-summary.v1",
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind) as ModelProviderKind,
    base_url: String(row.base_url),
    models: row.models as string[],
    default_model: String(row.default_model),
    input_cost_per_million_usd: Number(row.input_cost_per_million_usd),
    output_cost_per_million_usd: Number(row.output_cost_per_million_usd),
    max_output_tokens: Number(row.max_output_tokens),
    enabled: Boolean(row.enabled),
    secret_configured: Boolean(row.secret_cipher),
    revision: Number(row.revision),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}
function quotaPolicy(row: Row): ModelQuotaPolicyV1 {
  return {
    version: "model-quota-policy.v1",
    id: String(row.id),
    course_id: String(row.course_id),
    ...(row.user_id ? { user_id: String(row.user_id) } : {}),
    monthly_request_limit: Number(row.monthly_request_limit),
    monthly_token_limit: Number(row.monthly_token_limit),
    monthly_cost_limit_usd: Number(row.monthly_cost_limit_usd),
    enabled: Boolean(row.enabled),
    revision: Number(row.revision),
    period: String(row.period),
    used_requests: Number(row.used_requests),
    used_tokens: Number(row.used_tokens),
    used_cost_usd: Number(row.used_cost_usd),
    reserved_requests: Number(row.reserved_requests),
    reserved_tokens: Number(row.reserved_tokens),
    reserved_cost_usd: Number(row.reserved_cost_usd),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}
function exceeds(input: ModelQuotaPolicyInputV1, limit: Row): boolean {
  return (
    input.monthly_request_limit > Number(limit.monthly_request_limit) ||
    input.monthly_token_limit > Number(limit.monthly_token_limit) ||
    input.monthly_cost_limit_usd > Number(limit.monthly_cost_limit_usd)
  );
}
function exceedsRow(row: Row, limit: ModelQuotaPolicyInputV1): boolean {
  return (
    Number(row.monthly_request_limit) > limit.monthly_request_limit ||
    Number(row.monthly_token_limit) > limit.monthly_token_limit ||
    Number(row.monthly_cost_limit_usd) > limit.monthly_cost_limit_usd
  );
}
async function idempotentReplay<T>(
  tx: TransactionSql,
  actorId: string,
  key: string,
  hash: string,
): Promise<T | undefined> {
  await tx`select pg_advisory_xact_lock(hashtext(${`${actorId}:${key}`}))`;
  const rows =
    await tx`select request_hash,response from idempotency_keys where actor_id=${actorId} and key=${key} and expires_at>now()`;
  if (!rows[0]) return undefined;
  if (rows[0].request_hash !== hash) throw new Error("幂等键已被不同请求使用");
  return rows[0].response as T;
}
async function storeIdempotency(
  tx: TransactionSql,
  actorId: string,
  key: string,
  hash: string,
  response: unknown,
): Promise<void> {
  await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${actorId},${key},${hash},200,${tx.json(response as never)},now()+interval '24 hours')`;
}
