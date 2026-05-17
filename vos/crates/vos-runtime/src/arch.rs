use std::fs;
use std::path::Path;

use vos_core::{ArchitectureLintResult, Result};

use crate::config::load_config;
use crate::evidence::write_json;
use crate::scope::{resolve_spec_root, resolve_stage};

pub fn lint_architecture(
    project_root: &Path,
    architecture_path: Option<&Path>,
) -> Result<ArchitectureLintResult> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, architecture_path, &config)?;
    vos_spec::lint_architecture(project_root, &spec_root)
}

pub fn compose_architecture(
    project_root: &Path,
    architecture_path: Option<&Path>,
) -> Result<vos_core::ArchitectureComposeResult> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, architecture_path, &config)?;
    let stage = resolve_stage(project_root, &spec_root, architecture_path)?;
    let result = vos_spec::compose_architecture(project_root, &spec_root, &stage)?;
    let run_dir = project_root.join(".vos").join("runs").join(vos_core::new_run_id());
    fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("compose-result.json"), &result)?;
    Ok(result)
}

pub fn derive_tests(
    project_root: &Path,
    architecture_path: Option<&Path>,
) -> Result<vos_core::DerivedTestMatrix> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, architecture_path, &config)?;
    let stage = resolve_stage(project_root, &spec_root, architecture_path)?;
    let result = vos_spec::derive_tests(project_root, &spec_root, &stage)?;
    let run_dir = project_root.join(".vos").join("runs").join(vos_core::new_run_id());
    fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("derived-tests.json"), &result)?;
    Ok(result)
}
