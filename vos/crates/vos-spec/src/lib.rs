use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use vos_core::{
    ArchitectureComposeResult, ArchitectureCompositionSpec, ArchitectureLintResult,
    ArchitecturePlanBundle, ArchitectureReferenceSystem, ArchitectureSeed, ArchitectureSlice,
    ArchitectureSpecBundle, BuildContract, BuildPhase, CompositionRule, ConcurrencySpec,
    ConsistencyReport, DerivedTestMatrix, EnvironmentContract, GenerationQueue, ImageContract,
    LinkContract, ModuleGenerationJob, ModuleSpec, NormalizedSpecBundle, OperationContract,
    OperationDependsOn, OperationTestObligations, Result, RunContract, SpecBundle, SpecRef,
    StageDescriptor, ToolchainProfile, ToolchainSpecBundle, ValidationBinding, ValidationContract,
    VerificationStagePlan, VosError,
};

#[derive(Debug, Deserialize)]
struct ArchitectureSeedYaml {
    id: String,
    project: String,
    domain: String,
    target_platform: String,
    architecture_name: String,
    architecture_summary: String,
    #[serde(default)]
    reference_systems: Vec<ArchitectureReferenceSystem>,
    #[serde(default)]
    goals: Vec<String>,
    #[serde(default)]
    non_goals: Vec<String>,
    #[serde(default)]
    constraints: Vec<String>,
    #[serde(default)]
    initial_validation_binding: StringListOrBinding,
}

#[derive(Debug, Deserialize)]
struct ArchitectureSliceYaml {
    id: String,
    stage: String,
    title: String,
    summary: String,
    #[serde(default)]
    depends_on_slices: Vec<String>,
    #[serde(default)]
    depends_on_adrs: Vec<String>,
    #[serde(default)]
    mechanisms: Vec<String>,
    #[serde(default)]
    affected_modules: Vec<String>,
    #[serde(default)]
    new_operations: Vec<String>,
    #[serde(default)]
    removed_or_replaced_mechanisms: Vec<String>,
    #[serde(default)]
    invariants: Vec<String>,
    #[serde(default)]
    security_boundaries: Vec<String>,
    #[serde(default)]
    concurrency_highlights: Vec<String>,
    #[serde(default)]
    validation_binding: StringListOrBinding,
    #[serde(default)]
    open_questions: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CompositionYaml {
    #[serde(default)]
    cross_component_rules: Vec<CompositionRuleYaml>,
}

#[derive(Debug, Deserialize)]
struct CompositionRuleYaml {
    name: String,
    description: Option<String>,
    #[serde(default)]
    affected_modules: Vec<String>,
    #[serde(default)]
    related_slices: Vec<String>,
    #[serde(default)]
    invariant: StringListOrScalar,
    #[serde(default)]
    authority_boundary: StringListOrScalar,
    #[serde(default)]
    concurrency_boundary: StringListOrScalar,
    #[serde(default)]
    failure_boundary: StringListOrScalar,
    #[serde(default)]
    validation_intent: StringListOrTests,
}

#[derive(Debug, Deserialize)]
struct ModuleYaml {
    id: String,
    module: String,
    stage: String,
    purpose: String,
    #[serde(default)]
    related_slices: Vec<String>,
    #[serde(default)]
    related_adrs: Vec<String>,
    #[serde(default)]
    owned_state: Vec<String>,
    #[serde(default)]
    exported_interfaces: Vec<String>,
    #[serde(default)]
    imported_interfaces: Vec<String>,
    #[serde(default)]
    module_invariants: Vec<String>,
    #[serde(default)]
    error_model: Vec<String>,
    #[serde(default)]
    resource_lifetime_rules: Vec<String>,
    #[serde(default)]
    security_boundary: Vec<String>,
    #[serde(default)]
    test_surfaces: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ConcurrencyYaml {
    module: String,
    #[serde(default)]
    shared_state: Vec<String>,
    #[serde(default)]
    lock_types: Vec<String>,
    #[serde(default)]
    lock_order: Vec<String>,
    #[serde(default)]
    atomic_sections: Vec<String>,
    #[serde(default)]
    interrupt_rules: Vec<String>,
    #[serde(default)]
    wait_wakeup_rules: Vec<String>,
    #[serde(default)]
    rely: serde_yaml::Value,
    #[serde(default)]
    guarantee: serde_yaml::Value,
    #[serde(default)]
    forbidden_patterns: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct OperationYaml {
    id: String,
    stage: String,
    module: String,
    operation: String,
    purpose: String,
    related_slice: Option<String>,
    related_adr: Option<String>,
    #[serde(default)]
    depends_on: OperationDependsOn,
    #[serde(default)]
    rely: serde_yaml::Value,
    #[serde(default)]
    guarantee: serde_yaml::Value,
    #[serde(default)]
    preconditions: Vec<String>,
    #[serde(default)]
    postconditions: Vec<String>,
    #[serde(default)]
    invariants_preserved: Vec<String>,
    #[serde(default)]
    failure_semantics: serde_yaml::Value,
    #[serde(default)]
    concurrency: serde_yaml::Value,
    #[serde(default)]
    security: serde_yaml::Value,
    #[serde(default)]
    observability: serde_yaml::Value,
    #[serde(default)]
    test_obligations: OperationTestObligations,
    llm_codegen: vos_core::LlmCodegenConstraints,
}

#[derive(Debug, Deserialize)]
struct ToolchainYaml {
    toolchain: ToolchainProfileYaml,
    environment: EnvironmentYaml,
    build: BuildYaml,
    link: LinkYaml,
    image: ImageYaml,
    run: RunYaml,
    debug: DebugYaml,
    validation: ValidationYaml,
}

#[derive(Debug, Deserialize)]
struct ToolchainProfileYaml {
    target_arch: String,
    target_triple: String,
    c_compiler: String,
    asm_compiler: String,
    linker: String,
    archiver: String,
}

#[derive(Debug, Default, Deserialize)]
struct EnvironmentYaml {
    #[serde(default)]
    required_tools: Vec<String>,
    #[serde(default)]
    allowed_versions: Vec<String>,
    #[serde(default)]
    disallowed_tools: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct BuildYaml {
    #[serde(default)]
    sources: Vec<PathBuf>,
    #[serde(default)]
    include_paths: Vec<PathBuf>,
    #[serde(default)]
    cflags: Vec<String>,
    #[serde(default)]
    asmflags: Vec<String>,
    #[serde(default)]
    ldflags: Vec<String>,
    #[serde(default)]
    features: Vec<String>,
    #[serde(default)]
    forbidden_flags: Vec<String>,
    #[serde(default)]
    generated_artifacts: Vec<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct LinkYaml {
    linker_script: PathBuf,
    entry_symbol: String,
    #[serde(default)]
    section_rules: Vec<String>,
    relocation_model: Option<String>,
    #[serde(default)]
    abi_constraints: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct ImageYaml {
    output_kind: String,
    #[serde(default)]
    objcopy_rules: Vec<String>,
    #[serde(default)]
    boot_chain: Vec<String>,
    #[serde(default)]
    required_artifacts: Vec<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct RunYaml {
    emulator: String,
    machine: String,
    cpu: String,
    memory: String,
    bios: Option<String>,
    kernel_arg: String,
    #[serde(default)]
    extra_args: Vec<String>,
    success_signal: String,
    timeout_secs: u64,
}

#[derive(Debug, Default, Deserialize)]
struct DebugYaml {
    #[serde(default)]
    symbols_required: Vec<String>,
    gdb_script: Option<PathBuf>,
    #[serde(default)]
    trace_points: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct ValidationYaml {
    #[serde(default)]
    must_pass: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(untagged)]
enum StringListOrScalar {
    #[default]
    None,
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Deserialize, Default)]
#[serde(untagged)]
enum StringListOrBinding {
    #[default]
    None,
    Many(Vec<String>),
    Binding(ValidationBindingYaml),
}

#[derive(Debug, Deserialize, Default)]
struct ValidationBindingYaml {
    #[serde(default)]
    must_pass: Vec<String>,
    #[serde(default)]
    generated: Vec<String>,
    #[serde(default)]
    hidden_tags: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(untagged)]
enum StringListOrTests {
    #[default]
    None,
    Many(Vec<String>),
    Named(TestsYaml),
}

#[derive(Debug, Deserialize, Default)]
struct TestsYaml {
    #[serde(default)]
    tests: Vec<String>,
}

pub fn load_spec_bundle(
    project_root: &Path,
    spec_root: &Path,
    module: &str,
    operation: &str,
) -> Result<SpecBundle> {
    let modules = load_module_specs(project_root, spec_root)?;
    let operations = load_operation_specs(project_root, spec_root)?;
    let module_spec = modules
        .into_iter()
        .find(|item| item.module == module)
        .ok_or_else(|| VosError::Message(format!("module spec not found: {module}")))?;
    let operation_contract = operations
        .into_iter()
        .find(|item| item.module == module && item.operation == operation)
        .ok_or_else(|| VosError::Message(format!("operation spec not found: {module}.{operation}")))?;
    let concurrency_spec = load_concurrency_spec(project_root, spec_root, module)?;
    Ok(SpecBundle {
        target_paths: vec![operation_contract.llm_codegen.editable_region.file.clone()],
        build_hints: operation_contract.llm_codegen.required_followup_checks.clone(),
        module_spec,
        operation_contract,
        concurrency_spec,
    })
}

pub fn load_module_specs(project_root: &Path, spec_root: &Path) -> Result<Vec<ModuleSpec>> {
    let modules_root = project_root.join(spec_root).join("modules");
    if !modules_root.exists() {
        return Err(VosError::Message(format!(
            "modules directory not found: {}",
            modules_root.display()
        )));
    }
    let mut specs = Vec::new();
    for module_dir in read_dir_paths(&modules_root)? {
        if !module_dir.is_dir() {
            continue;
        }
        let path = module_dir.join("module.yaml");
        if !path.exists() {
            continue;
        }
        let parsed: ModuleYaml = serde_yaml::from_str(&fs::read_to_string(path)?)?;
        specs.push(ModuleSpec {
            id: parsed.id,
            module: parsed.module,
            stage: parsed.stage,
            purpose: parsed.purpose,
            related_slices: parsed.related_slices,
            related_adrs: parsed.related_adrs,
            owned_state: parsed.owned_state,
            exported_interfaces: parsed.exported_interfaces,
            imported_interfaces: parsed.imported_interfaces,
            module_invariants: parsed.module_invariants,
            error_model: parsed.error_model,
            resource_lifetime_rules: parsed.resource_lifetime_rules,
            security_boundary: parsed.security_boundary,
            test_surfaces: parsed.test_surfaces,
        });
    }
    specs.sort_by(|a, b| a.module.cmp(&b.module));
    Ok(specs)
}

pub fn load_operation_specs(project_root: &Path, spec_root: &Path) -> Result<Vec<OperationContract>> {
    let modules_root = project_root.join(spec_root).join("modules");
    let mut specs = Vec::new();
    for module_dir in read_dir_paths(&modules_root)? {
        if !module_dir.is_dir() {
            continue;
        }
        let ops_dir = module_dir.join("ops");
        for path in read_yaml_files(&ops_dir)? {
            let parsed: OperationYaml = serde_yaml::from_str(&fs::read_to_string(path)?)?;
            if parsed.llm_codegen.editable_region.start_marker.trim().is_empty()
                || parsed.llm_codegen.editable_region.end_marker.trim().is_empty()
            {
                return Err(VosError::Message(format!(
                    "editable region markers must not be empty for {}.{}",
                    parsed.module, parsed.operation
                )));
            }
            specs.push(OperationContract {
                id: parsed.id,
                stage: parsed.stage,
                module: parsed.module,
                operation: parsed.operation,
                purpose: parsed.purpose,
                related_slice: parsed.related_slice,
                related_adr: parsed.related_adr,
                depends_on: parsed.depends_on,
                rely: parsed.rely,
                guarantee: parsed.guarantee,
                preconditions: parsed.preconditions,
                postconditions: parsed.postconditions,
                invariants_preserved: parsed.invariants_preserved,
                failure_semantics: parsed.failure_semantics,
                concurrency: parsed.concurrency,
                security: parsed.security,
                observability: parsed.observability,
                test_obligations: parsed.test_obligations,
                llm_codegen: parsed.llm_codegen,
            });
        }
    }
    specs.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(specs)
}

pub fn load_concurrency_spec(
    project_root: &Path,
    spec_root: &Path,
    module: &str,
) -> Result<Option<ConcurrencySpec>> {
    let path = project_root
        .join(spec_root)
        .join("modules")
        .join(module)
        .join("concurrency.yaml");
    if !path.exists() {
        return Ok(None);
    }
    let parsed: ConcurrencyYaml = serde_yaml::from_str(&fs::read_to_string(path)?)?;
    Ok(Some(ConcurrencySpec {
        module: parsed.module,
        shared_state: parsed.shared_state,
        lock_types: parsed.lock_types,
        lock_order: parsed.lock_order,
        atomic_sections: parsed.atomic_sections,
        interrupt_rules: parsed.interrupt_rules,
        wait_wakeup_rules: parsed.wait_wakeup_rules,
        rely: parsed.rely,
        guarantee: parsed.guarantee,
        forbidden_patterns: parsed.forbidden_patterns,
    }))
}

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
        run: RunContract {
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
        debug: vos_core::DebugContract {
            symbols_required: parsed.debug.symbols_required,
            gdb_script: parsed.debug.gdb_script,
            trace_points: parsed.debug.trace_points,
        },
        validation: ValidationContract {
            must_pass: parsed.validation.must_pass,
        },
    })
}

pub fn load_architecture_bundle(project_root: &Path, spec_root: &Path) -> Result<ArchitectureSpecBundle> {
    let architecture_root = project_root.join(spec_root).join("architecture");
    let seed: ArchitectureSeedYaml =
        serde_yaml::from_str(&fs::read_to_string(architecture_root.join("seed.yaml"))?)?;
    let mut slice_paths = read_yaml_files(&architecture_root.join("slices"))?;
    slice_paths.sort();
    let mut slices = Vec::new();
    for path in slice_paths {
        let parsed: ArchitectureSliceYaml = serde_yaml::from_str(&fs::read_to_string(path)?)?;
        slices.push(ArchitectureSlice {
            id: parsed.id,
            stage: parsed.stage,
            title: parsed.title,
            summary: parsed.summary,
            depends_on_slices: parsed.depends_on_slices,
            depends_on_adrs: parsed.depends_on_adrs,
            mechanisms: parsed.mechanisms,
            affected_modules: parsed.affected_modules,
            new_operations: parsed.new_operations,
            removed_or_replaced_mechanisms: parsed.removed_or_replaced_mechanisms,
            invariants: parsed.invariants,
            security_boundaries: parsed.security_boundaries,
            concurrency_highlights: parsed.concurrency_highlights,
            validation_binding: into_validation_binding(parsed.validation_binding),
            open_questions: parsed.open_questions,
        });
    }
    let composition_yaml: CompositionYaml = serde_yaml::from_str(&fs::read_to_string(
        architecture_root.join("composition.yaml"),
    )?)?;
    let composition = ArchitectureCompositionSpec {
        cross_component_rules: composition_yaml
            .cross_component_rules
            .into_iter()
            .map(|rule| CompositionRule {
                name: rule.name,
                description: rule.description,
                affected_modules: rule.affected_modules,
                related_slices: rule.related_slices,
                invariant: into_string_vec(rule.invariant),
                authority_boundary: into_string_vec(rule.authority_boundary),
                concurrency_boundary: into_string_vec(rule.concurrency_boundary),
                failure_boundary: into_string_vec(rule.failure_boundary),
                validation_intent: into_tests_vec(rule.validation_intent),
            })
            .collect(),
    };
    Ok(ArchitectureSpecBundle {
        seed: ArchitectureSeed {
            id: seed.id,
            project: seed.project,
            domain: seed.domain,
            target_platform: seed.target_platform,
            architecture_name: seed.architecture_name,
            architecture_summary: seed.architecture_summary,
            reference_systems: seed.reference_systems,
            goals: seed.goals,
            non_goals: seed.non_goals,
            constraints: seed.constraints,
            initial_validation_binding: into_validation_binding(seed.initial_validation_binding)
                .must_pass,
        },
        slices,
        composition,
        toolchain: load_toolchain_spec(project_root, spec_root)?,
    })
}

pub fn load_normalized_spec_bundle(project_root: &Path, spec_root: &Path) -> Result<NormalizedSpecBundle> {
    let architecture = load_architecture_bundle(project_root, spec_root)?;
    let modules = load_module_specs(project_root, spec_root)?;
    let operations = load_operation_specs(project_root, spec_root)?;
    let mut hashes = BTreeMap::new();
    for path in collect_spec_files(project_root, spec_root)? {
        let content = fs::read_to_string(&path)?;
        hashes.insert(path.display().to_string(), stable_hash(&content));
    }
    Ok(NormalizedSpecBundle {
        modules,
        operations,
        architecture: architecture.clone(),
        toolchain_profiles: vec![architecture.toolchain],
        hashes,
        visibility: "public".into(),
    })
}

pub fn lint_architecture(project_root: &Path, spec_root: &Path) -> Result<ArchitectureLintResult> {
    let bundle = load_architecture_bundle(project_root, spec_root)?;
    Ok(ArchitectureLintResult {
        ok: true,
        target_platform: bundle.seed.target_platform,
        current_stage: bundle.slices.last().map(|slice| slice.stage.clone()),
        declared_stages: bundle.slices.iter().map(|slice| slice.stage.clone()).collect(),
        enabled_modules: unique_strings(
            &bundle
                .slices
                .iter()
                .flat_map(|slice| slice.affected_modules.clone())
                .collect::<Vec<_>>(),
        ),
    })
}

pub fn check_consistency(
    project_root: &Path,
    spec_root: &Path,
    normalized: &NormalizedSpecBundle,
) -> Result<ConsistencyReport> {
    let mut errors = Vec::new();
    let warnings = Vec::new();

    let module_names: HashSet<String> = normalized.modules.iter().map(|m| m.module.clone()).collect();
    let op_names: HashSet<String> = normalized
        .operations
        .iter()
        .map(|op| format!("{}.{}", op.module, op.operation))
        .collect();
    let slice_ids: HashSet<String> = normalized
        .architecture
        .slices
        .iter()
        .map(|slice| slice.id.clone())
        .collect();

    for slice in &normalized.architecture.slices {
        for module in &slice.affected_modules {
            if !module_names.contains(module) {
                errors.push(format!(
                    "slice `{}` references missing module `{module}`",
                    slice.id
                ));
            }
        }
        for operation in &slice.new_operations {
            if !op_names.contains(operation) {
                errors.push(format!(
                    "slice `{}` references missing operation `{operation}`",
                    slice.id
                ));
            }
        }
        for dep in &slice.depends_on_slices {
            if !slice_ids.contains(dep) {
                errors.push(format!(
                    "slice `{}` depends on missing slice `{dep}`",
                    slice.id
                ));
            }
        }
    }

    if let Err(err) = validate_slice_dependency_graph(&normalized.architecture.slices) {
        errors.push(err.to_string());
    }

    for rule in &normalized.architecture.composition.cross_component_rules {
        for module in &rule.affected_modules {
            if !module_names.contains(module) {
                errors.push(format!(
                    "composition rule `{}` references missing module `{module}`",
                    rule.name
                ));
            }
        }
        for slice in &rule.related_slices {
            if !slice_ids.contains(slice) {
                errors.push(format!(
                    "composition rule `{}` references missing slice `{slice}`",
                    rule.name
                ));
            }
        }
    }

    for operation in &normalized.operations {
        let file = project_root.join(spec_root).join(&operation.llm_codegen.editable_region.file);
        if !file.starts_with(project_root) {
            errors.push(format!(
                "operation `{}` editable region escapes project root: {}",
                operation.id,
                operation.llm_codegen.editable_region.file.display()
            ));
        }
    }

    let toolchain = &normalized.architecture.toolchain;
    if toolchain.build.generated_artifacts.is_empty() {
        errors.push("toolchain build.generated_artifacts must not be empty".into());
    }
    if toolchain.image.required_artifacts.is_empty() {
        errors.push("toolchain image.required_artifacts must not be empty".into());
    }
    if !toolchain
        .image
        .required_artifacts
        .iter()
        .all(|artifact| toolchain.build.generated_artifacts.contains(artifact))
    {
        errors.push(
            "toolchain image.required_artifacts must be produced by build.generated_artifacts".into(),
        );
    }
    if toolchain.run.kernel_arg.trim().is_empty() {
        errors.push("toolchain run.kernel_arg must not be empty".into());
    }

    Ok(ConsistencyReport {
        ok: errors.is_empty(),
        errors,
        warnings,
        checked_paths: collect_spec_files(project_root, spec_root)?
            .into_iter()
            .map(|path| path.display().to_string())
            .collect(),
    })
}

pub fn plan_architecture(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<ArchitecturePlanBundle> {
    let normalized = load_normalized_spec_bundle(project_root, spec_root)?;
    let slices = slices_until_stage(&normalized.architecture.slices, target_stage)?;
    let enabled_modules = unique_strings(
        &slices
            .iter()
            .flat_map(|slice| slice.affected_modules.clone())
            .collect::<Vec<_>>(),
    );
    let required_operations = normalized
        .operations
        .iter()
        .filter(|op| enabled_modules.contains(&op.module))
        .map(|op| SpecRef {
            module: op.module.clone(),
            operation: op.operation.clone(),
        })
        .collect::<Vec<_>>();
    let skeleton_features = unique_strings(
        &slices
            .iter()
            .flat_map(|slice| slice.mechanisms.clone().into_iter().chain(slice.invariants.clone()))
            .collect::<Vec<_>>(),
    );
    let verification_bindings = unique_strings(
        &slices
            .iter()
            .flat_map(|slice| slice.validation_binding.must_pass.clone())
            .chain(
                normalized
                    .architecture
                    .composition
                    .cross_component_rules
                    .iter()
                    .flat_map(|rule| rule.validation_intent.clone()),
            )
            .collect::<Vec<_>>(),
    );
    let generation_order = slices
        .iter()
        .enumerate()
        .map(|(index, slice)| StageDescriptor {
            stage: slice.stage.clone(),
            stage_index: index,
            modules: slice.affected_modules.clone(),
            required_stages: slice.depends_on_slices.clone(),
        })
        .collect();

    Ok(ArchitecturePlanBundle {
        target_platform: normalized.architecture.seed.target_platform,
        current_stage: target_stage.to_string(),
        enabled_modules,
        required_operations,
        skeleton_features,
        generation_order,
        verification_bindings,
    })
}

pub fn compose_architecture(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<ArchitectureComposeResult> {
    let normalized = load_normalized_spec_bundle(project_root, spec_root)?;
    let slices = slices_until_stage(&normalized.architecture.slices, target_stage)?;
    let enabled_modules = unique_strings(
        &slices
            .iter()
            .flat_map(|slice| slice.affected_modules.clone())
            .collect::<Vec<_>>(),
    );
    let mut module_dependency_dag = BTreeMap::new();
    for module in &enabled_modules {
        module_dependency_dag.insert(
            module.clone(),
            module_dependencies(&normalized.operations, module),
        );
    }
    Ok(ArchitectureComposeResult {
        current_stage: target_stage.to_string(),
        enabled_modules,
        module_dependency_dag,
        skeleton_features: unique_strings(
            &slices
                .iter()
                .flat_map(|slice| slice.mechanisms.clone().into_iter().chain(slice.invariants.clone()))
                .collect::<Vec<_>>(),
        ),
        verification_bindings: unique_strings(
            &slices
                .iter()
                .flat_map(|slice| slice.validation_binding.must_pass.clone())
                .collect::<Vec<_>>(),
        ),
    })
}

pub fn derive_tests(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<DerivedTestMatrix> {
    let normalized = load_normalized_spec_bundle(project_root, spec_root)?;
    let compose = compose_architecture(project_root, spec_root, target_stage)?;
    let operations = normalized
        .operations
        .iter()
        .filter(|op| compose.enabled_modules.contains(&op.module))
        .collect::<Vec<_>>();
    let public_checks = unique_strings(
        &operations
            .iter()
            .flat_map(|op| op.test_obligations.public.clone())
            .chain(normalized.architecture.toolchain.validation.must_pass.clone())
            .collect::<Vec<_>>(),
    );
    let generated_checks = unique_strings(
        &operations
            .iter()
            .flat_map(|op| op.test_obligations.generated.clone())
            .collect::<Vec<_>>(),
    );
    Ok(DerivedTestMatrix {
        stage: target_stage.to_string(),
        public_checks,
        generated_checks,
        build_checks: vec!["build_kernel".into()],
        run_checks: vec!["qemu_boot_smoke".into()],
    })
}

pub fn build_generation_queue(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<GenerationQueue> {
    let normalized = load_normalized_spec_bundle(project_root, spec_root)?;
    let compose = compose_architecture(project_root, spec_root, target_stage)?;
    let module_map: HashMap<String, ModuleSpec> = normalized
        .modules
        .iter()
        .map(|module| (module.module.clone(), module.clone()))
        .collect();
    let mut jobs = Vec::new();
    let mut blocked_by = BTreeMap::new();
    for module in &compose.enabled_modules {
        let spec = module_map
            .get(module)
            .ok_or_else(|| VosError::Message(format!("module not found in normalized bundle: {module}")))?;
        let operations = normalized
            .operations
            .iter()
            .filter(|op| op.module == *module)
            .map(|op| op.operation.clone())
            .collect::<Vec<_>>();
        let editable_targets = normalized
            .operations
            .iter()
            .filter(|op| op.module == *module)
            .map(|op| op.llm_codegen.editable_region.file.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let deps = module_dependencies(&normalized.operations, module);
        blocked_by.insert(module.clone(), deps.clone());
        jobs.push(ModuleGenerationJob {
            module: module.clone(),
            stage: spec.stage.clone(),
            operations,
            editable_targets,
            depends_on_modules: deps,
        });
    }
    let waves = build_module_waves(&jobs)?;
    Ok(GenerationQueue {
        stage: target_stage.to_string(),
        skeleton_features: compose.skeleton_features,
        jobs,
        waves,
        blocked_by,
    })
}

pub fn build_verification_plan(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<VerificationStagePlan> {
    let toolchain = load_toolchain_spec(project_root, spec_root)?;
    let derived = derive_tests(project_root, spec_root, target_stage)?;
    let build_command = derive_build_command(&toolchain, project_root);
    let artifact_root = toolchain
        .build
        .generated_artifacts
        .first()
        .and_then(|path| path.parent().map(|parent| project_root.join(parent)))
        .unwrap_or_else(|| project_root.to_path_buf());
    Ok(VerificationStagePlan {
        stage: target_stage.to_string(),
        required_checks: unique_strings(
            &[derived.public_checks.clone(), toolchain.validation.must_pass.clone()].concat(),
        ),
        build_phases: vec![BuildPhase {
            name: "kernel".into(),
            command: build_command,
            cwd: artifact_root,
            generated_artifacts: toolchain.build.generated_artifacts.clone(),
        }],
        user_artifacts: Vec::new(),
        runnable: true,
    })
}

fn into_validation_binding(value: StringListOrBinding) -> ValidationBinding {
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

fn into_string_vec(value: StringListOrScalar) -> Vec<String> {
    match value {
        StringListOrScalar::None => Vec::new(),
        StringListOrScalar::One(item) => vec![item],
        StringListOrScalar::Many(items) => items,
    }
}

fn into_tests_vec(value: StringListOrTests) -> Vec<String> {
    match value {
        StringListOrTests::None => Vec::new(),
        StringListOrTests::Many(items) => items,
        StringListOrTests::Named(named) => named.tests,
    }
}

fn derive_build_command(toolchain: &ToolchainSpecBundle, project_root: &Path) -> String {
    let objects_dir = project_root.join(".vos").join("build");
    let object_paths = toolchain
        .build
        .sources
        .iter()
        .map(|source| {
            let stem = source
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("object");
            objects_dir.join(format!("{stem}.o"))
        })
        .collect::<Vec<_>>();
    let mut commands = Vec::new();
    commands.push(format!(
        "New-Item -ItemType Directory -Force -Path \"{}\" | Out-Null",
        objects_dir.display()
    ));
    for (source, object) in toolchain.build.sources.iter().zip(object_paths.iter()) {
        let compiler = match source.extension().and_then(|ext| ext.to_str()) {
            Some("S") | Some("s") | Some("asm") => &toolchain.toolchain.asm_compiler,
            _ => &toolchain.toolchain.c_compiler,
        };
        let flags = match source.extension().and_then(|ext| ext.to_str()) {
            Some("S") | Some("s") | Some("asm") => toolchain.build.asmflags.clone(),
            _ => toolchain.build.cflags.clone(),
        };
        let include_flags = toolchain
            .build
            .include_paths
            .iter()
            .map(|path| format!("-I\"{}\"", project_root.join(path).display()))
            .collect::<Vec<_>>();
        commands.push(format!(
            "& \"{compiler}\" {} {} -c \"{}\" -o \"{}\"",
            flags.join(" "),
            include_flags.join(" "),
            project_root.join(source).display(),
            object.display()
        ));
    }
    let output = toolchain
        .build
        .generated_artifacts
        .first()
        .map(|path| project_root.join(path))
        .unwrap_or_else(|| project_root.join("build/kernel.elf"));
    if let Some(parent) = output.parent() {
        commands.push(format!(
            "New-Item -ItemType Directory -Force -Path \"{}\" | Out-Null",
            parent.display()
        ));
    }
    commands.push(format!(
        "& \"{}\" -T \"{}\" {} {} -o \"{}\" {}",
        toolchain.toolchain.linker,
        project_root.join(&toolchain.link.linker_script).display(),
        toolchain.build.ldflags.join(" "),
        object_paths
            .iter()
            .map(|path| format!("\"{}\"", path.display()))
            .collect::<Vec<_>>()
            .join(" "),
        output.display(),
        toolchain.link.section_rules.join(" ")
    ));
    commands.join("; ")
}

fn module_dependencies(operations: &[OperationContract], module: &str) -> Vec<String> {
    let mut deps = BTreeSet::new();
    for operation in operations.iter().filter(|op| op.module == module) {
        for dep in &operation.depends_on.requires_modules {
            if dep != module {
                deps.insert(dep.clone());
            }
        }
    }
    deps.into_iter().collect()
}

fn build_module_waves(jobs: &[ModuleGenerationJob]) -> Result<Vec<Vec<String>>> {
    let mut remaining = jobs
        .iter()
        .map(|job| (job.module.clone(), job.depends_on_modules.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut resolved = BTreeSet::new();
    let mut waves = Vec::new();
    while !remaining.is_empty() {
        let wave = remaining
            .iter()
            .filter(|(_, deps)| deps.iter().all(|dep| resolved.contains(dep)))
            .map(|(module, _)| module.clone())
            .collect::<Vec<_>>();
        if wave.is_empty() {
            return Err(VosError::Message(
                "module dependency graph contains a cycle".into(),
            ));
        }
        for module in &wave {
            remaining.remove(module);
            resolved.insert(module.clone());
        }
        waves.push(wave);
    }
    Ok(waves)
}

fn slices_until_stage<'a>(
    slices: &'a [ArchitectureSlice],
    target_stage: &str,
) -> Result<Vec<&'a ArchitectureSlice>> {
    let mut selected = Vec::new();
    let mut target_index = None;
    for (index, slice) in slices.iter().enumerate() {
        selected.push(slice);
        if slice.stage == target_stage {
            target_index = Some(index);
            break;
        }
    }
    if target_index.is_none() {
        return Err(VosError::Message(format!(
            "target stage not found: {target_stage}"
        )));
    }
    Ok(selected)
}

fn validate_slice_dependency_graph(slices: &[ArchitectureSlice]) -> Result<()> {
    let graph = slices
        .iter()
        .map(|slice| (slice.id.clone(), slice.depends_on_slices.clone()))
        .collect::<HashMap<_, _>>();
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    for node in graph.keys() {
        visit_slice(node, &graph, &mut visiting, &mut visited)?;
    }
    Ok(())
}

fn visit_slice(
    node: &str,
    graph: &HashMap<String, Vec<String>>,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
) -> Result<()> {
    if visited.contains(node) {
        return Ok(());
    }
    if !visiting.insert(node.to_string()) {
        return Err(VosError::Message(format!(
            "slice dependency cycle detected at `{node}`"
        )));
    }
    if let Some(edges) = graph.get(node) {
        for edge in edges {
            if graph.contains_key(edge) {
                visit_slice(edge, graph, visiting, visited)?;
            }
        }
    }
    visiting.remove(node);
    visited.insert(node.to_string());
    Ok(())
}

fn read_dir_paths(dir: &Path) -> Result<Vec<PathBuf>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut paths = fs::read_dir(dir)?
        .map(|entry| entry.map(|item| item.path()))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    paths.sort();
    Ok(paths)
}

fn read_yaml_files(dir: &Path) -> Result<Vec<PathBuf>> {
    Ok(read_dir_paths(dir)?
        .into_iter()
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("yaml"))
                .unwrap_or(false)
        })
        .collect())
}

fn collect_spec_files(project_root: &Path, spec_root: &Path) -> Result<Vec<PathBuf>> {
    let root = project_root.join(spec_root);
    let mut files = Vec::new();
    collect_yaml_recursive(&root, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_yaml_recursive(dir: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    for path in read_dir_paths(dir)? {
        if path.is_dir() {
            collect_yaml_recursive(&path, files)?;
        } else if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("yaml"))
            .unwrap_or(false)
        {
            files.push(path);
        }
    }
    Ok(())
}

fn unique_strings(items: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut unique = Vec::new();
    for item in items {
        if seen.insert(item.clone()) {
            unique.push(item.clone());
        }
    }
    unique
}

fn stable_hash(content: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}
