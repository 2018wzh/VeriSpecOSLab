use std::fs;
use std::path::Path;

use vos_core::{
    ApplyPatchResult, Result, SkeletonProjectionResponse, SkeletonRetryRecord,
    SkeletonValidationReport, VosError,
};

use crate::build::build_with_progress;
use crate::codegen::generate_module_waves;
use crate::config::{AgentApplyOptions, ProgressSink, load_config};
use crate::evidence::{build_run_manifest, write_json};
use crate::fs_guard::allowed_paths;
use crate::patch::{
    apply_region_edit, read_patch_file, validate_region_edits, validate_skeleton_files,
};
use crate::progress::emit;
use crate::provider::validate_provider_config;
use crate::rig::{RigStage, RigWorkflow};
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
    emit(
        progress,
        "normalizing_spec",
        "normalized strict spec bundle",
    );
    let consistency = vos_spec::check_consistency(project_root, &spec_root, &normalized)?;
    emit(
        progress,
        "checking_consistency",
        "checked cross-spec consistency",
    );
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
    emit(
        progress,
        "composing_architecture",
        "composed architecture graph",
    );
    let _tests = vos_spec::derive_tests(project_root, &spec_root, &stage)?;
    emit(
        progress,
        "deriving_tests",
        "derived public build/run checks",
    );
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

    let mut skeleton_validation_path = None;
    let mut retry_record_path = None;

    let (skeleton_create, skeleton_update, module_region_edits) = if let Some(patch_path) =
        options.patch_path
    {
        let parsed = read_patch_file(&patch_path)?;
        (
            parsed.files_to_create,
            parsed.files_to_update,
            parsed.region_edits,
        )
    } else {
        let workflow = RigWorkflow::new(&config);
        let max_attempts = 2_u32;
        let mut attempts = 0_u32;
        let mut feedback = Vec::<String>::new();
        let skeleton: SkeletonProjectionResponse;
        loop {
            attempts += 1;
            emit(
                progress,
                "projecting_skeleton",
                "requesting skeleton projection",
            );
            let skeleton_prompt = if feedback.is_empty() {
                vos_prompt::build_skeleton_projection_prompt(&normalized, &compose, project_root)
            } else {
                vos_prompt::build_skeleton_retry_prompt(
                    &normalized,
                    &compose,
                    project_root,
                    &feedback,
                )
            };
            let skeleton_response = workflow
                .run_prompt_stage(
                    &run_dir.join(format!("skeleton_projection_attempt_{attempts}")),
                    RigStage::ProviderCall,
                    &skeleton_prompt,
                )
                .await?;
            let parsed = vos_prompt::parse_skeleton_projection_response(&skeleton_response)
                .map_err(VosError::Message)?;
            let report = validate_skeleton_projection(project_root, &normalized, &allowed, &parsed);
            let report_path = run_dir.join("skeleton-validation.json");
            write_json(&report_path, &report)?;
            skeleton_validation_path = Some(report_path);
            if report.ok {
                skeleton = parsed;
                let retry_path = run_dir.join("retry-record.json");
                write_json(
                    &retry_path,
                    &SkeletonRetryRecord {
                        attempts,
                        max_attempts,
                        exit_reason: "passed".into(),
                        feedback: feedback.clone(),
                    },
                )?;
                retry_record_path = Some(retry_path);
                break;
            }
            feedback = report.errors.clone();
            let non_retryable = feedback.iter().any(|e| {
                e.starts_with("policy_violation:")
                    || e.starts_with("schema_error:")
                    || e.starts_with("entry_error:")
            });
            if non_retryable {
                let retry_path = run_dir.join("retry-record.json");
                write_json(
                    &retry_path,
                    &SkeletonRetryRecord {
                        attempts,
                        max_attempts,
                        exit_reason: "non_retryable".into(),
                        feedback: feedback.clone(),
                    },
                )?;
                return Err(VosError::Message(format!(
                    "skeleton projection non-retryable validation failed: {}",
                    feedback.join("; ")
                )));
            }
            if attempts >= max_attempts {
                let retry_path = run_dir.join("retry-record.json");
                write_json(
                    &retry_path,
                    &SkeletonRetryRecord {
                        attempts,
                        max_attempts,
                        exit_reason: "max_attempts".into(),
                        feedback: feedback.clone(),
                    },
                )?;
                return Err(VosError::Message(format!(
                    "skeleton projection validation failed: {}",
                    feedback.join("; ")
                )));
            }
        }
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
    preapply_check(
        project_root,
        &skeleton_create,
        &skeleton_update,
        &module_region_edits,
    )?;

    if options.apply {
        emit(
            progress,
            "applying_code",
            "writing skeleton and region edits",
        );
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
        let build = build_with_progress(
            project_root,
            None,
            vos_core::ToolchainGenerationRequest {
                stage: None,
                generator: None,
                generators: Vec::new(),
                dry_run: false,
                toolchain_path: None,
            },
            progress,
        )
        .await?;
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
        skeleton_validation_path,
        retry_record_path,
    };
    write_json(&run_dir.join("apply-patch-result.json"), &result)?;
    emit(progress, "finished", "agent apply-patch finished");
    Ok(result)
}

fn validate_skeleton_projection(
    project_root: &Path,
    normalized: &vos_core::NormalizedSpecBundle,
    allowed: &[std::path::PathBuf],
    skeleton: &SkeletonProjectionResponse,
) -> SkeletonValidationReport {
    let mut errors = Vec::new();
    let warnings = Vec::new();
    for file in &skeleton.files_to_create {
        let absolute = project_root.join(&file.path);
        if !crate::fs_guard::is_allowed_path(&absolute, allowed) {
            errors.push(format!(
                "policy_violation:file outside allowed paths: {}",
                file.path.display()
            ));
        }
        if file.path.as_os_str().is_empty() || file.create_mode.trim().is_empty() {
            errors.push("schema_error:files_to_create requires non-empty path/create_mode".into());
        }
    }
    for edit in &skeleton.files_to_update {
        let absolute = project_root.join(&edit.file);
        if !crate::fs_guard::is_allowed_path(&absolute, allowed) {
            errors.push(format!(
                "policy_violation:region outside allowed paths: {}",
                edit.file.display()
            ));
        }
        if edit.start_marker.trim().is_empty() || edit.end_marker.trim().is_empty() {
            errors.push(format!(
                "schema_error:files_to_update requires non-empty markers: {}",
                edit.file.display()
            ));
        }
    }
    let required_targets = normalized
        .operations
        .iter()
        .map(|op| op.llm_codegen.editable_region.file.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let created_paths = skeleton
        .files_to_create
        .iter()
        .map(|f| f.path.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let updated_paths = skeleton
        .files_to_update
        .iter()
        .map(|f| f.file.clone())
        .collect::<std::collections::BTreeSet<_>>();
    for required in required_targets {
        if !created_paths.contains(&required)
            && !updated_paths.contains(&required)
            && !project_root.join(&required).exists()
        {
            errors.push(format!(
                "coverage_error:missing required editable target in skeleton output: {}",
                required.display()
            ));
        }
    }

    let linker_script = &normalized.architecture.toolchain.link.linker_script;
    if !project_root.join(linker_script).exists() && !created_paths.contains(linker_script) {
        errors.push(format!(
            "link_error:missing linker script for skeleton: {}",
            linker_script.display()
        ));
    }
    let entry_symbol = normalized.architecture.toolchain.link.entry_symbol.as_str();
    if !entry_symbol.is_empty() {
        let mut found = false;
        for file in &skeleton.files_to_create {
            if file.content.contains(entry_symbol) {
                found = true;
                break;
            }
        }
        if !found {
            for src in &normalized.architecture.toolchain.build.sources {
                if let Ok(content) = fs::read_to_string(project_root.join(src)) {
                    if content.contains(entry_symbol) {
                        found = true;
                        break;
                    }
                }
            }
        }
        if !found {
            for phase in &normalized.architecture.toolchain.build.phases {
                for source in &phase.semantic.sources {
                    let root = source
                        .pattern
                        .split("/**")
                        .next()
                        .unwrap_or(&source.pattern);
                    let candidate = project_root.join(root);
                    if candidate.is_file() {
                        if let Ok(content) = fs::read_to_string(&candidate) {
                            if content.contains(entry_symbol) {
                                found = true;
                                break;
                            }
                        }
                    }
                }
                if found {
                    break;
                }
            }
        }
        if !found {
            errors.push(format!(
                "entry_error:entry symbol not found in skeleton/build sources: {entry_symbol}"
            ));
        }
    }
    SkeletonValidationReport {
        ok: errors.is_empty(),
        errors,
        warnings,
    }
}

fn preapply_check(
    project_root: &Path,
    skeleton_create: &[vos_core::SkeletonFileEdit],
    skeleton_update: &[vos_core::RegionEdit],
    module_region_edits: &[vos_core::RegionEdit],
) -> Result<()> {
    let mut known = std::collections::BTreeMap::new();
    for file in skeleton_create {
        known.insert(file.path.clone(), file.content.clone());
    }
    for edit in skeleton_update.iter().chain(module_region_edits.iter()) {
        let content = if let Some(buffer) = known.get(&edit.file) {
            buffer.clone()
        } else {
            fs::read_to_string(project_root.join(&edit.file)).map_err(|_| {
                VosError::Message(format!(
                    "preapply check failed: target file missing {}",
                    edit.file.display()
                ))
            })?
        };
        if !content.contains(&edit.start_marker) || !content.contains(&edit.end_marker) {
            return Err(VosError::Message(format!(
                "preapply check failed: markers missing in {}",
                edit.file.display()
            )));
        }
    }
    Ok(())
}
