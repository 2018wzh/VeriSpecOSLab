use std::env;
use std::fs;
use std::path::Path;
use std::time::Duration;

use reqwest::Client;
use reqwest::StatusCode;
use serde_json::{Value, json};
use vos_core::{AppConfig, ProviderProfile, Result, VosError, is_valid_env_var_name};

use crate::{CodegenRequest, CodegenResponse, PromptEnvelope};

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

#[allow(dead_code)]
pub(crate) fn resolve_timeout_secs(profile: &ProviderProfile) -> u64 {
    profile.timeout_secs.unwrap_or(120)
}

pub(crate) async fn call_json_prompt(
    config: &AppConfig,
    run_dir: &Path,
    prompt: &PromptEnvelope,
) -> Result<String> {
    fs::create_dir_all(run_dir)?;
    let active = resolve_active_provider(config)?;
    let request = CodegenRequest {
        spec_ref: prompt.spec_ref.clone(),
        phase: prompt.phase.clone(),
        model: resolve_model(&active.profile),
        prompt: prompt.prompt.clone(),
    };
    vos_runtime::write_json(&run_dir.join("request.json"), &request)?;
    fs::write(run_dir.join("prompt.txt"), &prompt.prompt)?;
    let api_key = env::var(resolve_api_key_env(&active.profile)).map_err(|_| {
        VosError::Message(format!(
            "{} is required for provider `{}`",
            resolve_api_key_env(&active.profile),
            active.name
        ))
    })?;
    let response = provider_generate_code(&api_key, &active.profile, &request).await?;
    fs::write(run_dir.join("response.txt"), &response.raw_text)?;
    Ok(response.extracted_code)
}

async fn provider_generate_code(
    api_key: &str,
    profile: &ProviderProfile,
    request: &CodegenRequest,
) -> Result<CodegenResponse> {
    let client = Client::builder()
        .timeout(Duration::from_secs(resolve_timeout_secs(profile)))
        .build()?;
    let base_url = resolve_base_url(profile);
    let raw_text = match send_responses_request(&client, api_key, &base_url, request).await {
        Ok(value) => extract_text(&value)
            .ok_or_else(|| VosError::Message("responses api did not return text output".into()))?,
        Err(VosError::Http(err))
            if matches!(
                err.status(),
                Some(StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED)
            ) =>
        {
            send_chat_completions_request(&client, api_key, &base_url, request).await?
        }
        Err(err) => return Err(err),
    };
    let extracted_code = extract_code_block(&raw_text);
    Ok(CodegenResponse {
        model: request.model.clone(),
        raw_text,
        extracted_code,
    })
}

async fn send_responses_request(
    client: &Client,
    api_key: &str,
    base_url: &str,
    request: &CodegenRequest,
) -> Result<Value> {
    let url = format!("{}/responses", base_url.trim_end_matches('/'));
    let body = json!({
        "model": request.model,
        "input": request.prompt,
    });
    Ok(client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}

async fn send_chat_completions_request(
    client: &Client,
    api_key: &str,
    base_url: &str,
    request: &CodegenRequest,
) -> Result<String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = json!({
        "model": request.model,
        "messages": [
            {
                "role": "user",
                "content": request.prompt,
            }
        ]
    });
    let value: Value = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    extract_chat_text(&value)
        .ok_or_else(|| VosError::Message("chat completions api did not return text output".into()))
}

fn extract_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    value
        .get("output")
        .and_then(Value::as_array)
        .and_then(|items| {
            let mut acc = String::new();
            for item in items {
                if let Some(content) = item.get("content").and_then(Value::as_array) {
                    for part in content {
                        if let Some(text) = part.get("text").and_then(Value::as_str) {
                            if !acc.is_empty() {
                                acc.push('\n');
                            }
                            acc.push_str(text);
                        }
                    }
                }
            }
            if acc.is_empty() { None } else { Some(acc) }
        })
}

fn extract_chat_text(value: &Value) -> Option<String> {
    let content = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    content.as_array().and_then(|parts| {
        let mut acc = String::new();
        for part in parts {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                if !acc.is_empty() {
                    acc.push('\n');
                }
                acc.push_str(text);
            }
        }
        if acc.is_empty() { None } else { Some(acc) }
    })
}

fn extract_code_block(raw_text: &str) -> String {
    let trimmed = raw_text.trim();
    if let Some(start) = trimmed.find("```") {
        let rest = &trimmed[start + 3..];
        let rest = match rest.find('\n') {
            Some(idx) => &rest[idx + 1..],
            None => rest,
        };
        if let Some(end) = rest.find("```") {
            return rest[..end].trim().to_string();
        }
    }
    trimmed.to_string()
}
