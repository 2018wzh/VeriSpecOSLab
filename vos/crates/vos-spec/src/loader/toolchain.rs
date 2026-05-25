use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use vos_core::{
    BuildContract, BuildPhaseSemantic, BuildPhaseSemantics, DebugContract, EnvironmentContract,
    ImageContract, LinkContract, Result, ToolRequirement, ToolchainProfile, ToolchainSpecBundle,
    ValidationContract, VosError,
};

use crate::loader::types::{
    BuildFileYaml, DebugFileYaml, ImageFileYaml, LinkFileYaml, ProfileFileYaml, RunFileYaml,
    ToolchainIndexYaml,
};
use crate::loader::types::{BuildPhaseYaml, ToolRequirementYaml, ToolchainYaml};

pub fn load_toolchain_spec(project_root: &Path, spec_root: &Path) -> Result<ToolchainSpecBundle> {
    let toolchain_path = project_root
        .join(spec_root)
        .join("toolchain")
        .join("toolchain.yaml");
    load_toolchain_spec_from_file(project_root, &toolchain_path)
}

pub fn load_toolchain_spec_from_file(
    project_root: &Path,
    toolchain_path: &Path,
) -> Result<ToolchainSpecBundle> {
    let raw = fs::read_to_string(toolchain_path)?;
    let parsed: serde_yaml::Value = serde_yaml::from_str(&raw)?;
    if has_key(&parsed, "includes") && !has_key(&parsed, "toolchain") {
        load_split_toolchain_spec(project_root, toolchain_path, &parsed)
    } else {
        let parsed: ToolchainYaml = serde_yaml::from_str(&raw)?;
        build_toolchain_bundle(project_root, parsed)
    }
}

fn has_key(value: &serde_yaml::Value, key: &str) -> bool {
    match value {
        serde_yaml::Value::Mapping(map) => {
            let lookup = serde_yaml::Value::String(key.to_string());
            map.get(&lookup).is_some()
        }
        _ => false,
    }
}

fn load_split_toolchain_spec(
    project_root: &Path,
    toolchain_path: &Path,
    parsed: &serde_yaml::Value,
) -> Result<ToolchainSpecBundle> {
    let index: ToolchainIndexYaml = serde_yaml::from_value(parsed.clone())?;
    let toolchain_dir = toolchain_path.parent().ok_or_else(|| {
        VosError::Message(format!(
            "toolchain index has no parent directory: {}",
            toolchain_path.display()
        ))
    })?;

    let mut profile: Option<ProfileFileYaml> = None;
    let mut build: Option<BuildFileYaml> = None;
    let mut link: Option<LinkFileYaml> = None;
    let mut image: Option<ImageFileYaml> = None;
    let mut run: Option<RunFileYaml> = None;
    let mut debug: Option<DebugFileYaml> = None;

    for include in index.includes {
        let include_path = if include.is_absolute() {
            include
        } else {
            toolchain_dir.join(&include)
        };
        let file_name = include_path
            .file_name()
            .and_then(|item| item.to_str())
            .ok_or_else(|| {
                VosError::Message(format!(
                    "invalid included toolchain file path: {}",
                    include_path.display()
                ))
            })?;
        let content = fs::read_to_string(&include_path)?;
        match file_name {
            "profile.yaml" => profile = Some(serde_yaml::from_str(&content)?),
            "build.yaml" => build = Some(serde_yaml::from_str(&content)?),
            "link.yaml" => link = Some(serde_yaml::from_str(&content)?),
            "image.yaml" => image = Some(serde_yaml::from_str(&content)?),
            "run.yaml" => run = Some(serde_yaml::from_str(&content)?),
            "debug.yaml" => debug = Some(serde_yaml::from_str(&content)?),
            "build-phases.yaml" => {
                if build.is_none() {
                    build = Some(serde_yaml::from_str(&content)?);
                }
            }
            other => {
                return Err(VosError::Message(format!(
                    "unsupported toolchain include `{other}`"
                )));
            }
        }
    }

    let profile = profile.ok_or_else(|| {
        VosError::Message("toolchain index is missing profile.yaml include".into())
    })?;
    let build = build
        .ok_or_else(|| VosError::Message("toolchain index is missing build.yaml include".into()))?;
    let link = link
        .ok_or_else(|| VosError::Message("toolchain index is missing link.yaml include".into()))?;
    let image = image
        .ok_or_else(|| VosError::Message("toolchain index is missing image.yaml include".into()))?;
    let run =
        run.ok_or_else(|| VosError::Message("toolchain index is missing run.yaml include".into()))?;
    let debug = debug
        .ok_or_else(|| VosError::Message("toolchain index is missing debug.yaml include".into()))?;

    let merged = ToolchainYaml {
        toolchain: profile.toolchain,
        environment: profile.environment,
        build: build.build,
        link: link.link,
        image: image.image,
        run: run.run,
        debug: debug.debug,
        validation: index.validation,
    };
    build_toolchain_bundle(project_root, merged)
}

fn build_toolchain_bundle(
    project_root: &Path,
    parsed: ToolchainYaml,
) -> Result<ToolchainSpecBundle> {
    validate_top_level_fields(&parsed)?;
    validate_phases(&parsed.build.phases, project_root)?;
    validate_validation_bindings(&parsed)?;
    validate_artifact_contracts(&parsed)?;

    Ok(ToolchainSpecBundle {
        toolchain: ToolchainProfile {
            target_arch: parsed.toolchain.target_arch,
            target_triple: parsed.toolchain.target_triple,
            c_compiler: parsed.toolchain.c_compiler,
            asm_compiler: parsed.toolchain.asm_compiler,
            linker: parsed.toolchain.linker,
            archiver: parsed.toolchain.archiver,
        },
        environment: EnvironmentContract {
            required_tools: parsed
                .environment
                .required_tools
                .into_iter()
                .filter_map(tool_requirement_from_yaml)
                .collect(),
            allowed_versions: parsed.environment.allowed_versions,
            disallowed_tools: parsed.environment.disallowed_tools,
        },
        build: BuildContract {
            phases: parsed
                .build
                .phases
                .into_iter()
                .map(|phase| BuildPhaseSemantics {
                    name: phase.name,
                    semantic: BuildPhaseSemantic {
                        kind: phase.semantic.kind,
                        command: phase.semantic.command,
                        template: phase.semantic.template,
                        description: phase.semantic.description,
                        working_dir: phase.semantic.working_dir,
                        env_vars: phase.semantic.env_vars,
                        dependencies: phase.semantic.dependencies,
                        timeout_secs: phase.semantic.timeout_secs,
                        retry_on_failure: phase.semantic.retry_on_failure,
                        parallel: phase.semantic.parallel,
                        compiler: phase.semantic.compiler,
                        linker: phase.semantic.linker,
                        archiver: phase.semantic.archiver,
                        sources: phase.semantic.sources,
                        include_dirs: phase.semantic.include_dirs,
                        flags: phase.semantic.flags,
                        standard: phase.semantic.standard,
                        output_dir: phase.semantic.output_dir,
                        output_pattern: phase.semantic.output_pattern,
                        expected_outputs: phase.semantic.expected_outputs,
                        input_artifacts: phase.semantic.input_artifacts,
                        output_file: phase.semantic.output_file,
                        output_format: phase.semantic.output_format,
                        linker_script: phase.semantic.linker_script,
                        libraries: phase.semantic.libraries,
                        library_dirs: phase.semantic.library_dirs,
                        library_type: phase.semantic.library_type,
                        framework: phase.semantic.framework,
                        test_binary: phase.semantic.test_binary,
                        test_args: phase.semantic.test_args,
                        expected_pattern: phase.semantic.expected_pattern,
                        expected_output_file: phase.semantic.expected_output_file,
                    },
                })
                .collect(),
            allowed_output_paths: parsed.build.allowed_output_paths,
            sources: parsed.build.sources,
            include_paths: parsed.build.include_paths,
            cflags: parsed.build.cflags,
            asmflags: parsed.build.asmflags,
            ldflags: parsed.build.ldflags,
            features: parsed.build.features,
            forbidden_flags: parsed.build.forbidden_flags,
            generated_artifacts: parsed.build.generated_artifacts,
        },
        link: LinkContract {
            linker_script: parsed.link.linker_script,
            entry_symbol: parsed.link.entry_symbol,
            section_rules: parsed.link.section_rules,
            relocation_model: parsed.link.relocation_model,
            abi_constraints: parsed.link.abi_constraints,
        },
        image: ImageContract {
            output_kind: parsed.image.output_kind,
            objcopy_rules: parsed.image.objcopy_rules,
            boot_chain: parsed.image.boot_chain,
            required_artifacts: parsed.image.required_artifacts,
        },
        run: vos_core::RunContract {
            emulator: parsed.run.emulator,
            machine: parsed.run.machine,
            cpu: parsed.run.cpu,
            memory: parsed.run.memory,
            bios: parsed.run.bios,
            kernel_arg: parsed.run.kernel_arg,
            extra_args: parsed.run.extra_args,
            success_signal: parsed.run.success_signal,
            timeout_secs: parsed.run.timeout_secs,
        },
        debug: DebugContract {
            symbols_required: parsed.debug.symbols_required,
            gdb_script: parsed.debug.gdb_script,
            trace_points: parsed.debug.trace_points,
        },
        validation: ValidationContract {
            must_pass: parsed.validation.must_pass,
        },
    })
}

fn tool_requirement_from_yaml(req: ToolRequirementYaml) -> Option<ToolRequirement> {
    match req {
        ToolRequirementYaml::Name(name) => Some(ToolRequirement {
            name,
            version_req: None,
        }),
        ToolRequirementYaml::NameWithVersion(map) => {
            map.into_iter()
                .next()
                .map(|(name, version_req)| ToolRequirement {
                    name,
                    version_req: Some(version_req),
                })
        }
    }
}

fn validate_top_level_fields(parsed: &ToolchainYaml) -> Result<()> {
    if parsed.toolchain.target_arch.trim().is_empty() {
        return Err(VosError::Message(
            "toolchain.target_arch must not be empty".into(),
        ));
    }
    if parsed.toolchain.target_triple.trim().is_empty() {
        return Err(VosError::Message(
            "toolchain.target_triple must not be empty".into(),
        ));
    }
    if parsed.link.entry_symbol.trim().is_empty() {
        return Err(VosError::Message(
            "link.entry_symbol must not be empty".into(),
        ));
    }
    if parsed.run.success_signal.trim().is_empty() {
        return Err(VosError::Message(
            "run.success_signal must not be empty".into(),
        ));
    }
    if parsed.run.kernel_arg.trim().is_empty() {
        return Err(VosError::Message("run.kernel_arg must not be empty".into()));
    }
    if parsed.run.timeout_secs == 0 {
        return Err(VosError::Message("run.timeout_secs must be > 0".into()));
    }
    if parsed.build.phases.is_empty() {
        return Err(VosError::Message("build.phases must not be empty".into()));
    }
    Ok(())
}

fn validate_validation_bindings(parsed: &ToolchainYaml) -> Result<()> {
    let phase_names = parsed
        .build
        .phases
        .iter()
        .map(|phase| phase.name.as_str())
        .collect::<BTreeSet<_>>();
    for required in &parsed.validation.must_pass {
        if !phase_names.contains(required.as_str()) {
            return Err(VosError::Message(format!(
                "validation.must_pass references unknown build phase `{required}`"
            )));
        }
    }
    Ok(())
}

fn validate_artifact_contracts(parsed: &ToolchainYaml) -> Result<()> {
    if parsed.build.generated_artifacts.is_empty() {
        return Err(VosError::Message(
            "build.generated_artifacts must not be empty".into(),
        ));
    }
    if parsed.image.required_artifacts.is_empty() {
        return Err(VosError::Message(
            "image.required_artifacts must not be empty".into(),
        ));
    }
    let declared = collect_declared_outputs(parsed);
    for artifact in &parsed.build.generated_artifacts {
        if !declared.contains(artifact) {
            return Err(VosError::Message(format!(
                "build.generated_artifacts declares `{}` but no build phase produces it",
                artifact.display()
            )));
        }
    }
    for artifact in &parsed.image.required_artifacts {
        if !parsed.build.generated_artifacts.contains(artifact) {
            return Err(VosError::Message(format!(
                "image.required_artifacts entry `{}` is not listed in build.generated_artifacts",
                artifact.display()
            )));
        }
    }
    Ok(())
}

fn collect_declared_outputs(parsed: &ToolchainYaml) -> BTreeSet<PathBuf> {
    let mut outputs = BTreeSet::new();
    for phase in &parsed.build.phases {
        if let Some(file) = &phase.semantic.output_file {
            outputs.insert(file.clone());
        }
        for path in &phase.semantic.expected_outputs {
            outputs.insert(path.clone());
        }
        if let Some(path) = &phase.semantic.expected_output_file {
            outputs.insert(path.clone());
        }
    }
    outputs
}

fn validate_phases(phases: &[BuildPhaseYaml], project_root: &Path) -> Result<()> {
    let mut names = BTreeSet::new();
    for phase in phases {
        validate_phase_shape(phase, project_root)?;
        if !names.insert(phase.name.clone()) {
            return Err(VosError::Message(format!(
                "duplicate build phase name: {}",
                phase.name
            )));
        }
    }

    let deps = phases
        .iter()
        .map(|phase| (phase.name.clone(), phase.semantic.dependencies.clone()))
        .collect::<BTreeMap<_, _>>();
    for phase in phases {
        for dep in &phase.semantic.dependencies {
            if !names.contains(dep) {
                return Err(VosError::Message(format!(
                    "build phase `{}` depends on unknown phase `{dep}`",
                    phase.name
                )));
            }
        }
    }
    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    for name in names {
        dfs_cycle(&name, &deps, &mut visiting, &mut visited)?;
    }
    Ok(())
}

fn validate_phase_shape(phase: &BuildPhaseYaml, project_root: &Path) -> Result<()> {
    if phase.name.trim().is_empty() {
        return Err(VosError::Message(
            "build.phases[*].name must not be empty".into(),
        ));
    }
    if phase.semantic.kind.trim().is_empty() {
        return Err(VosError::Message(format!(
            "build phase `{}` semantic.type must not be empty",
            phase.name
        )));
    }
    if let Some(timeout) = phase.semantic.timeout_secs {
        if timeout == 0 {
            return Err(VosError::Message(format!(
                "build phase `{}` timeout_secs must be > 0",
                phase.name
            )));
        }
    }
    if let Some(workdir) = &phase.semantic.working_dir {
        let path = project_root.join(workdir);
        if !path.exists() {
            return Err(VosError::Message(format!(
                "build phase `{}` working_dir does not exist: {}",
                phase.name,
                workdir.display()
            )));
        }
    }

    match phase.semantic.kind.as_str() {
        "compile" => validate_compile_phase(phase),
        "link" => validate_link_phase(phase),
        "archive" => validate_archive_phase(phase),
        "test" => validate_test_phase(phase),
        "custom" => validate_custom_phase(phase),
        other => Err(VosError::Message(format!(
            "build phase `{}` has unsupported semantic.type `{other}`",
            phase.name
        ))),
    }
}

fn validate_compile_phase(phase: &BuildPhaseYaml) -> Result<()> {
    if phase.semantic.sources.is_empty() {
        return Err(VosError::Message(format!(
            "build phase `{}` compile requires semantic.sources",
            phase.name
        )));
    }
    if phase.semantic.output_dir.is_none() {
        return Err(VosError::Message(format!(
            "build phase `{}` compile requires semantic.output_dir",
            phase.name
        )));
    }
    if phase.semantic.output_pattern.is_none() {
        return Err(VosError::Message(format!(
            "build phase `{}` compile requires semantic.output_pattern",
            phase.name
        )));
    }
    for source in &phase.semantic.sources {
        if source.pattern.trim().is_empty() {
            return Err(VosError::Message(format!(
                "build phase `{}` compile source pattern must not be empty",
                phase.name
            )));
        }
    }
    Ok(())
}

fn validate_link_phase(phase: &BuildPhaseYaml) -> Result<()> {
    if phase.semantic.input_artifacts.is_empty() {
        return Err(VosError::Message(format!(
            "build phase `{}` link requires semantic.input_artifacts",
            phase.name
        )));
    }
    if phase.semantic.output_file.is_none() {
        return Err(VosError::Message(format!(
            "build phase `{}` link requires semantic.output_file",
            phase.name
        )));
    }
    if phase.semantic.linker_script.is_none() {
        return Err(VosError::Message(format!(
            "build phase `{}` link requires semantic.linker_script",
            phase.name
        )));
    }
    Ok(())
}

fn validate_archive_phase(phase: &BuildPhaseYaml) -> Result<()> {
    if phase.semantic.input_artifacts.is_empty() {
        return Err(VosError::Message(format!(
            "build phase `{}` archive requires semantic.input_artifacts",
            phase.name
        )));
    }
    if phase.semantic.output_file.is_none() {
        return Err(VosError::Message(format!(
            "build phase `{}` archive requires semantic.output_file",
            phase.name
        )));
    }
    Ok(())
}

fn validate_test_phase(phase: &BuildPhaseYaml) -> Result<()> {
    if phase.semantic.test_binary.is_none() {
        return Err(VosError::Message(format!(
            "build phase `{}` test requires semantic.test_binary",
            phase.name
        )));
    }
    if phase.semantic.expected_pattern.is_none() && phase.semantic.expected_output_file.is_none() {
        return Err(VosError::Message(format!(
            "build phase `{}` test requires semantic.expected_pattern or semantic.expected_output_file",
            phase.name
        )));
    }
    Ok(())
}

fn validate_custom_phase(phase: &BuildPhaseYaml) -> Result<()> {
    if phase.semantic.command.is_none() && phase.semantic.template.is_none() {
        return Err(VosError::Message(format!(
            "build phase `{}` custom requires command or template",
            phase.name
        )));
    }
    Ok(())
}

fn dfs_cycle(
    node: &str,
    deps: &BTreeMap<String, Vec<String>>,
    visiting: &mut BTreeSet<String>,
    visited: &mut BTreeSet<String>,
) -> Result<()> {
    if visited.contains(node) {
        return Ok(());
    }
    if !visiting.insert(node.to_string()) {
        return Err(VosError::Message(format!(
            "build phase dependency cycle detected at `{node}`"
        )));
    }
    if let Some(nexts) = deps.get(node) {
        for next in nexts {
            dfs_cycle(next, deps, visiting, visited)?;
        }
    }
    visiting.remove(node);
    visited.insert(node.to_string());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn rejects_unknown_validation_phase() {
        let yaml = r#"
toolchain:
  target_arch: riscv64
  target_triple: riscv64-unknown-elf
  c_compiler: riscv64-unknown-elf-gcc
  asm_compiler: riscv64-unknown-elf-gcc
  linker: riscv64-unknown-elf-ld
  archiver: riscv64-unknown-elf-ar
build:
  generated_artifacts: [build/kernel.elf]
  phases:
    - name: compile
      semantic:
        type: compile
        sources:
          - pattern: "kernel/**/*.c"
        output_dir: build
        output_pattern: "*.o"
link:
  linker_script: kernel/link.ld
  entry_symbol: _start
image:
  output_kind: kernel-elf
  required_artifacts: [build/kernel.elf]
run:
  emulator: qemu-system-riscv64
  machine: virt
  cpu: rv64
  memory: 128M
  bios: default
  kernel_arg: -kernel
  success_signal: OK
  timeout_secs: 30
validation:
  must_pass: [missing]
"#;
        let path = tempfile::tempdir().unwrap();
        let file = path.path().join("toolchain.yaml");
        fs::write(&file, yaml).unwrap();
        let err = load_toolchain_spec_from_file(path.path(), &file).unwrap_err();
        assert!(
            err.to_string()
                .contains("validation.must_pass references unknown build phase")
        );
    }

    #[test]
    fn loads_split_example_toolchain() {
        let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = crate_root
            .ancestors()
            .nth(3)
            .expect("repo root should exist")
            .to_path_buf();
        let spec_root = PathBuf::from("examples/xv6-spec/spec");
        let bundle = load_toolchain_spec(&repo_root, &spec_root)
            .expect("split toolchain example should load");

        assert_eq!(bundle.toolchain.target_arch, "riscv64");
        assert!(
            bundle
                .build
                .phases
                .iter()
                .any(|phase| phase.name == "link_kernel")
        );
        assert_eq!(
            bundle.image.required_artifacts,
            vec![
                PathBuf::from("build/kernel.elf"),
                PathBuf::from("build/kernel.bin")
            ]
        );
    }
}
