use serde::de::DeserializeOwned;

pub fn parse_skeleton_projection_response<T: DeserializeOwned>(raw: &str) -> Result<T, String> {
    serde_json::from_str(raw).map_err(|err| format!("invalid skeleton projection response: {err}"))
}

pub fn parse_module_batch_response<T: DeserializeOwned>(raw: &str) -> Result<T, String> {
    serde_json::from_str(raw).map_err(|err| format!("invalid module batch response: {err}"))
}
