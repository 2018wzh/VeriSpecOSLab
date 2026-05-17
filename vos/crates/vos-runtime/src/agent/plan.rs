use std::fs;
use std::path::Path;
use vos_core::{PlanDraft, Result};

use crate::config::load_config;
use crate::evidence::write_json;
use crate::fs_guard::allowed_paths;
use crate::scope::{current_stage, resolve_spec_root};

pub fn agent_plan(
    project_root: &Path,
    stage: Option<&str>,
    task: Option<&str>,
) -> Result<PlanDraft> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let normalized = crate::normalize_spec(project_root, Some(&spec_root))?;
    let stage_name = stage
        .map(str::to_string)
        .unwrap_or_else(|| current_stage(&normalized).unwrap_or_else(|| "unknown".into()));
    let queue = vos_spec::build_generation_queue(project_root, &spec_root, &stage_name)?;
    let compose = vos_spec::compose_architecture(project_root, &spec_root, &stage_name)?;
    let plan = PlanDraft {
        task: task
            .unwrap_or("strict spec -> skeleton projection -> module generation -> build -> run")
            .to_string(),
        related_specs: normalized.hashes.keys().cloned().collect(),
        suspected_files: allowed_paths(&normalized, project_root),
        required_validations: vec![
            "spec normalize".into(),
            "spec check-consistency".into(),
            "arch compose".into(),
            "arch derive-tests".into(),
            "build".into(),
            "run qemu".into(),
        ],
        notes: vec![
            format!("current_stage={}", compose.current_stage),
            "skeleton projection runs before module batch codegen".into(),
            "module generation executes by dependency waves".into(),
        ],
        generation_waves: queue.waves,
    };
    let run_dir = project_root.join(".vos").join("runs").join(vos_core::new_run_id());
    fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("agent-plan.json"), &plan)?;
    Ok(plan)
}
