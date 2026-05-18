use vos_core::{AppConfig, ProviderProfile, Result, VosError, is_valid_env_var_name};

#[derive(Debug, Clone)]
pub(crate) struct ActiveProvider {
    pub name: String,
    pub profile: ProviderProfile,
}

pub(crate) fn validate_provider_config(config: &AppConfig) -> Result<()> {
    let active = resolve_active_provider(config)?;
    let kind = resolve_provider_kind(&active.profile);
    if kind != "openai-compatible" && kind != "openai" {
        return Err(VosError::Message(format!(
            "unsupported providers.{}.kind `{kind}`; use `openai-compatible`",
            active.name
        )));
    }
    let env_name = resolve_api_key_env(&active.profile);
    if !is_valid_env_var_name(env_name) {
        return Err(VosError::Message(format!(
            "providers.{}.api_key_env must be an environment variable name, got `{env_name}`",
            active.name
        )));
    }
    Ok(())
}

pub(crate) fn load_project_dotenv(project_root: &std::path::Path) {
    let dotenv_path = project_root.join(".env");
    if dotenv_path.exists() {
        let _ = dotenvy::from_path(dotenv_path);
    }
}

pub(crate) fn resolve_active_provider(config: &AppConfig) -> Result<ActiveProvider> {
    let name = config
        .default_provider
        .clone()
        .ok_or_else(|| VosError::Message("default_provider is required".into()))?;
    let profile = config.providers.get(&name).cloned().ok_or_else(|| {
        VosError::Message(format!(
            "default_provider `{name}` not found in [providers]"
        ))
    })?;
    Ok(ActiveProvider { name, profile })
}

pub(crate) fn resolve_model(profile: &ProviderProfile) -> String {
    profile.model.clone().unwrap_or_else(|| "gpt-5.4".into())
}

pub(crate) fn resolve_base_url(profile: &ProviderProfile) -> String {
    profile
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.openai.com/v1".into())
}

pub(crate) fn resolve_provider_kind(profile: &ProviderProfile) -> String {
    profile
        .kind
        .clone()
        .unwrap_or_else(|| "openai-compatible".into())
}

pub(crate) fn resolve_api_key_env(profile: &ProviderProfile) -> &str {
    profile.api_key_env.as_deref().unwrap_or("OPENAI_API_KEY")
}
