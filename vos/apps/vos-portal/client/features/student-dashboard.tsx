import { AlertCircle, ArrowRight, CheckCircle2, Circle, Clock3, FileText, Network, ServerCog } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useRepository } from "../repository-context.tsx";
import { useTranslation } from "react-i18next";

export function StudentDashboard() {
  const repository = useRepository(); const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => repository.dashboard() });
  const { t } = useTranslation();
  if (dashboard.isLoading) return <div className="page-loading">{t("正在加载学习工作台…")}</div>;
  if (dashboard.error || !dashboard.data) return <div className="error-state">{dashboard.error instanceof Error ? dashboard.error.message : t("无法加载工作台")}</div>;
  const data = dashboard.data; const latest = data.runs[0]; const current = data.project.current_stage;
  const tasks = [
    ["阶段要求", t("{{artifacts}} 项产物、{{evidence}} 项证据要求",{artifacts:current.required_artifacts.length,evidence:current.required_evidence.length}), current.status],
    ["最新公开验证", latest ? t("{{passed}} / {{total}} 项通过",{passed:latest.passed,total:latest.total}) : t("尚未触发运行"), latest?.status ?? "未开始"],
    ["人工审核", t(current.manual_review_required ? "本阶段要求课程团队审核" : "本阶段自动判定"), current.manual_review_required ? "待审核" : "无需审核"],
  ];
  return <div className="page"><div className="page-heading"><h1>{t("学习工作台")}</h1><Link className="button outline" to="/stages">{t("阶段说明")}</Link></div>
    <div className="stage-track">{data.stages.map((stage, index) => <div className={`stage ${stage.status}`} key={stage.id}><span>{stage.status === "passed" ? <CheckCircle2 /> : index + 1}</span><strong>{stage.name}</strong></div>)}</div>
    <div className="dashboard-grid"><section className="surface tasks"><header><h2>{t("本阶段任务")}</h2><small>{current.name}</small></header>{tasks.map(([title, description, status], index) => <div className="task-row" key={title}><span className="sequence">{index + 1}</span><div><strong>{t(title)}</strong><small>{description}</small></div><Status value={status} /><Link className="button primary" to={title === "最新公开验证" && latest ? `/runs/${latest.id}` : "/stages"}>{t("继续处理")} <ArrowRight /></Link></div>)}</section>
      <aside className="right-rail"><section className="surface"><header><h2>{t("课程状态")}</h2><Clock3 /></header><div className="deadline"><small>{data.course.code}</small><strong>{t(data.course.status)}</strong><span>{data.course.name} · {data.course.term}</span></div><div className="rail-row"><span>{t("当前阶段")}</span><b>{current.name}</b></div><div className="rail-row"><span>{t("最新运行")}</span><b>{latest ? t(latest.status) : t("尚未运行")}</b></div></section><section className="surface score"><header><h2>{t("当前得分")}</h2><Link to="/grades">{t("评分细则")}</Link></header><strong>{data.score.final_score}<small> / 100</small></strong><span><CheckCircle2 />{data.score.snapshot_version ? `${t(data.score.state)} · ${t("快照")} v${data.score.snapshot_version}` : t("尚未生成成绩")}</span></section></aside>
      <section className="surface runs"><header><h2>{t("最近运行")}</h2></header><div className="table-wrap"><table><thead><tr><th>{t("提交")}</th><th>{t("状态")}</th><th>{t("公开测试")}</th><th>{t("失败分类")}</th><th>{t("时间")}</th><th>{t("操作")}</th></tr></thead><tbody>{data.runs.length ? data.runs.map((run) => <tr key={run.id}><td><b className="link-color">{run.commit_sha.slice(0, 12)}</b></td><td><Status value={run.status === "passed" ? t("通过") : run.status} /></td><td>{run.passed} / {run.total}{run.total ? <progress max={run.total} value={run.passed} /> : null}</td><td>{run.failure_class ?? "—"}</td><td>{new Date(run.created_at).toLocaleDateString()}</td><td><Link className="text-action" to={`/runs/${run.id}`}>{t("查看证据")}</Link></td></tr>) : <tr><td colSpan={6}>{t("尚无运行记录。")}</td></tr>}</tbody></table></div></section>
      <section className="surface feedback"><header><h2>{t("公开反馈")}</h2>{latest ? <Link to={`/runs/${latest.id}`}>{t("查看证据")}</Link> : null}</header>{data.runs.length ? data.runs.slice(0, 3).map((run) => <div className={`feedback-row ${run.status === "passed" ? "pass" : "fail"}`} key={run.id}>{run.status === "passed" ? <CheckCircle2 /> : <AlertCircle />}<div><strong>{run.stage_key} · {t(run.status)}</strong><small>{run.public_message || t("未提供公开反馈。")}</small></div></div>) : <p className="empty-copy">{t("暂无公开反馈。")}</p>}</section>
    </div><section className="surface deep-links"><header><h2>{t("深入查看：架构与证据")}</h2></header><div><Link to="/architecture"><Network /><span><strong>{t("查看架构视图")}</strong><small>{t("浏览模块、接口与依赖关系")}</small></span><ArrowRight /></Link><Link to={latest ? `/runs/${latest.id}` : "/workspace"}><ServerCog /><span><strong>{t("证据树")}</strong><small>{t(latest ? "查看最新运行的可见证据" : "等待首次运行")}</small></span><ArrowRight /></Link><Link to="/stages"><FileText /><span><strong>{t("规格条目覆盖")}</strong><small>{t("{{count}} 项当前证据要求",{count:current.required_evidence.length})}</small></span><ArrowRight /></Link></div></section>
  </div>;
}

export function Status({ value }: { value: string }) {
  const { t } = useTranslation();
  const kind = value.includes("通过") && !value.includes("未") || value === "passed" || value === "Passed" ? "ok" : value.includes("进行") || value.includes("排队") || ["queued","leased","running"].includes(value) ? "info" : value.includes("未") || value.includes("失败") || ["failed","cancelled","timed_out"].includes(value) ? "bad" : "muted";
  return <span className={`status ${kind}`}>{kind === "ok" ? <CheckCircle2 /> : kind === "bad" ? <AlertCircle /> : kind === "info" ? <Clock3 /> : <Circle />}{t(value)}</span>;
}
