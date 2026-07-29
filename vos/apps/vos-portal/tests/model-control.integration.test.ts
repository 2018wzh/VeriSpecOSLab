import { expect, test } from "bun:test";
import postgres from "postgres";
import { ModelControlService } from "../server/model-control.ts";

const databaseUrl = process.env.VOS_PORTAL_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration(
  "model Provider credentials, optimistic revisions, idempotency, and manifest-capped quotas are transactional",
  async () => {
    const sql = postgres(databaseUrl!, { max: 4, prepare: false });
    const prefix = `model-${crypto.randomUUID()}`,
      admin = `${prefix}-admin`,
      student = `${prefix}-student`,
      course = `${prefix}-course`,
      providerId = `${prefix}-provider`;
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = "";
    for (const byte of keyBytes) binary += String.fromCharCode(byte);
    const masterKey = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const adminActor = {
        id: admin,
        username: admin,
        display_name: "Admin",
        role: "admin" as const,
      },
      studentActor = {
        id: student,
        username: student,
        display_name: "Student",
        role: "student" as const,
      };
    try {
      await sql.begin(async (tx) => {
        await tx`insert into users(id,username,display_name,role,status) values(${admin},${admin},'Admin','admin','active'),(${student},${student},'Student','student','active')`;
      await tx`insert into courses(id,code,name,term,status,manifest_version,published_manifest_version,manifest) values(${course},${prefix},'Model Course','test','active',1,1,${tx.json({})})`;
      await tx`insert into course_manifest_versions(course_id,version,state,manifest,checksum,created_by,reason,published_at) values(${course},1,'published',${tx.json({})},${"b".repeat(64)},${admin},'integration model control fixture',now())`;
        await tx`insert into course_ai_policies(course_id,manifest_version,policy) values(${course},1,${tx.json({ allowed_models: ["school-model"], monthly_budget: 25, allow_byok: false })})`;
        await tx`insert into course_memberships(course_id,user_id,role,status,source) values(${course},${student},'student','active','manual')`;
      });
      const service = await ModelControlService.create(sql, masterKey);
      const providerInput = {
        version: "model-provider-input.v1" as const,
        id: providerId,
        name: "School Provider",
        kind: "openai-compatible" as const,
        base_url: "https://models.example.edu/v1",
        models: ["school-model"],
        default_model: "school-model",
        secret: "provider-secret-at-least-sixteen",
        input_cost_per_million_usd: 1,
        output_cost_per_million_usd: 2,
        max_output_tokens: 4096,
        enabled: true,
        expected_revision: 0,
        reason: "configure integration school Provider",
      };
      const saved = await service.saveProvider(
        adminActor,
        providerInput,
        "trace-model",
        "provider-key-0001",
        "provider-hash-0001",
      );
      expect(saved.secret_configured).toBe(true);
      expect(saved.revision).toBe(1);
      expect(
        await service.saveProvider(
          adminActor,
          providerInput,
          "trace-replay",
          "provider-key-0001",
          "provider-hash-0001",
        ),
      ).toEqual(saved);
      const stored = (
        await sql`select secret_cipher from model_providers where id=${providerId}`
      )[0].secret_cipher as Uint8Array;
      expect(new TextDecoder().decode(stored)).not.toContain(
        providerInput.secret,
      );
      expect((await service.runtime(providerId)).secret).toBe(
        providerInput.secret,
      );
      await expect(service.providers(studentActor)).rejects.toThrow(
        "administrator",
      );
      const quota = await service.saveQuota(
        adminActor,
        {
          version: "model-quota-policy-input.v1",
          course_id: course,
          monthly_request_limit: 100,
          monthly_token_limit: 100000,
          monthly_cost_limit_usd: 20,
          enabled: true,
          expected_revision: 0,
          reason: "configure integration course quota",
        },
        "trace-quota",
        "quota-key-0001",
        "quota-hash-0001",
      );
      expect(quota.monthly_cost_limit_usd).toBe(20);
      await expect(
        service.saveQuota(
          adminActor,
          {
            version: "model-quota-policy-input.v1",
            course_id: course,
            monthly_request_limit: 100,
            monthly_token_limit: 100000,
            monthly_cost_limit_usd: 30,
            enabled: true,
            expected_revision: quota.revision,
            reason: "attempt over manifest budget quota",
          },
          "trace-over",
          "quota-key-0002",
          "quota-hash-0002",
        ),
      ).rejects.toThrow("monthly_budget");
    } finally {
      await sql`delete from idempotency_keys where actor_id=${admin}`;
      await sql`delete from audit_events where actor_id=${admin}`;
      await sql`delete from model_quota_policies where course_id=${course}`;
      await sql`delete from model_providers where id=${providerId}`;
      await sql`delete from course_memberships where course_id=${course}`;
      await sql`delete from course_ai_policies where course_id=${course}`;
      await sql`delete from course_manifest_versions where course_id=${course}`;
      await sql`delete from courses where id=${course}`;
      await sql`delete from users where id in (${admin},${student})`;
      await sql.end({ timeout: 5 });
    }
  },
  30_000,
);
