use std::fs;
use std::io::Read;
use std::path::Path;

use vos_core::{Result, VosError};

#[allow(dead_code)]
#[derive(Debug, serde::Deserialize)]
pub(crate) struct PatchFileInput {
    #[serde(default)]
    pub files_to_create: Vec<serde_json::Value>,
    #[serde(default)]
    pub files_to_update: Vec<serde_json::Value>,
    #[serde(default)]
    pub region_edits: Vec<serde_json::Value>,
}

pub(crate) fn read_patch_file(path: &Path) -> Result<PatchFileInput> {
    let mut content = String::new();
    fs::File::open(path)?.read_to_string(&mut content)?;
    serde_json::from_str(&content)
        .map_err(|err| VosError::Message(format!("invalid patch file: {err}")))
}
