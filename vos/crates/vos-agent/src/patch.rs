use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use vos_core::{Result, VosError};

use crate::{RegionEdit, SkeletonFileEdit};

#[derive(Debug, serde::Deserialize)]
pub(crate) struct PatchFileInput {
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
