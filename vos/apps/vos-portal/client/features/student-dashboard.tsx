import { AlertCircle, ArrowRight, CheckCircle2, Circle, Clock3 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRepository } from "../repository-context.tsx";

export function StudentDashboard(){
  const repository=useRepository();const {t}=useTranslation();const dashboard=useQuery({queryKey:["dashboard"],queryFn:()=>repository.dashboard()});
  if(dashboard.isLoading)return <div className="page-loading">{t("正在加载学习工作台…")}</div>;if(!dashboard.data)return <div className="error-state">{dashboard.error instanceof Error?dashboard.error.message:t("无法加载工作台")}</div>;
  const data=dashboard.data;const current=data.project.current_stage;const latest=data.runs[0];const completed=data.stages.filter(stage=>stage.status==="passed").length;
  return <main className="page student-home">
    <div className="student-title"><div><p>{data.course.code} · {data.course.term}</p><h1>{t("操作系统课程实验")}</h1></div><span>{t("已完成 {{done}} / {{total}}",{done:completed,total:data.stages.length})}</span></div>
    <nav className="lab-track" aria-label={t("Lab 进度")}>{data.stages.map((stage,index)=><Link to="/stages" key={stage.id} className={`lab-step ${stage.status}`} aria-current={stage.id===current.id?"step":undefined}><i>{stage.status==="passed"?<CheckCircle2/>:index+1}</i><span>Lab {index+1}</span><small>{stage.name}</small></Link>)}</nav>
    <section className="primary-action surface"><div><small>{t("当前任务")} · Lab {current.sequence+1}</small><h2>{t("继续完成 {{stage}}",{stage:current.name})}</h2><p>{t("完成规格与实现后，在终端运行公开远程测评；本地工作流仍保持离线。")}</p><div className="action-meta"><span>{current.required_artifacts.length} {t("项产物")}</span><span>{current.required_evidence.length} {t("项证据")}</span>{current.manual_review_required?<span>{t("需要人工复核")}</span>:null}</div></div><Link className="button primary" to="/workspace">{t("进入实验")} <ArrowRight/></Link></section>
    <div className="student-summary">
      <section className="surface overview"><header><h2>{t("课程概览")}</h2></header><dl><div><dt>{t("当前阶段")}</dt><dd>{current.name}</dd></div><div><dt>{t("最近测评")}</dt><dd>{latest?t(latest.status):t("尚未运行")}</dd></div><div><dt>{t("课程状态")}</dt><dd>{t(data.course.status)}</dd></div><div><dt>{t("当前成绩")}</dt><dd>{data.score.snapshot_version?`${data.score.final_score} / 100`:t("尚未发布")}</dd></div></dl></section>
      <section className="surface recent-assessments"><header><h2>{t("最近测评")}</h2><Link to="/workspace">{t("查看全部")}</Link></header>{data.runs.slice(0,3).map(run=><article key={run.id}><Status value={run.status}/><div><b>{run.stage_key}</b><small>{run.commit_sha.slice(0,12)} · {run.passed}/{run.total}</small></div><Link to={`/runs/${run.id}`}>{t("查看证据")}</Link></article>)}{!data.runs.length?<p className="empty-copy">{t("尚无测评记录。")}</p>:null}</section>
      <section className="surface recent-feedback"><header><h2>{t("最近反馈")}</h2></header>{data.runs.slice(0,3).map(run=><article key={run.id}>{run.status==="passed"?<CheckCircle2/>:<AlertCircle/>}<div><b>{run.stage_key} · {t(run.status)}</b><p>{run.public_message||t("暂无公开反馈。")}</p></div></article>)}{!data.runs.length?<p className="empty-copy">{t("暂无公开反馈。")}</p>:null}</section>
    </div>
    <section className="evidence-links" aria-label={t("证据链接")}><Link to={latest?`/runs/${latest.id}`:"/workspace"}>{t("打开最新测评证据")} <ArrowRight/></Link><Link to="/architecture">{t("查看规格与架构")} <ArrowRight/></Link><Link to="/grades">{t("查看成绩与申诉")} <ArrowRight/></Link></section>
  </main>;
}

export function Status({value}:{value:string}){const {t}=useTranslation();const kind=value.includes("通过")&&!value.includes("未")||value==="passed"||value==="Passed"?"ok":value.includes("进行")||value.includes("排队")||["queued","leased","running"].includes(value)?"info":value.includes("未")||value.includes("失败")||["failed","cancelled","timed_out"].includes(value)?"bad":"muted";return <span className={`status ${kind}`}>{kind==="ok"?<CheckCircle2/>:kind==="bad"?<AlertCircle/>:kind==="info"?<Clock3/>:<Circle/>}{t(value)}</span>;}
