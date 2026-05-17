use std::path::Path;
use vos_core::{ContextBundle, Result};

use crate::config::load_config;
use crate::evidence::recent_evidence_refs;
use crate::fs_guard::allowed_paths;
use crate::scope::{current_stage, resolve_spec_root};

pub fn agent_context(
    project_root: &Path,
    stage: Option<&str>,
    visibility: Option<&str>,
) -> Result<ContextBundle> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let normalized = crate::normalize_spec(project_root, Some(&spec_root))?;
    let stage_name = stage
        .map(str::to_string)
        .unwrap_or_else(|| current_stage(&normalized).unwrap_or_else(|| "unknown".into()));
    let _compose = vos_spec::compose_architecture(project_root, &spec_root, &stage_name)?;
    Ok(ContextBundle {
        requested_scope: format!("stage:{stage_name}"),
        resolved_specs: normalized.hashes.keys().cloned().collect(),
        recent_evidence: recent_evidence_refs(project_root),
        allowed_paths: allowed_paths(&normalized, project_root),
        recommended_commands: vec![
            "vos spec normalize spec".into(),
            "vos spec check-consistency spec".into(),
            "vos agent plan".into(),
        ],
        visibility_scope: visibility.unwrap_or("public").to_string(),
    })
}
