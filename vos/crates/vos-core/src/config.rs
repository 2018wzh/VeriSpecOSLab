use serde::{Deserialize, Serialize};
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
    #[serde(alias = "deepseek")]
    DeepSeek,
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
            Self::DeepSeek => "deepseek",
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
#[serde(deny_unknown_fields)]
pub struct AgentRuntimeConfig {
    pub provider: Option<AgentProviderKind>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    #[serde(default)]
    pub auth: AgentAuthConfig,
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub retry: AgentRetryConfig,
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

[agent.auth]
env = "DEEPSEEK_API_KEY"

[agent.retry]
max_attempts = 3
"#,
        )
        .expect("config");

        assert_eq!(
            config.agent.provider,
            Some(AgentProviderKind::OpenAiCompatible)
        );
        assert_eq!(config.agent.model.as_deref(), Some("deepseek-chat"));
        assert_eq!(config.agent.auth.env.as_deref(), Some("DEEPSEEK_API_KEY"));
        assert_eq!(config.agent.retry.max_attempts, Some(3));
    }

    #[test]
    fn parses_provider_aliases() {
        let deepseek: AppConfig = toml::from_str(
            r#"
[agent]
provider = "deepseek"
model = "deepseek-v4-pro"
"#,
        )
        .expect("deepseek config");
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

        assert_eq!(deepseek.agent.provider, Some(AgentProviderKind::DeepSeek));
        assert_eq!(claude.agent.provider, Some(AgentProviderKind::Anthropic));
        assert_eq!(google.agent.provider, Some(AgentProviderKind::Gemini));
    }

    #[test]
    fn rejects_legacy_use_completions_api_field() {
        let err = toml::from_str::<AppConfig>(
            r#"
[agent]
provider = "openai-compatible"
model = "deepseek-chat"
use_completions_api = true
"#,
        )
        .expect_err("legacy field should be rejected");

        assert!(
            err.to_string()
                .contains("unknown field `use_completions_api`")
        );
    }

    #[test]
    fn rejects_legacy_api_mode_field() {
        let err = toml::from_str::<AppConfig>(
            r#"
[agent]
provider = "openai-compatible"
model = "deepseek-chat"
api_mode = "agent"
"#,
        )
        .expect_err("legacy api_mode should be rejected");

        assert!(err.to_string().contains("unknown field `api_mode`"));
    }

    #[test]
    fn rejects_legacy_overrides_section() {
        let err = toml::from_str::<AppConfig>(
            r#"
[agent]
provider = "openai-compatible"
model = "deepseek-chat"

[agent.overrides.skeleton_projection]
timeout_secs = 180
"#,
        )
        .expect_err("legacy overrides should be rejected");

        assert!(
            err.to_string().contains("unknown field `overrides`")
                || err
                    .to_string()
                    .contains("unknown field `skeleton_projection`")
        );
    }
}
