use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::Timestamp;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CourseEventKind {
    CourseCreated,
    ExperimentPublished,
    ProjectProvisioned,
    DesignReviewRequested,
    StageUnlocked,
    PipelineQueued,
    PipelineEvidencePublished,
    ScoreRecomputed,
    AgentAuditFlagged,
    ProjectFrozen,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CourseEvent {
    pub id: Uuid,
    pub kind: CourseEventKind,
    pub project_id: Option<Uuid>,
    pub experiment_id: Option<Uuid>,
    pub actor_user_id: Option<Uuid>,
    pub stage_key: Option<String>,
    pub causation_id: Option<String>,
    pub payload: serde_json::Value,
    pub created_at: Timestamp,
}
