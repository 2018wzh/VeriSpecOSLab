use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    AgentRiskLevel, CourseStatus, DesignReviewStatus, EvidenceKind, EvidenceRecord, EvidenceResult,
    ExperimentType, GateKind, GateStatus, PipelineRun, PipelineStatus, ProjectOverview,
    ProjectStatus, PublicSummary, PublishState, RubricStatus, ScoreItem, StageGateConfig,
    TeacherProjectRow, TriggerType, User, UserRole, UserStatus, VisibilityScope,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteResponse {
    pub ok: bool,
    pub id: Uuid,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: String,
    pub role: UserRole,
    #[serde(default = "default_user_status")]
    pub status: UserStatus,
    pub password: Option<String>,
}

fn default_user_status() -> UserStatus {
    UserStatus::Active
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub role: Option<UserRole>,
    pub status: Option<UserStatus>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCourseRequest {
    pub code: String,
    pub name: String,
    pub term: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCourseRequest {
    pub code: Option<String>,
    pub name: Option<String>,
    pub term: Option<String>,
    pub description: Option<String>,
    pub status: Option<CourseStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateExperimentRequest {
    pub course_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub experiment_type: ExperimentType,
    pub spec_version: Option<String>,
    pub base_repo_url: Option<String>,
    pub publish_state: Option<PublishState>,
    #[serde(default)]
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateExperimentRequest {
    pub course_id: Option<Uuid>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub experiment_type: Option<ExperimentType>,
    pub spec_version: Option<String>,
    pub base_repo_url: Option<String>,
    pub publish_state: Option<PublishState>,
    pub config: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStageGateRequest {
    pub experiment_id: Uuid,
    pub key: String,
    pub name: String,
    pub sequence: i32,
    pub gate_type: GateKind,
    #[serde(default)]
    pub config: StageGateConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStageGateRequest {
    pub key: Option<String>,
    pub name: Option<String>,
    pub sequence: Option<i32>,
    pub gate_type: Option<GateKind>,
    pub status: Option<GateStatus>,
    pub config: Option<StageGateConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub student_user_id: Uuid,
    pub experiment_id: Uuid,
    pub repo_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProjectRequest {
    pub repo_url: Option<String>,
    pub workspace_ref: Option<String>,
    pub current_stage_id: Option<Uuid>,
    pub status: Option<ProjectStatus>,
    pub last_commit_sha: Option<String>,
    pub adapter_profile: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunPipelineRequest {
    pub commit_sha: String,
    #[serde(default = "manual_trigger")]
    pub trigger_type: TriggerType,
    pub stage_scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePipelineRunRequest {
    pub project_id: Uuid,
    pub commit_sha: String,
    #[serde(default = "manual_trigger")]
    pub trigger_type: TriggerType,
    pub status: Option<PipelineStatus>,
    pub stage_scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePipelineRunRequest {
    pub status: Option<PipelineStatus>,
    pub stage_scope: Option<String>,
    pub public_summary: Option<PublicSummary>,
    pub finished: Option<bool>,
}

fn manual_trigger() -> TriggerType {
    TriggerType::Manual
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingEvidenceReport {
    pub project_id: Uuid,
    pub pipeline_run_id: Option<Uuid>,
    pub commit_sha: String,
    #[serde(default)]
    pub records: Vec<IncomingEvidenceRecord>,
    pub vos_report: Option<vos_core::RunManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingEvidenceRecord {
    pub kind: EvidenceKind,
    pub suite: String,
    pub case_name: String,
    pub result: EvidenceResult,
    #[serde(default)]
    pub metrics: Value,
    pub log_segment: Option<String>,
    pub artifact_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEvidenceRecordRequest {
    pub project_id: Uuid,
    pub pipeline_run_id: Uuid,
    pub commit_sha: String,
    pub kind: EvidenceKind,
    pub suite: String,
    pub case_name: String,
    pub result: EvidenceResult,
    #[serde(default)]
    pub metrics: Value,
    pub log_segment: Option<String>,
    pub artifact_uri: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateEvidenceRecordRequest {
    pub artifact_uri: Option<String>,
    pub review_status: Option<String>,
    pub visibility_state: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceIngestResponse {
    pub pipeline: PipelineRun,
    pub inserted: Vec<EvidenceRecord>,
    pub promoted_stage_id: Option<Uuid>,
    pub recomputed_scores: Vec<ScoreItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewDesignRequest {
    pub reviewer_user_id: Uuid,
    pub status: DesignReviewStatus,
    pub feedback: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDesignSubmissionRequest {
    pub project_id: Uuid,
    pub stage_gate_id: Uuid,
    pub commit_sha: String,
    pub artifact_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateDesignSubmissionRequest {
    pub artifact_ref: Option<String>,
    pub review_status: Option<DesignReviewStatus>,
    pub reviewer_user_id: Option<Uuid>,
    pub feedback: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitDesignRequest {
    pub stage_gate_id: Uuid,
    pub commit_sha: String,
    pub artifact_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRubricRequest {
    pub experiment_id: Uuid,
    pub name: String,
    #[serde(default = "default_rubric_status")]
    pub status: RubricStatus,
    pub target_kind: EvidenceKind,
    pub target_suite: Option<String>,
    pub target_case: Option<String>,
    pub weight: f32,
    pub description: Option<String>,
}

fn default_rubric_status() -> RubricStatus {
    RubricStatus::Active
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRubricRequest {
    pub name: Option<String>,
    pub status: Option<RubricStatus>,
    pub target_kind: Option<EvidenceKind>,
    pub target_suite: Option<String>,
    pub target_case: Option<String>,
    pub weight: Option<f32>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateScoreRequest {
    pub project_id: Uuid,
    pub rubric_id: Uuid,
    pub auto_score: Option<f32>,
    pub manual_score: Option<f32>,
    pub feedback: Option<String>,
    pub is_final: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateScoreRequest {
    pub rubric_id: Uuid,
    pub manual_score: Option<f32>,
    pub feedback: Option<String>,
    pub is_final: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAgentAuditRequest {
    pub user_id: Uuid,
    pub project_id: Uuid,
    pub model: String,
    pub task_kind: String,
    pub prompt_summary: String,
    pub response_summary: Option<String>,
    #[serde(default)]
    pub context_summary: Value,
    #[serde(default)]
    pub tool_calls: Vec<String>,
    #[serde(default)]
    pub risk_flags: Vec<String>,
    #[serde(default = "default_agent_risk")]
    pub risk_level: AgentRiskLevel,
}

fn default_agent_risk() -> AgentRiskLevel {
    AgentRiskLevel::Low
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAgentAuditRequest {
    pub review_status: Option<String>,
    pub visibility_state: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectProjection {
    pub project: ProjectOverview,
    pub scope: VisibilityScope,
    pub stage_rules: Value,
    pub visible_spec_summary: Value,
    pub policy_summary: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeacherExperimentStudentsResponse {
    pub rows: Vec<TeacherProjectRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    pub project_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub model: String,
    pub choices: Vec<ChatChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChoice {
    pub index: usize,
    pub message: ChatMessage,
    pub finish_reason: String,
}
