use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use vos_core::{NormalizedSpecBundle, Result, RunManifest};

pub(crate) fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}

pub(crate) fn build_run_manifest(
    run_id: &str,
    command: &str,
    normalized: &NormalizedSpecBundle,
    created_files: &[PathBuf],
    updated_regions: &[PathBuf],
) -> RunManifest {
    RunManifest {
        run_id: run_id.to_string(),
        command: command.to_string(),
        arguments: Vec::new(),
        git_rev: None,
        spec_hash: stable_bundle_hash(normalized),
        projection_version: "strict-doc-v1".into(),
        started_at: timestamp_now(),
        finished_at: None,
        status: "ok".into(),
        artifacts: created_files
            .iter()
            .chain(updated_regions.iter())
            .cloned()
            .collect(),
        evidence_refs: Vec::new(),
    }
}

pub(crate) fn recent_evidence_refs(project_root: &Path) -> Vec<String> {
    let runs_dir = project_root.join(".vos").join("runs");
    if !runs_dir.exists() {
        return Vec::new();
    }
    let mut refs = fs::read_dir(runs_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(|entry| entry.ok()))
        .map(|entry| entry.path().display().to_string())
        .collect::<Vec<_>>();
    refs.sort();
    refs.into_iter().rev().take(5).collect()
}

pub(crate) fn stable_bundle_hash(normalized: &NormalizedSpecBundle) -> String {
    normalized.hashes.values().cloned().collect::<Vec<_>>().join(":")
}

pub(crate) fn timestamp_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

