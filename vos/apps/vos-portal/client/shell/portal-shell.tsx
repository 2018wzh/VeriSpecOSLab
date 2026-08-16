import { Avatar, Badge, Button, Drawer, DrawerBody, DrawerHeader, DrawerHeaderTitle, Select } from "@fluentui/react-components";
import {
  Alert24Regular,
  ArrowClockwise24Regular,
  Beaker24Regular,
  BookOpen24Regular,
  Bot24Regular,
  Box24Regular,
  ClipboardTask24Regular,
  DataBarVertical24Regular,
  Key24Regular,
  LocalLanguage24Regular,
  Navigation24Regular,
  People24Regular,
  PersonAdd24Regular,
  Settings24Regular,
  Shield24Regular,
  SignOut24Regular,
  Trophy24Regular,
} from "@fluentui/react-icons";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PortalActor, PortalRole } from "vos-core/portal-contracts";
import { useEffect, useRef, type ReactNode, useState } from "react";
import { useRepository } from "../repository-context.tsx";
import { PortalScopeProvider } from "../portal-scope.tsx";
import { useTranslation } from "react-i18next";
import { toggleLanguage } from "../i18n.ts";

const studentNav = [
  ["/workspace", "工作台", DataBarVertical24Regular], ["/courses", "课程与实验", BookOpen24Regular],
  ["/enroll", "加入课程", PersonAdd24Regular], ["/stages", "阶段任务", ClipboardTask24Regular],
  ["/runs", "运行与证据", Beaker24Regular], ["/architecture", "架构", Box24Regular],
  ["/qa", "问答", Bot24Regular], ["/credentials", "模型凭据", Key24Regular], ["/grades", "成绩与申诉", Trophy24Regular],
] as const;
const staffNav = [
  ["/workspace", "运营工作台", DataBarVertical24Regular], ["/enroll", "加入课程", PersonAdd24Regular],
  ["/courses", "课程配置", Settings24Regular], ["/stages", "学生与分组", People24Regular],
  ["/runs", "运行与证据", Beaker24Regular], ["/grades", "评分与发布", Trophy24Regular],
  ["/qa", "AI 审计", Bot24Regular], ["/credentials", "模型凭据", Key24Regular], ["/admin", "课程分析", Box24Regular],
] as const;
const teacherNav = [["/workspace", "教学工作台", DataBarVertical24Regular] as const, ["/projects/new", "项目供应", People24Regular] as const, ...staffNav.slice(2)] as const;
const adminNav = [["/workspace", "系统工作台", DataBarVertical24Regular] as const, ["/projects/new", "项目供应", People24Regular] as const, ...staffNav.slice(2, 8), ["/admin", "系统管理", Box24Regular] as const] as const;
const roleLabel: Record<PortalRole, string> = { student: "学生", ta: "助教", teacher: "教师", admin: "管理员" };

export function PortalShell({ actor, demo, onSessionChange, children }: { actor: PortalActor; demo: boolean; onSessionChange: () => void; children: ReactNode }) {
  const repository = useRepository();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nav = actor.role === "student" ? studentNav : actor.role === "ta" ? staffNav : actor.role === "teacher" ? teacherNav : adminNav;
  const context = useQuery({ queryKey: ["portal", actor.role, "shell", "dashboard"], queryFn: () => repository.dashboard() });
  const contexts = useQuery({ queryKey: ["portal", actor.role, "shell", "contexts"], queryFn: () => repository.contexts() });
  const { t, i18n } = useTranslation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const notificationPanelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!notificationsOpen) return;
    notificationPanelRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) { if (event.key !== "Escape") return; setNotificationsOpen(false); notificationButtonRef.current?.focus(); }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [notificationsOpen]);
  const unread = context.data?.notifications.filter((item) => !item.read).length ?? 0;
  const courseContexts = contexts.data?.filter((item, index, all) => all.findIndex((candidate) => candidate.course.id === item.course.id) === index) ?? [];
  const projectContexts = contexts.data?.filter((item) => item.course.id === context.data?.course.id) ?? [];
  async function refresh() { await queryClient.cancelQueries({ queryKey: ["portal"] }); queryClient.removeQueries({ queryKey: ["portal"] }); }
  async function markRead(notificationId: string) { await repository.setNotificationRead(notificationId, true); await queryClient.invalidateQueries({ queryKey: ["portal", actor.role, "shell", "dashboard"] }); }
  async function changeContext(projectId: string) { await repository.selectContext(projectId); await queryClient.cancelQueries({ queryKey: ["portal"] }); queryClient.removeQueries({ queryKey: ["portal"] }); navigate("/workspace"); }
  const scope = { role: actor.role, courseId: context.data?.course.id, projectId: context.data?.project.project_id } as const;
  return <PortalScopeProvider scope={scope}><div className="portal-layout">
    <a className="skip-link" href="#portal-main" onClick={(event) => { event.preventDefault(); window.history.replaceState(null, "", "#portal-main"); document.getElementById("portal-main")?.focus(); }}>{t("跳到主要内容")}</a>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Shield24Regular aria-hidden="true" /></span><div><strong>VOS Portal</strong><small>VeriSpecOSLab</small></div></div>
      <nav aria-label={t("主导航")}>{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}><Icon aria-hidden="true" /><span>{t(label)}</span></NavLink>)}</nav>
      <div className="sidebar-footer"><span className="connection"><i />{t(demo ? "离线 Demo" : "同源控制面")}</span><small>Fluent 2 · v0.1.0</small></div>
    </aside>
    <div className="main-column">
      <header className="topbar">
        <div className="mobile-nav-title"><Navigation24Regular aria-hidden="true" /><span>{t("VOS Portal")}</span></div>
        <div className="selectors">
          <label className="context-selector"><span>{t("课程上下文")}</span><Select aria-label={t("课程上下文")} value={courseContexts.find((item) => item.course.id === context.data?.course.id)?.project.id ?? ""} disabled={!courseContexts.length || contexts.isFetching} onChange={(event) => void changeContext(event.target.value)}>{courseContexts.map((item) => <option key={item.course.id} value={item.project.id}>{item.course.name} · {item.course.term}</option>)}</Select></label>
          <label className="context-selector"><span>{t("项目上下文")}</span><Select aria-label={t("项目上下文")} value={context.data?.project.project_id ?? ""} disabled={!contexts.data?.length || contexts.isFetching} onChange={(event) => void changeContext(event.target.value)}>{projectContexts.map((item) => <option key={item.project.id} value={item.project.id}>{item.project.stage_name} · {item.project.id}</option>)}</Select></label>
        </div>
        <div className="top-actions">
          <Button className="mobile-more" appearance="subtle" icon={<Navigation24Regular />} aria-label={t("导航")} onClick={() => setMobileNavOpen(true)} />
          {demo ? <Badge appearance="tint" color="informative">{t("演示数据")}</Badge> : null}
          <Button appearance="subtle" icon={<LocalLanguage24Regular />} aria-label={t("切换语言")} onClick={() => void toggleLanguage()} />
          <div className="notification-center"><Button ref={notificationButtonRef} appearance="subtle" icon={<Alert24Regular />} aria-label={t("通知（{{count}} 条未读）", { count: unread })} aria-expanded={notificationsOpen} aria-controls="notification-panel" onClick={() => setNotificationsOpen((value) => !value)}>{unread ? <Badge appearance="filled" color="danger" size="small">{unread > 9 ? "9+" : unread}</Badge> : null}</Button>
            {notificationsOpen ? <section ref={notificationPanelRef} id="notification-panel" className="notification-panel" aria-label={t("通知")} role="region" tabIndex={-1}><header><strong>{t("通知")}</strong><span>{t("{{count}} 条未读", { count: unread })}</span></header><div>{context.data?.notifications.length ? context.data.notifications.map((item) => <article key={item.id} className={item.read ? "read" : "unread"}><div><strong>{item.title}</strong><time dateTime={item.created_at}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at))}</time></div><p>{item.body}</p>{!item.read ? <Button appearance="subtle" size="small" onClick={() => void markRead(item.id)}>{t("标为已读")}</Button> : null}</article>) : <p className="notification-empty">{t("暂无通知")}</p>}</div></section> : null}
          </div>
          {demo && repository.switchDemoRole ? <Select aria-label={t("演示角色")} value={actor.role} onChange={(event) => { void repository.switchDemoRole!(event.target.value as PortalRole).then(async () => { await refresh(); onSessionChange(); }); }}><option value="student">{t("学生")}</option><option value="ta">{t("助教")}</option><option value="teacher">{t("教师")}</option><option value="admin">{t("管理员")}</option></Select> : null}
          <div className="identity"><Avatar name={actor.display_name} size={32} /><span>{actor.display_name}</span><small>{t(roleLabel[actor.role])}</small></div>
          {demo && repository.resetDemo ? <Button appearance="subtle" icon={<ArrowClockwise24Regular />} aria-label={t("重置演示")} onClick={() => void repository.resetDemo!().then(refresh)} /> : null}
          <Button appearance="subtle" icon={<SignOut24Regular />} aria-label={t("退出")} onClick={() => void repository.logout().then(() => { navigate("/"); onSessionChange(); })} />
        </div>
      </header>
      <main className="content" id="portal-main" tabIndex={-1}>{children}</main>
    </div>
    {mobileNavOpen ? <Drawer open position="start" onOpenChange={(_, data) => setMobileNavOpen(data.open)}>
      <DrawerHeader><DrawerHeaderTitle>{t("导航")}</DrawerHeaderTitle></DrawerHeader>
      <DrawerBody><nav className="mobile-drawer-nav" aria-label={t("主导航")}>{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} onClick={() => setMobileNavOpen(false)} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}><Icon aria-hidden="true" /><span>{t(label)}</span></NavLink>)}</nav></DrawerBody>
    </Drawer> : null}
  </div></PortalScopeProvider>;
}
