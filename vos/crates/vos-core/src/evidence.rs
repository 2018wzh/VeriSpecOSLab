use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunManifest {
    pub run_id: String,
    pub command: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    pub git_rev: Option<String>,
    pub spec_hash: String,
    pub projection_version: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: String,
    #[serde(default)]
    pub artifacts: Vec<PathBuf>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticReport {
    pub kind: String,
    pub summary: String,
    pub phase: String,
    #[serde(default)]
    pub related_specs: Vec<String>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
    #[serde(default)]
    pub suggested_next_commands: Vec<String>,
}
