import { Button, Input, Textarea } from "@fluentui/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AppealTransitionV1 } from "vos-core/portal-contracts";
import { useRepository } from "../repository-context.tsx";
import { portalQueryKey, usePortalScope } from "../portal-scope.tsx";
import { useTranslation } from "react-i18next";
import { PageError, PageLoading } from "../ui/page-state.tsx";

export function GradeAppealPage({ appealsOnly = false }: { appealsOnly?: boolean }) {
  const repository = useRepository();
  const scope = usePortalScope();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: portalQueryKey(scope, "dashboard"), queryFn: () => repository.dashboard() });
  const projectId = dashboard.data?.project.project_id;
  const appeals = useQuery({ queryKey: portalQueryKey(scope, "appeals"), queryFn: () => repository.appeals(projectId!), enabled: Boolean(projectId) });
  const [reason, setReason] = useState("");
  const [statement, setStatement] = useState("");
  const [delta, setDelta] = useState("0");
  const [message, setMessage] = useState("");

  if (dashboard.isLoading) return <PageLoading label={t("正在加载评分记录…")} />;
  if (dashboard.error || !dashboard.data) return <PageError message={dashboard.error instanceof Error ? dashboard.error.message : t("评分上下文不可用")} retryLabel={t("重试")} onRetry={() => void dashboard.refetch()} />;
  const data = dashboard.data;
  const score = data.score;
  const teacher = data.actor.role === "teacher" || data.actor.role === "admin";
  const student = data.actor.role === "student";
  const evidenceRef = data.runs[0]?.id;

  async function mutate(work: () => Promise<unknown>) {
    setMessage("");
    try {
      await work();
      setReason(""); setStatement("");
      setMessage(t("操作已写入不可变快照与审计链。"));
      await queryClient.invalidateQueries();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function changeAppeal(input: AppealTransitionV1) { await mutate(() => repository.transitionAppeal(input)); }

  return <div className="page grade-page">
    <div className="page-heading"><div><h1>{t(appealsOnly ? "成绩申诉" : "评分工作台")}</h1><p>{t("成绩与裁决只追加新快照，历史记录不可覆盖。")}</p></div></div>
    <div className="grade-grid">
      <section className="surface grade-summary">
        <header><h2>{t("当前成绩快照")}</h2><small>v{score.snapshot_version}</small></header>
        <strong>{score.final_score.toFixed(2)}<small> / 100</small></strong>
        <dl className="detail-list"><div><dt>{t("状态")}</dt><dd>{score.snapshot_version === 0 ? t("尚未评分") : t(score.state)}</dd></div><div><dt>{t("自动基线")}</dt><dd>{score.baseline.toFixed(2)}</dd></div><div><dt>{t("证据引用")}</dt><dd>{score.evidence_refs.length}</dd></div></dl>
        {score.adjustments.length ? <div className="structured-list">{score.adjustments.map((item, index) => <div key={`${item.member_id}-${index}`}><b>{item.member_id} · {item.delta > 0 ? "+" : ""}{item.delta}</b><span>{item.reason}</span></div>)}</div> : <p className="empty-copy">{t("暂无个人调整。")}</p>}
      </section>

      {!appealsOnly && teacher ? <section className="surface grade-actions">
        <header><h2>{t("教师评分控制")}</h2></header>
        <label className="reason">{t("操作理由")}<Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("至少 10 个字符，进入审计链")} /></label>
        <label className="compact-field">{t("个人调整")}<Input type="number" step="0.5" value={delta} onChange={(event) => setDelta(event.target.value)} /></label>
        <div className="action-row">
          <Button appearance="secondary" disabled={reason.trim().length < 10} onClick={() => void mutate(() => repository.calculateScore({ project_id: projectId!, reason }))}>{t("计算基线")}</Button>
          <Button appearance="secondary" disabled={reason.trim().length < 10 || !evidenceRef || score.state !== "draft"} onClick={() => void mutate(() => repository.updateScore({ project_id: projectId!, member_id: data.project.member_ids[0], delta: Number(delta), reason, evidence_refs: [evidenceRef!] }))}>{t("记录调整")}</Button>
          <Button appearance="secondary" disabled={reason.trim().length < 10 || score.state !== "draft" || score.snapshot_version === 0} onClick={() => void mutate(() => repository.transitionScore({ score_snapshot_id: score.id, target_state: "frozen", reason }))}>{t("冻结成绩")}</Button>
          <Button appearance="primary" disabled={reason.trim().length < 10 || score.state !== "frozen"} onClick={() => void mutate(() => repository.transitionScore({ score_snapshot_id: score.id, target_state: "published", reason }))}>{t("发布成绩")}</Button>
          <Button appearance="secondary" disabled={reason.trim().length < 10 || data.course.status !== "grading"} onClick={() => void mutate(() => repository.transitionCourse(data.course.id, "appeal", reason))}>{t("开放申诉")}</Button>
        </div>{message ? <p className="operation-message" role="status">{message}</p> : null}
      </section> : null}

      <section className="surface appeal-panel">
        <header><h2>{t("申诉记录")}</h2><small>{appeals.data?.length ?? 0} {t("条")}</small></header>
        {student && data.course.status === "appeal" && score.state === "published" ? <div className="appeal-submit"><label className="reason">{t("申诉说明")}<Textarea value={statement} onChange={(event) => setStatement(event.target.value)} placeholder={t("至少 20 个字符，并关联最近一次运行证据")} /></label><Button appearance="primary" disabled={statement.trim().length < 20 || !evidenceRef} onClick={() => void mutate(() => repository.submitAppeal({ project_id: projectId!, statement, evidence_refs: [evidenceRef!] }))}>{t("提交申诉")}</Button></div> : null}
        {appeals.isError ? <PageError message={appeals.error instanceof Error ? appeals.error.message : String(appeals.error)} retryLabel={t("重试")} onRetry={() => void appeals.refetch()} /> : <div className="structured-list">{appeals.data?.length ? appeals.data.map((appeal) => <div className="appeal-record" key={appeal.id}><span><b>{t(appeal.status)}</b><small>{appeal.statement}</small>{appeal.decision ? <small>{t("裁决")}：{appeal.decision}</small> : null}</span>{!student ? <span className="appeal-actions">{appeal.status === "submitted" ? <Button appearance="secondary" disabled={reason.trim().length < 10} onClick={() => void changeAppeal({ appeal_id: appeal.id, target_status: "fact_check", reason })}>{t("完成核查")}</Button> : null}{teacher && appeal.status === "fact_check" ? <Button appearance="primary" disabled={reason.trim().length < 10} onClick={() => void changeAppeal({ appeal_id: appeal.id, target_status: "decision", reason, decision: reason, score_delta: Number(delta) })}>{t("作出裁决")}</Button> : null}{teacher && appeal.status === "decision" ? <Button appearance="secondary" disabled={reason.trim().length < 10} onClick={() => void changeAppeal({ appeal_id: appeal.id, target_status: "closed", reason })}>{t("关闭")}</Button> : null}</span> : null}</div>) : <div><b>{t("暂无申诉")}</b><span>{t("申诉窗口开放后可提交带证据引用的材料。")}</span></div>}</div>}
        {(!teacher || appealsOnly) && message ? <p className="operation-message" role="status">{message}</p> : null}
      </section>
    </div>
  </div>;
}
