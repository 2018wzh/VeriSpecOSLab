use std::path::{Path, PathBuf};

use vos_core::{Result, ToolchainManifest, VosError};
use vos_runtime::ProgressSink;

use crate::rig::{RigStage, RigStreamStatus, RigWorkflow};
use crate::{PromptEnvelope, ToolchainCodegenResponse};

pub(crate) struct ToolchainGenerationResult {
    pub(crate) files: Vec<PathBuf>,
    pub(crate) manifest_path: PathBuf,
    pub(crate) manifest: ToolchainManifest,
}

pub(crate) struct PreparedToolchainGeneration {
    pub(crate) current_stage: String,
    pub(crate) enabled_modules: Vec<String>,
    pub(crate) run_id: String,
    pub(crate) run_dir: PathBuf,
    pub(crate) spec_root: PathBuf,
    pub(crate) config: vos_core::AppConfig,
    pub(crate) normalized: vos_core::NormalizedSpecBundle,
}

pub(crate) async fn generate_local_toolchain(
    project_root: &Path,
    prepared: &PreparedToolchainGeneration,
    progress: Option<&ProgressSink>,
    progress_plan: &vos_runtime::ProgressPlan,
) -> Result<ToolchainGenerationResult> {
    let allowed_paths = prepared
        .normalized
        .architecture
        .toolchain
        .build
        .allowed_output_paths
        .clone();
    if allowed_paths.is_empty() {
        return Err(VosError::Message(
            "toolchain build.allowed_output_path must declare at least one allowed generated build-system path".into(),
        ));
    }
    let workflow = RigWorkflow::new(&prepared.config);
    let prompt = PromptEnvelope {
        task_kind: "toolchain_codegen".into(),
        phase: "toolchain_codegen".into(),
        spec_ref: vos_core::SpecRef {
            module: "toolchain".into(),
            operation: prepared.current_stage.clone(),
        },
        allowed_paths: allowed_paths.clone(),
        prompt: vos_prompt::build_toolchain_codegen_prompt(
            &prepared.normalized.architecture.toolchain,
            &prepared.normalized,
            &vos_core::ArchitectureComposeResult {
                current_stage: prepared.current_stage.clone(),
                enabled_modules: prepared.enabled_modules.clone(),
                module_dependency_dag: Default::default(),
                skeleton_features: Default::default(),
                verification_bindings: Default::default(),
            },
            project_root,
            &allowed_paths,
            &["makefile", "cmake", "xtask"],
        ),
    };
    let toolchain_stream_progress = |status| {
        let (message, percent) = match status {
            RigStreamStatus::Thinking => ("thinking about toolchain generation", 10),
            RigStreamStatus::Generating => ("generating local toolchain", 80),
        };
        progress_plan.emit_stage_progress(
            progress,
            "generate_toolchain",
            message,
            percent,
            None,
            None,
            None,
            None,
        );
    };
    let raw = workflow
        .run_prompt_stage(
            &prepared.run_dir.join("toolchain_generation"),
            RigStage::ProviderCall,
            &prompt,
            Some(&toolchain_stream_progress),
        )
        .await?;
    let response = vos_prompt::parse_toolchain_codegen_response::<ToolchainCodegenResponse>(&raw)
        .map_err(VosError::Message)?;
    let phase_order =
        vos_runtime::required_phase_order(&prepared.normalized.architecture.toolchain)?;
    validate_toolchain_response(&response, &allowed_paths, &phase_order)?;
    let files = write_toolchain_files(project_root, prepared, &response)?;
    let manifest = ToolchainManifest {
        artifact_format: response.artifact_format.clone(),
        files: files.clone(),
        command_program: response.command_program.clone(),
        command_args: response.command_args.clone(),
        entry_target: response.entry_target.clone(),
        phases: response.phases.clone(),
        source_spec: project_root
            .join(&prepared.spec_root)
            .join("toolchain")
            .join("toolchain.yaml"),
        spec_hash: vos_runtime::stable_bundle_hash(&prepared.normalized),
        agent_run_id: prepared.run_id.clone(),
    };
    let manifest_path = vos_runtime::toolchain_manifest_path(project_root);
    vos_runtime::write_json(&manifest_path, &manifest)?;
    progress_plan.finish_stage(progress, "generate_toolchain", "generated local toolchain");
    Ok(ToolchainGenerationResult {
        files,
        manifest_path,
        manifest,
    })
}

fn validate_toolchain_response(
    response: &ToolchainCodegenResponse,
    allowed_paths: &[PathBuf],
    phase_order: &[String],
) -> Result<()> {
    let allowed_formats = ["makefile", "cmake", "xtask"];
    if !allowed_formats.contains(&response.artifact_format.as_str()) {
        return Err(VosError::Message(format!(
            "toolchain response format `{}` is not allowed",
            response.artifact_format
        )));
    }
    if response.files.is_empty() {
        return Err(VosError::Message(
            "toolchain response must contain at least one file".into(),
        ));
    }
    for file in &response.files {
        if !allowed_paths.iter().any(|path| path == &file.path) {
            return Err(VosError::Message(format!(
                "toolchain response path is not allowed: {}",
                file.path.display()
            )));
        }
        if file.path.is_absolute()
            || file
                .path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(VosError::Message(format!(
                "toolchain response path escapes project root: {}",
                file.path.display()
            )));
        }
    }
    if response.phases != phase_order {
        return Err(VosError::Message(format!(
            "toolchain response phases mismatch: expected {:?}, got {:?}",
            phase_order, response.phases
        )));
    }
    let expected_entry = phase_order
        .last()
        .cloned()
        .ok_or_else(|| VosError::Message("validation.must_pass must not be empty".into()))?;
    if response.entry_target != expected_entry {
        return Err(VosError::Message(format!(
            "toolchain response entry target mismatch: expected {}, got {}",
            expected_entry, response.entry_target
        )));
    }
    validate_command(&response.command_program, &response.command_args)
}

fn write_toolchain_files(
    project_root: &Path,
    prepared: &PreparedToolchainGeneration,
    response: &ToolchainCodegenResponse,
) -> Result<Vec<PathBuf>> {
    let mut written = Vec::new();
    for file in &response.files {
        let abs = project_root.join(&file.path);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let header = build_header(prepared, &file.path);
        let content = if file.content.contains("source spec") {
            file.content.clone()
        } else {
            format!("{}{}", header, file.content)
        };
        std::fs::write(&abs, content)?;
        written.push(file.path.clone());
    }
    Ok(written)
}

fn build_header(prepared: &PreparedToolchainGeneration, path: &Path) -> String {
    let prefix = match path.extension().and_then(|ext| ext.to_str()) {
        Some("rs") => "//",
        _ => "#",
    };
    format!(
        "{p} source spec: spec/toolchain/toolchain.yaml\n{p} generator: agent-ai\n{p} stage: {stage}\n{p} run_id: {run_id}\n",
        p = prefix,
        stage = prepared.current_stage,
        run_id = prepared.run_id
    )
}

fn validate_command(program: &str, args: &[String]) -> Result<()> {
    let allowed_programs = ["make", "cmake", "cargo"];
    if !allowed_programs.contains(&program) {
        return Err(VosError::Message(format!(
            "toolchain command_program `{program}` is not allowed"
        )));
    }
    if !args.iter().any(|arg| arg == "{phase}") {
        return Err(VosError::Message(
            "toolchain command_args must include `{phase}` placeholder".into(),
        ));
    }
    if args.iter().any(|arg| arg == "-c") || matches!(program, "sh" | "bash" | "python" | "env") {
        return Err(VosError::Message(
            "toolchain response must not use shell wrapper execution".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_allowed_output_paths_can_cover_expected_files() {
        let allowed = vec![
            PathBuf::from("Makefile"),
            PathBuf::from("CMakeLists.txt"),
            PathBuf::from("xtask/src/tasks.rs"),
            PathBuf::from("xtask/Cargo.toml"),
        ];
        assert!(allowed.contains(&PathBuf::from("Makefile")));
        assert!(allowed.contains(&PathBuf::from("xtask/src/tasks.rs")));
    }

    #[test]
    fn shell_wrappers_are_rejected() {
        let err = validate_command("bash", &["-c".into(), "echo".into(), "{phase}".into()])
            .expect_err("bash wrapper should fail");
        assert!(err.to_string().contains("not allowed"));
    }
}
