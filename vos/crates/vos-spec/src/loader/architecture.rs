use std::fs;
use std::path::Path;

use vos_core::{
    ArchitectureCompositionSpec, ArchitectureLintResult, ArchitectureSeed, ArchitectureSlice,
    ArchitectureSpecBundle, CompositionRule, Result,
};

use crate::hash::unique_strings;
use crate::loader::load_toolchain_spec;
use crate::loader::types::{
    ArchitectureSeedYaml, ArchitectureSliceYaml, CompositionRuleYaml, CompositionYaml,
    into_string_vec, into_tests_vec, into_validation_binding,
};
use crate::paths::read_yaml_files;

pub fn lint_architecture(project_root: &Path, spec_root: &Path) -> Result<ArchitectureLintResult> {
    let bundle = load_architecture_bundle(project_root, spec_root)?;
    Ok(ArchitectureLintResult {
        ok: true,
        target_platform: bundle.seed.target_platform,
        current_stage: bundle.slices.last().map(|slice| slice.stage.clone()),
        declared_stages: bundle
            .slices
            .iter()
            .map(|slice| slice.stage.clone())
            .collect(),
        enabled_modules: unique_strings(
            &bundle
                .slices
                .iter()
                .flat_map(|slice| slice.affected_modules.clone())
                .collect::<Vec<_>>(),
        ),
    })
}

pub fn load_architecture_bundle(
    project_root: &Path,
    spec_root: &Path,
) -> Result<ArchitectureSpecBundle> {
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
            .map(|rule: CompositionRuleYaml| CompositionRule {
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
