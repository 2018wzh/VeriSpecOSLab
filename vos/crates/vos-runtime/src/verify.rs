use std::path::Path;
use vos_core::Result;

use crate::ProgressSink;
use crate::build::build_with_progress;
use crate::config::load_config;
use crate::patch::read_patch_file;
use crate::progress::{ProgressPlan, ProgressStageDefinition};
use crate::run_qemu::run_qemu_with_progress;
use crate::scope::resolve_spec_root;

pub async fn verify_public(
    project_root: &Path,
    progress: Option<&ProgressSink>,
) -> Result<vos_core::PublicVerifyResult> {
    let progress_plan = verify_public_progress_plan();
    progress_plan.emit_stage(progress, "normalize_spec", "starting public verification");
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let normalized = crate::normalize_spec(project_root, Some(&spec_root))?;
    progress_plan.finish_stage(progress, "normalize_spec", "normalized strict spec bundle");
    progress_plan.emit_stage(
        progress,
        "check_consistency",
        "checking cross-spec consistency",
    );
    let consistency = vos_spec::check_consistency(project_root, &spec_root, &normalized)?;
    if !consistency.ok {
        return Err(vos_core::VosError::Message(format!(
            "consistency check failed: {}",
            consistency.errors.join("; ")
        )));
    }
    progress_plan.finish_stage(
        progress,
        "check_consistency",
        "checked cross-spec consistency",
    );
    progress_plan.emit_stage(
        progress,
        "build_system",
        "building system for public verification",
    );
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
        None,
    )
    .await?;
    progress_plan.finish_stage(
        progress,
        "build_system",
        "built system for public verification",
    );
    progress_plan.emit_stage(progress, "run_qemu", "running qemu for public verification");
    let run = run_qemu_with_progress(project_root, None, None).await?;
    progress_plan.finish_stage(
        progress,
        "run_qemu",
        "completed qemu public verification run",
    );
    progress_plan.finish_stage(
        progress,
        "summarize_verify",
        "collected public verification results",
    );
    progress_plan.finish(progress, "public verification completed");
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
    let progress_plan = test_progress_plan();
    progress_plan.finish_stage(progress, "prepare_tests", "prepared toolchain test run");
    progress_plan.emit_stage(
        progress,
        "execute_toolchain_phases",
        "executing toolchain phases",
    );
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
        None,
    )
    .await?;
    progress_plan.finish_stage(
        progress,
        "execute_toolchain_phases",
        "completed toolchain phases",
    );
    let selected_phases = build
        .phase_results
        .iter()
        .map(|p| p.phase.clone())
        .collect();
    progress_plan.finish_stage(
        progress,
        "summarize_tests",
        "summarized toolchain test phases",
    );
    progress_plan.finish(progress, "toolchain test phases completed");
    Ok(vos_core::TestRunResult {
        suite,
        selected_phases,
        build,
    })
}

fn verify_public_progress_plan() -> ProgressPlan {
    ProgressPlan::new(vec![
        ProgressStageDefinition {
            key: "normalize_spec",
            label: "规格归一化",
            weight: 8,
        },
        ProgressStageDefinition {
            key: "check_consistency",
            label: "一致性检查",
            weight: 7,
        },
        ProgressStageDefinition {
            key: "build_system",
            label: "构建系统",
            weight: 55,
        },
        ProgressStageDefinition {
            key: "run_qemu",
            label: "运行 QEMU",
            weight: 25,
        },
        ProgressStageDefinition {
            key: "summarize_verify",
            label: "汇总验证结果",
            weight: 5,
        },
    ])
}

fn test_progress_plan() -> ProgressPlan {
    ProgressPlan::new(vec![
        ProgressStageDefinition {
            key: "prepare_tests",
            label: "准备测试",
            weight: 10,
        },
        ProgressStageDefinition {
            key: "execute_toolchain_phases",
            label: "执行工具链 phases",
            weight: 80,
        },
        ProgressStageDefinition {
            key: "summarize_tests",
            label: "汇总测试结果",
            weight: 10,
        },
    ])
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
