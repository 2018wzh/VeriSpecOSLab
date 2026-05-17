use reqwest::Client;
use serde_json::{json, Value};
use vos_core::{CodegenRequest, Result};

pub async fn send_responses_request(
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
