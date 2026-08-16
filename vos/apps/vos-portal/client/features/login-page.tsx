import { useEffect, useState } from "react";
import { Button, Input } from "@fluentui/react-components";
import { Shield24Regular } from "@fluentui/react-icons";
import type { OAuthProviderSummaryV1, OidcProviderSummaryV1 } from "vos-core/portal-contracts";
import { useRepository } from "../repository-context.tsx";
import { useTranslation } from "react-i18next";

export function LoginPage({ demo, onLogin }: { demo:boolean; onLogin: () => void }) {
  const { t } = useTranslation();
  const repository = useRepository(); const [username, setUsername] = useState("student"); const [password, setPassword] = useState("student"); const [error, setError] = useState("");
  const [providers,setProviders]=useState<OidcProviderSummaryV1[]>([]);
  const [oauthProviders,setOauthProviders]=useState<OAuthProviderSummaryV1[]>([]);
  useEffect(()=>{let active=true;void Promise.all([repository.oidcProviders(),repository.oauthProviders()]).then(([oidc,oauth])=>{if(active){setProviders(oidc);setOauthProviders(oauth);}}).catch((reason)=>{if(active)setError(reason instanceof Error?reason.message:String(reason));});return()=>{active=false;};},[repository]);
  return <main className="login-layout"><section className="login-panel">
    <div className="brand"><span className="brand-mark"><Shield24Regular /></span><div><strong>VOS Portal</strong><small>VeriSpecOSLab</small></div></div>
    <div><h1>{t("规范驱动的操作系统实验")}</h1><p>{t("围绕设计、实现与证据完成每一个教学阶段。")}</p></div>
    <form onSubmit={(event) => { event.preventDefault(); setError(""); void repository.login({ username, password }).then(onLogin).catch((reason) => setError(String(reason instanceof Error ? reason.message : reason))); }}>
      <label>{t("账号")}<Input value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} /></label>
      <label>{t("密码")}<Input value={password} type="password" autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}<Button appearance="primary" type="submit">{t("登录")}</Button>
    </form>
    {providers.length?<div className="oidc-providers" aria-label={t("学校统一身份认证")}>{providers.map((provider)=><a className="button outline" key={provider.id} href={`/api/v1/auth/oidc/${encodeURIComponent(provider.id)}/start?return_to=%2Fworkspace`}>{t("使用 {{provider}} 登录",{provider:provider.name})}</a>)}</div>:null}
    {oauthProviders.length?<div className="oidc-providers" aria-label={t("OAuth 登录")}>{oauthProviders.map((provider)=><a className="button outline" key={provider.id} href={`/api/v1/auth/oauth/${encodeURIComponent(provider.id)}/start?return_to=%2Fworkspace`}>{t("使用 {{provider}} 登录",{provider:provider.name})}</a>)}</div>:null}
    {demo?<p className="login-hint">{t("Demo：student、ta、teacher、admin，密码与账号相同。")}</p>:null}
  </section><section className="login-context"><h2>{t("从架构种子到综合评测")}</h2><ol><li>{t("先提交可审查的设计")}</li><li>{t("再提交与设计一致的实现")}</li><li>{t("用不可变证据解释结果")}</li></ol></section></main>;
}
