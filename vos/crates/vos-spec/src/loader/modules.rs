use std::fs;
use std::path::Path;

use vos_core::{ConcurrencySpec, ModuleSpec, OperationContract, Result, SpecBundle, VosError};

use crate::loader::types::{ConcurrencyYaml, ModuleYaml, OperationYaml};
use crate::paths::collect_yaml_recursive;

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
    let mut yaml_paths = Vec::new();
    collect_yaml_recursive(&modules_root, &mut yaml_paths)?;
    for path in yaml_paths
        .into_iter()
        .filter(|path| path.file_name().and_then(|name| name.to_str()) == Some("module.yaml"))
    {
        let parsed: ModuleYaml = serde_yaml::from_str(&fs::read_to_string(&path)?)?;
        let expected_module = module_name_from_module_file(&modules_root, &path)?;
        if parsed.module != expected_module {
            return Err(VosError::Message(format!(
                "module spec path mismatch: expected module `{expected_module}` from {}, got `{}`",
                path.display(),
                parsed.module
            )));
        }
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
    let mut yaml_paths = Vec::new();
    collect_yaml_recursive(&modules_root, &mut yaml_paths)?;
    for path in yaml_paths.into_iter().filter(|path| {
        path.parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            == Some("ops")
    }) {
        let parsed: OperationYaml = serde_yaml::from_str(&fs::read_to_string(&path)?)?;
        let expected_module = module_name_from_operation_file(&modules_root, &path)?;
        if parsed.module != expected_module {
            return Err(VosError::Message(format!(
                "operation spec path mismatch: expected module `{expected_module}` from {}, got `{}`",
                path.display(),
                parsed.module
            )));
        }
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
    let parsed: ConcurrencyYaml = serde_yaml::from_str(&fs::read_to_string(&path)?)?;
    if parsed.module != module {
        return Err(VosError::Message(format!(
            "concurrency spec path mismatch: expected module `{module}` from {}, got `{}`",
            path.display(),
            parsed.module
        )));
    }
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

fn module_name_from_module_file(modules_root: &Path, path: &Path) -> Result<String> {
    module_name_from_directory(
        modules_root,
        path.parent().ok_or_else(|| {
            VosError::Message(format!(
                "module spec missing parent directory: {}",
                path.display()
            ))
        })?,
    )
}

fn module_name_from_operation_file(modules_root: &Path, path: &Path) -> Result<String> {
    let ops_dir = path.parent().ok_or_else(|| {
        VosError::Message(format!(
            "operation spec missing ops directory: {}",
            path.display()
        ))
    })?;
    let module_dir = ops_dir.parent().ok_or_else(|| {
        VosError::Message(format!(
            "operation spec missing module directory: {}",
            path.display()
        ))
    })?;
    module_name_from_directory(modules_root, module_dir)
}

fn module_name_from_directory(modules_root: &Path, module_dir: &Path) -> Result<String> {
    let relative = module_dir.strip_prefix(modules_root).map_err(|_| {
        VosError::Message(format!(
            "module directory {} is outside modules root {}",
            module_dir.display(),
            modules_root.display()
        ))
    })?;
    let components = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if components.is_empty() {
        return Err(VosError::Message(format!(
            "module specs must live under a named subdirectory: {}",
            modules_root.display()
        )));
    }
    Ok(components.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn loads_nested_module_specs_recursively() {
        let temp = tempdir().expect("tempdir");
        let project_root = temp.path();
        let spec_root = project_root.join("spec");
        let module_dir = spec_root.join("modules").join("kernel").join("boot");
        std::fs::create_dir_all(module_dir.join("ops")).expect("create ops dir");
        std::fs::write(
            module_dir.join("module.yaml"),
            "id: kernel/boot\nmodule: kernel/boot\nstage: boot\npurpose: boot module\n",
        )
        .expect("write module");
        std::fs::write(
            module_dir.join("ops").join("boot_banner.yaml"),
            "id: kernel/boot.boot_banner\nstage: boot\nmodule: kernel/boot\noperation: boot_banner\npurpose: boot op\nllm_codegen:\n  editable_region:\n    file: kernel/main.c\n    start_marker: \"// BEGIN\"\n    end_marker: \"// END\"\n",
        )
        .expect("write op");

        let modules = load_module_specs(project_root, &spec_root).expect("modules");
        let operations = load_operation_specs(project_root, &spec_root).expect("operations");

        assert_eq!(modules.len(), 1);
        assert_eq!(modules[0].module, "kernel/boot");
        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].module, "kernel/boot");
    }

    #[test]
    fn rejects_path_and_module_name_mismatch() {
        let temp = tempdir().expect("tempdir");
        let project_root = temp.path();
        let spec_root = project_root.join("spec");
        let module_dir = spec_root.join("modules").join("kernel").join("boot");
        std::fs::create_dir_all(&module_dir).expect("create module dir");
        std::fs::write(
            module_dir.join("module.yaml"),
            "id: boot\nmodule: boot\nstage: boot\npurpose: boot module\n",
        )
        .expect("write module");

        let err = load_module_specs(project_root, &spec_root).expect_err("mismatch should fail");
        assert!(err.to_string().contains("module spec path mismatch"));
    }

    #[test]
    fn rejects_concurrency_path_and_module_name_mismatch() {
        let temp = tempdir().expect("tempdir");
        let project_root = temp.path();
        let spec_root = project_root.join("spec");
        let module_dir = spec_root.join("modules").join("kernel").join("boot");
        std::fs::create_dir_all(&module_dir).expect("create module dir");
        std::fs::write(
            module_dir.join("concurrency.yaml"),
            "module: boot\nshared_state: []\nlock_types: []\nlock_order: []\natomic_sections: []\ninterrupt_rules: []\nrely: []\nguarantee: []\nwait_wakeup_rules: []\nforbidden_patterns: []\n",
        )
        .expect("write concurrency");

        let err = load_concurrency_spec(project_root, &spec_root, "kernel/boot")
            .expect_err("mismatch should fail");
        assert!(err.to_string().contains("concurrency spec path mismatch"));
    }
}
