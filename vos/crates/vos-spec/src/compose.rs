use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use vos_core::{
    ArchitectureComposeResult, ArchitecturePlanBundle, GenerationQueue, ModuleGenerationJob,
    Result, SpecRef, StageDescriptor, VosError,
};

use crate::graph::{build_module_waves, module_dependencies, slices_until_stage};
use crate::hash::unique_strings;
use crate::normalize::load_normalized_spec_bundle;

pub fn plan_architecture(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<ArchitecturePlanBundle> {
    let normalized = load_normalized_spec_bundle(project_root, spec_root)?;
    let slices = slices_until_stage(&normalized.architecture.slices, target_stage)?;
    let enabled_modules = unique_strings(
        &slices
            .iter()
            .flat_map(|slice| slice.affected_modules.clone())
            .collect::<Vec<_>>(),
    );
    let required_operations = normalized
        .operations
        .iter()
        .filter(|op| enabled_modules.contains(&op.module))
        .map(|op| SpecRef {
            module: op.module.clone(),
            operation: op.operation.clone(),
        })
        .collect::<Vec<_>>();
    let skeleton_features = unique_strings(
        &slices
            .iter()
            .flat_map(|slice| {
                slice
                    .mechanisms
                    .clone()
                    .into_iter()
                    .chain(slice.invariants.clone())
            })
            .collect::<Vec<_>>(),
    );
    let verification_bindings = unique_strings(
        &slices
            .iter()
            .flat_map(|slice| slice.validation_binding.must_pass.clone())
            .chain(
                normalized
                    .architecture
                    .composition
                    .cross_component_rules
                    .iter()
                    .flat_map(|rule| rule.validation_intent.clone()),
            )
            .collect::<Vec<_>>(),
    );
    let generation_order = slices
        .iter()
        .enumerate()
        .map(|(index, slice)| StageDescriptor {
            stage: slice.stage.clone(),
            stage_index: index,
            modules: slice.affected_modules.clone(),
            required_stages: slice.depends_on_slices.clone(),
        })
        .collect();

    Ok(ArchitecturePlanBundle {
        target_platform: normalized.architecture.seed.target_platform,
        current_stage: target_stage.to_string(),
        enabled_modules,
        required_operations,
        skeleton_features,
        generation_order,
        verification_bindings,
    })
}

pub fn compose_architecture(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<ArchitectureComposeResult> {
    let normalized = load_normalized_spec_bundle(project_root, spec_root)?;
    let slices = slices_until_stage(&normalized.architecture.slices, target_stage)?;
    let enabled_modules = unique_strings(
        &slices
            .iter()
            .flat_map(|slice| slice.affected_modules.clone())
            .collect::<Vec<_>>(),
    );
    let mut module_dependency_dag = BTreeMap::new();
    for module in &enabled_modules {
        module_dependency_dag.insert(
            module.clone(),
            module_dependencies(&normalized.operations, module),
        );
    }
    Ok(ArchitectureComposeResult {
        current_stage: target_stage.to_string(),
        enabled_modules,
        module_dependency_dag,
        skeleton_features: unique_strings(
            &slices
                .iter()
                .flat_map(|slice| {
                    slice
                        .mechanisms
                        .clone()
                        .into_iter()
                        .chain(slice.invariants.clone())
                })
                .collect::<Vec<_>>(),
        ),
        verification_bindings: unique_strings(
            &slices
                .iter()
                .flat_map(|slice| slice.validation_binding.must_pass.clone())
                .collect::<Vec<_>>(),
        ),
    })
}

pub fn build_generation_queue(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<GenerationQueue> {
    let normalized = load_normalized_spec_bundle(project_root, spec_root)?;
    let compose = compose_architecture(project_root, spec_root, target_stage)?;
    let module_map: HashMap<String, vos_core::ModuleSpec> = normalized
        .modules
        .iter()
        .map(|module| (module.module.clone(), module.clone()))
        .collect();
    let mut jobs = Vec::new();
    let mut blocked_by = BTreeMap::new();
    for module in &compose.enabled_modules {
        let spec = module_map.get(module).ok_or_else(|| {
            VosError::Message(format!("module not found in normalized bundle: {module}"))
        })?;
        let operations = normalized
            .operations
            .iter()
            .filter(|op| op.module == *module)
            .map(|op| op.operation.clone())
            .collect::<Vec<_>>();
        let editable_targets = normalized
            .operations
            .iter()
            .filter(|op| op.module == *module)
            .map(|op| op.llm_codegen.editable_region.file.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let deps = module_dependencies(&normalized.operations, module);
        blocked_by.insert(module.clone(), deps.clone());
        jobs.push(ModuleGenerationJob {
            module: module.clone(),
            stage: spec.stage.clone(),
            operations,
            editable_targets,
            depends_on_modules: deps,
        });
    }
    let waves = build_module_waves(&jobs)?;
    Ok(GenerationQueue {
        stage: target_stage.to_string(),
        skeleton_features: compose.skeleton_features,
        jobs,
        waves,
        blocked_by,
    })
}
