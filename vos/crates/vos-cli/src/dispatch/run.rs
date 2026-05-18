use std::path::Path;
use vos_core::{CommandEnvelope, CommandStatus, artifact, envelope};

pub async fn run_qemu_envelope(
    project_root: &Path,
    profile: Option<String>,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::run_qemu_with_progress(project_root, profile, progress)
        .await
        .map_err(|e| e.to_string())?;
    let status = if payload.success {
        CommandStatus::Ok
    } else {
        CommandStatus::Failed
    };
    Ok(envelope(
        "vos run qemu",
        status,
        vec![artifact("qemu_log", payload.log_path.display().to_string())],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}
