use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use vos_core::{
    ArchitectureComposeResult, BuildResult, GenerationQueue, NormalizedSpecBundle, QemuRunResult,
    Result, ToolchainManifest, VosError,
};
use vos_runtime::{ProgressPlan, ProgressSink, ProgressStageDefinition};

use crate::codegen::generate_module_waves;
use crate::patch::{
    PatchFileInput, apply_region_edit, read_patch_file, validate_region_edits,
    validate_required_spec_metadata, validate_skeleton_files,
};
use crate::rig::{RigStage, RigStreamStatus, RigWorkflow, validate_provider_config};
use crate::toolchain::{PreparedToolchainGeneration, generate_local_toolchain};
use crate::{
    AppliedBatchResult, ModuleWaveEdits, RegionEdit, SkeletonFileEdit, SkeletonProjectionResponse,
    SkeletonRetryRecord, SkeletonValidationReport,
};

#[derive(Debug, Clone)]
pub(crate) struct GenerationWorkflowOptions {
    pub command_name: String,
    pub target: Option<String>,
    pub patch_path: Option<PathBuf>,
    pub resume_run: Option<PathBuf>,
    pub apply: bool,
    pub execute_build: bool,
    pub execute_run: bool,
    pub require_spec: bool,
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
    pub applied_batches: Vec<AppliedBatchResult>,
    pub applied: bool,
    pub build: Option<BuildResult>,
    pub run: Option<QemuRunResult>,
    pub manifest_path: PathBuf,
    pub toolchain_files: Vec<PathBuf>,
    pub toolchain_manifest_path: Option<PathBuf>,
    pub toolchain_manifest: Option<ToolchainManifest>,
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
    resume: bool,
}

#[derive(Debug, Clone)]
struct ApplyBatch {
    kind: String,
    label: String,
    modules: Vec<String>,
    files_to_create: Vec<SkeletonFileEdit>,
    files_to_update: Vec<RegionEdit>,
    region_edits: Vec<RegionEdit>,
}

#[derive(Clone)]
struct RunWorkflowLogger {
    file: Arc<Mutex<fs::File>>,
}

impl RunWorkflowLogger {
    fn new(path: &Path, command_name: &str, run_id: &str, resume: bool) -> Result<Self> {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        if file.metadata()?.len() == 0 {
            writeln!(file, "# VOS workflow log")?;
            writeln!(file, "command: {command_name}")?;
            writeln!(file, "run_id: {run_id}")?;
        }
        writeln!(file, "session: {}", if resume { "resume" } else { "start" })?;
        Ok(Self {
            file: Arc::new(Mutex::new(file)),
        })
    }

    fn record_event(&self, scope: &str, event: &vos_core::ProgressEvent) {
        let stage = event.stage_label.as_deref().unwrap_or(&event.stage);
        let stage_percent = event
            .stage_percent
            .map(|value| format!(" stage={value}%"))
            .unwrap_or_default();
        let overall_percent = event
            .overall_percent
            .map(|value| format!(" overall={value}%"))
            .unwrap_or_default();
        let entity = match (&event.entity_kind, &event.entity_id) {
            (Some(kind), Some(id)) => format!(" {kind}={id}"),
            (Some(kind), None) => format!(" {kind}"),
            _ => String::new(),
        };
        self.record_line(format!(
            "[{scope}] {stage}{stage_percent}{overall_percent}{entity} :: {}",
            event.message
        ));
    }

    fn record_message(&self, scope: &str, message: &str) {
        self.record_line(format!("[{scope}] {message}"));
    }

    fn record_line(&self, line: String) {
        let mut file = self
            .file
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = writeln!(file, "{line}");
    }
}

fn emit_workflow_progress(
    logger: &RunWorkflowLogger,
    upstream: Option<&ProgressSink>,
    scope: &str,
    event: vos_core::ProgressEvent,
) {
    logger.record_event(scope, &event);
    if let Some(sink) = upstream {
        sink(event);
    }
}

pub(crate) async fn execute_generation_workflow(
    project_root: &Path,
    options: GenerationWorkflowOptions,
    progress: Option<Arc<ProgressSink>>,
) -> Result<GenerationWorkflowResult> {
    validate_generation_flags(&options)?;
    let progress_plan = generation_progress_plan(&options);
    let (workflow_run_id, workflow_run_dir, workflow_resume) =
        resolve_generation_run_dir(project_root, &options)?;
    fs::create_dir_all(&workflow_run_dir)
        .map_err(|err| annotate_run_error(&workflow_run_id, VosError::Message(err.to_string())))?;
    let workflow_logger = RunWorkflowLogger::new(
        &workflow_run_dir.join("workflow.log"),
        &options.command_name,
        &workflow_run_id,
        workflow_resume,
    )
    .map_err(|err| annotate_run_error(&workflow_run_id, err))?;
    let workflow_progress_logger = workflow_logger.clone();
    let upstream_progress = progress.clone();
    let workflow_progress = move |event: vos_core::ProgressEvent| {
        emit_workflow_progress(
            &workflow_progress_logger,
            upstream_progress.as_deref(),
            "workflow",
            event,
        );
    };
    let prepared = prepare_generation_context(
        project_root,
        &options,
        Some(&workflow_progress),
        &progress_plan,
        workflow_run_id.clone(),
        workflow_run_dir,
        workflow_resume,
    )
    .map_err(|err| log_and_annotate_run_error(&workflow_run_id, &workflow_logger, err))?;
    let PatchArtifacts {
        apply_batches,
        skeleton_validation_path,
        retry_record_path,
    } = match &options.patch_path {
        Some(path) => load_patch_artifacts(
            path,
            options.require_spec,
            &prepared.normalized,
            &prepared.selection.queue,
        )?,
        None => generate_patch_artifacts(
            project_root,
            &prepared,
            Some(&workflow_progress),
            &progress_plan,
        )
        .await
        .map_err(|err| log_and_annotate_run_error(&workflow_run_id, &workflow_logger, err))?,
    };

    validate_generation_outputs(project_root, &prepared.allowed_paths, &apply_batches)
        .map_err(|err| log_and_annotate_run_error(&workflow_run_id, &workflow_logger, err))?;

    let mut created_files = Vec::new();
    let mut updated_regions = Vec::new();
    let mut applied_batches = Vec::new();
    let mut toolchain_files = Vec::new();
    let mut toolchain_manifest_path = None;
    let mut toolchain_manifest = None;
    let mut build_result = None;
    let mut run_result = None;

    if options.apply {
        progress_plan.emit_stage(
            Some(&workflow_progress),
            "apply_code",
            "writing generated batches",
        );
        apply_generation_batches(
            project_root,
            &apply_batches,
            Some(&workflow_progress),
            &progress_plan,
            &mut created_files,
            &mut updated_regions,
            &mut applied_batches,
        )
        .map_err(|err| log_and_annotate_run_error(&workflow_run_id, &workflow_logger, err))?;

        progress_plan.emit_stage(
            Some(&workflow_progress),
            "generate_toolchain",
            "generating local build system",
        );
        let toolchain = generate_local_toolchain(
            project_root,
            &PreparedToolchainGeneration {
                current_stage: prepared.selection.stage.clone(),
                enabled_modules: prepared.selection.modules.clone(),
                run_id: prepared.run_id.clone(),
                run_dir: prepared.run_dir.clone(),
                spec_root: prepared.spec_root.clone(),
                config: prepared.config.clone(),
                normalized: prepared.normalized.clone(),
            },
            Some(&workflow_progress),
            &progress_plan,
        )
        .await
        .map_err(|err| log_and_annotate_run_error(&workflow_run_id, &workflow_logger, err))?;
        toolchain_files = toolchain.files;
        toolchain_manifest_path = Some(toolchain.manifest_path);
        toolchain_manifest = Some(toolchain.manifest);
    }

    if options.apply && options.execute_build {
        progress_plan.emit_stage(
            Some(&workflow_progress),
            "build_generated_system",
            "building generated system",
        );
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
            None,
        )
        .await
        .map_err(|err| log_and_annotate_run_error(&workflow_run_id, &workflow_logger, err))?;
        workflow_logger.record_message(
            "build",
            &format!(
                "build completed; aggregate log: {}",
                build.log_path.display()
            ),
        );
        progress_plan.finish_stage(
            Some(&workflow_progress),
            "build_generated_system",
            "built generated system",
        );
        build_result = Some(build.clone());
        if options.execute_run {
            progress_plan.emit_stage(
                Some(&workflow_progress),
                "run_generated_system",
                "running generated system",
            );
            let run = vos_runtime::run_qemu_with_progress(project_root, None, None)
                .await
                .map_err(|err| {
                    log_and_annotate_run_error(&workflow_run_id, &workflow_logger, err)
                })?;
            workflow_logger.record_message(
                "run",
                &format!("run completed; qemu log: {}", run.log_path.display()),
            );
            progress_plan.finish_stage(
                Some(&workflow_progress),
                "run_generated_system",
                "ran qemu boot smoke",
            );
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
    vos_runtime::write_json(&manifest_path, &manifest)
        .map_err(|err| log_and_annotate_run_error(&workflow_run_id, &workflow_logger, err))?;

    let result = GenerationWorkflowResult {
        run_id: prepared.run_id,
        target_kind: prepared.selection.kind,
        target_value: prepared.selection.value,
        selected_stage: prepared.selection.stage,
        selected_modules: prepared.selection.modules,
        generated_waves: prepared.selection.queue.waves,
        created_files,
        updated_regions,
        applied_batches,
        applied: options.apply,
        build: build_result,
        run: run_result,
        manifest_path: manifest_path.clone(),
        toolchain_files,
        toolchain_manifest_path,
        toolchain_manifest,
        skeleton_validation_path,
        retry_record_path,
    };
    vos_runtime::write_json(&prepared.run_dir.join("generation-result.json"), &result)
        .map_err(|err| log_and_annotate_run_error(&workflow_run_id, &workflow_logger, err))?;
    progress_plan.finish_stage(
        Some(&workflow_progress),
        "write_manifest",
        "wrote generation manifest and result",
    );
    progress_plan.finish(Some(&workflow_progress), "generation workflow finished");
    workflow_logger.record_message(
        "workflow",
        "workflow result written to generation-result.json",
    );
    Ok(result)
}

fn annotate_run_error(run_id: &str, err: VosError) -> VosError {
    VosError::Message(format!("[run_id:{run_id}] {err}"))
}

fn log_and_annotate_run_error(run_id: &str, logger: &RunWorkflowLogger, err: VosError) -> VosError {
    logger.record_message("workflow", &format!("error: {err}"));
    annotate_run_error(run_id, err)
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
    progress_plan: &ProgressPlan,
    run_id: String,
    run_dir: PathBuf,
    resume: bool,
) -> Result<PreparedGenerationContext> {
    let config = vos_runtime::load_config(project_root)?;
    if options.patch_path.is_none() {
        validate_provider_config(&config)?;
    }
    let spec_root = vos_runtime::resolve_spec_root(project_root, None, &config)?;
    let normalized = vos_runtime::normalize_spec(project_root, Some(&spec_root))?;
    progress_plan.emit_stage_count(
        progress,
        "prepare_generation_context",
        "normalized strict spec bundle",
        Some("step"),
        Some("normalize"),
        1,
        5,
    );
    let consistency = vos_spec::check_consistency(project_root, &spec_root, &normalized)?;
    progress_plan.emit_stage_count(
        progress,
        "prepare_generation_context",
        "checked cross-spec consistency",
        Some("step"),
        Some("consistency"),
        2,
        5,
    );
    if !consistency.ok {
        return Err(VosError::Message(format!(
            "consistency check failed: {}",
            consistency.errors.join("; ")
        )));
    }
    let selection = resolve_target_selection(project_root, &normalized, &spec_root, options)?;
    progress_plan.emit_stage_count(
        progress,
        "prepare_generation_context",
        "composed architecture graph",
        Some("step"),
        Some("compose"),
        3,
        5,
    );
    let _tests = vos_spec::derive_tests(project_root, &spec_root, &selection.stage)?;
    progress_plan.emit_stage_count(
        progress,
        "prepare_generation_context",
        "derived public build/run checks",
        Some("step"),
        Some("tests"),
        4,
        5,
    );
    let allowed = vos_runtime::allowed_paths(&normalized, project_root);
    fs::create_dir_all(&run_dir)?;
    let run_message = if resume {
        format!("resuming run directory {}", run_dir.display())
    } else {
        format!("created run directory {}", run_dir.display())
    };
    progress_plan.emit_stage_count(
        progress,
        "prepare_generation_context",
        &run_message,
        Some("run_id"),
        Some(&run_id),
        5,
        5,
    );
    progress_plan.emit_stage_count(
        progress,
        "prepare_generation_context",
        "prepared generation plan",
        Some("step"),
        Some("plan"),
        5,
        5,
    );
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
        resume,
    })
}

fn resolve_generation_run_dir(
    project_root: &Path,
    options: &GenerationWorkflowOptions,
) -> Result<(String, PathBuf, bool)> {
    let Some(resume_run) = &options.resume_run else {
        let run_id = vos_core::new_run_id();
        let run_dir = project_root.join(".vos").join("runs").join(&run_id);
        return Ok((run_id, run_dir, false));
    };
    let run_dir = if resume_run.components().count() == 1 {
        project_root.join(".vos").join("runs").join(resume_run)
    } else if resume_run.is_absolute() {
        resume_run.clone()
    } else {
        project_root.join(resume_run)
    };
    let run_id = run_dir
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| {
            VosError::Message(format!(
                "resume run path must end with a run id: {}",
                run_dir.display()
            ))
        })?
        .to_string();
    Ok((run_id, run_dir, true))
}

fn resolve_target_selection(
    project_root: &Path,
    normalized: &NormalizedSpecBundle,
    spec_root: &Path,
    options: &GenerationWorkflowOptions,
) -> Result<TargetSelection> {
    let explicit_target = options.target.clone();
    let raw_target = explicit_target
        .clone()
        .or_else(|| options.stage_override.clone())
        .or_else(|| vos_runtime::current_stage(normalized))
        .or_else(|| normalized.modules.last().map(|module| module.stage.clone()))
        .ok_or_else(|| {
            VosError::Message(
                "default whole-system generation requires spec to define a current stage".into(),
            )
        })?;

    let queue_stage =
        if let Some(module) = normalized.modules.iter().find(|m| m.module == raw_target) {
            module.stage.clone()
        } else {
            raw_target.clone()
        };

    let compose = vos_spec::compose_architecture(project_root, spec_root, &queue_stage)?;
    let queue = vos_spec::build_generation_queue(project_root, spec_root, &queue_stage)?;

    if explicit_target.is_some()
        && normalized
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
    apply_batches: Vec<ApplyBatch>,
    skeleton_validation_path: Option<PathBuf>,
    retry_record_path: Option<PathBuf>,
}

fn load_patch_artifacts(
    path: &Path,
    require_spec: bool,
    normalized: &NormalizedSpecBundle,
    queue: &GenerationQueue,
) -> Result<PatchArtifacts> {
    let patch = read_patch_file(path)?;
    if require_spec {
        validate_required_spec_metadata(&patch, normalized)?;
    }
    Ok(PatchArtifacts {
        apply_batches: build_patch_apply_batches(normalized, queue, patch)?,
        skeleton_validation_path: None,
        retry_record_path: None,
    })
}

async fn generate_patch_artifacts(
    project_root: &Path,
    prepared: &PreparedGenerationContext,
    progress: Option<&ProgressSink>,
    progress_plan: &ProgressPlan,
) -> Result<PatchArtifacts> {
    let workflow = RigWorkflow::new(&prepared.config);
    let allowed = &prepared.allowed_paths;
    let max_attempts = 2_u32;
    let mut attempts = 0_u32;
    let mut feedback = Vec::<String>::new();
    let skeleton: SkeletonProjectionResponse;
    let skeleton_validation_path;
    let retry_record_path;
    let existing_attempts = count_existing_skeleton_attempts(&prepared.run_dir)?;

    if prepared.resume {
        if let Some(cached) =
            load_completed_skeleton_projection(project_root, prepared, progress, progress_plan)?
        {
            return generate_patch_artifacts_from_skeleton(
                project_root,
                prepared,
                progress,
                progress_plan,
                cached.skeleton,
                cached.validation_path,
                cached.retry_record_path,
            )
            .await;
        }
    }

    loop {
        attempts += 1;
        let attempt_number = existing_attempts + attempts;
        progress_plan.emit_stage(
            progress,
            "project_skeleton",
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
        let skeleton_stream_progress = |status| {
            let (message, percent) = match status {
                RigStreamStatus::Thinking => ("thinking about skeleton projection", 5),
                RigStreamStatus::Generating => ("generating skeleton projection", 80),
            };
            progress_plan.emit_stage_progress(
                progress,
                "project_skeleton",
                message,
                percent,
                Some("attempt"),
                Some(&attempt_number.to_string()),
                Some(attempts as usize),
                Some(max_attempts as usize),
            );
        };
        let skeleton_response = workflow
            .run_prompt_stage(
                &prepared
                    .run_dir
                    .join(format!("skeleton_projection_attempt_{attempt_number}")),
                RigStage::ProviderCall,
                &prompt,
                Some(&skeleton_stream_progress),
            )
            .await?;
        let parsed = vos_prompt::parse_skeleton_projection_response::<SkeletonProjectionResponse>(
            &skeleton_response,
        )
        .map_err(VosError::Message)?;
        progress_plan.finish_stage(progress, "project_skeleton", "received skeleton projection");
        let report = validate_skeleton_projection(
            project_root,
            allowed,
            &prepared.normalized,
            &prepared.selection.modules,
            &parsed,
        );
        progress_plan.emit_stage_progress(
            progress,
            "validate_skeleton",
            if report.ok {
                "skeleton projection passed validation"
            } else {
                "skeleton projection failed validation"
            },
            if report.ok {
                100
            } else {
                ((attempts * 100) / max_attempts).min(100) as u8
            },
            Some("attempt"),
            Some(&attempts.to_string()),
            Some(attempts as usize),
            Some(max_attempts as usize),
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
        let retry_feedback = summarize_skeleton_feedback(&report.errors);
        let non_retryable = report
            .errors
            .iter()
            .any(|e| e.starts_with("policy_violation:") || e.starts_with("schema_error:"));
        let retry_path = prepared.run_dir.join("retry-record.json");
        if non_retryable {
            vos_runtime::write_json(
                &retry_path,
                &SkeletonRetryRecord {
                    attempts,
                    max_attempts,
                    exit_reason: "non_retryable".into(),
                    feedback: retry_feedback.clone(),
                },
            )?;
            return Err(VosError::Message(format!(
                "skeleton projection non-retryable validation failed: {}",
                report.errors.join("; ")
            )));
        }
        if attempts >= max_attempts {
            vos_runtime::write_json(
                &retry_path,
                &SkeletonRetryRecord {
                    attempts,
                    max_attempts,
                    exit_reason: "max_attempts".into(),
                    feedback: retry_feedback.clone(),
                },
            )?;
            return Err(VosError::Message(format!(
                "skeleton projection validation failed: {}",
                report.errors.join("; ")
            )));
        }
        feedback = retry_feedback;
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
        &skeleton.files_to_create,
        progress,
        progress_plan,
        &prepared.run_dir,
        prepared.resume,
    )
    .await?;

    Ok(PatchArtifacts {
        apply_batches: build_generation_apply_batches(
            skeleton.files_to_create,
            skeleton.files_to_update,
            batch_region_edits,
        ),
        skeleton_validation_path,
        retry_record_path,
    })
}

#[derive(Debug)]
struct CachedSkeletonProjection {
    skeleton: SkeletonProjectionResponse,
    validation_path: Option<PathBuf>,
    retry_record_path: Option<PathBuf>,
}

async fn generate_patch_artifacts_from_skeleton(
    project_root: &Path,
    prepared: &PreparedGenerationContext,
    progress: Option<&ProgressSink>,
    progress_plan: &ProgressPlan,
    skeleton: SkeletonProjectionResponse,
    skeleton_validation_path: Option<PathBuf>,
    retry_record_path: Option<PathBuf>,
) -> Result<PatchArtifacts> {
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
        &skeleton.files_to_create,
        progress,
        progress_plan,
        &prepared.run_dir,
        prepared.resume,
    )
    .await?;

    Ok(PatchArtifacts {
        apply_batches: build_generation_apply_batches(
            skeleton.files_to_create,
            skeleton.files_to_update,
            batch_region_edits,
        ),
        skeleton_validation_path,
        retry_record_path,
    })
}

fn load_completed_skeleton_projection(
    project_root: &Path,
    prepared: &PreparedGenerationContext,
    progress: Option<&ProgressSink>,
    progress_plan: &ProgressPlan,
) -> Result<Option<CachedSkeletonProjection>> {
    let mut attempts = skeleton_attempt_dirs(&prepared.run_dir)?;
    attempts.sort();
    attempts.reverse();
    for attempt_dir in attempts {
        let response_path = attempt_dir.join("response.txt");
        if !response_path.exists() {
            continue;
        }
        let raw = fs::read_to_string(&response_path)?;
        let Ok(skeleton) =
            vos_prompt::parse_skeleton_projection_response::<SkeletonProjectionResponse>(&raw)
                .map_err(VosError::Message)
        else {
            continue;
        };
        let report = validate_skeleton_projection(
            project_root,
            &prepared.allowed_paths,
            &prepared.normalized,
            &prepared.selection.modules,
            &skeleton,
        );
        if !report.ok {
            continue;
        }
        progress_plan.finish_stage(
            progress,
            "project_skeleton",
            &format!("reusing skeleton projection from {}", attempt_dir.display()),
        );
        return Ok(Some(CachedSkeletonProjection {
            skeleton,
            validation_path: existing_file(prepared.run_dir.join("skeleton-validation.json")),
            retry_record_path: existing_file(prepared.run_dir.join("retry-record.json")),
        }));
    }
    Ok(None)
}

fn count_existing_skeleton_attempts(run_dir: &Path) -> Result<u32> {
    Ok(skeleton_attempt_dirs(run_dir)?.len() as u32)
}

fn skeleton_attempt_dirs(run_dir: &Path) -> Result<Vec<PathBuf>> {
    if !run_dir.exists() {
        return Ok(Vec::new());
    }
    let mut attempts = Vec::new();
    for entry in fs::read_dir(run_dir)? {
        let path = entry?.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("skeleton_projection_attempt_"))
        {
            attempts.push(path);
        }
    }
    Ok(attempts)
}

fn existing_file(path: PathBuf) -> Option<PathBuf> {
    path.exists().then_some(path)
}

fn summarize_skeleton_feedback(errors: &[String]) -> Vec<String> {
    let mut summaries = Vec::new();

    let missing_targets = errors
        .iter()
        .filter_map(|error| {
            error
                .strip_prefix(
                    "coverage_error:missing required editable target in skeleton output: ",
                )
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    if !missing_targets.is_empty() {
        summaries.push(format!(
            "Create or update every required editable target in the skeleton output. Missing targets: {}.",
            missing_targets.join(", ")
        ));
    }

    let missing_markers = errors
        .iter()
        .filter_map(|error| {
            error
                .strip_prefix(
                    "coverage_error:missing required editable region markers in skeleton output: ",
                )
                .or_else(|| {
                    error.strip_prefix(
                        "coverage_error:missing required editable region markers in existing target: ",
                    )
                })
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    if !missing_markers.is_empty() {
        summaries.push(format!(
            "Place every required start_marker/end_marker pair exactly in the target skeleton files. Missing marker regions: {}.",
            missing_markers.join("; ")
        ));
    }

    let missing_updated_targets = errors
        .iter()
        .filter_map(|error| {
            error
                .strip_prefix(
                    "coverage_error:files_to_update cannot create missing editable target: ",
                )
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    if !missing_updated_targets.is_empty() {
        summaries.push(format!(
            "Use files_to_create, not files_to_update, for editable targets that do not yet exist. Missing files: {}.",
            missing_updated_targets.join(", ")
        ));
    }

    let missing_linkers = errors
        .iter()
        .filter_map(|error| {
            error
                .strip_prefix("link_error:missing linker script for skeleton: ")
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    if !missing_linkers.is_empty() {
        summaries.push(format!(
            "Include the linker script in files_to_create or ensure it already exists: {}.",
            missing_linkers.join(", ")
        ));
    }

    let missing_entries = errors
        .iter()
        .filter_map(|error| {
            error
                .strip_prefix("entry_error:entry symbol not found in skeleton/build sources: ")
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    if !missing_entries.is_empty() {
        summaries.push(format!(
            "Define the required entry symbol in the generated skeleton or build sources: {}.",
            missing_entries.join(", ")
        ));
    }

    summaries.extend(errors.iter().filter_map(|error| {
        if error.starts_with("coverage_error:")
            || error.starts_with("link_error:")
            || error.starts_with("entry_error:")
        {
            None
        } else {
            Some(error.clone())
        }
    }));

    if summaries.is_empty() {
        errors.to_vec()
    } else {
        summaries
    }
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

fn build_generation_apply_batches(
    files_to_create: Vec<SkeletonFileEdit>,
    files_to_update: Vec<RegionEdit>,
    module_waves: Vec<ModuleWaveEdits>,
) -> Vec<ApplyBatch> {
    let mut batches = Vec::new();
    if !files_to_create.is_empty() || !files_to_update.is_empty() {
        batches.push(ApplyBatch {
            kind: "base".into(),
            label: "base batch".into(),
            modules: Vec::new(),
            files_to_create,
            files_to_update,
            region_edits: Vec::new(),
        });
    }
    for wave in module_waves {
        batches.push(ApplyBatch {
            kind: "wave".into(),
            label: format!("wave {}", wave.wave_index + 1),
            modules: wave.modules,
            files_to_create: Vec::new(),
            files_to_update: Vec::new(),
            region_edits: wave.region_edits,
        });
    }
    batches
}

fn build_patch_apply_batches(
    normalized: &NormalizedSpecBundle,
    queue: &GenerationQueue,
    patch: PatchFileInput,
) -> Result<Vec<ApplyBatch>> {
    let PatchFileInput {
        operation_refs,
        files_to_create,
        files_to_update,
        region_edits,
        ..
    } = patch;
    let base_batch = ApplyBatch {
        kind: "base".into(),
        label: "base batch".into(),
        modules: Vec::new(),
        files_to_create,
        files_to_update,
        region_edits: Vec::new(),
    };

    let fallback = || {
        let mut batches = Vec::new();
        if !base_batch.files_to_create.is_empty() || !base_batch.files_to_update.is_empty() {
            batches.push(base_batch.clone());
        }
        if !region_edits.is_empty() {
            batches.push(ApplyBatch {
                kind: "patch".into(),
                label: "patch batch".into(),
                modules: Vec::new(),
                files_to_create: Vec::new(),
                files_to_update: Vec::new(),
                region_edits: region_edits.clone(),
            });
        }
        batches
    };

    if operation_refs.is_empty() || region_edits.is_empty() {
        return Ok(fallback());
    }

    let mut module_by_region = BTreeMap::new();
    for reference in &operation_refs {
        let Some(op) = normalized
            .operations
            .iter()
            .find(|op| workflow_operation_ref_matches(op, reference))
        else {
            return Ok(fallback());
        };
        let region = &op.llm_codegen.editable_region;
        module_by_region.insert(
            (
                region.file.clone(),
                region.start_marker.clone(),
                region.end_marker.clone(),
            ),
            op.module.clone(),
        );
    }

    let wave_by_module = queue
        .waves
        .iter()
        .enumerate()
        .flat_map(|(wave_index, modules)| {
            modules
                .iter()
                .cloned()
                .map(move |module| (module, wave_index))
        })
        .collect::<BTreeMap<_, _>>();

    let mut grouped = BTreeMap::<usize, ApplyBatch>::new();
    for edit in &region_edits {
        let Some(module) = module_by_region.get(&(
            edit.file.clone(),
            edit.start_marker.clone(),
            edit.end_marker.clone(),
        )) else {
            return Ok(fallback());
        };
        let Some(&wave_index) = wave_by_module.get(module) else {
            return Ok(fallback());
        };
        let entry = grouped.entry(wave_index).or_insert_with(|| ApplyBatch {
            kind: "wave".into(),
            label: format!("wave {}", wave_index + 1),
            modules: Vec::new(),
            files_to_create: Vec::new(),
            files_to_update: Vec::new(),
            region_edits: Vec::new(),
        });
        entry.modules.push(module.clone());
        entry.region_edits.push(edit.clone());
    }

    let mut batches = Vec::new();
    if !base_batch.files_to_create.is_empty() || !base_batch.files_to_update.is_empty() {
        batches.push(base_batch);
    }
    for (_, mut batch) in grouped {
        batch.modules.sort();
        batch.modules.dedup();
        batches.push(batch);
    }
    Ok(batches)
}

fn workflow_operation_ref_matches(op: &vos_core::OperationContract, reference: &str) -> bool {
    reference == op.id
        || reference == op.operation
        || reference == format!("{}.{}", op.module, op.operation)
        || reference == format!("{}:{}", op.module, op.operation)
}

fn validate_generation_outputs(
    project_root: &Path,
    allowed_paths: &[PathBuf],
    batches: &[ApplyBatch],
) -> Result<()> {
    for batch in batches {
        validate_skeleton_files(project_root, allowed_paths, &batch.files_to_create)?;
        validate_region_edits(project_root, allowed_paths, &batch.files_to_update)?;
        validate_region_edits(project_root, allowed_paths, &batch.region_edits)?;
    }
    Ok(())
}

fn preapply_batch(project_root: &Path, batch: &ApplyBatch) -> Result<()> {
    let mut known = BTreeMap::new();
    for file in &batch.files_to_create {
        known.insert(file.path.clone(), file.content.clone());
    }
    for edit in batch
        .files_to_update
        .iter()
        .chain(batch.region_edits.iter())
    {
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

fn apply_generation_batches(
    project_root: &Path,
    batches: &[ApplyBatch],
    progress: Option<&ProgressSink>,
    progress_plan: &ProgressPlan,
    created_files: &mut Vec<PathBuf>,
    updated_regions: &mut Vec<PathBuf>,
    applied_batches: &mut Vec<AppliedBatchResult>,
) -> Result<()> {
    let total_writes = batches
        .iter()
        .map(|batch| {
            batch.files_to_create.len() + batch.files_to_update.len() + batch.region_edits.len()
        })
        .sum::<usize>();
    let mut written = 0usize;
    if total_writes == 0 {
        progress_plan.finish_stage(progress, "apply_code", "no generated file edits to apply");
        return Ok(());
    }
    let total_batches = batches.len();
    for (batch_index, batch) in batches.iter().enumerate() {
        preapply_batch(project_root, batch)?;
        progress_plan.emit_stage_count(
            progress,
            "apply_code",
            &format!("applying {}", batch.label),
            Some("batch"),
            Some(&batch.label),
            batch_index + 1,
            total_batches,
        );
        let mut batch_created = Vec::new();
        let mut batch_updated = Vec::new();
        for file in &batch.files_to_create {
            let absolute = project_root.join(&file.path);
            if let Some(parent) = absolute.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&absolute, &file.content)?;
            created_files.push(file.path.clone());
            batch_created.push(file.path.clone());
            written += 1;
            progress_plan.emit_stage_count(
                progress,
                "apply_code",
                &format!("{}: created generated skeleton file", batch.label),
                Some("file"),
                Some(&file.path.display().to_string()),
                written,
                total_writes,
            );
        }
        for edit in batch
            .files_to_update
            .iter()
            .chain(batch.region_edits.iter())
        {
            apply_region_edit(project_root, edit)?;
            if !updated_regions.contains(&edit.file) {
                updated_regions.push(edit.file.clone());
            }
            if !batch_updated.contains(&edit.file) {
                batch_updated.push(edit.file.clone());
            }
            written += 1;
            progress_plan.emit_stage_count(
                progress,
                "apply_code",
                &format!("{}: updated generated editable region", batch.label),
                Some("file"),
                Some(&edit.file.display().to_string()),
                written,
                total_writes,
            );
        }
        applied_batches.push(AppliedBatchResult {
            kind: batch.kind.clone(),
            label: batch.label.clone(),
            modules: batch.modules.clone(),
            created_files: batch_created,
            updated_regions: batch_updated,
        });
    }
    Ok(())
}

fn generation_progress_plan(options: &GenerationWorkflowOptions) -> ProgressPlan {
    let mut stages = vec![ProgressStageDefinition {
        key: "prepare_generation_context",
        label: "准备生成上下文",
        weight: 15,
    }];
    if options.patch_path.is_none() {
        stages.extend([
            ProgressStageDefinition {
                key: "project_skeleton",
                label: "骨架投影",
                weight: 15,
            },
            ProgressStageDefinition {
                key: "validate_skeleton",
                label: "骨架校验/重试",
                weight: 10,
            },
            ProgressStageDefinition {
                key: "generate_modules",
                label: "模块批量生成",
                weight: 35,
            },
        ]);
    }
    if options.apply {
        stages.push(ProgressStageDefinition {
            key: "apply_code",
            label: "应用代码变更",
            weight: 8,
        });
        stages.push(ProgressStageDefinition {
            key: "generate_toolchain",
            label: "生成本地构建系统",
            weight: 7,
        });
    }
    if options.apply && options.execute_build {
        stages.push(ProgressStageDefinition {
            key: "build_generated_system",
            label: "构建生成结果",
            weight: 10,
        });
    }
    if options.apply && options.execute_run {
        stages.push(ProgressStageDefinition {
            key: "run_generated_system",
            label: "运行生成结果",
            weight: 3,
        });
    }
    stages.push(ProgressStageDefinition {
        key: "write_manifest",
        label: "写 manifest 与收尾",
        weight: 2,
    });
    ProgressPlan::new(stages)
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
    let created_paths = skeleton
        .files_to_create
        .iter()
        .map(|f| f.path.clone())
        .collect::<BTreeSet<_>>();
    let created_content = skeleton
        .files_to_create
        .iter()
        .map(|f| (f.path.clone(), f.content.as_str()))
        .collect::<BTreeMap<_, _>>();
    let updated_paths = skeleton
        .files_to_update
        .iter()
        .map(|f| f.file.clone())
        .collect::<BTreeSet<_>>();
    for operation in normalized
        .operations
        .iter()
        .filter(|op| selected_modules.contains(&op.module))
    {
        let region = &operation.llm_codegen.editable_region;
        let required = &region.file;
        let existing_path = project_root.join(required);
        if let Some(content) = created_content.get(required) {
            if !content.contains(&region.start_marker) || !content.contains(&region.end_marker) {
                errors.push(format!(
                    "coverage_error:missing required editable region markers in skeleton output: {} [{} .. {}]",
                    required.display(),
                    region.start_marker,
                    region.end_marker
                ));
            }
        } else if existing_path.exists() {
            match fs::read_to_string(&existing_path) {
                Ok(content)
                    if content.contains(&region.start_marker)
                        && content.contains(&region.end_marker) => {}
                _ => errors.push(format!(
                    "coverage_error:missing required editable region markers in existing target: {} [{} .. {}]",
                    required.display(),
                    region.start_marker,
                    region.end_marker
                )),
            }
        } else if updated_paths.contains(required) {
            errors.push(format!(
                "coverage_error:files_to_update cannot create missing editable target: {}",
                required.display()
            ));
        } else if !created_paths.contains(required) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;
    use vos_core::{
        ArchitectureCompositionSpec, ArchitectureSeed, ArchitectureSpecBundle, BuildContract,
        DebugContract, EnvironmentContract, ImageContract, LinkContract, NormalizedSpecBundle,
        RunContract, ToolchainProfile, ToolchainSpecBundle, ValidationContract,
    };

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
            resume_run: None,
            apply: false,
            execute_build: true,
            execute_run: false,
            require_spec: false,
            stage_override: None,
        });
        assert!(build_without_apply.is_err());

        let run_without_build = validate_generation_flags(&GenerationWorkflowOptions {
            command_name: "vos agent generate".into(),
            target: Some("memory".into()),
            patch_path: None,
            resume_run: None,
            apply: true,
            execute_build: false,
            execute_run: true,
            require_spec: false,
            stage_override: None,
        });
        assert!(run_without_build.is_err());
    }

    #[test]
    fn run_workflow_logger_creates_workflow_log() {
        let temp = tempdir().expect("tempdir");
        let log_path = temp.path().join("workflow.log");
        let logger = RunWorkflowLogger::new(&log_path, "vos agent generate", "run-123", false)
            .expect("logger");

        logger.record_event(
            "workflow",
            &vos_core::ProgressEvent {
                stage: "prepare_generation_context".into(),
                message: "normalized strict spec bundle".into(),
                entity_kind: Some("step".into()),
                entity_id: Some("normalize".into()),
                position: Some(1),
                total: Some(5),
                stage_label: Some("准备生成上下文".into()),
                stage_index: Some(1),
                stage_total: Some(5),
                stage_percent: Some(20),
                overall_percent: Some(3),
            },
        );

        let content = fs::read_to_string(&log_path).expect("read workflow log");
        assert!(content.contains("# VOS workflow log"));
        assert!(content.contains("command: vos agent generate"));
        assert!(content.contains("run_id: run-123"));
        assert!(content.contains("[workflow] 准备生成上下文 stage=20% overall=3% step=normalize"));
    }

    #[test]
    fn run_workflow_logger_records_child_scope_lines() {
        let temp = tempdir().expect("tempdir");
        let log_path = temp.path().join("workflow.log");
        let logger = RunWorkflowLogger::new(&log_path, "vos agent generate", "run-456", false)
            .expect("logger");

        logger.record_event(
            "build",
            &vos_core::ProgressEvent {
                stage: "execute_build_phases".into(),
                message: "completed build phase link_kernel".into(),
                entity_kind: Some("phase".into()),
                entity_id: Some("link_kernel".into()),
                position: Some(1),
                total: Some(1),
                stage_label: Some("执行 build phases".into()),
                stage_index: Some(4),
                stage_total: Some(5),
                stage_percent: Some(100),
                overall_percent: Some(90),
            },
        );

        let content = fs::read_to_string(&log_path).expect("read workflow log");
        assert!(
            content.contains("[build] 执行 build phases stage=100% overall=90% phase=link_kernel")
        );
        assert!(content.contains("completed build phase link_kernel"));
    }

    #[test]
    fn workflow_progress_is_written_to_log_and_forwarded_upstream() {
        let temp = tempdir().expect("tempdir");
        let log_path = temp.path().join("workflow.log");
        let logger = RunWorkflowLogger::new(&log_path, "vos agent generate", "run-789", false)
            .expect("logger");
        let captured = Arc::new(Mutex::new(Vec::new()));
        let upstream_events = Arc::clone(&captured);
        let upstream = move |event: vos_core::ProgressEvent| {
            upstream_events
                .lock()
                .expect("upstream events lock")
                .push(event);
        };
        let event = vos_core::ProgressEvent {
            stage: "project_skeleton".into(),
            message: "requesting skeleton projection".into(),
            entity_kind: None,
            entity_id: None,
            position: None,
            total: None,
            stage_label: Some("骨架投影".into()),
            stage_index: Some(2),
            stage_total: Some(5),
            stage_percent: Some(0),
            overall_percent: Some(16),
        };

        emit_workflow_progress(&logger, Some(&upstream), "workflow", event.clone());

        let content = fs::read_to_string(&log_path).expect("read workflow log");
        assert!(content.contains("[workflow] 骨架投影 stage=0% overall=16% :: requesting skeleton projection"));

        let forwarded = captured.lock().expect("captured events lock");
        assert_eq!(forwarded.len(), 1);
        assert_eq!(forwarded[0].stage, event.stage);
        assert_eq!(forwarded[0].message, event.message);
        assert_eq!(forwarded[0].stage_label, event.stage_label);
        assert_eq!(forwarded[0].stage_percent, event.stage_percent);
        assert_eq!(forwarded[0].overall_percent, event.overall_percent);
    }

    #[test]
    fn summarizes_skeleton_feedback_into_actionable_groups() {
        let summary = summarize_skeleton_feedback(&[
            "coverage_error:missing required editable target in skeleton output: include/types.h"
                .into(),
            "coverage_error:missing required editable target in skeleton output: kernel/link.ld"
                .into(),
            "link_error:missing linker script for skeleton: kernel/link.ld".into(),
            "entry_error:entry symbol not found in skeleton/build sources: _start".into(),
        ]);

        assert_eq!(summary.len(), 3);
        assert!(summary[0].contains("include/types.h"));
        assert!(summary[0].contains("kernel/link.ld"));
        assert!(summary[1].contains("kernel/link.ld"));
        assert!(summary[2].contains("_start"));
    }

    #[test]
    fn omitted_target_defaults_to_current_stage_whole_system() {
        let (project_root, spec_root, normalized) = example_xv6_context();
        let selection = resolve_target_selection(
            &project_root,
            &normalized,
            &spec_root,
            &GenerationWorkflowOptions {
                command_name: "vos agent generate".into(),
                target: None,
                patch_path: None,
                resume_run: None,
                apply: false,
                execute_build: false,
                execute_run: false,
                require_spec: false,
                stage_override: None,
            },
        )
        .expect("selection should resolve");

        assert_eq!(selection.kind, "stage");
        assert_eq!(selection.value, "syscall");
        assert_eq!(selection.stage, "syscall");
        assert_eq!(
            selection.modules,
            vec!["headers", "boot", "memory", "trap", "process", "syscall"]
        );
    }

    #[test]
    fn explicit_module_target_keeps_dependency_closure() {
        let (project_root, spec_root, normalized) = example_xv6_context();
        let selection = resolve_target_selection(
            &project_root,
            &normalized,
            &spec_root,
            &GenerationWorkflowOptions {
                command_name: "vos agent generate".into(),
                target: Some("memory".into()),
                patch_path: None,
                resume_run: None,
                apply: false,
                execute_build: false,
                execute_run: false,
                require_spec: false,
                stage_override: None,
            },
        )
        .expect("selection should resolve");

        assert_eq!(selection.kind, "module");
        assert_eq!(selection.value, "memory");
        assert_eq!(selection.stage, "memory");
        assert_eq!(selection.modules, vec!["boot", "headers", "memory"]);
    }

    #[test]
    fn explicit_stage_target_selects_all_modules_for_stage() {
        let (_temp, project_root, spec_root, normalized) = distinct_stage_fixture();
        let selection = resolve_target_selection(
            &project_root,
            &normalized,
            &spec_root,
            &GenerationWorkflowOptions {
                command_name: "vos agent generate".into(),
                target: Some("phase-two".into()),
                patch_path: None,
                resume_run: None,
                apply: false,
                execute_build: false,
                execute_run: false,
                require_spec: false,
                stage_override: None,
            },
        )
        .expect("selection should resolve");

        assert_eq!(selection.kind, "stage");
        assert_eq!(selection.value, "phase-two");
        assert_eq!(selection.stage, "phase-two");
        assert_eq!(selection.modules, vec!["alpha", "beta"]);
    }

    #[test]
    fn load_patch_artifacts_enforces_required_spec_metadata() {
        let (temp, project_root, spec_root, normalized) = distinct_stage_fixture();
        let queue = vos_spec::build_generation_queue(&project_root, &spec_root, "phase-two")
            .expect("queue");
        let patch_path = temp.path().join("candidate.json");
        write_patch_json(
            &patch_path,
            serde_json::json!({
                "spec_hash": test_spec_hash(&normalized),
                "related_specs": ["beta"],
                "operation_refs": ["beta.op"],
                "region_edits": [{
                    "file": "kernel/beta.c",
                    "start_marker": "// BEGIN beta",
                    "end_marker": "// END beta",
                    "code": "int beta(void) { return 0; }"
                }]
            }),
        );

        let artifacts = load_patch_artifacts(&patch_path, true, &normalized, &queue)
            .expect("patch should validate");
        assert_eq!(artifacts.apply_batches.len(), 1);
        assert_eq!(artifacts.apply_batches[0].label, "wave 2");
        assert_eq!(artifacts.apply_batches[0].modules, vec!["beta"]);
        assert_eq!(artifacts.apply_batches[0].region_edits.len(), 1);
    }

    #[test]
    fn load_patch_artifacts_rejects_missing_spec_metadata_when_required() {
        let (temp, project_root, spec_root, normalized) = distinct_stage_fixture();
        let queue = vos_spec::build_generation_queue(&project_root, &spec_root, "phase-two")
            .expect("queue");
        let patch_path = temp.path().join("candidate.json");
        write_patch_json(
            &patch_path,
            serde_json::json!({
                "region_edits": [{
                    "file": "kernel/beta.c",
                    "start_marker": "// BEGIN beta",
                    "end_marker": "// END beta",
                    "code": "int beta(void) { return 0; }"
                }]
            }),
        );

        let err = load_patch_artifacts(&patch_path, true, &normalized, &queue)
            .expect_err("missing spec metadata should fail");
        assert!(err.to_string().contains("missing `spec_hash`"));
    }

    #[test]
    fn patch_batches_fallback_without_metadata_group_into_single_patch_batch() {
        let (_temp, project_root, spec_root, normalized) = distinct_stage_fixture();
        let queue = vos_spec::build_generation_queue(&project_root, &spec_root, "phase-two")
            .expect("queue");
        let batches = build_patch_apply_batches(
            &normalized,
            &queue,
            PatchFileInput {
                spec_hash: None,
                related_specs: Vec::new(),
                operation_refs: Vec::new(),
                files_to_create: Vec::new(),
                files_to_update: Vec::new(),
                region_edits: vec![RegionEdit {
                    file: PathBuf::from("kernel/beta.c"),
                    start_marker: "// BEGIN beta".into(),
                    end_marker: "// END beta".into(),
                    code: "int beta(void) { return 0; }".into(),
                }],
            },
        )
        .expect("fallback batches");

        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].kind, "patch");
        assert_eq!(batches[0].label, "patch batch");
    }

    #[test]
    fn preapply_batch_only_requires_current_batch_markers() {
        let temp = tempdir().expect("tempdir");
        let project_root = temp.path();
        fs::create_dir_all(project_root.join("kernel")).expect("kernel dir");
        let batch = ApplyBatch {
            kind: "base".into(),
            label: "base batch".into(),
            modules: Vec::new(),
            files_to_create: vec![SkeletonFileEdit {
                path: PathBuf::from("kernel/base.c"),
                content: "// BEGIN base\n// END base\n".into(),
                create_mode: "create".into(),
            }],
            files_to_update: vec![RegionEdit {
                file: PathBuf::from("kernel/base.c"),
                start_marker: "// BEGIN base".into(),
                end_marker: "// END base".into(),
                code: "int base(void) { return 0; }".into(),
            }],
            region_edits: Vec::new(),
        };

        preapply_batch(project_root, &batch).expect("base batch should validate independently");
    }

    #[test]
    fn omitted_target_requires_resolvable_current_stage() {
        let temp = tempdir().expect("tempdir");
        let project_root = temp.path();
        let spec_root = project_root.join("spec");
        fs::create_dir_all(spec_root.join("architecture")).expect("create architecture dir");
        fs::create_dir_all(spec_root.join("modules")).expect("create modules dir");
        fs::create_dir_all(spec_root.join("toolchain")).expect("create toolchain dir");

        let normalized = NormalizedSpecBundle {
            modules: Vec::new(),
            operations: Vec::new(),
            architecture: ArchitectureSpecBundle {
                seed: ArchitectureSeed {
                    id: "seed".into(),
                    project: "demo".into(),
                    domain: "os".into(),
                    target_platform: "riscv64".into(),
                    architecture_name: "demo".into(),
                    architecture_summary: "demo".into(),
                    reference_systems: Vec::new(),
                    goals: Vec::new(),
                    non_goals: Vec::new(),
                    constraints: Vec::new(),
                    initial_validation_binding: Vec::new(),
                },
                slices: Vec::new(),
                composition: ArchitectureCompositionSpec::default(),
                toolchain: dummy_toolchain_bundle(),
            },
            toolchain_profiles: Vec::new(),
            hashes: Default::default(),
            visibility: "public".into(),
        };

        let err = resolve_target_selection(
            project_root,
            &normalized,
            &spec_root,
            &GenerationWorkflowOptions {
                command_name: "vos agent generate".into(),
                target: None,
                patch_path: None,
                resume_run: None,
                apply: false,
                execute_build: false,
                execute_run: false,
                require_spec: false,
                stage_override: None,
            },
        )
        .expect_err("selection should fail");

        assert_eq!(
            err.to_string(),
            "default whole-system generation requires spec to define a current stage"
        );
    }

    #[tokio::test]
    #[ignore = "requires VOS_E2E_LLM_API_KEY plus VOS_E2E_LLM_MODEL to call a real provider"]
    async fn real_provider_can_execute_minimal_agent_generation() {
        let temp = tempdir().expect("tempdir");
        let project_root = temp.path().to_path_buf();
        write_real_provider_fixture(&project_root);

        let result = execute_generation_workflow(
            &project_root,
            GenerationWorkflowOptions {
                command_name: "vos agent generate".into(),
                target: Some("boot".into()),
                patch_path: None,
                resume_run: None,
                apply: true,
                execute_build: false,
                execute_run: false,
                require_spec: false,
                stage_override: None,
            },
            None,
        )
        .await
        .expect("live provider generation should succeed");

        assert!(result.applied);
        assert_eq!(result.target_kind, "module");
        assert_eq!(result.target_value, "boot");
        assert_eq!(result.selected_modules, vec!["boot"]);
        assert_eq!(result.generated_waves, vec![vec!["boot".to_string()]]);
        assert_eq!(result.applied_batches.len(), 2);
        assert!(result.manifest_path.exists());
        assert!(
            result
                .skeleton_validation_path
                .as_ref()
                .is_some_and(|path| path.exists())
        );
        assert!(
            result
                .retry_record_path
                .as_ref()
                .is_some_and(|path| path.exists())
        );

        let generated = fs::read_to_string(project_root.join("kernel").join("main.c"))
            .expect("generated file should exist");
        assert!(generated.contains("VOS_BOOT_OK"));
        assert!(generated.contains("boot_banner"));
        assert!(generated.contains("/* VOS-EDIT-START:boot.boot_banner */"));
        assert!(generated.contains("/* VOS-EDIT-END:boot.boot_banner */"));
    }

    fn example_xv6_context() -> (std::path::PathBuf, std::path::PathBuf, NormalizedSpecBundle) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace_root = manifest_dir
            .ancestors()
            .nth(2)
            .expect("workspace root")
            .to_path_buf();
        let project_root = workspace_root.join("..").join("examples").join("xv6-spec");
        let spec_root = project_root.join("spec");
        let normalized =
            vos_spec::load_normalized_spec_bundle(&project_root, &spec_root).expect("normalized");
        (project_root, spec_root, normalized)
    }

    fn distinct_stage_fixture() -> (
        tempfile::TempDir,
        std::path::PathBuf,
        std::path::PathBuf,
        NormalizedSpecBundle,
    ) {
        let temp = tempdir().expect("tempdir");
        let project_root = temp.path().to_path_buf();
        let spec_root = project_root.join("spec");

        fs::create_dir_all(spec_root.join("architecture").join("slices"))
            .expect("create slices dir");
        fs::create_dir_all(spec_root.join("modules").join("alpha").join("ops"))
            .expect("create alpha ops dir");
        fs::create_dir_all(spec_root.join("modules").join("beta").join("ops"))
            .expect("create beta ops dir");
        fs::create_dir_all(spec_root.join("toolchain")).expect("create toolchain dir");

        fs::write(
            spec_root.join("architecture").join("seed.yaml"),
            "id: seed\nproject: demo\ndomain: os\ntarget_platform: riscv64\narchitecture_name: demo\narchitecture_summary: demo\n",
        )
        .expect("write seed");
        fs::write(
            spec_root.join("architecture").join("composition.yaml"),
            "cross_component_rules: []\n",
        )
        .expect("write composition");
        fs::write(
            spec_root.join("architecture").join("slices").join("01-phase-one.yaml"),
            "id: slice-1\nstage: phase-one\ntitle: Phase One\nsummary: first phase\naffected_modules:\n  - alpha\n",
        )
        .expect("write slice one");
        fs::write(
            spec_root.join("architecture").join("slices").join("02-phase-two.yaml"),
            "id: slice-2\nstage: phase-two\ntitle: Phase Two\nsummary: second phase\ndepends_on_slices:\n  - phase-one\naffected_modules:\n  - beta\n",
        )
        .expect("write slice two");

        fs::write(
            spec_root.join("modules").join("alpha").join("module.yaml"),
            "id: alpha\nmodule: alpha\nstage: phase-one\npurpose: alpha module\n",
        )
        .expect("write alpha module");
        fs::write(
            spec_root
                .join("modules")
                .join("alpha")
                .join("ops")
                .join("alpha_op.yaml"),
            "id: alpha.op\nstage: phase-one\nmodule: alpha\noperation: alpha_op\npurpose: alpha op\nllm_codegen:\n  editable_region:\n    file: kernel/alpha.c\n    start_marker: \"// BEGIN alpha\"\n    end_marker: \"// END alpha\"\n",
        )
        .expect("write alpha op");

        fs::write(
            spec_root.join("modules").join("beta").join("module.yaml"),
            "id: beta\nmodule: beta\nstage: phase-two\npurpose: beta module\n",
        )
        .expect("write beta module");
        fs::write(
            spec_root
                .join("modules")
                .join("beta")
                .join("ops")
                .join("beta_op.yaml"),
            "id: beta.op\nstage: phase-two\nmodule: beta\noperation: beta_op\npurpose: beta op\ndepends_on:\n  requires_modules:\n    - alpha\nllm_codegen:\n  editable_region:\n    file: kernel/beta.c\n    start_marker: \"// BEGIN beta\"\n    end_marker: \"// END beta\"\n",
        )
        .expect("write beta op");

        fs::write(
            spec_root.join("toolchain").join("toolchain.yaml"),
            "toolchain:\n  target_arch: riscv64\n  target_triple: riscv64-unknown-elf\n  c_compiler: gcc\n  asm_compiler: gcc\n  linker: ld\n  archiver: ar\nbuild:\n  allowed_output_path:\n    - Makefile\n  generated_artifacts:\n    - build/kernel.elf\n  phases:\n    - name: link_kernel\n      semantic:\n        type: custom\n        command: echo build\n        expected_outputs:\n          - build/kernel.elf\nlink:\n  linker_script: kernel/link.ld\n  entry_symbol: start\n  relocation_model: static\nimage:\n  output_kind: kernel\n  required_artifacts:\n    - build/kernel.elf\nrun:\n  emulator: qemu-system-riscv64\n  machine: virt\n  cpu: rv64\n  memory: 128M\n  bios: none\n  kernel_arg: -kernel\n  success_signal: OK\n  timeout_secs: 1\n",
        )
        .expect("write toolchain");

        let normalized =
            vos_spec::load_normalized_spec_bundle(&project_root, &spec_root).expect("normalized");
        (temp, project_root, spec_root, normalized)
    }

    fn write_real_provider_fixture(project_root: &Path) {
        let provider =
            std::env::var("VOS_E2E_LLM_PROVIDER").unwrap_or_else(|_| "openai-compatible".into());
        let model = std::env::var("VOS_E2E_LLM_MODEL")
            .expect("VOS_E2E_LLM_MODEL must be set for the live provider test");
        let _api_key = std::env::var("VOS_E2E_LLM_API_KEY")
            .expect("VOS_E2E_LLM_API_KEY must be set for the live provider test");
        let base_url = std::env::var("VOS_E2E_LLM_BASE_URL").ok();
        let spec_root = project_root.join("spec");
        fs::create_dir_all(project_root.join(".vos")).expect("create .vos dir");
        fs::create_dir_all(project_root.join("kernel")).expect("create kernel dir");
        fs::create_dir_all(project_root.join("include")).expect("create include dir");
        fs::create_dir_all(spec_root.join("architecture").join("slices"))
            .expect("create slices dir");
        fs::create_dir_all(spec_root.join("modules").join("boot").join("ops"))
            .expect("create boot ops dir");
        fs::create_dir_all(spec_root.join("toolchain")).expect("create toolchain dir");

        let mut config = format!(
            "spec_root = \"spec\"\n\n[agent]\nprovider = \"{provider}\"\nmodel = \"{model}\"\ntimeout_secs = 120\n"
        );
        if let Some(base_url) = base_url {
            config.push_str(&format!("base_url = \"{base_url}\"\n"));
        }
        config.push_str(
            "\n[agent.auth]\nenv = \"VOS_E2E_LLM_API_KEY\"\n\n[agent.retry]\nmax_attempts = 1\n",
        );
        fs::write(project_root.join(".vos").join("config.toml"), config).expect("write config");

        fs::write(
            spec_root.join("architecture").join("seed.yaml"),
            "id: seed\nproject: demo\ndomain: os\ntarget_platform: riscv64\narchitecture_name: demo\narchitecture_summary: Minimal boot banner generation fixture\n",
        )
        .expect("write seed");
        fs::write(
            spec_root.join("architecture").join("composition.yaml"),
            "cross_component_rules: []\n",
        )
        .expect("write composition");
        fs::write(
            spec_root.join("architecture").join("slices").join("01-boot.yaml"),
            "id: slice-boot\nstage: boot\ntitle: Boot\nsummary: generate a single boot banner function\naffected_modules:\n  - boot\n",
        )
        .expect("write slice");

        fs::write(
            spec_root.join("modules").join("boot").join("module.yaml"),
            "id: boot\nmodule: boot\nstage: boot\npurpose: implement a minimal boot banner helper\nowned_state:\n  - boot banner string\nexported_interfaces:\n  - const char *boot_banner(void)\n",
        )
        .expect("write module");
        fs::write(
            spec_root.join("modules").join("boot").join("ops").join("boot_banner.yaml"),
            "id: boot.boot_banner\nstage: boot\nmodule: boot\noperation: boot_banner\npurpose: Return the literal string VOS_BOOT_OK from boot_banner.\npostconditions:\n  - returns the literal string VOS_BOOT_OK\nllm_codegen:\n  editable_region:\n    file: kernel/main.c\n    start_marker: \"/* VOS-EDIT-START:boot.boot_banner */\"\n    end_marker: \"/* VOS-EDIT-END:boot.boot_banner */\"\n",
        )
        .expect("write operation");

        fs::write(
            spec_root.join("toolchain").join("toolchain.yaml"),
            "toolchain:\n  target_arch: riscv64\n  target_triple: riscv64-unknown-elf\n  c_compiler: gcc\n  asm_compiler: gcc\n  linker: ld\n  archiver: ar\nbuild:\n  allowed_output_path:\n    - Makefile\n    - CMakeLists.txt\n    - xtask/src/tasks.rs\n    - xtask/Cargo.toml\n  include_paths:\n    - include\n  sources:\n    - kernel/main.c\n  generated_artifacts:\n    - build/kernel.elf\n  phases:\n    - name: compile_kernel\n      semantic:\n        type: custom\n        command: echo build\n        sources:\n          - pattern: kernel/main.c\n        include_dirs:\n          - include\n        expected_outputs:\n          - build/kernel.elf\nlink:\n  linker_script: kernel/link.ld\n  entry_symbol: vos_entry\n  relocation_model: static\nimage:\n  output_kind: kernel\n  required_artifacts:\n    - build/kernel.elf\nrun:\n  emulator: qemu-system-riscv64\n  machine: virt\n  cpu: rv64\n  memory: 128M\n  bios: none\n  kernel_arg: -kernel\n  success_signal: VOS_BOOT_OK\n  timeout_secs: 1\n",
        )
        .expect("write toolchain");

        fs::write(
            project_root.join("kernel").join("main.c"),
            "#include <stddef.h>\n\nconst char *boot_banner(void) {\n    /* VOS-EDIT-START:boot.boot_banner */\n    /* VOS-EDIT-END:boot.boot_banner */\n}\n\nvoid vos_entry(void) {\n    (void)boot_banner();\n}\n",
        )
        .expect("write main.c");
        fs::write(
            project_root.join("kernel").join("link.ld"),
            "ENTRY(vos_entry)\nSECTIONS\n{\n  .text : { *(.text*) }\n}\n",
        )
        .expect("write link.ld");
    }

    fn write_patch_json(path: &Path, value: serde_json::Value) {
        fs::write(
            path,
            serde_json::to_string_pretty(&value).expect("serialize patch"),
        )
        .expect("write patch");
    }

    fn test_spec_hash(normalized: &NormalizedSpecBundle) -> String {
        normalized
            .hashes
            .values()
            .cloned()
            .collect::<Vec<_>>()
            .join(":")
    }

    fn dummy_toolchain_bundle() -> ToolchainSpecBundle {
        ToolchainSpecBundle {
            toolchain: ToolchainProfile {
                target_arch: "riscv64".into(),
                target_triple: "riscv64-unknown-elf".into(),
                c_compiler: "gcc".into(),
                asm_compiler: "gcc".into(),
                linker: "ld".into(),
                archiver: "ar".into(),
            },
            environment: EnvironmentContract::default(),
            build: BuildContract::default(),
            link: LinkContract::default(),
            image: ImageContract::default(),
            run: RunContract::default(),
            debug: DebugContract::default(),
            validation: ValidationContract::default(),
        }
    }
}
