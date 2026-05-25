use serde::de::DeserializeOwned;

pub fn parse_skeleton_projection_response<T: DeserializeOwned>(raw: &str) -> Result<T, String> {
    parse_llm_json(raw).map_err(|err| format!("invalid skeleton projection response: {err}"))
}

pub fn parse_module_batch_response<T: DeserializeOwned>(raw: &str) -> Result<T, String> {
    parse_llm_json(raw).map_err(|err| format!("invalid module batch response: {err}"))
}

pub fn parse_toolchain_codegen_response<T: DeserializeOwned>(raw: &str) -> Result<T, String> {
    parse_llm_json(raw).map_err(|err| format!("invalid toolchain codegen response: {err}"))
}

fn parse_llm_json<T: DeserializeOwned>(raw: &str) -> Result<T, String> {
    let candidate = extract_json_candidate(raw);
    match serde_json::from_str(candidate) {
        Ok(value) => Ok(value),
        Err(original_error) => {
            let repaired = repair_invalid_json_string_escapes(candidate);
            if repaired == candidate {
                return Err(original_error.to_string());
            }
            serde_json::from_str(&repaired)
                .map_err(|repair_error| format!("{original_error}; repair failed: {repair_error}"))
        }
    }
}

fn extract_json_candidate(raw: &str) -> &str {
    let trimmed = raw.trim();
    let Some(start) = trimmed.find("```") else {
        return trimmed;
    };
    let rest = &trimmed[start + 3..];
    let rest = match rest.find('\n') {
        Some(idx) => &rest[idx + 1..],
        None => rest,
    };
    match rest.find("```") {
        Some(end) => rest[..end].trim(),
        None => trimmed,
    }
}

fn repair_invalid_json_string_escapes(input: &str) -> String {
    let mut repaired = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            repaired.push(ch);
            continue;
        }
        match chars.peek().copied() {
            Some('"' | '\\' | '/' | 'b' | 'f' | 'n' | 'r' | 't' | 'u') => {
                repaired.push(ch);
                repaired.push(chars.next().expect("peeked char should exist"));
            }
            Some(_) => {
                repaired.push(chars.next().expect("peeked char should exist"));
            }
            None => {}
        }
    }
    repaired
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Payload {
        content: String,
    }

    #[test]
    fn parses_json_inside_code_fence() {
        let parsed: Payload = parse_llm_json("```json\n{\"content\":\"ok\"}\n```").expect("json");

        assert_eq!(
            parsed,
            Payload {
                content: "ok".into()
            }
        );
    }

    #[test]
    fn repairs_invalid_backslash_escapes_in_json_strings() {
        let parsed: Payload =
            parse_llm_json("{\"content\":\"return ticks;\\n}\\n\\void syscall(void) {}\"}")
                .expect("repaired json");

        assert_eq!(parsed.content, "return ticks;\n}\nvoid syscall(void) {}");
    }
}
