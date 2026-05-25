use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use vos_core::{BuildResult, QemuRunResult, SpecRef, ToolchainManifest};

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolchainCodegenResponse {
    pub artifact_format: String,
    #[serde(default)]
    pub files: Vec<ToolchainFileRecord>,
    pub command_program: String,
    #[serde(default)]
    pub command_args: Vec<String>,
    pub entry_target: String,
    #[serde(default)]
    pub phases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolchainFileRecord {
    pub path: PathBuf,
    pub content: String,
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
pub struct GenerationRunResult {
    pub run_id: String,
    pub target_kind: String,
    pub target_value: String,
    pub selected_stage: String,
    #[serde(default)]
    pub selected_modules: Vec<String>,
    #[serde(default)]
    pub generated_waves: Vec<Vec<String>>,
    #[serde(default)]
    pub skeleton_files: Vec<PathBuf>,
    #[serde(default)]
    pub updated_regions: Vec<PathBuf>,
    pub applied: bool,
    pub build: Option<BuildResult>,
    pub run: Option<QemuRunResult>,
    pub manifest_path: PathBuf,
    #[serde(default)]
    pub toolchain_files: Vec<PathBuf>,
    pub toolchain_manifest_path: Option<PathBuf>,
    pub toolchain_manifest: Option<ToolchainManifest>,
    pub skeleton_validation_path: Option<PathBuf>,
    pub retry_record_path: Option<PathBuf>,
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
    pub skeleton_validation_path: Option<PathBuf>,
    pub retry_record_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkeletonValidationReport {
    pub ok: bool,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkeletonRetryRecord {
    pub attempts: u32,
    pub max_attempts: u32,
    pub exit_reason: String,
    #[serde(default)]
    pub feedback: Vec<String>,
}
