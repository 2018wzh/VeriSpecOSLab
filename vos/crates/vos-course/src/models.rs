use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub type Timestamp = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    Admin,
    Teacher,
    Ta,
    Student,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserStatus {
    Active,
    Suspended,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CourseStatus {
    Draft,
    Active,
    Closed,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentType {
    Os,
    Database,
    Compiler,
    Network,
    Runtime,
    Hardware,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishState {
    Draft,
    Published,
    Frozen,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Provisioning,
    Active,
    StageLocked,
    Frozen,
    Completed,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateKind {
    Auto,
    Manual,
    Hybrid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateStatus {
    Draft,
    Active,
    Retired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesignReviewStatus {
    Submitted,
    Validating,
    UnderReview,
    Approved,
    Rejected,
    Superseded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStatus {
    Queued,
    Preparing,
    Running,
    Passed,
    Failed,
    Cancelled,
    TimedOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerType {
    Push,
    PullRequest,
    Manual,
    Retry,
    Demo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    BuildLog,
    Test,
    Benchmark,
    Invariant,
    QemuLog,
    Trace,
    ReviewNote,
    Audit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceResult {
    Pass,
    Fail,
    Error,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RubricStatus {
    Draft,
    Active,
    Superseded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VisibilityScope {
    StudentPublic,
    AgentPublic,
    StaffFull,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: UserRole,
    pub status: UserStatus,
    pub password_hash: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalIdentity {
    pub id: Uuid,
    pub user_id: Uuid,
    pub provider: String,
    pub subject: String,
    pub email: Option<String>,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Course {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub term: String,
    pub description: Option<String>,
    pub status: CourseStatus,
    pub owner_user_id: Uuid,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Experiment {
    pub id: Uuid,
    pub course_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub experiment_type: ExperimentType,
    pub spec_version: String,
    pub base_repo_url: Option<String>,
    pub publish_state: PublishState,
    pub config: Value,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvidenceRequirement {
    pub suite: String,
    pub case_name: String,
    #[serde(default = "default_required_result")]
    pub required_result: EvidenceResult,
}

fn default_required_result() -> EvidenceResult {
    EvidenceResult::Pass
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageGateConfig {
    #[serde(default)]
    pub required_artifacts: Vec<String>,
    #[serde(default)]
    pub required_evidence: Vec<EvidenceRequirement>,
    #[serde(default)]
    pub manual_review_required: bool,
    #[serde(default)]
    pub visibility_scope: Option<VisibilityScope>,
}

impl Default for StageGateConfig {
    fn default() -> Self {
        Self {
            required_artifacts: Vec::new(),
            required_evidence: Vec::new(),
            manual_review_required: false,
            visibility_scope: Some(VisibilityScope::StudentPublic),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageGate {
    pub id: Uuid,
    pub experiment_id: Uuid,
    pub key: String,
    pub name: String,
    pub sequence: i32,
    pub gate_type: GateKind,
    pub status: GateStatus,
    pub config: StageGateConfig,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub id: Uuid,
    pub student_user_id: Uuid,
    pub experiment_id: Uuid,
    pub repo_url: Option<String>,
    pub workspace_ref: Option<String>,
    pub current_stage_id: Uuid,
    pub status: ProjectStatus,
    pub last_commit_sha: Option<String>,
    pub adapter_profile: Value,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesignSubmission {
    pub id: Uuid,
    pub project_id: Uuid,
    pub stage_gate_id: Uuid,
    pub commit_sha: String,
    pub artifact_ref: Option<String>,
    pub review_status: DesignReviewStatus,
    pub reviewer_user_id: Option<Uuid>,
    pub feedback: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PipelineRun {
    pub id: Uuid,
    pub project_id: Uuid,
    pub commit_sha: String,
    pub trigger_type: TriggerType,
    pub status: PipelineStatus,
    pub stage_scope: Option<String>,
    pub public_summary: Option<PublicSummary>,
    pub retry_of: Option<Uuid>,
    pub started_at: Timestamp,
    pub finished_at: Option<Timestamp>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvidenceRecord {
    pub id: Uuid,
    pub project_id: Uuid,
    pub pipeline_run_id: Uuid,
    pub commit_sha: String,
    pub kind: EvidenceKind,
    pub suite: String,
    pub case_name: String,
    pub result: EvidenceResult,
    pub metrics: Value,
    pub log_segment: Option<String>,
    pub artifact_uri: Option<String>,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvaluationRubric {
    pub id: Uuid,
    pub experiment_id: Uuid,
    pub name: String,
    pub status: RubricStatus,
    pub target_kind: EvidenceKind,
    pub target_suite: Option<String>,
    pub target_case: Option<String>,
    pub weight: f32,
    pub description: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScoreItem {
    pub id: Uuid,
    pub project_id: Uuid,
    pub rubric_id: Uuid,
    pub auto_score: f32,
    pub manual_score: Option<f32>,
    pub feedback: Option<String>,
    pub is_final: bool,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentAuditRecord {
    pub id: Uuid,
    pub session_id: String,
    pub user_id: Uuid,
    pub project_id: Uuid,
    pub model: String,
    pub task_kind: String,
    pub prompt_summary: String,
    pub response_summary: Option<String>,
    pub context_summary: Value,
    #[serde(default)]
    pub tool_calls: Vec<String>,
    #[serde(default)]
    pub risk_flags: Vec<String>,
    pub risk_level: AgentRiskLevel,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicSummary {
    pub status: PipelineStatus,
    pub passed: usize,
    pub failed: usize,
    pub total: usize,
    pub failure_class: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScoreSummary {
    pub earned: f32,
    pub possible: f32,
    pub finalized: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectOverview {
    pub project: Project,
    pub current_stage: StageGate,
    pub latest_pipeline: Option<PipelineRun>,
    pub score_summary: ScoreSummary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageProgress {
    pub current_stage: StageGate,
    pub stages: Vec<StageGateProgress>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageGateProgress {
    pub stage: StageGate,
    pub unlocked: bool,
    pub passed: bool,
    pub missing_evidence: Vec<EvidenceRequirement>,
    pub manual_review_status: Option<DesignReviewStatus>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TeacherProjectRow {
    pub project: Project,
    pub student: User,
    pub current_stage: StageGate,
    pub latest_pipeline: Option<PipelineRun>,
    pub score_summary: ScoreSummary,
    #[serde(default)]
    pub risk_flags: Vec<String>,
}
