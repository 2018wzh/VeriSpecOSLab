use std::path::Path;
use vos_core::Result;

use crate::build::build_with_progress;
use crate::config::load_config;
use crate::config::ProgressSink;
use crate::run_qemu::run_qemu_with_progress;
use crate::progress::emit;
use crate::scope::resolve_spec_root;

pub async fn verify_public(
    project_root: &Path,
    progress: Option<&ProgressSink>,
) -> Result<vos_core::PublicVerifyResult> {
    emit(progress, "planning_architecture", "starting public verification");
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let normalized = crate::normalize_spec(project_root, Some(&spec_root))?;
    let consistency = vos_spec::check_consistency(project_root, &spec_root, &normalized)?;
    if !consistency.ok {
        return Err(vos_core::VosError::Message(format!(
            "consistency check failed: {}",
            consistency.errors.join("; ")
        )));
    }
    let build = build_with_progress(project_root, None, progress).await?;
    let run = run_qemu_with_progress(project_root, None, progress).await?;
    emit(progress, "finished", "public verification completed");
    Ok(vos_core::PublicVerifyResult {
        normalize_ok: true,
        consistency_ok: true,
        required_checks: normalized.architecture.toolchain.validation.must_pass.clone(),
        build,
        run,
    })
}
