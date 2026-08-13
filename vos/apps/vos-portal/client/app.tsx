import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { useRepository } from "./repository-context.tsx";
import { LoginPage } from "./features/login-page.tsx";
import { PortalShell } from "./shell/portal-shell.tsx";
import { useTranslation } from "react-i18next";

const StudentDashboard=lazy(()=>import("./features/student-dashboard.tsx").then(module=>({default:module.StudentDashboard})));
const OperationsDashboard=lazy(()=>import("./features/operations-dashboard.tsx").then(module=>({default:module.OperationsDashboard})));
const RunDetailPage=lazy(()=>import("./features/run-detail-page.tsx").then(module=>({default:module.RunDetailPage})));
const WorkspacePage=lazy(()=>import("./features/workspace-page.tsx").then(module=>({default:module.WorkspacePage})));
const DeviceApprovalPage=lazy(()=>import("./features/device-approval-page.tsx").then(module=>({default:module.DeviceApprovalPage})));
const ProjectProvisionPage=lazy(()=>import("./features/project-provision-page.tsx").then(module=>({default:module.ProjectProvisionPage})));
const CourseControlPage=lazy(()=>import("./features/course-control-page.tsx").then(module=>({default:module.CourseControlPage})));
const AdminOidcPage=lazy(()=>import("./features/admin-oidc-page.tsx").then(module=>({default:module.AdminOidcPage})));
const GradeAppealPage=lazy(()=>import("./features/grade-appeal-page.tsx").then(module=>({default:module.GradeAppealPage})));
const ModelCredentialsPage=lazy(()=>import("./features/model-credentials-page.tsx").then(module=>({default:module.ModelCredentialsPage})));
const DesignSubmissionPage=lazy(()=>import("./features/design-submission-page.tsx").then(module=>({default:module.DesignSubmissionPage})));
const EnrollmentInvitePage=lazy(()=>import("./features/enrollment-invite-page.tsx").then(module=>({default:module.EnrollmentInvitePage})));

export function App({ demo }: { demo: boolean }) {
  const { t } = useTranslation();
  const repository = useRepository();
  const [sessionRevision, setSessionRevision] = useState(0);
  const actor = useQuery({ queryKey: ["actor", sessionRevision], queryFn: () => repository.currentActor() });
  if (actor.isLoading) return <main className="center-state">{t("正在加载 VOS Portal…")}</main>;
  if (!actor.data) return <LoginPage demo={demo} onLogin={() => setSessionRevision((value) => value + 1)} />;
  return (
    <PortalShell actor={actor.data} demo={demo} onSessionChange={() => setSessionRevision((value) => value + 1)}>
      <Suspense fallback={<main className="center-state">{t("正在加载 VOS Portal…")}</main>}><Routes>
        <Route path="/" element={<Navigate to="/workspace" replace />} />
        <Route
          path="/workspace"
          element={
            actor.data.role === "student" ? <StudentDashboard />
              : actor.data.role === "ta" || actor.data.role === "teacher" ? <OperationsDashboard />
                  : <AdminOidcPage demo={demo} />
          }
        />
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        <Route path="/courses" element={actor.data.role === "teacher" || actor.data.role === "admin" ? <CourseControlPage /> : <WorkspacePage kind="courses" />} />
        <Route path="/enroll" element={actor.data.role==="student"||actor.data.role==="ta"?<EnrollmentInvitePage />:<Navigate to="/workspace" replace />} />
        <Route path="/projects/new" element={actor.data.role==="teacher"||actor.data.role==="admin"?<ProjectProvisionPage />:<Navigate to="/workspace" replace />} />
        <Route path="/stages" element={<WorkspacePage kind="stages" />} />
        <Route path="/architecture" element={<DesignSubmissionPage />} />
        <Route path="/qa" element={<WorkspacePage kind="qa" />} />
        <Route path="/credentials" element={<ModelCredentialsPage demo={demo} />} />
        <Route path="/grades" element={<GradeAppealPage />} />
        <Route path="/appeals" element={<GradeAppealPage appealsOnly />} />
        <Route path="/admin" element={actor.data.role==="admin"?<AdminOidcPage demo={demo}/>:<WorkspacePage kind="admin" />} />
        <Route path="/device" element={<DeviceApprovalPage />} />
        <Route path="*" element={<Navigate to="/workspace" replace />} />
      </Routes></Suspense>
    </PortalShell>
  );
}
