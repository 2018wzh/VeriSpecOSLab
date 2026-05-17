use std::fs;
use std::path::Path;

use vos_core::{ApplyPatchResult, Result, VosError};

use crate::build::build_with_progress;
use crate::config::{load_config, AgentApplyOptions, ProgressSink};
use crate::evidence::{build_run_manifest, write_json};
use crate::fs_guard::allowed_paths;
use crate::patch::{
    apply_region_edit, read_patch_file, validate_region_edits, validate_skeleton_files,
};
use crate::codegen::generate_module_waves;
use crate::progress::emit;
use crate::provider::call_json_prompt;
use crate::provider::validate_provider_config;
use crate::run_qemu::run_qemu_with_progress;
use crate::scope::{current_stage, resolve_spec_root};

pub async fn agent_apply_patch(
    project_root: &Path,
    options: AgentApplyOptions,
    progress: Option<&ProgressSink>,
) -> Result<ApplyPatchResult> {
    let config = load_config(project_root)?;
    validate_provider_config(&config)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let normalized = crate::normalize_spec(project_root, Some(&spec_root))?;
    emit(progress, "normalizing_spec", "normalized strict spec bundle");
    let consistency = vos_spec::check_consistency(project_root, &spec_root, &normalized)?;
    emit(progress, "checking_consistency", "checked cross-spec consistency");
    if !consistency.ok {
        return Err(VosError::Message(format!(
            "consistency check failed: {}",
            consistency.errors.join("; ")
        )));
    }
    let stage = options
        .stage
        .clone()
        .or_else(|| current_stage(&normalized))
        .ok_or_else(|| VosError::Message("no architecture stage found".into()))?;
    let compose = vos_spec::compose_architecture(project_root, &spec_root, &stage)?;
    emit(progress, "composing_architecture", "composed architecture graph");
    let _tests = vos_spec::derive_tests(project_root, &spec_root, &stage)?;
    emit(progress, "deriving_tests", "derived public build/run checks");
    let queue = vos_spec::build_generation_queue(project_root, &spec_root, &stage)?;
    let plan = crate::agent::plan::agent_plan(project_root, Some(&stage), None)?;

    let run_id = vos_core::new_run_id();
    let run_dir = project_root.join(".vos").join("runs").join(&run_id);
    let artifacts_dir = run_dir.join("artifacts");
    fs::create_dir_all(&artifacts_dir)?;
    write_json(&run_dir.join("consistency-report.json"), &consistency)?;
    write_json(&run_dir.join("compose-result.json"), &compose)?;
    write_json(&run_dir.join("agent-plan.json"), &plan)?;

    let mut created_files = Vec::new();
    let mut updated_regions = Vec::new();
    let mut build_result = None;
    let mut run_result = None;
    let allowed = allowed_paths(&normalized, project_root);

    let (skeleton_create, skeleton_update, module_region_edits) = if let Some(patch_path) = options.patch_path {
        let parsed = read_patch_file(&patch_path)?;
        (parsed.files_to_create, parsed.files_to_update, parsed.region_edits)
    } else {
        emit(progress, "projecting_skeleton", "requesting skeleton projection");
        let skeleton_prompt =
            vos_prompt::build_skeleton_projection_prompt(&normalized, &compose, project_root);
        let skeleton_response = call_json_prompt(
            &config,
            &run_dir.join("skeleton_projection"),
            &skeleton_prompt,
        )
        .await?;
        let skeleton = vos_prompt::parse_skeleton_projection_response(&skeleton_response)
            .map_err(VosError::Message)?;
        let batch_region_edits = generate_module_waves(
            project_root,
            &config,
            &normalized,
            &queue,
            progress,
            &run_dir,
        )
        .await?;
        (
            skeleton.files_to_create,
            skeleton.files_to_update,
            batch_region_edits,
        )
    };

    validate_skeleton_files(project_root, &allowed, &skeleton_create)?;
    validate_region_edits(project_root, &allowed, &skeleton_update)?;
    validate_region_edits(project_root, &allowed, &module_region_edits)?;

    if options.apply {
        emit(progress, "applying_code", "writing skeleton and region edits");
        for file in &skeleton_create {
            let absolute = project_root.join(&file.path);
            if let Some(parent) = absolute.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&absolute, &file.content)?;
            created_files.push(file.path.clone());
        }
        for edit in skeleton_update.iter().chain(module_region_edits.iter()) {
            apply_region_edit(project_root, edit)?;
            if !updated_regions.contains(&edit.file) {
                updated_regions.push(edit.file.clone());
            }
        }
        let build = build_with_progress(project_root, None, progress).await?;
        build_result = Some(build.clone());
        emit(progress, "building_system", "built generated system");
        if options.run_validation {
            let run = run_qemu_with_progress(project_root, None, progress).await?;
            run_result = Some(run.clone());
            emit(progress, "running_boot_smoke", "ran qemu boot smoke");
        }
    }

    let manifest = build_run_manifest(
        &run_id,
        "vos agent apply-patch",
        &normalized,
        &created_files,
        &updated_regions,
    );
    let manifest_path = run_dir.join("manifest.json");
    write_json(&manifest_path, &manifest)?;
    let result = ApplyPatchResult {
        run_id,
        created_files,
        updated_regions,
        build: build_result,
        run: run_result,
        manifest_path: manifest_path.clone(),
    };
    write_json(&run_dir.join("apply-patch-result.json"), &result)?;
    emit(progress, "finished", "agent apply-patch finished");
    Ok(result)
}
