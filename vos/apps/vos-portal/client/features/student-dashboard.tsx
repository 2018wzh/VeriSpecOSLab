import { Button, MessageBar, MessageBarBody, Skeleton, SkeletonItem } from "@fluentui/react-components";
import { ArrowRight24Regular, CheckmarkCircle24Regular, Circle24Regular, Clock24Regular, DismissCircle24Regular } from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRepository } from "../repository-context.tsx";
import { portalQueryKey, usePortalScope } from "../portal-scope.tsx";
import { getRunActivity, getStudentNextAction } from "../view-models.ts";

export function StudentDashboard() {
  const repository = useRepository();
  const scope = usePortalScope();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dashboard = useQuery({ queryKey: portalQueryKey(scope, "dashboard"), queryFn: () => repository.dashboard() });
  if (dashboard.isLoading) return <StudentSkeleton />;
  if (dashboard.isError || !dashboard.data) return <MessageBar intent="error"><MessageBarBody>{dashboard.error instanceof Error ? dashboard.error.message : t("无法加载工作台")}</MessageBarBody><Button appearance="secondary" onClick={() => void dashboard.refetch()}>{t("重试")}</Button></MessageBar>;
  const data = dashboard.data;
  const current = data.project.current_stage;
  const action = getStudentNextAction(data);
  const activity = getRunActivity(data);
  const completed = data.stages.filter((stage) => stage.status === "passed").length;
  return <div className="page student-home">
    <div className="student-title"><div><p>{data.course.code} · {data.course.term}</p><h1>{t("学习工作台")}</h1><span className="muted-copy">{t("从当前阶段开始，完成要求、运行测评并保留证据。")}</span></div><span>{t("已完成 {{done}} / {{total}}", { done: completed, total: data.stages.length })}</span></div>
    <nav className="lab-track" aria-label={t("Lab 进度")}>{data.stages.map((stage, index) => <Link to={`/stages?stage=${encodeURIComponent(stage.key)}`} key={stage.id} className={`lab-step ${stage.status}`} aria-current={stage.id === current.id ? "step" : undefined}><i>{stage.status === "passed" ? <CheckmarkCircle24Regular /> : index + 1}</i><span>Lab {index + 1}</span><small>{stage.name}</small></Link>)}</nav>
    <section className="primary-action surface"><div><small>{t("当前任务")} · Lab {current.sequence + 1}</small><h2>{t("继续完成 {{stage}}", { stage: current.name })}</h2><p>{t("先查看阶段门槛，再提交实现与公开证据；Portal 只负责控制面与审计。")}</p><div className="action-meta"><span>{current.required_artifacts.length} {t("项产物")}</span><span>{current.required_evidence.length} {t("项证据")}</span>{current.required_showcase_artifacts.length > 0 ? <span>{current.required_showcase_artifacts.length} {t("项重放材料")}</span> : null}{current.required_review_artifacts.length > 0 ? <span>{current.required_review_artifacts.length} {t("项复核材料")}</span> : null}{current.manual_review_required ? <span>{t("需要人工复核")}</span> : null}</div></div><Button appearance="primary" onClick={() => navigate(action.href)}>{t(action.label)} <ArrowRight24Regular /></Button></section>
    <div className="student-summary">
      <section className="surface overview"><header><h2>{t("课程概览")}</h2></header><dl><div><dt>{t("当前阶段")}</dt><dd>{current.name}</dd></div><div><dt>{t("最近测评")}</dt><dd>{data.runs[0] ? t(data.runs[0].status) : t("尚未运行")}</dd></div><div><dt>{t("课程状态")}</dt><dd>{t(data.course.status)}</dd></div><div><dt>{t("当前成绩")}</dt><dd>{data.score.snapshot_version ? `${data.score.final_score} / 100` : t("尚未发布")}</dd></div></dl></section>
      <section className="surface recent-assessments"><header><h2>{t("最近运行与证据")}</h2><Link to="/runs">{t("查看全部")}</Link></header>{activity.slice(0, 4).map((run) => <article key={run.id}><Status value={run.status} /><div><b>{run.stageKey}</b><small>{run.passed}/{run.total} · {new Date(run.createdAt).toLocaleString()}</small></div><Link to={run.href}>{t("查看证据")}</Link></article>)}{!activity.length ? <p className="empty-copy">{t("尚无测评记录。完成阶段后，运行记录会出现在这里。")}</p> : null}</section>
      <section className="surface recent-feedback"><header><h2>{t("反馈摘要")}</h2></header>{activity.slice(0, 3).map((run) => <article key={run.id}>{run.status === "passed" ? <CheckmarkCircle24Regular /> : <DismissCircle24Regular />}<div><b>{run.stageKey} · {t(run.status)}</b><p>{run.publicMessage || t("暂无公开反馈。")}</p></div></article>)}{!activity.length ? <p className="empty-copy">{t("暂无公开反馈。")}</p> : null}</section>
    </div>
    <section className="evidence-links" aria-label={t("证据链接")}><Link to={data.runs[0] ? `/runs/${data.runs[0].id}` : "/runs"}>{t("打开最新测评证据")} <ArrowRight24Regular /></Link><Link to={`/stages?stage=${encodeURIComponent(current.key)}`}>{t("查看阶段要求")} <ArrowRight24Regular /></Link><Link to="/architecture">{t("查看规格与架构")} <ArrowRight24Regular /></Link><Link to="/grades">{t("查看成绩与申诉")} <ArrowRight24Regular /></Link></section>
  </div>;
}

function StudentSkeleton() { return <div className="page student-home"><Skeleton aria-label="loading"><SkeletonItem shape="rectangle" /><SkeletonItem shape="rectangle" /><SkeletonItem shape="rectangle" /></Skeleton></div>; }

export function Status({ value }: { value: string }) {
  const { t } = useTranslation();
  const kind = value.includes("通过") && !value.includes("未") || value === "passed" || value === "Passed" ? "ok" : value.includes("进行") || value.includes("排队") || ["queued", "leased", "running"].includes(value) ? "info" : value.includes("未") || value.includes("失败") || ["failed", "cancelled", "timed_out"].includes(value) ? "bad" : "muted";
  const Icon = kind === "ok" ? CheckmarkCircle24Regular : kind === "bad" ? DismissCircle24Regular : kind === "info" ? Clock24Regular : Circle24Regular;
  return <span className={`status ${kind}`}><Icon aria-hidden="true" />{t(value)}</span>;
}
