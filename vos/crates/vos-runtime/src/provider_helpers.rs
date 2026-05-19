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
    pub max_attempts: u32,
}

pub(crate) fn validate_agent_runtime_config(config: &AppConfig) -> Result<()> {
    let _ = resolve_agent_runtime_config(config)?;
    Ok(())
}

pub(crate) fn load_project_dotenv(project_root: &std::path::Path) {
    let dotenv_path = project_root.join(".env");
    if dotenv_path.exists() {
        let _ = dotenvy::from_path(dotenv_path);
    }
}

pub(crate) fn resolve_agent_runtime_config(config: &AppConfig) -> Result<ResolvedAgentConfig> {
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

    let model = agent
        .model
        .clone()
        .ok_or_else(|| VosError::Message("agent.model is required".into()))?;
    let timeout_secs = agent.timeout_secs.unwrap_or(120);
    let max_attempts = agent.retry.max_attempts.unwrap_or(1);
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
            AgentProviderKind::DeepSeek => "DEEPSEEK_API_KEY".into(),
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
        AgentProviderKind::DeepSeek => "https://api.deepseek.com".into(),
        AgentProviderKind::Anthropic => "https://api.anthropic.com".into(),
        AgentProviderKind::Gemini => "https://generativelanguage.googleapis.com".into(),
        AgentProviderKind::OpenAi | AgentProviderKind::OpenAiCompatible => {
            "https://api.openai.com/v1".into()
        }
    })
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
        assert!(resolve_agent_runtime_config(&missing_model).is_err());

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
        assert!(resolve_agent_runtime_config(&missing_auth).is_err());
    }

    #[test]
    fn resolves_openai_compatible_endpoint() {
        let config = AppConfig {
            agent: vos_core::AgentRuntimeConfig {
                provider: Some(AgentProviderKind::OpenAiCompatible),
                model: Some("gpt-5.4".into()),
                base_url: Some("https://example.test/v1".into()),
                auth: vos_core::AgentAuthConfig {
                    env: Some("OPENAI_API_KEY".into()),
                },
                timeout_secs: Some(200),
                retry: vos_core::AgentRetryConfig {
                    max_attempts: Some(2),
                },
            },
            ..Default::default()
        };

        let resolved = resolve_agent_runtime_config(&config).expect("resolved config");

        assert_eq!(resolved.base_url, "https://example.test/v1");
        assert_eq!(resolved.model, "gpt-5.4");
        assert_eq!(resolved.timeout_secs, 200);
        assert_eq!(resolved.max_attempts, 2);
    }

    #[test]
    fn resolves_google_claude_and_deepseek_defaults() {
        let deepseek = AppConfig {
            agent: vos_core::AgentRuntimeConfig {
                provider: Some(AgentProviderKind::DeepSeek),
                model: Some("deepseek-v4-pro".into()),
                ..Default::default()
            },
            ..Default::default()
        };
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

        let deepseek_resolved = resolve_agent_runtime_config(&deepseek).expect("deepseek");
        let claude_resolved = resolve_agent_runtime_config(&claude).expect("claude");
        let google_resolved = resolve_agent_runtime_config(&google).expect("google");

        assert_eq!(deepseek_resolved.api_key_env, "DEEPSEEK_API_KEY");
        assert_eq!(deepseek_resolved.base_url, "https://api.deepseek.com");

        assert_eq!(claude_resolved.api_key_env, "ANTHROPIC_API_KEY");
        assert_eq!(claude_resolved.base_url, "https://api.anthropic.com");

        assert_eq!(google_resolved.api_key_env, "GEMINI_API_KEY");
        assert_eq!(
            google_resolved.base_url,
            "https://generativelanguage.googleapis.com"
        );
    }
}
