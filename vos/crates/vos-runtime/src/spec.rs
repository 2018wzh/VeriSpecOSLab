use std::fs;
use std::path::Path;

use vos_core::Result;

use crate::config::load_config;
use crate::evidence::write_json;
use crate::scope::resolve_spec_root;

pub fn lint_spec(
    project_root: &Path,
    module: &str,
    operation: &str,
) -> Result<vos_core::SpecLintResult> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let bundle = vos_spec::load_spec_bundle(project_root, &spec_root, module, operation)?;
    Ok(vos_core::SpecLintResult {
        ok: true,
        module: module.into(),
        operation: operation.into(),
        target_file: project_root.join(&bundle.operation_contract.llm_codegen.editable_region.file),
        required_followup_checks: bundle
            .operation_contract
            .llm_codegen
            .required_followup_checks,
    })
}

pub fn normalize_spec(
    project_root: &Path,
    spec_path: Option<&Path>,
) -> Result<vos_core::NormalizedSpecBundle> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, spec_path, &config)?;
    let normalized = vos_spec::load_normalized_spec_bundle(project_root, &spec_root)?;
    let normalized_dir = project_root.join(".vos").join("cache").join("normalized");
    fs::create_dir_all(&normalized_dir)?;
    write_json(
        &normalized_dir.join("architecture.json"),
        &normalized.architecture,
    )?;
    write_json(&normalized_dir.join("modules.json"), &normalized.modules)?;
    write_json(
        &normalized_dir.join("operations.json"),
        &normalized.operations,
    )?;
    write_json(
        &normalized_dir.join("toolchain.json"),
        &normalized.toolchain_profiles,
    )?;
    write_json(&normalized_dir.join("bundle.json"), &normalized)?;
    Ok(normalized)
}

pub fn check_consistency(
    project_root: &Path,
    spec_path: Option<&Path>,
) -> Result<vos_core::ConsistencyReport> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, spec_path, &config)?;
    let normalized = normalize_spec(project_root, Some(&spec_root))?;
    let report = vos_spec::check_consistency(project_root, &spec_root, &normalized)?;
    let run_dir = project_root
        .join(".vos")
        .join("runs")
        .join(vos_core::new_run_id());
    fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("consistency-report.json"), &report)?;
    Ok(report)
}
