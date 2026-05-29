import type {
  AgentAuditRecord,
  Course,
  DesignSubmission,
  EvaluationRubric,
  EvidenceRecord,
  Experiment,
  LoginResponse,
  Project,
  ProjectOverview,
  ScoreItem,
  StageGate,
  StageProgress,
  TeacherProjectRow,
  User
} from "../lib/types";

const tokenKey = "vos_portal_token";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

function token() {
  return window.localStorage.getItem(tokenKey);
}

async function fetchJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const bearer = token();
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API ${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const portalApi = {
  hasToken: () => Boolean(token()),
  setToken: (value: string) => window.localStorage.setItem(tokenKey, value),
  clearToken: () => window.localStorage.removeItem(tokenKey),
  login: (username: string, password: string) =>
    fetchJson<LoginResponse>("/api/v1/auth/login", {
      method: "POST",
      body: { username, password }
    }).then((response) => {
      portalApi.setToken(response.token);
      return response;
    }),
  me: () => fetchJson<User>("/api/v1/auth/me"),
  users: () => fetchJson<User[]>("/api/v1/users"),
  courses: () => fetchJson<Course[]>("/api/v1/courses"),
  createCourse: (body: { code: string; name: string; term: string; description?: string }) =>
    fetchJson<Course>("/api/v1/courses", { method: "POST", body }),
  deleteCourse: (id: string) => fetchJson(`/api/v1/courses/${id}`, { method: "DELETE" }),
  experiments: () => fetchJson<Experiment[]>("/api/v1/experiments"),
  createExperiment: (body: {
    course_id: string;
    title: string;
    description?: string;
    experiment_type: string;
    spec_version?: string;
    publish_state?: string;
    config?: Record<string, unknown>;
  }) => fetchJson<Experiment>("/api/v1/experiments", { method: "POST", body }),
  deleteExperiment: (id: string) => fetchJson(`/api/v1/experiments/${id}`, { method: "DELETE" }),
  stageGates: (experimentId: string) =>
    fetchJson<StageGate[]>(`/api/v1/experiments/${experimentId}/stage-gates`),
  createStageGate: (experimentId: string, body: {
    experiment_id: string;
    key: string;
    name: string;
    sequence: number;
    gate_type: string;
    config?: Record<string, unknown>;
  }) => fetchJson<StageGate>(`/api/v1/experiments/${experimentId}/stage-gates`, { method: "POST", body }),
  deleteStageGate: (id: string) => fetchJson(`/api/v1/stage-gates/${id}`, { method: "DELETE" }),
  projects: () => fetchJson<ProjectOverview[]>("/api/v1/projects"),
  createProject: (body: { student_user_id: string; experiment_id: string; repo_url?: string }) =>
    fetchJson<Project>("/api/v1/projects", { method: "POST", body }),
  deleteProject: (id: string) => fetchJson(`/api/v1/projects/${id}`, { method: "DELETE" }),
  project: (projectId: string) => fetchJson<ProjectOverview>(`/api/v1/projects/${projectId}`),
  progress: (projectId: string) => fetchJson<StageProgress>(`/api/v1/projects/${projectId}/progress`),
  evidence: (projectId: string) => fetchJson<EvidenceRecord[]>(`/api/v1/projects/${projectId}/evidence`),
  scores: (projectId: string) => fetchJson<ScoreItem[]>(`/api/v1/projects/${projectId}/scores`),
  audit: (projectId: string) => fetchJson<AgentAuditRecord[]>(`/api/v1/projects/${projectId}/agent-audit`),
  teacherRows: (experimentId: string) =>
    fetchJson<{ rows: TeacherProjectRow[] }>(`/api/v1/teacher/experiments/${experimentId}/students`).then(
      (value) => value.rows
    ),
  rubrics: (experimentId?: string) =>
    fetchJson<EvaluationRubric[]>(`/api/v1/rubrics${experimentId ? `?experiment_id=${experimentId}` : ""}`),
  createRubric: (body: {
    experiment_id: string;
    name: string;
    target_kind: string;
    target_suite?: string;
    target_case?: string;
    weight: number;
    description?: string;
  }) => fetchJson<EvaluationRubric>("/api/v1/rubrics", { method: "POST", body }),
  designSubmissions: (projectId?: string) =>
    fetchJson<DesignSubmission[]>(`/api/v1/design-submissions${projectId ? `?project_id=${projectId}` : ""}`),
  updateDesignSubmission: (id: string, body: { review_status?: string; feedback?: string }) =>
    fetchJson<DesignSubmission>(`/api/v1/design-submissions/${id}`, { method: "PATCH", body }),
  updateScore: (projectId: string, body: {
    rubric_id: string;
    manual_score?: number;
    feedback?: string;
    is_final?: boolean;
  }) => fetchJson<ScoreItem>(`/api/v1/teacher/projects/${projectId}/grade`, { method: "POST", body })
};
