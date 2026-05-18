use std::path::Path;
use vos_core::{CommandEnvelope, CommandStatus, artifact, envelope};

pub fn spec_lint_envelope(
    project_root: &Path,
    spec_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let (module, operation) = infer_module_operation_from_spec_path(project_root, spec_path)
        .map_err(|e| e.to_string())?;
    let payload =
        vos_runtime::lint_spec(project_root, &module, &operation).map_err(|e| e.to_string())?;
    let artifacts = vec![artifact("spec_path", spec_path.display().to_string())];
    Ok(envelope(
        "vos spec lint",
        CommandStatus::Ok,
        artifacts,
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

pub fn spec_normalize_envelope(
    project_root: &Path,
    spec_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload =
        vos_runtime::normalize_spec(project_root, Some(spec_path)).map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos spec normalize",
        CommandStatus::Ok,
        vec![artifact("spec_path", spec_path.display().to_string())],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

pub fn spec_check_consistency_envelope(
    project_root: &Path,
    spec_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload =
        vos_runtime::check_consistency(project_root, Some(spec_path)).map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos spec check-consistency",
        if payload.ok {
            CommandStatus::Ok
        } else {
            CommandStatus::Failed
        },
        vec![artifact("spec_path", spec_path.display().to_string())],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

fn infer_module_operation_from_spec_path(
    project_root: &Path,
    spec_path: &Path,
) -> Result<(String, String), String> {
    let absolute = if spec_path.is_absolute() {
        spec_path.to_path_buf()
    } else {
        project_root.join(spec_path)
    };
    let components = absolute
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let ops_index = components
        .iter()
        .position(|component| component == "ops")
        .ok_or_else(|| {
            format!(
                "spec path does not point to an operation spec: {}",
                absolute.display()
            )
        })?;
    if ops_index == 0 || ops_index + 1 >= components.len() {
        return Err(format!(
            "spec path does not contain module/operation binding: {}",
            absolute.display()
        ));
    }
    let module = components[ops_index - 1].clone();
    let operation = absolute
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| format!("invalid operation spec filename: {}", absolute.display()))?
        .to_string();
    Ok((module, operation))
}
