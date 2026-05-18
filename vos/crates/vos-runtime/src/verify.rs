use std::path::Path;
use vos_core::Result;

use crate::build::build_with_progress;
use crate::config::load_config;
use crate::patch::read_patch_file;
use crate::progress::emit;
use crate::run_qemu::run_qemu_with_progress;
use crate::scope::resolve_spec_root;
use crate::ProgressSink;

pub async fn verify_public(
    project_root: &Path,
    progress: Option<&ProgressSink>,
) -> Result<vos_core::PublicVerifyResult> {
    emit(
        progress,
        "planning_architecture",
        "starting public verification",
    );
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
    let build = build_with_progress(
        project_root,
        None,
        vos_core::ToolchainGenerationRequest {
            stage: None,
            generator: None,
            generators: Vec::new(),
            dry_run: false,
            toolchain_path: None,
        },
        progress,
    )
    .await?;
    let run = run_qemu_with_progress(project_root, None, progress).await?;
    emit(progress, "finished", "public verification completed");
    Ok(vos_core::PublicVerifyResult {
        normalize_ok: true,
        consistency_ok: true,
        required_checks: normalized
            .architecture
            .toolchain
            .validation
            .must_pass
            .clone(),
        build,
        run,
    })
}

pub async fn verify_patch(
    project_root: &Path,
    patch_path: &Path,
    progress: Option<&ProgressSink>,
) -> Result<vos_core::PatchVerifyResult> {
    let parsed = read_patch_file(patch_path)?;
    let selected_phases = if parsed.region_edits.is_empty() && parsed.files_to_update.is_empty() {
        vec!["link".into()]
    } else {
        vec!["compile".into(), "link".into()]
    };
    let build = build_with_progress(
        project_root,
        None,
        vos_core::ToolchainGenerationRequest {
            stage: None,
            generator: None,
            generators: Vec::new(),
            dry_run: false,
            toolchain_path: None,
        },
        progress,
    )
    .await?;
    Ok(vos_core::PatchVerifyResult {
        patch_path: patch_path.to_path_buf(),
        selected_phases,
        build,
        run: None,
    })
}

pub async fn run_tests(
    project_root: &Path,
    suite: Option<String>,
    progress: Option<&ProgressSink>,
) -> Result<vos_core::TestRunResult> {
    emit(progress, "running_tests", "executing toolchain test phases");
    let build = build_with_progress(
        project_root,
        None,
        vos_core::ToolchainGenerationRequest {
            stage: None,
            generator: None,
            generators: Vec::new(),
            dry_run: false,
            toolchain_path: None,
        },
        progress,
    )
    .await?;
    let selected_phases = build
        .phase_results
        .iter()
        .map(|p| p.phase.clone())
        .collect();
    Ok(vos_core::TestRunResult {
        suite,
        selected_phases,
        build,
    })
}

pub fn explain_log(log_path: &Path) -> Result<vos_core::DiagnosticReport> {
    let content = std::fs::read_to_string(log_path)?;
    let lower = content.to_lowercase();
    let kind = if lower.contains("timeout") {
        "toolchain_issue"
    } else if lower.contains("undefined reference") || lower.contains("error:") {
        "impl_gap"
    } else {
        "spec_gap"
    };
    Ok(vos_core::DiagnosticReport {
        kind: kind.into(),
        summary: format!("diagnosis for {}", log_path.display()),
        phase: "build_or_run".into(),
        related_specs: Vec::new(),
        evidence_refs: vec![log_path.display().to_string()],
        suggested_next_commands: vec![
            "vos verify public".into(),
            "vos build --dry-run --json".into(),
        ],
    })
}
