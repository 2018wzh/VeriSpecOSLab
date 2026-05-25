use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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
    pub required_tools: Vec<ToolRequirement>,
    #[serde(default)]
    pub allowed_versions: Vec<String>,
    #[serde(default)]
    pub disallowed_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRequirement {
    pub name: String,
    pub version_req: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BuildContract {
    #[serde(default)]
    pub phases: Vec<BuildPhaseSemantics>,
    #[serde(default)]
    pub allowed_output_paths: Vec<PathBuf>,
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
pub struct BuildPhaseSemantics {
    pub name: String,
    pub semantic: BuildPhaseSemantic,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BuildPhaseSemantic {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub working_dir: Option<PathBuf>,
    #[serde(default)]
    pub env_vars: BTreeMap<String, String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub retry_on_failure: Option<u32>,
    #[serde(default)]
    pub parallel: bool,
    #[serde(default)]
    pub compiler: Option<String>,
    #[serde(default)]
    pub linker: Option<String>,
    #[serde(default)]
    pub archiver: Option<String>,
    #[serde(default)]
    pub sources: Vec<SourcePattern>,
    #[serde(default)]
    pub include_dirs: Vec<PathBuf>,
    #[serde(default)]
    pub flags: BuildFlags,
    #[serde(default)]
    pub standard: Option<String>,
    #[serde(default)]
    pub output_dir: Option<PathBuf>,
    #[serde(default)]
    pub output_pattern: Option<String>,
    #[serde(default)]
    pub expected_outputs: Vec<PathBuf>,
    #[serde(default)]
    pub input_artifacts: Vec<PathBuf>,
    #[serde(default)]
    pub output_file: Option<PathBuf>,
    #[serde(default)]
    pub output_format: Option<String>,
    #[serde(default)]
    pub linker_script: Option<PathBuf>,
    #[serde(default)]
    pub libraries: Vec<LibraryDependency>,
    #[serde(default)]
    pub library_dirs: Vec<PathBuf>,
    #[serde(default)]
    pub library_type: Option<String>,
    #[serde(default)]
    pub framework: Option<String>,
    #[serde(default)]
    pub test_binary: Option<PathBuf>,
    #[serde(default)]
    pub test_args: Vec<String>,
    #[serde(default)]
    pub expected_pattern: Option<String>,
    #[serde(default)]
    pub expected_output_file: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SourcePattern {
    pub pattern: String,
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BuildFlags {
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub optimization: Option<String>,
    #[serde(default)]
    pub debug: Option<bool>,
    #[serde(default)]
    pub defines: Vec<String>,
    #[serde(default)]
    pub extra: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LibraryDependency {
    pub name: String,
    #[serde(default)]
    pub hint: Option<String>,
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
