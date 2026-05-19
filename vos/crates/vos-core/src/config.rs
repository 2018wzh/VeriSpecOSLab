use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::progress::ProgressEvent;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum AgentProviderKind {
    #[serde(alias = "openai")]
    OpenAi,
    #[serde(alias = "openai-compatible")]
    #[default]
    OpenAiCompatible,
    #[serde(alias = "claude")]
    Anthropic,
    #[serde(alias = "google")]
    Gemini,
}

impl AgentProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::OpenAiCompatible => "openai-compatible",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentAuthConfig {
    pub env: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentRetryConfig {
    pub max_attempts: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentTaskOverride {
    pub model: Option<String>,
    pub timeout_secs: Option<u64>,
    pub use_completions_api: Option<bool>,
    #[serde(default)]
    pub retry: AgentRetryConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentRuntimeConfig {
    pub provider: Option<AgentProviderKind>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    #[serde(default)]
    pub auth: AgentAuthConfig,
    pub timeout_secs: Option<u64>,
    pub use_completions_api: Option<bool>,
    #[serde(default)]
    pub retry: AgentRetryConfig,
    #[serde(default)]
    pub overrides: BTreeMap<String, AgentTaskOverride>,
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
    pub agent: AgentRuntimeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorReport {
    pub active_provider: String,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_openai_compatible_agent_config() {
        let config: AppConfig = toml::from_str(
            r#"
spec_root = "spec"

[agent]
provider = "openai-compatible"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
timeout_secs = 90
use_completions_api = false

[agent.auth]
env = "DEEPSEEK_API_KEY"

[agent.retry]
max_attempts = 3

[agent.overrides.skeleton_projection]
model = "deepseek-reasoner"
timeout_secs = 180
"#,
        )
        .expect("config");

        assert_eq!(config.agent.provider, Some(AgentProviderKind::OpenAiCompatible));
        assert_eq!(config.agent.model.as_deref(), Some("deepseek-chat"));
        assert_eq!(config.agent.auth.env.as_deref(), Some("DEEPSEEK_API_KEY"));
        assert_eq!(config.agent.retry.max_attempts, Some(3));
        assert_eq!(
            config
                .agent
                .overrides
                .get("skeleton_projection")
                .and_then(|override_| override_.model.as_deref()),
            Some("deepseek-reasoner")
        );
    }

    #[test]
    fn parses_provider_aliases() {
        let claude: AppConfig = toml::from_str(
            r#"
[agent]
provider = "claude"
model = "claude-sonnet-4"
"#,
        )
        .expect("claude config");
        let google: AppConfig = toml::from_str(
            r#"
[agent]
provider = "google"
model = "gemini-2.5-pro"
"#,
        )
        .expect("google config");

        assert_eq!(claude.agent.provider, Some(AgentProviderKind::Anthropic));
        assert_eq!(google.agent.provider, Some(AgentProviderKind::Gemini));
    }
}
