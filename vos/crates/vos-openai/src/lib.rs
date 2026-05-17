use reqwest::Client;
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;
use vos_core::{CodegenRequest, CodegenResponse, Result, VosError};

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
    value.get("output")
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

pub fn extract_code_block(raw_text: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn extracts_text_from_responses_payload() {
        let value = json!({
            "output": [{
                "content": [{
                    "type": "output_text",
                    "text": "```rust\nfn demo() -> i32 { 1 }\n```"
                }]
            }]
        });

        let raw_text = extract_text(&value).unwrap();
        assert!(raw_text.contains("fn demo"));
        assert_eq!(extract_code_block(&raw_text), "fn demo() -> i32 { 1 }");
    }

    #[tokio::test]
    async fn extracts_text_from_chat_completions_payload() {
        let value = json!({
            "choices": [{
                "message": {
                    "content": "```rust\nfn demo() -> i32 { 2 }\n```"
                }
            }]
        });

        let raw_text = extract_chat_text(&value).unwrap();
        assert!(raw_text.contains("fn demo"));
        assert_eq!(extract_code_block(&raw_text), "fn demo() -> i32 { 2 }");
    }
}
