use std::path::Path;
use vos_core::Result;

use crate::ContextBundle;

pub fn agent_context(
    project_root: &Path,
    stage: Option<&str>,
    visibility: Option<&str>,
) -> Result<ContextBundle> {
    let config = vos_runtime::load_config(project_root)?;
    let spec_root = vos_runtime::resolve_spec_root(project_root, None, &config)?;
    let normalized = vos_runtime::normalize_spec(project_root, Some(&spec_root))?;
    let stage_name = stage
        .map(str::to_string)
        .unwrap_or_else(|| vos_runtime::current_stage(&normalized).unwrap_or_else(|| "unknown".into()));
    let _compose = vos_spec::compose_architecture(project_root, &spec_root, &stage_name)?;
    Ok(ContextBundle {
        requested_scope: format!("stage:{stage_name}"),
        resolved_specs: normalized.hashes.keys().cloned().collect(),
        recent_evidence: vos_runtime::recent_evidence_refs(project_root),
        allowed_paths: vos_runtime::allowed_paths(&normalized, project_root),
        recommended_commands: vec![
            "vos spec normalize spec".into(),
            "vos spec check-consistency spec".into(),
            "vos agent plan".into(),
        ],
        visibility_scope: visibility.unwrap_or("public").to_string(),
    })
}
