use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::spec::{
    ArchitectureSpecBundle, ModuleSpec, OperationContract, SpecRef, ToolchainSpecBundle,
};

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
    #[serde(default)]
    pub generated_toolchain_artifacts: Vec<PathBuf>,
    #[serde(default)]
    pub phase_results: Vec<PhaseExecutionRecord>,
    #[serde(default)]
    pub artifact_checks: Vec<ArtifactCheckResult>,
    pub generation_metadata: Option<ToolchainGenerationMetadata>,
    pub degraded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseExecutionRecord {
    pub phase: String,
    pub spec_source: String,
    pub status: String,
    pub attempts: u32,
    pub command: String,
    pub exit_code: Option<i32>,
    pub log_path: PathBuf,
    #[serde(default)]
    pub stdout_excerpt: String,
    #[serde(default)]
    pub stderr_excerpt: String,
    #[serde(default)]
    pub artifacts_produced: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactCheckResult {
    pub phase: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolchainGenerationRequest {
    pub stage: Option<String>,
    pub generator: Option<String>,
    #[serde(default)]
    pub generators: Vec<String>,
    pub dry_run: bool,
    pub toolchain_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolchainGenerationMetadata {
    pub generator: String,
    pub stage: Option<String>,
    pub format: String,
    pub source_spec: PathBuf,
    pub entry_target: String,
    #[serde(default)]
    pub phases: Vec<String>,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestRunResult {
    pub suite: Option<String>,
    #[serde(default)]
    pub selected_phases: Vec<String>,
    pub build: BuildResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchVerifyResult {
    pub patch_path: PathBuf,
    #[serde(default)]
    pub selected_phases: Vec<String>,
    pub build: BuildResult,
    pub run: Option<QemuRunResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicVerifyResult {
    pub normalize_ok: bool,
    pub consistency_ok: bool,
    pub build: BuildResult,
    pub run: QemuRunResult,
    #[serde(default)]
    pub required_checks: Vec<String>,
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
pub struct ToolchainLintResult {
    pub ok: bool,
    pub target_arch: String,
    pub target_triple: String,
    #[serde(default)]
    pub required_tools: Vec<String>,
    pub emulator: String,
    pub success_signal: String,
}
