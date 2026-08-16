import type { PortalDashboard, CourseOperationsV2 } from "vos-core/portal-contracts";

export function getStudentNextAction(dashboard: PortalDashboard) {
  const current = dashboard.project.current_stage;
  const latest = dashboard.runs[0];
  return {
    stage: current,
    href: `/stages?stage=${encodeURIComponent(current.key)}`,
    label: latest && ["failed", "cancelled", "timed_out"].includes(latest.status) ? "查看失败运行并修复" : "进入阶段详情",
    latestRunId: latest?.id,
  };
}

export function getRunActivity(dashboard: PortalDashboard) {
  return [...dashboard.runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((run) => ({
    id: run.id,
    stageKey: run.stage_key,
    status: run.status,
    createdAt: run.created_at,
    passed: run.passed,
    total: run.total,
    publicMessage: run.public_message,
    href: `/runs/${run.id}`,
  }));
}

export function getTeacherQueue(operations: CourseOperationsV2) {
  return [...operations.projects].sort((a, b) => {
    const appealDelta = b.open_appeals - a.open_appeals;
    if (appealDelta) return appealDelta;
    const failureDelta = b.failed_runs - a.failed_runs;
    if (failureDelta) return failureDelta;
    const designDelta = Number(b.design_status === "submitted") - Number(a.design_status === "submitted");
    if (designDelta) return designDelta;
    return a.project_id.localeCompare(b.project_id);
  });
}
