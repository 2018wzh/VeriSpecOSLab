import { Button, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { ArrowRight24Regular, Beaker24Regular } from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRepository } from "../repository-context.tsx";
import { portalQueryKey, usePortalScope } from "../portal-scope.tsx";
import { Status } from "./student-dashboard.tsx";
import { PageLoading } from "../ui/page-state.tsx";

export function RunsPage() {
  const repository = useRepository();
  const scope = usePortalScope();
  const { t } = useTranslation();
  const query = useQuery({ queryKey: portalQueryKey(scope, "runs"), queryFn: () => repository.dashboard() });
  if (query.isLoading) return <PageLoading label={t("正在加载运行列表…")} />;
  if (query.isError || !query.data) return <MessageBar intent="error"><MessageBarBody>{query.error instanceof Error ? query.error.message : t("无法加载运行列表")}</MessageBarBody><Button appearance="secondary" onClick={() => void query.refetch()}>{t("重试")}</Button></MessageBar>;
  const runs = [...query.data.runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return <div className="page runs-page"><header className="page-heading"><div><p>{query.data.course.code} · {query.data.course.term}</p><h1>{t("运行与证据")}</h1><span className="muted-copy">{t("每次公开测评都关联阶段、提交、结果和可见证据。")}</span></div><Beaker24Regular aria-hidden="true" /></header><section className="surface run-list"><header><h2>{t("全部运行")}</h2><span>{runs.length} {t("条记录")}</span></header>{runs.length ? <div className="table-wrap"><table><thead><tr><th>{t("阶段")}</th><th>{t("状态")}</th><th>{t("通过项")}</th><th>{t("创建时间")}</th><th>{t("公开反馈")}</th><th /></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td><b>{run.stage_key}</b><small>{run.commit_sha.slice(0, 12)}</small></td><td><Status value={run.status} /></td><td>{run.passed} / {run.total}</td><td>{new Date(run.created_at).toLocaleString()}</td><td>{run.public_message || "—"}</td><td><Link className="button secondary" to={`/runs/${run.id}`}>{t("查看证据")} <ArrowRight24Regular /></Link></td></tr>)}</tbody></table></div> : <p className="empty-copy">{t("尚无运行记录。")}</p>}</section></div>;
}
