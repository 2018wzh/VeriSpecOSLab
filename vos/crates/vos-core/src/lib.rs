use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, VosError>;

#[derive(Debug, Error)]
pub enum VosError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("yaml error: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("toml parse error: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("toml serialize error: {0}")]
    TomlSer(#[from] toml::ser::Error),
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct SpecRef {
    pub module: String,
    pub operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditableRegion {
    pub file: PathBuf,
    pub start_marker: String,
    pub end_marker: String,
    #[serde(default)]
    pub create_if_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmCodegenConstraints {
    pub editable_region: EditableRegion,
    #[serde(default)]
    pub forbidden_changes: Vec<String>,
    #[serde(default)]
    pub required_followup_checks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArchitectureReferenceSystem {
    pub system: String,
    #[serde(default)]
    pub borrowed_concepts: Vec<String>,
    #[serde(default)]
    pub modified_concepts: Vec<String>,
    #[serde(default)]
    pub rejected_concepts: Vec<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitectureSeed {
    pub id: String,
    pub project: String,
    pub domain: String,
    pub target_platform: String,
    pub architecture_name: String,
    pub architecture_summary: String,
    #[serde(default)]
    pub reference_systems: Vec<ArchitectureReferenceSystem>,
    #[serde(default)]
    pub goals: Vec<String>,
    #[serde(default)]
    pub non_goals: Vec<String>,
    #[serde(default)]
    pub constraints: Vec<String>,
    #[serde(default)]
    pub initial_validation_binding: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ValidationBinding {
    #[serde(default)]
    pub must_pass: Vec<String>,
    #[serde(default)]
    pub generated: Vec<String>,
    #[serde(default)]
    pub hidden_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitectureSlice {
    pub id: String,
    pub stage: String,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub depends_on_slices: Vec<String>,
    #[serde(default)]
    pub depends_on_adrs: Vec<String>,
    #[serde(default)]
    pub mechanisms: Vec<String>,
    #[serde(default)]
    pub affected_modules: Vec<String>,
    #[serde(default)]
    pub new_operations: Vec<String>,
    #[serde(default)]
    pub removed_or_replaced_mechanisms: Vec<String>,
    #[serde(default)]
    pub invariants: Vec<String>,
    #[serde(default)]
    pub security_boundaries: Vec<String>,
    #[serde(default)]
    pub concurrency_highlights: Vec<String>,
    #[serde(default)]
    pub validation_binding: ValidationBinding,
    #[serde(default)]
    pub open_questions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositionRule {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub affected_modules: Vec<String>,
    #[serde(default)]
    pub related_slices: Vec<String>,
    #[serde(default)]
    pub invariant: Vec<String>,
    #[serde(default)]
    pub authority_boundary: Vec<String>,
    #[serde(default)]
    pub concurrency_boundary: Vec<String>,
    #[serde(default)]
    pub failure_boundary: Vec<String>,
    #[serde(default)]
    pub validation_intent: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArchitectureCompositionSpec {
    #[serde(default)]
    pub cross_component_rules: Vec<CompositionRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleSpec {
    pub id: String,
    pub module: String,
    pub stage: String,
    pub purpose: String,
    #[serde(default)]
    pub related_slices: Vec<String>,
    #[serde(default)]
    pub related_adrs: Vec<String>,
    #[serde(default)]
    pub owned_state: Vec<String>,
    #[serde(default)]
    pub exported_interfaces: Vec<String>,
    #[serde(default)]
    pub imported_interfaces: Vec<String>,
    #[serde(default)]
    pub module_invariants: Vec<String>,
    #[serde(default)]
    pub error_model: Vec<String>,
    #[serde(default)]
    pub resource_lifetime_rules: Vec<String>,
    #[serde(default)]
    pub security_boundary: Vec<String>,
    #[serde(default)]
    pub test_surfaces: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConcurrencySpec {
    pub module: String,
    #[serde(default)]
    pub shared_state: Vec<String>,
    #[serde(default)]
    pub lock_types: Vec<String>,
    #[serde(default)]
    pub lock_order: Vec<String>,
    #[serde(default)]
    pub atomic_sections: Vec<String>,
    #[serde(default)]
    pub interrupt_rules: Vec<String>,
    #[serde(default)]
    pub wait_wakeup_rules: Vec<String>,
    #[serde(default)]
    pub rely: serde_yaml::Value,
    #[serde(default)]
    pub guarantee: serde_yaml::Value,
    #[serde(default)]
    pub forbidden_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OperationDependsOn {
    #[serde(default)]
    pub requires_modules: Vec<String>,
    #[serde(default)]
    pub requires_ops: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OperationTestObligations {
    #[serde(default)]
    pub public: Vec<String>,
    #[serde(default)]
    pub generated: Vec<String>,
    #[serde(default)]
    pub hidden_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationContract {
    pub id: String,
    pub stage: String,
    pub module: String,
    pub operation: String,
    pub purpose: String,
    pub related_slice: Option<String>,
    pub related_adr: Option<String>,
    #[serde(default)]
    pub depends_on: OperationDependsOn,
    #[serde(default)]
    pub rely: serde_yaml::Value,
    #[serde(default)]
    pub guarantee: serde_yaml::Value,
    #[serde(default)]
    pub preconditions: Vec<String>,
    #[serde(default)]
    pub postconditions: Vec<String>,
    #[serde(default)]
    pub invariants_preserved: Vec<String>,
    #[serde(default)]
    pub failure_semantics: serde_yaml::Value,
    #[serde(default)]
    pub concurrency: serde_yaml::Value,
    #[serde(default)]
    pub security: serde_yaml::Value,
    #[serde(default)]
    pub observability: serde_yaml::Value,
    #[serde(default)]
    pub test_obligations: OperationTestObligations,
    pub llm_codegen: LlmCodegenConstraints,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecBundle {
    pub module_spec: ModuleSpec,
    pub operation_contract: OperationContract,
    pub concurrency_spec: Option<ConcurrencySpec>,
    #[serde(default)]
    pub target_paths: Vec<PathBuf>,
    #[serde(default)]
    pub build_hints: Vec<String>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitectureSpecBundle {
    pub seed: ArchitectureSeed,
    #[serde(default)]
    pub slices: Vec<ArchitectureSlice>,
    pub composition: ArchitectureCompositionSpec,
    pub toolchain: ToolchainSpecBundle,
}

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
pub struct ConsistencyReport {
    pub ok: bool,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub checked_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitectureLintResult {
    pub ok: bool,
    pub target_platform: String,
    pub current_stage: Option<String>,
    #[serde(default)]
    pub declared_stages: Vec<String>,
    #[serde(default)]
    pub enabled_modules: Vec<String>,
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
pub struct PromptEnvelope {
    pub task_kind: String,
    pub phase: String,
    pub spec_ref: SpecRef,
    #[serde(default)]
    pub allowed_paths: Vec<PathBuf>,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodegenRequest {
    pub spec_ref: SpecRef,
    pub phase: String,
    pub model: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodegenResponse {
    pub model: String,
    pub raw_text: String,
    pub extracted_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionEdit {
    pub file: PathBuf,
    pub start_marker: String,
    pub end_marker: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkeletonFileEdit {
    pub path: PathBuf,
    pub content: String,
    pub create_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModuleBatchCodegenResponse {
    #[serde(default)]
    pub region_edits: Vec<RegionEdit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkeletonProjectionResponse {
    #[serde(default)]
    pub files_to_create: Vec<SkeletonFileEdit>,
    #[serde(default)]
    pub files_to_update: Vec<RegionEdit>,
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
pub struct CodegenPlan {
    pub module: String,
    pub operation: String,
    pub phase: String,
    pub target_file: PathBuf,
    pub prompt_preview: String,
    pub build_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecLintResult {
    pub ok: bool,
    pub module: String,
    pub operation: String,
    pub target_file: PathBuf,
    pub required_followup_checks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextBundle {
    pub requested_scope: String,
    #[serde(default)]
    pub resolved_specs: Vec<String>,
    #[serde(default)]
    pub recent_evidence: Vec<String>,
    #[serde(default)]
    pub allowed_paths: Vec<PathBuf>,
    #[serde(default)]
    pub recommended_commands: Vec<String>,
    pub visibility_scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanDraft {
    pub task: String,
    #[serde(default)]
    pub related_specs: Vec<String>,
    #[serde(default)]
    pub suspected_files: Vec<PathBuf>,
    #[serde(default)]
    pub required_validations: Vec<String>,
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(default)]
    pub generation_waves: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyPatchResult {
    pub run_id: String,
    #[serde(default)]
    pub created_files: Vec<PathBuf>,
    #[serde(default)]
    pub updated_regions: Vec<PathBuf>,
    pub build: Option<BuildResult>,
    pub run: Option<QemuRunResult>,
    pub manifest_path: PathBuf,
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
pub struct RunManifest {
    pub run_id: String,
    pub command: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    pub git_rev: Option<String>,
    pub spec_hash: String,
    pub projection_version: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: String,
    #[serde(default)]
    pub artifacts: Vec<PathBuf>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticReport {
    pub kind: String,
    pub summary: String,
    pub phase: String,
    #[serde(default)]
    pub related_specs: Vec<String>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
    #[serde(default)]
    pub suggested_next_commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderConfig {
    pub kind: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub api_key_env: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BuildConfig {
    pub command: Option<String>,
    pub cwd: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub spec_root: Option<PathBuf>,
    #[serde(default)]
    pub build: BuildConfig,
    #[serde(default)]
    pub provider: ProviderConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorReport {
    pub provider_api_key_present: bool,
    pub provider_kind: String,
    pub api_key_env: String,
    pub model: String,
    pub base_url: String,
    pub build_command: Option<String>,
    pub project_root: PathBuf,
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressEvent {
    pub stage: String,
    pub message: String,
    pub entity_kind: Option<String>,
    pub entity_id: Option<String>,
    pub position: Option<usize>,
    pub total: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandStatus {
    Ok,
    Partial,
    Planned,
    NotImplemented,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactRef {
    pub kind: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandEnvelope<T> {
    pub ok: bool,
    pub run_id: String,
    pub command: String,
    pub status: CommandStatus,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRef>,
    pub payload: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotImplementedPayload {
    pub reason: String,
    #[serde(default)]
    pub related_docs: Vec<String>,
    #[serde(default)]
    pub suggested_next_commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailurePayload {
    pub kind: String,
    pub message: String,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticPayload {
    pub kind: String,
    pub message: String,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

pub fn new_run_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn is_valid_env_var_name(name: &str) -> bool {
    regex::Regex::new(r"^[A-Z_][A-Z0-9_]*$")
        .map(|re| re.is_match(name))
        .unwrap_or(false)
}

pub fn envelope<T>(
    command: impl Into<String>,
    status: CommandStatus,
    artifacts: Vec<ArtifactRef>,
    payload: T,
) -> CommandEnvelope<T> {
    let status_clone = status.clone();
    CommandEnvelope {
        ok: matches!(
            status_clone,
            CommandStatus::Ok | CommandStatus::Partial | CommandStatus::Planned
        ),
        run_id: new_run_id(),
        command: command.into(),
        status,
        artifacts,
        payload,
    }
}

pub fn artifact(kind: impl Into<String>, path: impl Into<String>) -> ArtifactRef {
    ArtifactRef {
        kind: kind.into(),
        path: path.into(),
    }
}

pub fn not_implemented_payload(
    reason: impl Into<String>,
    related_docs: Vec<String>,
    suggested_next_commands: Vec<String>,
) -> NotImplementedPayload {
    NotImplementedPayload {
        reason: reason.into(),
        related_docs,
        suggested_next_commands,
    }
}
