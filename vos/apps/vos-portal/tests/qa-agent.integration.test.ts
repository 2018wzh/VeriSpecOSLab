import { expect, test } from "bun:test";
import postgres from "postgres";
import { PostgresPortalRepository } from "../server/postgres-repository.ts";
import {
  dispatchQaOne,
  type ModelProviderRuntimeSource,
  type QaAgentClient,
} from "../worker/qa-agent.ts";

const databaseUrl = process.env.VOS_PORTAL_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration(
  "Q&A reserves and settles quota through the selected course model Provider",
  async () => {
    const sql = postgres(databaseUrl!, { max: 8, prepare: false });
    const prefix = `qa-${crypto.randomUUID()}`;
    const user = `${prefix}-user`,
      course = `${prefix}-course`,
      experiment = `${prefix}-experiment`,
      stage = `${prefix}-stage`,
      project = `${prefix}-project`,
      providerId = `${prefix}-provider`;
    try {
      await sql.begin(async (tx) => {
        await tx`insert into users(id,username,display_name,role,status) values(${user},${user},'Q&A Student','student','active')`;
        await tx`insert into courses(id,code,name,term,status,manifest_version,published_manifest_version,manifest) values(${course},${prefix},'Q&A Course','test','active',1,1,${tx.json({})})`;
        await tx`insert into course_manifest_versions(course_id,version,state,manifest,checksum,created_by,reason,published_at) values(${course},1,'published',${tx.json({})},${"a".repeat(64)},${user},'integration Q&A policy fixture',now())`;
        await tx`insert into course_ai_policies(course_id,manifest_version,policy) values(${course},1,${tx.json({ allowed_models: ["test-model"], monthly_budget: 100, allow_byok: false })})`;
        await tx`insert into experiments(id,course_id,title,spec_version,publish_state) values(${experiment},${course},'Q&A Lab','v1','published')`;
        await tx`insert into stage_gates(id,experiment_id,key,name,sequence,status,config) values(${stage},${experiment},'design','Design',0,'open',${tx.json({ required_artifacts: [], required_evidence: [], manual_review_required: false })})`;
        await tx`insert into projects(id,experiment_id,current_stage_id,repo_url,status,policy_snapshot_ref) values(${project},${experiment},${stage},'https://git.example/qa.git','active','policy-qa')`;
        await tx`insert into project_members(project_id,user_id) values(${project},${user})`;
        await tx`insert into model_providers(id,name,kind,base_url,models,default_model,secret_cipher,secret_iv,input_cost_per_million_usd,output_cost_per_million_usd,max_output_tokens,enabled) values(${providerId},'Test Provider','openai-compatible','https://model.example/v1',${["test-model"]},'test-model',${new Uint8Array([1])},${new Uint8Array([2])},1,2,1024,true)`;
        await tx`insert into model_quota_policies(id,course_id,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,enabled) values(${`${prefix}-quota`},${course},100,1000000,100,true)`;
      });
      const repository = new PostgresPortalRepository(sql);
      const actor = {
        id: user,
        username: user,
        display_name: "Q&A Student",
        role: "student" as const,
      };
      const thread = await repository.ask(actor, {
        content: "为什么这里需要刷新 TLB？",
      },`${prefix}-trace-ask-1`,`${prefix}-key-ask-1`,`${prefix}-hash-ask-1`);
      let requests = 0;
      const provider = {
        id: providerId,
        kind: "openai-compatible" as const,
        baseUrl: "https://model.example/v1",
        models: ["test-model"],
        defaultModel: "test-model",
        secret: "test-secret",
        inputCostPerMillionUsd: 1,
        outputCostPerMillionUsd: 2,
        maxOutputTokens: 1024,
      };
      const providers: ModelProviderRuntimeSource = {
        async runtime(id) {
          expect(id).toBe(providerId);
          return provider;
        },
      };
      const agent: QaAgentClient = {
        async answer(input) {
          requests += 1;
          expect(input.model).toBe("test-model");
          expect(input.provider.id).toBe(providerId);
          return {
            content: "provider content",
            model: "test-model",
            session_id: `${prefix}-session`,
            structured_output: {
              answer: "因为页表修改后旧的 TLB 项仍可能被命中。",
              citations: [{ source: "memory-manual", section: "tlb" }],
              risk_flags: [],
            },
            usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 },
          };
        },
      };
      expect(await dispatchQaOne(sql, agent, "qa-worker", providers)).toBe(
        true,
      );
      expect(requests).toBe(1);
      const messages =
        await sql`select role,content,request_message_id from qa_messages where thread_id=${thread.id} order by created_at,id`;
      expect(messages.map((row) => row.role)).toEqual(["user", "assistant"]);
      expect(String(messages[1].request_message_id)).toBe(
        thread.messages[0].id,
      );
      const usages =
        await sql`select status,input_tokens,output_tokens,total_tokens,actual_cost_usd from model_usage_ledger where request_message_id=${thread.messages[0].id}`;
      expect(usages[0].status).toBe("settled");
      expect(Number(usages[0].total_tokens)).toBe(160);
      expect(Number(usages[0].actual_cost_usd)).toBeCloseTo(0.0002, 8);
      expect(
        (
          await sql`select count(*)::int count from agent_audits where thread_id=${thread.id}`
        )[0].count,
      ).toBe(1);
      expect(await dispatchQaOne(sql, agent, "qa-worker", providers)).toBe(
        false,
      );
      const failedThread = await repository.ask(actor, {
        content: "请解释另一个故障路径。",
      },`${prefix}-trace-ask-2`,`${prefix}-key-ask-2`,`${prefix}-hash-ask-2`);
      const failedMessage = failedThread.messages.at(-1)!;
      const failingAgent: QaAgentClient = {
        async answer() {
          throw new Error("controlled provider outage");
        },
      };
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect(
          await dispatchQaOne(sql, failingAgent, "qa-worker", providers),
        ).toBe(true);
        if (attempt < 5)
          await sql`update outbox_events set next_attempt_at=now() where topic='qa.agent.requested' and published_at is null and aggregate_id=${failedThread.id}`;
      }
      expect(
        (
          await sql`select status from model_usage_ledger where request_message_id=${failedMessage.id}`
        )[0].status,
      ).toBe("released");
      expect(
        await dispatchQaOne(sql, failingAgent, "qa-worker", providers),
      ).toBe(false);
    } finally {
      await sql`delete from agent_audits where project_id=${project}`;
      await sql`delete from audit_events where actor_id=${user}`;
      await sql`delete from model_usage_ledger where course_id=${course}`;
      await sql`delete from outbox_events where aggregate_id in (${project},${course},${`qa-${project}-design`})`;
      await sql`delete from qa_messages where thread_id in (select id from qa_threads where project_id=${project})`;
      await sql`delete from qa_threads where project_id=${project}`;
      await sql`delete from model_quota_policies where course_id=${course}`;
      await sql`delete from model_providers where id=${providerId}`;
      await sql`delete from project_members where project_id=${project}`;
      await sql`delete from projects where id=${project}`;
      await sql`delete from stage_gates where id=${stage}`;
      await sql`delete from experiments where id=${experiment}`;
      await sql`delete from course_ai_policies where course_id=${course}`;
      await sql`delete from course_manifest_versions where course_id=${course}`;
      await sql`delete from courses where id=${course}`;
      await sql`delete from users where id=${user}`;
      await sql.end({ timeout: 5 });
    }
  },
  30_000,
);
