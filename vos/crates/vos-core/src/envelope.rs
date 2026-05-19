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
    envelope_with_run_id(
        Uuid::new_v4().to_string(),
        command,
        status,
        artifacts,
        payload,
    )
}

pub fn envelope_with_run_id<T>(
    run_id: impl Into<String>,
    command: impl Into<String>,
    status: CommandStatus,
    artifacts: Vec<ArtifactRef>,
    payload: T,
) -> CommandEnvelope<T> {
    let ok = matches!(
        status,
        CommandStatus::Ok | CommandStatus::Partial | CommandStatus::Planned
    );
    CommandEnvelope {
        ok,
        run_id: run_id.into(),
        command: command.into(),
        status,
        artifacts,
        payload,
    }
}

pub fn extract_run_id_marker(message: &str) -> Option<(String, String)> {
    let prefix = "[run_id:";
    let remainder = message.strip_prefix(prefix)?;
    let end = remainder.find(']')?;
    let run_id = remainder[..end].trim().to_string();
    let cleaned = remainder[end + 1..].trim_start().to_string();
    if run_id.is_empty() {
        None
    } else {
        Some((run_id, cleaned))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_run_id_marker_and_strips_prefix() {
        let parsed =
            extract_run_id_marker("[run_id:abc-123] skeleton projection failed").expect("marker");
        assert_eq!(parsed.0, "abc-123");
        assert_eq!(parsed.1, "skeleton projection failed");
    }
}
