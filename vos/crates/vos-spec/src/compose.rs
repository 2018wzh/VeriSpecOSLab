use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use vos_core::{
    ArchitectureComposeResult, ArchitecturePlanBundle, GenerationQueue, ModuleGenerationJob,
    Result, SpecRef, StageDescriptor, VosError,
};

use crate::graph::{build_module_waves, module_dependencies, slices_until_stage};
use crate::hash::unique_strings;
use crate::hierarchy::{
    active_executable_module_names, active_module_names, expand_module_reference,
};
use crate::normalize::load_normalized_spec_bundle;

pub fn plan_architecture(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<ArchitecturePlanBundle> {
    let normalized = load_normalized_spec_bundle(project_root, spec_root)?;
    let slices = slices_until_stage(&normalized.architecture.slices, target_stage)?;
    let active_stages = slices
        .iter()
        .map(|slice| slice.stage.clone())
        .collect::<BTreeSet<_>>();
    let active_modules = active_module_names(&normalized.modules, &active_stages);
    let active_executable_modules =
        active_executable_module_names(&normalized.modules, &normalized.operations, &active_stages);
    let enabled_modules = expanded_enabled_modules(
        slices.as_slice(),
        &normalized.modules,
        &normalized.operations,
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
            .flat_map(|slice| {
                slice
                    .mechanisms
                    .clone()
                    .into_iter()
                    .chain(slice.invariants.clone())
            })
            .collect::<Vec<_>>(),
    );
    let verification_bindings = unique_strings(
        &slices
            .iter()
            .flat_map(|slice| slice.validation_binding.must_pass.clone())
            .chain(active_composition_validation_intents(
                &normalized.architecture.composition.cross_component_rules,
                &active_modules,
                &active_executable_modules,
            ))
            .collect::<Vec<_>>(),
    );
    let generation_order = stage_descriptors(
        slices.as_slice(),
        &normalized.modules,
        &normalized.operations,
    );

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
    let active_stages = slices
        .iter()
        .map(|slice| slice.stage.clone())
        .collect::<BTreeSet<_>>();
    let active_modules = active_module_names(&normalized.modules, &active_stages);
    let active_executable_modules =
        active_executable_module_names(&normalized.modules, &normalized.operations, &active_stages);
    let enabled_modules = expanded_enabled_modules(
        slices.as_slice(),
        &normalized.modules,
        &normalized.operations,
    );
    let mut module_dependency_dag = BTreeMap::new();
    for module in &enabled_modules {
        module_dependency_dag.insert(
            module.clone(),
            module_dependencies(
                &normalized.operations,
                &active_modules,
                &active_executable_modules,
                module,
            ),
        );
    }
    Ok(ArchitectureComposeResult {
        current_stage: target_stage.to_string(),
        enabled_modules,
        module_dependency_dag,
        skeleton_features: unique_strings(
            &slices
                .iter()
                .flat_map(|slice| {
                    slice
                        .mechanisms
                        .clone()
                        .into_iter()
                        .chain(slice.invariants.clone())
                })
                .collect::<Vec<_>>(),
        ),
        verification_bindings: unique_strings(
            &slices
                .iter()
                .flat_map(|slice| slice.validation_binding.must_pass.clone())
                .chain(active_composition_validation_intents(
                    &normalized.architecture.composition.cross_component_rules,
                    &active_modules,
                    &active_executable_modules,
                ))
                .collect::<Vec<_>>(),
        ),
    })
}

pub fn build_generation_queue(
    project_root: &Path,
    spec_root: &Path,
    target_stage: &str,
) -> Result<GenerationQueue> {
    let normalized = load_normalized_spec_bundle(project_root, spec_root)?;
    let compose = compose_architecture(project_root, spec_root, target_stage)?;
    let slices = slices_until_stage(&normalized.architecture.slices, target_stage)?;
    let active_stages = slices
        .iter()
        .map(|slice| slice.stage.clone())
        .collect::<BTreeSet<_>>();
    let active_modules = active_module_names(&normalized.modules, &active_stages);
    let active_executable_modules =
        active_executable_module_names(&normalized.modules, &normalized.operations, &active_stages);
    let module_map: HashMap<String, vos_core::ModuleSpec> = normalized
        .modules
        .iter()
        .map(|module| (module.module.clone(), module.clone()))
        .collect();
    let mut jobs = Vec::new();
    let mut blocked_by = BTreeMap::new();
    for module in &compose.enabled_modules {
        let spec = module_map.get(module).ok_or_else(|| {
            VosError::Message(format!("module not found in normalized bundle: {module}"))
        })?;
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
        let deps = module_dependencies(
            &normalized.operations,
            &active_modules,
            &active_executable_modules,
            module,
        );
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

fn expanded_enabled_modules(
    slices: &[&vos_core::ArchitectureSlice],
    modules: &[vos_core::ModuleSpec],
    operations: &[vos_core::OperationContract],
) -> Vec<String> {
    unique_strings(
        &slice_stage_contexts(slices, modules, operations)
            .into_iter()
            .flat_map(|(slice, active_modules, active_executable_modules)| {
                slice.affected_modules.iter().flat_map(move |reference| {
                    expand_module_reference(
                        reference,
                        &active_modules,
                        &active_executable_modules,
                        true,
                    )
                })
            })
            .collect::<Vec<_>>(),
    )
}

fn stage_descriptors(
    slices: &[&vos_core::ArchitectureSlice],
    modules: &[vos_core::ModuleSpec],
    operations: &[vos_core::OperationContract],
) -> Vec<StageDescriptor> {
    slice_stage_contexts(slices, modules, operations)
        .into_iter()
        .enumerate()
        .map(
            |(index, (slice, active_modules, active_executable_modules))| StageDescriptor {
                stage: slice.stage.clone(),
                stage_index: index,
                modules: unique_strings(
                    &slice
                        .affected_modules
                        .iter()
                        .flat_map(|reference| {
                            expand_module_reference(
                                reference,
                                &active_modules,
                                &active_executable_modules,
                                true,
                            )
                        })
                        .collect::<Vec<_>>(),
                ),
                required_stages: slice.depends_on_slices.clone(),
            },
        )
        .collect()
}

fn slice_stage_contexts<'a>(
    slices: &'a [&'a vos_core::ArchitectureSlice],
    modules: &[vos_core::ModuleSpec],
    operations: &[vos_core::OperationContract],
) -> Vec<(
    &'a vos_core::ArchitectureSlice,
    BTreeSet<String>,
    BTreeSet<String>,
)> {
    let mut active_stages = BTreeSet::new();
    let mut contexts = Vec::new();
    for slice in slices {
        active_stages.insert(slice.stage.clone());
        let active_modules = active_module_names(modules, &active_stages);
        let active_executable_modules =
            active_executable_module_names(modules, operations, &active_stages);
        contexts.push((*slice, active_modules, active_executable_modules));
    }
    contexts
}

fn active_composition_validation_intents<'a>(
    rules: &'a [vos_core::CompositionRule],
    active_modules: &'a BTreeSet<String>,
    active_executable_modules: &'a BTreeSet<String>,
) -> impl Iterator<Item = String> + 'a {
    rules
        .iter()
        .filter(move |rule| {
            rule.affected_modules.is_empty()
                || rule.affected_modules.iter().all(|reference| {
                    !expand_module_reference(
                        reference,
                        active_modules,
                        active_executable_modules,
                        true,
                    )
                    .is_empty()
                })
        })
        .flat_map(|rule| rule.validation_intent.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn nested_parent_reference_expands_only_active_descendants() {
        let temp = tempdir().expect("tempdir");
        let project_root = temp.path().to_path_buf();
        let spec_root = project_root.join("spec");

        fs::create_dir_all(spec_root.join("architecture").join("slices")).expect("slices dir");
        fs::create_dir_all(
            spec_root
                .join("modules")
                .join("kernel")
                .join("alpha")
                .join("ops"),
        )
        .expect("alpha ops dir");
        fs::create_dir_all(
            spec_root
                .join("modules")
                .join("kernel")
                .join("beta")
                .join("ops"),
        )
        .expect("beta ops dir");
        fs::create_dir_all(spec_root.join("toolchain")).expect("toolchain dir");

        fs::write(
            spec_root.join("architecture").join("seed.yaml"),
            "id: seed\nproject: demo\ndomain: os\ntarget_platform: riscv64\narchitecture_name: demo\narchitecture_summary: demo\n",
        )
        .expect("seed");
        fs::write(
            spec_root.join("architecture").join("composition.yaml"),
            "cross_component_rules:\n  - name: boot-only\n    affected_modules:\n      - kernel\n    validation_intent:\n      tests:\n        - verify_alpha\n  - name: syscall-only\n    affected_modules:\n      - kernel/beta\n    validation_intent:\n      tests:\n        - verify_beta\n",
        )
        .expect("composition");
        fs::write(
            spec_root.join("architecture").join("slices").join("01-boot.yaml"),
            "id: slice-boot\nstage: boot\ntitle: Boot\nsummary: boot slice\naffected_modules:\n  - kernel\n",
        )
        .expect("boot slice");
        fs::write(
            spec_root.join("architecture").join("slices").join("02-syscall.yaml"),
            "id: slice-syscall\nstage: syscall\ntitle: Syscall\nsummary: syscall slice\naffected_modules:\n  - kernel\n",
        )
        .expect("syscall slice");

        fs::write(
            spec_root.join("modules").join("kernel").join("module.yaml"),
            "id: kernel\nmodule: kernel\nstage: syscall\npurpose: aggregate kernel\n",
        )
        .expect("kernel aggregate");
        fs::write(
            spec_root
                .join("modules")
                .join("kernel")
                .join("alpha")
                .join("module.yaml"),
            "id: kernel/alpha\nmodule: kernel/alpha\nstage: boot\npurpose: alpha module\n",
        )
        .expect("alpha module");
        fs::write(
            spec_root
                .join("modules")
                .join("kernel")
                .join("alpha")
                .join("ops")
                .join("alpha.yaml"),
            "id: kernel/alpha.alpha\nstage: boot\nmodule: kernel/alpha\noperation: alpha\npurpose: alpha op\nllm_codegen:\n  editable_region:\n    file: kernel/alpha.c\n    start_marker: \"// BEGIN alpha\"\n    end_marker: \"// END alpha\"\n",
        )
        .expect("alpha op");
        fs::write(
            spec_root
                .join("modules")
                .join("kernel")
                .join("beta")
                .join("module.yaml"),
            "id: kernel/beta\nmodule: kernel/beta\nstage: syscall\npurpose: beta module\n",
        )
        .expect("beta module");
        fs::write(
            spec_root
                .join("modules")
                .join("kernel")
                .join("beta")
                .join("ops")
                .join("beta.yaml"),
            "id: kernel/beta.beta\nstage: syscall\nmodule: kernel/beta\noperation: beta\npurpose: beta op\ndepends_on:\n  requires_modules:\n    - kernel/alpha\nllm_codegen:\n  editable_region:\n    file: kernel/beta.c\n    start_marker: \"// BEGIN beta\"\n    end_marker: \"// END beta\"\n",
        )
        .expect("beta op");

        fs::write(
            spec_root.join("toolchain").join("toolchain.yaml"),
            "toolchain:\n  target_arch: riscv64\n  target_triple: riscv64-unknown-elf\n  c_compiler: gcc\n  asm_compiler: gcc\n  linker: ld\n  archiver: ar\nbuild:\n  allowed_output_path:\n    - Makefile\n  generated_artifacts:\n    - build/kernel.elf\n  phases:\n    - name: link_kernel\n      semantic:\n        type: custom\n        command: echo build\n        expected_outputs:\n          - build/kernel.elf\nlink:\n  linker_script: kernel/link.ld\n  entry_symbol: start\n  relocation_model: static\nimage:\n  output_kind: kernel\n  required_artifacts:\n    - build/kernel.elf\nrun:\n  emulator: qemu-system-riscv64\n  machine: virt\n  cpu: rv64\n  memory: 128M\n  bios: none\n  kernel_arg: -kernel\n  success_signal: OK\n  timeout_secs: 1\n",
        )
        .expect("toolchain");

        let boot_compose = compose_architecture(&project_root, &spec_root, "boot").expect("boot");
        assert_eq!(boot_compose.enabled_modules, vec!["kernel/alpha"]);
        assert_eq!(boot_compose.verification_bindings, vec!["verify_alpha"]);

        let syscall_compose =
            compose_architecture(&project_root, &spec_root, "syscall").expect("syscall");
        assert_eq!(
            syscall_compose.enabled_modules,
            vec!["kernel/alpha", "kernel/beta"]
        );
        assert_eq!(
            syscall_compose.verification_bindings,
            vec!["verify_alpha", "verify_beta"]
        );

        let queue = build_generation_queue(&project_root, &spec_root, "syscall").expect("queue");
        assert_eq!(
            queue
                .jobs
                .iter()
                .map(|job| job.module.clone())
                .collect::<Vec<_>>(),
            vec!["kernel/alpha", "kernel/beta"]
        );
        assert_eq!(queue.blocked_by["kernel/beta"], vec!["kernel/alpha"]);
    }

    #[test]
    fn migrated_xv6_example_normalizes_and_composes_nested_modules() {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace_root = manifest_dir
            .ancestors()
            .nth(2)
            .expect("workspace root")
            .to_path_buf();
        let project_root = workspace_root.join("..").join("examples").join("xv6-spec");
        let spec_root = project_root.join("spec");

        let normalized = crate::normalize::load_normalized_spec_bundle(&project_root, &spec_root)
            .expect("normalized");
        assert!(
            normalized
                .modules
                .iter()
                .any(|module| module.module == "kernel")
        );
        assert!(
            normalized
                .modules
                .iter()
                .any(|module| module.module == "user/programs")
        );

        let report = crate::consistency::check_consistency(&project_root, &spec_root, &normalized)
            .expect("consistency");
        assert!(report.ok, "{}", report.errors.join("; "));

        let compose = compose_architecture(&project_root, &spec_root, "syscall").expect("compose");
        assert!(
            compose
                .enabled_modules
                .contains(&"kernel/syscall".to_string())
        );
        assert!(
            compose
                .enabled_modules
                .contains(&"user/programs".to_string())
        );
    }
}
