import { Button, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { ArrowRight24Regular, CheckmarkCircle24Regular, Circle24Regular } from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRepository } from "../repository-context.tsx";
import { portalQueryKey, usePortalScope } from "../portal-scope.tsx";
import { PageLoading } from "../ui/page-state.tsx";

export function StageDetailPage() {
  const repository = useRepository();
  const scope = usePortalScope();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const query = useQuery({ queryKey: portalQueryKey(scope, "stage-detail", params.get("stage")), queryFn: () => repository.dashboard() });
  if (query.isLoading) return <PageLoading label={t("正在加载阶段详情…")} />;
  if (query.isError || !query.data) return <MessageBar intent="error"><MessageBarBody>{query.error instanceof Error ? query.error.message : t("无法加载阶段详情")}</MessageBarBody><Button appearance="secondary" onClick={() => void query.refetch()}>{t("重试")}</Button></MessageBar>;
  const stage = query.data.stages.find((item) => item.key === params.get("stage")) ?? query.data.project.current_stage;
  const stageRuns = query.data.runs.filter((run) => run.stage_key === stage.key);
  return <div className="page stage-detail"><header className="page-heading"><div><p>{query.data.course.code} · Lab {stage.sequence + 1}</p><h1>{stage.name}</h1><span className="muted-copy">{t("阶段要求是可验证的公开契约；完成后再提交运行与证据。")}</span></div><span className={`status ${stage.status === "passed" ? "ok" : stage.status === "locked" ? "muted" : "info"}`}>{stage.status === "passed" ? <CheckmarkCircle24Regular /> : <Circle24Regular />}{t(stage.status)}</span></header><div className="detail-grid"><section className="surface detail-card"><header><h2>{t("完成清单")}</h2></header><h3>{t("必须提交的产物")}</h3><ul>{stage.required_artifacts.map((item) => <li key={item}>{item}</li>)}</ul><h3>{t("必须提供的证据")}</h3><ul>{stage.required_evidence.map((item) => <li key={`${item.suite}-${item.case_name}`}>{item.suite} · {item.case_name} · {item.required_result}</li>)}</ul>{stage.manual_review_required ? <MessageBar intent="info"><MessageBarBody>{t("该阶段需要教职工人工复核。")}</MessageBarBody></MessageBar> : null}</section><section className="surface detail-card"><header><h2>{t("本阶段运行")}</h2><span>{stageRuns.length}</span></header>{stageRuns.map((run) => <article className="run-summary" key={run.id}><div><b>{run.id}</b><small>{new Date(run.created_at).toLocaleString()}</small></div><span><strong>{run.passed}/{run.total}</strong> <span className={`status ${run.status === "passed" ? "ok" : "bad"}`}>{t(run.status)}</span></span><Link to={`/runs/${run.id}`}>{t("查看证据")} <ArrowRight24Regular /></Link></article>)}{!stageRuns.length ? <p className="empty-copy">{t("本阶段还没有运行记录。")}</p> : null}</section></div></div>;
}
