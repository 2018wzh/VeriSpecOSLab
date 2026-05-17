use serde::{Deserialize, Serialize};

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
pub struct ArchitectureSpecBundle {
    pub seed: ArchitectureSeed,
    #[serde(default)]
    pub slices: Vec<ArchitectureSlice>,
    pub composition: ArchitectureCompositionSpec,
    pub toolchain: crate::spec::toolchain::ToolchainSpecBundle,
}
