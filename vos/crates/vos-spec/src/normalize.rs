use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use vos_core::{NormalizedSpecBundle, Result};

use crate::hash::stable_hash;
use crate::loader::{load_architecture_bundle, load_module_specs, load_operation_specs};
use crate::paths::collect_spec_files;

pub fn load_normalized_spec_bundle(project_root: &Path, spec_root: &Path) -> Result<NormalizedSpecBundle> {
    let architecture = load_architecture_bundle(project_root, spec_root)?;
    let modules = load_module_specs(project_root, spec_root)?;
    let operations = load_operation_specs(project_root, spec_root)?;
    let mut hashes = BTreeMap::new();
    for path in collect_spec_files(project_root, spec_root)? {
        let content = fs::read_to_string(&path)?;
        hashes.insert(path.display().to_string(), stable_hash(&content));
    }
    Ok(NormalizedSpecBundle {
        modules,
        operations,
        architecture: architecture.clone(),
        toolchain_profiles: vec![architecture.toolchain],
        hashes,
        visibility: "public".into(),
    })
}
