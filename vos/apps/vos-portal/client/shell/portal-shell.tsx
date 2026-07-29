import {
  Bell,
  BookOpen,
  Bot,
  Boxes,
  ClipboardCheck,
  FlaskConical,
  Gauge,
  GraduationCap,
  KeyRound,
  Languages,
  LogOut,
  RotateCcw,
  Settings,
  ShieldCheck,
  Users,
  UserPlus,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PortalActor, PortalRole } from "vos-core/portal-contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRepository } from "../repository-context.tsx";
import { useTranslation } from "react-i18next";
import { toggleLanguage } from "../i18n.ts";

const studentNav = [
  ["/workspace", "工作台", Gauge],
  ["/courses", "课程与实验", BookOpen],
  ["/enroll", "加入课程", UserPlus],
  ["/stages", "阶段任务", ClipboardCheck],
  ["/runs", "运行与证据", FlaskConical],
  ["/architecture", "架构", Boxes],
  ["/qa", "问答", Bot],
  ["/credentials", "模型凭据", KeyRound],
  ["/grades", "成绩与申诉", GraduationCap],
] as const;
const staffNav = [
  ["/workspace", "运营工作台", Gauge],
  ["/enroll", "加入课程", UserPlus],
  ["/courses", "课程配置", Settings],
  ["/stages", "学生与分组", Users],
  ["/runs", "运行与证据", FlaskConical],
  ["/grades", "评分与发布", GraduationCap],
  ["/qa", "AI 审计", Bot],
  ["/credentials", "模型凭据", KeyRound],
  ["/admin", "课程分析", Boxes],
] as const;
const teacherNav = [
  ["/workspace", "教学工作台", Gauge] as const,
  ["/projects/new", "项目供应", Users] as const,
  ...staffNav.slice(2),
] as const;
const adminNav = [
  ["/workspace", "系统工作台", Gauge] as const,
  ["/projects/new", "项目供应", Users] as const,
  ...staffNav.slice(2, 7),
  ["/admin", "系统管理", Boxes] as const,
] as const;
const roleLabel: Record<PortalRole, string> = {
  student: "学生",
  ta: "助教",
  teacher: "教师",
  admin: "管理员",
};

export function PortalShell({
  actor,
  demo,
  onSessionChange,
  children,
}: {
  actor: PortalActor;
  demo: boolean;
  onSessionChange: () => void;
  children: ReactNode;
}) {
  const repository = useRepository();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nav =
    actor.role === "student"
      ? studentNav
      : actor.role === "ta"
        ? staffNav
        : actor.role === "teacher"
          ? teacherNav
          : adminNav;
  const context = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => repository.dashboard(),
  });
  const contexts = useQuery({
    queryKey: ["contexts"],
    queryFn: () => repository.contexts(),
  });
  const { t, i18n } = useTranslation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const notificationPanelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!notificationsOpen) return;
    notificationPanelRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setNotificationsOpen(false);
      notificationButtonRef.current?.focus();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [notificationsOpen]);
  const unread =
    context.data?.notifications.filter((item) => !item.read).length ?? 0;
  const courseContexts=contexts.data?.filter((item,index,all)=>all.findIndex(candidate=>candidate.course.id===item.course.id)===index)??[];
  const projectContexts=contexts.data?.filter((item)=>item.course.id===context.data?.course.id)??[];
  async function refresh() {
    await queryClient.invalidateQueries();
  }
  async function markRead(notificationId: string) {
    await repository.setNotificationRead(notificationId, true);
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }
  async function changeContext(projectId:string) {
    await repository.selectContext(projectId);
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    navigate("/workspace");
  }
  return (
    <div className="portal-layout">
      <a className="skip-link" href="#portal-main" onClick={(event) => {
        event.preventDefault();
        window.history.replaceState(null, "", "#portal-main");
        document.getElementById("portal-main")?.focus();
      }}>{t("跳到主要内容")}</a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <ShieldCheck />
          </span>
          <div>
            <strong>VOS Portal</strong>
            <small>VeriSpecOSLab</small>
          </div>
        </div>
        <nav aria-label={t("主导航")}>
          {nav.map(([to, label, Icon]) => {
            const target =
              to === "/runs"
                ? context.data?.runs[0]
                  ? `/runs/${context.data.runs[0].id}`
                  : "/workspace"
                : to;
            return (
              <NavLink
                key={to}
                to={target}
                className={({ isActive }) =>
                  isActive ? "nav-link active" : "nav-link"
                }
              >
                <Icon aria-hidden="true" />
                <span>{t(label)}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <span className="connection">
            <i />
            {t(demo ? "离线 Demo" : "同源控制面")}
          </span>
          <small>v0.1.0</small>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="selectors">
            <label className="context-selector">
              <span>{t("课程上下文")}</span>
              <select aria-label={t("课程上下文")} value={courseContexts.find(item=>item.course.id===context.data?.course.id)?.project.id??""} disabled={!courseContexts.length||contexts.isFetching} onChange={(event)=>void changeContext(event.target.value)}>
                {courseContexts.map(item=><option key={item.course.id} value={item.project.id}>{item.course.name} · {item.course.term}</option>)}
              </select>
            </label>
            <label className="context-selector">
              <span>{t("项目上下文")}</span>
              <select aria-label={t("项目上下文")} value={context.data?.project.project_id??""} disabled={!contexts.data?.length||contexts.isFetching} onChange={(event)=>void changeContext(event.target.value)}>
                {projectContexts.map(item=><option key={item.project.id} value={item.project.id}>{item.project.stage_name} · {item.project.id}</option>)}
              </select>
            </label>
          </div>
          <div className="top-actions">
            {demo ? <span className="demo-flag">{t("演示数据")}</span> : null}
            <button
              className="icon-button"
              aria-label={t("切换语言")}
              onClick={() => void toggleLanguage()}
            >
              <Languages />
            </button>
            <div className="notification-center">
              <button
                ref={notificationButtonRef}
                className="icon-button"
                aria-label={t("通知（{{count}} 条未读）", { count: unread })}
                aria-expanded={notificationsOpen}
                aria-controls="notification-panel"
                onClick={() => setNotificationsOpen((value) => !value)}
              >
                <Bell />
                {unread ? (
                  <span className="notification-badge">
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </button>
              {notificationsOpen ? (
                <section
                  ref={notificationPanelRef}
                  id="notification-panel"
                  className="notification-panel"
                  aria-label={t("通知")}
                  role="region"
                  tabIndex={-1}
                >
                  <header>
                    <strong>{t("通知")}</strong>
                    <span>{t("{{count}} 条未读", { count: unread })}</span>
                  </header>
                  <div>
                    {context.data?.notifications.length ? (
                      context.data.notifications.map((item) => (
                        <article
                          key={item.id}
                          className={item.read ? "read" : "unread"}
                        >
                          <div>
                            <strong>{item.title}</strong>
                            <time dateTime={item.created_at}>
                              {new Intl.DateTimeFormat(i18n.language, {
                                dateStyle: "short",
                                timeStyle: "short",
                              }).format(new Date(item.created_at))}
                            </time>
                          </div>
                          <p>{item.body}</p>
                          {!item.read ? (
                            <button
                              className="button text"
                              onClick={() => void markRead(item.id)}
                            >
                              {t("标为已读")}
                            </button>
                          ) : null}
                        </article>
                      ))
                    ) : (
                      <p className="notification-empty">{t("暂无通知")}</p>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
            {demo && repository.switchDemoRole ? (
              <select
                aria-label={t("演示角色")}
                value={actor.role}
                onChange={(event) => {
                  void repository.switchDemoRole!(
                    event.target.value as PortalRole,
                  ).then(async () => {
                    await refresh();
                    onSessionChange();
                  });
                }}
              >
                <option value="student">{t("学生")}</option>
                <option value="ta">{t("助教")}</option>
                <option value="teacher">{t("教师")}</option>
                <option value="admin">{t("管理员")}</option>
              </select>
            ) : null}
            <div className="identity">
              <span>{actor.display_name}</span>
              <small>{t(roleLabel[actor.role])}</small>
            </div>
            {demo && repository.resetDemo ? (
              <button
                className="icon-button"
                aria-label={t("重置演示")}
                onClick={() => void repository.resetDemo!().then(refresh)}
              >
                <RotateCcw />
              </button>
            ) : null}
            <button
              className="icon-button"
              aria-label={t("退出")}
              onClick={() =>
                void repository.logout().then(() => {
                  navigate("/");
                  onSessionChange();
                })
              }
            >
              <LogOut />
            </button>
          </div>
        </header>
        <main className="content" id="portal-main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
