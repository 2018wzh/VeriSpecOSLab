import type { Sql } from "postgres";
import type {
  WorkerAckV1,
  WorkerEvidenceReportV1,
  WorkerHeartbeatResultV1,
  WorkerHeartbeatV1,
  WorkerPipelineLeaseV1,
  WorkerRunCompleteV1,
  WorkerRunStartV1,
} from "vos-core/portal-contracts";

type Row = Record<string, unknown>;
function identifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const COURSE_ADAPTERS: Record<string, "xv6-spec" | "glenda-spec"> = {
  "xv6-spec": "xv6-spec",
  "glenda-spec": "glenda-spec",
};
function courseAdapterForExperiment(
  experimentId: string,
): "xv6-spec" | "glenda-spec" | undefined {
  for (const [prefix, adapter] of Object.entries(COURSE_ADAPTERS)) {
    if (experimentId.startsWith(prefix)) return adapter;
  }
  return undefined;
}

export class WorkerControlService {
  constructor(
    private readonly sql: Sql,
    private readonly giteaUrl: string,
  ) {}

  async lease(workerId: string): Promise<WorkerPipelineLeaseV1 | null> {
    const result = await this.sql.begin(async (tx) => {
      const rows =
        await tx`update pipeline_runs set status='leased',leased_at=coalesce(leased_at,now()),lease_owner=${workerId},leased_until=now()+interval '2 minutes' where id=(select id from pipeline_runs where status='queued' order by created_at,id limit 1 for update skip locked) returning *`;
      const run = rows[0] as Row | undefined;
      if (!run) return null;
      const context =
        await tx`select pr.owner_name,pr.repository_name,u.id user_id,u.username,u.role,e.id experiment_id,pcl.delivery_id,pcl.before_sha,pcl.after_sha,pcl.pusher_username,pcl.received_at from project_repositories pr join projects p on p.id=pr.project_id join experiments e on e.id=p.experiment_id join users u on u.id=${String(run.requested_by)} join lateral(select * from project_commit_ledger where project_id=pr.project_id and after_sha=${String(run.commit_sha)} order by received_at desc,id desc limit 1) pcl on true where pr.project_id=${String(run.project_id)} and pr.status='active' and u.status='active' and u.deleted_at is null`;
      const current = context[0] as Row | undefined;
      if (!current) {
        const runId = String(run.id);
        const reason = "active Gitea binding or signed commit ledger entry is missing";
        await tx`update pipeline_runs set status='failed',failure_class='infra_failure',public_message='评测项目绑定或 commit ledger 不可用，已失败关闭',finished_at=now(),lease_owner=null,leased_until=null where id=${runId}`;
        await tx`update assessment_submissions set status='failed',completed_at=now() where run_id=${runId} and status in ('queued','evaluating')`;
        await tx`update outbox_events set published_at=now(),last_error=${reason} where topic='pipeline.queued' and aggregate_id=${runId} and published_at is null`;
        const seq =
          await tx`select coalesce(max(sequence),-1)+1 sequence from pipeline_events where run_id=${runId}`;
        await tx`insert into pipeline_events(run_id,sequence,event_type,visibility,payload) values(${runId},${Number(seq[0].sequence)},'finished','student',${tx.json({ status: "failed", failure_class: "infra_failure", reason: "missing_project_binding_or_commit_ledger" })})`;
        await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${identifier("audit")},null,'pipeline.lease_rejected','pipeline',${runId},${reason},${identifier("worker")},${tx.json({ worker_id: workerId, failure_class: "infra_failure", reason: "missing_project_binding_or_commit_ledger" })})`;
        return null;
      }
      await tx`update outbox_events set published_at=now(),last_error=null where topic='pipeline.queued' and aggregate_id=${String(run.id)} and published_at is null`;
      const seq =
        await tx`select coalesce(max(sequence),-1)+1 sequence from pipeline_events where run_id=${String(run.id)}`;
      await tx`insert into pipeline_events(run_id,sequence,event_type,visibility,payload) values(${String(run.id)},${Number(seq[0].sequence)},'leased','student',${tx.json({ worker_id: workerId })})`;
      return {
        version: "worker-pipeline-lease.v1",
        worker_id: workerId,
        lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
        run: {
          id: String(run.id),
          project_id: String(run.project_id),
          commit_sha: String(run.commit_sha),
          stage_key: String(run.stage_key),
          scope: run.scope as "public" | "staff" | "final",
          policy_snapshot_ref: String(run.policy_snapshot_ref),
          requested_by: String(run.requested_by),
          reason: String(run.reason),
          ...(courseAdapterForExperiment(String(current.experiment_id))
            ? { course_adapter: courseAdapterForExperiment(String(current.experiment_id)) }
            : {}),
        },
        repository: {
          url: new URL(
            `/${String(current.owner_name)}/${String(current.repository_name)}.git`,
            this.giteaUrl,
          ).toString(),
        },
        actor: {
          id: String(current.user_id),
          username: String(current.username),
          role: current.role as WorkerPipelineLeaseV1["actor"]["role"],
        },
        commit_ledger: {
          delivery_id: String(current.delivery_id),
          before_sha: current.before_sha
            ? String(current.before_sha)
            : undefined,
          after_sha: String(current.after_sha),
          pusher_username: current.pusher_username
            ? String(current.pusher_username)
            : undefined,
          received_at: new Date(String(current.received_at)).toISOString(),
        },
      };
    });
    return result as WorkerPipelineLeaseV1 | null;
  }

  async heartbeat(input: WorkerHeartbeatV1): Promise<WorkerHeartbeatResultV1> {
    const result = await this.sql.begin(async (tx) => {
      await tx`insert into worker_nodes(id,last_heartbeat,current_run_id,metadata) values(${input.worker_id},now(),${input.run_id ?? null},${tx.json(input.metadata as never)}) on conflict(id) do update set last_heartbeat=now(),current_run_id=excluded.current_run_id,metadata=excluded.metadata`;
      if (!input.run_id)
        return {
          version: "worker-heartbeat-result.v1" as const,
          accepted: true as const,
        };
      const rows =
        await tx`select status,lease_owner from pipeline_runs where id=${input.run_id} for update`;
      const run = rows[0] as Row | undefined;
      if (!run || run.lease_owner !== input.worker_id)
        throw new Error("pipeline worker lease heartbeat was rejected");
      if (run.status === "cancelled")
        return {
          version: "worker-heartbeat-result.v1" as const,
          accepted: true as const,
          run_status: "cancelled" as const,
        };
      if (run.status !== "leased" && run.status !== "running")
        throw new Error("pipeline worker lease is not active");
      const renewed =
        await tx`update pipeline_runs set leased_until=now()+interval '2 minutes' where id=${input.run_id} and lease_owner=${input.worker_id} returning leased_until,status`;
      return {
        version: "worker-heartbeat-result.v1" as const,
        accepted: true as const,
        run_status: renewed[0].status as WorkerHeartbeatResultV1["run_status"],
        lease_expires_at: new Date(
          String(renewed[0].leased_until),
        ).toISOString(),
      };
    });
    return result as WorkerHeartbeatResultV1;
  }

  async start(runId: string, input: WorkerRunStartV1): Promise<WorkerAckV1> {
    const result = await this.sql.begin(async (tx) => {
      const rows =
        await tx`update pipeline_runs set status='running',started_at=coalesce(started_at,now()),leased_until=now()+interval '2 minutes',public_message='隔离评测环境已启动' where id=${runId} and lease_owner=${input.worker_id} and status='leased' returning id`;
      if (!rows[0])
        throw new Error("pipeline worker lease was lost before runner start");
      await tx`update assessment_submissions set status='evaluating' where run_id=${runId} and status='queued'`;
      const seq =
        await tx`select coalesce(max(sequence),-1)+1 sequence from pipeline_events where run_id=${runId}`;
      await tx`insert into pipeline_events(run_id,sequence,event_type,visibility,payload) values(${runId},${Number(seq[0].sequence)},'step_started','student',${tx.json({ step: "vos-serve", remote_run_id: input.remote_run_id })})`;
      return { version: "worker-ack.v1" as const, accepted: true as const };
    });
    return result as WorkerAckV1;
  }

  async reportEvidence(
    runId: string,
    input: WorkerEvidenceReportV1,
  ): Promise<WorkerAckV1> {
    const result = await this.sql.begin(async (tx) => {
      const owned =
        await tx`select id,project_id,status,lease_owner from pipeline_runs where id=${runId} for update`;
      const run = owned[0] as Row | undefined;
      if (
        !run ||
        run.lease_owner !== input.worker_id ||
        !["leased", "running"].includes(String(run.status))
      )
        throw new Error(
          "pipeline evidence report does not own an active lease",
        );
      for (const object of input.objects) {
        await tx`insert into object_refs(id,project_id,run_id,uri,sha256,size_bytes,content_type,visibility,label,object_key,upload_status,lineage) values(${object.id},${String(run.project_id)},${runId},${object.uri},${object.sha256},${object.size_bytes},${object.content_type},${object.visibility},${object.label},${object.key},'verified',${tx.json(object.lineage as never)}) on conflict(id) do nothing`;
        const stored =
          await tx`select project_id,run_id,object_key,sha256,size_bytes,content_type,visibility from object_refs where id=${object.id}`;
        if (
          !stored[0] ||
          stored[0].project_id !== run.project_id ||
          stored[0].run_id !== runId ||
          stored[0].object_key !== object.key ||
          stored[0].sha256 !== object.sha256 ||
          Number(stored[0].size_bytes) !== object.size_bytes ||
          stored[0].content_type !== object.content_type ||
          stored[0].visibility !== object.visibility
        )
          throw new Error(
            "worker object report conflicts with persisted metadata",
          );
      }
      for (const evidence of input.evidence)
        await tx`insert into evidence_records(id,run_id,suite,case_name,result,visibility,metrics,public_message) values(${evidence.id},${runId},${evidence.suite},${evidence.case_name},${evidence.result},${evidence.visibility},${tx.json(evidence.metrics as never)},${evidence.public_message}) on conflict(run_id,suite,case_name,visibility) do nothing`;
      await tx`update pipeline_runs set passed=(select count(*) from evidence_records where run_id=${runId} and result='pass'),total=(select count(*) from evidence_records where run_id=${runId}) where id=${runId}`;
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${identifier("audit")},null,'runner.evidence.report','pipeline',${runId},'worker reported checksum-verified evidence and objects',${identifier("worker")},${tx.json({ worker_id: input.worker_id, remote_run_id: input.remote_run_id, evidence_records: input.evidence.length, objects: input.objects.length })})`;
      return { version: "worker-ack.v1" as const, accepted: true as const };
    });
    return result as WorkerAckV1;
  }

  async complete(
    runId: string,
    input: WorkerRunCompleteV1,
  ): Promise<WorkerAckV1> {
    const result = await this.sql.begin(async (tx) => {
      const rows =
        await tx`select *, (select count(*)::int from evidence_records where run_id=pipeline_runs.id) evidence_count,(select count(*)::int from object_refs where run_id=pipeline_runs.id and upload_status='verified' and deleted_at is null and lineage->>'remote_run_id'=${input.remote_run_id}) object_count from pipeline_runs where id=${runId} for update`;
      const run = rows[0] as Row | undefined;
      if (!run || run.lease_owner !== input.worker_id)
        throw new Error(
          "pipeline worker lease was lost before terminal commit",
        );
      if (
        Number(run.evidence_count) !== input.evidence_records ||
        Number(run.object_count) !== input.objects
      )
        throw new Error(
          "worker terminal counts do not match persisted evidence",
        );
      if (
        input.status === "passed" &&
        (Number(run.total) === 0 || Number(run.passed) !== Number(run.total))
      )
        throw new Error(
          "pipeline cannot pass without a complete passing evidence set",
        );
      const submissions =
        await tx`select a.id,a.project_id,a.submitted_by,sg.config from assessment_submissions a join projects p on p.id=a.project_id join stage_gates sg on sg.id=p.current_stage_id where a.run_id=${runId} for update of a`;
      const submission = submissions[0] as Row | undefined;
      const requiredShowcaseArtifacts = submission
        ? ((submission.config as { required_showcase_artifacts?: string[] })
            .required_showcase_artifacts ?? [])
        : [];
      const recordedShowcaseArtifacts = submission && requiredShowcaseArtifacts.length > 0
        ? await tx`select distinct o.label from object_refs o join pipeline_runs pr on pr.id=o.run_id where pr.project_id=${String(submission.project_id)} and pr.commit_sha=${String(run.commit_sha)} and pr.stage_key=${String(run.stage_key)} and o.upload_status='verified' and o.deleted_at is null`
        : [];
      const missingShowcaseArtifacts = requiredShowcaseArtifacts.filter(
        (label) => !recordedShowcaseArtifacts.some((row) => row.label === label),
      );
      const terminalStatus =
        input.status === "passed" && missingShowcaseArtifacts.length > 0
          ? "failed"
          : input.status;
      const terminalFailureClass =
        missingShowcaseArtifacts.length > 0
          ? "verification_failure"
          : input.failure_class ??
            (terminalStatus === "failed" ? "verification_failure" : null);
      if (run.status !== "cancelled")
        await tx`update pipeline_runs set status=${terminalStatus},failure_class=${terminalFailureClass},public_message=${missingShowcaseArtifacts.length > 0 ? `缺少课程重放展示材料：${missingShowcaseArtifacts.join(", ")}` : terminalStatus === "passed" ? "评测通过" : terminalStatus === "timed_out" ? "评测超时" : terminalFailureClass === "infra_failure" ? "评测基础设施失败，已通知课程团队" : "评测未通过，请查看公开证据"},finished_at=now() where id=${runId}`;
      await tx`update pipeline_runs set lease_owner=null,leased_until=null where id=${runId}`;
      await tx`update model_credential_leases set revoked_at=now() where run_id=${runId} and worker_id=${input.worker_id} and revoked_at is null`;
      if (run.status !== "cancelled") {
        const seq =
          await tx`select coalesce(max(sequence),-1)+1 sequence from pipeline_events where run_id=${runId}`;
        await tx`insert into pipeline_events(run_id,sequence,event_type,visibility,payload) values(${runId},${Number(seq[0].sequence)},'finished','student',${tx.json({ status: terminalStatus, failure_class: terminalFailureClass, missing_showcase_artifacts: missingShowcaseArtifacts })})`;
        if (submission) {
          const manual = Boolean(
            (submission.config as { manual_review_required?: boolean })
              .manual_review_required,
          );
          const status =
            terminalStatus === "passed"
              ? manual
                ? "candidate"
                : "complete"
              : "failed";
          await tx`update assessment_submissions set status=${status},completed_at=now() where id=${String(submission.id)}`;
          if (terminalStatus === "passed") {
            const previous = (
              await tx`select id,state,snapshot_version from score_snapshots where project_id=${String(submission.project_id)} order by snapshot_version desc limit 1 for update`
            )[0] as Row | undefined;
            if (previous && previous.state !== "draft")
              throw new Error(
                "authoritative baseline cannot replace a frozen or published score snapshot",
              );
            const graded =
              await tx`select distinct on(stage_key) id,passed,total from pipeline_runs where project_id=${String(submission.project_id)} and scope='final' and status in ('passed','failed') and total>0 order by stage_key,created_at desc,id desc`;
            const total = graded.reduce(
              (sum, row) => sum + Number(row.total),
              0,
            );
            if (total === 0)
              throw new Error(
                "authoritative assessment has no scoreable evidence",
              );
            const passed = graded.reduce(
              (sum, row) => sum + Number(row.passed),
              0,
            );
            const baseline = Math.round((passed / total) * 10_000) / 100;
            await tx`insert into score_snapshots(id,project_id,baseline,final_score,state,evidence_refs,created_by,snapshot_version,previous_snapshot_id,transition_reason) values(${identifier("score")},${String(submission.project_id)},${baseline},${baseline},'draft',${tx.json(graded.map((row) => String(row.id)))},${String(submission.submitted_by)},${Number(previous?.snapshot_version ?? 0) + 1},${previous ? String(previous.id) : null},'automatic authoritative assessment baseline')`;
          }
          if (status === "complete") {
            const next =
              await tx`select next.id from projects p join stage_gates current on current.id=p.current_stage_id join stage_gates next on next.experiment_id=p.experiment_id and next.sequence=current.sequence+1 where p.id=${String(submission.project_id)}`;
            if (next[0]) {
              await tx`update stage_gates set status='open',version=version+1 where id=${String(next[0].id)} and status='locked'`;
              await tx`update projects set current_stage_id=${String(next[0].id)},version=version+1,updated_at=now() where id=${String(submission.project_id)}`;
            }
          }
          await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${identifier("audit")},null,'assessment.evaluate','assessment_submission',${String(submission.id)},'runner produced authoritative assessment baseline',${identifier("worker")},${tx.json({ run_id: runId, status, manual_review_required: manual, required_showcase_artifacts: requiredShowcaseArtifacts, missing_showcase_artifacts: missingShowcaseArtifacts })})`;
        }
      }
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${identifier("audit")},null,'runner.complete','pipeline',${runId},'runner terminal result',${identifier("worker")},${tx.json({ worker_id: input.worker_id, remote_run_id: input.remote_run_id, status: terminalStatus, runner_error: input.runner_error ?? null, manifest_status: input.manifest_status ?? null, manifest_message: input.manifest_message ?? null, evidence_records: input.evidence_records, objects: input.objects, runner_image_id: input.runner_image_id, runner_container_id: input.runner_container_id, missing_showcase_artifacts: missingShowcaseArtifacts })})`;
      return { version: "worker-ack.v1" as const, accepted: true as const };
    });
    return result as WorkerAckV1;
  }
}
