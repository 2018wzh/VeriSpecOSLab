use std::path::Path;
use vos_core::{CommandEnvelope, CommandStatus, artifact, envelope};

pub fn spec_lint_envelope(
    project_root: &Path,
    spec_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let (module, operation) =
        vos_spec::infer_module_operation_from_spec_path(project_root, spec_path)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_nested_module_and_operation_from_spec_path() {
        let project_root = Path::new("E:/demo");
        let path = Path::new("spec/modules/kernel/boot/ops/boot_banner.yaml");

        let (module, operation) =
            vos_spec::infer_module_operation_from_spec_path(project_root, path).expect("spec path");

        assert_eq!(module, "kernel/boot");
        assert_eq!(operation, "boot_banner");
    }
}
