import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepository } from "../repository-context.tsx";

export function ModelCredentialsPage({ demo }: { demo: boolean }) {
  const repository = useRepository();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const credentials = useQuery({ queryKey: ["model-credentials"], queryFn: () => repository.modelCredentials(), enabled: !demo });
  const [provider, setProvider] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const valid = provider.trim().length > 0 && label.trim().length > 0 && secret.length >= 16 && reason.trim().length >= 10;

  async function save() {
    setMessage("");
    try {
      await repository.saveModelCredential({ version: "model-credential-input.v1", provider: provider.trim(), label: label.trim(), secret, reason: reason.trim() });
      setSecret("");
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["model-credentials"] });
      setMessage(t("凭据已加密保存，密钥不会再次显示。"));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function revoke(id: string) {
    setMessage("");
    try {
      await repository.revokeModelCredential(id, reason.trim());
      await queryClient.invalidateQueries({ queryKey: ["model-credentials"] });
      setMessage(t("凭据已撤销。"));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  return <div className="page"><div className="page-heading"><div><h1>{t("模型凭据")}</h1><p>{t("自带模型凭据由服务端包封加密，仅显示末四位；撤销操作保留审计记录。")}</p></div></div>
    {demo ? <section className="surface"><div className="empty-notice"><b>{t("Demo 不保存模型密钥")}</b><span>{t("静态演示构建不包含数据库、主密钥或模型 provider 代码路径。")}</span></div></section> : <div className="workspace-layout">
      <section className="surface"><header><h2>{t("已保存凭据")}</h2><small>{credentials.data?.length ?? 0}</small></header><div className="structured-list">
        {credentials.isError ? <div className="form-error">{credentials.error instanceof Error ? credentials.error.message : String(credentials.error)}</div> : null}
        {credentials.data?.length ? credentials.data.map((credential) => <div key={credential.id}><span><b>{credential.label}</b><small>{credential.provider} · •••• {credential.last_four}</small></span><span>{credential.revoked_at ? t("已撤销") : <button className="button danger" disabled={reason.trim().length < 10} onClick={() => void revoke(credential.id)}>{t("撤销")}</button>}</span></div>) : <div><b>{t("暂无模型凭据")}</b><span>{t("课程策略允许 BYOK 后可在此添加。")}</span></div>}
      </div></section>
      <section className="surface credential-form"><header><h2>{t("添加凭据")}</h2></header>
        <label>{t("Provider 标识")}<input value={provider} onChange={(event) => setProvider(event.target.value)} autoComplete="off" /></label>
        <label>{t("显示名称")}<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <label>{t("模型密钥")}<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" /></label>
        <label>{t("操作理由")}<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button className="button primary" disabled={!valid} onClick={() => void save()}>{t("加密保存")}</button>
        {message ? <p className="operation-message" role="status">{message}</p> : null}
      </section>
    </div>}
  </div>;
}
