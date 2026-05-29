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

export interface StageGate {
  id: string;
  key: string;
  name: string;
  sequence: number;
  gate_type: string;
  config: {
    required_artifacts: string[];
    required_evidence: Array<{
      suite: string;
      case_name: string;
      required_result: EvidenceResult;
    }>;
    manual_review_required: boolean;
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
    missing_evidence: unknown[];
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

export interface LoginResponse {
  token: string;
  user: User;
}
