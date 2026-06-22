export type UserRole = "admin" | "teacher" | "ta" | "student";
export type PipelineStatus = "queued" | "running" | "passed" | "failed" | "cancelled" | "timed_out";
export type EvidenceResult = "pass" | "fail" | "error" | "skipped";
export type RunEventVisibility = "student" | "staff";
export type RunRiskSeverity = "low" | "medium" | "high" | "critical";
export type ChatMessageRole = "user" | "assistant" | "system";

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  status?: string;
}

interface UserRecord extends User {
  password: string;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  term: string;
  status: string;
  description?: string;
}

export interface Experiment {
  id: string;
  course_id: string;
  title: string;
  description?: string;
  experiment_type: string;
  publish_state: string;
  spec_version?: string;
}

export interface EvidenceRequirement {
  suite: string;
  case_name: string;
  required_result: EvidenceResult;
}

export interface StageGate {
  id: string;
  experiment_id: string;
  key: string;
  name: string;
  sequence: number;
  gate_type: string;
  status?: string;
  config: {
    required_artifacts: string[];
    required_evidence: EvidenceRequirement[];
    manual_review_required: boolean;
    visibility_scope?: string;
  };
}

export interface Project {
  id: string;
  student_user_id: string;
  experiment_id: string;
  repo_url?: string;
  current_stage_id: string;
  status: string;
  last_commit_sha?: string;
}

export interface PublicSummary {
  status: PipelineStatus;
  passed: number;
  failed: number;
  total: number;
  failure_class?: string;
  message: string;
}

export interface PipelineRun {
  id: string;
  project_id: string;
  commit_sha: string;
  trigger_type: string;
  status: PipelineStatus;
  stage_scope?: string;
  public_summary?: PublicSummary;
  started_at: string;
  finished_at?: string;
}

export interface EvidenceRecord {
  id: string;
  project_id: string;
  pipeline_run_id: string;
  kind: string;
  suite: string;
  case_name: string;
  result: EvidenceResult;
  metrics: Record<string, unknown>;
  log_segment?: string;
  artifact_uri?: string;
}

export interface ScoreSummary {
  earned: number;
  possible: number;
  finalized: boolean;
}

export interface ProjectOverview {
  project: Project;
  current_stage: StageGate;
  latest_pipeline?: PipelineRun;
  score_summary: ScoreSummary;
}

export interface StageProgress {
  current_stage: StageGate;
  stages: Array<{
    stage: StageGate;
    unlocked: boolean;
    passed: boolean;
    missing_evidence: EvidenceRequirement[];
    manual_review_status?: string;
  }>;
}

export interface ScoreItem {
  id: string;
  project_id: string;
  rubric_id: string;
  auto_score: number;
  manual_score?: number;
  feedback?: string;
  is_final: boolean;
}

export interface AgentAuditRecord {
  id: string;
  session_id: string;
  user_id: string;
  project_id: string;
  model: string;
  task_kind: string;
  prompt_summary: string;
  response_summary?: string;
  risk_flags: string[];
  risk_level: RunRiskSeverity;
  created_at: string;
}

export interface EvaluationRubric {
  id: string;
  experiment_id: string;
  name: string;
  status: string;
  target_kind: string;
  target_suite?: string;
  target_case?: string;
  weight: number;
  description?: string;
}

export interface DesignSubmission {
  id: string;
  project_id: string;
  stage_gate_id: string;
  commit_sha: string;
  artifact_ref?: string;
  review_status: string;
  reviewer_user_id?: string;
  feedback?: string;
}

export interface TeacherProjectRow {
  project: Project;
  student: User;
  current_stage: StageGate;
  latest_pipeline?: PipelineRun;
  score_summary: ScoreSummary;
  risk_flags: string[];
}

export interface RunEvent {
  id: string;
  at: string;
  type: "request" | "context" | "profile" | "tool" | "evidence" | "risk" | "decision" | "log";
  title: string;
  summary: string;
  status: "idle" | "running" | "passed" | "failed" | "warning";
  visibility: RunEventVisibility;
  detail?: Record<string, unknown>;
}

export interface RunToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "allowed" | "blocked" | "completed" | "failed";
  summary: string;
  visibility: RunEventVisibility;
}

export interface RunEvidenceLink {
  id: string;
  evidence_id: string;
  suite: string;
  case_name: string;
  result: EvidenceResult;
  summary: string;
  visibility: RunEventVisibility;
}

export interface RunRiskTag {
  id: string;
  label: string;
  severity: RunRiskSeverity;
  visibility: RunEventVisibility;
}

export interface QaNote {
  id: string;
  run_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
}

export interface RunChecklistItem {
  id: string;
  label: string;
  done: boolean;
  visibility: RunEventVisibility;
}

export interface RunStep {
  id: string;
  label: string;
  phase: "submit" | "spec" | "build" | "qemu" | "verify" | "evidence" | "agent" | "review" | "score" | "appeal";
  status: "queued" | "running" | "passed" | "failed" | "warning" | "skipped";
  started_at: string;
  finished_at?: string;
  points?: number;
  possible?: number;
  summary: string;
  visibility: RunEventVisibility;
}

export interface RunLogLine {
  id: string;
  step_id: string;
  at: string;
  stream: "system" | "stdout" | "stderr" | "agent" | "review";
  severity: "info" | "success" | "warning" | "error";
  message: string;
  visibility: RunEventVisibility;
}

export interface RunArtifact {
  id: string;
  label: string;
  kind: "spec" | "log" | "evidence" | "report" | "audit";
  uri: string;
  visibility: RunEventVisibility;
}

export interface RunReview {
  status: "not_started" | "pending" | "approved" | "needs_changes" | "escalated";
  reviewer?: string;
  summary: string;
  visibility: RunEventVisibility;
}

export interface RunAppeal {
  status: "closed" | "open" | "not_open";
  window: string;
  summary: string;
}

export interface DemoRun {
  id: string;
  project_id: string;
  stage_key: string;
  title: string;
  kind: "verify" | "agent" | "review" | "chat";
  profile: string;
  model: string;
  status: PipelineStatus;
  started_at: string;
  finished_at?: string;
  demo_action: boolean;
  request_context: string[];
  public_log: string;
  staff_log?: string;
  next_steps: string[];
  events: RunEvent[];
  tool_calls: RunToolCall[];
  evidence_links: RunEvidenceLink[];
  risk_tags: RunRiskTag[];
  checklist: RunChecklistItem[];
  steps: RunStep[];
  log_lines: RunLogLine[];
  artifacts: RunArtifact[];
  review: RunReview;
  appeal: RunAppeal;
  disposition?: "untriaged" | "student-action" | "infra-watch" | "escalated" | "resolved";
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  created_at: string;
  evidence_refs: string[];
  object_refs: string[];
}

export interface ChatThread {
  id: string;
  project_id: string;
  stage_key: string;
  title: string;
  messages: ChatMessage[];
  object_refs: string[];
  updated_at: string;
}

export interface ObjectRef {
  id: string;
  project_id: string;
  uri: string;
  sha256: string;
  content_type: string;
  size: number;
  visibility: RunEventVisibility;
  label: string;
}

export interface KbSource {
  id: string;
  project_id: string;
  source_kind: "course" | "project" | "external";
  title: string;
  object_ref_id: string;
  stage_scope?: string;
}

export interface DemoAction {
  id: string;
  label: string;
  created_at: string;
  actor_user_id: string;
  target_id: string;
  kind: "reset" | "replay" | "note" | "risk" | "chat" | "checklist" | "disposition";
}

export interface DemoState {
  session_user_id?: string;
  selected_project_id?: string;
  users: UserRecord[];
  courses: Course[];
  experiments: Experiment[];
  stages: StageGate[];
  projects: Project[];
  submissions: DesignSubmission[];
  pipelines: PipelineRun[];
  evidence: EvidenceRecord[];
  rubrics: EvaluationRubric[];
  scores: ScoreItem[];
  audits: AgentAuditRecord[];
  runs: DemoRun[];
  qa_notes: QaNote[];
  chat_threads: ChatThread[];
  objects: ObjectRef[];
  kb_sources: KbSource[];
  actions: DemoAction[];
}

export interface QueryBundle {
  user: User;
  courses: Course[];
  experiments: Experiment[];
  projects: ProjectOverview[];
  activeProject?: ProjectOverview;
  progress?: StageProgress;
  evidence: EvidenceRecord[];
  scores: ScoreItem[];
  audits: AgentAuditRecord[];
  rubrics: EvaluationRubric[];
  submissions: DesignSubmission[];
  teacherRows: TeacherProjectRow[];
  stageGates: StageGate[];
  runs: DemoRun[];
  chatThread?: ChatThread;
  qaNotes: QaNote[];
  objects: ObjectRef[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class DemoPortalError extends Error {
  constructor(
    public readonly type: "unauthorized" | "forbidden" | "not_found" | "bad_request",
    message: string,
  ) {
    super(message);
  }
}

const storageKey = "vos.web.demo.state.v2";

export const browserStorage: StorageLike = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
};

export function createDemoPortal(storage: StorageLike = browserStorage) {
  function load(): DemoState {
    const stored = storage.getItem(storageKey);
    if (!stored) {
      const seeded = createSeedState();
      save(seeded);
      return seeded;
    }
    try {
      return mergeSeed(JSON.parse(stored) as Partial<DemoState>);
    } catch {
      const seeded = createSeedState();
      save(seeded);
      return seeded;
    }
  }

  function save(state: DemoState): void {
    storage.setItem(storageKey, JSON.stringify(state));
  }

  function mutate<T>(fn: (state: DemoState) => T): T {
    const state = load();
    const result = fn(state);
    save(state);
    return result;
  }

  return {
    load,
    login(username: string, password: string): User {
      return mutate((state) => {
        const user = state.users.find((item) => item.username === username && item.password === password);
        if (!user) throw new DemoPortalError("unauthorized", "Demo account not found");
        state.session_user_id = user.id;
        if (!state.selected_project_id || !canSeeProject(user, state.projects.find((item) => item.id === state.selected_project_id))) {
          state.selected_project_id = firstVisibleProject(state, user)?.id;
        }
        return publicUser(user);
      });
    },
    logout(): void {
      mutate((state) => {
        state.session_user_id = undefined;
      });
    },
    me(): User | undefined {
      const state = load();
      const user = state.users.find((item) => item.id === state.session_user_id);
      return user ? publicUser(user) : undefined;
    },
    reset(): DemoState {
      const currentUserId = load().session_user_id;
      const seeded = createSeedState();
      seeded.session_user_id = currentUserId;
      seeded.selected_project_id = currentUserId
        ? firstVisibleProject(seeded, seeded.users.find((item) => item.id === currentUserId))?.id
        : undefined;
      seeded.actions.unshift(action("reset", currentUserId ?? "system", "demo-state", "Reset demo data"));
      save(seeded);
      return seeded;
    },
    bundle(user: User, projectId?: string): QueryBundle {
      const state = load();
      const visible = visibleProjects(state, user);
      const requested = projectId ? visible.find((project) => project.id === projectId) : undefined;
      const selected = requested
        ?? visible.find((project) => project.id === state.selected_project_id)
        ?? visible[0];
      if (selected) {
        state.selected_project_id = selected.id;
        save(state);
      }
      const activeProject = selected ? projectOverview(state, selected) : undefined;
      const activeProjectId = activeProject?.project.id;
      const activeExperimentId = activeProject?.project.experiment_id ?? state.experiments[0]?.id;
      const runs = activeProjectId
        ? state.runs.filter((run) => canSeeRun(user, state, run)).map((run) => sanitizeRun(user, run))
        : [];
      return {
        user,
        courses: [...state.courses],
        experiments: [...state.experiments],
        projects: visible.map((project) => projectOverview(state, project)),
        activeProject,
        progress: activeProjectId ? stageProgress(state, user, activeProjectId) : undefined,
        evidence: activeProjectId ? evidenceFor(state, user, activeProjectId) : [],
        scores: activeProjectId ? scoresFor(state, user, activeProjectId) : [],
        audits: activeProjectId ? auditsFor(state, user, activeProjectId) : [],
        rubrics: isStaff(user) ? [...state.rubrics] : [],
        submissions: isStaff(user) ? [...state.submissions] : [],
        teacherRows: isStaff(user) && activeExperimentId ? teacherRows(state, activeExperimentId) : [],
        stageGates: activeExperimentId ? stagesFor(state, activeExperimentId) : [],
        runs,
        chatThread: activeProjectId ? chatThreadFor(state, activeProjectId) : undefined,
        qaNotes: isStaff(user) ? [...state.qa_notes] : [],
        objects: activeProjectId ? objectsFor(state, user, activeProjectId) : [],
      };
    },
    kbSources(user: User, projectId: string): KbSource[] {
      const state = load();
      const project = state.projects.find((item) => item.id === projectId);
      if (!canSeeProject(user, project)) throw new DemoPortalError("forbidden", "Project is not visible to this role");
      return state.kb_sources.filter((source) => source.project_id === projectId);
    },
    objectManifest(user: User, projectId: string): { version: 1; objects: ObjectRef[]; sources: KbSource[] } {
      const state = load();
      const project = state.projects.find((item) => item.id === projectId);
      if (!canSeeProject(user, project)) throw new DemoPortalError("forbidden", "Project is not visible to this role");
      const sources = state.kb_sources.filter((source) => source.project_id === projectId);
      const objectIds = new Set(sources.map((source) => source.object_ref_id));
      return {
        version: 1,
        objects: objectsFor(state, user, projectId).filter((object) => objectIds.has(object.id)),
        sources,
      };
    },
    selectProject(user: User, projectId: string): void {
      mutate((state) => {
        const project = state.projects.find((item) => item.id === projectId);
        if (!canSeeProject(user, project)) throw new DemoPortalError("forbidden", "Project is not visible to this role");
        state.selected_project_id = projectId;
      });
    },
    addQaNote(user: User, runId: string, body: string): QaNote {
      return mutate((state) => {
        if (!isStaff(user)) throw new DemoPortalError("forbidden", "Only staff can add QA notes");
        const run = requireRun(state, runId);
        const note: QaNote = {
          id: makeId("note"),
          run_id: run.id,
          author_user_id: user.id,
          body,
          created_at: nowIso(),
        };
        state.qa_notes.unshift(note);
        state.actions.unshift(action("note", user.id, run.id, "Added QA note"));
        return note;
      });
    },
    setChecklist(user: User, runId: string, itemId: string, done: boolean): DemoRun {
      return mutate((state) => {
        const run = requireVisibleRun(state, user, runId);
        const item = run.checklist.find((candidate) => candidate.id === itemId);
        if (!item || (!isStaff(user) && item.visibility === "staff")) {
          throw new DemoPortalError("not_found", "Checklist item not found");
        }
        item.done = done;
        state.actions.unshift(action("checklist", user.id, run.id, `Set ${item.label} to ${done ? "done" : "open"}`));
        return sanitizeRun(user, run);
      });
    },
    setDisposition(user: User, runId: string, disposition: DemoRun["disposition"]): DemoRun {
      return mutate((state) => {
        if (!isStaff(user)) throw new DemoPortalError("forbidden", "Only staff can triage demo runs");
        const run = requireRun(state, runId);
        run.disposition = disposition;
        state.actions.unshift(action("disposition", user.id, run.id, `Set disposition to ${disposition ?? "none"}`));
        return sanitizeRun(user, run);
      });
    },
    flagRisk(user: User, runId: string, label: string): DemoRun {
      return mutate((state) => {
        const run = requireVisibleRun(state, user, runId);
        const tag: RunRiskTag = {
          id: makeId("risk"),
          label,
          severity: isStaff(user) ? "high" : "medium",
          visibility: isStaff(user) ? "staff" : "student",
        };
        run.risk_tags.push(tag);
        state.actions.unshift(action("risk", user.id, run.id, `Flagged ${label}`));
        return sanitizeRun(user, run);
      });
    },
    replayRun(user: User, runId: string): DemoRun {
      return mutate((state) => {
        const source = requireVisibleRun(state, user, runId);
        const replay: DemoRun = {
          ...source,
          id: makeId("run"),
          title: `${source.title} replay`,
          started_at: nowIso(),
          finished_at: addMinutesIso(4),
          status: source.status === "failed" ? "passed" : source.status,
          demo_action: true,
          public_log: [
            "DEMO ACTION: replay simulated locally in vos-web.",
            source.status === "failed" ? "Public rerun now passes the selected evidence gate." : source.public_log,
          ].join("\n"),
          events: [
            {
              id: makeId("event"),
              at: nowIso(),
              type: "request",
              title: "Demo replay requested",
              summary: "No backend, runner, or model was called. The prototype added a local replay record.",
              status: "warning",
              visibility: "student",
            },
            ...source.events,
          ],
          checklist: source.checklist.map((item) => ({ ...item })),
          steps: source.steps.map((item) => ({ ...item })),
          log_lines: [
            {
              id: makeId("log"),
              step_id: "score-freeze",
              at: nowIso(),
              stream: "system",
              severity: "warning",
              message: "DEMO ACTION: replay simulated locally in vos-web. No backend, runner, or model was called.",
              visibility: "student",
            },
            ...source.log_lines.map((item) => ({ ...item })),
          ],
          artifacts: source.artifacts.map((item) => ({ ...item })),
          review: { ...source.review },
          appeal: { ...source.appeal },
          tool_calls: source.tool_calls.map((item) => ({ ...item })),
          evidence_links: source.evidence_links.map((item) => ({ ...item })),
          risk_tags: source.risk_tags.map((item) => ({ ...item })),
          disposition: "student-action",
        };
        state.runs.unshift(replay);
        state.audits.unshift({
          id: makeId("audit"),
          session_id: replay.id,
          user_id: user.id,
          project_id: replay.project_id,
          model: "local-demo",
          task_kind: "demo_replay",
          prompt_summary: `Replay ${source.title}`,
          response_summary: "Created a local replay record for classroom demonstration.",
          risk_flags: ["demo_action"],
          risk_level: "medium",
          created_at: replay.started_at,
        });
        state.actions.unshift(action("replay", user.id, source.id, "Created demo replay"));
        return sanitizeRun(user, replay);
      });
    },
    sendChat(user: User, projectId: string, content: string): ChatThread {
      return mutate((state) => {
        const project = state.projects.find((item) => item.id === projectId);
        if (!canSeeProject(user, project)) throw new DemoPortalError("forbidden", "Project is not visible to this role");
        if (!project) throw new DemoPortalError("not_found", "Project not found");
        const stage = state.stages.find((item) => item.id === project.current_stage_id);
        const thread = ensureChatThread(state, project, stage?.key ?? "current");
        const evidence = evidenceFor(state, user, project.id);
        const failing = evidence.find((item) => item.result !== "pass");
        const objects = objectsFor(state, user, project.id);
        const objectRefs = objects.slice(0, 2).map((object) => object.id);
        const created = nowIso();
        thread.messages.push({
          id: makeId("msg"),
          role: "user",
          content,
          created_at: created,
          evidence_refs: [],
          object_refs: [],
        });
        thread.messages.push({
          id: makeId("msg"),
          role: "assistant",
          content: studentAssistantReply(content, stage, failing),
          created_at: addSecondsIso(18),
          evidence_refs: failing ? [failing.id] : [],
          object_refs: objectRefs,
        });
        thread.object_refs = unique([...thread.object_refs, ...objectRefs]);
        thread.updated_at = addSecondsIso(18);
        state.audits.unshift({
          id: makeId("audit"),
          session_id: thread.id,
          user_id: user.id,
          project_id: project.id,
          model: "local-readonly-demo",
          task_kind: "knowledgebase_qa",
          prompt_summary: summarize(content),
          response_summary: "Read-only KnowledgeBaseAgent guidance generated from current stage, public evidence, and object-backed KB fixtures.",
          risk_flags: ["readonly_demo", "object_refs"],
          risk_level: "low",
          created_at: thread.updated_at,
        });
        state.actions.unshift(action("chat", user.id, thread.id, "Added read-only chat turn"));
        return { ...thread, messages: [...thread.messages] };
      });
    },
  };
}

export function createMemoryStorage(initial?: Record<string, string>): StorageLike & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

export function isStaff(user: User): boolean {
  return user.role === "admin" || user.role === "teacher" || user.role === "ta";
}

export function sanitizeRun(user: User, run: DemoRun): DemoRun {
  if (isStaff(user)) {
    return {
      ...run,
      events: [...run.events],
      tool_calls: [...run.tool_calls],
      evidence_links: [...run.evidence_links],
      risk_tags: [...run.risk_tags],
      checklist: [...run.checklist],
      steps: [...run.steps],
      log_lines: [...run.log_lines],
      artifacts: [...run.artifacts],
      review: { ...run.review },
      appeal: { ...run.appeal },
    };
  }
  return {
    ...run,
    model: "local-readonly-demo",
    profile: run.profile.includes("staff") ? "student-public-demo" : run.profile,
    staff_log: undefined,
    events: run.events.filter((event) => event.visibility === "student"),
    tool_calls: run.tool_calls.filter((tool) => tool.visibility === "student"),
    evidence_links: run.evidence_links.filter((link) => link.visibility === "student"),
    risk_tags: run.risk_tags.filter((tag) => tag.visibility === "student"),
    checklist: run.checklist.filter((item) => item.visibility === "student"),
    steps: run.steps.filter((item) => item.visibility === "student"),
    log_lines: run.log_lines.filter((item) => item.visibility === "student"),
    artifacts: run.artifacts.filter((item) => item.visibility === "student"),
    review: run.review.visibility === "student"
      ? { ...run.review }
      : { status: "pending", summary: "Staff review summary is hidden from student view.", visibility: "student" },
    appeal: { ...run.appeal },
  };
}

function createSeedState(): DemoState {
  const base = new Date("2026-06-19T09:00:00.000Z");
  const users: UserRecord[] = [
    { id: "user-teacher", username: "teacher", display_name: "Course Teacher", role: "teacher", status: "active", password: "teacher" },
    { id: "user-ta", username: "ta", display_name: "Teaching Assistant", role: "ta", status: "active", password: "ta" },
    { id: "user-student", username: "student", display_name: "Demo Student", role: "student", status: "active", password: "student" },
    { id: "user-memory", username: "memory", display_name: "Memory Track Student", role: "student", status: "active", password: "memory" },
    { id: "user-risk", username: "risk", display_name: "Risk Review Student", role: "student", status: "active", password: "risk" },
  ];
  const course: Course = {
    id: "course-vos-2026",
    code: "VOS-2026",
    name: "VeriSpecOSLab Operating Systems",
    term: "Spring 2026",
    status: "active",
    description: "Spec-first OS lab course with staged evidence and AI audit.",
  };
  const experiment: Experiment = {
    id: "experiment-xv6-spec",
    course_id: course.id,
    title: "xv6 Spec-Driven Kernel",
    description: "Progressive boot, memory, trap, resource, and syscall lab.",
    experiment_type: "os",
    publish_state: "prototype-demo",
    spec_version: "xv6-spec-demo",
  };
  const stages: StageGate[] = [
    stage(experiment.id, "stage-boot", "boot-minimum", "Boot Minimum", 0, ["spec/architecture/slices/01-boot.yaml"], [{ suite: "boot", case_name: "serial_banner_check", required_result: "pass" }], false),
    stage(experiment.id, "stage-memory", "memory-management", "Memory Management", 1, ["spec/modules/kernel/memory/module.yaml"], [
      { suite: "memory", case_name: "page_allocator_tests", required_result: "pass" },
      { suite: "memory", case_name: "kernel_pagetable_smoke", required_result: "pass" },
    ], true),
    stage(experiment.id, "stage-trap", "trap-privilege", "Trap / Privilege", 2, ["spec/architecture/slices/03-trap.yaml"], [{ suite: "trap", case_name: "invalid_user_pointer", required_result: "pass" }], true),
    stage(experiment.id, "stage-resource", "resource-and-namespace", "Resource / Namespace", 3, ["spec/architecture/slices/05-resource-namespace.yaml"], [{ suite: "resource", case_name: "fd_lifetime_contract", required_result: "pass" }], true),
    stage(experiment.id, "stage-final", "final-defense", "Final Defense", 4, ["reports/final-report.md"], [{ suite: "final", case_name: "traceability_defense", required_result: "pass" }], true),
  ];
  const projects: Project[] = [
    project("project-demo-student", "user-student", experiment.id, "stage-memory", "demo042"),
    project("project-memory-track", "user-memory", experiment.id, "stage-trap", "mem118"),
    project("project-risk-review", "user-risk", experiment.id, "stage-resource", "risk077"),
  ];
  const pipelines: PipelineRun[] = [
    pipeline("pipeline-demo-boot", "project-demo-student", "demo030", "passed", "boot-minimum", "Boot marker accepted.", 1, 0, 1, addMinutes(base, -410)),
    pipeline("pipeline-demo-memory", "project-demo-student", "demo042", "failed", "memory-management", "Allocator evidence is missing one free-list invariant.", 1, 1, 2, addMinutes(base, -40), "impl_gap"),
    pipeline("pipeline-memory-trap", "project-memory-track", "mem118", "passed", "trap-privilege", "Trap invalid pointer public check passed.", 1, 0, 1, addMinutes(base, -75)),
    pipeline("pipeline-risk-resource", "project-risk-review", "risk077", "failed", "resource-and-namespace", "Resource lifetime check failed after AI patch suggestion.", 2, 1, 3, addMinutes(base, -20), "policy_risk"),
  ];
  const evidence: EvidenceRecord[] = [
    evidenceRecord("ev-boot-banner", "project-demo-student", "pipeline-demo-boot", "test", "boot", "serial_banner_check", "pass", { serial_marker: "VOS_BOOT_OK" }, "serial: VOS_BOOT_OK"),
    evidenceRecord("ev-memory-alloc", "project-demo-student", "pipeline-demo-memory", "invariant", "memory", "page_allocator_tests", "fail", { failing_clause: "free_list_not_reused_twice", observed_pages: 126 }, "page allocator: free list reuse invariant failed"),
    evidenceRecord("ev-memory-pt", "project-demo-student", "pipeline-demo-memory", "test", "memory", "kernel_pagetable_smoke", "pass", { mapped_regions: 4 }, "pagetable smoke: pass"),
    evidenceRecord("ev-trap-invalid", "project-memory-track", "pipeline-memory-trap", "test", "trap", "invalid_user_pointer", "pass", { traps: 12 }, "trap invalid pointer: pass"),
    evidenceRecord("ev-resource-fd", "project-risk-review", "pipeline-risk-resource", "invariant", "resource", "fd_lifetime_contract", "fail", { leaked_descriptors: 2 }, "fd lifetime: leaked descriptor after close path"),
  ];
  const rubrics: EvaluationRubric[] = [
    rubric("rubric-arch", experiment.id, "Architecture and stage design", "design", 12, "ArchitectureSlice and ModuleSpec align with current stage."),
    rubric("rubric-memory", experiment.id, "Memory evidence", "evidence", 18, "Allocator and kernel pagetable evidence are both required."),
    rubric("rubric-agent", experiment.id, "AI collaboration audit", "audit", 8, "Agent usage is disclosed, scoped, and low risk."),
    rubric("rubric-final", experiment.id, "Final traceability", "report", 22, "Final defense links design, code, and verification evidence."),
  ];
  const scores: ScoreItem[] = [
    { id: "score-demo-arch", project_id: "project-demo-student", rubric_id: "rubric-arch", auto_score: 10, manual_score: 11, feedback: "Good stage mapping.", is_final: false },
    { id: "score-demo-memory", project_id: "project-demo-student", rubric_id: "rubric-memory", auto_score: 9, feedback: "One allocator invariant still failing.", is_final: false },
    { id: "score-memory-arch", project_id: "project-memory-track", rubric_id: "rubric-arch", auto_score: 12, is_final: true },
    { id: "score-risk-agent", project_id: "project-risk-review", rubric_id: "rubric-agent", auto_score: 3, feedback: "Needs staff review for broad patch request.", is_final: false },
  ];
  const submissions: DesignSubmission[] = [
    { id: "submission-demo-memory", project_id: "project-demo-student", stage_gate_id: "stage-memory", commit_sha: "demo042", artifact_ref: "spec/evolution/patch-002-memory.yaml", review_status: "pending" },
    { id: "submission-memory-trap", project_id: "project-memory-track", stage_gate_id: "stage-trap", commit_sha: "mem118", artifact_ref: "spec/architecture/slices/03-trap.yaml", review_status: "approved", reviewer_user_id: "user-ta", feedback: "Clear privilege boundary notes." },
    { id: "submission-risk-resource", project_id: "project-risk-review", stage_gate_id: "stage-resource", commit_sha: "risk077", artifact_ref: "spec/architecture/slices/05-resource-namespace.yaml", review_status: "needs_changes", feedback: "Clarify fd ownership transfer." },
  ];
  const runs: DemoRun[] = [
    demoRun({
      id: "run-demo-memory-debug",
      projectId: "project-demo-student",
      stageKey: "memory-management",
      title: "Memory public failure triage",
      kind: "agent",
      profile: "debug-agent.student-public",
      model: "local-demo",
      status: "failed",
      startedAt: addMinutes(base, -32),
      finishedAt: addMinutes(base, -29),
      publicLog: "page allocator: free list reuse invariant failed\nhint: inspect kfree/kalloc balance around stress_alloc",
      staffLog: "Staff-only demo note: hidden stress summary agrees with public free-list diagnosis; no hidden body exposed.",
      nextSteps: ["Open spec/modules/kernel/memory/module.yaml", "Check allocator ownership invariant", "Run vos verify public --stage memory-management"],
      riskTags: [{ id: "risk-demo-readonly", label: "readonly_demo", severity: "low", visibility: "student" }],
      evidenceLinks: [{ id: "link-memory-alloc", evidence_id: "ev-memory-alloc", suite: "memory", case_name: "page_allocator_tests", result: "fail", summary: "Missing allocator invariant.", visibility: "student" }],
      events: [
        event("request", "Student debug request", "Bound to project-demo-student and memory-management.", "passed", "student", addMinutes(base, -32)),
        event("context", "Public context projection", "Stage gate, required artifacts, and public evidence summaries loaded.", "passed", "student", addMinutes(base, -31)),
        event("tool", "Read-only evidence lookup", "Evidence fixture ev-memory-alloc selected for explanation.", "passed", "student", addMinutes(base, -30)),
        event("risk", "Policy guard", "No writes, hidden tests, or cross-project context were exposed.", "passed", "student", addMinutes(base, -30)),
        event("decision", "Staff review marker", "TA can inspect this failure as impl_gap before approving stage unlock.", "warning", "staff", addMinutes(base, -29)),
      ],
      tools: [
        tool("Vos", { command: "verify public --stage memory-management" }, "completed", "Public verify summary read from demo fixture.", "student"),
        tool("Read", { path: "spec/modules/kernel/memory/module.yaml" }, "completed", "Spec path projected as readable.", "student"),
        tool("HiddenEvidenceStore", { suite: "memory" }, "blocked", "Blocked for student view; staff only sees summary.", "staff"),
      ],
    }),
    demoRun({
      id: "run-memory-trap-review",
      projectId: "project-memory-track",
      stageKey: "trap-privilege",
      title: "Trap design review",
      kind: "review",
      profile: "spec-validator.staff-review",
      model: "local-demo",
      status: "passed",
      startedAt: addMinutes(base, -84),
      finishedAt: addMinutes(base, -78),
      publicLog: "trap invalid pointer: pass\nreview: ArchitectureSlice mentions user pointer fault path.",
      staffLog: "Rubric mapping: full score candidate for trap evidence.",
      nextSteps: ["Approve stage review", "Ask student to link trapframe invariant in final report"],
      riskTags: [{ id: "risk-trap-clear", label: "clear_scope", severity: "low", visibility: "student" }],
      evidenceLinks: [{ id: "link-trap-invalid", evidence_id: "ev-trap-invalid", suite: "trap", case_name: "invalid_user_pointer", result: "pass", summary: "Trap public check passed.", visibility: "student" }],
      events: [
        event("request", "TA review request", "Review queue item submission-memory-trap opened.", "passed", "staff", addMinutes(base, -84)),
        event("evidence", "Evidence matched", "trap/invalid_user_pointer linked to rubric evidence target.", "passed", "student", addMinutes(base, -82)),
        event("decision", "Stage can unlock", "Manual review is approved in the demo queue.", "passed", "staff", addMinutes(base, -78)),
      ],
      tools: [tool("Read", { path: "spec/architecture/slices/03-trap.yaml" }, "completed", "Reviewed trap slice summary.", "staff")],
    }),
    demoRun({
      id: "run-risk-resource-audit",
      projectId: "project-risk-review",
      stageKey: "resource-and-namespace",
      title: "Resource lifetime QA escalation",
      kind: "agent",
      profile: "debug-agent.staff-full",
      model: "local-demo",
      status: "failed",
      startedAt: addMinutes(base, -22),
      finishedAt: addMinutes(base, -18),
      publicLog: "fd lifetime: leaked descriptor after close path\nstudent-visible hint: verify ownership transfer in namespace module spec.",
      staffLog: "Staff demo summary: agent requested broad patch before running the final public command. Escalation recommended.",
      nextSteps: ["Return design submission with ownership note", "Ask student to rerun public verify", "Teacher reviews AI scope before final score"],
      riskTags: [
        { id: "risk-large-patch", label: "large_patch_proposal", severity: "high", visibility: "staff" },
        { id: "risk-no-test", label: "suggested_patch_before_verify", severity: "medium", visibility: "staff" },
        { id: "risk-student-visible", label: "needs_scope_review", severity: "medium", visibility: "student" },
      ],
      evidenceLinks: [{ id: "link-resource-fd", evidence_id: "ev-resource-fd", suite: "resource", case_name: "fd_lifetime_contract", result: "fail", summary: "FD lifetime invariant failed.", visibility: "student" }],
      events: [
        event("request", "Failure triage requested", "Bound to resource-and-namespace stage.", "passed", "student", addMinutes(base, -22)),
        event("profile", "Staff profile selected", "staff-full profile is visible only to TA/teacher.", "warning", "staff", addMinutes(base, -21)),
        event("tool", "Patch proposal blocked", "Demo policy blocks broad code generation during QA triage.", "failed", "staff", addMinutes(base, -20)),
        event("risk", "Escalation candidate", "High risk tag added for teacher review.", "warning", "staff", addMinutes(base, -18)),
      ],
      tools: [
        tool("Task", { task: "draft broad patch" }, "blocked", "Blocked by demo QA policy.", "staff"),
        tool("Vos", { command: "verify public --stage resource-and-namespace" }, "completed", "Public summary collected.", "student"),
      ],
      disposition: "escalated",
    }),
  ];
  const audits: AgentAuditRecord[] = [
    audit("audit-demo-memory", "run-demo-memory-debug", "user-student", "project-demo-student", "knowledgebase_qa", "Explain memory allocator failure", "Suggested spec-first allocator invariant check.", ["readonly_demo"], "low", addMinutes(base, -29)),
    audit("audit-risk-resource", "run-risk-resource-audit", "user-risk", "project-risk-review", "failure_triage", "Debug resource failure", "Escalated because broad patch was suggested before verification.", ["large_patch_proposal"], "high", addMinutes(base, -18)),
  ];
  const chat_threads: ChatThread[] = [
    {
      id: "chat-project-demo-student",
      project_id: "project-demo-student",
      stage_key: "memory-management",
      title: "Memory stage helper",
      updated_at: addMinutes(base, -10),
      messages: [
        { id: "msg-seed-1", role: "system", content: "Standalone demo chat. No backend, model, runner, or file write is executed.", created_at: addMinutes(base, -12), evidence_refs: [], object_refs: [] },
        { id: "msg-seed-2", role: "assistant", content: "For Memory Management, start by aligning the allocator invariant in the ModuleSpec, then rerun `vos verify public --stage memory-management`.", created_at: addMinutes(base, -10), evidence_refs: ["ev-memory-alloc"], object_refs: ["obj-memory-manual"] },
      ],
      object_refs: ["obj-memory-manual"],
    },
  ];
  return {
    users,
    courses: [course],
    experiments: [experiment],
    stages,
    projects,
    submissions,
    pipelines,
    evidence,
    rubrics,
    scores,
    audits,
    runs,
    qa_notes: [{ id: "note-risk-1", run_id: "run-risk-resource-audit", author_user_id: "user-ta", body: "Demo note: use this row to show escalation without exposing hidden test bodies.", created_at: addMinutes(base, -12) }],
    chat_threads,
    objects: [
      objectRef("obj-memory-manual", "project-demo-student", "course/memory-manual.md", "Memory lab manual", 4096),
      objectRef("obj-memory-spec", "project-demo-student", "spec/memory-stage.yaml", "Memory stage spec snapshot", 2048),
      objectRef("obj-trap-manual", "project-memory-track", "course/trap-manual.md", "Trap lab manual", 3072),
      objectRef("obj-resource-ref", "project-risk-review", "external/fd-lifetime.md", "FD lifetime reference snapshot", 1536),
    ],
    kb_sources: [
      kbSource("kb-memory-manual", "project-demo-student", "course", "Memory lab manual", "obj-memory-manual", "memory-management"),
      kbSource("kb-memory-spec", "project-demo-student", "project", "Memory stage spec snapshot", "obj-memory-spec", "memory-management"),
      kbSource("kb-trap-manual", "project-memory-track", "course", "Trap lab manual", "obj-trap-manual", "trap-privilege"),
      kbSource("kb-resource-ref", "project-risk-review", "external", "FD lifetime reference snapshot", "obj-resource-ref", "syscall-surface"),
    ],
    actions: [],
  };
}

function mergeSeed(value: Partial<DemoState>): DemoState {
  const seed = createSeedState();
  return {
    ...seed,
    ...value,
    users: seed.users,
    courses: seed.courses,
    experiments: seed.experiments,
    stages: seed.stages,
    projects: seed.projects,
    submissions: value.submissions ?? seed.submissions,
    pipelines: seed.pipelines,
    evidence: seed.evidence,
    rubrics: seed.rubrics,
    scores: value.scores ?? seed.scores,
    audits: value.audits ?? seed.audits,
    runs: value.runs ?? seed.runs,
    qa_notes: value.qa_notes ?? seed.qa_notes,
    chat_threads: value.chat_threads ?? seed.chat_threads,
    objects: value.objects ?? seed.objects,
    kb_sources: value.kb_sources ?? seed.kb_sources,
    actions: value.actions ?? seed.actions,
  };
}

function publicUser(user: UserRecord): User {
  const { password: _password, ...safe } = user;
  return safe;
}

function canSeeProject(user: User | UserRecord | undefined, project: Project | undefined): boolean {
  if (!user || !project) return false;
  return isStaff(user) || project.student_user_id === user.id;
}

function canSeeRun(user: User, state: DemoState, run: DemoRun): boolean {
  return canSeeProject(user, state.projects.find((project) => project.id === run.project_id));
}

function visibleProjects(state: DemoState, user: User): Project[] {
  return state.projects.filter((project) => canSeeProject(user, project));
}

function firstVisibleProject(state: DemoState, user: User | UserRecord | undefined): Project | undefined {
  if (!user) return undefined;
  return state.projects.find((project) => canSeeProject(user, project));
}

function projectOverview(state: DemoState, project: Project): ProjectOverview {
  return {
    project,
    current_stage: requireStage(state, project.current_stage_id),
    latest_pipeline: latestPipeline(state, project.id),
    score_summary: scoreSummary(state, project),
  };
}

function stageProgress(state: DemoState, user: User, projectId: string): StageProgress {
  const project = state.projects.find((item) => item.id === projectId);
  if (!canSeeProject(user, project) || !project) throw new DemoPortalError("forbidden", "Project is not visible to this role");
  const currentStage = requireStage(state, project.current_stage_id);
  return {
    current_stage: currentStage,
    stages: stagesFor(state, project.experiment_id).map((stageItem) => {
      const missing = missingEvidence(stageItem, evidenceFor(state, user, project.id));
      const submission = state.submissions.find((item) => item.project_id === project.id && item.stage_gate_id === stageItem.id);
      return {
        stage: stageItem,
        unlocked: stageItem.sequence <= currentStage.sequence,
        passed: missing.length === 0 && (!stageItem.config.manual_review_required || submission?.review_status === "approved"),
        missing_evidence: missing,
        ...(submission?.review_status ? { manual_review_status: submission.review_status } : {}),
      };
    }),
  };
}

function evidenceFor(state: DemoState, user: User, projectId: string): EvidenceRecord[] {
  const project = state.projects.find((item) => item.id === projectId);
  if (!canSeeProject(user, project)) return [];
  return state.evidence.filter((item) => item.project_id === projectId);
}

function scoresFor(state: DemoState, user: User, projectId: string): ScoreItem[] {
  const project = state.projects.find((item) => item.id === projectId);
  if (!canSeeProject(user, project)) return [];
  return state.scores.filter((item) => item.project_id === projectId);
}

function auditsFor(state: DemoState, user: User, projectId: string): AgentAuditRecord[] {
  const project = state.projects.find((item) => item.id === projectId);
  if (!canSeeProject(user, project)) return [];
  return state.audits
    .filter((item) => item.project_id === projectId)
    .map((item) => isStaff(user) ? item : {
      ...item,
      model: "local-readonly-demo",
      risk_flags: item.risk_flags.filter((flag) => !flag.includes("large_patch")),
      risk_level: item.risk_level === "high" || item.risk_level === "critical" ? "medium" : item.risk_level,
    })
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function teacherRows(state: DemoState, experimentId: string): TeacherProjectRow[] {
  return state.projects
    .filter((projectItem) => projectItem.experiment_id === experimentId)
    .map((projectItem) => {
      const student = state.users.find((user) => user.id === projectItem.student_user_id);
      return {
        project: projectItem,
        student: student ? publicUser(student) : { id: "missing", username: "missing", display_name: "Missing", role: "student" },
        current_stage: requireStage(state, projectItem.current_stage_id),
        latest_pipeline: latestPipeline(state, projectItem.id),
        score_summary: scoreSummary(state, projectItem),
        risk_flags: unique(state.runs
          .filter((run) => run.project_id === projectItem.id)
          .flatMap((run) => run.risk_tags.map((tag) => tag.label))),
      };
    });
}

function chatThreadFor(state: DemoState, projectId: string): ChatThread | undefined {
  return state.chat_threads.find((thread) => thread.project_id === projectId);
}

function objectsFor(state: DemoState, user: User, projectId: string): ObjectRef[] {
  const project = state.projects.find((item) => item.id === projectId);
  if (!canSeeProject(user, project)) return [];
  return state.objects.filter((object) => object.project_id === projectId && (isStaff(user) || object.visibility === "student"));
}

function ensureChatThread(state: DemoState, project: Project, stageKey: string): ChatThread {
  const existing = chatThreadFor(state, project.id);
  if (existing) return existing;
  const thread: ChatThread = {
    id: `chat-${project.id}`,
    project_id: project.id,
    stage_key: stageKey,
    title: `${stageKey} helper`,
    messages: [{
      id: makeId("msg"),
      role: "system",
      content: "Standalone demo chat. No backend, model, runner, or file write is executed.",
      created_at: nowIso(),
      evidence_refs: [],
      object_refs: [],
    }],
    object_refs: [],
    updated_at: nowIso(),
  };
  state.chat_threads.push(thread);
  return thread;
}

function stagesFor(state: DemoState, experimentId: string): StageGate[] {
  return state.stages
    .filter((item) => item.experiment_id === experimentId)
    .sort((left, right) => left.sequence - right.sequence);
}

function requireStage(state: DemoState, stageId: string): StageGate {
  const stageItem = state.stages.find((item) => item.id === stageId);
  if (!stageItem) throw new DemoPortalError("not_found", `Stage ${stageId} not found`);
  return stageItem;
}

function requireRun(state: DemoState, runId: string): DemoRun {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) throw new DemoPortalError("not_found", `Run ${runId} not found`);
  return run;
}

function requireVisibleRun(state: DemoState, user: User, runId: string): DemoRun {
  const run = requireRun(state, runId);
  if (!canSeeRun(user, state, run)) throw new DemoPortalError("forbidden", "Run is not visible to this role");
  return run;
}

function latestPipeline(state: DemoState, projectId: string): PipelineRun | undefined {
  return state.pipelines
    .filter((item) => item.project_id === projectId)
    .sort((left, right) => left.started_at.localeCompare(right.started_at))
    .at(-1);
}

function scoreSummary(state: DemoState, projectItem: Project): ScoreSummary {
  const possible = state.rubrics
    .filter((rubricItem) => rubricItem.experiment_id === projectItem.experiment_id)
    .reduce((sum, rubricItem) => sum + rubricItem.weight, 0);
  const earned = state.scores
    .filter((score) => score.project_id === projectItem.id)
    .reduce((sum, score) => sum + (score.manual_score ?? score.auto_score), 0);
  const scores = state.scores.filter((score) => score.project_id === projectItem.id);
  return {
    earned,
    possible,
    finalized: scores.length > 0 && scores.every((score) => score.is_final),
  };
}

function missingEvidence(stageItem: StageGate, records: EvidenceRecord[]): EvidenceRequirement[] {
  return stageItem.config.required_evidence.filter((requirement) =>
    !records.some((record) =>
      record.suite === requirement.suite &&
      record.case_name === requirement.case_name &&
      record.result === requirement.required_result
    )
  );
}

function studentAssistantReply(input: string, stageItem: StageGate | undefined, failing: EvidenceRecord | undefined): string {
  const stageName = stageItem?.name ?? "current stage";
  const artifact = stageItem?.config.required_artifacts[0] ?? "the current stage spec";
  const failure = failing
    ? `The public evidence fixture still points at ${failing.suite}/${failing.case_name}: ${failing.log_segment ?? failing.result}.`
    : "The current public evidence fixture has no failing record selected.";
  const focus = input.toLowerCase().includes("command")
    ? "Suggested read-only command: `vos verify public --stage current`. In this demo chat, I only recommend it; I do not run it."
    : "Start with the spec clause, then make a small implementation change, then run public verification yourself.";
  return [
    `For ${stageName}, stay inside the public stage projection and update ${artifact}.`,
    failure,
    focus,
    "No hidden tests, staff rubric details, file writes, or backend model calls are used in this prototype reply.",
  ].join("\n\n");
}

function stage(
  experimentId: string,
  idValue: string,
  key: string,
  name: string,
  sequence: number,
  artifacts: string[],
  requirements: EvidenceRequirement[],
  manual: boolean,
): StageGate {
  return {
    id: idValue,
    experiment_id: experimentId,
    key,
    name,
    sequence,
    gate_type: "hybrid",
    status: "active",
    config: {
      required_artifacts: artifacts,
      required_evidence: requirements,
      manual_review_required: manual,
      visibility_scope: "student-public",
    },
  };
}

function project(idValue: string, studentId: string, experimentId: string, stageId: string, sha: string): Project {
  return {
    id: idValue,
    student_user_id: studentId,
    experiment_id: experimentId,
    repo_url: `https://git.local/vos/${idValue}.git`,
    current_stage_id: stageId,
    status: "active",
    last_commit_sha: sha,
  };
}

function pipeline(
  idValue: string,
  projectId: string,
  sha: string,
  status: PipelineStatus,
  stageScope: string,
  message: string,
  passed: number,
  failed: number,
  total: number,
  startedAt: string,
  failureClass?: string,
): PipelineRun {
  return {
    id: idValue,
    project_id: projectId,
    commit_sha: sha,
    trigger_type: "demo",
    status,
    stage_scope: stageScope,
    started_at: startedAt,
    finished_at: addMinutesIso(6, startedAt),
    public_summary: {
      status,
      passed,
      failed,
      total,
      failure_class: failureClass,
      message,
    },
  };
}

function evidenceRecord(
  idValue: string,
  projectId: string,
  pipelineId: string,
  kind: string,
  suite: string,
  caseName: string,
  result: EvidenceResult,
  metrics: Record<string, unknown>,
  log: string,
): EvidenceRecord {
  return {
    id: idValue,
    project_id: projectId,
    pipeline_run_id: pipelineId,
    kind,
    suite,
    case_name: caseName,
    result,
    metrics,
    log_segment: log,
    artifact_uri: `demo://evidence/${idValue}.json`,
  };
}

function objectRef(idValue: string, projectId: string, key: string, label: string, size: number): ObjectRef {
  return {
    id: idValue,
    project_id: projectId,
    uri: `s3://vos-demo/${key}`,
    sha256: `${idValue.replace(/[^a-z0-9]/g, "")}`.padEnd(64, "0").slice(0, 64),
    content_type: key.endsWith(".md") ? "text/markdown" : "application/yaml",
    size,
    visibility: "student",
    label,
  };
}

function kbSource(
  idValue: string,
  projectId: string,
  sourceKind: KbSource["source_kind"],
  title: string,
  objectRefId: string,
  stageScope: string,
): KbSource {
  return {
    id: idValue,
    project_id: projectId,
    source_kind: sourceKind,
    title,
    object_ref_id: objectRefId,
    stage_scope: stageScope,
  };
}

function rubric(idValue: string, experimentId: string, name: string, target: string, weight: number, description: string): EvaluationRubric {
  return {
    id: idValue,
    experiment_id: experimentId,
    name,
    status: "active",
    target_kind: target,
    weight,
    description,
  };
}

function audit(
  idValue: string,
  sessionId: string,
  userId: string,
  projectId: string,
  taskKind: string,
  prompt: string,
  response: string,
  risks: string[],
  level: RunRiskSeverity,
  createdAt: string,
): AgentAuditRecord {
  return {
    id: idValue,
    session_id: sessionId,
    user_id: userId,
    project_id: projectId,
    model: "local-demo",
    task_kind: taskKind,
    prompt_summary: prompt,
    response_summary: response,
    risk_flags: risks,
    risk_level: level,
    created_at: createdAt,
  };
}

function demoRun(input: {
  id: string;
  projectId: string;
  stageKey: string;
  title: string;
  kind: DemoRun["kind"];
  profile: string;
  model: string;
  status: PipelineStatus;
  startedAt: string;
  finishedAt: string;
  publicLog: string;
  staffLog?: string;
  nextSteps: string[];
  riskTags: RunRiskTag[];
  evidenceLinks: RunEvidenceLink[];
  events: RunEvent[];
  tools: RunToolCall[];
  disposition?: DemoRun["disposition"];
}): DemoRun {
  const steps = fullChainSteps(input.startedAt, input.status, input.stageKey);
  const logLines = fullChainLogs(input.startedAt, input.status, input.publicLog, input.staffLog);
  return {
    id: input.id,
    project_id: input.projectId,
    stage_key: input.stageKey,
    title: input.title,
    kind: input.kind,
    profile: input.profile,
    model: input.model,
    status: input.status,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    demo_action: true,
    request_context: [
      `project:${input.projectId}`,
      `stage:${input.stageKey}`,
      "visibility:student-public",
      "runtime:frontend-localStorage",
    ],
    public_log: input.publicLog,
    staff_log: input.staffLog,
    next_steps: input.nextSteps,
    events: input.events,
    tool_calls: input.tools,
    evidence_links: input.evidenceLinks,
    risk_tags: input.riskTags,
    checklist: [
      { id: "check-context", label: "Context projection reviewed", done: true, visibility: "student" },
      { id: "check-public-log", label: "Public log mapped to evidence", done: input.status === "passed", visibility: "student" },
      { id: "check-staff-risk", label: "Staff risk tags reviewed", done: input.disposition === "escalated", visibility: "staff" },
      { id: "check-next-step", label: "Next action is clear", done: input.status === "passed", visibility: "student" },
    ],
    steps,
    log_lines: logLines,
    artifacts: [
      { id: `${input.id}-artifact-spec`, label: "Submitted spec patch", kind: "spec", uri: `demo://spec/${input.projectId}/${input.stageKey}.yaml`, visibility: "student" },
      { id: `${input.id}-artifact-public-log`, label: "Public verification log", kind: "log", uri: `demo://logs/${input.id}/public.log`, visibility: "student" },
      { id: `${input.id}-artifact-evidence`, label: "Evidence report", kind: "evidence", uri: `demo://evidence/${input.id}.json`, visibility: "student" },
      { id: `${input.id}-artifact-staff`, label: "Staff QA summary", kind: "audit", uri: `demo://staff/${input.id}/qa.json`, visibility: "staff" },
    ],
    review: {
      status: input.status === "passed" ? "approved" : input.disposition === "escalated" ? "escalated" : "pending",
      reviewer: input.disposition === "escalated" ? "Course Teacher" : "Teaching Assistant",
      summary: input.status === "passed"
        ? "Review can approve the stage after evidence mapping."
        : "Review should return targeted feedback before unlock.",
      visibility: input.disposition === "escalated" ? "staff" : "student",
    },
    appeal: {
      status: input.status === "passed" ? "closed" : "not_open",
      window: "Opens after score freeze",
      summary: "Appeals are visible after the final snapshot is frozen and published.",
    },
    disposition: input.disposition ?? "untriaged",
  };
}

function fullChainSteps(startedAt: string, status: PipelineStatus, stageKey: string): RunStep[] {
  const failed = status === "failed";
  const stepSpecs: Array<[RunStep["id"], RunStep["label"], RunStep["phase"], RunStep["status"], number, number, string]> = [
    ["submit", "Submit commit", "submit", "passed", 0, 1, `Commit accepted for ${stageKey}.`],
    ["spec-lint", "Spec lint", "spec", "passed", 1, 2, "ArchitectureSlice and ModuleSpec parsed."],
    ["arch-lint", "Architecture lint", "spec", "passed", 2, 2, "Stage boundaries and non-goals are explicit."],
    ["build", "Kernel build", "build", "passed", 3, 4, "xv6 demo build completed."],
    ["qemu", "QEMU smoke", "qemu", "passed", 4, 5, "Boot smoke reached serial marker."],
    ["public-verify", "Public verification", "verify", failed ? "failed" : "passed", 5, 7, failed ? "One public evidence requirement failed." : "All public checks passed."],
    ["evidence-ingest", "Evidence ingest", "evidence", failed ? "warning" : "passed", 7, 8, "Evidence report attached to submission."],
    ["agent-assist", "AI assist audit", "agent", "warning", 8, 9, "Readonly AI context and risk summary recorded."],
    ["ta-review", "TA review", "review", failed ? "warning" : "passed", 9, 12, failed ? "TA feedback required before unlock." : "Stage review can be approved."],
    ["score-freeze", "Score freeze", "score", failed ? "skipped" : "passed", 12, 14, failed ? "Freeze waits for passing evidence." : "Score snapshot ready for publication."],
    ["appeal-retro", "Appeal / retro", "appeal", "skipped", 14, 15, "Appeal window opens after final publication."],
  ];
  return stepSpecs.map(([idValue, label, phase, stepStatus, startOffset, endOffset, summary]) => ({
    id: idValue,
    label,
    phase,
    status: stepStatus,
    started_at: addMinutesIso(startOffset, startedAt),
    finished_at: addMinutesIso(endOffset, startedAt),
    points: stepStatus === "passed" ? 1 : stepStatus === "failed" ? 0 : undefined,
    possible: phase === "appeal" ? undefined : 1,
    summary,
    visibility: idValue === "score-freeze" || idValue === "ta-review" ? "staff" : "student",
  }));
}

function fullChainLogs(startedAt: string, status: PipelineStatus, publicLog: string, staffLog?: string): RunLogLine[] {
  const failed = status === "failed";
  const rows: Array<[string, RunLogLine["stream"], RunLogLine["severity"], number, string, RunEventVisibility]> = [
    ["submit", "system", "info", 0, "Submission received from Git push and attached to the active lab.", "student"],
    ["submit", "system", "success", 1, "Repository, student, lab, stage, and commit SHA resolved.", "student"],
    ["spec-lint", "stdout", "success", 2, "vos spec lint completed with no schema errors.", "student"],
    ["arch-lint", "stdout", "success", 3, "vos arch lint accepted stage scope and declared non-goals.", "student"],
    ["build", "stdout", "success", 4, "Kernel build finished for demo target xv6-spec.", "student"],
    ["qemu", "stdout", "success", 5, "QEMU smoke reached serial output marker.", "student"],
    ["public-verify", failed ? "stderr" : "stdout", failed ? "error" : "success", 6, publicLog, "student"],
    ["evidence-ingest", "system", failed ? "warning" : "success", 7, "Evidence JSON parsed and mapped to rubric targets.", "student"],
    ["agent-assist", "agent", "warning", 8, "AI assistant context projection recorded; no hidden tests or file writes used.", "student"],
    ["ta-review", "review", failed ? "warning" : "success", 9, failed ? "TA review should return targeted remediation before unlock." : "TA review can approve stage unlock.", "staff"],
    ["score-freeze", "system", failed ? "warning" : "success", 10, failed ? "Score freeze skipped until passing evidence is available." : "Score snapshot can be frozen for release.", "staff"],
    ["appeal-retro", "system", "info", 11, "Appeal and retrospective records are prepared for final publication.", "student"],
  ];
  if (staffLog) {
    rows.push(["ta-review", "review", "warning", 12, staffLog, "staff"]);
  }
  return rows.map(([stepId, stream, severity, offset, message, visibility]) => ({
    id: makeId("log"),
    step_id: stepId,
    at: addMinutesIso(offset, startedAt),
    stream,
    severity,
    message,
    visibility,
  }));
}

function event(
  type: RunEvent["type"],
  title: string,
  summary: string,
  status: RunEvent["status"],
  visibility: RunEventVisibility,
  at: string,
): RunEvent {
  return {
    id: makeId("event"),
    at,
    type,
    title,
    summary,
    status,
    visibility,
  };
}

function tool(
  name: string,
  args: Record<string, unknown>,
  status: RunToolCall["status"],
  summary: string,
  visibility: RunEventVisibility,
): RunToolCall {
  return {
    id: makeId("tool"),
    name,
    args,
    status,
    summary,
    visibility,
  };
}

function action(kind: DemoAction["kind"], actor: string, target: string, label: string): DemoAction {
  return {
    id: makeId("action"),
    label,
    created_at: nowIso(),
    actor_user_id: actor,
    target_id: target,
    kind,
  };
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function summarize(value: string): string {
  return value.length > 140 ? `${value.slice(0, 137)}...` : value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function addMinutes(date: Date, minutes: number): string {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

function addMinutesIso(minutes: number, iso = nowIso()): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function addSecondsIso(seconds: number, iso = nowIso()): string {
  return new Date(new Date(iso).getTime() + seconds * 1_000).toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
