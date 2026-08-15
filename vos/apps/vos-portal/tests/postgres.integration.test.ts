import { expect, test } from "bun:test";
import postgres from "postgres";
import { PostgresPortalRepository } from "../server/postgres-repository.ts";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration(
  "PostgreSQL migrations, authorization, idempotency and SKIP LOCKED leasing",
  async () => {
    const sql = postgres(databaseUrl!, { max: 24, prepare: false });
    const prefix = `it-${crypto.randomUUID()}`;
    const user = `${prefix}-user`;
    const outsider = `${prefix}-outsider`;
    const teacher = `${prefix}-teacher`;
    const course = `${prefix}-course`;
    const experiment = `${prefix}-experiment`;
    const stage = `${prefix}-stage`;
    const project = `${prefix}-project`;
    try {
      expect(
        (await sql`select version from schema_migrations order by version`).map(
          (row) => Number(row.version),
        ),
      ).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      ]);
      await sql.begin(async (tx) => {
        await tx`insert into users(id,username,display_name,role,status) values(${user},${user},'Integration Student','student','active'),(${outsider},${outsider},'Outsider','student','active'),(${teacher},${teacher},'Integration Teacher','teacher','active')`;
        await tx`insert into courses(id,code,name,term,status) values(${course},${prefix},'Integration Course','test','active')`;
        await tx`insert into course_memberships(course_id,user_id,role,status,source) values(${course},${teacher},'teacher','active','manual')`;
        await tx`insert into experiments(id,course_id,title,spec_version,publish_state) values(${experiment},${course},'Integration Lab','v1','published')`;
        await tx`insert into stage_gates(id,experiment_id,key,name,sequence,status,config) values(${stage},${experiment},'boot','Boot',0,'open',${tx.json({ required_artifacts: [], required_evidence: [], required_review_artifacts: ["hardware-report"], manual_review_required: true })})`;
        await tx`insert into projects(id,experiment_id,current_stage_id,repo_url,status,policy_snapshot_ref) values(${project},${experiment},${stage},'https://git.example/integration.git','active','policy-it')`;
        await tx`insert into project_members(project_id,user_id) values(${project},${user})`;
      });
      const repository = new PostgresPortalRepository(sql);
      const actor = {
        id: user,
        username: user,
        display_name: "Integration Student",
        role: "student" as const,
      };
      const objectId = `${prefix}-object`;
      await repository.registerObject(
        actor,
        {
          project_id: project,
          object_id: objectId,
          object_key: `projects/${project}/uploads/${objectId}`,
          uri: `s3://vos-artifacts/projects/${project}/uploads/${objectId}`,
          sha256: "a".repeat(64),
          size_bytes: 42,
          content_type: "application/json",
          visibility: "student",
          label: "integration evidence",
          lineage: { source: "integration" },
        },
        `${prefix}-object-trace`,
        `${prefix}-object-key`,
        `${prefix}-object-hash`,
      );
      expect(
        (await repository.objectManifest(actor, project)).objects,
      ).toHaveLength(0);
      expect((await repository.pendingObject(actor, objectId)).sha256).toBe(
        "a".repeat(64),
      );
      let accessError: unknown;
      try {
        await repository.pendingObject(
          {
            id: outsider,
            username: outsider,
            display_name: "Outsider",
            role: "student",
          },
          objectId,
        );
      } catch (error) {
        accessError = error;
      }
      expect(String(accessError)).toContain("无资源访问权限");
      await repository.completeObject(
        actor,
        objectId,
        `${prefix}-complete-trace`,
        `${prefix}-complete-key`,
        `${prefix}-complete-hash`,
      );
      expect(
        (await repository.objectManifest(actor, project)).objects,
      ).toHaveLength(1);
      const input = {
        version: "pipeline-request.v1" as const,
        project_id: project,
        commit_sha: "a".repeat(40),
        stage_key: "boot",
        scope: "public" as const,
        reason: "integration idempotency submission",
      };
      const runs = await Promise.all(
        Array.from({ length: 8 }, () =>
          repository.trigger(
            actor,
            input,
            "same-idempotency-key",
            "same-request-hash",
            `${prefix}-pipeline-trace`,
          ),
        ),
      );
      expect(new Set(runs.map((run) => run.id)).size).toBe(1);
      expect(
        (
          await sql`select count(*)::int count from pipeline_runs where project_id=${project}`
        )[0].count,
      ).toBe(1);
      const mutationAudits =
        await sql`select id,action from audit_events where actor_id=${user} and action in ('object.upload.request','object.upload.complete','pipeline.trigger')`;
      expect(new Set(mutationAudits.map((row) => String(row.action)))).toEqual(
        new Set([
          "object.upload.request",
          "object.upload.complete",
          "pipeline.trigger",
        ]),
      );
      expect(
        Number(
          (
            await sql`select count(*)::int count from outbox_events where topic='audit.recorded' and aggregate_id in ${sql(mutationAudits.map((row) => String(row.id)))}`
          )[0].count,
        ),
      ).toBe(3);
      await expect(
        repository.projectBinding(
          {
            id: outsider,
            username: outsider,
            display_name: "Outsider",
            role: "student",
          },
          project,
        ),
      ).rejects.toThrow("无资源访问权限");
      const commit = "b".repeat(40);
      await sql`insert into gitea_webhook_deliveries(delivery_id,event_type,repository_full_name,payload) values(${`${prefix}-delivery`},'push','integration/project',${sql.json({ ref: "refs/heads/main" })})`;
      await sql`insert into project_commit_ledger(id,project_id,delivery_id,ref_name,after_sha,pusher_username) values(${`${prefix}-commit`},${project},${`${prefix}-delivery`},'refs/heads/main',${commit},${user})`;
      const submissionInput = {
        version: "assessment-submission-request.v1" as const,
        project_id: project,
        commit_sha: commit,
        stage_key: "boot",
        spec_hash: "c".repeat(64),
        config_hash: "d".repeat(64),
        manifest_hash: "e".repeat(64),
        reason: "integration authoritative assessment submission",
      };
      const submission = await repository.createAssessmentSubmission(
        actor,
        submissionInput,
        `${prefix}-submission-trace`,
        `${prefix}-submission-key`,
        `${prefix}-submission-hash`,
      );
      expect(submission).toMatchObject({
        project_id: project,
        commit_sha: commit,
        status: "queued",
      });
      expect(
        (await repository.assessmentSubmission(actor, submission.id)).run_id,
      ).toBe(submission.run_id);
      await sql`update assessment_submissions set status='candidate' where id=${submission.id}`;
      await expect(
        repository.reviewAssessmentSubmission(
          { id: teacher, username: teacher, display_name: "Integration Teacher", role: "teacher" },
          { version: "assessment-review.v1", submission_id: submission.id, decision: "approve", reason: "attempt approval without required review artifact" },
          `${prefix}-review-missing-trace`,
          `${prefix}-review-missing-key`,
          `${prefix}-review-missing-hash`,
        ),
      ).rejects.toThrow("人工门禁缺少已验证复核材料 hardware-report");
      await sql`insert into object_refs(id,project_id,run_id,uri,object_key,sha256,size_bytes,content_type,visibility,label,upload_status) values(${`${prefix}-review-object`},${project},${submission.run_id},${`s3://vos-artifacts/${prefix}/hardware-report`},${`${prefix}/hardware-report`},${"f".repeat(64)},42,'application/json','student','hardware-report','verified')`;
      expect(
        (
          await repository.reviewAssessmentSubmission(
            { id: teacher, username: teacher, display_name: "Integration Teacher", role: "teacher" },
            { version: "assessment-review.v1", submission_id: submission.id, decision: "approve", reason: "verified required human gate evidence" },
            `${prefix}-review-trace`,
            `${prefix}-review-key`,
            `${prefix}-review-hash`,
          )
        ).status,
      ).toBe("complete");
      await expect(
        repository.createAssessmentSubmission(
          {
            id: outsider,
            username: outsider,
            display_name: "Outsider",
            role: "student",
          },
          submissionInput,
          "trace",
          "key",
          "hash",
        ),
      ).rejects.toThrow("无资源访问权限");
      await sql`delete from assessment_submissions where project_id=${project}`;
      await sql`delete from pipeline_events where run_id in (select id from pipeline_runs where project_id=${project})`;
      await sql`delete from idempotency_keys where actor_id=${user}`;
      await sql`delete from pipeline_runs where project_id=${project}`;
      for (let index = 0; index < 20; index++)
        await sql`insert into pipeline_runs(id,project_id,commit_sha,stage_key,scope,status,policy_snapshot_ref,requested_by,reason) values(${`${prefix}-run-${index}`},${project},${`abcdef${index.toString(16).padStart(6, "0")}`},'boot','public','queued','policy-it',${user},'integration queue lease')`;
      const claims = await Promise.all(
        Array.from({ length: 20 }, () =>
          sql.begin(
            async (tx) =>
              (
                await tx`update pipeline_runs set status='leased',leased_at=now() where id=(select id from pipeline_runs where project_id=${project} and status='queued' order by created_at,id limit 1 for update skip locked) returning id`
              )[0]?.id as string,
          ),
        ),
      );
      expect(new Set(claims).size).toBe(20);
      expect(
        (
          await sql`select count(*)::int count from pipeline_runs where project_id=${project} and status='queued'`
        )[0].count,
      ).toBe(0);
    } finally {
      await sql`delete from assessment_submissions where project_id=${project}`;
      await sql`delete from pipeline_events where run_id in (select id from pipeline_runs where project_id=${project})`;
      await sql`delete from audit_events where actor_id in (${user},${outsider},${teacher}) or resource_id in (select id from assessment_submissions where project_id=${project}) or (resource_type='project' and resource_id=${project})`;
      await sql`delete from idempotency_keys where actor_id in (${user},${outsider},${teacher})`;
      await sql`delete from object_refs where project_id=${project}`;
      await sql`delete from pipeline_runs where project_id=${project}`;
      await sql`delete from project_commit_ledger where project_id=${project}`;
      await sql`delete from gitea_webhook_deliveries where delivery_id=${`${prefix}-delivery`}`;
      await sql`delete from project_members where project_id=${project}`;
      await sql`delete from projects where id=${project}`;
      await sql`delete from stage_gates where id=${stage}`;
      await sql`delete from experiments where id=${experiment}`;
      await sql`delete from course_memberships where course_id=${course}`;
      await sql`delete from courses where id=${course}`;
      await sql`delete from users where id in (${user},${outsider},${teacher})`;
      await sql.end({ timeout: 5 });
    }
  },
  30_000,
);
