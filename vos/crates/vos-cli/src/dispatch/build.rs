use std::path::Path;
use vos_core::{artifact, envelope, CommandEnvelope, CommandStatus};

pub async fn build_envelope(
    project_root: &Path,
    profile: Option<String>,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::build_with_progress(project_root, profile, progress)
        .await
        .map_err(|e| e.to_string())?;
    let status = if payload.success {
        CommandStatus::Ok
    } else {
        CommandStatus::Failed
    };
    let mut artifacts = vec![artifact("build_log", payload.log_path.display().to_string())];
    if payload.generated_artifacts.is_empty() {
        artifacts.push(artifact("build_command", payload.command.clone()));
    } else {
        artifacts.extend(
            payload
                .generated_artifacts
                .iter()
                .map(|path| artifact("generated_artifact", path.display().to_string())),
        );
    }
    Ok(envelope(
        "vos build",
        status,
        artifacts,
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}
