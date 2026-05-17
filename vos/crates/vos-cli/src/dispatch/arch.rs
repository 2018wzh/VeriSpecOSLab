use std::path::Path;
use vos_core::{artifact, envelope, CommandEnvelope, CommandStatus, DiagnosticPayload};

pub fn arch_lint_envelope(
    project_root: &Path,
    architecture_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    match vos_runtime::lint_architecture(project_root, Some(architecture_path)) {
        Ok(payload) => Ok(envelope(
            "vos arch lint",
            CommandStatus::Ok,
            vec![artifact(
                "architecture_path",
                architecture_path.display().to_string(),
            )],
            serde_json::to_value(payload).map_err(|e| e.to_string())?,
        )),
        Err(err) => Ok(envelope(
            "vos arch lint",
            CommandStatus::Failed,
            vec![artifact(
                "architecture_path",
                architecture_path.display().to_string(),
            )],
            serde_json::to_value(DiagnosticPayload {
                kind: "schema_mismatch".into(),
                message: err.to_string(),
                diagnostics: vec![
                    "current architecture parser is not yet aligned with the documented schema".into(),
                    format!("input: {}", architecture_path.display()),
                ],
            })
            .map_err(|e| e.to_string())?,
        )),
    }
}

pub fn arch_compose_envelope(
    project_root: &Path,
    architecture_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::compose_architecture(project_root, Some(architecture_path))
        .map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos arch compose",
        CommandStatus::Ok,
        vec![artifact(
            "architecture_path",
            architecture_path.display().to_string(),
        )],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

pub fn arch_derive_tests_envelope(
    project_root: &Path,
    architecture_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::derive_tests(project_root, Some(architecture_path))
        .map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos arch derive-tests",
        CommandStatus::Ok,
        vec![artifact(
            "architecture_path",
            architecture_path.display().to_string(),
        )],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}
