use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactRef {
    pub kind: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandStatus {
    Ok,
    Partial,
    Planned,
    NotImplemented,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandEnvelope<T> {
    pub ok: bool,
    pub run_id: String,
    pub command: String,
    pub status: CommandStatus,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRef>,
    pub payload: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotImplementedPayload {
    pub reason: String,
    #[serde(default)]
    pub related_docs: Vec<String>,
    #[serde(default)]
    pub suggested_next_commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailurePayload {
    pub kind: String,
    pub message: String,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticPayload {
    pub kind: String,
    pub message: String,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

pub fn artifact(kind: impl Into<String>, path: impl Into<String>) -> ArtifactRef {
    ArtifactRef {
        kind: kind.into(),
        path: path.into(),
    }
}

pub fn envelope<T>(
    command: impl Into<String>,
    status: CommandStatus,
    artifacts: Vec<ArtifactRef>,
    payload: T,
) -> CommandEnvelope<T> {
    let ok = matches!(status, CommandStatus::Ok | CommandStatus::Partial | CommandStatus::Planned);
    CommandEnvelope {
        ok,
        run_id: Uuid::new_v4().to_string(),
        command: command.into(),
        status,
        artifacts,
        payload,
    }
}

pub fn not_implemented_payload(
    reason: impl Into<String>,
    related_docs: Vec<String>,
    suggested_next_commands: Vec<String>,
) -> NotImplementedPayload {
    NotImplementedPayload {
        reason: reason.into(),
        related_docs,
        suggested_next_commands,
    }
}
