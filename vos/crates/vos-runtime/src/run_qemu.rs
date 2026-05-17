use std::path::Path;
use std::time::Instant;

use vos_core::{QemuRunResult, Result};

use crate::config::load_config;
use crate::evidence::write_json;
use crate::process::{
    build_qemu_command, build_qemu_invocation, program_with_timeout, resolve_kernel_artifact,
};
use crate::progress::{emit, ProgressSink};
use crate::scope::resolve_spec_root;

pub async fn run_qemu(project_root: &Path, profile: Option<String>) -> Result<QemuRunResult> {
    run_qemu_with_progress(project_root, profile, None).await
}

pub async fn run_qemu_with_progress(
    project_root: &Path,
    _profile: Option<String>,
    progress: Option<&ProgressSink>,
) -> Result<QemuRunResult> {
    emit(progress, "launching_qemu", "resolving qemu command");
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let toolchain = vos_spec::load_toolchain_spec(project_root, &spec_root)?;
    let kernel_artifact = resolve_kernel_artifact(project_root, &toolchain)?;
    if !kernel_artifact.exists() {
        return Err(vos_core::VosError::Message(format!(
            "required artifact missing: {}",
            kernel_artifact.display()
        )));
    }
    let run_dir = project_root.join(".vos").join("runs").join(vos_core::new_run_id());
    std::fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("toolchain-resolved.json"), &toolchain)?;
    emit(progress, "building_system", "resolved build artifacts");
    emit(progress, "running_boot_smoke", "launching emulator");
    let (program, args) = build_qemu_invocation(project_root, &toolchain)?;
    let started = Instant::now();
    let (exit_code, output) =
        program_with_timeout(&program, &args, project_root, toolchain.run.timeout_secs).await?;
    let duration_ms = started.elapsed().as_millis();
    let log_path = run_dir.join("qemu.log");
    let command = build_qemu_command(project_root, &toolchain);
    std::fs::write(&log_path, format!("$ {}\n{output}", command))?;
    let detected_signal = if output.contains(&toolchain.run.success_signal) {
        Some(toolchain.run.success_signal.clone())
    } else {
        None
    };
    let result = QemuRunResult {
        command,
        success: detected_signal.is_some(),
        exit_code,
        detected_signal,
        log_path: log_path.clone(),
        duration_ms,
    };
    write_json(&run_dir.join("smoke-result.json"), &result)?;
    emit(progress, "finished", "emulator run finished");
    Ok(result)
}
