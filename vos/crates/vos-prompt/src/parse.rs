use vos_core::{ModuleBatchCodegenResponse, SkeletonProjectionResponse};

pub fn parse_skeleton_projection_response(raw: &str) -> Result<SkeletonProjectionResponse, String> {
    serde_json::from_str(raw).map_err(|err| format!("invalid skeleton projection response: {err}"))
}

pub fn parse_module_batch_response(raw: &str) -> Result<ModuleBatchCodegenResponse, String> {
    serde_json::from_str(raw).map_err(|err| format!("invalid module batch response: {err}"))
}
