use std::fs;
use std::path::Path;

use vos_core::{ConcurrencySpec, ModuleSpec, OperationContract, Result, SpecBundle, VosError};

use crate::loader::types::{ConcurrencyYaml, ModuleYaml, OperationYaml};
use crate::paths::{read_dir_paths, read_yaml_files};

pub fn load_spec_bundle(
    project_root: &Path,
    spec_root: &Path,
    module: &str,
    operation: &str,
) -> Result<SpecBundle> {
    let modules = load_module_specs(project_root, spec_root)?;
    let operations = load_operation_specs(project_root, spec_root)?;
    let module_spec = modules
        .into_iter()
        .find(|item| item.module == module)
        .ok_or_else(|| VosError::Message(format!("module spec not found: {module}")))?;
    let operation_contract = operations
        .into_iter()
        .find(|item| item.module == module && item.operation == operation)
        .ok_or_else(|| {
            VosError::Message(format!("operation spec not found: {module}.{operation}"))
        })?;
    let concurrency_spec = load_concurrency_spec(project_root, spec_root, module)?;
    Ok(SpecBundle {
        target_paths: vec![operation_contract.llm_codegen.editable_region.file.clone()],
        build_hints: operation_contract
            .llm_codegen
            .required_followup_checks
            .clone(),
        module_spec,
        operation_contract,
        concurrency_spec,
    })
}

pub fn load_module_specs(project_root: &Path, spec_root: &Path) -> Result<Vec<ModuleSpec>> {
    let modules_root = project_root.join(spec_root).join("modules");
    if !modules_root.exists() {
        return Err(VosError::Message(format!(
            "modules directory not found: {}",
            modules_root.display()
        )));
    }
    let mut specs = Vec::new();
    for module_dir in read_dir_paths(&modules_root)? {
        if !module_dir.is_dir() {
            continue;
        }
        let path = module_dir.join("module.yaml");
        if !path.exists() {
            continue;
        }
        let parsed: ModuleYaml = serde_yaml::from_str(&fs::read_to_string(path)?)?;
        specs.push(ModuleSpec {
            id: parsed.id,
            module: parsed.module,
            stage: parsed.stage,
            purpose: parsed.purpose,
            related_slices: parsed.related_slices,
            related_adrs: parsed.related_adrs,
            owned_state: parsed.owned_state,
            exported_interfaces: parsed.exported_interfaces,
            imported_interfaces: parsed.imported_interfaces,
            module_invariants: parsed.module_invariants,
            error_model: parsed.error_model,
            resource_lifetime_rules: parsed.resource_lifetime_rules,
            security_boundary: parsed.security_boundary,
            test_surfaces: parsed.test_surfaces,
        });
    }
    specs.sort_by(|a, b| a.module.cmp(&b.module));
    Ok(specs)
}

pub fn load_operation_specs(
    project_root: &Path,
    spec_root: &Path,
) -> Result<Vec<OperationContract>> {
    let modules_root = project_root.join(spec_root).join("modules");
    let mut specs = Vec::new();
    for module_dir in read_dir_paths(&modules_root)? {
        if !module_dir.is_dir() {
            continue;
        }
        let ops_dir = module_dir.join("ops");
        for path in read_yaml_files(&ops_dir)? {
            let parsed: OperationYaml = serde_yaml::from_str(&fs::read_to_string(path)?)?;
            if parsed
                .llm_codegen
                .editable_region
                .start_marker
                .trim()
                .is_empty()
                || parsed
                    .llm_codegen
                    .editable_region
                    .end_marker
                    .trim()
                    .is_empty()
            {
                return Err(VosError::Message(format!(
                    "editable region markers must not be empty for {}.{}",
                    parsed.module, parsed.operation
                )));
            }
            specs.push(OperationContract {
                id: parsed.id,
                stage: parsed.stage,
                module: parsed.module,
                operation: parsed.operation,
                purpose: parsed.purpose,
                related_slice: parsed.related_slice,
                related_adr: parsed.related_adr,
                depends_on: parsed.depends_on,
                rely: parsed.rely,
                guarantee: parsed.guarantee,
                preconditions: parsed.preconditions,
                postconditions: parsed.postconditions,
                invariants_preserved: parsed.invariants_preserved,
                failure_semantics: parsed.failure_semantics,
                concurrency: parsed.concurrency,
                security: parsed.security,
                observability: parsed.observability,
                test_obligations: parsed.test_obligations,
                llm_codegen: parsed.llm_codegen,
            });
        }
    }
    specs.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(specs)
}

pub fn load_concurrency_spec(
    project_root: &Path,
    spec_root: &Path,
    module: &str,
) -> Result<Option<ConcurrencySpec>> {
    let path = project_root
        .join(spec_root)
        .join("modules")
        .join(module)
        .join("concurrency.yaml");
    if !path.exists() {
        return Ok(None);
    }
    let parsed: ConcurrencyYaml = serde_yaml::from_str(&fs::read_to_string(path)?)?;
    Ok(Some(ConcurrencySpec {
        module: parsed.module,
        shared_state: parsed.shared_state,
        lock_types: parsed.lock_types,
        lock_order: parsed.lock_order,
        atomic_sections: parsed.atomic_sections,
        interrupt_rules: parsed.interrupt_rules,
        wait_wakeup_rules: parsed.wait_wakeup_rules,
        rely: parsed.rely,
        guarantee: parsed.guarantee,
        forbidden_patterns: parsed.forbidden_patterns,
    }))
}
