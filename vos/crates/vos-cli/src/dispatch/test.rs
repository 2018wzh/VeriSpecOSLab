use std::path::Path;
use vos_core::{CommandEnvelope, CommandStatus, envelope};

pub async fn test_envelope(
    project_root: &Path,
    suite: Option<String>,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::run_tests(project_root, suite, progress)
        .await
        .map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos test",
        if payload.build.success {
            CommandStatus::Ok
        } else {
            CommandStatus::Failed
        },
        Vec::new(),
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}
