use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use vos_core::{NormalizedSpecBundle, Result, VosError};

use crate::{RegionEdit, SkeletonFileEdit};

#[derive(Debug, serde::Deserialize)]
pub(crate) struct PatchFileInput {
    pub spec_hash: Option<String>,
    #[serde(default)]
    pub related_specs: Vec<String>,
    #[serde(default)]
    pub operation_refs: Vec<String>,
    #[serde(default)]
    pub files_to_create: Vec<SkeletonFileEdit>,
    #[serde(default)]
    pub files_to_update: Vec<RegionEdit>,
    #[serde(default)]
    pub region_edits: Vec<RegionEdit>,
}

pub(crate) fn read_patch_file(path: &Path) -> Result<PatchFileInput> {
    let mut content = String::new();
    fs::File::open(path)?.read_to_string(&mut content)?;
    serde_json::from_str(&content)
        .map_err(|err| VosError::Message(format!("invalid patch file: {err}")))
}

pub(crate) fn validate_required_spec_metadata(
    patch: &PatchFileInput,
    normalized: &NormalizedSpecBundle,
) -> Result<()> {
    // Ensure the patch was generated against the exact spec bundle currently loaded.
    let expected_spec_hash = stable_spec_hash(normalized);
    let actual_spec_hash = patch
        .spec_hash
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            VosError::Message("patch requires spec metadata: missing `spec_hash`".into())
        })?;
    if actual_spec_hash != expected_spec_hash {
        return Err(VosError::Message(format!(
            "patch spec_hash mismatch: expected `{expected_spec_hash}`, got `{actual_spec_hash}`"
        )));
    }
    if patch.related_specs.is_empty() {
        return Err(VosError::Message(
            "patch requires spec metadata: `related_specs` must not be empty".into(),
        ));
    }
    if patch.operation_refs.is_empty() {
        return Err(VosError::Message(
            "patch requires spec metadata: `operation_refs` must not be empty".into(),
        ));
    }

    // Resolve the declared operation bindings before trusting any region markers.
    let referenced_ops = patch
        .operation_refs
        .iter()
        .map(|reference| vos_spec::resolve_operation_reference(&normalized.operations, reference))
        .collect::<Result<Vec<_>>>()?;

    // Every region edit must target an editable region declared by one referenced operation.
    for edit in patch
        .files_to_update
        .iter()
        .chain(patch.region_edits.iter())
    {
        if !referenced_ops.iter().any(|op| {
            let region = &op.llm_codegen.editable_region;
            edit.file == region.file
                && edit.start_marker == region.start_marker
                && edit.end_marker == region.end_marker
        }) {
            return Err(VosError::Message(format!(
                "patch edit for `{}` does not match any referenced operation editable region",
                edit.file.display()
            )));
        }
    }
    Ok(())
}

fn stable_spec_hash(normalized: &NormalizedSpecBundle) -> String {
    normalized
        .hashes
        .values()
        .cloned()
        .collect::<Vec<_>>()
        .join(":")
}

pub(crate) fn validate_skeleton_files(
    project_root: &Path,
    allowed_paths: &[PathBuf],
    files: &[SkeletonFileEdit],
) -> Result<()> {
    for file in files {
        let absolute = project_root.join(&file.path);
        if !vos_runtime::is_allowed_path(&absolute, allowed_paths) {
            return Err(VosError::Message(format!(
                "skeleton file outside allowed paths: {}",
                file.path.display()
            )));
        }
    }
    Ok(())
}

pub(crate) fn validate_region_edits(
    project_root: &Path,
    allowed_paths: &[PathBuf],
    edits: &[RegionEdit],
) -> Result<()> {
    for edit in edits {
        let absolute = project_root.join(&edit.file);
        if !vos_runtime::is_allowed_path(&absolute, allowed_paths) {
            return Err(VosError::Message(format!(
                "region edit outside allowed paths: {}",
                edit.file.display()
            )));
        }
    }
    Ok(())
}

pub(crate) fn apply_region_edit(project_root: &Path, edit: &RegionEdit) -> Result<()> {
    let target_file = project_root.join(&edit.file);
    let content = fs::read_to_string(&target_file)?;
    let start = content.find(&edit.start_marker).ok_or_else(|| {
        VosError::Message(format!("start marker not found in {}", edit.file.display()))
    })?;
    let end = content.find(&edit.end_marker).ok_or_else(|| {
        VosError::Message(format!("end marker not found in {}", edit.file.display()))
    })?;
    if end <= start {
        return Err(VosError::Message(format!(
            "editable region markers reversed in {}",
            edit.file.display()
        )));
    }
    let prefix = &content[..start + edit.start_marker.len()];
    let suffix = &content[end..];
    let new_content = format!("{prefix}\n{}\n{suffix}", edit.code);
    fs::write(target_file, new_content)?;
    Ok(())
}
