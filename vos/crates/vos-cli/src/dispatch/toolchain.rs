use std::path::Path;

use vos_core::{CommandEnvelope, CommandStatus, envelope};

pub fn toolchain_lint_envelope(
    project_root: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::lint_toolchain(project_root).map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos toolchain lint",
        if payload.ok {
            CommandStatus::Ok
        } else {
            CommandStatus::Failed
        },
        Vec::new(),
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}
