import type { Sql } from "postgres";
import type { RuntimeModelProvider } from "../server/model-control.ts";

export interface QaAgentResponse {
  content: string;
  model: string;
  session_id: string;
  structured_output: {
    answer: string;
    citations: Record<string, string>[];
    risk_flags?: string[];
  };
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
}
export interface ModelProviderRuntimeSource {
  runtime(providerId: string): Promise<RuntimeModelProvider>;
}
export interface QaAgentClient {
  answer(input: {
    thread_id: string;
    project_id: string;
    actor_id: string;
    stage_key: string;
    question: string;
    history: { role: string; content: string }[];
    model: string;
    provider: RuntimeModelProvider;
  }): Promise<QaAgentResponse>;
}

export class VosAgentQaClient implements QaAgentClient {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {
    if (!/^https?:\/\//.test(endpoint))
      throw new Error("VOS_QA_AGENT_ENDPOINT must be an HTTP(S) URL");
  }
  static fromEnv(): VosAgentQaClient {
    return new VosAgentQaClient(
      required("VOS_QA_AGENT_ENDPOINT").replace(/\/$/, ""),
      required("VOS_QA_AGENT_TOKEN"),
    );
  }
  async answer(
    input: Parameters<QaAgentClient["answer"]>[0],
  ): Promise<QaAgentResponse> {
    const response = await fetch(`${this.endpoint}/api/v1/agent/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        task_kind: "knowledgebase_qa",
        task: input.question,
        project_id: input.project_id,
        user_id: input.actor_id,
        thread_id: input.thread_id,
        model: input.model,
        provider_envelope: await encryptProviderEnvelope(
          input.provider,
          this.token,
          `${input.project_id}:${input.thread_id}:${input.actor_id}:${input.model}`,
        ),
        course_mode: true,
        max_iterations: 6,
        disabled_tools: ["WebSearch", "WebFetch"],
        context: { stage_key: input.stage_key, conversation: input.history },
        policy_flags: [
          "student-visible",
          "no-hidden-tests",
          "no-grade-decision",
        ],
      }),
    });
    if (!response.ok)
      throw new Error(`vos-agent Q&A failed: HTTP ${response.status}`);
    const raw = (await response.json()) as Record<string, unknown>;
    const structured = raw.structured_output as
      | Record<string, unknown>
      | undefined;
    if (
      typeof raw.content !== "string" ||
      typeof raw.model !== "string" ||
      typeof raw.session_id !== "string" ||
      !structured ||
      typeof structured.answer !== "string" ||
      !Array.isArray(structured.citations)
    )
      throw new Error(
        "vos-agent Q&A response violates the knowledgebase contract",
      );
    const usage = raw.usage as Record<string, unknown> | undefined;
    if (
      !usage ||
      ![usage.input_tokens, usage.output_tokens, usage.total_tokens].every(
        (value) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0,
      )
    )
      throw new Error("vos-agent Q&A response is missing valid token usage");
    return {
      content: raw.content,
      model: raw.model,
      session_id: raw.session_id,
      structured_output: {
        answer: structured.answer,
        citations: structured.citations.filter(
          (item): item is Record<string, string> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        ) as Record<string, string>[],
        risk_flags: Array.isArray(structured.risk_flags)
          ? structured.risk_flags.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
      },
      usage: {
        input_tokens: Number(usage.input_tokens),
        output_tokens: Number(usage.output_tokens),
        total_tokens: Number(usage.total_tokens),
      },
    };
  }
}

export async function dispatchQaOne(
  sql: Sql,
  agent: QaAgentClient,
  workerId: string,
  providers: ModelProviderRuntimeSource,
): Promise<boolean> {
  const claimed = await sql.begin(
    async (tx) =>
      await tx`update outbox_events set lease_owner=${workerId},leased_until=now()+interval '2 minutes',attempts=attempts+1 where id=(select id from outbox_events where topic='qa.agent.requested' and published_at is null and next_attempt_at<=now() and (leased_until is null or leased_until<now()) order by created_at,id limit 1 for update skip locked) returning *`,
  );
  const event = claimed[0];
  if (!event) return false;
  const payload = event.payload as {
    thread_id?: unknown;
    message_id?: unknown;
    actor_id?: unknown;
    provider_id?: unknown;
    model?: unknown;
    usage_id?: unknown;
  };
  const threadId = String(payload.thread_id ?? "");
  const messageId = String(payload.message_id ?? "");
  const actorId = String(payload.actor_id ?? "");
  const providerId = String(payload.provider_id ?? "");
  const model = String(payload.model ?? "");
  const usageId = String(payload.usage_id ?? "");
  try {
    const rows =
      await sql`select qt.project_id,qt.stage_key,qm.content,c.id course_id,cap.policy,u.status usage_status,u.provider_id,u.model from qa_threads qt join qa_messages qm on qm.id=${messageId} and qm.thread_id=qt.id join projects p on p.id=qt.project_id join experiments e on e.id=p.experiment_id join courses c on c.id=e.course_id left join course_ai_policies cap on cap.course_id=c.id and cap.manifest_version=c.published_manifest_version join model_usage_ledger u on u.id=${usageId} and u.request_message_id=qm.id where qt.id=${threadId} and qm.role='user' and qm.requested_by=${actorId}`;
    if (!rows[0])
      throw new Error("Q&A outbox references an inaccessible message");
    if (
      rows[0].usage_status !== "reserved" ||
      rows[0].provider_id !== providerId ||
      rows[0].model !== model
    )
      throw new Error("Q&A outbox does not match its model usage reservation");
    const policy = (rows[0].policy ?? {}) as { allowed_models?: unknown };
    if (
      !Array.isArray(policy.allowed_models) ||
      !policy.allowed_models.includes(model)
    )
      throw new Error(
        `model ${model} is not allowed by the published course policy`,
      );
    const provider = await providers.runtime(providerId);
    if (!provider.models.includes(model))
      throw new Error("reserved model is no longer supported by its Provider");
    const history =
      await sql`select role,content from qa_messages where thread_id=${threadId} and created_at<=(select created_at from qa_messages where id=${messageId}) order by created_at,id limit 40`;
    const result = await agent.answer({
      thread_id: threadId,
      project_id: String(rows[0].project_id),
      actor_id: actorId,
      stage_key: String(rows[0].stage_key),
      question: String(rows[0].content),
      history: history.map((row) => ({
        role: String(row.role),
        content: String(row.content),
      })),
      model,
      provider,
    });
    if (result.model !== model)
      throw new Error(
        "vos-agent returned a different model than the reserved model",
      );
    const actualCost =
      (result.usage.input_tokens / 1_000_000) *
        provider.inputCostPerMillionUsd +
      (result.usage.output_tokens / 1_000_000) *
        provider.outputCostPerMillionUsd;
    const refs = result.structured_output.citations.map((item) =>
      JSON.stringify(item).slice(0, 1000),
    );
    await sql.begin(async (tx) => {
      await tx`insert into qa_messages(id,thread_id,role,content,object_refs,request_message_id,status) values(${`message-${crypto.randomUUID()}`},${threadId},'assistant',${result.structured_output.answer},${tx.json(refs)},${messageId},'completed')`;
      await tx`insert into agent_audits(id,project_id,actor_id,thread_id,request_message_id,provider,model,task_kind,risk_level,risk_flags,prompt_summary,response_summary,provider_session_id,input_tokens,output_tokens,total_tokens,actual_cost_usd) values(${`agent-audit-${crypto.randomUUID()}`},${String(rows[0].project_id)},${actorId},${threadId},${messageId},${providerId},${result.model},'knowledgebase_qa','low',${tx.json(result.structured_output.risk_flags ?? [])},${String(rows[0].content).slice(0, 500)},${result.structured_output.answer.slice(0, 500)},${result.session_id},${result.usage.input_tokens},${result.usage.output_tokens},${result.usage.total_tokens},${actualCost})`;
      const settled =
        await tx`update model_usage_ledger set status='settled',input_tokens=${result.usage.input_tokens},output_tokens=${result.usage.output_tokens},total_tokens=${result.usage.total_tokens},actual_cost_usd=${actualCost},provider_session_id=${result.session_id},settled_at=now() where id=${usageId} and status='reserved' returning id`;
      if (!settled[0])
        throw new Error("model usage reservation could not be settled");
      await tx`update outbox_events set published_at=now(),lease_owner=null,leased_until=null,last_error=null where id=${String(event.id)} and lease_owner=${workerId}`;
    });
  } catch (error) {
    const detail = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 1000);
    const attempts = Number(event.attempts);
    const terminal = attempts >= 5;
    console.error(
      JSON.stringify({
        level: "error",
        event: "qa_agent_failed",
        worker_id: workerId,
        thread_id: threadId,
        message_id: messageId,
        attempt: attempts,
        terminal,
        error: detail,
      }),
    );
    await sql.begin(async (tx) => {
      await tx`update outbox_events set lease_owner=null,leased_until=null,last_error=${detail},next_attempt_at=${terminal ? tx`'infinity'::timestamptz` : new Date(Date.now() + Math.min(300, 2 ** attempts) * 1000)} where id=${String(event.id)} and lease_owner=${workerId}`;
      if (terminal && usageId)
        await tx`update model_usage_ledger set status='released',settled_at=now() where id=${usageId} and status='reserved'`;
    });
  }
  return true;
}
async function encryptProviderEnvelope(
  provider: RuntimeModelProvider,
  token: string,
  context: string,
): Promise<{ version: 1; iv: string; ciphertext: string }> {
  const keyBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      kind: provider.kind,
      base_url: provider.baseUrl,
      secret: provider.secret,
      max_output_tokens: provider.maxOutputTokens,
    }),
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    plaintext,
  );
  return {
    version: 1,
    iv: base64Url(iv),
    ciphertext: base64Url(new Uint8Array(ciphertext)),
  };
}
function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
