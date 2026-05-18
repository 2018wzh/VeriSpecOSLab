use std::path::Path;

use vos_core::{
    ArtifactCheckResult, BuildResult, PhaseExecutionRecord, Result, ToolchainGenerationRequest,
    VosError,
};

use crate::config::load_config;
use crate::evidence::write_json;
use crate::generator::{
    GeneratedToolchain, generate_toolchain_artifact, load_prebuilt_toolchain_artifact,
};
use crate::process::{shell_command_with_timeout_context, summarize_program_command};
use crate::progress::{ProgressSink, emit};
use crate::scope::resolve_spec_root;

pub async fn build(project_root: &Path, profile: Option<String>) -> Result<BuildResult> {
    build_with_progress(
        project_root,
        profile,
        ToolchainGenerationRequest {
            stage: None,
            generator: None,
            generators: Vec::new(),
            dry_run: false,
            toolchain_path: None,
        },
        None,
    )
    .await
}

pub async fn build_with_progress(
    project_root: &Path,
    _profile: Option<String>,
    request: ToolchainGenerationRequest,
    progress: Option<&ProgressSink>,
) -> Result<BuildResult> {
    emit(progress, "building_system", "resolving toolchain spec");
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let toolchain = vos_spec::load_toolchain_spec(project_root, &spec_root)?;
    ensure_toolchain_environment(&toolchain)?;

    let run_dir = project_root
        .join(".vos")
        .join("runs")
        .join(vos_core::new_run_id());
    std::fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("toolchain-resolved.json"), &toolchain)?;

    let generated = if let Some(path) = &request.toolchain_path {
        emit(
            progress,
            "building_system",
            "loading pre-generated toolchain artifact",
        );
        load_prebuilt_toolchain_artifact(project_root, path, &spec_root, &toolchain, &request)?
    } else {
        emit(
            progress,
            "building_system",
            "generating makefile toolchain artifact",
        );
        generate_toolchain_artifact(project_root, &spec_root, &toolchain, &request, &run_dir)?
    };

    if request.dry_run {
        let log_path = run_dir.join("build.log");
        let summary = summarize_program_command(
            &generated.command_program,
            &generated.command_args,
            Some(&generated.metadata.entry_target),
        );
        std::fs::write(&log_path, format!("# dry-run\n{}\n", summary))?;
        return Ok(BuildResult {
            command: summary,
            success: true,
            exit_code: Some(0),
            log_path,
            generated_artifacts: toolchain.build.generated_artifacts.clone(),
            generated_toolchain_artifacts: vec![generated.artifact_path.clone()],
            phase_results: Vec::new(),
            artifact_checks: Vec::new(),
            generation_metadata: Some(generated.metadata.clone()),
            degraded: false,
        });
    }

    execute_generated_toolchain(project_root, &toolchain, &run_dir, generated).await
}

async fn execute_generated_toolchain(
    project_root: &Path,
    toolchain: &vos_core::ToolchainSpecBundle,
    run_dir: &Path,
    generated: GeneratedToolchain,
) -> Result<BuildResult> {
    let mut phase_results = Vec::new();
    let mut artifact_checks = Vec::new();
    let mut aggregate_log = String::new();
    let mut final_exit = Some(0);
    let mut success = true;

    for phase_name in &generated.phase_order {
        let phase = toolchain
            .build
            .phases
            .iter()
            .find(|item| item.name == *phase_name)
            .ok_or_else(|| {
                VosError::Message(format!(
                    "toolchain phase not found during execution: {phase_name}"
                ))
            })?;
        let timeout_secs = phase
            .semantic
            .timeout_secs
            .unwrap_or(toolchain.run.timeout_secs.max(1));
        let command = summarize_program_command(
            &generated.command_program,
            &generated.command_args,
            Some(&phase.name),
        );
        let (exit_code, stdout, stderr) = shell_command_with_timeout_context(
            &command,
            project_root,
            timeout_secs,
            &phase.semantic.env_vars,
        )
        .await?;
        let log_path = run_dir.join(format!("phase-{}.log", phase.name));
        let log_text = format!("$ {}\n{}{}", command, stdout, stderr);
        std::fs::write(&log_path, &log_text)?;
        aggregate_log.push_str(&format!("===== {} =====\n{}\n", phase.name, log_text));

        let mut phase_checks = check_phase_outputs(project_root, phase)?;
        let phase_ok = exit_code == Some(0) && phase_checks.iter().all(|item| item.ok);
        artifact_checks.append(&mut phase_checks);
        phase_results.push(PhaseExecutionRecord {
            phase: phase.name.clone(),
            spec_source: format!("spec/toolchain/toolchain.yaml#build.phases.{}", phase.name),
            status: if phase_ok {
                "ok".into()
            } else {
                "failed".into()
            },
            attempts: 1,
            command,
            exit_code,
            log_path,
            stdout_excerpt: excerpt(&stdout),
            stderr_excerpt: excerpt(&stderr),
            artifacts_produced: phase_declared_outputs(phase),
        });

        if !phase_ok {
            success = false;
            final_exit = exit_code.or(Some(1));
            break;
        }
    }

    let build_log = run_dir.join("build.log");
    std::fs::write(&build_log, aggregate_log)?;
    Ok(BuildResult {
        command: summarize_program_command(
            &generated.command_program,
            &generated.command_args,
            Some(&generated.metadata.entry_target),
        ),
        success,
        exit_code: final_exit,
        log_path: build_log,
        generated_artifacts: toolchain.build.generated_artifacts.clone(),
        generated_toolchain_artifacts: vec![generated.artifact_path.clone()],
        phase_results,
        artifact_checks,
        generation_metadata: Some(generated.metadata),
        degraded: false,
    })
}

fn ensure_toolchain_environment(toolchain: &vos_core::ToolchainSpecBundle) -> Result<()> {
    for req in &toolchain.environment.required_tools {
        let path = which::which(&req.name).map_err(|_| {
            VosError::Message(format!("required tool not found in PATH: {}", req.name))
        })?;
        if let Some(version_req) = &req.version_req {
            if version_req.trim().starts_with(">=") {
                let min = version_req.trim().trim_start_matches(">=").trim();
                let ver = std::process::Command::new(&path)
                    .arg("--version")
                    .output()
                    .ok()
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                    .unwrap_or_default();
                if !version_at_least(&ver, min) {
                    return Err(VosError::Message(format!(
                        "required tool version not satisfied: {} {}",
                        req.name, version_req
                    )));
                }
            }
        }
    }
    Ok(())
}

fn version_at_least(actual_text: &str, min: &str) -> bool {
    let actual = actual_text
        .split_whitespace()
        .find(|tok| tok.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .unwrap_or("0");
    let parse =
        |v: &str| -> Vec<u64> { v.split('.').filter_map(|s| s.parse::<u64>().ok()).collect() };
    let a = parse(actual);
    let b = parse(min);
    for i in 0..a.len().max(b.len()) {
        let av = *a.get(i).unwrap_or(&0);
        let bv = *b.get(i).unwrap_or(&0);
        if av > bv {
            return true;
        }
        if av < bv {
            return false;
        }
    }
    true
}

fn check_phase_outputs(
    project_root: &Path,
    phase: &vos_core::BuildPhaseSemantics,
) -> Result<Vec<ArtifactCheckResult>> {
    let mut checks = Vec::new();
    match phase.semantic.kind.as_str() {
        "compile" => {
            if let (Some(output_dir), Some(pattern)) =
                (&phase.semantic.output_dir, &phase.semantic.output_pattern)
            {
                let exists = matches_output_pattern(&project_root.join(output_dir), pattern);
                checks.push(ArtifactCheckResult {
                    phase: phase.name.clone(),
                    ok: exists,
                    message: if exists {
                        format!(
                            "compile outputs matched {} in {}",
                            pattern,
                            output_dir.display()
                        )
                    } else {
                        format!(
                            "compile outputs missing {} in {}",
                            pattern,
                            output_dir.display()
                        )
                    },
                });
            }
        }
        "archive" | "link" => {
            if let Some(output) = &phase.semantic.output_file {
                let exists = project_root.join(output).exists();
                checks.push(ArtifactCheckResult {
                    phase: phase.name.clone(),
                    ok: exists,
                    message: if exists {
                        format!("declared output exists: {}", output.display())
                    } else {
                        format!("declared output missing: {}", output.display())
                    },
                });
            }
        }
        "test" => {
            if let Some(pattern) = &phase.semantic.expected_pattern {
                checks.push(ArtifactCheckResult {
                    phase: phase.name.clone(),
                    ok: true,
                    message: format!(
                        "test expected pattern checked by toolchain artifact: {pattern}"
                    ),
                });
            }
            if let Some(file) = &phase.semantic.expected_output_file {
                let exists = project_root.join(file).exists();
                checks.push(ArtifactCheckResult {
                    phase: phase.name.clone(),
                    ok: exists,
                    message: if exists {
                        format!("test expected output exists: {}", file.display())
                    } else {
                        format!("test expected output missing: {}", file.display())
                    },
                });
            }
        }
        "custom" => {
            for expected in &phase.semantic.expected_outputs {
                let exists = project_root.join(expected).exists();
                checks.push(ArtifactCheckResult {
                    phase: phase.name.clone(),
                    ok: exists,
                    message: if exists {
                        format!("custom expected output exists: {}", expected.display())
                    } else {
                        format!("custom expected output missing: {}", expected.display())
                    },
                });
            }
        }
        other => {
            return Err(VosError::Message(format!(
                "unsupported phase kind during output validation: {other}"
            )));
        }
    }
    Ok(checks)
}

fn phase_declared_outputs(phase: &vos_core::BuildPhaseSemantics) -> Vec<std::path::PathBuf> {
    let mut outputs = Vec::new();
    if let Some(file) = &phase.semantic.output_file {
        outputs.push(file.clone());
    }
    if let Some(file) = &phase.semantic.expected_output_file {
        outputs.push(file.clone());
    }
    outputs.extend(phase.semantic.expected_outputs.iter().cloned());
    outputs
}

fn matches_output_pattern(root: &Path, pattern: &str) -> bool {
    if !root.exists() {
        return false;
    }
    let normalized = pattern.replace('\\', "/");
    walk_files(root).into_iter().any(|path| {
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        wildcard_match(&normalized, &rel)
    })
}

fn wildcard_match(pattern: &str, input: &str) -> bool {
    if pattern == "*" || pattern == "**" {
        return true;
    }
    if let Some((prefix, suffix)) = pattern.split_once('*') {
        return input.starts_with(prefix) && input.ends_with(suffix);
    }
    pattern == input || input.ends_with(pattern.trim_start_matches("*/"))
}

fn walk_files(root: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out
}

fn excerpt(text: &str) -> String {
    text.lines().take(20).collect::<Vec<_>>().join("\n")
}
