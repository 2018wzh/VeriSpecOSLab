import { useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  FileText,
  FlaskConical,
  GraduationCap,
  ListChecks,
  Lock,
  LogOut,
  MessageSquare,
  PlayCircle,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import {
  browserStorage,
  createDemoPortal,
  isStaff,
  type ChatMessage,
  type DemoRun,
  type EvidenceRecord,
  type ProjectOverview,
  type QueryBundle,
  type RunLogLine,
  type RunStep,
  type StageGate,
  type User,
  type UserRole,
} from "./lib/api.ts";

const portal = createDemoPortal(browserStorage);

const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  teacher: "Teacher",
  ta: "TA",
  student: "Student",
};

const legacyTargets: Record<string, string> = {
  "/": "/labs",
  "/student": "/labs/experiment-xv6-spec",
  "/project": "/labs/experiment-xv6-spec",
  "/evidence": "/runs",
  "/audit": "/runs",
  "/agent-qa": "/runs",
  "/chat": "/labs",
  "/teacher": "/labs/experiment-xv6-spec",
  "/ta": "/runs",
  "/scores": "/grades",
  "/analytics": "/labs/experiment-xv6-spec",
};

type Toast = {
  id: number;
  text: string;
};

type SeverityFilter = "all" | RunLogLine["severity"];

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<AuthedApp />} />
    </Routes>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("student");
  const [password, setPassword] = useState("student");
  const [error, setError] = useState<string>();

  function submit() {
    try {
      portal.login(username, password);
      navigate("/labs", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-line">
          <ShieldCheck size={28} />
          <div>
            <strong>VOS Portal</strong>
            <span>Gradescope-style prototype demo</span>
          </div>
        </div>
        <div>
          <h1>Spec-first OS labs, simplified.</h1>
          <p>Standalone front-end demo for labs, submissions, grades, and role-scoped AI assistance.</p>
        </div>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" type="submit">Log in</button>
        </form>
        <div className="demo-buttons">
          {["student", "teacher", "ta"].map((account) => (
            <button
              key={account}
              type="button"
              onClick={() => {
                setUsername(account);
                setPassword(account);
                setError(undefined);
              }}
            >
              {account}/{account}
            </button>
          ))}
        </div>
      </section>
      <section className="login-preview">
        <div className="preview-table">
          <div className="preview-row header"><span>Lab</span><span>Status</span><span>Score</span></div>
          <div className="preview-row"><span>Memory Management</span><StatusPill status="failed" /><strong>20/60</strong></div>
          <div className="preview-row"><span>Trap / Privilege</span><StatusPill status="passed" /><strong>30/60</strong></div>
          <div className="preview-row"><span>Final Defense</span><StatusPill status="locked" /><strong>-</strong></div>
        </div>
      </section>
    </main>
  );
}

function AuthedApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | undefined>(() => portal.me());
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => portal.load().selected_project_id);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState<Toast>();
  const [assistantOpen, setAssistantOpen] = useState(false);

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const currentUser = user;
  const bundle = portal.bundle(currentUser, selectedProjectId);
  const legacyTarget = legacyTargets[location.pathname];
  if (legacyTarget) return <Navigate to={legacyTarget} replace />;

  function refresh(text?: string) {
    setRevision((value) => value + 1);
    if (text) setToast({ id: Date.now(), text });
  }

  function switchProject(projectId: string) {
    portal.selectProject(currentUser, projectId);
    setSelectedProjectId(projectId);
    refresh("Project context switched locally.");
  }

  function logout() {
    portal.logout();
    setUser(undefined);
    navigate("/login", { replace: true });
  }

  function resetDemo() {
    portal.reset();
    setSelectedProjectId(portal.load().selected_project_id);
    refresh("Demo data reset from local fixtures.");
  }

  return (
    <Shell
      key={revision}
      user={currentUser}
      bundle={bundle}
      selectedProjectId={selectedProjectId}
      onProjectChange={switchProject}
      onLogout={logout}
      onReset={resetDemo}
      onOpenAssistant={() => setAssistantOpen(true)}
    >
      <Routes>
        <Route path="/labs" element={<LabsPage bundle={bundle} />} />
        <Route path="/labs/:labId" element={<LabDetailPage bundle={bundle} user={currentUser} />} />
        <Route path="/runs" element={<RunsPage bundle={bundle} user={currentUser} />} />
        <Route path="/runs/:runId" element={<RunDetailPage bundle={bundle} user={currentUser} onMutate={refresh} />} />
        <Route path="/grades" element={<GradesPage bundle={bundle} user={currentUser} onToast={refresh} />} />
        <Route path="*" element={<Navigate to="/labs" replace />} />
      </Routes>
      {assistantOpen ? (
        <AssistantDrawer
          bundle={bundle}
          user={currentUser}
          contextPath={location.pathname}
          onClose={() => setAssistantOpen(false)}
          onMutate={refresh}
        />
      ) : null}
      {toast ? <Snackbar text={toast.text} onClose={() => setToast(undefined)} /> : null}
    </Shell>
  );
}

function Shell({
  user,
  bundle,
  selectedProjectId,
  onProjectChange,
  onLogout,
  onReset,
  onOpenAssistant,
  children,
}: {
  user: User;
  bundle: QueryBundle;
  selectedProjectId?: string;
  onProjectChange: (projectId: string) => void;
  onLogout: () => void;
  onReset: () => void;
  onOpenAssistant: () => void;
  children: React.ReactNode;
}) {
  const nav = [
    { to: "/labs", label: "Labs", icon: <BookOpen size={18} /> },
    { to: "/runs", label: "Runs", icon: <PlayCircle size={18} /> },
    { to: "/grades", label: "Grades", icon: <GraduationCap size={18} /> },
  ];

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <ShieldCheck size={22} />
          <div>
            <strong>VOS</strong>
            <span>Portal</span>
          </div>
        </div>
        <nav>
          {nav.map((item) => <NavItem key={item.to} {...item} />)}
        </nav>
      </aside>
      <div className="app-content">
        <header className="topbar">
          <ProjectSelect projects={bundle.projects} selectedProjectId={selectedProjectId} onChange={onProjectChange} />
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={onOpenAssistant}>
              <Bot size={16} />
              AI Assistant
            </button>
            <button className="ghost-button" type="button" onClick={onReset}>
              <RotateCcw size={16} />
              Reset demo
            </button>
            <div className="user-chip">
              <strong>{user.display_name}</strong>
              <span>{roleLabels[user.role]}</span>
            </div>
            <button className="icon-button" type="button" title="Log out" onClick={onLogout}>
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  const location = useLocation();
  const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <Link className={active ? "nav-item active" : "nav-item"} to={to}>
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function ProjectSelect({
  projects,
  selectedProjectId,
  onChange,
}: {
  projects: ProjectOverview[];
  selectedProjectId?: string;
  onChange: (projectId: string) => void;
}) {
  return (
    <label className="project-select">
      <span>Project</span>
      <select value={selectedProjectId ?? projects[0]?.project.id ?? ""} onChange={(event) => onChange(event.target.value)}>
        {projects.map((item) => (
          <option key={item.project.id} value={item.project.id}>
            {item.project.id.replace("project-", "")} - {item.current_stage.name}
          </option>
        ))}
      </select>
      <ChevronDown size={16} />
    </label>
  );
}

function LabsPage({ bundle }: { bundle: QueryBundle }) {
  const experiment = bundle.experiments[0];
  const course = bundle.courses[0];
  const submitted = bundle.runs.length;
  const passing = bundle.runs.filter((run) => run.status === "passed").length;

  return (
    <Page title="Labs" subtitle={`${course?.code ?? "VOS"} ${course?.term ?? ""}`}>
      <div className="summary-grid">
        <SummaryCard label="Published labs" value={String(bundle.experiments.length)} />
        <SummaryCard label="Stage gates" value={String(bundle.stageGates.length)} />
        <SummaryCard label="Submissions" value={String(submitted)} />
        <SummaryCard label="Passing runs" value={`${passing}/${submitted || 1}`} />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{experiment?.title ?? "xv6 Spec-Driven Kernel"}</h2>
            <p>{experiment?.description ?? "Progressive OS lab with staged evidence."}</p>
          </div>
          <StatusPill status={experiment?.publish_state ?? "prototype-demo"} />
        </div>
        <Table
          columns={["Lab", "Release", "Due / Freeze", "Submissions", "Status", "Action"]}
          rows={[[
            <strong key="lab">{experiment?.title ?? "xv6 Spec-Driven Kernel"}</strong>,
            "Published",
            "Final freeze after defense",
            `${bundle.runs.length} demo runs`,
            <StatusPill key="status" status="active" />,
            <Link key="action" className="text-link" to={`/labs/${experiment?.id ?? "experiment-xv6-spec"}`}>Open lab</Link>,
          ]]}
        />
      </section>
    </Page>
  );
}

function LabDetailPage({ bundle, user }: { bundle: QueryBundle; user: User }) {
  const { labId } = useParams();
  const [tab, setTab] = useState("setup");
  const experiment = bundle.experiments.find((item) => item.id === labId) ?? bundle.experiments[0];
  const tabs = [
    ["setup", "Setup"],
    ["gates", "Stage Gates"],
    ["submissions", "Submissions"],
    ["review", "Review"],
    ["rubric", "Rubric"],
    ["appeals", "Appeals / Retro"],
  ];

  return (
    <Page title={experiment?.title ?? "Lab"} subtitle="Course flow is compressed into one Gradescope-style lab detail.">
      <div className="detail-header">
        <Link className="back-link" to="/labs"><ArrowLeft size={16} />Labs</Link>
        <div>
          <h2>{experiment?.title}</h2>
          <p>{experiment?.description}</p>
        </div>
        <StatusPill status={experiment?.publish_state ?? "prototype-demo"} />
      </div>
      <TabBar tabs={tabs} value={tab} onChange={setTab} />
      {tab === "setup" ? <SetupTab bundle={bundle} /> : null}
      {tab === "gates" ? <GatesTab bundle={bundle} /> : null}
      {tab === "submissions" ? <SubmissionsTab bundle={bundle} /> : null}
      {tab === "review" ? <ReviewTab bundle={bundle} user={user} /> : null}
      {tab === "rubric" ? <RubricTab bundle={bundle} user={user} /> : null}
      {tab === "appeals" ? <AppealsTab bundle={bundle} /> : null}
    </Page>
  );
}

function SetupTab({ bundle }: { bundle: QueryBundle }) {
  const course = bundle.courses[0];
  const experiment = bundle.experiments[0];
  return (
    <div className="two-column">
      <section className="panel">
        <h2>Course setup and publishing</h2>
        <WorkflowList
          items={[
            ["Create course", `${course?.code} ${course?.term}`, "done"],
            ["Publish experiment", experiment?.spec_version ?? "xv6-spec-demo", "done"],
            ["Provision repositories", `${bundle.projects.length} visible project(s)`, "done"],
            ["AI policy", "Student public projection and audited assistant enabled", "done"],
          ]}
        />
      </section>
      <section className="panel">
        <h2>Enrollment and access</h2>
        <p className="muted">Students see only their own project, current public stage gates, public evidence, and read-only assistant output.</p>
        <KeyValueGrid items={[
          ["Role", roleLabels[bundle.user.role]],
          ["Visible projects", String(bundle.projects.length)],
          ["Active stage", bundle.activeProject?.current_stage.name ?? "-"],
          ["Repository", bundle.activeProject?.project.repo_url ?? "-"],
        ]} />
      </section>
    </div>
  );
}

function GatesTab({ bundle }: { bundle: QueryBundle }) {
  return (
    <section className="panel">
      <h2>Stage gates</h2>
      <Table
        columns={["Sequence", "Gate", "Artifacts", "Evidence", "Manual review", "State"]}
        rows={bundle.stageGates.map((stage) => [
          stage.sequence + 1,
          <strong key={stage.id}>{stage.name}</strong>,
          stage.config.required_artifacts.join(", "),
          stage.config.required_evidence.map((item) => `${item.suite}/${item.case_name}`).join(", "),
          stage.config.manual_review_required ? "Required" : "Automatic",
          <StatusPill key="status" status={stage.status ?? "active"} />,
        ])}
      />
    </section>
  );
}

function SubmissionsTab({ bundle }: { bundle: QueryBundle }) {
  return (
    <section className="panel">
      <h2>Submissions</h2>
      <RunsTable bundle={bundle} />
    </section>
  );
}

function ReviewTab({ bundle, user }: { bundle: QueryBundle; user: User }) {
  return (
    <div className="two-column">
      <section className="panel">
        <h2>Review queue</h2>
        {isStaff(user) ? (
          <Table
            columns={["Project", "Stage", "Submission", "Review", "Risk"]}
            rows={bundle.runs.map((run) => [
              run.project_id.replace("project-", ""),
              run.stage_key,
              <Link key={run.id} className="text-link" to={`/runs/${run.id}`}>{run.title}</Link>,
              <StatusPill key="review" status={run.review.status} />,
              run.risk_tags.map((tag) => tag.label).join(", ") || "clear",
            ])}
          />
        ) : (
          <p className="muted">Your review status appears inside each run. Staff queue details stay hidden.</p>
        )}
      </section>
      <section className="panel">
        <h2>Evidence and QA</h2>
        <WorkflowList
          items={[
            ["Design submission", "SpecPatch and ArchitectureSlice attached", "done"],
            ["Public verify", "Evidence mapped to stage gate requirements", "done"],
            ["TA review", "Feedback and unlock decision recorded", isStaff(user) ? "visible" : "redacted"],
            ["AI audit", "Readonly assistant turns are preserved", "done"],
          ]}
        />
      </section>
    </div>
  );
}

function RubricTab({ bundle, user }: { bundle: QueryBundle; user: User }) {
  return (
    <section className="panel">
      <h2>Rubric</h2>
      {isStaff(user) ? (
        <Table
          columns={["Item", "Target", "Weight", "Description"]}
          rows={bundle.rubrics.map((rubric) => [
            <strong key={rubric.id}>{rubric.name}</strong>,
            rubric.target_kind,
            rubric.weight,
            rubric.description ?? "-",
          ])}
        />
      ) : (
        <p className="muted">Detailed staff-only rubric mapping is hidden. Your visible points are shown in Grades.</p>
      )}
    </section>
  );
}

function AppealsTab({ bundle }: { bundle: QueryBundle }) {
  return (
    <div className="two-column">
      <section className="panel">
        <h2>Appeals</h2>
        <Table
          columns={["Run", "Window", "Status", "Summary"]}
          rows={bundle.runs.map((run) => [
            <Link key={run.id} className="text-link" to={`/runs/${run.id}`}>{run.title}</Link>,
            run.appeal.window,
            <StatusPill key="appeal" status={run.appeal.status} />,
            run.appeal.summary,
          ])}
        />
      </section>
      <section className="panel">
        <h2>Teaching retrospective</h2>
        <WorkflowList
          items={[
            ["Stage pass rate", `${bundle.runs.filter((run) => run.status === "passed").length}/${bundle.runs.length} visible runs passing`, "metric"],
            ["Common failure", "Memory allocator invariant and resource lifetime", "metric"],
            ["AI risk", `${bundle.audits.filter((audit) => audit.risk_level !== "low").length} non-low audit summaries`, "metric"],
            ["Next course change", "Add earlier ownership examples before resource stage", "metric"],
          ]}
        />
      </section>
    </div>
  );
}

function RunsPage({ bundle }: { bundle: QueryBundle; user: User }) {
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const runs = bundle.runs.filter((run) =>
    (status === "all" || run.status === status) &&
    `${run.title} ${run.stage_key} ${run.project_id}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <Page title="Runs" subtitle="Gradescope-style submission list with role-scoped visibility.">
      <div className="list-toolbar">
        <label className="search-box">
          <Search size={16} />
          <input value={query} placeholder="Search submissions" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <Segmented value={status} values={["all", "failed", "passed"]} onChange={setStatus} />
      </div>
      <section className="panel">
        <RunsTable bundle={{ ...bundle, runs }} />
      </section>
    </Page>
  );
}

function RunsTable({ bundle }: { bundle: QueryBundle }) {
  return (
    <Table
      columns={["Submission", "Project", "Stage", "Status", "Score", "Review", "Submitted"]}
      rows={bundle.runs.map((run) => [
        <Link key={run.id} className="text-link strong" to={`/runs/${run.id}`}>{run.title}</Link>,
        run.project_id.replace("project-", ""),
        run.stage_key,
        <StatusPill key="status" status={run.status} />,
        `${run.steps.reduce((sum, step) => sum + (step.points ?? 0), 0)}/${run.steps.reduce((sum, step) => sum + (step.possible ?? 0), 0)}`,
        <StatusPill key="review" status={run.review.status} />,
        formatDate(run.started_at),
      ])}
    />
  );
}

function RunDetailPage({ bundle, user, onMutate }: { bundle: QueryBundle; user: User; onMutate: (text?: string) => void }) {
  const { runId } = useParams();
  const navigate = useNavigate();
  const run = bundle.runs.find((item) => item.id === runId) ?? bundle.runs[0];
  const [selectedStepId, setSelectedStepId] = useState(run?.steps[0]?.id ?? "submit");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [query, setQuery] = useState("");
  const [showStaff, setShowStaff] = useState(false);
  const selectedStep = run?.steps.find((step) => step.id === selectedStepId) ?? run?.steps[0];
  const logLines = (run?.log_lines ?? []).filter((line) =>
    (!selectedStep || line.step_id === selectedStep.id) &&
    (severity === "all" || line.severity === severity) &&
    line.message.toLowerCase().includes(query.toLowerCase())
  );

  if (!run) return <Navigate to="/runs" replace />;

  function replay() {
    const replayed = portal.replayRun(user, run.id);
    onMutate("Demo replay created locally. No backend, runner, or model was called.");
    navigate(`/runs/${replayed.id}`);
  }

  return (
    <Page title={run.title} subtitle="Submission detail with full platform log.">
      <div className="submission-header">
        <Link className="back-link" to="/runs"><ArrowLeft size={16} />Runs</Link>
        <div className="submission-title">
          <h2>{run.title}</h2>
          <p>{run.project_id} · {run.stage_key} · {run.id}</p>
        </div>
        <div className="submission-actions">
          <StatusPill status={run.status} />
          <button className="secondary-button" type="button" onClick={replay}><RefreshCcw size={16} />Demo replay</button>
        </div>
      </div>

      <div className="score-strip">
        <KeyValue label="Score" value={`${run.steps.reduce((sum, step) => sum + (step.points ?? 0), 0)}/${run.steps.reduce((sum, step) => sum + (step.possible ?? 0), 0)}`} />
        <KeyValue label="Commit" value={bundle.activeProject?.project.last_commit_sha ?? "-"} />
        <KeyValue label="Submitted" value={formatDate(run.started_at)} />
        <KeyValue label="Review" value={run.review.status} />
        <KeyValue label="Appeal" value={run.appeal.status} />
      </div>

      <div className="submission-grid">
        <aside className="steps-panel">
          <h3>Autograder steps</h3>
          {run.steps.map((step) => (
            <button
              key={step.id}
              className={step.id === selectedStep?.id ? "step-row active" : "step-row"}
              type="button"
              onClick={() => setSelectedStepId(step.id)}
            >
              <StepIcon status={step.status} />
              <span>
                <strong>{step.label}</strong>
                <small>{step.points ?? "-"}/{step.possible ?? "-"} pts · {step.phase}</small>
              </span>
              <StatusPill status={step.status} />
            </button>
          ))}
        </aside>

        <section className="results-panel">
          <div className="result-summary">
            <div>
              <p className="eyebrow">Selected step</p>
              <h2>{selectedStep?.label}</h2>
              <p>{selectedStep?.summary}</p>
            </div>
            <StatusPill status={selectedStep?.status ?? "unknown"} />
          </div>

          <div className="result-tabs">
            <section className="result-card">
              <h3>Full-process log</h3>
              <div className="log-toolbar">
                <label className="search-box">
                  <Search size={16} />
                  <input value={query} placeholder="Search current step log" onChange={(event) => setQuery(event.target.value)} />
                </label>
                <Segmented value={severity} values={["all", "info", "success", "warning", "error"]} onChange={(value) => setSeverity(value as SeverityFilter)} />
              </div>
              <LogViewer lines={logLines} />
            </section>

            <section className="result-card">
              <h3>Evidence and artifacts</h3>
              <div className="artifact-list">
                {run.artifacts.map((artifact) => (
                  <div className="artifact-row" key={artifact.id}>
                    <FileText size={16} />
                    <div>
                      <strong>{artifact.label}</strong>
                      <span>{artifact.kind} · {artifact.uri}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="evidence-list">
                {run.evidence_links.map((evidence) => (
                  <div className="evidence-row" key={evidence.id}>
                    <StatusPill status={evidence.result} />
                    <span>{evidence.suite}/{evidence.case_name}</span>
                    <p>{evidence.summary}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="result-card">
              <h3>AI / QA summary</h3>
              <p className="muted">{run.review.summary}</p>
              <div className="tag-list">
                {run.risk_tags.map((tag) => <span className={`risk ${tag.severity}`} key={tag.id}>{tag.label}</span>)}
              </div>
              {isStaff(user) ? (
                <button className="ghost-button" type="button" onClick={() => setShowStaff((value) => !value)}>
                  {showStaff ? "Hide" : "Show"} staff notes
                </button>
              ) : null}
              {showStaff && run.staff_log ? <pre className="staff-note">{run.staff_log}</pre> : null}
            </section>
          </div>
        </section>
      </div>
    </Page>
  );
}

function GradesPage({ bundle, user, onToast }: { bundle: QueryBundle; user: User; onToast: (text?: string) => void }) {
  const totalEarned = bundle.scores.reduce((sum, score) => sum + (score.manual_score ?? score.auto_score), 0);
  const possible = bundle.activeProject?.score_summary.possible ?? bundle.rubrics.reduce((sum, item) => sum + item.weight, 0);
  return (
    <Page title="Grades" subtitle="Score snapshots, rubric evidence, freeze state, feedback, and appeals.">
      <div className="score-strip">
        <KeyValue label="Current score" value={`${totalEarned}/${possible || "-"}`} />
        <KeyValue label="Finalized" value={bundle.activeProject?.score_summary.finalized ? "yes" : "provisional"} />
        <KeyValue label="Visible runs" value={String(bundle.runs.length)} />
        <KeyValue label="Appeal window" value="after freeze" />
      </div>
      <div className="two-column">
        <section className="panel">
          <h2>Rubric and evidence</h2>
          <Table
            columns={["Item", "Score", "Final", "Feedback"]}
            rows={bundle.scores.map((score) => [
              rubricName(bundle, score.rubric_id, user),
              `${score.manual_score ?? score.auto_score}`,
              score.is_final ? "yes" : "provisional",
              score.feedback ?? "-",
            ])}
          />
        </section>
        <section className="panel">
          <h2>Freeze and appeal</h2>
          <WorkflowList
            items={[
              ["Evidence complete", bundle.runs.some((run) => run.status === "passed") ? "At least one passing run exists" : "Passing run required", "metric"],
              ["Score freeze", bundle.activeProject?.score_summary.finalized ? "Frozen" : "Not frozen", "metric"],
              ["Feedback", "TA / teacher comments are attached to run details", "metric"],
              ["Appeal", "Available after final publication", "metric"],
            ]}
          />
          <button className="primary-button" type="button" onClick={() => onToast("Demo action only: appeal submission is not sent to a backend.")}>
            Request regrade / appeal
          </button>
        </section>
      </div>
    </Page>
  );
}

function AssistantDrawer({
  bundle,
  user,
  contextPath,
  onClose,
  onMutate,
}: {
  bundle: QueryBundle;
  user: User;
  contextPath: string;
  onClose: () => void;
  onMutate: (text?: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const projectId = bundle.activeProject?.project.id;
  const messages = bundle.chatThread?.messages ?? [];

  function send() {
    if (!projectId || !draft.trim()) return;
    portal.sendChat(user, projectId, `[${contextPath}] ${draft.trim()}`);
    setDraft("");
    onMutate("AI assistant reply saved locally and audit summary added.");
  }

  return (
    <div className="drawer-backdrop">
      <aside className="assistant-drawer">
        <header>
          <div>
            <p className="eyebrow">Global AI assistant</p>
            <h2>Ask about this course flow</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="assistant-context">
          <span>Context: {contextPath}</span>
          <span>Role: {roleLabels[user.role]}</span>
          <span>Mode: read-only mock</span>
        </div>
        <div className="assistant-messages">
          {messages.slice(-6).map((message) => <AssistantMessage key={message.id} message={message} evidence={bundle.evidence} />)}
        </div>
        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <textarea value={draft} placeholder="Ask about a lab, run, grade, log, or appeal status" onChange={(event) => setDraft(event.target.value)} />
          <button className="primary-button" type="submit" disabled={!draft.trim()}><Send size={16} />Send</button>
        </form>
      </aside>
    </div>
  );
}

function AssistantMessage({ message, evidence }: { message: ChatMessage; evidence: EvidenceRecord[] }) {
  const refs = evidence.filter((item) => message.evidence_refs.includes(item.id));
  return (
    <div className={`assistant-message ${message.role}`}>
      <strong>{message.role}</strong>
      <p>{message.content}</p>
      {refs.length ? <small>{refs.map((item) => `${item.suite}/${item.case_name}`).join(", ")}</small> : null}
    </div>
  );
}

function LogViewer({ lines }: { lines: RunLogLine[] }) {
  return (
    <pre className="log-viewer">
      {lines.map((line) => `[${formatTime(line.at)}] ${line.severity.toUpperCase()} ${line.stream}: ${line.message}`).join("\n\n") || "No log lines match this filter."}
    </pre>
  );
}

function Page({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </header>
      {children}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <section className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabBar({ tabs, value, onChange }: { tabs: string[][]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="tabbar">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" className={value === id ? "active" : undefined} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Segmented({ value, values, onChange }: { value: string; values: string[]; onChange: (value: string) => void }) {
  return (
    <div className="segmented">
      {values.map((item) => (
        <button key={item} type="button" className={value === item ? "active" : undefined} onClick={() => onChange(item)}>
          {item}
        </button>
      ))}
    </div>
  );
}

function WorkflowList({ items }: { items: Array<[string, string, string]> }) {
  return (
    <div className="workflow-list">
      {items.map(([title, text, state]) => (
        <div className="workflow-row" key={title}>
          <CheckCircle2 size={16} />
          <div>
            <strong>{title}</strong>
            <span>{text}</span>
          </div>
          <StatusPill status={state} />
        </div>
      ))}
    </div>
  );
}

function KeyValueGrid({ items }: { items: string[][] }) {
  return (
    <div className="kv-grid">
      {items.map(([label, value]) => <KeyValue key={label} label={label} value={value} />)}
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="key-value">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized.includes("pass") || normalized.includes("approved") || normalized.includes("done") || normalized.includes("success") || normalized.includes("active")
    ? "success"
    : normalized.includes("fail") || normalized.includes("error") || normalized.includes("escalated") || normalized.includes("needs")
      ? "danger"
      : normalized.includes("warning") || normalized.includes("pending") || normalized.includes("skipped") || normalized.includes("provisional")
        ? "warning"
        : "neutral";
  return <span className={`status-pill ${tone}`}>{status}</span>;
}

function StepIcon({ status }: { status: RunStep["status"] }) {
  if (status === "passed") return <CheckCircle2 className="step-icon success" size={18} />;
  if (status === "failed") return <XCircle className="step-icon danger" size={18} />;
  if (status === "warning" || status === "skipped") return <AlertCircle className="step-icon warning" size={18} />;
  return <Clock className="step-icon" size={18} />;
}

function Snackbar({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="snackbar">
      <span>{text}</span>
      <button type="button" onClick={onClose}><X size={16} /></button>
    </div>
  );
}

function rubricName(bundle: QueryBundle, rubricId: string, user: User): string {
  if (!isStaff(user)) return "Visible score item";
  return bundle.rubrics.find((rubric) => rubric.id === rubricId)?.name ?? rubricId;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
