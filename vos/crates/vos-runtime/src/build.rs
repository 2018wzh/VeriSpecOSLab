use std::path::Path;

use vos_core::{BuildRequest, BuildResult, Result};

use crate::config::load_config;
use crate::evidence::write_json;
use crate::process::{derive_build_command, run_build};
use crate::progress::{emit, ProgressSink};
use crate::scope::resolve_spec_root;

pub async fn build(project_root: &Path, profile: Option<String>) -> Result<BuildResult> {
    build_with_progress(project_root, profile, None).await
}

pub async fn build_with_progress(
    project_root: &Path,
    profile: Option<String>,
    progress: Option<&ProgressSink>,
) -> Result<BuildResult> {
    emit(progress, "building_system", "resolving toolchain");
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let toolchain = vos_spec::load_toolchain_spec(project_root, &spec_root)?;
    let build_request = BuildRequest {
        command: derive_build_command(project_root, &toolchain),
        cwd: project_root.to_path_buf(),
        profile,
        generated_artifacts: toolchain.build.generated_artifacts.clone(),
    };
    let run_dir = project_root.join(".vos").join("runs").join(vos_core::new_run_id());
    std::fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("toolchain-resolved.json"), &toolchain)?;
    emit(progress, "building_system", "building system artifacts");
    run_build(&run_dir, build_request).await
}
