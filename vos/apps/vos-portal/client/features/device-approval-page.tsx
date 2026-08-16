import { Button, Input } from "@fluentui/react-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRepository } from "../repository-context.tsx";

export function DeviceApprovalPage() {
  const { t } = useTranslation();
  const repository = useRepository();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function approve() {
    if (!repository.approveDevice) { setMessage(t("当前构建不支持设备授权。")); return; }
    setBusy(true); setMessage("");
    try { await repository.approveDevice(code.trim().toUpperCase()); setMessage(t("设备已授权。现在可以返回终端。")); setCode(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="page"><div className="page-heading"><div><h1>{t("CLI 设备授权")}</h1><p>{t("确认终端显示的八位代码。授权只对当前登录账户生效。")}</p></div></div><section className="surface device-approval"><label>{t("设备代码")}<Input autoComplete="one-time-code" inputMode="text" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())} placeholder="ABCD1234" /></label><Button appearance="primary" disabled={busy || code.length !== 8} onClick={() => void approve()}>{t(busy ? "正在授权…" : "授权此设备")}</Button>{message ? <p className="operation-message" role="status">{message}</p> : null}<p className="muted">{t("如果你没有在终端发起登录，请勿授权并关闭本页。")}</p></section></div>;
}
