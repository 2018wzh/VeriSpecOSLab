use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::spec::{ArchitectureSpecBundle, ModuleSpec, OperationContract, SpecRef, ToolchainSpecBundle};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedSpecBundle {
    #[serde(default)]
    pub modules: Vec<ModuleSpec>,
    #[serde(default)]
    pub operations: Vec<OperationContract>,
    pub architecture: ArchitectureSpecBundle,
    #[serde(default)]
    pub toolchain_profiles: Vec<ToolchainSpecBundle>,
    #[serde(default)]
    pub hashes: BTreeMap<String, String>,
    pub visibility: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitectureComposeResult {
    pub current_stage: String,
    #[serde(default)]
    pub enabled_modules: Vec<String>,
    #[serde(default)]
    pub module_dependency_dag: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub skeleton_features: Vec<String>,
    #[serde(default)]
    pub verification_bindings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerivedTestMatrix {
    pub stage: String,
    #[serde(default)]
    pub public_checks: Vec<String>,
    #[serde(default)]
    pub generated_checks: Vec<String>,
    #[serde(default)]
    pub build_checks: Vec<String>,
    #[serde(default)]
    pub run_checks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageDescriptor {
    pub stage: String,
    pub stage_index: usize,
    #[serde(default)]
    pub modules: Vec<String>,
    #[serde(default)]
    pub required_stages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitecturePlanBundle {
    pub target_platform: String,
    pub current_stage: String,
    #[serde(default)]
    pub enabled_modules: Vec<String>,
    #[serde(default)]
    pub required_operations: Vec<SpecRef>,
    #[serde(default)]
    pub skeleton_features: Vec<String>,
    #[serde(default)]
    pub generation_order: Vec<StageDescriptor>,
    #[serde(default)]
    pub verification_bindings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleGenerationJob {
    pub module: String,
    pub stage: String,
    #[serde(default)]
    pub operations: Vec<String>,
    #[serde(default)]
    pub editable_targets: Vec<PathBuf>,
    #[serde(default)]
    pub depends_on_modules: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationQueue {
    pub stage: String,
    #[serde(default)]
    pub skeleton_features: Vec<String>,
    #[serde(default)]
    pub jobs: Vec<ModuleGenerationJob>,
    #[serde(default)]
    pub waves: Vec<Vec<String>>,
    #[serde(default)]
    pub blocked_by: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildPhase {
    pub name: String,
    pub command: String,
    pub cwd: PathBuf,
    #[serde(default)]
    pub generated_artifacts: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationStagePlan {
    pub stage: String,
    #[serde(default)]
    pub required_checks: Vec<String>,
    #[serde(default)]
    pub build_phases: Vec<BuildPhase>,
    #[serde(default)]
    pub user_artifacts: Vec<PathBuf>,
    pub runnable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionNode {
    pub node_id: String,
    pub kind: String,
    pub adapter: String,
    #[serde(default)]
    pub inputs: Vec<String>,
    pub timeout_secs: u64,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub resource_locks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub plan_id: String,
    pub command_name: String,
    #[serde(default)]
    pub nodes: Vec<ExecutionNode>,
    pub artifacts_root: PathBuf,
    pub concurrency_profile: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodegenPlan {
    pub module: String,
    pub operation: String,
    pub phase: String,
    pub target_file: PathBuf,
    pub prompt_preview: String,
    pub build_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildRequest {
    pub command: String,
    pub cwd: PathBuf,
    pub profile: Option<String>,
    #[serde(default)]
    pub generated_artifacts: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildResult {
    pub command: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub log_path: PathBuf,
    #[serde(default)]
    pub generated_artifacts: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QemuRunResult {
    pub command: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub detected_signal: Option<String>,
    pub log_path: PathBuf,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecLintResult {
    pub ok: bool,
    pub module: String,
    pub operation: String,
    pub target_file: PathBuf,
    #[serde(default)]
    pub required_followup_checks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct CodegenRunResult {
    pub run_id: String,
    pub module: String,
    pub operation: String,
    pub model: String,
    pub target_file: PathBuf,
    pub applied: bool,
    pub build_status: String,
    pub changed_region: String,
    pub raw_response_ref: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolchainLintResult {
    pub ok: bool,
    pub target_arch: String,
    pub target_triple: String,
    #[serde(default)]
    pub required_tools: Vec<String>,
    pub emulator: String,
    pub success_signal: String,
}
