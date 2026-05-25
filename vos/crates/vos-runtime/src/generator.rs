use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use vos_core::{
    BuildPhaseSemantics, Result, ToolchainGenerationMetadata, ToolchainGenerationRequest,
    ToolchainManifest, ToolchainSpecBundle, VosError,
};

#[derive(Debug, Clone)]
pub(crate) struct GeneratedToolchain {
    pub(crate) metadata: ToolchainGenerationMetadata,
    pub(crate) artifact_path: PathBuf,
    pub(crate) command_program: String,
    pub(crate) command_args: Vec<String>,
    pub(crate) phase_order: Vec<String>,
}

pub(crate) fn load_generated_toolchain(
    project_root: &Path,
    spec_root: &Path,
    toolchain: &ToolchainSpecBundle,
    request: &ToolchainGenerationRequest,
) -> Result<GeneratedToolchain> {
    let manifest_path = resolve_manifest_path(project_root, request);
    let manifest = load_manifest(&manifest_path)?;
    validate_manifest(project_root, spec_root, toolchain, &manifest)?;
    Ok(GeneratedToolchain {
        metadata: ToolchainGenerationMetadata {
            generator: "agent-ai".into(),
            stage: request.stage.clone(),
            artifact_format: manifest.artifact_format.clone(),
            source_spec: manifest.source_spec.clone(),
            entry_target: manifest.entry_target.clone(),
            phases: manifest.phases.clone(),
            files: manifest.files.clone(),
            spec_hash: manifest.spec_hash.clone(),
            agent_run_id: manifest.agent_run_id.clone(),
            command_program: manifest.command_program.clone(),
            command_args: manifest.command_args.clone(),
            dry_run: request.dry_run,
        },
        artifact_path: manifest_path,
        command_program: manifest.command_program,
        command_args: manifest.command_args,
        phase_order: manifest.phases,
    })
}

pub(crate) fn phase_command_args(command_args: &[String], phase: &str) -> Result<Vec<String>> {
    let mut replaced = false;
    let args = command_args
        .iter()
        .map(|arg| {
            if arg == "{phase}" {
                replaced = true;
                phase.to_string()
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>();
    if !replaced {
        return Err(VosError::Message(
            "toolchain manifest command_args must include `{phase}` placeholder".into(),
        ));
    }
    Ok(args)
}

pub fn required_phase_order(toolchain: &ToolchainSpecBundle) -> Result<Vec<String>> {
    let phase_map = toolchain
        .build
        .phases
        .iter()
        .map(|phase| (phase.name.clone(), phase))
        .collect::<BTreeMap<_, _>>();
    let mut ordered = Vec::new();
    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    for phase in &toolchain.validation.must_pass {
        visit_phase(phase, &phase_map, &mut visiting, &mut visited, &mut ordered)?;
    }
    Ok(ordered)
}

pub fn toolchain_manifest_path(project_root: &Path) -> PathBuf {
    project_root.join(".vos").join("toolchain.json")
}

fn resolve_manifest_path(project_root: &Path, request: &ToolchainGenerationRequest) -> PathBuf {
    match &request.toolchain_path {
        Some(path) if path.is_absolute() => path.clone(),
        Some(path) => project_root.join(path),
        None => toolchain_manifest_path(project_root),
    }
}

fn load_manifest(path: &Path) -> Result<ToolchainManifest> {
    if !path.exists() {
        return Err(VosError::Message(format!(
            "toolchain manifest not found: {}. Run `vos agent generate --apply` first.",
            path.display()
        )));
    }
    let raw = fs::read_to_string(path)?;
    serde_json::from_str(&raw).map_err(Into::into)
}

fn validate_manifest(
    project_root: &Path,
    spec_root: &Path,
    toolchain: &ToolchainSpecBundle,
    manifest: &ToolchainManifest,
) -> Result<()> {
    let allowed_formats = ["makefile", "cmake", "xtask"];
    if !allowed_formats.contains(&manifest.artifact_format.as_str()) {
        return Err(VosError::Message(format!(
            "unsupported toolchain artifact format `{}`",
            manifest.artifact_format
        )));
    }
    let source_spec = project_root
        .join(spec_root)
        .join("toolchain")
        .join("toolchain.yaml");
    if manifest.source_spec != source_spec {
        return Err(VosError::Message(format!(
            "toolchain manifest source spec mismatch: expected {}, got {}",
            source_spec.display(),
            manifest.source_spec.display()
        )));
    }
    let expected_phases = required_phase_order(toolchain)?;
    if manifest.phases != expected_phases {
        return Err(VosError::Message(format!(
            "toolchain manifest phases mismatch: expected {:?}, got {:?}",
            expected_phases, manifest.phases
        )));
    }
    let expected_entry = expected_phases
        .last()
        .cloned()
        .ok_or_else(|| VosError::Message("validation.must_pass must not be empty".into()))?;
    if manifest.entry_target != expected_entry {
        return Err(VosError::Message(format!(
            "toolchain manifest entry target mismatch: expected {}, got {}",
            expected_entry, manifest.entry_target
        )));
    }
    validate_manifest_paths(
        project_root,
        &toolchain.build.allowed_output_paths,
        &manifest.files,
    )?;
    validate_command(&manifest.command_program, &manifest.command_args)?;
    Ok(())
}

fn validate_manifest_paths(
    project_root: &Path,
    allowed_output_paths: &[PathBuf],
    files: &[PathBuf],
) -> Result<()> {
    if files.is_empty() {
        return Err(VosError::Message(
            "toolchain manifest must contain at least one generated file".into(),
        ));
    }
    if allowed_output_paths.is_empty() {
        return Err(VosError::Message(
            "toolchain build.allowed_output_path must declare at least one allowed generated build-system path".into(),
        ));
    }
    for path in files {
        let abs = project_root.join(path);
        if !abs.exists() {
            return Err(VosError::Message(format!(
                "toolchain manifest file missing: {}",
                path.display()
            )));
        }
        if !allowed_output_paths.iter().any(|item| item == path) {
            return Err(VosError::Message(format!(
                "toolchain manifest file is not in the allowed set: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn validate_command(program: &str, args: &[String]) -> Result<()> {
    let allowed_programs = ["make", "cmake", "cargo"];
    if !allowed_programs.contains(&program) {
        return Err(VosError::Message(format!(
            "toolchain manifest command_program `{program}` is not allowed"
        )));
    }
    if matches!(program, "sh" | "bash" | "python" | "env") {
        return Err(VosError::Message(format!(
            "toolchain manifest command_program `{program}` is not allowed"
        )));
    }
    if !args.iter().any(|arg| arg == "{phase}") {
        return Err(VosError::Message(
            "toolchain manifest command_args must include `{phase}` placeholder".into(),
        ));
    }
    Ok(())
}

fn visit_phase(
    name: &str,
    phase_map: &BTreeMap<String, &BuildPhaseSemantics>,
    visiting: &mut BTreeSet<String>,
    visited: &mut BTreeSet<String>,
    ordered: &mut Vec<String>,
) -> Result<()> {
    if visited.contains(name) {
        return Ok(());
    }
    if !visiting.insert(name.to_string()) {
        return Err(VosError::Message(format!(
            "build phase dependency cycle detected at `{name}`"
        )));
    }
    let phase = phase_map
        .get(name)
        .ok_or_else(|| VosError::Message(format!("unknown build phase `{name}`")))?;
    for dep in &phase.semantic.dependencies {
        visit_phase(dep, phase_map, visiting, visited, ordered)?;
    }
    visiting.remove(name);
    visited.insert(name.to_string());
    ordered.push(name.to_string());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn phase_placeholder_is_required() {
        let err = phase_command_args(&["-f".into(), "Makefile".into()], "build")
            .expect_err("missing placeholder should fail");
        assert!(err.to_string().contains("{phase}"));
    }

    #[test]
    fn toolchain_manifest_default_path_is_under_dot_vos() {
        let dir = tempdir().expect("tempdir");
        assert_eq!(
            toolchain_manifest_path(dir.path()),
            dir.path().join(".vos").join("toolchain.json")
        );
    }
}
