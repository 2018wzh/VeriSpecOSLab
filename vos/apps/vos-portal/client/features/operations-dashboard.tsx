import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, MessageBar, MessageBarBody, Select } from "@fluentui/react-components";
import { ArrowSync24Regular, MoreHorizontal24Regular } from "@fluentui/react-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRepository } from "../repository-context.tsx";
import { portalQueryKey, usePortalScope } from "../portal-scope.tsx";
import { getTeacherQueue } from "../view-models.ts";
import { Status } from "./student-dashboard.tsx";
import { PageLoading } from "../ui/page-state.tsx";

export function OperationsDashboard() {
  const repository = useRepository();
  const scope = usePortalScope();
  const { t } = useTranslation();
  const client = useQueryClient();
  const dashboard = useQuery({ queryKey: portalQueryKey(scope, "dashboard"), queryFn: () => repository.dashboard(), refetchInterval: 15_000 });
  const courseId = dashboard.data?.course.id;
  const operations = useQuery({ queryKey: portalQueryKey(scope, "course-operations"), queryFn: () => repository.courseOperations(courseId!), enabled: Boolean(courseId), refetchInterval: 15_000 });
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState("all");
  const [attention, setAttention] = useState("all");
  const [selectedRun, setSelectedRun] = useState<string>();
  const [rerunDialogMounted, setRerunDialogMounted] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ intent: "success" | "error"; text: string }>();
  const projects = operations.data?.projects ?? [];
  const queue = useMemo(() => operations.data ? getTeacherQueue(operations.data) : [], [operations.data]);
  const filtered = useMemo(() => queue.filter((project) => (stage === "all" || project.stage_key === stage) && (status === "all" || project.latest_run?.status === status) && (attention === "all" || attention === "appeal" && project.open_appeals > 0 || attention === "failed" && project.failed_runs > 0)), [queue, stage, status, attention]);
  if (dashboard.isLoading || operations.isLoading) return <PageLoading label={t("正在加载课程运营工作台…")} />;
  if (dashboard.isError || operations.isError || !dashboard.data || !operations.data) return <MessageBar intent="error"><MessageBarBody>{t("无法加载课程运营数据")}</MessageBarBody><Button appearance="secondary" onClick={() => { void dashboard.refetch(); void operations.refetch(); }}>{t("重试")}</Button></MessageBar>;
  const data = dashboard.data;
  const pending = queue.filter((project) => project.failed_runs > 0 || project.open_appeals > 0);
  const stages = [...new Set(projects.map((project) => project.stage_key))];
  const failedRun = data.runs.find((run) => ["failed", "cancelled", "timed_out"].includes(run.status));
  async function rerun() {
    if (!selectedRun || reason.trim().length < 10) return;
    setMessage(undefined);
    try {
      await repository.review({ run_id: selectedRun, action: "rerun", reason: reason.trim() });
      setMessage({ intent: "success", text: t("补跑已创建并写入审计记录。") });
      setSelectedRun(undefined); setReason("");
      await client.invalidateQueries({ queryKey: ["portal"] });
    } catch (error) { setMessage({ intent: "error", text: error instanceof Error ? error.message : String(error) }); }
  }
  return <div className="page teacher-home">
    <div className="teacher-title"><div><p>{data.course.code} · {data.course.term}</p><h1>{t("课程运营")}</h1><span className="muted-copy">{t("按申诉、失败运行、待审设计和评分确定处理顺序。")}</span></div><span className="live"><i />{t("15 秒刷新")} <ArrowSync24Regular /></span></div>
    <section className="course-lifecycle" aria-label={t("课程生命周期")}>{["draft", "published", "active", "grading", "appeal", "closed"].map((item, index) => <div className={item === data.course.status ? "current" : index < ["draft", "published", "active", "grading", "appeal", "closed"].indexOf(data.course.status) ? "done" : ""} key={item}><i>{index + 1}</i><span>{t(item)}</span></div>)}</section>
    <section className="pending-strip"><div><b>{t("优先待办")}</b><span>{t("{{projects}} 个项目需要处理", { projects: pending.length })}</span><span>{pending.reduce((sum, item) => sum + item.failed_runs, 0)} {t("次失败")}</span><span>{pending.reduce((sum, item) => sum + item.open_appeals, 0)} {t("个申诉")}</span></div><Button appearance="primary" disabled={!failedRun} onClick={() => { setRerunDialogMounted(true); setSelectedRun(failedRun?.id); }}>{t("处理首项")}</Button></section>
    {message ? <MessageBar intent={message.intent}><MessageBarBody>{message.text}</MessageBarBody></MessageBar> : null}
    <section className="teacher-filters" aria-label={t("项目筛选")}><label>{t("阶段")}<Select value={stage} onChange={(event) => setStage(event.target.value)}><option value="all">{t("全部阶段")}</option>{stages.map((item) => <option key={item} value={item}>{item}</option>)}</Select></label><label>{t("运行状态")}<Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t("全部状态")}</option><option value="passed">{t("通过")}</option><option value="failed">{t("失败")}</option><option value="running">{t("运行中")}</option></Select></label><label>{t("需要关注")}<Select value={attention} onChange={(event) => setAttention(event.target.value)}><option value="all">{t("全部项目")}</option><option value="failed">{t("存在失败")}</option><option value="appeal">{t("开放申诉")}</option></Select></label></section>
    <section className="surface project-table"><header><h2>{t("项目")}</h2><small>{filtered.length} / {projects.length}</small></header><div className="table-wrap"><table><thead><tr><th>{t("项目与成员")}</th><th>{t("阶段")}</th><th>{t("最新测评")}</th><th>{t("成绩")}</th><th>{t("待处理")}</th><th>{t("操作")}</th></tr></thead><tbody>{filtered.map((project) => <tr key={project.project_id}><td><b>{project.project_id}</b><small>{project.member_names.join("、") || "—"}</small></td><td>{project.stage_name}</td><td>{project.latest_run ? <Status value={project.latest_run.status} /> : "—"}</td><td>{project.score_state ? `${t(project.score_state)}${project.final_score === undefined ? "" : ` · ${project.final_score.toFixed(1)}`}` : "—"}</td><td>{project.open_appeals ? `${project.open_appeals} ${t("申诉")}` : project.failed_runs ? `${project.failed_runs} ${t("失败")}` : "—"}</td><td>{project.latest_run ? <Link className="button primary" to={`/runs/${project.latest_run.id}`}>{t("复核")}</Link> : <span>—</span>}<Button appearance="subtle" icon={<MoreHorizontal24Regular />} aria-label={t("更多项目操作")} /></td></tr>)}{!filtered.length ? <tr><td colSpan={6}>{t("没有符合筛选条件的项目。")}</td></tr> : null}</tbody></table></div></section>
    <div className="teacher-bottom"><section className="surface stage-distribution"><header><h2>{t("阶段分布")}</h2></header>{stages.map((item) => { const count = projects.filter((project) => project.stage_key === item).length; return <div key={item}><span>{item}</span><progress max={Math.max(projects.length, 1)} value={count} /><b>{count}</b></div>; })}</section><section className="surface recent-events"><header><h2>{t("近期事件")}</h2></header>{data.runs.slice(0, 5).map((run) => <article key={run.id}><Status value={run.status} /><div><b>{run.stage_key} · {run.commit_sha.slice(0, 8)}</b><small>{new Date(run.created_at).toLocaleString()}</small></div><Link to={`/runs/${run.id}`}>{t("查看")}</Link></article>)}</section></div>
    {rerunDialogMounted ? <Dialog open={Boolean(selectedRun)} onOpenChange={(_, data) => { if (!data.open) { setSelectedRun(undefined); setReason(""); } }}><DialogSurface><DialogBody><DialogTitle>{t("确认补跑")}</DialogTitle><DialogContent><p>{t("补跑会创建新的排队运行，并保留原运行与审计关联。请说明处理理由。")}</p><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("至少填写 10 个字符的处理理由")} aria-label={t("补跑理由")} /></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setSelectedRun(undefined)}>{t("取消")}</Button><Button appearance="primary" disabled={reason.trim().length < 10} onClick={() => void rerun()}>{t("确认补跑")}</Button></DialogActions></DialogBody></DialogSurface></Dialog> : null}
  </div>;
}
