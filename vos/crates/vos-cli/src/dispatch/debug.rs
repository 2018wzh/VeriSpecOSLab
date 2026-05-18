use std::path::Path;
use vos_core::{CommandEnvelope, CommandStatus, envelope};

pub fn debug_explain_log_envelope(
    _project_root: &Path,
    log_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::explain_log(log_path).map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos debug explain-log",
        CommandStatus::Ok,
        Vec::new(),
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}
