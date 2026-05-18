use crate::args::BuildArgs;
use std::path::Path;
use vos_core::{CommandEnvelope, CommandStatus, artifact, envelope};

pub async fn build_envelope(
    project_root: &Path,
    args: BuildArgs,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let profile = args.profile.clone();
    let request = vos_core::ToolchainGenerationRequest {
        stage: args.stage,
        generator: args.generator,
        generators: args.generators,
        dry_run: args.dry_run,
        toolchain_path: args.toolchain,
    };
    let payload = vos_runtime::build_with_progress(project_root, profile, request, progress)
        .await
        .map_err(|e| e.to_string())?;
    let status = if payload.success {
        CommandStatus::Ok
    } else {
        CommandStatus::Failed
    };
    let mut artifacts = vec![artifact(
        "build_log",
        payload.log_path.display().to_string(),
    )];
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
    artifacts.extend(
        payload
            .phase_results
            .iter()
            .map(|phase| artifact("phase_log", phase.log_path.display().to_string())),
    );
    artifacts.extend(
        payload
            .generated_toolchain_artifacts
            .iter()
            .map(|path| artifact("toolchain_artifact", path.display().to_string())),
    );
    if let Some(meta) = &payload.generation_metadata {
        artifacts.push(artifact(
            "generation_metadata",
            serde_json::to_string(meta).unwrap_or_default(),
        ));
    }
    Ok(envelope(
        "vos build",
        status,
        artifacts,
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}
