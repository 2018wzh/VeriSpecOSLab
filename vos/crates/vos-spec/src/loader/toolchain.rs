use std::fs;
use std::path::Path;

use vos_core::{
    BuildContract, DebugContract, EnvironmentContract, ImageContract, LinkContract, Result,
    ToolchainProfile, ToolchainSpecBundle, ValidationContract, VosError,
};

use crate::loader::types::ToolchainYaml;

pub fn load_toolchain_spec(project_root: &Path, spec_root: &Path) -> Result<ToolchainSpecBundle> {
    let toolchain_path = project_root
        .join(spec_root)
        .join("toolchain")
        .join("toolchain.yaml");
    let parsed: ToolchainYaml = serde_yaml::from_str(&fs::read_to_string(toolchain_path)?)?;
    if parsed.run.success_signal.trim().is_empty() {
        return Err(VosError::Message("run.success_signal must not be empty".into()));
    }
    if parsed.run.kernel_arg.trim().is_empty() {
        return Err(VosError::Message("run.kernel_arg must not be empty".into()));
    }
    if parsed.link.entry_symbol.trim().is_empty() {
        return Err(VosError::Message("link.entry_symbol must not be empty".into()));
    }
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
            required_tools: parsed.environment.required_tools,
            allowed_versions: parsed.environment.allowed_versions,
            disallowed_tools: parsed.environment.disallowed_tools,
        },
        build: BuildContract {
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
