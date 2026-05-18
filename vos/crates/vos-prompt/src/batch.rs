use std::path::Path;
use vos_core::{ConcurrencySpec, ModuleSpec, NormalizedSpecBundle, OperationContract};

use crate::shared::{operation_block, yaml_lines};

pub fn build_module_codegen_batch_prompt(
    module_spec: &ModuleSpec,
    operations: &[OperationContract],
    concurrency: Option<&ConcurrencySpec>,
    normalized: &NormalizedSpecBundle,
    _project_root: &Path,
) -> String {
    format!(
        "You are generating one module worth of OS code from strict specs.\n\
Task kind: module_codegen_batch\n\
Return one JSON code block matching this shape exactly:\n\
{{\"region_edits\":[{{\"file\":\"...\",\"start_marker\":\"...\",\"end_marker\":\"...\",\"code\":\"...\"}}]}}\n\
\n\
Rules:\n\
- You may only write region edits for the listed operations in this module.\n\
- Do not create new files.\n\
- Emit one region edit per editable region.\n\
- Do not emit explanations outside the JSON block.\n\
\n\
MODULE SPEC\n\
id: {id}\n\
module: {module}\n\
stage: {stage}\n\
purpose: {purpose}\n\
owned_state:\n{owned_state}\n\
exported_interfaces:\n{exported_interfaces}\n\
imported_interfaces:\n{imported_interfaces}\n\
module_invariants:\n{module_invariants}\n\
error_model:\n{error_model}\n\
resource_lifetime_rules:\n{resource_lifetime_rules}\n\
security_boundary:\n{security_boundary}\n\
test_surfaces:\n{test_surfaces}\n\
\n\
CONCURRENCY SPEC\n\
{concurrency}\n\
\n\
OPERATIONS\n\
{operations}\n\
\n\
GLOBAL ARCHITECTURE SUMMARY\n\
{arch_summary}\n\
\n\
ALLOWED REGION TARGETS\n\
{targets}\n",
        id = module_spec.id,
        module = module_spec.module,
        stage = module_spec.stage,
        purpose = module_spec.purpose,
        owned_state = yaml_lines(&module_spec.owned_state),
        exported_interfaces = yaml_lines(&module_spec.exported_interfaces),
        imported_interfaces = yaml_lines(&module_spec.imported_interfaces),
        module_invariants = yaml_lines(&module_spec.module_invariants),
        error_model = yaml_lines(&module_spec.error_model),
        resource_lifetime_rules = yaml_lines(&module_spec.resource_lifetime_rules),
        security_boundary = yaml_lines(&module_spec.security_boundary),
        test_surfaces = yaml_lines(&module_spec.test_surfaces),
        concurrency = concurrency
            .map(|spec| serde_yaml::to_string(spec).unwrap_or_default())
            .unwrap_or_else(|| "null".into()),
        operations = operations
            .iter()
            .map(operation_block)
            .collect::<Vec<_>>()
            .join("\n\n"),
        arch_summary = normalized.architecture.seed.architecture_summary,
        targets = operations
            .iter()
            .map(|op| {
                format!(
                    "- file: {}\n  start_marker: {}\n  end_marker: {}",
                    op.llm_codegen.editable_region.file.display(),
                    op.llm_codegen.editable_region.start_marker,
                    op.llm_codegen.editable_region.end_marker
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
    )
}
