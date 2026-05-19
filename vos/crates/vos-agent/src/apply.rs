use std::path::Path;

use vos_core::Result;
use vos_runtime::ProgressSink;

use crate::ApplyPatchResult;
use crate::config::AgentApplyOptions;
use crate::workflow::{GenerationWorkflowOptions, execute_generation_workflow};

pub async fn agent_apply_patch(
    project_root: &Path,
    options: AgentApplyOptions,
    progress: Option<&ProgressSink>,
) -> Result<ApplyPatchResult> {
    let payload = execute_generation_workflow(
        project_root,
        GenerationWorkflowOptions {
            command_name: "vos agent apply-patch".into(),
            target: None,
            patch_path: options.patch_path,
            apply: options.apply,
            execute_build: options.apply,
            execute_run: options.apply && options.run_validation,
            require_spec: options.require_spec,
            stage_override: options.stage,
        },
        progress,
    )
    .await?;
    Ok(ApplyPatchResult {
        run_id: payload.run_id,
        created_files: payload.created_files,
        updated_regions: payload.updated_regions,
        build: payload.build,
        run: payload.run,
        manifest_path: payload.manifest_path,
        skeleton_validation_path: payload.skeleton_validation_path,
        retry_record_path: payload.retry_record_path,
    })
}
