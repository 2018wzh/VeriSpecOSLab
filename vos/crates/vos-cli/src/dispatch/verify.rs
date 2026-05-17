use std::path::Path;
use vos_core::{artifact, envelope, CommandEnvelope, CommandStatus};

pub async fn verify_public_envelope(
    project_root: &Path,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::verify_public(project_root, progress)
        .await
        .map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos verify public",
        CommandStatus::Ok,
        vec![
            artifact("build_log", payload.build.log_path.display().to_string()),
            artifact("qemu_log", payload.run.log_path.display().to_string()),
        ],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}
