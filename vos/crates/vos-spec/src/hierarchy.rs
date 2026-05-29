use std::collections::BTreeSet;
use std::fmt::Write;

use vos_core::{ModuleSpec, OperationContract, Result, VosError};

pub fn module_path_token(module: &str) -> String {
    let mut token = String::with_capacity(module.len());
    for ch in module.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            token.push(ch);
        } else {
            let _ = write!(&mut token, "_{:02X}", ch as u32);
        }
    }
    token
}

pub fn canonical_operation_reference(operation: &OperationContract) -> String {
    format!("{}:{}", operation.module, operation.operation)
}

pub fn resolve_operation_reference<'a>(
    operations: &'a [OperationContract],
    reference: &str,
) -> Result<&'a OperationContract> {
    if let Some(operation) = operations
        .iter()
        .find(|operation| operation.id == reference)
    {
        return Ok(operation);
    }
    if let Some(operation) = operations
        .iter()
        .find(|operation| canonical_operation_reference(operation) == reference)
    {
        return Ok(operation);
    }
    if let Some(operation) = operations
        .iter()
        .find(|operation| format!("{}.{}", operation.module, operation.operation) == reference)
    {
        return Ok(operation);
    }

    let bare_matches = operations
        .iter()
        .filter(|operation| operation.operation == reference)
        .collect::<Vec<_>>();
    match bare_matches.len() {
        1 => Ok(bare_matches[0]),
        0 => Err(VosError::Message(format!(
            "unknown operation reference `{reference}`"
        ))),
        _ => Err(VosError::Message(format!(
            "ambiguous bare operation reference `{reference}`; use module-qualified form like `module:operation`"
        ))),
    }
}

pub(crate) fn active_module_names(
    modules: &[ModuleSpec],
    active_stages: &BTreeSet<String>,
) -> BTreeSet<String> {
    modules
        .iter()
        .filter(|module| active_stages.contains(&module.stage))
        .map(|module| module.module.clone())
        .collect()
}

pub(crate) fn active_executable_module_names(
    modules: &[ModuleSpec],
    operations: &[OperationContract],
    active_stages: &BTreeSet<String>,
) -> BTreeSet<String> {
    let active_modules = active_module_names(modules, active_stages);
    operations
        .iter()
        .filter(|operation| active_modules.contains(&operation.module))
        .map(|operation| operation.module.clone())
        .collect()
}

pub(crate) fn expand_module_reference(
    reference: &str,
    active_modules: &BTreeSet<String>,
    active_executable_modules: &BTreeSet<String>,
    executable_only: bool,
) -> Vec<String> {
    let candidates = if executable_only {
        active_executable_modules
    } else {
        active_modules
    };
    candidates
        .iter()
        .filter(|candidate| module_reference_matches(reference, candidate))
        .cloned()
        .collect()
}

pub(crate) fn module_reference_exists(module_names: &BTreeSet<String>, reference: &str) -> bool {
    module_names.contains(reference)
}

pub(crate) fn module_reference_matches(reference: &str, candidate: &str) -> bool {
    candidate == reference
        || candidate
            .strip_prefix(reference)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_path_token_escapes_nested_separator() {
        assert_eq!(module_path_token("kernel/boot"), "kernel_2Fboot");
    }

    #[test]
    fn resolve_operation_reference_rejects_ambiguous_bare_name() {
        let operations = vec![
            OperationContract {
                id: "kernel/boot.init".into(),
                stage: "boot".into(),
                module: "kernel/boot".into(),
                operation: "init".into(),
                purpose: String::new(),
                related_slice: None,
                related_adr: None,
                depends_on: Default::default(),
                rely: serde_yaml::Value::Null,
                guarantee: serde_yaml::Value::Null,
                preconditions: Vec::new(),
                postconditions: Vec::new(),
                invariants_preserved: Vec::new(),
                failure_semantics: serde_yaml::Value::Null,
                concurrency: serde_yaml::Value::Null,
                security: serde_yaml::Value::Null,
                observability: serde_yaml::Value::Null,
                test_obligations: Default::default(),
                llm_codegen: vos_core::LlmCodegenConstraints {
                    editable_region: vos_core::EditableRegion {
                        file: "kernel/boot.c".into(),
                        start_marker: "// BEGIN".into(),
                        end_marker: "// END".into(),
                        create_if_missing: false,
                    },
                    forbidden_changes: Vec::new(),
                    required_followup_checks: Vec::new(),
                },
            },
            OperationContract {
                id: "user/programs.init".into(),
                stage: "process".into(),
                module: "user/programs".into(),
                operation: "init".into(),
                purpose: String::new(),
                related_slice: None,
                related_adr: None,
                depends_on: Default::default(),
                rely: serde_yaml::Value::Null,
                guarantee: serde_yaml::Value::Null,
                preconditions: Vec::new(),
                postconditions: Vec::new(),
                invariants_preserved: Vec::new(),
                failure_semantics: serde_yaml::Value::Null,
                concurrency: serde_yaml::Value::Null,
                security: serde_yaml::Value::Null,
                observability: serde_yaml::Value::Null,
                test_obligations: Default::default(),
                llm_codegen: vos_core::LlmCodegenConstraints {
                    editable_region: vos_core::EditableRegion {
                        file: "user/init.c".into(),
                        start_marker: "// BEGIN".into(),
                        end_marker: "// END".into(),
                        create_if_missing: false,
                    },
                    forbidden_changes: Vec::new(),
                    required_followup_checks: Vec::new(),
                },
            },
        ];

        let err = resolve_operation_reference(&operations, "init").expect_err("ambiguous");
        assert!(
            err.to_string()
                .contains("ambiguous bare operation reference")
        );
    }
}
