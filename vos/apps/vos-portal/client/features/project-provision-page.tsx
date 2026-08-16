import { Button, Input, Select, Textarea } from "@fluentui/react-components";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProjectProvisionStatusV1 } from "vos-core/portal-contracts";
import { useRepository } from "../repository-context.tsx";
import { portalQueryKey, usePortalScope } from "../portal-scope.tsx";
import { useTranslation } from "react-i18next";
import { PageError, PageLoading } from "../ui/page-state.tsx";

const ACTIVE_PROVISION_STATUSES = new Set(["queued", "provisioning"]);

export function ProjectProvisionPage() {
  const { t } = useTranslation();
  const repository = useRepository();
  const scope = usePortalScope();
  const options = useQuery({
    queryKey: portalQueryKey(scope, "project-provision-options"),
    queryFn: () => repository.projectProvisionOptions(),
  });
  const [experimentId, setExperimentId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [owner, setOwner] = useState("os-2026");
  const [repositoryName, setRepositoryName] = useState("");
  const [templateOwner, setTemplateOwner] = useState("templates");
  const [templateRepository, setTemplateRepository] = useState("xv6-spec");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [retryReason, setRetryReason] = useState("");
  const [created, setCreated] = useState<ProjectProvisionStatusV1>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedCourseId = options.data?.experiments.find(item => item.id === experimentId)?.course_id;
  const eligibleMembers = useMemo(() => options.data?.members.filter(item => item.course_id === selectedCourseId) ?? [], [options.data?.members, selectedCourseId]);

  useEffect(() => {
    if (!options.data) return;
    setExperimentId(current => current || options.data.experiments[0]?.id || "");
  }, [options.data]);

  useEffect(() => {
    if (!eligibleMembers.some(item => item.id === memberId)) setMemberId(eligibleMembers[0]?.id ?? "");
  }, [eligibleMembers, memberId]);

  const status = useQuery({
    queryKey: portalQueryKey(scope, "project-provisioning", created?.project_id),
    queryFn: () => repository.projectProvisioning(created!.project_id),
    enabled: Boolean(created),
    initialData: created,
    refetchInterval: query => ACTIVE_PROVISION_STATUSES.has(query.state.data?.status ?? "") ? 1_000 : false,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await repository.createProject({
        version: "project-provision-request.v1",
        experiment_id: experimentId,
        member_ids: [memberId],
        owner,
        repository: repositoryName,
        template_owner: templateOwner,
        template_repository: templateRepository,
        description,
        private: true,
        reason,
      });
      setCreated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function retry() {
    if (!created) return;
    setError("");
    try {
      const result = await repository.retryProjectProvisioning(created.project_id, retryReason);
      setCreated(result);
      await status.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return <div className="page">
    <div className="page-heading">
      <div>
        <h1>{t("项目与仓库供应")}</h1>
        <p>{t("从已发布实验版本创建私有 Gitea 仓库，并将成员、webhook 与策略快照绑定到项目。")}</p>
      </div>
    </div>
    <div className="workspace-layout">
      <section className="surface">
        <header><h2>{t("创建教学项目")}</h2></header>
        {options.isLoading ? <PageLoading label={t("正在加载实验与成员…")} /> : null}
        {options.isError ? <PageError message={options.error instanceof Error ? options.error.message : String(options.error)} retryLabel={t("重试")} onRetry={() => void options.refetch()} /> : null}
        {options.data ? <form className="provision-form" onSubmit={event => void submit(event)}>
          <label>{t("实验版本")}
            <Select value={experimentId} onChange={event => setExperimentId(event.target.value)} required>
              {options.data.experiments.map(item => <option key={item.id} value={item.id}>{item.title} · {item.spec_version}</option>)}
            </Select>
          </label>
          <label>{t("项目成员")}
            <Select value={memberId} onChange={event => setMemberId(event.target.value)} required>
              {eligibleMembers.map(item => <option key={item.id} value={item.id}>{item.display_name} · {item.username}</option>)}
            </Select>
          </label>
          <div className="form-pair">
            <label>{t("Gitea 所有者")}<Input value={owner} onChange={event => setOwner(event.target.value)} pattern="[A-Za-z0-9_.\-]+" required /></label>
            <label>{t("仓库名")}<Input value={repositoryName} onChange={event => setRepositoryName(event.target.value)} pattern="[A-Za-z0-9_.\-]+" required /></label>
          </div>
          <div className="form-pair">
            <label>{t("模板所有者")}<Input value={templateOwner} onChange={event => setTemplateOwner(event.target.value)} required /></label>
            <label>{t("模板仓库")}<Input value={templateRepository} onChange={event => setTemplateRepository(event.target.value)} required /></label>
          </div>
          <label>{t("仓库说明")}<Input value={description} onChange={event => setDescription(event.target.value)} maxLength={255} required /></label>
          <label>{t("创建理由")}<Textarea value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={500} required /></label>
          <p className="form-hint">{t("仓库固定为私有；供应失败不会激活项目，也不会回退到本地仓库。")}</p>
          <Button appearance="primary" disabled={submitting} type="submit">{t(submitting ? "正在提交…" : "创建并进入供应队列")}</Button>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </form> : null}
      </section>
      <section className="surface">
        <header><h2>{t("供应状态")}</h2></header>
        {status.isError ? <PageError message={status.error instanceof Error ? status.error.message : String(status.error)} retryLabel={t("重试")} onRetry={() => void status.refetch()} /> : status.data ? <div className="provision-status" aria-live="polite">
          <dl className="detail-list">
            <div><dt>{t("项目")}</dt><dd>{status.data.project_id}</dd></div>
            <div><dt>{t("仓库")}</dt><dd>{status.data.owner}/{status.data.repository}</dd></div>
            <div><dt>{t("状态")}</dt><dd>{t(statusLabel(status.data.status))}</dd></div>
            <div><dt>{t("尝试次数")}</dt><dd>{status.data.attempts}</dd></div>
            {status.data.repo_url ? <div><dt>Clone URL</dt><dd>{status.data.repo_url}</dd></div> : null}
          </dl>
          {status.data.last_error ? <p className="form-error" role="alert">{status.data.last_error}</p> : null}
          {status.data.status === "failed" ? <>
            <label className="reason">{t("重试理由")}<Textarea value={retryReason} onChange={event => setRetryReason(event.target.value)} minLength={10} /></label>
            <Button appearance="secondary" disabled={retryReason.trim().length < 10} onClick={() => void retry()}>{t("重新进入供应队列")}</Button>
          </> : null}
        </div> : <div className="empty-panel">{t("尚未创建新的供应任务。")}</div>}
      </section>
    </div>
  </div>;
}

function statusLabel(status: ProjectProvisionStatusV1["status"]): string {
  return {
    queued: "等待供应",
    provisioning: "正在供应",
    active: "已激活",
    failed: "供应失败",
  }[status];
}
