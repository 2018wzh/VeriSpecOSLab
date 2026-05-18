use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use vos_core::{
    ArchitectureComposeResult, BuildResult, GenerationQueue, NormalizedSpecBundle, QemuRunResult,
    Result, VosError,
};
use vos_runtime::ProgressSink;

use crate::codegen::generate_module_waves;
use crate::patch::{
    PatchFileInput, apply_region_edit, read_patch_file, validate_region_edits,
    validate_skeleton_files,
};
use crate::rig::{RigStage, RigWorkflow, validate_provider_config};
use crate::{
    RegionEdit, SkeletonFileEdit, SkeletonProjectionResponse, SkeletonRetryRecord,
    SkeletonValidationReport,
};

#[derive(Debug, Clone)]
pub(crate) struct GenerationWorkflowOptions {
    pub command_name: String,
    pub target: Option<String>,
    pub patch_path: Option<PathBuf>,
    pub apply: bool,
    pub execute_build: bool,
    pub execute_run: bool,
    pub stage_override: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GenerationWorkflowResult {
    pub run_id: String,
    pub target_kind: String,
    pub target_value: String,
    pub selected_stage: String,
    pub selected_modules: Vec<String>,
    pub generated_waves: Vec<Vec<String>>,
    pub created_files: Vec<PathBuf>,
    pub updated_regions: Vec<PathBuf>,
    pub applied: bool,
    pub build: Option<BuildResult>,
    pub run: Option<QemuRunResult>,
    pub manifest_path: PathBuf,
    pub skeleton_validation_path: Option<PathBuf>,
    pub retry_record_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct TargetSelection {
    kind: String,
    value: String,
    stage: String,
    modules: Vec<String>,
    compose: ArchitectureComposeResult,
    queue: GenerationQueue,
}

#[derive(Debug, Clone)]
struct PreparedGenerationContext {
    config: vos_core::AppConfig,
    spec_root: PathBuf,
    normalized: NormalizedSpecBundle,
    selection: TargetSelection,
    allowed_paths: Vec<PathBuf>,
    run_id: String,
    run_dir: PathBuf,
}

pub(crate) async fn execute_generation_workflow(
    project_root: &Path,
    options: GenerationWorkflowOptions,
    progress: Option<&ProgressSink>,
) -> Result<GenerationWorkflowResult> {
    validate_generation_flags(&options)?;
    let prepared = prepare_generation_context(project_root, &options, progress)?;
    let PatchArtifacts {
        files_to_create,
        files_to_update,
        region_edits,
        skeleton_validation_path,
        retry_record_path,
    } = match &options.patch_path {
        Some(path) => load_patch_artifacts(path)?,
        None => generate_patch_artifacts(project_root, &prepared, progress).await?,
    };

    validate_generation_outputs(
        project_root,
        &prepared.allowed_paths,
        &files_to_create,
        &files_to_update,
        &region_edits,
    )?;

    let mut created_files = Vec::new();
    let mut updated_regions = Vec::new();
    let mut build_result = None;
    let mut run_result = None;

    if options.apply {
        vos_runtime::emit(
            progress,
            "applying_code",
            "writing generated skeleton and region edits",
        );
        apply_generation_outputs(
            project_root,
            &files_to_create,
            &files_to_update,
            &region_edits,
            &mut created_files,
            &mut updated_regions,
        )?;
    }

    if options.apply && options.execute_build {
        let build = vos_runtime::build_with_progress(
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
        vos_runtime::emit(progress, "building_system", "built generated system");
        build_result = Some(build.clone());
        if options.execute_run {
            let run = vos_runtime::run_qemu_with_progress(project_root, None, progress).await?;
            vos_runtime::emit(progress, "running_boot_smoke", "ran qemu boot smoke");
            run_result = Some(run);
        }
    }

    let manifest = vos_runtime::build_run_manifest(
        &prepared.run_id,
        &options.command_name,
        &prepared.normalized,
        &created_files,
        &updated_regions,
    );
    let manifest_path = prepared.run_dir.join("manifest.json");
    vos_runtime::write_json(&manifest_path, &manifest)?;

    let result = GenerationWorkflowResult {
        run_id: prepared.run_id,
        target_kind: prepared.selection.kind,
        target_value: prepared.selection.value,
        selected_stage: prepared.selection.stage,
        selected_modules: prepared.selection.modules,
        generated_waves: prepared.selection.queue.waves,
        created_files,
        updated_regions,
        applied: options.apply,
        build: build_result,
        run: run_result,
        manifest_path: manifest_path.clone(),
        skeleton_validation_path,
        retry_record_path,
    };
    vos_runtime::write_json(&prepared.run_dir.join("generation-result.json"), &result)?;
    vos_runtime::emit(progress, "finished", "generation workflow finished");
    Ok(result)
}

fn validate_generation_flags(options: &GenerationWorkflowOptions) -> Result<()> {
    if options.execute_build && !options.apply {
        return Err(VosError::Message(
            "--build requires --apply because build runs only after writing files".into(),
        ));
    }
    if options.execute_run && !options.execute_build {
        return Err(VosError::Message(
            "--run requires --build because qemu runs only after a successful build".into(),
        ));
    }
    Ok(())
}

fn prepare_generation_context(
    project_root: &Path,
    options: &GenerationWorkflowOptions,
    progress: Option<&ProgressSink>,
) -> Result<PreparedGenerationContext> {
    let config = vos_runtime::load_config(project_root)?;
    if options.patch_path.is_none() {
        validate_provider_config(&config)?;
    }
    let spec_root = vos_runtime::resolve_spec_root(project_root, None, &config)?;
    let normalized = vos_runtime::normalize_spec(project_root, Some(&spec_root))?;
    vos_runtime::emit(
        progress,
        "normalizing_spec",
        "normalized strict spec bundle",
    );
    let consistency = vos_spec::check_consistency(project_root, &spec_root, &normalized)?;
    vos_runtime::emit(
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
    let selection = resolve_target_selection(project_root, &normalized, &spec_root, options)?;
    vos_runtime::emit(
        progress,
        "composing_architecture",
        "composed architecture graph",
    );
    let _tests = vos_spec::derive_tests(project_root, &spec_root, &selection.stage)?;
    vos_runtime::emit(
        progress,
        "deriving_tests",
        "derived public build/run checks",
    );
    let allowed = vos_runtime::allowed_paths(&normalized, project_root);
    let run_id = vos_core::new_run_id();
    let run_dir = project_root.join(".vos").join("runs").join(&run_id);
    fs::create_dir_all(&run_dir)?;
    vos_runtime::write_json(&run_dir.join("normalized-bundle.json"), &normalized)?;
    vos_runtime::write_json(&run_dir.join("consistency-report.json"), &consistency)?;
    vos_runtime::write_json(&run_dir.join("compose-result.json"), &selection.compose)?;
    vos_runtime::write_json(&run_dir.join("generation-queue.json"), &selection.queue)?;
    let plan = crate::agent_plan(project_root, Some(&selection.stage), None)?;
    vos_runtime::write_json(&run_dir.join("agent-plan.json"), &plan)?;
    Ok(PreparedGenerationContext {
        config,
        spec_root,
        normalized,
        selection,
        allowed_paths: allowed,
        run_id,
        run_dir,
    })
}

fn resolve_target_selection(
    project_root: &Path,
    normalized: &NormalizedSpecBundle,
    spec_root: &Path,
    options: &GenerationWorkflowOptions,
) -> Result<TargetSelection> {
    let current = vos_runtime::current_stage(normalized)
        .or_else(|| normalized.modules.last().map(|module| module.stage.clone()))
        .unwrap_or_else(|| "unknown".into());
    let raw_target = options
        .target
        .clone()
        .or_else(|| options.stage_override.clone())
        .unwrap_or(current);

    let queue_stage =
        if let Some(module) = normalized.modules.iter().find(|m| m.module == raw_target) {
            module.stage.clone()
        } else {
            raw_target.clone()
        };

    let compose = vos_spec::compose_architecture(project_root, spec_root, &queue_stage)?;
    let queue = vos_spec::build_generation_queue(project_root, spec_root, &queue_stage)?;

    if normalized
        .modules
        .iter()
        .any(|module| module.module == raw_target)
    {
        let modules = module_dependency_closure(&raw_target, &queue.blocked_by)?;
        let filtered_compose = filter_compose(&compose, &modules);
        let filtered_queue = filter_queue(&queue, &modules);
        return Ok(TargetSelection {
            kind: "module".into(),
            value: raw_target,
            stage: queue_stage,
            modules,
            compose: filtered_compose,
            queue: filtered_queue,
        });
    }

    if normalized
        .architecture
        .slices
        .iter()
        .any(|slice| slice.stage == raw_target)
    {
        return Ok(TargetSelection {
            kind: "stage".into(),
            value: raw_target,
            stage: queue_stage,
            modules: compose.enabled_modules.clone(),
            compose,
            queue,
        });
    }

    Err(VosError::Message(format!(
        "generation target `{}` is neither a known module nor a known stage",
        raw_target
    )))
}

fn filter_compose(
    compose: &ArchitectureComposeResult,
    modules: &[String],
) -> ArchitectureComposeResult {
    let selected = modules.iter().cloned().collect::<BTreeSet<_>>();
    let module_dependency_dag = compose
        .module_dependency_dag
        .iter()
        .filter(|(module, _)| selected.contains(*module))
        .map(|(module, deps)| {
            (
                module.clone(),
                deps.iter()
                    .filter(|dep| selected.contains(*dep))
                    .cloned()
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    ArchitectureComposeResult {
        current_stage: compose.current_stage.clone(),
        enabled_modules: modules.to_vec(),
        module_dependency_dag,
        skeleton_features: compose.skeleton_features.clone(),
        verification_bindings: compose.verification_bindings.clone(),
    }
}

fn filter_queue(queue: &GenerationQueue, modules: &[String]) -> GenerationQueue {
    let selected = modules.iter().cloned().collect::<BTreeSet<_>>();
    GenerationQueue {
        stage: queue.stage.clone(),
        skeleton_features: queue.skeleton_features.clone(),
        jobs: queue
            .jobs
            .iter()
            .filter(|job| selected.contains(&job.module))
            .cloned()
            .collect(),
        waves: queue
            .waves
            .iter()
            .map(|wave| {
                wave.iter()
                    .filter(|module| selected.contains(*module))
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .filter(|wave| !wave.is_empty())
            .collect(),
        blocked_by: queue
            .blocked_by
            .iter()
            .filter(|(module, _)| selected.contains(*module))
            .map(|(module, deps)| {
                (
                    module.clone(),
                    deps.iter()
                        .filter(|dep| selected.contains(*dep))
                        .cloned()
                        .collect::<Vec<_>>(),
                )
            })
            .collect(),
    }
}

fn module_dependency_closure(
    module: &str,
    blocked_by: &BTreeMap<String, Vec<String>>,
) -> Result<Vec<String>> {
    let mut seen = BTreeSet::new();
    let mut stack = vec![module.to_string()];
    while let Some(current) = stack.pop() {
        if !seen.insert(current.clone()) {
            continue;
        }
        let deps = blocked_by.get(&current).ok_or_else(|| {
            VosError::Message(format!(
                "module `{}` is missing from generation queue dependency graph",
                current
            ))
        })?;
        for dep in deps.iter().rev() {
            stack.push(dep.clone());
        }
    }
    Ok(blocked_by
        .keys()
        .filter(|candidate| seen.contains(*candidate))
        .cloned()
        .collect())
}

#[derive(Debug)]
struct PatchArtifacts {
    files_to_create: Vec<SkeletonFileEdit>,
    files_to_update: Vec<RegionEdit>,
    region_edits: Vec<RegionEdit>,
    skeleton_validation_path: Option<PathBuf>,
    retry_record_path: Option<PathBuf>,
}

fn load_patch_artifacts(path: &Path) -> Result<PatchArtifacts> {
    let PatchFileInput {
        files_to_create,
        files_to_update,
        region_edits,
    } = read_patch_file(path)?;
    Ok(PatchArtifacts {
        files_to_create,
        files_to_update,
        region_edits,
        skeleton_validation_path: None,
        retry_record_path: None,
    })
}

async fn generate_patch_artifacts(
    project_root: &Path,
    prepared: &PreparedGenerationContext,
    progress: Option<&ProgressSink>,
) -> Result<PatchArtifacts> {
    let workflow = RigWorkflow::new(&prepared.config);
    let allowed = &prepared.allowed_paths;
    let max_attempts = 2_u32;
    let mut attempts = 0_u32;
    let mut feedback = Vec::<String>::new();
    let skeleton: SkeletonProjectionResponse;
    let skeleton_validation_path;
    let retry_record_path;

    loop {
        attempts += 1;
        vos_runtime::emit(
            progress,
            "projecting_skeleton",
            "requesting skeleton projection",
        );
        let skeleton_prompt = if feedback.is_empty() {
            vos_prompt::build_skeleton_projection_prompt(
                &prepared.normalized,
                &prepared.selection.compose,
                project_root,
                allowed,
            )
        } else {
            vos_prompt::build_skeleton_retry_prompt(
                &prepared.normalized,
                &prepared.selection.compose,
                project_root,
                allowed,
                &feedback,
            )
        };
        let prompt = crate::PromptEnvelope {
            task_kind: "skeleton_projection".into(),
            phase: "skeleton_projection".into(),
            spec_ref: vos_core::SpecRef {
                module: "architecture".into(),
                operation: prepared.selection.compose.current_stage.clone(),
            },
            allowed_paths: allowed.to_vec(),
            prompt: skeleton_prompt,
        };
        let skeleton_response = workflow
            .run_prompt_stage(
                &prepared
                    .run_dir
                    .join(format!("skeleton_projection_attempt_{attempts}")),
                RigStage::ProviderCall,
                &prompt,
            )
            .await?;
        let parsed = vos_prompt::parse_skeleton_projection_response::<SkeletonProjectionResponse>(
            &skeleton_response,
        )
        .map_err(VosError::Message)?;
        let report = validate_skeleton_projection(
            project_root,
            allowed,
            &prepared.normalized,
            &prepared.selection.modules,
            &parsed,
        );
        let report_path = prepared.run_dir.join("skeleton-validation.json");
        vos_runtime::write_json(&report_path, &report)?;
        if report.ok {
            skeleton = parsed;
            let retry_path = prepared.run_dir.join("retry-record.json");
            vos_runtime::write_json(
                &retry_path,
                &SkeletonRetryRecord {
                    attempts,
                    max_attempts,
                    exit_reason: "passed".into(),
                    feedback: feedback.clone(),
                },
            )?;
            skeleton_validation_path = Some(report_path);
            retry_record_path = Some(retry_path);
            break;
        }
        feedback = report.errors.clone();
        let non_retryable = feedback.iter().any(|e| {
            e.starts_with("policy_violation:")
                || e.starts_with("schema_error:")
                || e.starts_with("entry_error:")
        });
        let retry_path = prepared.run_dir.join("retry-record.json");
        if non_retryable {
            vos_runtime::write_json(
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
            vos_runtime::write_json(
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

    let concurrency_specs = load_selected_concurrency_specs(
        project_root,
        &prepared.spec_root,
        &prepared.selection.modules,
    )?;
    let batch_region_edits = generate_module_waves(
        project_root,
        &prepared.config,
        &prepared.normalized,
        &prepared.selection.queue,
        &concurrency_specs,
        progress,
        &prepared.run_dir,
    )
    .await?;

    Ok(PatchArtifacts {
        files_to_create: skeleton.files_to_create,
        files_to_update: skeleton.files_to_update,
        region_edits: batch_region_edits,
        skeleton_validation_path,
        retry_record_path,
    })
}

fn load_selected_concurrency_specs(
    project_root: &Path,
    spec_root: &Path,
    modules: &[String],
) -> Result<BTreeMap<String, Option<vos_core::ConcurrencySpec>>> {
    let mut specs = BTreeMap::new();
    for module in modules {
        specs.insert(
            module.clone(),
            vos_spec::load_concurrency_spec(project_root, spec_root, module)?,
        );
    }
    Ok(specs)
}

fn validate_generation_outputs(
    project_root: &Path,
    allowed_paths: &[PathBuf],
    files_to_create: &[SkeletonFileEdit],
    files_to_update: &[RegionEdit],
    region_edits: &[RegionEdit],
) -> Result<()> {
    validate_skeleton_files(project_root, allowed_paths, files_to_create)?;
    validate_region_edits(project_root, allowed_paths, files_to_update)?;
    validate_region_edits(project_root, allowed_paths, region_edits)?;
    preapply_check(project_root, files_to_create, files_to_update, region_edits)?;
    Ok(())
}

fn apply_generation_outputs(
    project_root: &Path,
    files_to_create: &[SkeletonFileEdit],
    files_to_update: &[RegionEdit],
    region_edits: &[RegionEdit],
    created_files: &mut Vec<PathBuf>,
    updated_regions: &mut Vec<PathBuf>,
) -> Result<()> {
    for file in files_to_create {
        let absolute = project_root.join(&file.path);
        if let Some(parent) = absolute.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&absolute, &file.content)?;
        created_files.push(file.path.clone());
    }
    for edit in files_to_update.iter().chain(region_edits.iter()) {
        apply_region_edit(project_root, edit)?;
        if !updated_regions.contains(&edit.file) {
            updated_regions.push(edit.file.clone());
        }
    }
    Ok(())
}

fn validate_skeleton_projection(
    project_root: &Path,
    allowed: &[PathBuf],
    normalized: &NormalizedSpecBundle,
    selected_modules: &[String],
    skeleton: &SkeletonProjectionResponse,
) -> SkeletonValidationReport {
    let mut errors = Vec::new();
    let warnings = Vec::new();
    for file in &skeleton.files_to_create {
        let absolute = project_root.join(&file.path);
        if !vos_runtime::is_allowed_path(&absolute, allowed) {
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
        if !vos_runtime::is_allowed_path(&absolute, allowed) {
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
        .filter(|op| selected_modules.contains(&op.module))
        .map(|op| op.llm_codegen.editable_region.file.clone())
        .collect::<BTreeSet<_>>();
    let created_paths = skeleton
        .files_to_create
        .iter()
        .map(|f| f.path.clone())
        .collect::<BTreeSet<_>>();
    let updated_paths = skeleton
        .files_to_update
        .iter()
        .map(|f| f.file.clone())
        .collect::<BTreeSet<_>>();
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
    skeleton_create: &[SkeletonFileEdit],
    skeleton_update: &[RegionEdit],
    module_region_edits: &[RegionEdit],
) -> Result<()> {
    let mut known = BTreeMap::new();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_dependency_closure_keeps_dependency_order() {
        let blocked_by = BTreeMap::from([
            ("boot".to_string(), Vec::new()),
            ("memory".to_string(), vec!["boot".to_string()]),
            ("process".to_string(), vec!["memory".to_string()]),
        ]);

        let modules = module_dependency_closure("process", &blocked_by).expect("closure");

        assert_eq!(modules, vec!["boot", "memory", "process"]);
    }

    #[test]
    fn validate_generation_flags_requires_apply_before_build_and_run() {
        let build_without_apply = validate_generation_flags(&GenerationWorkflowOptions {
            command_name: "vos agent generate".into(),
            target: Some("memory".into()),
            patch_path: None,
            apply: false,
            execute_build: true,
            execute_run: false,
            stage_override: None,
        });
        assert!(build_without_apply.is_err());

        let run_without_build = validate_generation_flags(&GenerationWorkflowOptions {
            command_name: "vos agent generate".into(),
            target: Some("memory".into()),
            patch_path: None,
            apply: true,
            execute_build: false,
            execute_run: true,
            stage_override: None,
        });
        assert!(run_without_build.is_err());
    }
}
