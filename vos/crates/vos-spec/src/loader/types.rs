use serde::Deserialize;
use std::path::PathBuf;
use vos_core::{
    ArchitectureReferenceSystem, OperationDependsOn, OperationTestObligations, ValidationBinding,
};

#[derive(Debug, Deserialize)]
pub(crate) struct ArchitectureSeedYaml {
    pub(crate) id: String,
    pub(crate) project: String,
    pub(crate) domain: String,
    pub(crate) target_platform: String,
    pub(crate) architecture_name: String,
    pub(crate) architecture_summary: String,
    #[serde(default)]
    pub(crate) reference_systems: Vec<ArchitectureReferenceSystem>,
    #[serde(default)]
    pub(crate) goals: Vec<String>,
    #[serde(default)]
    pub(crate) non_goals: Vec<String>,
    #[serde(default)]
    pub(crate) constraints: Vec<String>,
    #[serde(default)]
    pub(crate) initial_validation_binding: StringListOrBinding,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ArchitectureSliceYaml {
    pub(crate) id: String,
    pub(crate) stage: String,
    pub(crate) title: String,
    pub(crate) summary: String,
    #[serde(default)]
    pub(crate) depends_on_slices: Vec<String>,
    #[serde(default)]
    pub(crate) depends_on_adrs: Vec<String>,
    #[serde(default)]
    pub(crate) mechanisms: Vec<String>,
    #[serde(default)]
    pub(crate) affected_modules: Vec<String>,
    #[serde(default)]
    pub(crate) new_operations: Vec<String>,
    #[serde(default)]
    pub(crate) removed_or_replaced_mechanisms: Vec<String>,
    #[serde(default)]
    pub(crate) invariants: Vec<String>,
    #[serde(default)]
    pub(crate) security_boundaries: Vec<String>,
    #[serde(default)]
    pub(crate) concurrency_highlights: Vec<String>,
    #[serde(default)]
    pub(crate) validation_binding: StringListOrBinding,
    #[serde(default)]
    pub(crate) open_questions: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CompositionYaml {
    #[serde(default)]
    pub(crate) cross_component_rules: Vec<CompositionRuleYaml>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CompositionRuleYaml {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) affected_modules: Vec<String>,
    #[serde(default)]
    pub(crate) related_slices: Vec<String>,
    #[serde(default)]
    pub(crate) invariant: StringListOrScalar,
    #[serde(default)]
    pub(crate) authority_boundary: StringListOrScalar,
    #[serde(default)]
    pub(crate) concurrency_boundary: StringListOrScalar,
    #[serde(default)]
    pub(crate) failure_boundary: StringListOrScalar,
    #[serde(default)]
    pub(crate) validation_intent: StringListOrTests,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ModuleYaml {
    pub(crate) id: String,
    pub(crate) module: String,
    pub(crate) stage: String,
    pub(crate) purpose: String,
    #[serde(default)]
    pub(crate) related_slices: Vec<String>,
    #[serde(default)]
    pub(crate) related_adrs: Vec<String>,
    #[serde(default)]
    pub(crate) owned_state: Vec<String>,
    #[serde(default)]
    pub(crate) exported_interfaces: Vec<String>,
    #[serde(default)]
    pub(crate) imported_interfaces: Vec<String>,
    #[serde(default)]
    pub(crate) module_invariants: Vec<String>,
    #[serde(default)]
    pub(crate) error_model: Vec<String>,
    #[serde(default)]
    pub(crate) resource_lifetime_rules: Vec<String>,
    #[serde(default)]
    pub(crate) security_boundary: Vec<String>,
    #[serde(default)]
    pub(crate) test_surfaces: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ConcurrencyYaml {
    pub(crate) module: String,
    #[serde(default)]
    pub(crate) shared_state: Vec<String>,
    #[serde(default)]
    pub(crate) lock_types: Vec<String>,
    #[serde(default)]
    pub(crate) lock_order: Vec<String>,
    #[serde(default)]
    pub(crate) atomic_sections: Vec<String>,
    #[serde(default)]
    pub(crate) interrupt_rules: Vec<String>,
    #[serde(default)]
    pub(crate) wait_wakeup_rules: Vec<String>,
    #[serde(default)]
    pub(crate) rely: serde_yaml::Value,
    #[serde(default)]
    pub(crate) guarantee: serde_yaml::Value,
    #[serde(default)]
    pub(crate) forbidden_patterns: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OperationYaml {
    pub(crate) id: String,
    pub(crate) stage: String,
    pub(crate) module: String,
    pub(crate) operation: String,
    pub(crate) purpose: String,
    pub(crate) related_slice: Option<String>,
    pub(crate) related_adr: Option<String>,
    #[serde(default)]
    pub(crate) depends_on: OperationDependsOn,
    #[serde(default)]
    pub(crate) rely: serde_yaml::Value,
    #[serde(default)]
    pub(crate) guarantee: serde_yaml::Value,
    #[serde(default)]
    pub(crate) preconditions: Vec<String>,
    #[serde(default)]
    pub(crate) postconditions: Vec<String>,
    #[serde(default)]
    pub(crate) invariants_preserved: Vec<String>,
    #[serde(default)]
    pub(crate) failure_semantics: serde_yaml::Value,
    #[serde(default)]
    pub(crate) concurrency: serde_yaml::Value,
    #[serde(default)]
    pub(crate) security: serde_yaml::Value,
    #[serde(default)]
    pub(crate) observability: serde_yaml::Value,
    #[serde(default)]
    pub(crate) test_obligations: OperationTestObligations,
    pub(crate) llm_codegen: vos_core::LlmCodegenConstraints,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ToolchainYaml {
    pub(crate) toolchain: ToolchainProfileYaml,
    pub(crate) environment: EnvironmentYaml,
    pub(crate) build: BuildYaml,
    pub(crate) link: LinkYaml,
    pub(crate) image: ImageYaml,
    pub(crate) run: RunYaml,
    pub(crate) debug: DebugYaml,
    pub(crate) validation: ValidationYaml,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ToolchainProfileYaml {
    pub(crate) target_arch: String,
    pub(crate) target_triple: String,
    pub(crate) c_compiler: String,
    pub(crate) asm_compiler: String,
    pub(crate) linker: String,
    pub(crate) archiver: String,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct EnvironmentYaml {
    #[serde(default)]
    pub(crate) required_tools: Vec<String>,
    #[serde(default)]
    pub(crate) allowed_versions: Vec<String>,
    #[serde(default)]
    pub(crate) disallowed_tools: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct BuildYaml {
    #[serde(default)]
    pub(crate) sources: Vec<PathBuf>,
    #[serde(default)]
    pub(crate) include_paths: Vec<PathBuf>,
    #[serde(default)]
    pub(crate) cflags: Vec<String>,
    #[serde(default)]
    pub(crate) asmflags: Vec<String>,
    #[serde(default)]
    pub(crate) ldflags: Vec<String>,
    #[serde(default)]
    pub(crate) features: Vec<String>,
    #[serde(default)]
    pub(crate) forbidden_flags: Vec<String>,
    #[serde(default)]
    pub(crate) generated_artifacts: Vec<PathBuf>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LinkYaml {
    pub(crate) linker_script: PathBuf,
    pub(crate) entry_symbol: String,
    #[serde(default)]
    pub(crate) section_rules: Vec<String>,
    pub(crate) relocation_model: Option<String>,
    #[serde(default)]
    pub(crate) abi_constraints: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ImageYaml {
    pub(crate) output_kind: String,
    #[serde(default)]
    pub(crate) objcopy_rules: Vec<String>,
    #[serde(default)]
    pub(crate) boot_chain: Vec<String>,
    #[serde(default)]
    pub(crate) required_artifacts: Vec<PathBuf>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RunYaml {
    pub(crate) emulator: String,
    pub(crate) machine: String,
    pub(crate) cpu: String,
    pub(crate) memory: String,
    pub(crate) bios: Option<String>,
    pub(crate) kernel_arg: String,
    #[serde(default)]
    pub(crate) extra_args: Vec<String>,
    pub(crate) success_signal: String,
    pub(crate) timeout_secs: u64,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct DebugYaml {
    #[serde(default)]
    pub(crate) symbols_required: Vec<String>,
    pub(crate) gdb_script: Option<PathBuf>,
    #[serde(default)]
    pub(crate) trace_points: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ValidationYaml {
    #[serde(default)]
    pub(crate) must_pass: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(untagged)]
pub(crate) enum StringListOrScalar {
    #[default]
    None,
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Deserialize, Default)]
#[serde(untagged)]
pub(crate) enum StringListOrBinding {
    #[default]
    None,
    Many(Vec<String>),
    Binding(ValidationBindingYaml),
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct ValidationBindingYaml {
    #[serde(default)]
    pub(crate) must_pass: Vec<String>,
    #[serde(default)]
    pub(crate) generated: Vec<String>,
    #[serde(default)]
    pub(crate) hidden_tags: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(untagged)]
pub(crate) enum StringListOrTests {
    #[default]
    None,
    Many(Vec<String>),
    Named(TestsYaml),
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct TestsYaml {
    #[serde(default)]
    pub(crate) tests: Vec<String>,
}

pub(crate) fn into_validation_binding(value: StringListOrBinding) -> ValidationBinding {
    match value {
        StringListOrBinding::None => ValidationBinding::default(),
        StringListOrBinding::Many(must_pass) => ValidationBinding {
            must_pass,
            generated: Vec::new(),
            hidden_tags: Vec::new(),
        },
        StringListOrBinding::Binding(binding) => ValidationBinding {
            must_pass: binding.must_pass,
            generated: binding.generated,
            hidden_tags: binding.hidden_tags,
        },
    }
}

pub(crate) fn into_string_vec(value: StringListOrScalar) -> Vec<String> {
    match value {
        StringListOrScalar::None => Vec::new(),
        StringListOrScalar::One(item) => vec![item],
        StringListOrScalar::Many(items) => items,
    }
}

pub(crate) fn into_tests_vec(value: StringListOrTests) -> Vec<String> {
    match value {
        StringListOrTests::None => Vec::new(),
        StringListOrTests::Many(items) => items,
        StringListOrTests::Named(named) => named.tests,
    }
}
