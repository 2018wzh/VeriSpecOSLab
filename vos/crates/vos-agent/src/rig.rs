use std::env;
use std::fs;
use std::path::Path;
use std::time::Duration;

use rig_core::agent::{Agent, PromptHook};
use rig_core::client::CompletionClient;
use rig_core::completion::{
    AssistantContent, Completion, CompletionError, CompletionModel, Message,
};
use rig_core::providers::{anthropic, deepseek, gemini, openai};
use serde::Serialize;
use serde_json::Value;
use tokio::time::timeout;
use vos_core::{AgentProviderKind, AppConfig, Result, VosError};
use vos_runtime::ResolvedAgentConfig;

use crate::{CodegenRequest, PromptEnvelope};

#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub enum RigStage {
    Context,
    Plan,
    PromptAssemble,
    ProviderCall,
    Parse,
    ValidateGate,
    Evidence,
}

#[derive(Debug, Clone, Serialize)]
struct RigResponseArtifact {
    model: String,
    raw_text: String,
    extracted_code: String,
    raw_response: Value,
}

#[derive(Debug, Clone, Serialize)]
struct RigFailureArtifact {
    provider: String,
    model: String,
    base_url: String,
    timeout_secs: u64,
    max_attempts: u32,
    error_kind: String,
    error: String,
}

pub struct RigWorkflow<'a> {
    config: &'a AppConfig,
}

impl<'a> RigWorkflow<'a> {
    pub fn new(config: &'a AppConfig) -> Self {
        Self { config }
    }

    pub async fn run_prompt_stage(
        &self,
        run_dir: &Path,
        _stage: RigStage,
        prompt: &PromptEnvelope,
    ) -> Result<String> {
        fs::create_dir_all(run_dir)?;

        let resolved = vos_runtime::resolve_agent_config(self.config)?;
        let request = CodegenRequest {
            spec_ref: prompt.spec_ref.clone(),
            phase: prompt.phase.clone(),
            model: resolved.model.clone(),
            prompt: prompt.prompt.clone(),
        };
        vos_runtime::write_json(&run_dir.join("request.json"), &request)?;
        fs::write(run_dir.join("prompt.txt"), &prompt.prompt)?;

        let artifact = match execute_prompt(&resolved, prompt).await {
            Ok(artifact) => artifact,
            Err(err) => {
                let failure = RigFailureArtifact {
                    provider: resolved.provider.as_str().to_string(),
                    model: resolved.model.clone(),
                    base_url: resolved.base_url.clone(),
                    timeout_secs: resolved.timeout_secs,
                    max_attempts: resolved.max_attempts,
                    error_kind: classify_error(&err).to_string(),
                    error: err.to_string(),
                };
                let _ = vos_runtime::write_json(&run_dir.join("failure.json"), &failure);
                let _ = fs::write(run_dir.join("failure.txt"), err.to_string());
                return Err(err);
            }
        };
        vos_runtime::write_json(&run_dir.join("response.json"), &artifact)?;
        fs::write(run_dir.join("response.txt"), &artifact.raw_text)?;
        Ok(artifact.extracted_code)
    }
}

pub(crate) fn validate_provider_config(config: &AppConfig) -> Result<()> {
    vos_runtime::validate_agent_config(config)
}

async fn execute_prompt(
    resolved: &ResolvedAgentConfig,
    prompt: &PromptEnvelope,
) -> Result<RigResponseArtifact> {
    let api_key = env::var(&resolved.api_key_env).map_err(|_| {
        VosError::Message(format!(
            "{} is required for provider `{}`",
            resolved.api_key_env,
            resolved.provider.as_str()
        ))
    })?;

    let mut last_error = None;
    for attempt in 1..=resolved.max_attempts {
        match execute_prompt_once(resolved, prompt, &api_key).await {
            Ok(artifact) => return Ok(artifact),
            Err(err) if attempt < resolved.max_attempts && is_retryable_error(&err) => {
                last_error = Some(err);
            }
            Err(err) => return Err(err),
        }
    }

    Err(last_error.unwrap_or_else(|| VosError::Message("rig prompt execution failed".into())))
}

async fn execute_prompt_once(
    resolved: &ResolvedAgentConfig,
    prompt: &PromptEnvelope,
    api_key: &str,
) -> Result<RigResponseArtifact> {
    match resolved.provider {
        AgentProviderKind::OpenAi => {
            let client = openai::Client::builder()
                .api_key(api_key)
                .base_url(&resolved.base_url)
                .build()
                .map_err(map_client_builder_error)?;
            let agent = client.agent(&resolved.model).build();
            execute_agent_completion(agent, resolved, prompt).await
        }
        AgentProviderKind::OpenAiCompatible => {
            let client = openai::CompletionsClient::builder()
                .api_key(api_key)
                .base_url(&resolved.base_url)
                .build()
                .map_err(map_client_builder_error)?;
            let agent = client
                .completion_model(&resolved.model)
                .into_agent_builder()
                .build();
            execute_agent_completion(agent, resolved, prompt).await
        }
        AgentProviderKind::Anthropic => {
            let client = anthropic::Client::builder()
                .api_key(api_key)
                .base_url(&resolved.base_url)
                .build()
                .map_err(map_client_builder_error)?;
            let agent = client.agent(&resolved.model).build();
            execute_agent_completion(agent, resolved, prompt).await
        }
        AgentProviderKind::DeepSeek => {
            let client = deepseek::Client::builder()
                .api_key(api_key)
                .base_url(&resolved.base_url)
                .build()
                .map_err(map_client_builder_error)?;
            let agent = client.agent(&resolved.model).build();
            execute_agent_completion(agent, resolved, prompt).await
        }
        AgentProviderKind::Gemini => {
            let client = gemini::Client::builder()
                .api_key(api_key)
                .base_url(&resolved.base_url)
                .build()
                .map_err(map_client_builder_error)?;
            let agent = client.agent(&resolved.model).build();
            execute_agent_completion(agent, resolved, prompt).await
        }
    }
}

async fn execute_agent_completion<M, P>(
    agent: Agent<M, P>,
    resolved: &ResolvedAgentConfig,
    prompt: &PromptEnvelope,
) -> Result<RigResponseArtifact>
where
    M: CompletionModel + 'static,
    M::Response: Serialize,
    P: PromptHook<M> + 'static,
{
    let response = timeout(Duration::from_secs(resolved.timeout_secs), async {
        let request = agent
            .completion(prompt.prompt.clone(), Vec::<Message>::new())
            .await
            .map_err(map_completion_error)?;
        request.send().await.map_err(map_completion_error)
    })
    .await
    .map_err(|_| {
        VosError::Timeout(format!(
            "rig agent completion timed out after {}s",
            resolved.timeout_secs
        ))
    })??;

    let raw_text = extract_text_output(&response.choice)
        .ok_or_else(|| VosError::Message("rig completion did not return text output".into()))?;
    let extracted_code = extract_code_block(&raw_text);
    let raw_response = serde_json::to_value(&response.raw_response)?;

    Ok(RigResponseArtifact {
        model: resolved.model.clone(),
        raw_text,
        extracted_code,
        raw_response,
    })
}

fn extract_text_output(choice: &rig_core::OneOrMany<AssistantContent>) -> Option<String> {
    let mut chunks = Vec::new();
    for item in choice.iter() {
        match item {
            AssistantContent::Text(text) => chunks.push(text.text.clone()),
            AssistantContent::Reasoning(_)
            | AssistantContent::ToolCall(_)
            | AssistantContent::Image(_) => {}
        }
    }
    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join("\n"))
    }
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

fn classify_error(error: &VosError) -> &'static str {
    match error {
        VosError::Timeout(_) => "timeout",
        VosError::Transport(_) => "transport",
        VosError::Message(_) => "message",
        VosError::Io(_) => "io",
        VosError::Yaml(_) => "yaml",
        VosError::Json(_) => "json",
        VosError::Toml(_) => "toml",
        VosError::TomlSer(_) => "toml-ser",
    }
}

fn is_retryable_error(error: &VosError) -> bool {
    match error {
        VosError::Timeout(_) => true,
        VosError::Transport(message) | VosError::Message(message) => {
            message.contains("429")
                || message.contains("503")
                || message.contains("504")
                || message.contains("timed out")
                || message.contains("connection")
                || message.contains("transport")
        }
        _ => false,
    }
}

fn map_client_builder_error(error: rig_core::http_client::Error) -> VosError {
    VosError::Transport(format!("rig client build failed: {error}"))
}

fn map_completion_error(error: CompletionError) -> VosError {
    match error {
        CompletionError::HttpError(http_error) => match http_error {
            rig_core::http_client::Error::InvalidStatusCode(status) => {
                VosError::Message(format!("rig completion failed with status {status}"))
            }
            rig_core::http_client::Error::InvalidStatusCodeWithMessage(status, message) => {
                VosError::Message(format!(
                    "rig completion failed with status {status}: {message}"
                ))
            }
            other => VosError::Transport(format!("rig http error: {other}")),
        },
        CompletionError::JsonError(err) => VosError::Json(err),
        CompletionError::UrlError(err) => VosError::Transport(format!("rig url error: {err}")),
        CompletionError::RequestError(err) => {
            VosError::Transport(format!("rig request error: {err}"))
        }
        CompletionError::ResponseError(message) | CompletionError::ProviderError(message) => {
            VosError::Message(message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig_core::OneOrMany;
    use rig_core::message::{Reasoning, Text};

    #[test]
    fn extracts_text_and_ignores_reasoning_blocks() {
        let choice = OneOrMany::many(vec![
            AssistantContent::Reasoning(Reasoning::summaries(vec!["plan".into()])),
            AssistantContent::Text(Text {
                text: "```c\nint x = 1;\n```".into(),
            }),
        ])
        .expect("choice");

        let output = extract_text_output(&choice).expect("text");

        assert_eq!(output, "```c\nint x = 1;\n```");
        assert_eq!(extract_code_block(&output), "int x = 1;");
    }

    #[test]
    fn classifies_retryable_status_messages() {
        assert!(is_retryable_error(&VosError::Message(
            "rig completion failed with status 429: rate limited".into()
        )));
        assert!(!is_retryable_error(&VosError::Message(
            "rig completion failed with status 400: bad request".into()
        )));
    }

    #[test]
    fn classifies_timeout_and_transport_errors_as_retryable() {
        assert!(is_retryable_error(&VosError::Timeout("timed out".into())));
        assert!(is_retryable_error(&VosError::Transport(
            "rig request error: connection reset".into()
        )));
    }
}
