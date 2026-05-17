use std::env;
use std::fs;
use std::path::Path;

use vos_core::{is_valid_env_var_name, AppConfig, CodegenRequest, Result, VosError};

pub(crate) fn validate_provider_config(config: &AppConfig) -> Result<()> {
    let kind = resolve_provider_kind(config);
    if kind != "openai-compatible" && kind != "openai" {
        return Err(VosError::Message(format!(
            "unsupported provider.kind `{kind}`; use `openai-compatible`"
        )));
    }
    let env_name = resolve_api_key_env(config);
    if !is_valid_env_var_name(env_name) {
        return Err(VosError::Message(format!(
            "provider.api_key_env must be an environment variable name, got `{env_name}`"
        )));
    }
    Ok(())
}

pub(crate) fn load_project_dotenv(project_root: &Path) {
    let dotenv_path = project_root.join(".env");
    if dotenv_path.exists() {
        let _ = dotenvy::from_path(dotenv_path);
    }
}

pub(crate) fn resolve_model(config: &AppConfig) -> String {
    config.provider.model.clone().unwrap_or_else(|| "gpt-5.4".into())
}

pub(crate) fn resolve_base_url(config: &AppConfig) -> String {
    config
        .provider
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.openai.com/v1".into())
}

pub(crate) fn resolve_provider_kind(config: &AppConfig) -> String {
    config
        .provider
        .kind
        .clone()
        .unwrap_or_else(|| "openai-compatible".into())
}

pub(crate) fn resolve_api_key_env(config: &AppConfig) -> &str {
    config.provider.api_key_env.as_deref().unwrap_or("OPENAI_API_KEY")
}

#[allow(dead_code)]
pub(crate) fn resolve_timeout_secs(config: &AppConfig) -> u64 {
    config.provider.timeout_secs.unwrap_or(120)
}

pub(crate) async fn call_json_prompt(
    config: &AppConfig,
    run_dir: &Path,
    prompt: &vos_core::PromptEnvelope,
) -> Result<String> {
    fs::create_dir_all(run_dir)?;
    let request = CodegenRequest {
        spec_ref: prompt.spec_ref.clone(),
        phase: prompt.phase.clone(),
        model: resolve_model(config),
        prompt: prompt.prompt.clone(),
    };
    crate::evidence::write_json(&run_dir.join("request.json"), &request)?;
    fs::write(run_dir.join("prompt.txt"), &prompt.prompt)?;
    let api_key = env::var(resolve_api_key_env(config))
        .map_err(|_| VosError::Message(format!("{} is required", resolve_api_key_env(config))))?;
    let response = vos_openai::generate_code(
        &api_key,
        &resolve_base_url(config),
        resolve_timeout_secs(config),
        &request,
    )
    .await?;
    fs::write(run_dir.join("response.txt"), &response.raw_text)?;
    Ok(response.extracted_code)
}
