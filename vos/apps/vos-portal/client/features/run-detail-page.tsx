import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { Alert24Regular, CheckmarkCircle24Regular, Circle24Regular, Copy24Regular, EyeOff24Regular, Play24Regular, Search24Regular, Shield24Regular } from "@fluentui/react-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { useRepository } from "../repository-context.tsx";
import { portalQueryKey, usePortalScope } from "../portal-scope.tsx";
import { useTranslation } from "react-i18next";
import { PageLoading } from "../ui/page-state.tsx";

export function RunDetailPage() {
  const { t } = useTranslation();
  const { runId = "" } = useParams();
  const repository = useRepository();
  const scope = usePortalScope();
  const queryClient = useQueryClient();
  const evidence = useQuery({ queryKey: portalQueryKey(scope, "evidence", runId), queryFn: () => repository.evidence(runId), enabled: Boolean(runId) });
  const dashboard = useQuery({ queryKey: portalQueryKey(scope, "dashboard"), queryFn: () => repository.dashboard() });
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [rerunOpen, setRerunOpen] = useState(false);
  const [rerunDialogMounted, setRerunDialogMounted] = useState(false);
  const [rerunReason, setRerunReason] = useState("");
  useEffect(() => { if (!selected && evidence.data?.evidence[0]) setSelected(evidence.data.evidence[0].id); }, [evidence.data, selected]);
  if (evidence.isLoading) return <PageLoading label={t("正在加载运行证据…")} />;
  if (evidence.isError || !evidence.data) return <MessageBar intent="error"><MessageBarBody>{evidence.error instanceof Error ? evidence.error.message : t("无法读取运行证据")}</MessageBarBody><Button appearance="secondary" onClick={() => void evidence.refetch()}>{t("重试")}</Button></MessageBar>;
  const { run, artifacts } = evidence.data;
  const actor = dashboard.data?.actor;
  const visibleEvidence = evidence.data.evidence;
  const filteredEvidence = visibleEvidence.filter((item) => `${item.suite} ${item.case_name}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const selectedEvidence = visibleEvidence.find((item) => item.id === selected);
  const terminal = ["passed", "failed", "cancelled", "timed_out"].includes(run.status);
  const duration = run.finished_at ? Math.max(0, Date.parse(run.finished_at) - Date.parse(run.created_at)) : undefined;
  async function rerun() {
    if (rerunReason.trim().length < 10) return;
    try {
      const next = await repository.triggerPipeline({ version: "pipeline-request.v1", project_id: run.project_id, commit_sha: run.commit_sha, stage_key: run.stage_key, scope: "public", retry_of: run.id, reason: rerunReason.trim() });
      setNotice(t("已创建运行 {{id}}", { id: next.id }));
      setRerunOpen(false); setRerunReason("");
      await queryClient.invalidateQueries({ queryKey: ["portal"] });
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }
  return <div className="page run-detail">
    <div className="breadcrumb">{t("运行与证据")} / {run.id}</div>
    {actor && actor.role !== "student" ? <div className="run-actions"><Button appearance="primary" disabled={!terminal} icon={<Play24Regular />} onClick={() => { setRerunDialogMounted(true); setRerunOpen(true); }}>{t("重新运行公开验证")}</Button></div> : null}
    <section className="run-meta"><strong className={run.status === "passed" ? "status ok" : "run-failed"}>{run.status === "passed" ? <CheckmarkCircle24Regular /> : <Alert24Regular />}{t(run.status)}</strong><Meta label="Commit" value={run.commit_sha} /><Meta label={t("阶段")} value={run.stage_key} /><Meta label={t("公开结果")} value={`${run.passed} / ${run.total}`} /><Meta label={t("失败分类")} value={run.failure_class ?? "—"} /><Meta label={t("创建时间")} value={new Date(run.created_at).toLocaleString()} /><Meta label={t("耗时")} value={duration === undefined ? t("运行中") : `${Math.round(duration / 1000)}s`} /><Meta label={t("补跑来源")} value={run.retry_of ?? "—"} /></section>
    <div className="projection-notice"><Shield24Regular />{t("当前显示服务端为 {{role}} 角色生成的可见性投影；隐藏内容不会下发。", { role: actor?.role ?? t("当前") })}<span><EyeOff24Regular /> {t("{{count}} 条可见证据", { count: visibleEvidence.length })}</span></div>
    {notice ? <MessageBar intent="info"><MessageBarBody>{notice}</MessageBarBody></MessageBar> : null}
    <div className="evidence-layout"><aside className="surface timeline"><header><h2>{t("证据时间线")}</h2></header>{visibleEvidence.length ? visibleEvidence.map((item, index) => <Button appearance="subtle" key={item.id} className={selected === item.id ? "selected" : ""} onClick={() => setSelected(item.id)}><span className={`step-dot ${item.result === "pass" ? "ok" : "bad"}`}>{item.result === "pass" ? <CheckmarkCircle24Regular /> : <Alert24Regular />}</span><b>{index + 1}</b><strong>{item.suite}</strong><small>{t(item.result)}</small></Button>) : <Button appearance="subtle" disabled><span className="step-dot muted"><Circle24Regular /></span><b>—</b><strong>{t("暂无可见证据")}</strong><small>—</small></Button>}<footer>{t("运行状态")}：{t(run.status)}</footer></aside>
      <section className="surface evidence-main"><div className="tabs"><Button appearance="subtle" className="active">{t("证据树")}</Button></div><div className="evidence-split"><div className="evidence-tree"><label><Search24Regular /><Input aria-label={t("搜索证据")} placeholder={t("搜索套件或用例")} value={filter} onChange={(event) => setFilter(event.target.value)} /></label><Tree label={t("可见证据（{{count}}）", { count: filteredEvidence.length })} open>{filteredEvidence.map((item) => <Button appearance="subtle" key={item.id} className={selected === item.id ? "selected" : ""} onClick={() => setSelected(item.id)}><span>└</span>{item.suite} / {item.case_name}<ResultIcon result={item.result} /></Button>)}</Tree></div><div className="evidence-inspector">{selectedEvidence ? <><header><h2>{selectedEvidence.suite} / {selectedEvidence.case_name}</h2></header><dl><div><dt>{t("结果")}</dt><dd>{t(selectedEvidence.result)}</dd></div><div><dt>{t("公开说明")}</dt><dd>{selectedEvidence.public_message ?? t("未提供")}</dd></div><div><dt>{t("可见性")}</dt><dd>{t(selectedEvidence.visibility)}</dd></div></dl><h3>{t("结构化度量")}</h3><pre>{JSON.stringify(selectedEvidence.metrics, null, 2)}</pre></> : <p className="empty-copy">{t("当前角色没有可查看的证据详情。")}</p>}</div></div><div className="artifact-table"><h2>{t("产物与对象引用")}</h2><table><thead><tr><th>{t("产物")}</th><th>{t("校验和")}</th><th>{t("对象引用")}</th></tr></thead><tbody>{artifacts.length ? artifacts.map((artifact) => <tr key={artifact.id}><td>{artifact.label}</td><td>{artifact.sha256.slice(0, 18)}… <Copy24Regular /></td><td>{artifact.uri}</td></tr>) : <tr><td colSpan={3}>{t("没有当前角色可见的产物。")}</td></tr>}</tbody></table></div></section>
      <aside className="evidence-rail"><section className="surface"><header><h2>{t("公开反馈")}</h2></header><p>{run.public_message || t("未提供公开反馈。")}</p></section><section className="surface"><header><h2>{t("可见性")}</h2></header><p className="legend"><i className="student" />{t("公开与学生投影")}</p>{actor?.role !== "student" ? <p className="legend"><i className="staff" />{t("课程团队投影")}</p> : null}</section><section className="surface lineage"><header><h2>{t("证据谱系")}</h2></header><ol><li>Commit <b>{run.commit_sha}</b></li><li>{t("运行")} <b>{run.id}</b></li>{selectedEvidence ? <li>{t("证据")} <b>{selectedEvidence.id}</b></li> : null}</ol></section></aside>
    </div>
    {rerunDialogMounted ? <Dialog open={rerunOpen} onOpenChange={(_, data) => { if (!data.open) setRerunOpen(false); }}><DialogSurface><DialogBody><DialogTitle>{t("确认重新运行")}</DialogTitle><DialogContent><p>{t("此操作会创建新的公开验证运行，并保留原运行的重试关联。")}</p><Input aria-label={t("重新运行理由")} placeholder={t("至少填写 10 个字符的处理理由")} value={rerunReason} onChange={(event) => setRerunReason(event.target.value)} /></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setRerunOpen(false)}>{t("取消")}</Button><Button appearance="primary" disabled={rerunReason.trim().length < 10} onClick={() => void rerun()}>{t("确认")}</Button></DialogActions></DialogBody></DialogSurface></Dialog> : null}
  </div>;
}
function Meta({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><b>{value}</b></div>; }
function ResultIcon({ result }: { result: string }) { return result === "pass" ? <CheckmarkCircle24Regular className="result-ok" /> : <Alert24Regular className="result-bad" />; }
function Tree({ label, open, children }: { label: string; open?: boolean; children: ReactNode }) { return <div className="tree"><b>{open ? "⌄" : "›"} {label}</b>{children}</div>; }
