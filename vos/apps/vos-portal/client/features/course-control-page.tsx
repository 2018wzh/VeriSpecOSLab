import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CourseGroupV1, CourseManifestV1 } from "vos-core/portal-contracts";
import { useRepository } from "../repository-context.tsx";
import { useTranslation } from "react-i18next";
import "../course-control.css";

export function CourseControlPage() {
  const { t } = useTranslation();
  const repository = useRepository();
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => repository.dashboard() });
  const courseId = dashboard.data?.course.id;
  const versions = useQuery({
    queryKey: ["course-manifest-versions", courseId],
    queryFn: () => repository.courseManifestVersions(courseId!),
    enabled: Boolean(courseId),
  });
  const groups = useQuery({ queryKey: ["course-groups", courseId], queryFn: () => repository.courseGroups(courseId!), enabled: Boolean(courseId) });
  const invites = useQuery({ queryKey: ["enrollment-invites", courseId], queryFn: () => repository.enrollmentInvites(courseId!), enabled: Boolean(courseId) });
  const provisionOptions = useQuery({ queryKey: ["project-provision-options"], queryFn: () => repository.projectProvisionOptions(), enabled: Boolean(courseId) });
  const [manifestText, setManifestText] = useState("");
  const [reason, setReason] = useState("");
  const [csv, setCsv] = useState("username,display_name,role,group\nstudent-new,新同学,student,第 04 组\n");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<CourseGroupV1 | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [inviteRole,setInviteRole]=useState<"student"|"ta">("student");
  const [inviteDays,setInviteDays]=useState(7);
  const [inviteMaxUses,setInviteMaxUses]=useState(50);
  const [issuedInviteCode,setIssuedInviteCode]=useState("");

  useEffect(() => {
    if (!dashboard.data || manifestText) return;
    setManifestText(JSON.stringify(exampleManifest(dashboard.data.course), null, 2));
  }, [dashboard.data, manifestText]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
      await queryClient.invalidateQueries({ queryKey: ["course-manifest-versions"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["course-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["enrollment-invites"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function parsedManifest(): CourseManifestV1 {
    try {
      return JSON.parse(manifestText) as CourseManifestV1;
    } catch (cause) {
      throw new Error(t("课程清单不是有效 JSON：{{message}}", { message: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  return <div className="page">
    <div className="page-heading">
      <div><h1>{t("课程配置与发布")}</h1><p>{t("先 dry-run 校验清单，再创建不可变草稿；发布和回滚都会生成可审计快照。")}</p></div>
    </div>
    <div className="course-control-layout">
      <section className="surface course-editor">
        <header><h2>CourseManifestV1</h2></header>
        <textarea aria-label={t("课程清单 JSON")} spellCheck={false} value={manifestText} onChange={event => setManifestText(event.target.value)} />
        <label>{t("操作理由")}<textarea value={reason} onChange={event => setReason(event.target.value)} minLength={10} /></label>
        <div className="action-row">
          <button className="button outline" disabled={busy} onClick={() => void run(async () => {
            const result = await repository.dryRunCourseManifest(JSON.parse(manifestText));
            if (!result.valid) throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join("；"));
            return t("校验通过：版本 {{version}}，{{changes}}", { version: result.next_manifest_version, changes: result.changes.join("；") });
          })}>{t("清单 Dry-run")}</button>
          <button className="button primary" disabled={busy || reason.trim().length < 10} onClick={() => void run(async () => {
            const result = await repository.importCourseManifest(parsedManifest(), reason);
            return t("已创建草稿 v{{version}}，checksum {{checksum}}…", { version: result.manifest_version, checksum: result.checksum.slice(0, 12) });
          })}>{t("导入为草稿")}</button>
        </div>
        {message ? <p className="operation-message" role="status">{message}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
      <section className="surface version-history">
        <header><h2>{t("版本历史")}</h2></header>
        {versions.isLoading ? <div className="empty-panel">{t("正在加载版本…")}</div> : null}
        {versions.data?.length ? versions.data.map(item => <article key={item.manifest_version}>
          <div><strong>v{item.manifest_version} · {t(stateLabel(item.state))}</strong><small>{item.manifest.experiment.title} · {item.manifest.experiment.spec_version}</small><code>{item.checksum.slice(0, 16)}</code></div>
          <div className="version-actions">
            {item.state === "draft" ? <button className="button primary" disabled={busy || reason.trim().length < 10} onClick={() => void run(async () => { await repository.publishCourseManifest(item.course_id, item.manifest_version, reason); return t("课程清单 v{{version}} 已发布", { version: item.manifest_version }); })}>{t("发布")}</button> : null}
            {item.state === "superseded" ? <button className="button outline" disabled={busy || reason.trim().length < 10} onClick={() => void run(async () => { const restored = await repository.rollbackCourseManifest(item.course_id, item.manifest_version, reason); return t("历史 v{{old}} 已恢复为新快照 v{{next}}", { old: item.manifest_version, next: restored.manifest_version }); })}>{t("回滚到此内容")}</button> : null}
          </div>
        </article>) : <div className="empty-panel">{t("尚无由 Portal 管理的课程清单版本。")}</div>}
      </section>
      <section className="surface enrollment-import">
        <header><h2>{t("成员与分组 CSV")}</h2></header>
        <textarea aria-label={t("成员 CSV")} spellCheck={false} value={csv} onChange={event => setCsv(event.target.value)} />
        <p className="form-hint">{t("列：username、display_name、role、group。group 仅允许 student；应用前建议先 dry-run。")}</p>
        <div className="action-row">
          <button className="button outline" disabled={busy || !courseId || reason.trim().length < 10} onClick={() => void run(async () => { const result = await repository.importEnrollmentCsv({ course_id: courseId!, csv, dry_run: true, reason }); if (result.issues.length) throw new Error(result.issues.map(issue => t("第 {{row}} 行：{{message}}",{row:issue.row,message:issue.message})).join("；")); return t("名单校验通过：{{count}} 条记录",{count:result.accepted}); })}>{t("名单 Dry-run")}</button>
          <button className="button primary" disabled={busy || !courseId || reason.trim().length < 10} onClick={() => void run(async () => { const result = await repository.importEnrollmentCsv({ course_id: courseId!, csv, dry_run: false, reason }); if (result.issues.length) throw new Error(t("名单存在错误，未应用")); return t("已应用 {{memberships}} 条成员关系，新建 {{users}} 个账号",{memberships:result.updated_memberships,users:result.created_users}); })}>{t("应用名单")}</button>
        </div>
      </section>
      <section className="surface enrollment-invites">
        <header><div><h2>{t("课程邀请码")}</h2><small>{t("明文邀请码只在创建时显示；生产数据库仅保存摘要。")}</small></div></header>
        <div className="invite-form">
          <label>{t("加入角色")}<select value={inviteRole} onChange={event=>setInviteRole(event.target.value as "student"|"ta")}><option value="student">{t("学生")}</option><option value="ta">{t("助教")}</option></select></label>
          <label>{t("有效天数")}<input type="number" min={1} max={180} value={inviteDays} onChange={event=>setInviteDays(Number(event.target.value))} /></label>
          <label>{t("最多使用次数")}<input type="number" min={1} max={500} value={inviteMaxUses} onChange={event=>setInviteMaxUses(Number(event.target.value))} /></label>
          <button className="button primary" disabled={busy||!courseId||reason.trim().length<10} onClick={()=>void run(async()=>{const issued=await repository.createEnrollmentInvite({course_id:courseId!,role:inviteRole,expires_at:new Date(Date.now()+inviteDays*24*60*60_000).toISOString(),max_uses:inviteMaxUses,reason});setIssuedInviteCode(issued.code);return t("邀请码已创建，请立即安全保存。")})}>{t("创建邀请码")}</button>
        </div>
        {issuedInviteCode?<div className="issued-secret" role="status"><b>{t("仅显示一次")}</b><code>{issuedInviteCode}</code><button className="button outline" type="button" onClick={()=>void navigator.clipboard.writeText(issuedInviteCode)}>{t("复制")}</button></div>:null}
        <div className="structured-list">{invites.data?.length?invites.data.map(invite=><article key={invite.id}><b>{t(invite.role==="student"?"学生":"助教")}</b><span>{invite.uses}/{invite.max_uses} · {new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(invite.expires_at))}</span></article>):<p>{t(invites.isLoading?"正在加载邀请码…":"尚未创建邀请码。")}</p>}</div>
      </section>
      <section className="surface course-groups">
        <header><div><h2>{t("小组与成员调整")}</h2><small>{t("使用乐观版本和审计理由更新；学生同一课程只能属于一个小组。")}</small></div><button className="button outline" type="button" onClick={() => { setSelectedGroup(null); setGroupName(""); setGroupMembers([]); }}>{t("新建小组")}</button></header>
        <div className="group-management">
          <div className="structured-list" aria-label={t("课程小组")}>{groups.data?.length ? groups.data.map(group => <button type="button" className={selectedGroup?.id===group.id?"list-button selected":"list-button"} key={group.id} onClick={() => { setSelectedGroup(group); setGroupName(group.name); setGroupMembers([...group.member_ids]); }}><b>{group.name}</b><span>{t("{{count}} 名成员 · revision {{revision}}",{count:group.member_ids.length,revision:group.revision})}</span></button>) : <p>{t(groups.isLoading?"正在加载小组…":"尚未创建小组。")}</p>}</div>
          <form onSubmit={event => { event.preventDefault(); void run(async () => { if(!courseId)throw new Error(t("课程尚未加载"));const input={name:groupName,member_ids:groupMembers,expected_revision:selectedGroup?.revision??0,reason};const saved=selectedGroup?await repository.updateCourseGroup(courseId,selectedGroup.id,input):await repository.createCourseGroup(courseId,input);setSelectedGroup(saved);setGroupName(saved.name);setGroupMembers([...saved.member_ids]);return t(selectedGroup?"小组成员已更新":"小组已创建"); }); }}>
            <label>{t("小组名称")}<input value={groupName} onChange={event=>setGroupName(event.target.value)} maxLength={100} /></label>
            <fieldset><legend>{t("课程学生")}</legend>{provisionOptions.data?.members.filter(member=>member.course_id===courseId).map(member=><label className="check" key={member.id}><input type="checkbox" checked={groupMembers.includes(member.id)} onChange={event=>setGroupMembers(current=>event.target.checked?[...current,member.id]:current.filter(id=>id!==member.id))} /><span>{member.display_name}<small>{member.username}</small></span></label>)}</fieldset>
            <button className="button primary" disabled={busy||!groupName.trim()||groupMembers.length===0||reason.trim().length<10}>{t(selectedGroup?"保存小组调整":"创建小组")}</button>
          </form>
        </div>
      </section>
    </div>
  </div>;
}

function stateLabel(state: "draft" | "published" | "superseded"): string {
  return { draft: "草稿", published: "已发布", superseded: "历史快照" }[state];
}

function exampleManifest(course: { code: string; name: string; term: string }): CourseManifestV1 {
  return {
    version: "course-manifest.v1",
    course: { code: course.code, name: course.name, term: course.term },
    experiment: { id: "xv6-spec", title: "xv6 规范驱动内核", spec_version: "xv6-spec-v1.4.0" },
    stages: [
      { id: "seed", key: "seed", name: "架构种子", sequence: 0, required_artifacts: ["spec/architecture-seed.yaml"], required_evidence: [], manual_review_required: true },
      { id: "boot", key: "boot", name: "启动", sequence: 1, required_artifacts: ["serial.log"], required_evidence: [{ suite: "boot", case_name: "kernel-start", required_result: "pass" }], manual_review_required: false },
    ],
    rubric: [{ id: "correctness", name: "正确性", weight: 70 }, { id: "design", name: "设计与论证", weight: 30 }],
    ai_policy: { allowed_models: ["school-default"], monthly_budget: 100, allow_byok: false },
  };
}
