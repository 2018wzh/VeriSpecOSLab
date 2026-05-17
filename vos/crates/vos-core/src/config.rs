use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::progress::ProgressEvent;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderConfig {
    pub kind: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub api_key_env: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BuildConfig {
    pub command: Option<String>,
    pub cwd: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub spec_root: Option<PathBuf>,
    #[serde(default)]
    pub build: BuildConfig,
    #[serde(default)]
    pub provider: ProviderConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorReport {
    pub provider_api_key_present: bool,
    pub provider_kind: String,
    pub api_key_env: String,
    pub model: String,
    pub base_url: String,
    pub build_command: Option<String>,
    pub project_root: PathBuf,
    pub writable: bool,
}

pub fn is_valid_env_var_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c == '_' || c.is_ascii_alphabetic())
        && chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

pub type ProgressSink = dyn Fn(ProgressEvent) + Send + Sync;
