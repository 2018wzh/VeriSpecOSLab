import type { EvidenceBundleV1, PortalActor, PortalDashboard, QaThreadV1 } from "vos-core/portal-contracts";

const created = "2026-05-16T14:32:10.000Z";
export const demoActors: Record<PortalActor["role"], PortalActor> = {
  student: { id: "user-student", username: "student", display_name: "李明同学", role: "student" },
  ta: { id: "user-ta", username: "ta", display_name: "张助教", role: "ta" },
  teacher: { id: "user-teacher", username: "teacher", display_name: "王老师", role: "teacher" },
  admin: { id: "user-admin", username: "admin", display_name: "系统管理员", role: "admin" },
};

export function createDemoDashboard(role: PortalActor["role"] = "student"): PortalDashboard {
  const stageNames = ["架构种子", "启动", "内存管理", "中断", "用户态", "文件系统", "并发", "综合评测", "四核候选", "课程候选"];
  const stageKeys=["seed","boot","memory","interrupts","user","fs","concurrency","final","hardware-candidate","course-candidate"];
  const stages = stageNames.map((name, sequence) => ({
    id: `stage-${sequence}`, key: stageKeys[sequence], name, sequence,
    status: sequence < 2 ? "passed" as const : sequence === 2 ? "review" as const : "locked" as const,
    required_artifacts: ["design", "implementation"], required_evidence: [{ suite: "public", case_name: "stage-gate", required_result: "pass" as const }],
    manual_review_required: sequence === 2 || sequence >= 8,
  }));
  const runs = [
    { id: "run-20260516-a1b2c3d", project_id: "project-xv6-group-3", commit_sha: "a1b2c3d".padEnd(40,"0"), stage_key: "memory", status: "failed" as const, passed: 18, total: 20, failure_class: "verification_failure", public_message: "页表解除映射行为与公开规范不一致。", created_at: created, finished_at: "2026-05-16T14:56:48.000Z" },
    { id: "run-20260515-5c6d7e8", project_id: "project-xv6-group-3", commit_sha: "5c6d7e8".padEnd(40,"0"), stage_key: "memory", status: "passed" as const, passed: 18, total: 20, public_message: "达到当前阶段公开门槛。", created_at: "2026-05-15T12:48:47.000Z", finished_at: "2026-05-15T12:49:45.000Z" },
    { id: "run-20260514-4d5e6f7", project_id: "project-xv6-group-3", commit_sha: "4d5e6f7".padEnd(40,"0"), stage_key: "memory", status: "failed" as const, passed: 12, total: 20, failure_class: "runtime_error", public_message: "QEMU 启动后未达到阶段就绪标记。", created_at: "2026-05-14T20:05:11.000Z", finished_at: "2026-05-14T20:05:56.000Z" },
  ].map((run) => ({ version: "pipeline-summary.v1" as const, ...run }));
  return {
    actor: demoActors[role],
    course: { id: "course-os-2026", code: "OS-LAB", name: "操作系统设计实验", term: "2026 春", status: "active" },
    project: {
      version: "project-binding.v1", project_id: "project-xv6-group-3", course_id: "course-os-2026",
      experiment_id: "experiment-xv6", repo_url: "https://gitea.example.edu/os/xv6-group-3.git",
      member_ids: ["user-student", "user-student-2"], current_stage: stages[2], policy_snapshot_ref: "policy-v1.3.0",
    },
    stages, runs,
    score: { version: "score-snapshot.v1", id: "score-draft", project_id: "project-xv6-group-3", baseline: 28, adjustments: [], final_score: 28, state: "draft", evidence_refs: [runs[0].id], snapshot_version: 1, created_at: created },
    notifications: [
      { id: "notice-review", title: "评审已完成", body: "TA-07 已完成阶段 2 的评审。", read: false, created_at: "2026-05-16T10:22:00.000Z" },
      { id: "notice-tests", title: "公开测试回归更新", body: "阶段 3 的公开测试已更新至 v1.2。", read: false, created_at: "2026-05-15T09:20:00.000Z" },
      { id: "notice-reply", title: "讨论已回复", body: "教师回复了内存管理设计问题。", read: true, created_at: "2026-05-14T16:30:00.000Z" },
    ],
  };
}

export function createEvidence(runId = "run-20260516-a1b2c3d"): EvidenceBundleV1 {
  const dashboard = createDemoDashboard();
  const run = dashboard.runs.find((item) => item.id === runId) ?? dashboard.runs[0];
  const zeros = "0".repeat(64);
  return {
    version: "evidence-bundle.v1", run,
    evidence: [
      { id: "ev-boot", run_id: run.id, suite: "boot-sequence", case_name: "kernel-ready", result: "pass", visibility: "student", metrics: { elapsed_ms: 1080 }, public_message: "启动阶段通过", artifact_ids: ["artifact-serial"] },
      { id: "ev-unmap", run_id: run.id, suite: "page-table", case_name: "pt-unmap", result: "fail", visibility: "student", metrics: { ticks: 1420000, exit_code: 0 }, public_message: "访问未触发预期页故障。", artifact_ids: ["artifact-evidence"] },
      { id: "ev-hidden", run_id: run.id, suite: "staff-validation", case_name: "redacted", result: "fail", visibility: "staff", metrics: {}, artifact_ids: [] },
    ],
    artifacts: [
      { id: "artifact-serial", uri: `s3://vos-artifacts/${run.id}/serial.log`, sha256: zeros, size_bytes: 12984, content_type: "text/plain", visibility: "student", label: "QEMU 串行日志" },
      { id: "artifact-evidence", uri: `s3://vos-artifacts/${run.id}/evidence.tar.zst`, sha256: "1".repeat(64), size_bytes: 48321, content_type: "application/zstd", visibility: "student", label: "证据包" },
    ],
  };
}

export function createQaThread(): QaThreadV1 {
  return { version: "qa-thread.v1", id: "qa-memory", project_id: "project-xv6-group-3", stage_key: "memory", messages: [] };
}
