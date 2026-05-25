use std::path::Path;
use std::sync::Arc;

use vos_core::Result;
use vos_runtime::ProgressSink;

use crate::GenerationRunResult;
use crate::config::AgentGenerateOptions;
use crate::workflow::{GenerationWorkflowOptions, execute_generation_workflow};

pub async fn agent_generate(
    project_root: &Path,
    options: AgentGenerateOptions,
    progress: Option<Arc<ProgressSink>>,
) -> Result<GenerationRunResult> {
    let payload = execute_generation_workflow(
        project_root,
        GenerationWorkflowOptions {
            command_name: "vos agent generate".into(),
            target: options.target.clone(),
            patch_path: options.from_patch,
            resume_run: options.resume_run,
            apply: options.apply,
            execute_build: options.build,
            execute_run: options.run,
            require_spec: false,
            stage_override: None,
        },
        progress,
    )
    .await?;
    Ok(GenerationRunResult {
        run_id: payload.run_id,
        target_kind: payload.target_kind,
        target_value: payload.target_value,
        selected_stage: payload.selected_stage,
        selected_modules: payload.selected_modules,
        generated_waves: payload.generated_waves,
        skeleton_files: payload.created_files,
        updated_regions: payload.updated_regions,
        applied_batches: payload.applied_batches,
        applied: payload.applied,
        build: payload.build,
        run: payload.run,
        manifest_path: payload.manifest_path,
        toolchain_files: payload.toolchain_files,
        toolchain_manifest_path: payload.toolchain_manifest_path,
        toolchain_manifest: payload.toolchain_manifest,
        skeleton_validation_path: payload.skeleton_validation_path,
        retry_record_path: payload.retry_record_path,
    })
}
