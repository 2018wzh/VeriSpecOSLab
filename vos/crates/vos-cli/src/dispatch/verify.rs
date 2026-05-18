use std::path::Path;
use vos_core::{CommandEnvelope, CommandStatus, artifact, envelope};

pub async fn verify_public_envelope(
    project_root: &Path,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::verify_public(project_root, progress)
        .await
        .map_err(|e| e.to_string())?;
    let mut artifacts = vec![
        artifact("build_log", payload.build.log_path.display().to_string()),
        artifact("qemu_log", payload.run.log_path.display().to_string()),
    ];
    artifacts.extend(
        payload
            .build
            .phase_results
            .iter()
            .map(|phase| artifact("phase_log", phase.log_path.display().to_string())),
    );
    Ok(envelope(
        "vos verify public",
        CommandStatus::Ok,
        artifacts,
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

pub async fn verify_patch_envelope(
    project_root: &Path,
    patch_path: &Path,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::verify_patch(project_root, patch_path, progress)
        .await
        .map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos verify patch",
        if payload.build.success {
            CommandStatus::Ok
        } else {
            CommandStatus::Failed
        },
        vec![artifact(
            "build_log",
            payload.build.log_path.display().to_string(),
        )],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}
