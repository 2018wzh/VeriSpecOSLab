use std::collections::HashSet;
use std::path::Path;

use vos_core::{ConsistencyReport, NormalizedSpecBundle, Result};

use crate::graph::validate_slice_dependency_graph;
use crate::paths::collect_spec_files;

pub fn check_consistency(
    project_root: &Path,
    spec_root: &Path,
    normalized: &NormalizedSpecBundle,
) -> Result<ConsistencyReport> {
    let mut errors = Vec::new();
    let warnings = Vec::new();

    let module_names: HashSet<String> = normalized.modules.iter().map(|m| m.module.clone()).collect();
    let op_names: HashSet<String> = normalized
        .operations
        .iter()
        .map(|op| format!("{}.{}", op.module, op.operation))
        .collect();
    let slice_ids: HashSet<String> = normalized
        .architecture
        .slices
        .iter()
        .map(|slice| slice.id.clone())
        .collect();

    for slice in &normalized.architecture.slices {
        for module in &slice.affected_modules {
            if !module_names.contains(module) {
                errors.push(format!(
                    "slice `{}` references missing module `{module}`",
                    slice.id
                ));
            }
        }
        for operation in &slice.new_operations {
            if !op_names.contains(operation) {
                errors.push(format!(
                    "slice `{}` references missing operation `{operation}`",
                    slice.id
                ));
            }
        }
        for dep in &slice.depends_on_slices {
            if !slice_ids.contains(dep) {
                errors.push(format!(
                    "slice `{}` depends on missing slice `{dep}`",
                    slice.id
                ));
            }
        }
    }

    if let Err(err) = validate_slice_dependency_graph(&normalized.architecture.slices) {
        errors.push(err.to_string());
    }

    for rule in &normalized.architecture.composition.cross_component_rules {
        for module in &rule.affected_modules {
            if !module_names.contains(module) {
                errors.push(format!(
                    "composition rule `{}` references missing module `{module}`",
                    rule.name
                ));
            }
        }
        for slice in &rule.related_slices {
            if !slice_ids.contains(slice) {
                errors.push(format!(
                    "composition rule `{}` references missing slice `{slice}`",
                    rule.name
                ));
            }
        }
    }

    for operation in &normalized.operations {
        let file = project_root.join(spec_root).join(&operation.llm_codegen.editable_region.file);
        if !file.starts_with(project_root) {
            errors.push(format!(
                "operation `{}` editable region escapes project root: {}",
                operation.id,
                operation.llm_codegen.editable_region.file.display()
            ));
        }
    }

    let toolchain = &normalized.architecture.toolchain;
    if toolchain.build.generated_artifacts.is_empty() {
        errors.push("toolchain build.generated_artifacts must not be empty".into());
    }
    if toolchain.image.required_artifacts.is_empty() {
        errors.push("toolchain image.required_artifacts must not be empty".into());
    }
    if !toolchain
        .image
        .required_artifacts
        .iter()
        .all(|artifact| toolchain.build.generated_artifacts.contains(artifact))
    {
        errors.push(
            "toolchain image.required_artifacts must be produced by build.generated_artifacts".into(),
        );
    }
    if toolchain.run.kernel_arg.trim().is_empty() {
        errors.push("toolchain run.kernel_arg must not be empty".into());
    }

    Ok(ConsistencyReport {
        ok: errors.is_empty(),
        errors,
        warnings,
        checked_paths: collect_spec_files(project_root, spec_root)?
            .into_iter()
            .map(|path| path.display().to_string())
            .collect(),
    })
}
