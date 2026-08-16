import { Button, Input, Textarea } from "@fluentui/react-components";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRepository } from "../repository-context.tsx";

export function EnrollmentInvitePage() {
  const { t }=useTranslation();
  const repository=useRepository();
  const queryClient=useQueryClient();
  const [code,setCode]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  async function redeem(){setBusy(true);setMessage("");setError("");try{const result=await repository.redeemEnrollmentInvite({code:code.trim(),reason:reason.trim()});await queryClient.invalidateQueries({queryKey:["portal"]});setMessage(t("已加入课程，成员角色为 {{role}}。",{role:t(result.role==="student"?"学生":"助教")}));setCode("");}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}}
  return <div className="page"><div className="page-heading"><div><h1>{t("使用邀请码加入课程")}</h1><p>{t("邀请码绑定课程和角色，并受有效期与使用次数限制。")}</p></div></div><section className="surface invite-redeem"><label>{t("课程邀请码")}<Input autoComplete="off" value={code} onChange={event=>setCode(event.target.value)} /></label><label>{t("操作理由")}<Textarea minLength={10} value={reason} onChange={event=>setReason(event.target.value)} /></label><Button appearance="primary" disabled={busy||code.trim().length<20||reason.trim().length<10} onClick={()=>void redeem()}>{t("兑换并加入")}</Button>{message?<p role="status" className="operation-message">{message}</p>:null}{error?<p role="alert" className="form-error">{error}</p>:null}</section></div>;
}
