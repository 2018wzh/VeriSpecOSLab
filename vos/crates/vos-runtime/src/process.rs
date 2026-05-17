use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use vos_core::{BuildRequest, BuildResult, Result, ToolchainSpecBundle, VosError};

pub(crate) fn resolve_kernel_artifact(
    project_root: &Path,
    toolchain: &ToolchainSpecBundle,
) -> Result<PathBuf> {
    let artifact = toolchain
        .image
        .required_artifacts
        .first()
        .or_else(|| toolchain.build.generated_artifacts.first())
        .ok_or_else(|| VosError::Message("toolchain image.required_artifacts must not be empty".into()))?;
    Ok(project_root.join(artifact))
}

pub(crate) fn derive_build_command(project_root: &Path, toolchain: &ToolchainSpecBundle) -> String {
    if !toolchain.build.generated_artifacts.is_empty() {
        return format!(
            "{} {}",
            toolchain.toolchain.c_compiler,
            toolchain
                .build
                .generated_artifacts
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(" ")
        );
    }
    if project_root.join("Makefile").exists() || project_root.join("makefile").exists() {
        "make".into()
    } else {
        toolchain.toolchain.c_compiler.clone()
    }
}

pub(crate) fn build_qemu_command(project_root: &Path, toolchain: &ToolchainSpecBundle) -> String {
    let (program, args) = build_qemu_invocation(project_root, toolchain)
        .unwrap_or_else(|_| (toolchain.run.emulator.clone(), Vec::new()));
    std::iter::once(program)
        .chain(args)
        .map(shell_quote)
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn build_qemu_invocation(
    project_root: &Path,
    toolchain: &ToolchainSpecBundle,
) -> Result<(String, Vec<String>)> {
    let kernel = resolve_kernel_artifact(project_root, toolchain)?;
    let mut args = vec![
        "-machine".to_string(),
        toolchain.run.machine.clone(),
        "-cpu".to_string(),
        toolchain.run.cpu.clone(),
        "-m".to_string(),
        toolchain.run.memory.clone(),
    ];
    if let Some(bios) = &toolchain.run.bios {
        args.push("-bios".to_string());
        args.push(bios.clone());
    }
    args.push(toolchain.run.kernel_arg.clone());
    args.push(kernel.display().to_string());
    args.extend(toolchain.run.extra_args.iter().cloned());
    Ok((toolchain.run.emulator.clone(), args))
}

pub(crate) async fn run_build(run_dir: &Path, build_request: BuildRequest) -> Result<BuildResult> {
    let (exit_code, text) =
        shell_command_with_timeout(&build_request.command, &build_request.cwd, 600).await?;
    let log_path = run_dir.join("build.log");
    std::fs::write(&log_path, format!("$ {}\n{}", build_request.command, text))?;
    Ok(BuildResult {
        command: build_request.command,
        success: exit_code == Some(0),
        exit_code,
        log_path,
        generated_artifacts: build_request.generated_artifacts,
    })
}

pub(crate) async fn shell_command_with_timeout(
    command: &str,
    cwd: &Path,
    timeout_secs: u64,
) -> Result<(Option<i32>, String)> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("powershell");
        c.arg("-NoProfile").arg("-Command").arg(command);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-lc").arg(command);
        c
    };
    let fut = cmd
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    let output = timeout(Duration::from_secs(timeout_secs), fut)
        .await
        .map_err(|_| VosError::Message(format!("command timed out after {timeout_secs}s: {command}")))??;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    Ok((output.status.code(), text))
}

pub(crate) async fn program_with_timeout(
    program: &str,
    args: &[String],
    cwd: &Path,
    timeout_secs: u64,
) -> Result<(Option<i32>, String)> {
    let fut = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    let output = timeout(Duration::from_secs(timeout_secs), fut)
        .await
        .map_err(|_| VosError::Message(format!("command timed out after {timeout_secs}s: {program}")))??;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    Ok((output.status.code(), text))
}

fn shell_quote(value: String) -> String {
    if value.contains([' ', '\t', '"']) {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value
    }
}
