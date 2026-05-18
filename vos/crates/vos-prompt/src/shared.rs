use std::path::PathBuf;
use vos_core::{OperationContract, PlanDraft};

pub(crate) fn operation_block(operation: &OperationContract) -> String {
    format!(
        "- id: {}\n  operation: {}\n  purpose: {}\n  depends_on:\n{}\n  rely:\n{}\n  guarantee:\n{}\n  preconditions:\n{}\n  postconditions:\n{}\n  invariants_preserved:\n{}\n  failure_semantics:\n{}\n  security:\n{}\n  test_obligations:\n{}\n  editable_region:\n    file: {}\n    start_marker: {}\n    end_marker: {}",
        operation.id,
        operation.operation,
        operation.purpose,
        serde_yaml::to_string(&operation.depends_on).unwrap_or_default(),
        serde_yaml::to_string(&operation.rely).unwrap_or_default(),
        serde_yaml::to_string(&operation.guarantee).unwrap_or_default(),
        yaml_lines(&operation.preconditions),
        yaml_lines(&operation.postconditions),
        yaml_lines(&operation.invariants_preserved),
        serde_yaml::to_string(&operation.failure_semantics).unwrap_or_default(),
        serde_yaml::to_string(&operation.security).unwrap_or_default(),
        serde_yaml::to_string(&operation.test_obligations).unwrap_or_default(),
        operation.llm_codegen.editable_region.file.display(),
        operation.llm_codegen.editable_region.start_marker,
        operation.llm_codegen.editable_region.end_marker,
    )
}

pub(crate) fn yaml_lines(items: &[String]) -> String {
    if items.is_empty() {
        return "- none".into();
    }
    items
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn yaml_paths(items: &[PathBuf]) -> String {
    if items.is_empty() {
        return "- none".into();
    }
    items
        .iter()
        .map(|item| format!("- {}", item.display()))
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn plan_summary(plan: &PlanDraft) -> String {
    format!(
        "task: {}\nrelated_specs:\n{}\nrequired_validations:\n{}\ngeneration_waves:\n{}",
        plan.task,
        yaml_lines(&plan.related_specs),
        yaml_lines(&plan.required_validations),
        plan.generation_waves
            .iter()
            .map(|wave| format!("- {}", wave.join(", ")))
            .collect::<Vec<_>>()
            .join("\n")
    )
}
