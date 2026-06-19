import { randomUUID } from "node:crypto";

export type UserRole = "admin" | "teacher" | "ta" | "student";
export type PipelineStatus = "queued" | "running" | "passed" | "failed" | "cancelled" | "timed_out";
export type EvidenceResult = "pass" | "fail" | "error" | "skipped";

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
  risk_level: "low" | "medium" | "high" | "critical";
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

interface PortalData {
  users: UserRecord[];
  tokens: Map<string, string>;
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
}

export class PortalApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly type = "portal_error",
  ) {
    super(message);
  }
}

export class PortalStore {
  constructor(private readonly data: PortalData) {}

  authenticate(username: string, password: string): { token: string; user: User } {
    const user = this.data.users.find((candidate) => candidate.username === username);
    if (!user || user.password !== password) {
      throw new PortalApiError(401, "unauthorized", "unauthorized");
    }
    const token = `demo-${user.username}-${randomUUID()}`;
    this.data.tokens.set(token, user.id);
    return { token, user: publicUser(user) };
  }

  userForToken(token: string): User {
    const userId = this.data.tokens.get(token);
    const user = userId ? this.userById(userId) : undefined;
    if (!user) throw new PortalApiError(401, "unauthorized", "unauthorized");
    return publicUser(user);
  }

  revokeToken(token: string): void {
    this.data.tokens.delete(token);
  }

  listUsers(actor: User): User[] {
    requireStaff(actor);
    return this.data.users.map(publicUser);
  }

  listCourses(): Course[] {
    return sorted(this.data.courses, (course) => course.code);
  }

  createCourse(actor: User, body: JsonObject): Course {
    requireStaff(actor);
    const code = requiredString(body, "code");
    if (this.data.courses.some((course) => course.code === code)) {
      throw new PortalApiError(409, `course code ${code} already exists`, "conflict");
    }
    const course: Course = {
      id: id("course"),
      code,
      name: requiredString(body, "name"),
      term: requiredString(body, "term"),
      description: optionalString(body, "description"),
      status: "draft",
    };
    this.data.courses.push(course);
    return course;
  }

  deleteCourse(actor: User, idValue: string): void {
    requireStaff(actor);
    this.data.courses = removeById(this.data.courses, idValue, "course");
  }

  listExperiments(courseId?: string): Experiment[] {
    return sorted(
      this.data.experiments.filter((experiment) => !courseId || experiment.course_id === courseId),
      (experiment) => experiment.title,
    );
  }

  createExperiment(actor: User, body: JsonObject): Experiment {
    requireStaff(actor);
    const courseId = requiredString(body, "course_id");
    this.requireCourse(courseId);
    const experiment: Experiment = {
      id: id("experiment"),
      course_id: courseId,
      title: requiredString(body, "title"),
      description: optionalString(body, "description"),
      experiment_type: optionalString(body, "experiment_type") ?? "os",
      publish_state: optionalString(body, "publish_state") ?? "draft",
      spec_version: optionalString(body, "spec_version") ?? "draft",
    };
    this.data.experiments.push(experiment);
    return experiment;
  }

  deleteExperiment(actor: User, idValue: string): void {
    requireStaff(actor);
    this.data.experiments = removeById(this.data.experiments, idValue, "experiment");
  }

  listStageGates(experimentId: string): StageGate[] {
    this.requireExperiment(experimentId);
    return sorted(
      this.data.stages.filter((stage) => stage.experiment_id === experimentId),
      (stage) => stage.sequence,
    );
  }

  createStageGate(actor: User, experimentId: string, body: JsonObject): StageGate {
    requireStaff(actor);
    this.requireExperiment(experimentId);
    const config = normalizeStageConfig(asObject(body.config) ?? {});
    const stage: StageGate = {
      id: id("stage"),
      experiment_id: experimentId,
      key: requiredString(body, "key"),
      name: requiredString(body, "name"),
      sequence: numberValue(body, "sequence", 0),
      gate_type: optionalString(body, "gate_type") ?? "hybrid",
      status: "draft",
      config,
    };
    this.data.stages.push(stage);
    return stage;
  }

  deleteStageGate(actor: User, idValue: string): void {
    requireStaff(actor);
    this.data.stages = removeById(this.data.stages, idValue, "stage");
  }

  listProjectOverviews(actor: User): ProjectOverview[] {
    return this.visibleProjects(actor).map((project) => this.projectOverview(actor, project.id));
  }

  createProject(actor: User, body: JsonObject): Project {
    requireStaff(actor);
    const experimentId = requiredString(body, "experiment_id");
    const studentId = requiredString(body, "student_user_id");
    this.requireExperiment(experimentId);
    this.requireUser(studentId);
    const firstStage = this.firstStageForExperiment(experimentId);
    const project: Project = {
      id: id("project"),
      student_user_id: studentId,
      experiment_id: experimentId,
      repo_url: optionalString(body, "repo_url"),
      current_stage_id: firstStage.id,
      status: "provisioning",
    };
    this.data.projects.push(project);
    return project;
  }

  deleteProject(actor: User, idValue: string): void {
    requireStaff(actor);
    this.data.projects = removeById(this.data.projects, idValue, "project");
  }

  projectOverview(actor: User, projectId: string): ProjectOverview {
    const project = this.requireProject(projectId);
    requireProjectAccess(actor, project);
    const currentStage = this.requireStage(project.current_stage_id);
    return {
      project,
      current_stage: currentStage,
      latest_pipeline: this.latestPipeline(project.id),
      score_summary: this.scoreSummary(project),
    };
  }

  stageProgress(actor: User, projectId: string): StageProgress {
    const project = this.requireProject(projectId);
    requireProjectAccess(actor, project);
    const currentStage = this.requireStage(project.current_stage_id);
    const stages = this.listStageGates(project.experiment_id);
    return {
      current_stage: currentStage,
      stages: stages.map((stage) => {
        const missing = missingEvidence(stage, this.evidenceForProject(project.id));
        const latestSubmission = this.latestSubmission(project.id, stage.id);
        const manualStatus = latestSubmission?.review_status;
        return {
          stage,
          unlocked: stage.sequence <= currentStage.sequence,
          passed: missing.length === 0 && (!stage.config.manual_review_required || manualStatus === "approved"),
          missing_evidence: missing,
          ...(manualStatus ? { manual_review_status: manualStatus } : {}),
        };
      }),
    };
  }

  evidenceFor(actor: User, projectId: string): EvidenceRecord[] {
    const project = this.requireProject(projectId);
    requireProjectAccess(actor, project);
    return this.evidenceForProject(projectId);
  }

  scoresFor(actor: User, projectId: string): ScoreItem[] {
    const project = this.requireProject(projectId);
    requireProjectAccess(actor, project);
    return this.data.scores.filter((score) => score.project_id === projectId);
  }

  auditsFor(actor: User, projectId: string): AgentAuditRecord[] {
    const project = this.requireProject(projectId);
    requireProjectAccess(actor, project);
    return sorted(
      this.data.audits.filter((audit) => audit.project_id === projectId),
      (audit) => audit.created_at,
    ).reverse();
  }

  teacherRows(actor: User, experimentId: string): TeacherProjectRow[] {
    requireStaff(actor);
    this.requireExperiment(experimentId);
    return this.data.projects
      .filter((project) => project.experiment_id === experimentId)
      .map((project) => {
        const student = this.requireUser(project.student_user_id);
        const overview = this.projectOverview(actor, project.id);
        return {
          project,
          student: publicUser(student),
          current_stage: overview.current_stage,
          latest_pipeline: overview.latest_pipeline,
          score_summary: overview.score_summary,
          risk_flags: unique(this.data.audits
            .filter((audit) => audit.project_id === project.id)
            .flatMap((audit) => audit.risk_flags)),
        };
      });
  }

  listRubrics(actor: User, experimentId?: string): EvaluationRubric[] {
    requireStaff(actor);
    return sorted(
      this.data.rubrics.filter((rubric) => !experimentId || rubric.experiment_id === experimentId),
      (rubric) => rubric.name,
    );
  }

  createRubric(actor: User, body: JsonObject): EvaluationRubric {
    requireStaff(actor);
    const experimentId = requiredString(body, "experiment_id");
    this.requireExperiment(experimentId);
    const rubric: EvaluationRubric = {
      id: id("rubric"),
      experiment_id: experimentId,
      name: requiredString(body, "name"),
      status: "active",
      target_kind: optionalString(body, "target_kind") ?? "test",
      target_suite: optionalString(body, "target_suite"),
      target_case: optionalString(body, "target_case"),
      weight: numberValue(body, "weight", 0),
      description: optionalString(body, "description"),
    };
    this.data.rubrics.push(rubric);
    return rubric;
  }

  listDesignSubmissions(actor: User, projectId?: string): DesignSubmission[] {
    requireStaff(actor);
    return this.data.submissions.filter((submission) => !projectId || submission.project_id === projectId);
  }

  updateDesignSubmission(actor: User, idValue: string, body: JsonObject): DesignSubmission {
    requireStaff(actor);
    const submission = this.requireSubmission(idValue);
    const reviewStatus = optionalString(body, "review_status");
    if (reviewStatus) submission.review_status = reviewStatus;
    const feedback = optionalString(body, "feedback");
    if (feedback !== undefined) submission.feedback = feedback;
    submission.reviewer_user_id = actor.id;
    return submission;
  }

  updateScore(actor: User, projectId: string, body: JsonObject): ScoreItem {
    requireStaff(actor);
    this.requireProject(projectId);
    const rubricId = requiredString(body, "rubric_id");
    this.requireRubric(rubricId);
    let score = this.data.scores.find((item) => item.project_id === projectId && item.rubric_id === rubricId);
    if (!score) {
      score = {
        id: id("score"),
        project_id: projectId,
        rubric_id: rubricId,
        auto_score: 0,
        is_final: false,
      };
      this.data.scores.push(score);
    }
    const manualScore = optionalNumber(body, "manual_score");
    if (manualScore !== undefined) score.manual_score = manualScore;
    const feedback = optionalString(body, "feedback");
    if (feedback !== undefined) score.feedback = feedback;
    if (typeof body.is_final === "boolean") score.is_final = body.is_final;
    return score;
  }

  recordAgentAudit(input: {
    projectId?: string;
    sessionId: string;
    userId?: string;
    model: string;
    taskKind?: string;
    prompt: string;
    response?: string;
    riskFlags?: readonly string[];
  }): AgentAuditRecord | undefined {
    if (!input.projectId || !this.data.projects.some((project) => project.id === input.projectId)) {
      return undefined;
    }
    const audit: AgentAuditRecord = {
      id: id("audit"),
      session_id: input.sessionId,
      user_id: input.userId ?? "system-agent",
      project_id: input.projectId,
      model: input.model,
      task_kind: input.taskKind ?? "chat_completion",
      prompt_summary: summarize(input.prompt),
      response_summary: input.response ? summarize(input.response) : undefined,
      risk_flags: [...(input.riskFlags ?? [])],
      risk_level: riskLevel(input.riskFlags ?? []),
      created_at: new Date().toISOString(),
    };
    this.data.audits.push(audit);
    return audit;
  }

  private visibleProjects(actor: User): Project[] {
    if (isStaff(actor)) return [...this.data.projects];
    return this.data.projects.filter((project) => project.student_user_id === actor.id);
  }

  private firstStageForExperiment(experimentId: string): StageGate {
    const stage = this.listStageGates(experimentId)[0];
    if (!stage) throw new PortalApiError(400, "experiment has no stage gates", "bad_request");
    return stage;
  }

  private evidenceForProject(projectId: string): EvidenceRecord[] {
    return this.data.evidence.filter((record) => record.project_id === projectId);
  }

  private latestPipeline(projectId: string): PipelineRun | undefined {
    return sorted(
      this.data.pipelines.filter((pipeline) => pipeline.project_id === projectId),
      (pipeline) => pipeline.started_at,
    ).at(-1);
  }

  private latestSubmission(projectId: string, stageId: string): DesignSubmission | undefined {
    return this.data.submissions
      .filter((submission) => submission.project_id === projectId && submission.stage_gate_id === stageId)
      .at(-1);
  }

  private scoreSummary(project: Project): ScoreSummary {
    const possible = this.data.rubrics
      .filter((rubric) => rubric.experiment_id === project.experiment_id)
      .reduce((total, rubric) => total + rubric.weight, 0);
    const scores = this.data.scores.filter((score) => score.project_id === project.id);
    const earned = scores.reduce((total, score) => total + (score.manual_score ?? score.auto_score), 0);
    return {
      earned,
      possible,
      finalized: scores.length > 0 && scores.every((score) => score.is_final),
    };
  }

  private userById(userId: string): UserRecord | undefined {
    return this.data.users.find((user) => user.id === userId);
  }

  private requireUser(userId: string): UserRecord {
    const user = this.userById(userId);
    if (!user) throw missing("user", userId);
    return user;
  }

  private requireCourse(courseId: string): Course {
    const course = this.data.courses.find((item) => item.id === courseId);
    if (!course) throw missing("course", courseId);
    return course;
  }

  private requireExperiment(experimentId: string): Experiment {
    const experiment = this.data.experiments.find((item) => item.id === experimentId);
    if (!experiment) throw missing("experiment", experimentId);
    return experiment;
  }

  private requireStage(stageId: string): StageGate {
    const stage = this.data.stages.find((item) => item.id === stageId);
    if (!stage) throw missing("stage", stageId);
    return stage;
  }

  private requireProject(projectId: string): Project {
    const project = this.data.projects.find((item) => item.id === projectId);
    if (!project) throw missing("project", projectId);
    return project;
  }

  private requireRubric(rubricId: string): EvaluationRubric {
    const rubric = this.data.rubrics.find((item) => item.id === rubricId);
    if (!rubric) throw missing("rubric", rubricId);
    return rubric;
  }

  private requireSubmission(submissionId: string): DesignSubmission {
    const submission = this.data.submissions.find((item) => item.id === submissionId);
    if (!submission) throw missing("design submission", submissionId);
    return submission;
  }
}

export function createSeededPortalStore(): PortalStore {
  const now = new Date().toISOString();
  const teacher: UserRecord = {
    id: "user-teacher",
    username: "teacher",
    display_name: "Course Teacher",
    role: "teacher",
    status: "active",
    password: "teacher",
  };
  const student: UserRecord = {
    id: "user-student",
    username: "student",
    display_name: "Demo Student",
    role: "student",
    status: "active",
    password: "student",
  };
  const studentMemory: UserRecord = {
    id: "user-student-memory",
    username: "memory",
    display_name: "Memory Track Student",
    role: "student",
    status: "active",
    password: "memory",
  };
  const studentRisk: UserRecord = {
    id: "user-student-risk",
    username: "risk",
    display_name: "Risk Review Student",
    role: "student",
    status: "active",
    password: "risk",
  };
  const ta: UserRecord = {
    id: "user-ta",
    username: "ta",
    display_name: "Teaching Assistant",
    role: "ta",
    status: "active",
    password: "ta",
  };
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
    description: "Progressive boot, memory, trap, process, and syscall lab.",
    experiment_type: "os",
    publish_state: "published",
    spec_version: "xv6-spec-demo",
  };
  const bootStage: StageGate = {
    id: "stage-boot-minimum",
    experiment_id: experiment.id,
    key: "boot-minimum",
    name: "Boot Minimum",
    sequence: 0,
    gate_type: "hybrid",
    status: "active",
    config: {
      required_artifacts: ["spec/architecture/slices/01-boot.yaml"],
      required_evidence: [{
        suite: "boot",
        case_name: "serial_banner_check",
        required_result: "pass",
      }],
      manual_review_required: false,
      visibility_scope: "student-public",
    },
  };
  const memoryStage: StageGate = {
    id: "stage-memory-management",
    experiment_id: experiment.id,
    key: "memory-management",
    name: "Memory Management",
    sequence: 1,
    gate_type: "hybrid",
    status: "active",
    config: {
      required_artifacts: ["spec/modules/kernel/memory/module.yaml"],
      required_evidence: [
        { suite: "memory", case_name: "page_allocator_tests", required_result: "pass" },
        { suite: "memory", case_name: "kernel_pagetable_smoke", required_result: "pass" },
      ],
      manual_review_required: true,
      visibility_scope: "student-public",
    },
  };
  const trapStage: StageGate = {
    id: "stage-trap-privilege",
    experiment_id: experiment.id,
    key: "trap-privilege",
    name: "Trap / Privilege",
    sequence: 2,
    gate_type: "hybrid",
    status: "active",
    config: {
      required_artifacts: ["spec/architecture/slices/03-trap.yaml"],
      required_evidence: [{ suite: "trap", case_name: "invalid_user_pointer", required_result: "pass" }],
      manual_review_required: true,
      visibility_scope: "student-public",
    },
  };
  const syscallStage: StageGate = {
    id: "stage-syscall-surface",
    experiment_id: experiment.id,
    key: "syscall-surface",
    name: "Syscall Surface",
    sequence: 3,
    gate_type: "hybrid",
    status: "active",
    config: {
      required_artifacts: ["spec/modules/kernel/syscall/module.yaml"],
      required_evidence: [{ suite: "syscall", case_name: "copyin_copyout_contract", required_result: "pass" }],
      manual_review_required: true,
      visibility_scope: "student-public",
    },
  };
  const resourceStage: StageGate = {
    id: "stage-resource-namespace",
    experiment_id: experiment.id,
    key: "resource-and-namespace",
    name: "Resource / Namespace",
    sequence: 4,
    gate_type: "hybrid",
    status: "active",
    config: {
      required_artifacts: ["spec/architecture/slices/05-resource-namespace.yaml"],
      required_evidence: [{ suite: "resource", case_name: "fd_lifetime_contract", required_result: "pass" }],
      manual_review_required: true,
      visibility_scope: "student-public",
    },
  };
  const finalStage: StageGate = {
    id: "stage-final-defense",
    experiment_id: experiment.id,
    key: "final-defense",
    name: "Final Defense",
    sequence: 5,
    gate_type: "manual",
    status: "active",
    config: {
      required_artifacts: ["docs/design-defense.md"],
      required_evidence: [{ suite: "integration", case_name: "public_regression_suite", required_result: "pass" }],
      manual_review_required: true,
      visibility_scope: "staff-full",
    },
  };
  const project: Project = {
    id: "project-demo-student",
    student_user_id: student.id,
    experiment_id: experiment.id,
    repo_url: "local://student/xv6-spec",
    current_stage_id: memoryStage.id,
    status: "active",
    last_commit_sha: "demo042",
  };
  const memoryProject: Project = {
    id: "project-memory-track",
    student_user_id: studentMemory.id,
    experiment_id: experiment.id,
    repo_url: "local://student/memory-track",
    current_stage_id: trapStage.id,
    status: "active",
    last_commit_sha: "mem118",
  };
  const riskProject: Project = {
    id: "project-risk-review",
    student_user_id: studentRisk.id,
    experiment_id: experiment.id,
    repo_url: "local://student/risk-review",
    current_stage_id: syscallStage.id,
    status: "needs_review",
    last_commit_sha: "risk733",
  };
  const pipeline: PipelineRun = {
    id: "pipeline-demo-boot",
    project_id: project.id,
    commit_sha: "demo001",
    trigger_type: "demo",
    status: "passed",
    stage_scope: "boot-minimum",
    public_summary: {
      status: "passed",
      passed: 1,
      failed: 0,
      total: 1,
      message: "1/1 public evidence checks passed",
    },
    started_at: now,
    finished_at: now,
  };
  const memoryPipeline: PipelineRun = {
    id: "pipeline-demo-memory",
    project_id: project.id,
    commit_sha: "demo042",
    trigger_type: "push",
    status: "failed",
    stage_scope: "memory-management",
    public_summary: {
      status: "failed",
      passed: 1,
      failed: 1,
      total: 2,
      failure_class: "implementation",
      message: "page_allocator_tests failed; kernel_pagetable_smoke passed",
    },
    started_at: now,
    finished_at: now,
  };
  const memoryTrackPipeline: PipelineRun = {
    id: "pipeline-memory-track-trap",
    project_id: memoryProject.id,
    commit_sha: "mem118",
    trigger_type: "push",
    status: "passed",
    stage_scope: "trap-privilege",
    public_summary: {
      status: "passed",
      passed: 3,
      failed: 0,
      total: 3,
      message: "Trap and pointer checks passed",
    },
    started_at: now,
    finished_at: now,
  };
  const riskPipeline: PipelineRun = {
    id: "pipeline-risk-syscall",
    project_id: riskProject.id,
    commit_sha: "risk733",
    trigger_type: "push",
    status: "failed",
    stage_scope: "syscall-surface",
    public_summary: {
      status: "failed",
      passed: 5,
      failed: 2,
      total: 7,
      failure_class: "policy-risk",
      message: "Syscall trace failed and Agent risk review is required",
    },
    started_at: now,
    finished_at: now,
  };
  const evidence: EvidenceRecord = {
    id: "evidence-boot-banner",
    project_id: project.id,
    pipeline_run_id: pipeline.id,
    kind: "test",
    suite: "boot",
    case_name: "serial_banner_check",
    result: "pass",
    metrics: { boot_ms: 912, signal: "XV6_BOOT_OK" },
    log_segment: "[SPECLAB] kernel_init\nXV6_BOOT_OK",
    artifact_uri: ".vos/runs/demo/qemu.log",
  };
  const memoryFailEvidence: EvidenceRecord = {
    id: "evidence-memory-double-free",
    project_id: project.id,
    pipeline_run_id: memoryPipeline.id,
    kind: "test",
    suite: "memory",
    case_name: "page_allocator_tests",
    result: "fail",
    metrics: { failed_case: "double_free_guard", allocation_rounds: 128 },
    log_segment: "panic: page allocator accepted duplicate free for pa=0x80402000",
    artifact_uri: ".vos/runs/demo/memory.log",
  };
  const memoryPassEvidence: EvidenceRecord = {
    id: "evidence-memory-pagetable",
    project_id: project.id,
    pipeline_run_id: memoryPipeline.id,
    kind: "test",
    suite: "memory",
    case_name: "kernel_pagetable_smoke",
    result: "pass",
    metrics: { mappings_checked: 42, kernel_stack_guard: true },
    log_segment: "kernel_pagetable_smoke: ok",
    artifact_uri: ".vos/runs/demo/memory.log",
  };
  const trapEvidence: EvidenceRecord = {
    id: "evidence-trap-invalid-pointer",
    project_id: memoryProject.id,
    pipeline_run_id: memoryTrackPipeline.id,
    kind: "test",
    suite: "trap",
    case_name: "invalid_user_pointer",
    result: "pass",
    metrics: { traps: 6, killed_processes: 2 },
    log_segment: "invalid_user_pointer: ok",
    artifact_uri: ".vos/runs/memory-track/trap.log",
  };
  const riskEvidence: EvidenceRecord = {
    id: "evidence-risk-copyin",
    project_id: riskProject.id,
    pipeline_run_id: riskPipeline.id,
    kind: "test",
    suite: "syscall",
    case_name: "copyin_copyout_contract",
    result: "fail",
    metrics: { failed_calls: ["write", "exec"], suspicious_patch: true },
    log_segment: "copyin_copyout_contract: failed on invalid user pointer path",
    artifact_uri: ".vos/runs/risk-review/syscall.log",
  };
  const rubric: EvaluationRubric = {
    id: "rubric-boot-evidence",
    experiment_id: experiment.id,
    name: "Boot evidence",
    status: "active",
    target_kind: "test",
    target_suite: "boot",
    target_case: "serial_banner_check",
    weight: 10,
    description: "Boot banner and success marker are present.",
  };
  const architectureRubric: EvaluationRubric = {
    id: "rubric-architecture-design",
    experiment_id: experiment.id,
    name: "Architecture design",
    status: "active",
    target_kind: "review",
    target_suite: "architecture",
    weight: 20,
    description: "ArchitectureSeed, slices, ADRs, and non-goals are specific and traceable.",
  };
  const memoryRubric: EvaluationRubric = {
    id: "rubric-memory-evidence",
    experiment_id: experiment.id,
    name: "Memory evidence",
    status: "active",
    target_kind: "test",
    target_suite: "memory",
    target_case: "page_allocator_tests",
    weight: 15,
    description: "Allocator invariants and pagetable smoke checks pass public evidence.",
  };
  const aiRubric: EvaluationRubric = {
    id: "rubric-ai-audit",
    experiment_id: experiment.id,
    name: "AI audit hygiene",
    status: "active",
    target_kind: "audit",
    target_suite: "agent",
    weight: 10,
    description: "Agent usage is disclosed, scoped, and backed by validation evidence.",
  };
  const score: ScoreItem = {
    id: "score-boot-evidence",
    project_id: project.id,
    rubric_id: rubric.id,
    auto_score: 10,
    feedback: "Boot evidence passed in the seeded public verification run.",
    is_final: false,
  };
  const architectureScore: ScoreItem = {
    id: "score-architecture-design",
    project_id: project.id,
    rubric_id: architectureRubric.id,
    auto_score: 16,
    feedback: "Architecture seed approved; memory slice requires one invariant clarification.",
    is_final: false,
  };
  const memoryScore: ScoreItem = {
    id: "score-memory-evidence",
    project_id: project.id,
    rubric_id: memoryRubric.id,
    auto_score: 7,
    feedback: "One memory public case failed and remains provisional.",
    is_final: false,
  };
  const aiScore: ScoreItem = {
    id: "score-ai-audit",
    project_id: project.id,
    rubric_id: aiRubric.id,
    auto_score: 10,
    feedback: "Agent collaboration stayed within current-stage projection.",
    is_final: false,
  };
  const submission: DesignSubmission = {
    id: "submission-memory-design",
    project_id: project.id,
    stage_gate_id: memoryStage.id,
    commit_sha: "demo001",
    artifact_ref: "docs/memory-design.md",
    review_status: "pending",
  };
  const trapSubmission: DesignSubmission = {
    id: "submission-trap-design",
    project_id: memoryProject.id,
    stage_gate_id: trapStage.id,
    commit_sha: "mem118",
    artifact_ref: "spec/architecture/slices/03-trap.yaml",
    review_status: "approved",
    reviewer_user_id: ta.id,
    feedback: "Pointer validation strategy is aligned with public evidence.",
  };
  const riskSubmission: DesignSubmission = {
    id: "submission-risk-syscall-design",
    project_id: riskProject.id,
    stage_gate_id: syscallStage.id,
    commit_sha: "risk733",
    artifact_ref: "spec/modules/kernel/syscall/module.yaml",
    review_status: "pending",
  };
  const audit: AgentAuditRecord = {
    id: "audit-seeded",
    session_id: "seeded-demo",
    user_id: student.id,
    project_id: project.id,
    model: "vos-local-agent",
    task_kind: "design_review",
    prompt_summary: "Student requested help connecting boot evidence to the next stage.",
    response_summary: "Suggested evidence-focused next steps without exposing staff-only policy.",
    risk_flags: [],
    risk_level: "low",
    created_at: now,
  };
  const riskAudit: AgentAuditRecord = {
    id: "audit-risk-generated-patch",
    session_id: "risk-demo",
    user_id: studentRisk.id,
    project_id: riskProject.id,
    model: "vos-local-agent",
    task_kind: "agent_generate",
    prompt_summary: "Student requested broad syscall implementation changes before design approval.",
    response_summary: "Generated patch proposal touched syscall and test paths; staff review required before acceptance.",
    risk_flags: ["large_patch", "stage_boundary", "validation_missing"],
    risk_level: "high",
    created_at: now,
  };

  const tokens = new Map<string, string>([
    ["demo-teacher", teacher.id],
    ["demo-student", student.id],
    ["demo-ta", ta.id],
  ]);
  return new PortalStore({
    users: [teacher, student, studentMemory, studentRisk, ta],
    tokens,
    courses: [course],
    experiments: [experiment],
    stages: [bootStage, memoryStage, trapStage, syscallStage, resourceStage, finalStage],
    projects: [project, memoryProject, riskProject],
    submissions: [submission, trapSubmission, riskSubmission],
    pipelines: [pipeline, memoryPipeline, memoryTrackPipeline, riskPipeline],
    evidence: [evidence, memoryFailEvidence, memoryPassEvidence, trapEvidence, riskEvidence],
    rubrics: [rubric, architectureRubric, memoryRubric, aiRubric],
    scores: [score, architectureScore, memoryScore, aiScore],
    audits: [audit, riskAudit],
  });
}

export async function handlePortalApiRequest(
  request: Request,
  store: PortalStore,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/v1/")) return undefined;

  try {
    const parts = url.pathname.split("/").filter(Boolean);
    const actor = () => userFromRequest(request, store);
    const body = () => readJsonObject(request);

    if (parts[2] === "auth" && parts[3] === "login" && request.method === "POST") {
      const input = await body();
      return portalJson(store.authenticate(requiredString(input, "username"), requiredString(input, "password")));
    }
    if (parts[2] === "auth" && parts[3] === "logout" && request.method === "POST") {
      const token = bearerToken(request);
      if (token) store.revokeToken(token);
      return portalJson({ ok: true });
    }
    if (parts[2] === "auth" && parts[3] === "me" && request.method === "GET") {
      return portalJson(actor());
    }
    if (parts[2] === "users" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listUsers(actor()));
    }
    if (parts[2] === "courses" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listCourses());
    }
    if (parts[2] === "courses" && parts.length === 3 && request.method === "POST") {
      return portalJson(store.createCourse(actor(), await body()), 201);
    }
    if (parts[2] === "courses" && parts.length === 4 && request.method === "DELETE") {
      store.deleteCourse(actor(), parts[3]);
      return portalJson({ ok: true });
    }
    if (parts[2] === "experiments" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listExperiments(url.searchParams.get("course_id") ?? undefined));
    }
    if (parts[2] === "experiments" && parts.length === 3 && request.method === "POST") {
      return portalJson(store.createExperiment(actor(), await body()), 201);
    }
    if (parts[2] === "experiments" && parts.length === 4 && request.method === "DELETE") {
      store.deleteExperiment(actor(), parts[3]);
      return portalJson({ ok: true });
    }
    if (parts[2] === "experiments" && parts[4] === "stage-gates" && request.method === "GET") {
      return portalJson(store.listStageGates(parts[3]));
    }
    if (parts[2] === "experiments" && parts[4] === "stage-gates" && request.method === "POST") {
      return portalJson(store.createStageGate(actor(), parts[3], await body()), 201);
    }
    if (parts[2] === "stage-gates" && parts.length === 4 && request.method === "DELETE") {
      store.deleteStageGate(actor(), parts[3]);
      return portalJson({ ok: true });
    }
    if (parts[2] === "projects" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listProjectOverviews(actor()));
    }
    if (parts[2] === "projects" && parts.length === 3 && request.method === "POST") {
      return portalJson(store.createProject(actor(), await body()), 201);
    }
    if (parts[2] === "projects" && parts.length === 4 && request.method === "GET") {
      return portalJson(store.projectOverview(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts.length === 4 && request.method === "DELETE") {
      store.deleteProject(actor(), parts[3]);
      return portalJson({ ok: true });
    }
    if (parts[2] === "projects" && parts[4] === "progress" && request.method === "GET") {
      return portalJson(store.stageProgress(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts[4] === "evidence" && request.method === "GET") {
      return portalJson(store.evidenceFor(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts[4] === "scores" && request.method === "GET") {
      return portalJson(store.scoresFor(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts[4] === "agent-audit" && request.method === "GET") {
      return portalJson(store.auditsFor(actor(), parts[3]));
    }
    if (parts[2] === "teacher" && parts[3] === "experiments" && parts[5] === "students" && request.method === "GET") {
      return portalJson({ rows: store.teacherRows(actor(), parts[4]) });
    }
    if (parts[2] === "teacher" && parts[3] === "projects" && parts[5] === "grade" && request.method === "POST") {
      return portalJson(store.updateScore(actor(), parts[4], await body()));
    }
    if (parts[2] === "rubrics" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listRubrics(actor(), url.searchParams.get("experiment_id") ?? undefined));
    }
    if (parts[2] === "rubrics" && parts.length === 3 && request.method === "POST") {
      return portalJson(store.createRubric(actor(), await body()), 201);
    }
    if (parts[2] === "design-submissions" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listDesignSubmissions(actor(), url.searchParams.get("project_id") ?? undefined));
    }
    if (parts[2] === "design-submissions" && parts.length === 4 && request.method === "PATCH") {
      return portalJson(store.updateDesignSubmission(actor(), parts[3], await body()));
    }

    throw new PortalApiError(404, "not found", "not_found");
  } catch (e) {
    const error = e instanceof PortalApiError
      ? e
      : new PortalApiError(500, e instanceof Error ? e.message : String(e), "portal_error");
    return portalJson({
      error: {
        message: error.message,
        type: error.type,
      },
    }, error.status);
  }
}

export function portalCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

type JsonObject = Record<string, unknown>;

async function readJsonObject(request: Request): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new PortalApiError(400, "request body must be JSON", "bad_request");
  }
  const object = asObject(value);
  if (!object) throw new PortalApiError(400, "request body must be a JSON object", "bad_request");
  return object;
}

function userFromRequest(request: Request, store: PortalStore): User {
  const token = bearerToken(request);
  if (!token) throw new PortalApiError(401, "missing bearer token", "unauthorized");
  return store.userForToken(token);
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("Authorization") ?? request.headers.get("authorization");
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1];
}

function portalJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(deepClone(body)), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...portalCorsHeaders(),
    },
  });
}

function requireStaff(actor: User): void {
  if (!isStaff(actor)) {
    throw new PortalApiError(403, "staff access required", "forbidden");
  }
}

function requireProjectAccess(actor: User, project: Project): void {
  if (!isStaff(actor) && project.student_user_id !== actor.id) {
    throw new PortalApiError(403, "project access denied", "forbidden");
  }
}

function isStaff(user: User): boolean {
  return user.role === "admin" || user.role === "teacher" || user.role === "ta";
}

function publicUser(user: UserRecord): User {
  const { password: _password, ...rest } = user;
  return rest;
}

function missing(kind: string, idValue: string): PortalApiError {
  return new PortalApiError(404, `${kind} ${idValue} not found`, "not_found");
}

function removeById<T extends { id: string }>(items: T[], idValue: string, kind: string): T[] {
  if (!items.some((item) => item.id === idValue)) throw missing(kind, idValue);
  return items.filter((item) => item.id !== idValue);
}

function missingEvidence(stage: StageGate, evidence: EvidenceRecord[]): EvidenceRequirement[] {
  return stage.config.required_evidence.filter((required) => !evidence.some((record) =>
    record.suite === required.suite &&
    record.case_name === required.case_name &&
    record.result === required.required_result
  ));
}

function normalizeStageConfig(input: JsonObject): StageGate["config"] {
  const evidence = Array.isArray(input.required_evidence)
    ? input.required_evidence.flatMap((item) => {
      const object = asObject(item);
      if (!object) return [];
      const suite = optionalString(object, "suite");
      const caseName = optionalString(object, "case_name");
      const requiredResult = optionalString(object, "required_result");
      if (!suite || !caseName || !isEvidenceResult(requiredResult)) return [];
      return [{ suite, case_name: caseName, required_result: requiredResult }];
    })
    : [];
  const artifacts = Array.isArray(input.required_artifacts)
    ? input.required_artifacts.filter((item): item is string => typeof item === "string")
    : [];
  return {
    required_artifacts: artifacts,
    required_evidence: evidence,
    manual_review_required: typeof input.manual_review_required === "boolean"
      ? input.manual_review_required
      : false,
    visibility_scope: optionalString(input, "visibility_scope"),
  };
}

function requiredString(body: JsonObject, key: string): string {
  const value = optionalString(body, key);
  if (!value) throw new PortalApiError(400, `"${key}" must be a non-empty string`, "bad_request");
  return value;
}

function optionalString(body: JsonObject, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(body: JsonObject, key: string): number | undefined {
  const value = body[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function numberValue(body: JsonObject, key: string, fallback: number): number {
  return optionalNumber(body, key) ?? fallback;
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function sorted<T>(items: T[], key: (item: T) => string | number): T[] {
  return [...items].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return typeof leftKey === "number" && typeof rightKey === "number"
      ? leftKey - rightKey
      : String(leftKey).localeCompare(String(rightKey));
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function summarize(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 220 ? compact : `${compact.slice(0, 217)}...`;
}

function riskLevel(flags: readonly string[]): AgentAuditRecord["risk_level"] {
  if (flags.length === 0) return "low";
  if (flags.some((flag) =>
    flag.includes("hidden_context") ||
    flag.includes("test_or_checker_bypass") ||
    flag.includes("unsafe_tool")
  )) {
    return "critical";
  }
  if (flags.some((flag) =>
    flag.includes("policy") ||
    flag.includes("unbound") ||
    flag.includes("large_patch")
  )) {
    return "high";
  }
  return "medium";
}

function isEvidenceResult(value: string | undefined): value is EvidenceResult {
  return value === "pass" || value === "fail" || value === "error" || value === "skipped";
}
