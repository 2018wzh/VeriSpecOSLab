use std::path::Path;
use std::time::Instant;

use vos_core::{QemuRunResult, Result};

use crate::config::load_config;
use crate::evidence::write_json;
use crate::process::{
    build_qemu_command, build_qemu_invocation, program_with_timeout, resolve_kernel_artifact,
};
use crate::progress::{ProgressPlan, ProgressSink, ProgressStageDefinition};
use crate::scope::resolve_spec_root;

pub async fn run_qemu(project_root: &Path, profile: Option<String>) -> Result<QemuRunResult> {
    run_qemu_with_progress(project_root, profile, None).await
}

pub async fn run_qemu_with_progress(
    project_root: &Path,
    _profile: Option<String>,
    progress: Option<&ProgressSink>,
) -> Result<QemuRunResult> {
    let progress_plan = run_qemu_progress_plan();
    progress_plan.emit_stage(progress, "resolve_run_config", "resolving qemu command");
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let toolchain = vos_spec::load_toolchain_spec(project_root, &spec_root)?;
    progress_plan.finish_stage(progress, "resolve_run_config", "resolved qemu command");
    progress_plan.emit_stage(
        progress,
        "check_kernel_artifact",
        "resolving build artifacts",
    );
    let kernel_artifact = resolve_kernel_artifact(project_root, &toolchain)?;
    if !kernel_artifact.exists() {
        return Err(vos_core::VosError::Message(format!(
            "required artifact missing: {}",
            kernel_artifact.display()
        )));
    }
    progress_plan.finish_stage(
        progress,
        "check_kernel_artifact",
        "validated kernel artifact",
    );
    let run_dir = project_root
        .join(".vos")
        .join("runs")
        .join(vos_core::new_run_id());
    std::fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("toolchain-resolved.json"), &toolchain)?;
    progress_plan.emit_stage(progress, "launch_qemu", "launching emulator");
    let (program, args) = build_qemu_invocation(project_root, &toolchain)?;
    progress_plan.finish_stage(progress, "launch_qemu", "prepared emulator launch");
    progress_plan.emit_stage(progress, "wait_for_run_result", "waiting for qemu result");
    let started = Instant::now();
    let (exit_code, output) =
        program_with_timeout(&program, &args, project_root, toolchain.run.timeout_secs).await?;
    progress_plan.finish_stage(progress, "wait_for_run_result", "qemu process returned");
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
    progress_plan.finish_stage(progress, "finalize_run", "wrote qemu logs and result");
    progress_plan.finish(progress, "emulator run finished");
    Ok(result)
}

fn run_qemu_progress_plan() -> ProgressPlan {
    ProgressPlan::new(vec![
        ProgressStageDefinition {
            key: "resolve_run_config",
            label: "解析运行配置",
            weight: 20,
        },
        ProgressStageDefinition {
            key: "check_kernel_artifact",
            label: "检查内核工件",
            weight: 15,
        },
        ProgressStageDefinition {
            key: "launch_qemu",
            label: "启动 QEMU",
            weight: 15,
        },
        ProgressStageDefinition {
            key: "wait_for_run_result",
            label: "等待运行结果",
            weight: 40,
        },
        ProgressStageDefinition {
            key: "finalize_run",
            label: "落盘日志与结果",
            weight: 10,
        },
    ])
}
