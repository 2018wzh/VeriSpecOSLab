use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolchainProfile {
    pub target_arch: String,
    pub target_triple: String,
    pub c_compiler: String,
    pub asm_compiler: String,
    pub linker: String,
    pub archiver: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EnvironmentContract {
    #[serde(default)]
    pub required_tools: Vec<String>,
    #[serde(default)]
    pub allowed_versions: Vec<String>,
    #[serde(default)]
    pub disallowed_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BuildContract {
    #[serde(default)]
    pub sources: Vec<PathBuf>,
    #[serde(default)]
    pub include_paths: Vec<PathBuf>,
    #[serde(default)]
    pub cflags: Vec<String>,
    #[serde(default)]
    pub asmflags: Vec<String>,
    #[serde(default)]
    pub ldflags: Vec<String>,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub forbidden_flags: Vec<String>,
    #[serde(default)]
    pub generated_artifacts: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LinkContract {
    pub linker_script: PathBuf,
    pub entry_symbol: String,
    #[serde(default)]
    pub section_rules: Vec<String>,
    pub relocation_model: Option<String>,
    #[serde(default)]
    pub abi_constraints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ImageContract {
    pub output_kind: String,
    #[serde(default)]
    pub objcopy_rules: Vec<String>,
    #[serde(default)]
    pub boot_chain: Vec<String>,
    #[serde(default)]
    pub required_artifacts: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RunContract {
    pub emulator: String,
    pub machine: String,
    pub cpu: String,
    pub memory: String,
    pub bios: Option<String>,
    pub kernel_arg: String,
    #[serde(default)]
    pub extra_args: Vec<String>,
    pub success_signal: String,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DebugContract {
    #[serde(default)]
    pub symbols_required: Vec<String>,
    pub gdb_script: Option<PathBuf>,
    #[serde(default)]
    pub trace_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ValidationContract {
    #[serde(default)]
    pub must_pass: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolchainSpecBundle {
    pub toolchain: ToolchainProfile,
    pub environment: EnvironmentContract,
    pub build: BuildContract,
    pub link: LinkContract,
    pub image: ImageContract,
    pub run: RunContract,
    pub debug: DebugContract,
    pub validation: ValidationContract,
}
