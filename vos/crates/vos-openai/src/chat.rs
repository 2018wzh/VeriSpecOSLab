use reqwest::Client;
use serde_json::{json, Value};
use vos_core::{CodegenRequest, Result, VosError};

use crate::extract::extract_chat_text;

pub async fn send_chat_completions_request(
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
