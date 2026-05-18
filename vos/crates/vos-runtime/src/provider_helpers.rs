use vos_core::{
    AgentProviderKind, AgentRuntimeConfig, AppConfig, Result, VosError, is_valid_env_var_name,
};

#[derive(Debug, Clone)]
pub struct ResolvedAgentConfig {
    pub provider: AgentProviderKind,
    pub model: String,
    pub base_url: String,
    pub api_key_env: String,
    pub timeout_secs: u64,
    pub use_completions_api: bool,
    pub max_attempts: u32,
}

pub(crate) fn validate_agent_runtime_config(config: &AppConfig) -> Result<()> {
    let _ = resolve_agent_runtime_config(config, &[])?;
    Ok(())
}

pub(crate) fn load_project_dotenv(project_root: &std::path::Path) {
    let dotenv_path = project_root.join(".env");
    if dotenv_path.exists() {
        let _ = dotenvy::from_path(dotenv_path);
    }
}

pub(crate) fn resolve_agent_runtime_config(
    config: &AppConfig,
    task_keys: &[&str],
) -> Result<ResolvedAgentConfig> {
    let agent = &config.agent;
    let provider = agent
        .provider
        .ok_or_else(|| VosError::Message("agent.provider is required".into()))?;
    let api_key_env = resolve_api_key_env(agent);
    if !is_valid_env_var_name(&api_key_env) {
        return Err(VosError::Message(format!(
            "agent.auth.env must be an environment variable name, got `{api_key_env}`"
        )));
    }

    let mut model = agent
        .model
        .clone()
        .ok_or_else(|| VosError::Message("agent.model is required".into()))?;
    let mut timeout_secs = agent.timeout_secs.unwrap_or(120);
    let mut use_completions_api = agent
        .use_completions_api
        .unwrap_or(default_use_completions_api(provider));
    let mut max_attempts = agent.retry.max_attempts.unwrap_or(1);

    for key in task_keys {
        if let Some(override_) = config.agent.overrides.get(*key) {
            if let Some(override_model) = &override_.model {
                model = override_model.clone();
            }
            if let Some(override_timeout) = override_.timeout_secs {
                timeout_secs = override_timeout;
            }
            if let Some(override_completions) = override_.use_completions_api {
                use_completions_api = override_completions;
            }
            if let Some(override_attempts) = override_.retry.max_attempts {
                max_attempts = override_attempts;
            }
        }
    }

    let base_url = resolve_base_url(provider, agent);

    if max_attempts == 0 {
        return Err(VosError::Message(
            "agent.retry.max_attempts must be at least 1".into(),
        ));
    }
    if timeout_secs == 0 {
        return Err(VosError::Message(
            "agent.timeout_secs must be at least 1".into(),
        ));
    }

    Ok(ResolvedAgentConfig {
        provider,
        model,
        base_url,
        api_key_env,
        timeout_secs,
        use_completions_api,
        max_attempts,
    })
}

pub(crate) fn resolve_provider_kind(config: &ResolvedAgentConfig) -> String {
    config.provider.as_str().to_string()
}

fn resolve_api_key_env(config: &AgentRuntimeConfig) -> String {
    config.auth.env.clone().unwrap_or_else(|| {
        match config
            .provider
            .unwrap_or(AgentProviderKind::OpenAiCompatible)
        {
            AgentProviderKind::Deepseek => "DEEPSEEK_API_KEY".into(),
            AgentProviderKind::Anthropic => "ANTHROPIC_API_KEY".into(),
            AgentProviderKind::Gemini => "GEMINI_API_KEY".into(),
            AgentProviderKind::OpenAi | AgentProviderKind::OpenAiCompatible => {
                "OPENAI_API_KEY".into()
            }
        }
    })
}

fn resolve_base_url(provider: AgentProviderKind, config: &AgentRuntimeConfig) -> String {
    config.base_url.clone().unwrap_or_else(|| match provider {
        AgentProviderKind::Deepseek => "https://api.deepseek.com".into(),
        AgentProviderKind::Anthropic => "https://api.anthropic.com".into(),
        AgentProviderKind::Gemini => "https://generativelanguage.googleapis.com".into(),
        AgentProviderKind::OpenAi | AgentProviderKind::OpenAiCompatible => {
            "https://api.openai.com/v1".into()
        }
    })
}

fn default_use_completions_api(provider: AgentProviderKind) -> bool {
    matches!(
        provider,
        AgentProviderKind::Deepseek | AgentProviderKind::OpenAiCompatible
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_model_or_auth_source() {
        let missing_model = AppConfig {
            agent: vos_core::AgentRuntimeConfig {
                provider: Some(AgentProviderKind::OpenAiCompatible),
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(resolve_agent_runtime_config(&missing_model, &[]).is_err());

        let missing_auth = AppConfig {
            agent: vos_core::AgentRuntimeConfig {
                provider: Some(AgentProviderKind::OpenAiCompatible),
                model: Some("gpt-5.4".into()),
                auth: vos_core::AgentAuthConfig {
                    env: Some("".into()),
                },
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(resolve_agent_runtime_config(&missing_auth, &[]).is_err());
    }

    #[test]
    fn resolves_openai_compatible_endpoint_and_overrides() {
        let config = AppConfig {
            agent: vos_core::AgentRuntimeConfig {
                provider: Some(AgentProviderKind::OpenAiCompatible),
                model: Some("gpt-5.4".into()),
                base_url: Some("https://example.test/v1".into()),
                auth: vos_core::AgentAuthConfig {
                    env: Some("OPENAI_API_KEY".into()),
                },
                retry: vos_core::AgentRetryConfig {
                    max_attempts: Some(2),
                },
                overrides: std::collections::BTreeMap::from([(
                    "skeleton_projection".into(),
                    vos_core::AgentTaskOverride {
                        model: Some("gpt-5.5".into()),
                        timeout_secs: Some(200),
                        use_completions_api: Some(true),
                        retry: vos_core::AgentRetryConfig {
                            max_attempts: Some(4),
                        },
                    },
                )]),
                ..Default::default()
            },
            ..Default::default()
        };

        let resolved = resolve_agent_runtime_config(&config, &["skeleton_projection"])
            .expect("resolved config");

        assert_eq!(resolved.base_url, "https://example.test/v1");
        assert_eq!(resolved.model, "gpt-5.5");
        assert_eq!(resolved.timeout_secs, 200);
        assert!(resolved.use_completions_api);
        assert_eq!(resolved.max_attempts, 4);
    }

    #[test]
    fn resolves_google_and_claude_defaults() {
        let claude = AppConfig {
            agent: vos_core::AgentRuntimeConfig {
                provider: Some(AgentProviderKind::Anthropic),
                model: Some("claude-sonnet-4".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        let google = AppConfig {
            agent: vos_core::AgentRuntimeConfig {
                provider: Some(AgentProviderKind::Gemini),
                model: Some("gemini-2.5-pro".into()),
                ..Default::default()
            },
            ..Default::default()
        };

        let claude_resolved = resolve_agent_runtime_config(&claude, &[]).expect("claude");
        let google_resolved = resolve_agent_runtime_config(&google, &[]).expect("google");

        assert_eq!(claude_resolved.api_key_env, "ANTHROPIC_API_KEY");
        assert_eq!(claude_resolved.base_url, "https://api.anthropic.com");
        assert!(!claude_resolved.use_completions_api);

        assert_eq!(google_resolved.api_key_env, "GEMINI_API_KEY");
        assert_eq!(
            google_resolved.base_url,
            "https://generativelanguage.googleapis.com"
        );
        assert!(!google_resolved.use_completions_api);
    }
}
