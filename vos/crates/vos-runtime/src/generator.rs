use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use vos_core::{
    BuildPhaseSemantics, Result, ToolchainGenerationMetadata, ToolchainGenerationRequest,
    ToolchainSpecBundle, VosError,
};

use vos_platform::{HostPath, HostPlatform};

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
    let content = render_standalone_makefile(
        project_root,
        toolchain,
        &source_spec,
        request.stage.as_deref(),
        &phase_order,
        &entry_target,
    )?;
    fs::write(&artifact_path, content)?;
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

#[derive(Debug, Clone)]
struct CompileUnit {
    source: PathBuf,
    object: PathBuf,
    phase: String,
}

fn render_standalone_makefile(
    project_root: &Path,
    toolchain: &ToolchainSpecBundle,
    source_spec: &Path,
    stage: Option<&str>,
    phase_order: &[String],
    entry_target: &str,
) -> Result<String> {
    let platform = HostPlatform::current();
    let compile_units = collect_compile_units(project_root, toolchain)?;
    let mut directories = collect_output_directories(&compile_units);
    directories.extend(collect_phase_output_directories(toolchain));
    directories.sort();
    directories.dedup();

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
    out.push_str("# Generator: makefile-export v2\n");
    out.push_str("# ========================================\n\n");
    out.push_str(&format!("CC ?= {}\n", toolchain.toolchain.c_compiler));
    out.push_str(&format!("AS ?= {}\n", toolchain.toolchain.asm_compiler));
    out.push_str(&format!("LD ?= {}\n", toolchain.toolchain.linker));
    out.push_str(&format!("AR ?= {}\n", toolchain.toolchain.archiver));
    out.push_str("OBJCOPY ?= riscv64-unknown-elf-objcopy\n");
    out.push_str("OBJDUMP ?= riscv64-unknown-elf-objdump\n");
    out.push_str("BUILD_ROOT ?= build\n");
    out.push_str(".PHONY: all ");
    out.push_str(&phase_order.join(" "));
    out.push_str(" ");
    out.push_str(
        &toolchain
            .build
            .phases
            .iter()
            .filter(|phase| phase.semantic.kind == "compile")
            .map(|phase| phase.name.clone())
            .collect::<Vec<_>>()
            .join(" "),
    );
    out.push_str("\n\n");
    out.push_str(&format!("all: {}\n\n", entry_target));

    for dir in directories {
        out.push_str(&format!(
            "{}:\n\t{}\n\n",
            platform.makefile_path(&dir),
            HostPath::mkdir_command(&dir)
        ));
    }

    for unit in &compile_units {
        let object_dir = unit.object.parent().unwrap_or_else(|| Path::new("."));
        out.push_str(&format!(
            "{}: {} | {}\n\t{} {} -c {} -o {}\n\n",
            platform.makefile_path(&unit.object),
            platform.makefile_path(&unit.source),
            platform.makefile_path(object_dir),
            compiler_for_phase(&unit.phase, toolchain)?,
            compile_flags_for_phase(&unit.phase, toolchain)?,
            platform.quote(platform.makefile_path(&unit.source)),
            platform.quote(platform.makefile_path(&unit.object))
        ));
    }

    for phase in &toolchain.build.phases {
        match phase.semantic.kind.as_str() {
            "compile" => {
                let outputs = compile_units
                    .iter()
                    .filter(|unit| unit.phase == phase.name)
                    .map(|unit| platform.makefile_path(&unit.object))
                    .collect::<Vec<_>>();
                out.push_str(&format!(
                    ".PHONY: {}\n{}: {}\n\n",
                    phase.name,
                    phase.name,
                    outputs.join(" ")
                ));
            }
            "archive" => {
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
                    .map(|item| platform.makefile_path(item))
                    .collect::<Vec<_>>()
                    .join(" ");
                let cmd_inputs = phase
                    .semantic
                    .input_artifacts
                    .iter()
                    .map(|item| platform.quote(platform.makefile_path(item)))
                    .collect::<Vec<_>>()
                    .join(" ");
                out.push_str(&format!(
                    "{}: {} | {}\n\t$(AR) rcs {} {}\n\n",
                    phase.name,
                    inputs,
                    platform.makefile_path(output.parent().unwrap_or_else(|| Path::new("."))),
                    platform.quote(platform.makefile_path(output)),
                    cmd_inputs
                ));
            }
            "link" => {
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
                    .map(|item| platform.makefile_path(item))
                    .collect::<Vec<_>>()
                    .join(" ");
                let cmd_inputs = phase
                    .semantic
                    .input_artifacts
                    .iter()
                    .map(|item| platform.quote(platform.makefile_path(item)))
                    .collect::<Vec<_>>()
                    .join(" ");
                let lib_dirs = phase
                    .semantic
                    .library_dirs
                    .iter()
                    .map(|dir| format!("-L{}", platform.quote(platform.makefile_path(dir))))
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
                out.push_str(&format!(
                    "{}: {} | {}\n\t$(LD) -T {} {} -o {} {} {} {}\n\n",
                    phase.name,
                    inputs,
                    platform.makefile_path(output.parent().unwrap_or_else(|| Path::new("."))),
                    platform.quote(platform.makefile_path(&script)),
                    extra,
                    platform.quote(platform.makefile_path(output)),
                    cmd_inputs,
                    lib_dirs,
                    libs
                ));
            }
            "test" => {
                let test_binary = phase.semantic.test_binary.as_ref().ok_or_else(|| {
                    VosError::Message(format!("test phase `{}` missing test_binary", phase.name))
                })?;
                let args = phase
                    .semantic
                    .test_args
                    .iter()
                    .map(|arg| platform.quote(arg))
                    .collect::<Vec<_>>()
                    .join(" ");
                let mut recipe = format!(
                    "{} {}",
                    platform.quote(platform.makefile_path(test_binary)),
                    args
                );
                if let Some(pattern) = &phase.semantic.expected_pattern {
                    recipe.push_str(&format!(" && printf '%s\\n' {}", platform.quote(pattern)));
                }
                if let Some(file) = &phase.semantic.expected_output_file {
                    recipe.push_str(&format!(
                        " && test -f {}",
                        platform.quote(platform.makefile_path(file))
                    ));
                }
                out.push_str(&format!(
                    ".PHONY: {}\n{}:\n\t{}\n\n",
                    phase.name, phase.name, recipe
                ));
            }
            "custom" => {
                let command = phase
                    .semantic
                    .command
                    .clone()
                    .or_else(|| phase.semantic.template.clone())
                    .ok_or_else(|| {
                        VosError::Message(format!(
                            "custom phase `{}` missing command/template",
                            phase.name
                        ))
                    })?;
                out.push_str(&format!(
                    ".PHONY: {}\n{}:\n\t{}\n\n",
                    phase.name, phase.name, command
                ));
            }
            other => {
                return Err(VosError::Message(format!(
                    "unsupported build phase semantic.type `{other}`"
                )));
            }
        }
    }
    Ok(out)
}

fn collect_compile_units(
    project_root: &Path,
    toolchain: &ToolchainSpecBundle,
) -> Result<Vec<CompileUnit>> {
    let mut units = Vec::new();
    let mut seen_sources = HashSet::new();
    for phase in &toolchain.build.phases {
        if phase.semantic.kind != "compile" {
            continue;
        }
        let output_dir = phase
            .semantic
            .output_dir
            .clone()
            .unwrap_or_else(|| PathBuf::from("build"));
        for pattern in &phase.semantic.sources {
            let root = glob_root(&pattern.pattern);
            let root_path = project_root.join(&root);
            if !root_path.exists() {
                continue;
            }
            let include_re = glob_to_regex(&pattern.pattern)?;
            let exclude_res = pattern
                .exclude
                .iter()
                .map(|item| glob_to_regex(item))
                .collect::<Result<Vec<_>>>()?;
            for source in walk_files(&root_path) {
                let rel_root = source
                    .strip_prefix(project_root)
                    .unwrap_or(&source)
                    .to_string_lossy()
                    .replace('\\', "/");
                if !include_re.is_match(&rel_root) {
                    continue;
                }
                if exclude_res.iter().any(|re| re.is_match(&rel_root)) {
                    continue;
                }
                if seen_sources.insert(source.clone()) {
                    let rel_under_root = source
                        .strip_prefix(&root_path)
                        .unwrap_or(&source)
                        .to_path_buf();
                    let mut object = output_dir.join(rel_under_root);
                    object.set_extension("o");
                    units.push(CompileUnit {
                        source,
                        object,
                        phase: phase.name.clone(),
                    });
                }
            }
        }
    }
    units.sort_by(|a, b| a.object.cmp(&b.object));
    Ok(units)
}

fn collect_output_directories(units: &[CompileUnit]) -> Vec<PathBuf> {
    let mut dirs = units
        .iter()
        .filter_map(|unit| unit.object.parent().map(|path| path.to_path_buf()))
        .collect::<Vec<_>>();
    dirs.sort();
    dirs.dedup();
    dirs
}

fn collect_phase_output_directories(toolchain: &ToolchainSpecBundle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for phase in &toolchain.build.phases {
        if let Some(output) = &phase.semantic.output_file {
            if let Some(parent) = output.parent() {
                dirs.push(parent.to_path_buf());
            }
        }
        if let Some(output) = &phase.semantic.expected_output_file {
            if let Some(parent) = output.parent() {
                dirs.push(parent.to_path_buf());
            }
        }
        for expected in &phase.semantic.expected_outputs {
            if let Some(parent) = expected.parent() {
                dirs.push(parent.to_path_buf());
            }
        }
    }
    dirs
}

fn compile_flags_for_phase(phase_name: &str, toolchain: &ToolchainSpecBundle) -> Result<String> {
    let phase = toolchain
        .build
        .phases
        .iter()
        .find(|item| item.name == phase_name)
        .ok_or_else(|| VosError::Message(format!("unknown compile phase `{phase_name}`")))?;
    Ok(compile_flags(phase, toolchain))
}

fn compiler_for_phase(phase_name: &str, toolchain: &ToolchainSpecBundle) -> Result<String> {
    let phase = toolchain
        .build
        .phases
        .iter()
        .find(|item| item.name == phase_name)
        .ok_or_else(|| VosError::Message(format!("unknown compile phase `{phase_name}`")))?;
    Ok(phase
        .semantic
        .compiler
        .clone()
        .unwrap_or_else(|| toolchain.toolchain.c_compiler.clone()))
}

fn glob_to_regex(pattern: &str) -> Result<Regex> {
    let mut regex = String::from("^");
    let normalized = pattern.replace('\\', "/");
    let mut chars = normalized.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '*' => {
                if matches!(chars.peek(), Some('*')) {
                    chars.next();
                    if matches!(chars.peek(), Some('/')) {
                        chars.next();
                        regex.push_str("(?:.*/)?");
                    } else {
                        regex.push_str(".*");
                    }
                } else {
                    regex.push_str("[^/]*");
                }
            }
            '?' => regex.push_str("[^/]"),
            '.' | '+' | '(' | ')' | '|' | '^' | '$' | '{' | '}' | '[' | ']' | '\\' => {
                regex.push('\\');
                regex.push(ch);
            }
            '/' => regex.push('/'),
            other => regex.push(other),
        }
    }
    regex.push('$');
    Regex::new(&regex)
        .map_err(|err| VosError::Message(format!("invalid glob pattern `{pattern}`: {err}")))
}

fn walk_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
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
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("kernel")).unwrap();
        std::fs::create_dir_all(tmp.path().join("user")).unwrap();
        std::fs::write(
            tmp.path().join("kernel/kernel.c"),
            "int kernel_main(void) { return 0; }",
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("user/shell.c"),
            "int main(void) { return 0; }",
        )
        .unwrap();
        let source = PathBuf::from("spec/toolchain/toolchain.yaml");
        let a = render_standalone_makefile(
            tmp.path(),
            &toolchain,
            &source,
            Some("boot"),
            &["compile".into(), "link".into()],
            "link",
        )
        .unwrap();
        let b = render_standalone_makefile(
            tmp.path(),
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
        assert!(!a.contains("powershell"));
    }
}
