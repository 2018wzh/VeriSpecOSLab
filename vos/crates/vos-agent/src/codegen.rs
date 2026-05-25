use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use tokio::sync::mpsc;
use tokio::task::JoinSet;
use vos_core::{ConcurrencySpec, NormalizedSpecBundle, Result, VosError};
use vos_runtime::{ProgressPlan, ProgressSink, progress_percent};

use crate::rig::{RigStage, RigStreamStatus, RigWorkflow};
use crate::{ModuleBatchCodegenResponse, RegionEdit, SkeletonFileEdit};

#[derive(Debug)]
struct ModuleStreamProgress {
    module_name: String,
    status: RigStreamStatus,
}

pub(crate) async fn generate_module_waves(
    project_root: &Path,
    config: &vos_core::AppConfig,
    normalized: &NormalizedSpecBundle,
    queue: &vos_core::GenerationQueue,
    concurrency_specs: &BTreeMap<String, Option<ConcurrencySpec>>,
    skeleton_files: &[SkeletonFileEdit],
    progress: Option<&ProgressSink>,
    progress_plan: &ProgressPlan,
    run_dir: &Path,
    resume: bool,
) -> Result<Vec<RegionEdit>> {
    let mut edits = Vec::new();
    let total_modules = queue.jobs.len();
    let mut launched_modules = 0usize;
    let mut completed_modules = 0usize;
    progress_plan.emit_stage(
        progress,
        "generate_modules",
        "starting module batch generation",
    );
    if total_modules == 0 {
        progress_plan.finish_stage(progress, "generate_modules", "no module batches selected");
    }
    for (wave_index, wave) in queue.waves.iter().enumerate() {
        let mut set = JoinSet::new();
        let (stream_progress_tx, mut stream_progress_rx) =
            mpsc::unbounded_channel::<ModuleStreamProgress>();
        for module_name in wave {
            let module_spec = normalized
                .modules
                .iter()
                .find(|module| &module.module == module_name)
                .ok_or_else(|| VosError::Message(format!("module spec not found: {module_name}")))?
                .clone();
            let operations = normalized
                .operations
                .iter()
                .filter(|op| op.module == *module_name)
                .cloned()
                .collect::<Vec<_>>();
            let concurrency = concurrency_specs.get(module_name).cloned().flatten();
            let target_context = build_target_context(project_root, skeleton_files, &operations)?;
            let prompt_text = vos_prompt::build_module_codegen_batch_prompt(
                &module_spec,
                &operations,
                concurrency.as_ref(),
                normalized,
                project_root,
                &target_context,
            );
            let allowed_paths = operations
                .iter()
                .map(|op| project_root.join(&op.llm_codegen.editable_region.file))
                .collect::<Vec<_>>();
            let prompt = crate::PromptEnvelope {
                task_kind: "module_codegen_batch".into(),
                phase: "module_codegen_batch".into(),
                spec_ref: vos_core::SpecRef {
                    module: module_spec.module.clone(),
                    operation: "batch".into(),
                },
                allowed_paths,
                prompt: prompt_text,
            };
            let module_run_dir = run_dir.join(format!("module_{}", module_name));
            let config = config.clone();
            launched_modules += 1;
            if resume {
                if let Some(batch) = load_completed_module_batch(&module_run_dir)? {
                    completed_modules += 1;
                    progress_plan.emit_stage_count(
                        progress,
                        "generate_modules",
                        "reusing completed module batch response",
                        Some("module"),
                        Some(module_name),
                        completed_modules,
                        total_modules,
                    );
                    edits.extend(batch.region_edits);
                    continue;
                }
            }
            progress_plan.emit_stage_count(
                progress,
                "generate_modules",
                "sending module batch prompt",
                Some("module"),
                Some(module_name),
                launched_modules,
                total_modules,
            );
            let module_name = module_name.clone();
            let stream_progress_tx = stream_progress_tx.clone();
            set.spawn(async move {
                let workflow = RigWorkflow::new(&config);
                let progress_module = module_name.clone();
                let stream_progress = move |status| {
                    let _ = stream_progress_tx.send(ModuleStreamProgress {
                        module_name: progress_module.clone(),
                        status,
                    });
                };
                let raw = workflow
                    .run_prompt_stage(
                        &module_run_dir,
                        RigStage::ProviderCall,
                        &prompt,
                        Some(&stream_progress),
                    )
                    .await?;
                let parsed =
                    vos_prompt::parse_module_batch_response::<ModuleBatchCodegenResponse>(&raw)
                        .map_err(VosError::Message)?;
                Ok::<_, VosError>((module_name, parsed))
            });
        }
        drop(stream_progress_tx);
        while !set.is_empty() {
            tokio::select! {
                Some(stream_progress) = stream_progress_rx.recv() => {
                    emit_module_stream_progress(
                        progress,
                        progress_plan,
                        &stream_progress,
                        completed_modules,
                        total_modules,
                    );
                }
                joined = set.join_next() => {
                    let Some(joined) = joined else {
                        break;
                    };
                    let (module_name, batch) =
                        joined.map_err(|err| VosError::Message(err.to_string()))??;
                    completed_modules += 1;
                    progress_plan.emit_stage_count(
                        progress,
                        "generate_modules",
                        &format!("module batch completed in wave {}", wave_index + 1),
                        Some("module"),
                        Some(&module_name),
                        completed_modules,
                        total_modules,
                    );
                    edits.extend(batch.region_edits);
                }
            }
        }
        while let Ok(stream_progress) = stream_progress_rx.try_recv() {
            emit_module_stream_progress(
                progress,
                progress_plan,
                &stream_progress,
                completed_modules,
                total_modules,
            );
        }
    }
    progress_plan.finish_stage(
        progress,
        "generate_modules",
        "module wave generation completed",
    );
    Ok(edits)
}

fn build_target_context(
    project_root: &Path,
    skeleton_files: &[SkeletonFileEdit],
    operations: &[vos_core::OperationContract],
) -> Result<String> {
    let skeleton_by_path = skeleton_files
        .iter()
        .map(|file| (file.path.clone(), file.content.as_str()))
        .collect::<BTreeMap<_, _>>();
    let mut rendered = Vec::new();
    let mut seen = BTreeSet::new();

    for operation in operations {
        let region = &operation.llm_codegen.editable_region;
        if !seen.insert(region.file.clone()) {
            continue;
        }
        let content = if let Some(content) = skeleton_by_path.get(&region.file) {
            (*content).to_string()
        } else {
            let path = project_root.join(&region.file);
            std::fs::read_to_string(&path).unwrap_or_default()
        };
        rendered.push(format!(
            "file: {}\n{}",
            region.file.display(),
            extract_context_for_file(&content, operations, &region.file)
        ));
    }

    if rendered.is_empty() {
        Ok("- none".into())
    } else {
        Ok(rendered.join("\n\n---\n"))
    }
}

fn extract_context_for_file(
    content: &str,
    operations: &[vos_core::OperationContract],
    file: &std::path::Path,
) -> String {
    let lines = content.lines().collect::<Vec<_>>();
    let mut ranges = Vec::new();
    for operation in operations {
        let region = &operation.llm_codegen.editable_region;
        if region.file != file {
            continue;
        }
        if let Some(marker_line) = lines
            .iter()
            .position(|line| line.contains(&region.start_marker))
        {
            let start = marker_line.saturating_sub(8);
            let end = (marker_line + 14).min(lines.len());
            ranges.push((start, end));
        }
    }
    ranges.sort();
    ranges.dedup();
    if ranges.is_empty() {
        return "context unavailable; emit only code for the listed marker interiors.".into();
    }

    let mut snippets = Vec::new();
    for (start, end) in ranges {
        snippets.push(
            lines[start..end]
                .iter()
                .enumerate()
                .map(|(idx, line)| format!("{:>4}: {}", start + idx + 1, line))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }
    snippets.join("\n...\n")
}

fn load_completed_module_batch(
    module_run_dir: &Path,
) -> Result<Option<ModuleBatchCodegenResponse>> {
    let response_path = module_run_dir.join("response.txt");
    if !response_path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&response_path)?;
    match vos_prompt::parse_module_batch_response::<ModuleBatchCodegenResponse>(&raw) {
        Ok(batch) => Ok(Some(batch)),
        Err(_) => Ok(None),
    }
}

fn emit_module_stream_progress(
    progress: Option<&ProgressSink>,
    progress_plan: &ProgressPlan,
    stream_progress: &ModuleStreamProgress,
    completed_modules: usize,
    total_modules: usize,
) {
    let message = match stream_progress.status {
        RigStreamStatus::Thinking => "thinking about module batch",
        RigStreamStatus::Generating => "generating module batch",
    };
    progress_plan.emit_stage_progress(
        progress,
        "generate_modules",
        message,
        progress_percent(completed_modules, total_modules).unwrap_or(0),
        Some("module"),
        Some(&stream_progress.module_name),
        None,
        None,
    );
}
