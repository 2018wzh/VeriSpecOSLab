use serde_json::Value;

pub fn extract_text(value: &Value) -> Option<String> {
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

pub fn extract_chat_text(value: &Value) -> Option<String> {
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
    use serde_json::json;

    #[test]
    fn extracts_text_from_responses_payload() {
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

    #[test]
    fn extracts_text_from_chat_completions_payload() {
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
