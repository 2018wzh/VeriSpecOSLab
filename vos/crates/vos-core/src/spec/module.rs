use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
