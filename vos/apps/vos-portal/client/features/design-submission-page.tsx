import { Button, Input, Textarea } from "@fluentui/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type {
  DesignReviewInputV1,
  DesignSubmissionInputV1,
} from "vos-core/portal-contracts";
import { useTranslation } from "react-i18next";
import { useRepository } from "../repository-context.tsx";
import { portalQueryKey, usePortalScope } from "../portal-scope.tsx";

export function DesignSubmissionPage() {
  const { t, i18n } = useTranslation();
  const repository = useRepository();
  const scope = usePortalScope();
  const queryClient = useQueryClient();
  const dashboard = useQuery({
    queryKey: portalQueryKey(scope, "dashboard"),
    queryFn: () => repository.dashboard(),
  });
  const projectId = dashboard.data?.project.project_id;
  const designs = useQuery({
    queryKey: portalQueryKey(scope, "design-submissions"),
    queryFn: () => repository.designSubmissions(projectId!),
    enabled: Boolean(projectId),
  });
  const [title, setTitle] = useState("内存映射与 TLB 一致性设计");
  const [summary, setSummary] = useState(
    "说明页表更新、跨核失效与释放物理页之间的顺序关系，并将关键不变量映射到公开证据。",
  );
  const [invariants, setInvariants] = useState(
    "释放物理页前，所有相关 hart 必须确认旧 TLB 项已经失效。\n页表写入必须先于跨核失效请求对其他 hart 可见。",
  );
  const [interfaceName, setInterfaceName] = useState("vm_unmap");
  const [interfaceContract, setInterfaceContract] = useState(
    "移除页表项并在返回前完成相关 hart 的 TLB 失效确认。",
  );
  const [reason, setReason] = useState("提交当前阶段设计供课程团队审核");
  const [feedback, setFeedback] =
    useState("设计内容与阶段不变量及证据引用一致。");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (!dashboard.data)
    return <div className="page-loading">{t("正在加载…")}</div>;
  const data = dashboard.data;
  const latest = designs.data?.[0];
  const isStudent = data.actor.role === "student";
  const canSubmit =
    isStudent && (!latest || latest.status === "changes_requested");
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await queryClient.invalidateQueries({ queryKey: ["portal"] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    const input: DesignSubmissionInputV1 = {
      version: "design-submission-input.v1",
      project_id: data.project.project_id,
      stage_key: data.project.current_stage.key,
      commit_sha: data.runs[0]?.commit_sha ?? "",
      title,
      summary,
      invariants: invariants
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      interfaces: interfaceName.trim()
        ? [{ name: interfaceName.trim(), contract: interfaceContract.trim() }]
        : [],
      evidence_refs: data.runs[0] ? [data.runs[0].id] : [],
      reason,
    };
    await repository.submitDesign(input);
  }
  async function review(target: DesignReviewInputV1["target_status"]) {
    if (!latest) return;
    await repository.reviewDesign({
      version: "design-review-input.v1",
      submission_id: latest.id,
      target_status: target,
      feedback,
      reason,
    });
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>{t("设计提交与架构审查")}</h1>
          <p>
            {t(
              "设计修订绑定 commit ledger；审核状态和反馈进入不可变事件与审计链。",
            )}
          </p>
        </div>
      </div>
      <div className="design-layout">
        <section className="surface design-history">
          <header>
            <h2>{t("设计修订历史")}</h2>
          </header>
          {designs.isLoading ? (
            <div className="empty-panel">{t("正在加载设计提交…")}</div>
          ) : designs.data?.length ? (
            designs.data.map((item) => (
              <article key={item.id}>
                <header>
                  <div>
                    <strong>
                      v{item.revision} · {item.title}
                    </strong>
                    <small>
                      {item.commit_sha.slice(0, 12)} · {t(item.status)}
                    </small>
                  </div>
                  <time dateTime={item.updated_at}>
                    {new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(item.updated_at))}
                  </time>
                </header>
                <p>{item.summary}</p>
                <h3>{t("关键不变量")}</h3>
                <ul>
                  {item.invariants.map((value) => (
                    <li key={value}>{value}</li>
                  ))}
                </ul>
                {item.interfaces.length ? (
                  <>
                    <h3>{t("接口契约")}</h3>
                    {item.interfaces.map((value) => (
                      <dl key={value.name}>
                        <dt>{value.name}</dt>
                        <dd>{value.contract}</dd>
                      </dl>
                    ))}
                  </>
                ) : null}
                {item.review_feedback ? (
                  <blockquote>{item.review_feedback}</blockquote>
                ) : null}
              </article>
            ))
          ) : (
            <div className="empty-panel">{t("尚未提交设计修订。")}</div>
          )}
        </section>
        <section className="surface design-actions">
          <header>
            <h2>{t(isStudent ? "提交设计修订" : "审核当前修订")}</h2>
          </header>
          {canSubmit ? (
            <div className="design-form">
              <label>
                {t("标题")}
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label>
                {t("设计摘要")}
                <Textarea
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
              <label>
                {t("关键不变量（每行一条）")}
                <Textarea
                  value={invariants}
                  onChange={(event) => setInvariants(event.target.value)}
                />
              </label>
              <label>
                {t("接口名称")}
                <Input
                  value={interfaceName}
                  onChange={(event) => setInterfaceName(event.target.value)}
                />
              </label>
              <label>
                {t("接口契约")}
                <Textarea
                  value={interfaceContract}
                  onChange={(event) => setInterfaceContract(event.target.value)}
                />
              </label>
              <label>
                {t("操作理由")}
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <Button
                appearance="primary"
                disabled={busy || reason.trim().length < 10}
                onClick={() => void run(submit, t("设计修订已提交。"))}
              >
                {t("提交设计")}
              </Button>
            </div>
          ) : isStudent ? (
            <div className="empty-panel">
              {t("当前修订正在审核或已经通过；收到修改要求后可提交新修订。")}
            </div>
          ) : latest ? (
            <div className="design-form">
              <label>
                {t("审核反馈")}
                <Textarea
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                />
              </label>
              <label>
                {t("审计理由")}
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="action-row">
                {latest.status === "submitted" ? (
                  <Button
                    appearance="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(() => review("review"), t("修订已进入审核。"))
                    }
                  >
                    {t("开始审核")}
                  </Button>
                ) : null}
                {latest.status === "submitted" || latest.status === "review" ? (
                  <Button
                    appearance="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => review("changes_requested"),
                        t("修改要求已发送。"),
                      )
                    }
                  >
                    {t("要求修改")}
                  </Button>
                ) : null}
                {latest.status === "review" ? (
                  <Button
                    appearance="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(() => review("passed"), t("设计修订已通过。"))
                    }
                  >
                    {t("通过设计")}
                  </Button>
                ) : null}
                {latest.status === "passed" &&
                (data.actor.role === "teacher" ||
                  data.actor.role === "admin") ? (
                  <Button
                    appearance="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(() => review("frozen"), t("设计修订已冻结。"))
                    }
                  >
                    {t("冻结设计")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty-panel">{t("等待学生提交设计修订。")}</div>
          )}
          {message ? (
            <p className="operation-message" role="status">
              {message}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
