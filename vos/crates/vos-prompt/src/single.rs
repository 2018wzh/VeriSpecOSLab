use std::path::Path;
use vos_core::{PromptEnvelope, SpecBundle, SpecRef, ToolchainSpecBundle};

use crate::shared::{toolchain_summary, yaml_lines};

pub fn build_prompt(
    bundle: &SpecBundle,
    toolchain: Option<&ToolchainSpecBundle>,
    phase: &str,
    project_root: &Path,
) -> PromptEnvelope {
    build_single_operation_prompt(bundle, toolchain, phase, project_root)
}

pub fn build_single_operation_prompt(
    bundle: &SpecBundle,
    toolchain: Option<&ToolchainSpecBundle>,
    phase: &str,
    project_root: &Path,
) -> PromptEnvelope {
    let editable = &bundle.operation_contract.llm_codegen.editable_region;
    let allowed_paths = vec![project_root.join(&editable.file)];
    let prompt = format!(
        "You are generating OS code for a single operation.\n\
Task kind: single_operation_codegen\n\
Phase: {phase}\n\
Module: {module}\n\
Operation: {operation}\n\
\n\
Rules:\n\
- Only modify the editable region between the exact start and end markers.\n\
- Return code only in one fenced code block.\n\
- Do not create new files.\n\
- Do not change files outside the allowed path.\n\
\n\
Editable target:\n\
file: {file}\n\
start_marker: {start}\n\
end_marker: {end}\n\
\n\
MODULE SPEC\n\
purpose: {module_purpose}\n\
owned_state:\n{owned_state}\n\
exported_interfaces:\n{exported_interfaces}\n\
imported_interfaces:\n{imported_interfaces}\n\
module_invariants:\n{module_invariants}\n\
\n\
OPERATION CONTRACT\n\
purpose: {operation_purpose}\n\
rely:\n{rely}\n\
guarantee:\n{guarantee}\n\
preconditions:\n{preconditions}\n\
postconditions:\n{postconditions}\n\
invariants_preserved:\n{invariants_preserved}\n\
failure_semantics:\n{failure_semantics}\n\
security:\n{security}\n\
concurrency:\n{concurrency}\n\
test_obligations:\n{test_obligations}\n\
\n\
TOOLCHAIN\n\
{toolchain}\n",
        phase = phase,
        module = bundle.module_spec.module,
        operation = bundle.operation_contract.operation,
        file = editable.file.display(),
        start = editable.start_marker,
        end = editable.end_marker,
        module_purpose = bundle.module_spec.purpose,
        owned_state = yaml_lines(&bundle.module_spec.owned_state),
        exported_interfaces = yaml_lines(&bundle.module_spec.exported_interfaces),
        imported_interfaces = yaml_lines(&bundle.module_spec.imported_interfaces),
        module_invariants = yaml_lines(&bundle.module_spec.module_invariants),
        operation_purpose = bundle.operation_contract.purpose,
        rely = serde_yaml::to_string(&bundle.operation_contract.rely).unwrap_or_default(),
        guarantee = serde_yaml::to_string(&bundle.operation_contract.guarantee).unwrap_or_default(),
        preconditions = yaml_lines(&bundle.operation_contract.preconditions),
        postconditions = yaml_lines(&bundle.operation_contract.postconditions),
        invariants_preserved = yaml_lines(&bundle.operation_contract.invariants_preserved),
        failure_semantics =
            serde_yaml::to_string(&bundle.operation_contract.failure_semantics).unwrap_or_default(),
        security = serde_yaml::to_string(&bundle.operation_contract.security).unwrap_or_default(),
        concurrency =
            serde_yaml::to_string(&bundle.operation_contract.concurrency).unwrap_or_default(),
        test_obligations =
            serde_yaml::to_string(&bundle.operation_contract.test_obligations).unwrap_or_default(),
        toolchain = toolchain_summary(toolchain),
    );

    PromptEnvelope {
        task_kind: "single_operation_codegen".into(),
        phase: phase.into(),
        spec_ref: SpecRef {
            module: bundle.module_spec.module.clone(),
            operation: bundle.operation_contract.operation.clone(),
        },
        allowed_paths,
        prompt,
    }
}
