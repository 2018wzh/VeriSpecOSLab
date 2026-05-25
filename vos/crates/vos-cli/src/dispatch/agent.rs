use std::path::Path;
use vos_core::{CommandEnvelope, CommandStatus, artifact, envelope, envelope_with_run_id};

use crate::args::{AgentApplyPatchArgs, AgentGenerateArgs};

pub fn agent_context_envelope(
    project_root: &Path,
    stage: Option<&str>,
    visibility: Option<&str>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload =
        vos_agent::agent_context(project_root, stage, visibility).map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos agent context",
        CommandStatus::Ok,
        Vec::new(),
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

pub fn agent_plan_envelope(
    project_root: &Path,
    stage: Option<&str>,
    task: Option<&str>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_agent::agent_plan(project_root, stage, task).map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos agent plan",
        CommandStatus::Ok,
        Vec::new(),
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

pub async fn agent_apply_patch_envelope(
    project_root: &Path,
    args: AgentApplyPatchArgs,
    progress: Option<&vos_agent::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_agent::agent_apply_patch(
        project_root,
        vos_agent::AgentApplyOptions {
            patch_path: args.patch_path,
            apply: args.apply,
            require_spec: args.require_spec,
            run_validation: args.run_validation,
            stage: None,
        },
        progress,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(envelope_with_run_id(
        payload.run_id.clone(),
        "vos agent apply-patch",
        CommandStatus::Ok,
        vec![artifact(
            "manifest",
            payload.manifest_path.display().to_string(),
        )],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

pub async fn agent_generate_envelope(
    project_root: &Path,
    args: AgentGenerateArgs,
    progress: Option<&vos_agent::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_agent::agent_generate(
        project_root,
        vos_agent::AgentGenerateOptions {
            target: args.target,
            from_patch: args.from_patch,
            resume_run: args.resume_run,
            apply: args.apply,
            build: args.build,
            run: args.run,
        },
        progress,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(envelope_with_run_id(
        payload.run_id.clone(),
        "vos agent generate",
        CommandStatus::Ok,
        vec![artifact(
            "manifest",
            payload.manifest_path.display().to_string(),
        )],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}
