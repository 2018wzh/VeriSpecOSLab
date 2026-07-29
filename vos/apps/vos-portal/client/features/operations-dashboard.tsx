import {
  AlertTriangle,
  ClipboardList,
  RefreshCw,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useRepository } from "../repository-context.tsx";
import { Status } from "./student-dashboard.tsx";
import { useTranslation } from "react-i18next";

export function OperationsDashboard() {
  const repository = useRepository();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => repository.dashboard(),
    refetchInterval: 15_000,
  });
  const courseId = dashboard.data?.course.id;
  const operations = useQuery({
    queryKey: ["course-operations", courseId],
    queryFn: () => repository.courseOperations(courseId!),
    enabled: Boolean(courseId),
    refetchInterval: 15_000,
  });
  const [selectedRunId, setSelectedRunId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const runs = dashboard.data?.runs ?? [];
  useEffect(() => {
    if (!selectedRunId && runs[0]) setSelectedRunId(runs[0].id);
  }, [runs, selectedRunId]);
  const run = runs.find((item) => item.id === selectedRunId) ?? runs[0];
  const evidence = useQuery({
    queryKey: ["evidence", run?.id],
    queryFn: () => repository.evidence(run!.id),
    enabled: Boolean(run),
  });
  if (!dashboard.data)
    return <div className="page-loading">{t("正在加载课程运营工作台…")}</div>;
  const failed = runs.filter((item) => item.status === "failed");
  const infra = failed.filter((item) => item.failure_class === "infra_failure");
  const awaitingReview = runs.filter(
    (item) => item.status === "passed" || item.status === "failed",
  );
  const score = dashboard.data.score;

  async function action(kind: "assign" | "rerun" | "escalate" | "approve") {
    if (!run) return;
    setMessage("");
    try {
      await repository.review({ run_id: run.id, action: kind, reason });
      setMessage(
        t(
          kind === "rerun"
            ? "补跑已批准并创建新运行。"
            : "审核动作已写入持久化事件与审计链。",
        ),
      );
      setReason("");
      await queryClient.invalidateQueries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="page ops">
      <div className="page-heading">
        <h1>{t("课程运营工作台")}</h1>
        <div className="live">
          <i />
          {t("15 秒刷新")} <RefreshCw />
        </div>
      </div>
      <div className="metric-rail">
        <Metric
          icon={<ClipboardList />}
          label={t("已结束待处理")}
          value={String(awaitingReview.length)}
        />
        <Metric
          icon={<AlertTriangle />}
          label={t("基础设施异常")}
          value={String(infra.length)}
        />
        <Metric
          icon={<ShieldAlert />}
          label={t("失败运行")}
          value={String(failed.length)}
        />
        <Metric
          icon={<Upload />}
          label={t("成绩状态")}
          value={score.snapshot_version ? t(score.state) : t("未生成")}
        />
      </div>
      <section className="surface class-matrix">
        <header>
          <h2>{t("班级项目阶段矩阵")}</h2>
          <small>
            {t("{{count}} 个项目", {
              count: operations.data?.projects.length ?? 0,
            })}
          </small>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("项目")}</th>
                <th>{t("成员")}</th>
                <th>{t("当前阶段")}</th>
                <th>{t("设计")}</th>
                <th>{t("最新运行")}</th>
                <th>{t("失败运行")}</th>
                <th>{t("成绩状态")}</th>
                <th>{t("开放申诉")}</th>
              </tr>
            </thead>
            <tbody>
              {operations.data?.projects.length ? (
                operations.data.projects.map((project) => (
                  <tr key={project.project_id}>
                    <td>
                      <b>{project.project_id}</b>
                    </td>
                    <td>{project.member_names.join("、") || "—"}</td>
                    <td>{project.stage_name}</td>
                    <td>
                      {project.design_status ? t(project.design_status) : "—"}
                    </td>
                    <td>
                      {project.latest_run_status
                        ? t(project.latest_run_status)
                        : "—"}
                    </td>
                    <td>{project.failed_runs}</td>
                    <td>
                      {project.score_state
                        ? `${t(project.score_state)}${project.final_score !== undefined ? ` · ${project.final_score.toFixed(2)}` : ""}`
                        : "—"}
                    </td>
                    <td>{project.open_appeals}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>
                    {t(
                      operations.isLoading
                        ? "正在加载班级矩阵…"
                        : "当前课程没有项目。",
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <div className="ops-layout">
        <section className="surface queue">
          <header>
            <h2>{t("审核与异常队列")}</h2>
          </header>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("运行")}</th>
                  <th>{t("阶段")}</th>
                  <th>Commit</th>
                  <th>{t("结果")}</th>
                  <th>{t("通过")}</th>
                  <th>{t("失败归因")}</th>
                  <th>{t("创建时间")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.length ? (
                  runs.map((item) => (
                    <tr
                      key={item.id}
                      className={run?.id === item.id ? "selected" : ""}
                    >
                      <td>
                        <button
                          className="run-row-selector"
                          type="button"
                          aria-pressed={run?.id === item.id}
                          onClick={() => setSelectedRunId(item.id)}
                        >
                          <b>{item.id}</b>
                          <small>
                            {item.retry_of
                              ? `${t("补跑自")} ${item.retry_of}`
                              : t("首次运行")}
                          </small>
                        </button>
                      </td>
                      <td>{item.stage_key}</td>
                      <td>{item.commit_sha.slice(0, 12)}</td>
                      <td>
                        <Status
                          value={
                            item.status === "passed"
                              ? t("通过")
                              : item.status === "failed"
                                ? t("未通过")
                                : t(item.status)
                          }
                        />
                      </td>
                      <td>
                        {item.passed} / {item.total}
                      </td>
                      <td>{item.failure_class ?? "—"}</td>
                      <td>{new Date(item.created_at).toLocaleString(i18n.language)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>{t("当前课程没有运行记录。")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="surface inspector">
          <header>
            <div>
              <h2>{run?.id ?? t("未选择运行")}</h2>
              <small>
                {run
                  ? `${run.stage_key} · ${run.commit_sha.slice(0, 12)}`
                  : t("等待真实运行数据")}
              </small>
            </div>
            {run ? (
              <Status
                value={run.status === "passed" ? t("通过") : run.status}
              />
            ) : null}
          </header>
          {run ? (
            <>
              <div className="summary-box">
                <b>{t("公开摘要")}</b>
                <p>{run.public_message || t("运行未提供公开摘要。")}</p>
              </div>
              <h3>{t("可见证据")}</h3>
              <div className="structured-list">
                {evidence.data?.evidence.length ? (
                  evidence.data.evidence.map((item) => (
                    <div key={item.id}>
                      <b>
                        {item.suite} / {item.case_name}
                      </b>
                      <span>{item.result}</span>
                    </div>
                  ))
                ) : (
                  <div>
                    <b>{t("暂无证据")}</b>
                    <span>
                      {t(
                        evidence.isLoading
                          ? "正在读取"
                          : "运行没有当前角色可见的证据",
                      )}
                    </span>
                  </div>
                )}
              </div>
              <div className="action-row">
                <Link className="button outline" to={`/runs/${run.id}`}>
                  {t("查看证据")}
                </Link>
                <button
                  className="button outline"
                  disabled={reason.trim().length < 10}
                  onClick={() => void action("assign")}
                >
                  {t("指派给我")}
                </button>
                <button
                  className="button danger"
                  disabled={reason.trim().length < 10}
                  onClick={() => void action("escalate")}
                >
                  {t("升级教师")}
                </button>
                {run.status === "passed" ? (
                  <button
                    className="button primary"
                    disabled={reason.trim().length < 10}
                    onClick={() => void action("approve")}
                  >
                    {t("批准结果")}
                  </button>
                ) : (
                  <button
                    className="button primary"
                    disabled={
                      reason.trim().length < 10 ||
                      !["failed", "cancelled", "timed_out"].includes(run.status)
                    }
                    onClick={() => void action("rerun")}
                  >
                    {t("批准补跑")}
                  </button>
                )}
              </div>
              <label className="reason">
                {t("操作理由（进入审计日志）")}
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("请填写不少于 10 个字符")}
                />
              </label>
            </>
          ) : (
            <p className="empty-copy">{t("没有可审核的运行。")}</p>
          )}
          {message ? (
            <p className="operation-message" role="status">
              {message}
            </p>
          ) : null}
        </section>
        <aside className="ops-rail">
          <section className="surface matrix">
            <header>
              <h2>{t("当前项目阶段")}</h2>
            </header>
            <table>
              <thead>
                <tr>
                  <th>{t("阶段")}</th>
                  <th>{t("状态")}</th>
                  <th>{t("人工审核")}</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.data.stages.map((stage) => (
                  <tr key={stage.id}>
                    <td>{stage.name}</td>
                    <td>{t(stage.status)}</td>
                    <td>{t(stage.manual_review_required ? "需要" : "自动")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="surface signals">
            <header>
              <h2>{t("证据信号")}</h2>
            </header>
            {failed.length ? (
              failed.slice(0, 5).map((item) => (
                <p key={item.id}>
                  <b>{item.failure_class ?? "verification_failure"}</b>
                  <span>
                    {item.stage_key} · {item.id}
                  </span>
                </p>
              ))
            ) : (
              <p>
                <b>{t("暂无失败信号")}</b>
                <span>{t("仅依据当前 repository 数据显示")}</span>
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      {icon}
      <span>
        {label}
        <strong>{value}</strong>
      </span>
    </div>
  );
}
