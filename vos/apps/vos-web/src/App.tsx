import { FormEvent, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { portalApi } from "./api/client";
import { AppShell, type ViewKey } from "./components/AppShell";
import { ArchitectureView } from "./components/ArchitectureView";
import { AuditView } from "./components/AuditView";
import { Dashboard } from "./components/Dashboard";
import { EvidenceExplorer } from "./components/EvidenceExplorer";
import { ScoresView } from "./components/ScoresView";
import { TeacherAdmin } from "./components/TeacherAdmin";
import { Button, Panel } from "./components/ui";
import { usePortalData } from "./hooks/usePortalData";

const viewPaths: Record<ViewKey, string> = {
  dashboard: "/dashboard",
  architecture: "/architecture",
  evidence: "/evidence",
  audit: "/audit",
  teacher: "/teacher",
  scores: "/scores"
};

function viewFromPath(pathname: string): ViewKey {
  const match = Object.entries(viewPaths).find(([, path]) => pathname.startsWith(path));
  return (match?.[0] as ViewKey | undefined) ?? "dashboard";
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [authenticated, setAuthenticated] = useState(portalApi.hasToken());
  const data = usePortalData(authenticated);
  const course = data.courses[0];
  const project = data.activeProject;
  const activeView = viewFromPath(location.pathname);
  const isStaff = ["admin", "teacher", "ta"].includes(data.user?.role ?? "");

  if (!authenticated) {
    return (
      <LoginView
        onLogin={() => {
          setAuthenticated(true);
          queryClient.invalidateQueries();
        }}
      />
    );
  }

  if (data.error) {
    return (
      <ScreenMessage
        title="Portal API unavailable"
        description={data.error instanceof Error ? data.error.message : "The backend returned an error."}
        action={
          <Button
            variant="outline"
            onClick={() => {
              portalApi.clearToken();
              setAuthenticated(false);
              queryClient.clear();
            }}
          >
            Sign in again
          </Button>
        }
      />
    );
  }

  if (data.loading) {
    return <ScreenMessage title="Loading portal data" description="Reading course state from the backend." />;
  }

  if (!project) {
    return (
      <AppShell
        activeView={activeView}
        onViewChange={(view) => navigate(viewPaths[view])}
        user={data.user}
        course={course}
        isStaff={isStaff}
      >
        <ScreenMessage
          title="No project data"
          description="The database has no project visible to this account. Use Teacher Admin after signing in as staff to create one."
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      activeView={activeView}
      onViewChange={(view) => navigate(viewPaths[view])}
      user={data.user}
      course={course}
      isStaff={isStaff}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={
            <Dashboard
              project={project}
              progress={data.progress}
              evidence={data.evidence}
              scores={data.scores}
              onOpenEvidence={() => navigate(viewPaths.evidence)}
            />
          }
        />
        <Route path="/architecture" element={<ArchitectureView progress={data.progress} />} />
        <Route path="/evidence" element={<EvidenceExplorer evidence={data.evidence} />} />
        <Route path="/audit" element={<AuditView audit={data.audit} />} />
        <Route
          path="/teacher"
          element={
            isStaff ? (
              <TeacherAdmin
                rows={data.teacherRows}
                courses={data.courses}
                experiments={data.experiments}
                users={data.users}
                projects={data.projects}
                rubrics={data.rubrics}
                designSubmissions={data.designSubmissions}
              />
            ) : (
              <ScreenMessage title="Staff access required" description="This view is only available to teachers and TAs." />
            )
          }
        />
        <Route path="/scores" element={<ScoresView project={project} scores={data.scores} />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppShell>
  );
}

function LoginView({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("student");
  const [password, setPassword] = useState("student");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await portalApi.login(username, password);
      onLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Panel className="w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">VOS Portal</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in with a backend account.</p>
        <form className="mt-5 flex flex-col gap-3" onSubmit={submit}>
          <input
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
          />
          <input
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
          />
          {error ? <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          <Button disabled={busy}>{busy ? "Signing in" : "Sign in"}</Button>
        </form>
      </Panel>
    </div>
  );
}

function ScreenMessage({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Panel className="max-w-lg p-6 text-center">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </Panel>
    </div>
  );
}
