use reqwest::Client;
use reqwest::StatusCode;
use std::time::Duration;
use vos_core::{CodegenRequest, CodegenResponse, Result, VosError};

use crate::chat::send_chat_completions_request;
use crate::extract::{extract_code_block, extract_text};
use crate::responses::send_responses_request;

pub async fn generate_code(
    api_key: &str,
    base_url: &str,
    timeout_secs: u64,
    request: &CodegenRequest,
) -> Result<CodegenResponse> {
    let client = Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()?;
    let raw_text = match send_responses_request(&client, api_key, base_url, request).await {
        Ok(value) => extract_text(&value)
            .ok_or_else(|| VosError::Message("responses api did not return text output".into()))?,
        Err(VosError::Http(err))
            if matches!(err.status(), Some(StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED)) =>
        {
            send_chat_completions_request(&client, api_key, base_url, request).await?
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
