use std::path::Path;
use vos_core::{ConcurrencySpec, ModuleSpec, NormalizedSpecBundle, OperationContract};

use crate::shared::{operation_block, yaml_lines};

pub fn build_module_codegen_batch_prompt(
    module_spec: &ModuleSpec,
    operations: &[OperationContract],
    concurrency: Option<&ConcurrencySpec>,
    normalized: &NormalizedSpecBundle,
    _project_root: &Path,
    target_context: &str,
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
- All code fields must be strict JSON strings: escape newlines as \\n and do not emit invalid backslash escapes such as \\v, \\0, or \\#.\n\
- The code field is inserted strictly BETWEEN start_marker and end_marker. Do not repeat the markers.\n\
- Do not emit an enclosing function, global label, .section, .globl, or wrapper that already appears in TARGET FILE CONTEXT.\n\
- If TARGET FILE CONTEXT shows start_marker inside a function body, emit only statements for that function body.\n\
- If TARGET FILE CONTEXT shows start_marker inside an assembly label, emit only instructions/directives for that label body. Use .align, never bare align.\n\
- Keep signatures, prototypes, global tables, labels, and declarations consistent with TARGET FILE CONTEXT; do not redeclare them inside the editable region.\n\
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
{targets}\n\
\n\
TARGET FILE CONTEXT\n\
{target_context}\n",
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
        target_context = target_context,
    )
}
