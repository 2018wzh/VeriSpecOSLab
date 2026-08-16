import { Button, Checkbox, Input, Select, Textarea } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  ModelProviderInputV1,
  ModelQuotaPolicyInputV1,
} from "vos-core/portal-contracts";
import { useRepository } from "../repository-context.tsx";
import { portalQueryKey, usePortalScope } from "../portal-scope.tsx";

const initialProvider: ModelProviderInputV1 = {
  version: "model-provider-input.v1",
  id: "school-model",
  name: "学校托管模型",
  kind: "openai-compatible",
  base_url: "https://models.example.edu/v1",
  models: ["school-model"],
  default_model: "school-model",
  secret: "",
  input_cost_per_million_usd: 0,
  output_cost_per_million_usd: 0,
  max_output_tokens: 4096,
  enabled: true,
  expected_revision: 0,
  reason: "配置学校托管课程问答模型 Provider",
};

export function AdminModelControl({
  demo,
  courseId,
}: {
  demo: boolean;
  courseId: string;
}) {
  const { t } = useTranslation(),
    repository = useRepository(),
    client = useQueryClient();
  const scope = usePortalScope();
  const providers = useQuery({
    queryKey: portalQueryKey(scope, "admin", "model-providers"),
    queryFn: () => repository.modelProviders(),
  });
  const quotas = useQuery({
    queryKey: portalQueryKey(scope, "admin", "model-quotas"),
    queryFn: () => repository.modelQuotas(),
  });
  const [provider, setProvider] = useState(initialProvider),
    [providerMessage, setProviderMessage] = useState("");
  const [quota, setQuota] = useState<ModelQuotaPolicyInputV1>({
      version: "model-quota-policy-input.v1",
      course_id: courseId,
      monthly_request_limit: 1000,
      monthly_token_limit: 1_000_000,
      monthly_cost_limit_usd: 50,
      enabled: true,
      expected_revision: 0,
      reason: "配置课程模型月度请求、Token 与费用额度",
    }),
    [quotaMessage, setQuotaMessage] = useState("");
  useEffect(
    () => setQuota((value) => ({ ...value, course_id: courseId })),
    [courseId],
  );
  function pf<K extends keyof ModelProviderInputV1>(
    key: K,
    value: ModelProviderInputV1[K],
  ) {
    setProvider((current) => ({ ...current, [key]: value }));
  }
  function qf<K extends keyof ModelQuotaPolicyInputV1>(
    key: K,
    value: ModelQuotaPolicyInputV1[K],
  ) {
    setQuota((current) => ({ ...current, [key]: value }));
  }
  function selectProvider(id: string) {
    const item = providers.data?.find((value) => value.id === id);
    if (item)
      setProvider({
        version: "model-provider-input.v1",
        id: item.id,
        name: item.name,
        kind: item.kind,
        base_url: item.base_url,
        models: item.models,
        default_model: item.default_model,
        input_cost_per_million_usd: item.input_cost_per_million_usd,
        output_cost_per_million_usd: item.output_cost_per_million_usd,
        max_output_tokens: item.max_output_tokens,
        enabled: item.enabled,
        expected_revision: item.revision,
        reason: "更新学校托管课程问答模型 Provider",
      });
  }
  function selectQuota(id: string) {
    const item = quotas.data?.find((value) => value.id === id);
    if (item)
      setQuota({
        version: "model-quota-policy-input.v1",
        course_id: item.course_id,
        user_id: item.user_id,
        monthly_request_limit: item.monthly_request_limit,
        monthly_token_limit: item.monthly_token_limit,
        monthly_cost_limit_usd: item.monthly_cost_limit_usd,
        enabled: item.enabled,
        expected_revision: item.revision,
        reason: "更新课程或成员模型月度额度",
      });
  }
  async function saveProvider(event: React.FormEvent) {
    event.preventDefault();
    setProviderMessage("");
    try {
      const saved = await repository.saveModelProvider(provider);
      setProviderMessage(t("模型 Provider 已加密保存。"));
      setProvider((value) => ({
        ...value,
        secret: "",
        expected_revision: saved.revision,
      }));
      await client.invalidateQueries({
        queryKey: portalQueryKey(scope, "admin", "model-providers"),
      });
    } catch (error) {
      setProviderMessage(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  async function saveQuota(event: React.FormEvent) {
    event.preventDefault();
    setQuotaMessage("");
    try {
      const saved = await repository.saveModelQuota(quota);
      setQuotaMessage(t("模型额度已更新。"));
      setQuota((value) => ({ ...value, expected_revision: saved.revision }));
      await client.invalidateQueries({ queryKey: portalQueryKey(scope, "admin", "model-quotas") });
    } catch (error) {
      setQuotaMessage(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <section className="surface model-control">
      <header>
        <div>
          <h2>{t("学校模型与额度控制")}</h2>
          <small>
            {t("Provider 凭据只写不回显；额度按自然月并发预留与结算。")}
          </small>
        </div>
      </header>
      <div className="workspace-layout">
        <div>
          <h3>{t("模型 Provider")}</h3>
          <div className="structured-list">
            {providers.data?.map((item) => (
              <Button
                className="list-button"
                type="button"
                key={item.id}
                onClick={() => selectProvider(item.id)}
              >
                <b>
                  {item.name} · {item.default_model}
                </b>
                <span>
                  {t(item.enabled ? "已启用" : "已停用")} ·{" "}
                  {item.secret_configured ? t("凭据已配置") : t("缺少凭据")} · v
                  {item.revision}
                </span>
              </Button>
            ))}
            {providers.isLoading ? <p>{t("正在加载…")}</p> : null}
            {!providers.isLoading && providers.data?.length === 0 ? (
              <p>{t("尚未配置")}</p>
            ) : null}
            {providers.error ? (
              <p className="form-error" role="alert">{providers.error.message}</p>
            ) : null}
          </div>
          <form
            className="oidc-form"
            onSubmit={(event) => void saveProvider(event)}
          >
            <label>
              {t("标识")}
              <Input
                value={provider.id}
                onChange={(event) => pf("id", event.target.value)}
              />
            </label>
            <label>
              {t("显示名称")}
              <Input
                value={provider.name}
                onChange={(event) => pf("name", event.target.value)}
              />
            </label>
            <label>
              {t("类型")}
              <Select
                value={provider.kind}
                onChange={(event) =>
                  pf("kind", event.target.value as ModelProviderInputV1["kind"])
                }
              >
                {[
                  "openai",
                  "openai-compatible",
                  "anthropic",
                  "deepseek",
                  "ollama",
                ].map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </Select>
            </label>
            <label className="wide">
              Base URL
              <Input
                value={provider.base_url}
                onChange={(event) => pf("base_url", event.target.value)}
              />
            </label>
            <label className="wide">
              {t("模型列表（逗号分隔）")}
              <Input
                value={provider.models.join(", ")}
                onChange={(event) =>
                  pf(
                    "models",
                    event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
            <label>
              {t("默认模型")}
              <Input
                value={provider.default_model}
                onChange={(event) => pf("default_model", event.target.value)}
              />
            </label>
            <label>
              {t("Provider 凭据")}
              <Input
                type="password"
                autoComplete="new-password"
                value={provider.secret ?? ""}
                onChange={(event) =>
                  pf("secret", event.target.value || undefined)
                }
              />
            </label>
            <label>
              {t("输入费用 / 百万 Token（USD）")}
              <Input
                type="number"
                min="0"
                step="0.000001"
                value={String(provider.input_cost_per_million_usd)}
                onChange={(event) =>
                  pf("input_cost_per_million_usd", Number(event.target.value))
                }
              />
            </label>
            <label>
              {t("输出费用 / 百万 Token（USD）")}
              <Input
                type="number"
                min="0"
                step="0.000001"
                value={String(provider.output_cost_per_million_usd)}
                onChange={(event) =>
                  pf("output_cost_per_million_usd", Number(event.target.value))
                }
              />
            </label>
            <label>
              {t("最大输出 Token")}
              <Input
                type="number"
                min="256"
                value={String(provider.max_output_tokens)}
                onChange={(event) =>
                  pf("max_output_tokens", Number(event.target.value))
                }
              />
            </label>
            <label className="wide">
              {t("审计理由")}
              <Textarea
                value={provider.reason}
                onChange={(event) => pf("reason", event.target.value)}
              />
            </label>
            <div className="check">
              <Checkbox checked={provider.enabled} onChange={(_, data) => pf("enabled", data.checked === true)} label={t("启用 Provider")} />
            </div>
            <Button
              className="button primary"
              disabled={
                demo ||
                provider.reason.trim().length < 10 ||
                (provider.expected_revision === 0 &&
                  provider.kind !== "ollama" &&
                  (provider.secret?.length ?? 0) < 16)
              }
            >
              {t("加密保存")}
            </Button>
            {providerMessage ? (
              <p className="operation-message wide" role="status">
                {providerMessage}
              </p>
            ) : null}
          </form>
        </div>
        <div>
          <h3>{t("月度额度")}</h3>
          <div className="structured-list">
            {quotas.data?.map((item) => (
              <Button
                className="list-button"
                type="button"
                key={item.id}
                onClick={() => selectQuota(item.id)}
              >
                <b>
                  {item.user_id ? t("成员额度") : t("课程额度")} ·{" "}
                  {item.course_id}
                </b>
                <span>
                  {item.used_requests}+{item.reserved_requests} /{" "}
                  {item.monthly_request_limit} {t("次请求")} ·{" "}
                  {item.used_tokens + item.reserved_tokens} /{" "}
                  {item.monthly_token_limit} Token · $
                  {item.used_cost_usd + item.reserved_cost_usd} / $
                  {item.monthly_cost_limit_usd}
                </span>
              </Button>
            ))}
            {quotas.isLoading ? <p>{t("正在加载…")}</p> : null}
            {!quotas.isLoading && quotas.data?.length === 0 ? (
              <p>{t("尚未配置")}</p>
            ) : null}
            {quotas.error ? (
              <p className="form-error" role="alert">{quotas.error.message}</p>
            ) : null}
          </div>
          <form
            className="oidc-form"
            onSubmit={(event) => void saveQuota(event)}
          >
            <label>
              {t("课程 ID")}
              <Input
                value={quota.course_id}
                onChange={(event) => qf("course_id", event.target.value)}
              />
            </label>
            <label>
              {t("成员 ID（留空为课程总额）")}
              <Input
                value={quota.user_id ?? ""}
                onChange={(event) =>
                  qf("user_id", event.target.value || undefined)
                }
              />
            </label>
            <label>
              {t("月请求上限")}
              <Input
                type="number"
                min="1"
                value={String(quota.monthly_request_limit)}
                onChange={(event) =>
                  qf("monthly_request_limit", Number(event.target.value))
                }
              />
            </label>
            <label>
              {t("月 Token 上限")}
              <Input
                type="number"
                min="1000"
                value={String(quota.monthly_token_limit)}
                onChange={(event) =>
                  qf("monthly_token_limit", Number(event.target.value))
                }
              />
            </label>
            <label>
              {t("月费用上限（USD）")}
              <Input
                type="number"
                min="0.000001"
                step="0.01"
                value={String(quota.monthly_cost_limit_usd)}
                onChange={(event) =>
                  qf("monthly_cost_limit_usd", Number(event.target.value))
                }
              />
            </label>
            <label className="wide">
              {t("审计理由")}
              <Textarea
                value={quota.reason}
                onChange={(event) => qf("reason", event.target.value)}
              />
            </label>
            <div className="check">
              <Checkbox checked={quota.enabled} onChange={(_, data) => qf("enabled", data.checked === true)} label={t("启用额度")} />
            </div>
            <Button
              className="button primary"
              disabled={quota.reason.trim().length < 10}
            >
              {t("保存额度")}
            </Button>
            {quotaMessage ? (
              <p className="operation-message wide" role="status">
                {quotaMessage}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </section>
  );
}
