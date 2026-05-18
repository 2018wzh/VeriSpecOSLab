use std::collections::BTreeMap;
use std::path::Path;

use tokio::task::JoinSet;
use vos_core::{ConcurrencySpec, NormalizedSpecBundle, Result, VosError};
use vos_runtime::ProgressSink;

use crate::{RegionEdit, RigStage, RigWorkflow};

pub(crate) async fn generate_module_waves(
    project_root: &Path,
    config: &vos_core::AppConfig,
    normalized: &NormalizedSpecBundle,
    queue: &vos_core::GenerationQueue,
    concurrency_specs: &BTreeMap<String, Option<ConcurrencySpec>>,
    progress: Option<&ProgressSink>,
    run_dir: &Path,
) -> Result<Vec<RegionEdit>> {
    let mut edits = Vec::new();
    let total_modules = queue.jobs.len();
    let mut launched_modules = 0usize;
    let mut completed_modules = 0usize;
    for (wave_index, wave) in queue.waves.iter().enumerate() {
        let mut set = JoinSet::new();
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
            let prompt_text = vos_prompt::build_module_codegen_batch_prompt(
                &module_spec,
                &operations,
                concurrency.as_ref(),
                normalized,
                project_root,
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
            vos_runtime::emit_entity(
                progress,
                "generating_module",
                "sending module batch prompt",
                "module",
                Some(module_name),
                Some(launched_modules),
                Some(total_modules),
            );
            let module_name = module_name.clone();
            set.spawn(async move {
                let workflow = RigWorkflow::new(&config);
                let raw = workflow
                    .run_prompt_stage(&module_run_dir, RigStage::ProviderCall, &prompt)
                    .await?;
                let parsed = vos_prompt::parse_module_batch_response::<
                    crate::ModuleBatchCodegenResponse,
                >(&raw)
                .map_err(VosError::Message)?;
                Ok::<_, VosError>((module_name, parsed))
            });
        }
        while let Some(joined) = set.join_next().await {
            let (module_name, batch) =
                joined.map_err(|err| VosError::Message(err.to_string()))??;
            completed_modules += 1;
            vos_runtime::emit_entity(
                progress,
                "generated_module",
                &format!("module batch completed in wave {}", wave_index + 1),
                "module",
                Some(&module_name),
                Some(completed_modules),
                Some(total_modules),
            );
            edits.extend(batch.region_edits);
        }
    }
    vos_runtime::emit(
        progress,
        "generating_module",
        "module wave generation completed",
    );
    Ok(edits)
}
