import { Button, Textarea } from "@fluentui/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepository } from "../repository-context.tsx";
import { portalQueryKey, usePortalScope } from "../portal-scope.tsx";
import { PageError, PageLoading } from "../ui/page-state.tsx";

const copy = {
  courses: ["课程配置", "版本化维护课程、阶段门禁、评分规则与 AI policy。"],
  stages: ["阶段与成员", "查看阶段要求、学生与分组以及设计提交状态。"],
  architecture: ["架构视图", "按模块、接口与不变量查看当前阶段的结构化设计。"],
  qa: ["问答与 AI 审计", "在当前项目和阶段上下文中提问，保留对象引用与审计摘要。"],
  grades: ["评分与申诉", "查看证据映射、项目基线分、个人调整与申诉记录。"],
  appeals: ["申诉", "提交带证据引用的申诉说明，历史裁决不可改写。"],
  admin: ["课程分析与管理", "管理 OIDC、Gitea、MinIO、模型额度、worker 与保留策略。"],
} as const;

export function WorkspacePage({ kind }: { kind: keyof typeof copy }) {
  const { t } = useTranslation();
  const repository = useRepository();
  const scope = usePortalScope();
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: portalQueryKey(scope, "dashboard"), queryFn: () => repository.dashboard() });
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [qa, setQa] = useState<string[]>([]);
  const stopQa=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>stopQa.current?.(),[]);
  const audits = useQuery({ queryKey: portalQueryKey(scope, "agent-audits"), queryFn: () => repository.agentAudits(), enabled: kind === "qa" && Boolean(dashboard.data && dashboard.data.actor.role !== "student") });
  if (dashboard.isLoading) return <PageLoading label={t("正在加载…")} />;
  if (dashboard.isError || !dashboard.data) return <PageError message={dashboard.error instanceof Error ? dashboard.error.message : t("无法加载工作台")} retryLabel={t("重试")} onRetry={() => void dashboard.refetch()} />;
  const data = dashboard.data;
  const qaIsAudit = kind === "qa" && data.actor.role !== "student";

  async function submit() {
    setMessage("");
    try {
      if (kind === "qa") {
        const thread = await repository.ask({ content: text });
        setQa(thread.messages.map((item) => `${item.role === "assistant" ? "VOS" : t("你")}：${item.content}`));
        stopQa.current?.();
        stopQa.current=repository.watchQa(thread.id,thread.messages.length,next=>{setQa(next.messages.map((item)=>`${item.role === "assistant" ? "VOS" : t("你")}：${item.content}`));if(next.messages.at(-1)?.role==="assistant"){setMessage("");stopQa.current?.();stopQa.current=null;}},error=>setMessage(error.message));
      } else if (kind === "appeals" || kind === "grades") {
        const appeal = await repository.submitAppeal({ project_id: data.project.project_id, statement: text, evidence_refs: [data.runs[0].id] });
        setMessage(t("已提交申诉 {{id}}", { id: appeal.id }));
      }
      setText("");
      await queryClient.invalidateQueries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const facts = [["必需产物", String(data.project.current_stage.required_artifacts.length)], ["必需证据", String(data.project.current_stage.required_evidence.length)], ["运行记录", String(data.runs.length)], ["策略快照", data.project.policy_snapshot_ref]] as const;
  return <div className="page">
    <div className="page-heading"><div><h1>{t(copy[kind][0])}</h1><p>{t(copy[kind][1])}</p></div></div>
    <div className="workspace-layout">
      <section className="surface"><header><h2>{t(kind === "courses" ? "当前课程版本" : kind === "admin" ? "服务状态" : "当前上下文")}</h2></header><dl className="detail-list"><div><dt>{t("课程")}</dt><dd>{data.course.name} · {data.course.term}</dd></div><div><dt>{t("项目")}</dt><dd>{data.project.project_id}</dd></div><div><dt>{t("阶段")}</dt><dd>{data.project.current_stage.name}</dd></div><div><dt>{t("策略快照")}</dt><dd>{data.project.policy_snapshot_ref}</dd></div></dl></section>
      <section className="surface"><header><h2>{t(qaIsAudit ? "Agent 审计" : kind === "qa" ? "阶段问答" : kind === "grades" || kind === "appeals" ? "提交申诉" : "当前教学事实")}</h2></header>{qaIsAudit ? <div className="structured-list">{audits.isError ? <PageError message={audits.error instanceof Error ? audits.error.message : String(audits.error)} retryLabel={t("重试")} onRetry={() => void audits.refetch()} /> : audits.data?.length ? audits.data.map((audit) => <div key={audit.id}><b>{audit.task_kind} · {audit.model}</b><span>{audit.risk_level} · {audit.prompt_summary}</span></div>) : <div><b>{t("暂无 Agent 审计")}</b><span>{t("完成的课程问答会在此展示")}</span></div>}</div> : kind === "qa" || kind === "grades" || kind === "appeals" ? <><div className="messages">{qa.map((item) => <p key={item}>{item}</p>)}</div><label className="reason">{t(kind === "qa" ? "问题" : "申诉说明")}<Textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={t(kind === "qa" ? "询问当前阶段的设计问题" : "说明争议并引用相关证据")} /></label><Button appearance="primary" disabled={!text.trim()} onClick={() => void submit()}>{t("提交操作")}</Button>{message ? <p className="operation-message">{message}</p> : null}</> : <div className="structured-list">{facts.map(([label, value]) => <div key={label}><b>{t(label)}</b><span>{value}</span></div>)}</div>}</section>
    </div>
  </div>;
}
