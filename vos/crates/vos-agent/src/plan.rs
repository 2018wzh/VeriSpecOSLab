use std::fs;
use std::path::Path;
use vos_core::Result;

use crate::PlanDraft;

pub fn agent_plan(
    project_root: &Path,
    stage: Option<&str>,
    task: Option<&str>,
) -> Result<PlanDraft> {
    let config = vos_runtime::load_config(project_root)?;
    let spec_root = vos_runtime::resolve_spec_root(project_root, None, &config)?;
    let normalized = vos_runtime::normalize_spec(project_root, Some(&spec_root))?;
    let stage_name = stage
        .map(str::to_string)
        .unwrap_or_else(|| vos_runtime::current_stage(&normalized).unwrap_or_else(|| "unknown".into()));
    let queue = vos_spec::build_generation_queue(project_root, &spec_root, &stage_name)?;
    let compose = vos_spec::compose_architecture(project_root, &spec_root, &stage_name)?;
    let plan = PlanDraft {
        task: task
            .unwrap_or("strict spec -> skeleton projection -> module generation -> build -> run")
            .to_string(),
        related_specs: normalized.hashes.keys().cloned().collect(),
        suspected_files: vos_runtime::allowed_paths(&normalized, project_root),
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
    let run_dir = project_root
        .join(".vos")
        .join("runs")
        .join(vos_core::new_run_id());
    fs::create_dir_all(&run_dir)?;
    vos_runtime::write_json(&run_dir.join("agent-plan.json"), &plan)?;
    Ok(plan)
}
