use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::process::Command;
use tokio::time::{Duration, timeout};
use vos_core::{Result, ToolchainSpecBundle, VosError};

pub(crate) fn resolve_kernel_artifact(
    project_root: &Path,
    toolchain: &ToolchainSpecBundle,
) -> Result<PathBuf> {
    let artifact = toolchain.image.required_artifacts.first().ok_or_else(|| {
        VosError::Message("toolchain image.required_artifacts must not be empty".into())
    })?;
    Ok(project_root.join(artifact))
}

pub(crate) fn build_qemu_command(project_root: &Path, toolchain: &ToolchainSpecBundle) -> String {
    let (program, args) = build_qemu_invocation(project_root, toolchain)
        .unwrap_or_else(|_| (toolchain.run.emulator.clone(), Vec::new()));
    summarize_program_command(&program, &args, None)
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

pub(crate) fn summarize_program_command(
    program: &str,
    args: &[String],
    trailing_target: Option<&str>,
) -> String {
    let mut items = vec![shell_quote(program.to_string())];
    items.extend(args.iter().cloned().map(shell_quote));
    if let Some(target) = trailing_target {
        items.push(shell_quote(target.to_string()));
    }
    items.join(" ")
}

pub(crate) async fn shell_command_with_timeout_context(
    command: &str,
    cwd: &Path,
    timeout_secs: u64,
    env_vars: &BTreeMap<String, String>,
) -> Result<(Option<i32>, String, String)> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("powershell");
        c.arg("-NoProfile").arg("-Command").arg(command);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-lc").arg(command);
        c
    };
    cmd.current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in env_vars {
        cmd.env(k, v);
    }
    let fut = cmd.output();
    let output = timeout(Duration::from_secs(timeout_secs), fut)
        .await
        .map_err(|_| {
            VosError::Message(format!(
                "command timed out after {timeout_secs}s: {command}"
            ))
        })??;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((output.status.code(), stdout, stderr))
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
        .map_err(|_| {
            VosError::Message(format!(
                "command timed out after {timeout_secs}s: {program}"
            ))
        })??;
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
