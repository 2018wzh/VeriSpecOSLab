import type { Sql } from "postgres";
import { db } from "../storage/database.ts";
import { GiteaClient } from "../storage/gitea.ts";
import { S3ObjectStore } from "../storage/s3.ts";
import { dispatchQaOne, VosAgentQaClient } from "./qa-agent.ts";
import { ModelControlService } from "../server/model-control.ts";
import { collectRunnerEvidence } from "./runner-evidence.ts";
import { DockerRunnerRuntime } from "./docker-runner.ts";
import { ModelCredentialService } from "../server/model-credentials.ts";
import { WorkerControlClient } from "./control-client.ts";

const TERMINAL_STATUSES = new Set([
  "passed",
  "ok",
  "partial",
  "agent_output_error",
  "planned",
  "not_implemented",
  "policy_blocked",
  "validation_failed",
  "failed",
  "cancelled",
  "timed_out",
]);

export function portalRunStatus(
  status: string,
): "passed" | "failed" | "cancelled" | "timed_out" {
  if (status === "passed" || status === "ok") return "passed";
  if (status === "cancelled") return "cancelled";
  if (status === "timed_out") return "timed_out";
  return "failed";
}
export const MAX_PROVISION_ATTEMPTS = 5;

export async function provisionOne(
  sql: Sql,
  gitea: GiteaClient,
  workerId: string,
  webhookUrl: string,
  webhookSecret: string,
): Promise<boolean> {
  const claimed = await sql.begin(
    async (tx) =>
      await tx`update outbox_events set lease_owner=${workerId},leased_until=now()+interval '2 minutes',attempts=attempts+1 where id=(select id from outbox_events where topic='project.provision.requested' and published_at is null and next_attempt_at<=now() and (leased_until is null or leased_until<now()) order by created_at,id limit 1 for update skip locked) returning *`,
  );
  const event = claimed[0];
  if (!event) return false;
  const projectId = String(event.aggregate_id);
  try {
    const rows = await sql.begin(async (tx) => {
      const repositories =
        await tx`update project_repositories set status='provisioning',attempts=attempts+1,last_error=null,updated_at=now() where project_id=${projectId} and status in ('queued','provisioning') returning *`;
      if (!repositories[0])
        throw new Error("project repository is not queued for provisioning");
      const collaborators =
        await tx`select u.username from project_members pm join users u on u.id=pm.user_id where pm.project_id=${projectId} and u.status='active' and u.deleted_at is null order by u.username`;
      if (!collaborators.length)
        throw new Error("project has no active Gitea collaborators");
      return [
        {
          ...repositories[0],
          collaborators: collaborators.map((row) => String(row.username)),
        },
      ];
    });
    const repository = rows[0] as Record<string, unknown> & {
      collaborators: string[];
    };
    const provisioned = await gitea.provision({
      owner: String(repository.owner_name),
      name: String(repository.repository_name),
      template_owner: String(repository.template_owner),
      template_repo: String(repository.template_repository),
      description: String(repository.description),
      private: Boolean(repository.is_private),
      collaborators: repository.collaborators,
      webhook_url: webhookUrl,
      webhook_secret: webhookSecret,
    });
    await sql.begin(async (tx) => {
      const updated =
        await tx`update project_repositories set status='active',provider_repository_id=${provisioned.id},clone_url=${provisioned.clone_url},html_url=${provisioned.html_url},last_error=null,updated_at=now() where project_id=${projectId} and status='provisioning' returning project_id`;
      if (!updated.length)
        throw new Error(
          "project repository state changed before provisioning completed",
        );
      await tx`update projects set status='active',repo_url=${provisioned.clone_url},updated_at=now(),version=version+1 where id=${projectId} and status='provisioning'`;
      await tx`update outbox_events set published_at=now(),lease_owner=null,leased_until=null,last_error=null where id=${String(event.id)} and lease_owner=${workerId}`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${`audit-${crypto.randomUUID()}`},null,'project.provision.complete','project',${projectId},'Gitea repository provisioned',${`worker-${crypto.randomUUID()}`},${tx.json({ worker_id: workerId, repository: provisioned.full_name, provider_repository_id: provisioned.id })})`;
    });
  } catch (error) {
    const detail = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 1000);
    const attempts = Number(event.attempts);
    const terminal = attempts >= MAX_PROVISION_ATTEMPTS;
    console.error(
      JSON.stringify({
        level: "error",
        event: "project_provision_failed",
        worker_id: workerId,
        project_id: projectId,
        attempt: attempts,
        terminal,
        error: detail,
      }),
    );
    await sql.begin(async (tx) => {
      await tx`update project_repositories set status=${terminal ? "failed" : "queued"},last_error=${detail},updated_at=now() where project_id=${projectId}`;
      if (terminal)
        await tx`update outbox_events set lease_owner=null,leased_until=null,last_error=${detail},next_attempt_at='infinity'::timestamptz where id=${String(event.id)} and lease_owner=${workerId}`;
      else
        await tx`update outbox_events set lease_owner=null,leased_until=null,last_error=${detail},next_attempt_at=${new Date(Date.now() + Math.min(300, 2 ** attempts) * 1000)} where id=${String(event.id)} and lease_owner=${workerId}`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${`audit-${crypto.randomUUID()}`},null,'project.provision.failure','project',${projectId},'Gitea repository provisioning failed',${`worker-${crypto.randomUUID()}`},${tx.json({ worker_id: workerId, attempt: attempts, terminal, error: detail })})`;
    });
  }
  return true;
}

export async function dispatchCoursePublishedOne(
  sql: Sql,
  workerId: string,
): Promise<boolean> {
  const claimed = await sql.begin(
    async (tx) =>
      await tx`update outbox_events set lease_owner=${workerId},leased_until=now()+interval '2 minutes',attempts=attempts+1 where id=(select id from outbox_events where topic='course.published' and published_at is null and next_attempt_at<=now() and (leased_until is null or leased_until<now()) order by created_at,id limit 1 for update skip locked) returning *`,
  );
  const event = claimed[0];
  if (!event) return false;
  const courseId = String(event.aggregate_id);
  try {
    await sql.begin(async (tx) => {
      const course =
        await tx`select name from courses where id=${courseId} and deleted_at is null`;
      if (!course[0])
        throw new Error("course publish outbox references a missing course");
      const payload = event.payload as { manifest_version?: unknown };
      if (typeof payload.manifest_version !== "number")
        throw new Error(
          "course publish outbox payload has no manifest version",
        );
      const members =
        await tx`select user_id from course_memberships where course_id=${courseId} and status='active'`;
      for (const member of members)
        await tx`insert into notifications(id,user_id,title,body) values(${`notification-${crypto.randomUUID()}`},${String(member.user_id)},'课程版本已发布',${`${String(course[0].name)} v${payload.manifest_version} 已发布`})`;
      await tx`update outbox_events set published_at=now(),lease_owner=null,leased_until=null,last_error=null where id=${String(event.id)} and lease_owner=${workerId}`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${`audit-${crypto.randomUUID()}`},null,'outbox.course.published','course',${courseId},'course publish notification dispatched',${`worker-${crypto.randomUUID()}`},${tx.json({ worker_id: workerId, manifest_version: payload.manifest_version, recipients: members.length })})`;
    });
  } catch (error) {
    const detail = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 1000);
    const attempts = Number(event.attempts);
    const terminal = attempts >= MAX_PROVISION_ATTEMPTS;
    console.error(
      JSON.stringify({
        level: "error",
        event: "course_publish_dispatch_failed",
        worker_id: workerId,
        course_id: courseId,
        attempt: attempts,
        terminal,
        error: detail,
      }),
    );
    await sql.begin(async (tx) => {
      if (terminal)
        await tx`update outbox_events set lease_owner=null,leased_until=null,last_error=${detail},next_attempt_at='infinity'::timestamptz where id=${String(event.id)} and lease_owner=${workerId}`;
      else
        await tx`update outbox_events set lease_owner=null,leased_until=null,last_error=${detail},next_attempt_at=${new Date(Date.now() + Math.min(300, 2 ** attempts) * 1000)} where id=${String(event.id)} and lease_owner=${workerId}`;
    });
  }
  return true;
}

async function waitForRun(
  endpoint: string,
  accessToken: string,
  remoteRunId: string,
  portalRunId: string,
  workerId: string,
  signal: AbortSignal,
  diagnostics: () => Promise<string[]>,
  control: WorkerControlClient,
): Promise<{ status: string; error?: string }> {
  let lastHeartbeatAt = 0;
  const deadline =
    Date.now() + Number(process.env.VOS_RUNNER_TIMEOUT_MS ?? 1_800_000);
  while (Date.now() < deadline && !signal.aborted) {
    if (Date.now() - lastHeartbeatAt >= 20_000) {
      const heartbeat = await control.heartbeat(portalRunId);
      lastHeartbeatAt = Date.now();
      if (heartbeat.run_status === "cancelled") {
        await fetch(
          `${endpoint}/api/v1/runs/${encodeURIComponent(remoteRunId)}/cancel`,
          { method: "POST", signal, headers: runnerHeaders(accessToken) },
        ).catch((error) =>
          console.warn(
            JSON.stringify({
              level: "warn",
              event: "runner_cancel_failed",
              portal_run_id: portalRunId,
              remote_run_id: remoteRunId,
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
        return { status: "cancelled" };
      }
    }
    const response = await fetch(
      `${endpoint}/api/v1/runs/${encodeURIComponent(remoteRunId)}`,
      { signal, headers: runnerHeaders(accessToken) },
    );
    if (!response.ok)
      throw new Error(`vos serve status failed: HTTP ${response.status}`);
    const summary = (await response.json()) as {
      status: string;
      error?: string;
    };
    if (TERMINAL_STATUSES.has(summary.status)) return summary;
    await Bun.sleep(500);
  }
  if (signal.aborted) throw new Error("worker shutdown interrupted active run");
  await fetch(
    `${endpoint}/api/v1/runs/${encodeURIComponent(remoteRunId)}/cancel`,
    { method: "POST", headers: runnerHeaders(accessToken) },
  ).catch((error) =>
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "runner_timeout_cancel_failed",
        portal_run_id: portalRunId,
        remote_run_id: remoteRunId,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
  );
  const files = await diagnostics().catch(() => []);
  return {
    status: "timed_out",
    error: `runner deadline exceeded; diagnostics=${JSON.stringify(files)}`,
  };
}

export async function runWorker(signal: AbortSignal): Promise<void> {
  const sql = db();
  const workerId =
    process.env.VOS_PORTAL_WORKER_ID ?? `worker-${crypto.randomUUID()}`;
  const control = WorkerControlClient.fromEnv(workerId);
  const runtime = DockerRunnerRuntime.fromEnv();
  const gitea = GiteaClient.fromEnv();
  const webhookUrl = required("VOS_GITEA_WEBHOOK_URL");
  const webhookSecret = required("VOS_GITEA_WEBHOOK_SECRET");
  const qaAgent = VosAgentQaClient.fromEnv();
  const modelControl = await ModelControlService.create(
    sql,
    required("VOS_PORTAL_MASTER_KEY"),
  );
  const objectStore = S3ObjectStore.fromEnv();
  const credentials = await ModelCredentialService.create(
    sql,
    required("VOS_PORTAL_MASTER_KEY"),
  );
  let lastWorkerHeartbeatAt = 0;
  while (!signal.aborted) {
    if (Date.now() - lastWorkerHeartbeatAt >= 20_000) {
      await control.heartbeat();
      lastWorkerHeartbeatAt = Date.now();
    }
    if (
      await recoverExpiredPipelineLeaseOne(
        sql,
        workerId,
        async (runId) => await runtime.cleanupRun(runId),
      )
    )
      continue;
    if (await provisionOne(sql, gitea, workerId, webhookUrl, webhookSecret))
      continue;
    if (await dispatchCoursePublishedOne(sql, workerId)) continue;
    if (await dispatchQaOne(sql, qaAgent, workerId, modelControl)) continue;
    if (await dispatchAuditOutboxOne(sql, workerId)) continue;
    const lease = await control.lease();
    const run = lease?.run;
    if (!run) {
      await Bun.sleep(500);
      continue;
    }
    await control.heartbeat(String(run.id));
    lastWorkerHeartbeatAt = Date.now();
    const terminalContext = {
      remoteRunId: "not-started",
      evidence: 0,
      objects: 0,
      imageId: "not-started",
      containerId: "not-started",
    };
    try {
      const modelCredential = await credentials.leaseForRun(
        String(run.id),
        workerId,
        `worker-${crypto.randomUUID()}`,
      );
      const session = await runtime.start({
        portalRunId: String(run.id),
        projectId: String(run.project_id),
        repositoryUrl: lease.repository.url,
        commitSha: String(run.commit_sha),
        stageKey: String(run.stage_key),
        scope: String(run.scope),
        policySnapshotRef: String(run.policy_snapshot_ref),
        courseAdapter: lease.run.course_adapter,
        actor: {
          id: lease.actor.id,
          username: lease.actor.username,
          role: lease.actor.role,
        },
        commitLedger: {
          commit_sha: lease.commit_ledger.after_sha,
          parent_sha: lease.commit_ledger.before_sha,
          actor: "human",
          run_id: `gitea-${lease.commit_ledger.delivery_id}`,
          spec_refs: [],
          changed_targets: [],
          evidence_refs: [],
          collaboration_intent: `signed Gitea push by ${lease.commit_ledger.pusher_username ?? "unknown"}`,
          created_at: lease.commit_ledger.received_at,
        },
        modelCredential,
      });
      const base = session.endpoint.replace(/\/$/, "");
      terminalContext.imageId = session.imageId;
      terminalContext.containerId = session.containerId;
      try {
        const response = await fetch(`${base}/api/v1/verify/runs`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            "content-type": "application/json",
            "x-vos-worker-id": workerId,
          },
          body: JSON.stringify({
            requested_by: workerId,
            reason: run.reason,
            scope: run.scope === "public" ? "public" : "full",
          }),
        });
        if (!response.ok) {
          const detail = (await response.text())
            .replace(/[\r\n]+/g, " ")
            .slice(0, 1000);
          throw new Error(
            `vos serve rejected run: HTTP ${response.status}${detail ? ` ${detail}` : ""}`,
          );
        }
        const remote = (await response.json()) as { run_id: string };
        terminalContext.remoteRunId = remote.run_id;
        await control.start(String(run.id), remote.run_id);
        const completed = await waitForRun(
          base,
          session.accessToken,
          remote.run_id,
          String(run.id),
          workerId,
          signal,
          session.diagnostics,
          control,
        );
        const finalStatus = portalRunStatus(completed.status);
        let collected;
        try {
          collected =
            finalStatus === "cancelled" || finalStatus === "timed_out"
              ? undefined
              : await collectRunnerEvidence({
                  store: objectStore,
                  workerId,
                  endpoint: base,
                  accessToken: session.accessToken,
                  remoteRunId: remote.run_id,
                  portalRun: {
                    id: String(run.id),
                    project_id: String(run.project_id),
                    commit_sha: String(run.commit_sha),
                    policy_snapshot_ref: String(run.policy_snapshot_ref),
                    scope: String(run.scope),
                    stage_key: String(run.stage_key),
                  },
                });
        } catch (error) {
          const files = await session.diagnostics().catch(() => []);
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}; runner_error=${completed.error ?? "none"}; runner_files=${JSON.stringify(files)}`,
          );
        }
        if (collected) {
          const manifestPassed = ["passed", "ok"].includes(
            collected.manifest.status,
          );
          if ((finalStatus === "passed") !== manifestPassed)
            throw new Error("runner status and evidence manifest disagree");
        }
        if (collected) {
          await control.reportEvidence(String(run.id), collected.report);
          terminalContext.evidence = collected.report.evidence.length;
          terminalContext.objects = collected.report.objects.length;
        }
        await control.complete(String(run.id), {
          version: "worker-run-complete.v1",
          worker_id: workerId,
          remote_run_id: remote.run_id,
          status: finalStatus,
          failure_class:
            finalStatus === "failed" ? "verification_failure" : undefined,
          runner_error: completed.error,
          manifest_status: collected?.manifest.status,
          manifest_message: collected?.manifest.message,
          evidence_records: collected?.report.evidence.length ?? 0,
          objects: collected?.report.objects.length ?? 0,
          runner_image_id: session.imageId,
          runner_container_id: session.containerId,
        });
      } finally {
        await session.cleanup();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          level: "error",
          event: "pipeline_worker_failed",
          worker_id: workerId,
          run_id: String(run.id),
          error: detail,
        }),
      );
      await control
        .complete(String(run.id), {
          version: "worker-run-complete.v1",
          worker_id: workerId,
          remote_run_id: terminalContext.remoteRunId,
          status: "failed",
          failure_class: "infra_failure",
          runner_error: detail,
          evidence_records: terminalContext.evidence,
          objects: terminalContext.objects,
          runner_image_id: terminalContext.imageId,
          runner_container_id: terminalContext.containerId,
        })
        .catch((controlError) =>
          console.error(
            JSON.stringify({
              level: "error",
              event: "pipeline_worker_failure_report_rejected",
              worker_id: workerId,
              run_id: String(run.id),
              error:
                controlError instanceof Error
                  ? controlError.message
                  : String(controlError),
            }),
          ),
        );
    }
  }
}

export async function dispatchAuditOutboxOne(
  sql: Sql,
  workerId: string,
): Promise<boolean> {
  const rows = await sql.begin(
    async (tx) =>
      await tx`update outbox_events set lease_owner=${workerId},leased_until=now()+interval '2 minutes',attempts=attempts+1 where id=(select id from outbox_events where topic='audit.recorded' and published_at is null and next_attempt_at<=now() and (leased_until is null or leased_until<now()) order by created_at,id limit 1 for update skip locked) returning id,payload`,
  );
  const event = rows[0];
  if (!event) return false;
  console.info(
    JSON.stringify({
      level: "info",
      event: "audit_outbox_published",
      worker_id: workerId,
      ...(event.payload as Record<string, unknown>),
    }),
  );
  const published =
    await sql`update outbox_events set published_at=now(),lease_owner=null,leased_until=null,last_error=null where id=${String(event.id)} and lease_owner=${workerId} and published_at is null returning id`;
  if (!published[0])
    throw new Error(
      "audit outbox lease ownership was lost before publish acknowledgement",
    );
  return true;
}

export async function recoverExpiredPipelineLeaseOne(
  sql: Sql,
  workerId: string,
  cleanup: (runId: string) => Promise<number>,
): Promise<boolean> {
  const recoveryOwner = `${workerId}.recovery`;
  const claimed = await sql.begin(
    async (tx) =>
      await tx`with candidate as (select id,lease_owner from pipeline_runs where status in ('leased','running') and leased_until<now() order by leased_until,id limit 1 for update skip locked), updated as (update pipeline_runs run set lease_owner=${recoveryOwner},leased_until=now()+interval '2 minutes' from candidate where run.id=candidate.id returning run.id) select updated.id,candidate.lease_owner previous_owner from updated join candidate on candidate.id=updated.id`,
  );
  if (!claimed[0]) return false;
  const runId = String(claimed[0].id);
  const previousOwner = String(claimed[0].previous_owner ?? "unknown");
  let removed: number;
  try {
    removed = await cleanup(runId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sql.begin(async (tx) => {
      await tx`update pipeline_runs set leased_until=now() where id=${runId} and lease_owner=${recoveryOwner}`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${`audit-${crypto.randomUUID()}`},null,'runner.recovery.failure','pipeline',${runId},'expired runner cleanup failed',${`worker-${crypto.randomUUID()}`},${tx.json({ worker_id: workerId, previous_owner: previousOwner, error: detail })})`;
    });
    throw error;
  }
  await sql.begin(async (tx) => {
    const failed =
      await tx`update pipeline_runs set status='failed',failure_class='infra_failure',public_message='评测 worker 租约过期，已安全终止，请由课程团队批准补跑',finished_at=now(),lease_owner=null,leased_until=null where id=${runId} and lease_owner=${recoveryOwner} and status in ('leased','running') returning id`;
    if (!failed[0]) throw new Error("expired pipeline recovery lease was lost");
    await tx`update model_credential_leases set revoked_at=coalesce(revoked_at,now()) where run_id=${runId}`;
    const seq =
      await tx`select coalesce(max(sequence),-1)+1 sequence from pipeline_events where run_id=${runId}`;
    await tx`insert into pipeline_events(run_id,sequence,event_type,visibility,payload) values(${runId},${Number(seq[0].sequence)},'finished','student',${tx.json({ status: "failed", failure_class: "infra_failure" })})`;
    await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${`audit-${crypto.randomUUID()}`},null,'runner.recovered_expired_lease','pipeline',${runId},'expired runner lease was recovered and failed closed',${`worker-${crypto.randomUUID()}`},${tx.json({ worker_id: workerId, previous_owner: previousOwner, containers_removed: removed })})`;
  });
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "pipeline_expired_lease_recovered",
      worker_id: workerId,
      run_id: runId,
      previous_owner: previousOwner,
      containers_removed: removed,
    }),
  );
  return true;
}

function runnerHeaders(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
