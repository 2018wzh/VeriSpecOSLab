use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use vos_core::{
    BuildPhaseSemantics, Result, ToolchainGenerationMetadata, ToolchainGenerationRequest,
    ToolchainSpecBundle, VosError,
};

#[derive(Debug, Clone)]
pub(crate) struct GeneratedToolchain {
    pub(crate) metadata: ToolchainGenerationMetadata,
    pub(crate) artifact_path: PathBuf,
    pub(crate) command_program: String,
    pub(crate) command_args: Vec<String>,
    pub(crate) phase_order: Vec<String>,
}

pub(crate) fn generate_toolchain_artifact(
    project_root: &Path,
    spec_root: &Path,
    toolchain: &ToolchainSpecBundle,
    request: &ToolchainGenerationRequest,
    run_dir: &Path,
) -> Result<GeneratedToolchain> {
    let generator = resolve_generator(request)?;
    match generator.as_str() {
        "makefile" => generate_makefile(project_root, spec_root, toolchain, request, run_dir),
        other => Err(VosError::Message(format!(
            "unsupported generator `{other}`; supported generators: makefile"
        ))),
    }
}

pub(crate) fn load_prebuilt_toolchain_artifact(
    project_root: &Path,
    artifact_path: &Path,
    spec_root: &Path,
    toolchain: &ToolchainSpecBundle,
    request: &ToolchainGenerationRequest,
) -> Result<GeneratedToolchain> {
    let resolved = if artifact_path.is_absolute() {
        artifact_path.to_path_buf()
    } else {
        project_root.join(artifact_path)
    };
    let file_name = resolved
        .file_name()
        .and_then(|item| item.to_str())
        .ok_or_else(|| {
            VosError::Message(format!(
                "invalid toolchain artifact path: {}",
                resolved.display()
            ))
        })?;
    if !resolved.exists() {
        return Err(VosError::Message(format!(
            "pre-generated toolchain artifact not found: {}",
            resolved.display()
        )));
    }
    if !matches!(file_name, "Makefile" | "makefile" | "GNUmakefile") {
        return Err(VosError::Message(format!(
            "unsupported pre-generated toolchain artifact `{}`; expected Makefile/makefile/GNUmakefile",
            resolved.display()
        )));
    }
    let phase_order = required_phase_order(toolchain)?;
    let entry_target = entry_target(toolchain)?;
    Ok(GeneratedToolchain {
        metadata: ToolchainGenerationMetadata {
            generator: request
                .generator
                .clone()
                .unwrap_or_else(|| "makefile".into()),
            stage: request.stage.clone(),
            format: "makefile".into(),
            source_spec: project_root
                .join(spec_root)
                .join("toolchain")
                .join("toolchain.yaml"),
            entry_target,
            phases: phase_order.clone(),
            dry_run: request.dry_run,
        },
        artifact_path: resolved.clone(),
        command_program: "make".into(),
        command_args: vec!["-f".into(), resolved.display().to_string()],
        phase_order,
    })
}

fn resolve_generator(request: &ToolchainGenerationRequest) -> Result<String> {
    if !request.generators.is_empty() {
        return Err(VosError::Message(
            "multiple generators are not implemented yet; use --generator=makefile".into(),
        ));
    }
    Ok(request
        .generator
        .clone()
        .unwrap_or_else(|| "makefile".into()))
}

fn generate_makefile(
    project_root: &Path,
    spec_root: &Path,
    toolchain: &ToolchainSpecBundle,
    request: &ToolchainGenerationRequest,
    run_dir: &Path,
) -> Result<GeneratedToolchain> {
    let phase_order = required_phase_order(toolchain)?;
    let entry_target = entry_target(toolchain)?;
    let artifact_path = run_dir.join("Makefile");
    let source_spec = project_root
        .join(spec_root)
        .join("toolchain")
        .join("toolchain.yaml");
    let content = render_makefile(
        toolchain,
        &source_spec,
        request.stage.as_deref(),
        &phase_order,
        &entry_target,
    )?;
    std::fs::write(&artifact_path, content)?;
    Ok(GeneratedToolchain {
        metadata: ToolchainGenerationMetadata {
            generator: "makefile".into(),
            stage: request.stage.clone(),
            format: "makefile".into(),
            source_spec,
            entry_target,
            phases: phase_order.clone(),
            dry_run: request.dry_run,
        },
        artifact_path: artifact_path.clone(),
        command_program: "make".into(),
        command_args: vec!["-f".into(), artifact_path.display().to_string()],
        phase_order,
    })
}

fn entry_target(toolchain: &ToolchainSpecBundle) -> Result<String> {
    toolchain
        .validation
        .must_pass
        .last()
        .cloned()
        .ok_or_else(|| VosError::Message("validation.must_pass must not be empty".into()))
}

pub(crate) fn required_phase_order(toolchain: &ToolchainSpecBundle) -> Result<Vec<String>> {
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

fn render_makefile(
    toolchain: &ToolchainSpecBundle,
    source_spec: &Path,
    stage: Option<&str>,
    phase_order: &[String],
    entry_target: &str,
) -> Result<String> {
    let mut out = String::new();
    out.push_str("# ========================================\n");
    out.push_str(&format!(
        "# Auto-generated from {}\n",
        source_spec.display()
    ));
    out.push_str(&format!(
        "# Spec Stage: {}\n",
        stage.unwrap_or("unspecified")
    ));
    out.push_str(&format!("# Phases: {}\n", phase_order.join(" ")));
    out.push_str("# Generator: makefile-generator v1\n");
    out.push_str("# ========================================\n\n");
    out.push_str("CC ?= ");
    out.push_str(&toolchain.toolchain.c_compiler);
    out.push_str("\nAS ?= ");
    out.push_str(&toolchain.toolchain.asm_compiler);
    out.push_str("\nLD ?= ");
    out.push_str(&toolchain.toolchain.linker);
    out.push_str("\nAR ?= ");
    out.push_str(&toolchain.toolchain.archiver);
    out.push('\n');
    out.push_str(".PHONY: all ");
    out.push_str(&phase_order.join(" "));
    out.push_str("\n\n");
    out.push_str(&format!("all: {}\n\n", entry_target));

    for phase in &toolchain.build.phases {
        out.push_str(&render_phase(phase, toolchain)?);
        out.push('\n');
    }
    Ok(out)
}

fn render_phase(phase: &BuildPhaseSemantics, toolchain: &ToolchainSpecBundle) -> Result<String> {
    let mut out = String::new();
    out.push_str(&format!("# Phase: {}\n", phase.name));
    let deps = if phase.semantic.dependencies.is_empty() {
        String::new()
    } else {
        phase.semantic.dependencies.join(" ")
    };
    let dep_suffix = if deps.is_empty() {
        String::new()
    } else {
        format!(" {deps}")
    };
    out.push_str(&format!("{}:{}\n", phase.name, dep_suffix));
    for line in render_phase_commands(phase, toolchain)? {
        out.push_str("\t");
        out.push_str(&line);
        out.push('\n');
    }
    Ok(out)
}

fn render_phase_commands(
    phase: &BuildPhaseSemantics,
    toolchain: &ToolchainSpecBundle,
) -> Result<Vec<String>> {
    match phase.semantic.kind.as_str() {
        "compile" => render_compile_commands(phase, toolchain),
        "archive" => render_archive_commands(phase, toolchain),
        "link" => render_link_commands(phase, toolchain),
        "test" => render_test_commands(phase),
        "custom" => render_custom_commands(phase, toolchain),
        other => Err(VosError::Message(format!(
            "unsupported build phase semantic.type `{other}`"
        ))),
    }
}

fn render_compile_commands(
    phase: &BuildPhaseSemantics,
    toolchain: &ToolchainSpecBundle,
) -> Result<Vec<String>> {
    let compiler = phase
        .semantic
        .compiler
        .clone()
        .unwrap_or_else(|| toolchain.toolchain.c_compiler.clone());
    let output_dir = phase.semantic.output_dir.as_ref().ok_or_else(|| {
        VosError::Message(format!("compile phase `{}` missing output_dir", phase.name))
    })?;
    let mut includes = toolchain
        .build
        .include_paths
        .iter()
        .cloned()
        .collect::<Vec<_>>();
    includes.extend(phase.semantic.include_dirs.iter().cloned());
    includes.sort();
    includes.dedup();
    let include_flags = includes
        .iter()
        .map(|dir| format!("-I{}", shell_escape(dir.display().to_string())))
        .collect::<Vec<_>>()
        .join(" ");
    let base_flags = compile_flags(phase, toolchain);
    let mut script = vec![format!(
        "$$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Force -Path '{}' | Out-Null; $$found = $$false",
        powershell_literal(output_dir.display().to_string())
    )];
    for source in &phase.semantic.sources {
        let root = glob_root(&source.pattern);
        let name_filter = shell_find_name(&source.pattern).replace('*', "");
        script.push(format!(
            "Get-ChildItem -Path '{}' -Recurse -File | Where-Object {{ $$_.Extension -eq '{}' }} | ForEach-Object {{",
            powershell_literal(root),
            powershell_literal(name_filter)
        ));
        for exclude in &source.exclude {
            script.push(format!(
                "if (($$_.FullName -replace '\\\\','/') -like '{}') {{ return }}",
                powershell_literal(shell_case_pattern(exclude))
            ));
        }
        script.push("$$found = $$true".into());
        script.push(format!(
            "$$out = Join-Path '{}' ($$_.BaseName + '.o')",
            powershell_literal(output_dir.display().to_string())
        ));
        script.push(format!(
            "& {} {} {} -c $$_.FullName -o $$out; if ($$LASTEXITCODE -ne 0) {{ exit $$LASTEXITCODE }}",
            shell_escape(compiler.clone()),
            base_flags,
            include_flags
        ));
        script.push("}".into());
    }
    script.push("if (-not $$found) { throw 'no compile sources matched' }".into());
    Ok(vec![powershell_command(script.join("; "))])
}

fn render_archive_commands(
    phase: &BuildPhaseSemantics,
    toolchain: &ToolchainSpecBundle,
) -> Result<Vec<String>> {
    let archiver = phase
        .semantic
        .archiver
        .clone()
        .unwrap_or_else(|| toolchain.toolchain.archiver.clone());
    let output = phase.semantic.output_file.as_ref().ok_or_else(|| {
        VosError::Message(format!(
            "archive phase `{}` missing output_file",
            phase.name
        ))
    })?;
    let inputs = phase
        .semantic
        .input_artifacts
        .iter()
        .map(|item| shell_escape(item.display().to_string()))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(vec![powershell_command(format!(
        "& {} rcs {} {}; if ($$LASTEXITCODE -ne 0) {{ exit $$LASTEXITCODE }}",
        shell_escape(archiver),
        shell_escape(output.display().to_string()),
        inputs
    ))])
}

fn render_link_commands(
    phase: &BuildPhaseSemantics,
    toolchain: &ToolchainSpecBundle,
) -> Result<Vec<String>> {
    let linker = phase
        .semantic
        .linker
        .clone()
        .unwrap_or_else(|| toolchain.toolchain.linker.clone());
    let output = phase.semantic.output_file.as_ref().ok_or_else(|| {
        VosError::Message(format!("link phase `{}` missing output_file", phase.name))
    })?;
    let script = phase
        .semantic
        .linker_script
        .clone()
        .unwrap_or_else(|| toolchain.link.linker_script.clone());
    let inputs = phase
        .semantic
        .input_artifacts
        .iter()
        .map(|item| shell_escape(item.display().to_string()))
        .collect::<Vec<_>>()
        .join(" ");
    let lib_dirs = phase
        .semantic
        .library_dirs
        .iter()
        .map(|dir| format!("-L{}", shell_escape(dir.display().to_string())))
        .collect::<Vec<_>>()
        .join(" ");
    let libs = phase
        .semantic
        .libraries
        .iter()
        .map(|lib| {
            lib.hint
                .clone()
                .unwrap_or_else(|| format!("-l{}", lib.name))
        })
        .collect::<Vec<_>>()
        .join(" ");
    let extra = phase.semantic.flags.extra.clone().unwrap_or_default();
    Ok(vec![powershell_command(format!(
        "& {} -T {} {} -o {} {} {} {}; if ($$LASTEXITCODE -ne 0) {{ exit $$LASTEXITCODE }}",
        shell_escape(linker),
        shell_escape(script.display().to_string()),
        extra,
        shell_escape(output.display().to_string()),
        inputs,
        lib_dirs,
        libs
    ))])
}

fn render_test_commands(phase: &BuildPhaseSemantics) -> Result<Vec<String>> {
    let test_binary = phase.semantic.test_binary.as_ref().ok_or_else(|| {
        VosError::Message(format!("test phase `{}` missing test_binary", phase.name))
    })?;
    let args = phase
        .semantic
        .test_args
        .iter()
        .map(|arg| shell_escape(arg.clone()))
        .collect::<Vec<_>>()
        .join(" ");
    let mut commands = vec![format!(
        "$$testOutput = & {} {}; if ($$LASTEXITCODE -ne 0) {{ exit $$LASTEXITCODE }}",
        shell_escape(test_binary.display().to_string()),
        args
    )];
    if let Some(pattern) = &phase.semantic.expected_pattern {
        commands.push(format!(
            "if ($$testOutput -notmatch '{}') {{ throw 'test phase {} missing expected pattern' }}",
            powershell_literal(pattern.clone()),
            phase.name
        ));
    }
    if let Some(file) = &phase.semantic.expected_output_file {
        commands.push(format!(
            "if (-not (Test-Path '{}')) {{ throw 'test phase {} missing expected output file' }}",
            powershell_literal(file.display().to_string()),
            phase.name
        ));
    }
    Ok(vec![powershell_command(commands.join("; "))])
}

fn render_custom_commands(
    phase: &BuildPhaseSemantics,
    toolchain: &ToolchainSpecBundle,
) -> Result<Vec<String>> {
    let command = if let Some(command) = &phase.semantic.command {
        command.clone()
    } else if let Some(template) = &phase.semantic.template {
        template
            .replace("{cc}", &toolchain.toolchain.c_compiler)
            .replace("{ld}", &toolchain.toolchain.linker)
            .replace("{ar}", &toolchain.toolchain.archiver)
    } else {
        return Err(VosError::Message(format!(
            "custom phase `{}` missing command/template",
            phase.name
        )));
    };
    let mut commands = vec![command];
    for expected in &phase.semantic.expected_outputs {
        commands.push(format!(
            "if (-not (Test-Path '{}')) {{ throw 'custom phase {} missing expected output' }}",
            powershell_literal(expected.display().to_string()),
            phase.name
        ));
    }
    Ok(vec![powershell_command(commands.join("; "))])
}

fn compile_flags(phase: &BuildPhaseSemantics, toolchain: &ToolchainSpecBundle) -> String {
    let mut flags = Vec::new();
    flags.extend(toolchain.build.cflags.iter().cloned());
    for warning in &phase.semantic.flags.warnings {
        match warning.as_str() {
            "all" => flags.push("-Wall".into()),
            "extra" => flags.push("-Wextra".into()),
            "error" => flags.push("-Werror".into()),
            "pedantic" => flags.push("-Wpedantic".into()),
            "none" => {}
            other => flags.push(format!("-W{other}")),
        }
    }
    if let Some(opt) = &phase.semantic.flags.optimization {
        flags.push(format!("-{}", opt));
    }
    if phase.semantic.flags.debug.unwrap_or(false) {
        flags.push("-g".into());
    }
    for define in &phase.semantic.flags.defines {
        flags.push(format!("-D{}", define));
    }
    if let Some(extra) = &phase.semantic.flags.extra {
        flags.push(extra.clone());
    }
    if let Some(standard) = &phase.semantic.standard {
        flags.push(format!("-std={standard}"));
    }
    flags.join(" ")
}

fn glob_root(pattern: &str) -> String {
    let normalized = pattern.replace('\\', "/");
    normalized
        .split("/**")
        .next()
        .unwrap_or(&normalized)
        .trim_end_matches('/')
        .to_string()
}

fn shell_find_name(pattern: &str) -> String {
    let normalized = pattern.replace('\\', "/");
    normalized.rsplit('/').next().unwrap_or("*").to_string()
}

fn shell_case_pattern(pattern: &str) -> String {
    pattern
        .replace('\\', "/")
        .replace("**/", "*")
        .replace("**", "*")
}

fn shell_escape(value: String) -> String {
    if value.contains([' ', '\t', '"']) {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value
    }
}

fn powershell_literal(value: String) -> String {
    value.replace('\'', "''")
}

fn powershell_command(script: String) -> String {
    format!(
        "powershell -NoProfile -Command \"{}\"",
        script.replace('"', "`\"")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use vos_core::{
        BuildContract, BuildFlags, BuildPhaseSemantic, BuildPhaseSemantics, ImageContract,
        LinkContract, RunContract, ToolchainProfile, ValidationContract,
    };

    fn sample_toolchain() -> ToolchainSpecBundle {
        ToolchainSpecBundle {
            toolchain: ToolchainProfile {
                target_arch: "riscv64".into(),
                target_triple: "riscv64-unknown-elf".into(),
                c_compiler: "riscv64-unknown-elf-gcc".into(),
                asm_compiler: "riscv64-unknown-elf-gcc".into(),
                linker: "riscv64-unknown-elf-ld".into(),
                archiver: "riscv64-unknown-elf-ar".into(),
            },
            environment: Default::default(),
            build: BuildContract {
                phases: vec![
                    BuildPhaseSemantics {
                        name: "compile".into(),
                        semantic: BuildPhaseSemantic {
                            kind: "compile".into(),
                            sources: vec![vos_core::SourcePattern {
                                pattern: "kernel/**/*.c".into(),
                                exclude: vec!["kernel/test/**".into()],
                            }],
                            include_dirs: vec![PathBuf::from("include")],
                            flags: BuildFlags {
                                warnings: vec!["all".into(), "error".into()],
                                optimization: Some("O2".into()),
                                debug: Some(true),
                                defines: vec!["KERNEL".into()],
                                extra: None,
                            },
                            output_dir: Some(PathBuf::from("build")),
                            output_pattern: Some("*.o".into()),
                            ..Default::default()
                        },
                    },
                    BuildPhaseSemantics {
                        name: "link".into(),
                        semantic: BuildPhaseSemantic {
                            kind: "link".into(),
                            dependencies: vec!["compile".into()],
                            input_artifacts: vec![PathBuf::from("build/kernel.o")],
                            output_file: Some(PathBuf::from("build/kernel.elf")),
                            linker_script: Some(PathBuf::from("kernel/link.ld")),
                            ..Default::default()
                        },
                    },
                ],
                generated_artifacts: vec![PathBuf::from("build/kernel.elf")],
                ..Default::default()
            },
            link: LinkContract {
                linker_script: PathBuf::from("kernel/link.ld"),
                entry_symbol: "_start".into(),
                section_rules: Vec::new(),
                relocation_model: None,
                abi_constraints: Vec::new(),
            },
            image: ImageContract {
                output_kind: "kernel-elf".into(),
                objcopy_rules: Vec::new(),
                boot_chain: Vec::new(),
                required_artifacts: vec![PathBuf::from("build/kernel.elf")],
            },
            run: RunContract {
                emulator: "qemu-system-riscv64".into(),
                machine: "virt".into(),
                cpu: "rv64".into(),
                memory: "128M".into(),
                bios: Some("default".into()),
                kernel_arg: "-kernel".into(),
                extra_args: Vec::new(),
                success_signal: "OK".into(),
                timeout_secs: 30,
            },
            debug: Default::default(),
            validation: ValidationContract {
                must_pass: vec!["link".into()],
            },
        }
    }

    #[test]
    fn required_phase_order_includes_dependencies() {
        let order = required_phase_order(&sample_toolchain()).unwrap();
        assert_eq!(order, vec!["compile", "link"]);
    }

    #[test]
    fn makefile_render_is_stable() {
        let toolchain = sample_toolchain();
        let source = PathBuf::from("spec/toolchain/toolchain.yaml");
        let a = render_makefile(
            &toolchain,
            &source,
            Some("boot"),
            &["compile".into(), "link".into()],
            "link",
        )
        .unwrap();
        let b = render_makefile(
            &toolchain,
            &source,
            Some("boot"),
            &["compile".into(), "link".into()],
            "link",
        )
        .unwrap();
        assert_eq!(a, b);
        assert!(a.contains("Auto-generated from spec/toolchain/toolchain.yaml"));
        assert!(a.contains("compile"));
        assert!(a.contains("link"));
    }
}
