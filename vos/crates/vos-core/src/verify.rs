use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsistencyReport {
    pub ok: bool,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub checked_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitectureLintResult {
    pub ok: bool,
    pub target_platform: String,
    pub current_stage: Option<String>,
    #[serde(default)]
    pub declared_stages: Vec<String>,
    #[serde(default)]
    pub enabled_modules: Vec<String>,
}
