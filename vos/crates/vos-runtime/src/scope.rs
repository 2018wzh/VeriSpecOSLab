use std::fs;
use std::path::{Path, PathBuf};

use vos_core::{AppConfig, NormalizedSpecBundle, Result, VosError};

pub fn resolve_spec_root(
    project_root: &Path,
    input: Option<&Path>,
    config: &AppConfig,
) -> Result<PathBuf> {
    if let Some(path) = input {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            project_root.join(path)
        };
        for candidate in absolute.ancestors() {
            if candidate.join("architecture").exists()
                && candidate.join("modules").exists()
                && candidate.join("toolchain").exists()
            {
                return candidate
                    .strip_prefix(project_root)
                    .map(Path::to_path_buf)
                    .map_err(|_| {
                        VosError::Message("spec root must be inside project root".into())
                    });
            }
        }
        return Err(VosError::Message(format!(
            "could not resolve strict spec root from {}",
            absolute.display()
        )));
    }
    Ok(config
        .spec_root
        .clone()
        .unwrap_or_else(|| PathBuf::from("spec")))
}

pub fn resolve_stage(
    project_root: &Path,
    spec_root: &Path,
    input: Option<&Path>,
) -> Result<String> {
    if let Some(path) = input {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            project_root.join(path)
        };
        if absolute
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            == Some("slices")
        {
            let value: serde_yaml::Value = serde_yaml::from_str(&fs::read_to_string(absolute)?)?;
            if let Some(stage) = value.get("stage").and_then(|item| item.as_str()) {
                return Ok(stage.to_string());
            }
        }
    }
    let normalized = vos_spec::load_normalized_spec_bundle(project_root, spec_root)?;
    current_stage(&normalized)
        .ok_or_else(|| VosError::Message("no architecture stage found".into()))
}

pub fn current_stage(normalized: &NormalizedSpecBundle) -> Option<String> {
    normalized
        .architecture
        .slices
        .last()
        .map(|slice| slice.stage.clone())
}
