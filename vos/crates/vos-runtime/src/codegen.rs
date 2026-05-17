use std::path::{Path, PathBuf};

use tokio::task::JoinSet;
use vos_core::{NormalizedSpecBundle, RegionEdit, Result, VosError};

use crate::config::ProgressSink;
use crate::progress::{emit_entity, emit};
use crate::provider::call_json_prompt;

pub(crate) async fn generate_module_waves(
    project_root: &Path,
    config: &vos_core::AppConfig,
    normalized: &NormalizedSpecBundle,
    queue: &vos_core::GenerationQueue,
    progress: Option<&ProgressSink>,
    run_dir: &Path,
) -> Result<Vec<RegionEdit>> {
    let mut edits = Vec::new();
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
            let concurrency = normalized
                .modules
                .iter()
                .find(|module| module.module == *module_name)
                .and_then(|_| {
                    vos_spec::load_concurrency_spec(
                        project_root,
                        &crate::scope::resolve_spec_root(project_root, None, config)
                            .unwrap_or_else(|_| PathBuf::from("spec")),
                        module_name,
                    )
                    .ok()
                    .flatten()
                });
            let prompt = vos_prompt::build_module_codegen_batch_prompt(
                &module_spec,
                &operations,
                concurrency.as_ref(),
                normalized,
                project_root,
            );
            let module_run_dir = run_dir.join(format!("module_{}", module_name));
            let config = config.clone();
            emit_entity(
                progress,
                "generating_module",
                "sending module batch prompt",
                "module",
                Some(module_name),
                Some(wave_index + 1),
                Some(queue.waves.len()),
            );
            set.spawn(async move {
                let raw = call_json_prompt(&config, &module_run_dir, &prompt).await?;
                vos_prompt::parse_module_batch_response(&raw).map_err(VosError::Message)
            });
        }
        while let Some(joined) = set.join_next().await {
            let batch = joined.map_err(|err| VosError::Message(err.to_string()))??;
            edits.extend(batch.region_edits);
        }
    }
    emit(progress, "generating_module", "module wave generation completed");
    Ok(edits)
}
