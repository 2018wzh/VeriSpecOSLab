use std::path::Path;
use vos_core::{ArchitectureComposeResult, NormalizedSpecBundle};

use crate::shared::{yaml_lines, yaml_paths};

pub fn build_skeleton_projection_prompt(
    normalized: &NormalizedSpecBundle,
    compose: &ArchitectureComposeResult,
    project_root: &Path,
    allowed_paths: &[std::path::PathBuf],
) -> String {
    let toolchain = &normalized.architecture.toolchain;
    let editable_regions = required_editable_regions(normalized, &compose.enabled_modules);
    format!(
        "You are projecting an operating system skeleton from strict architecture, module, and toolchain specs.\n\
Task kind: skeleton_projection\n\
Return one JSON code block matching this shape exactly:\n\
{{\"files_to_create\":[{{\"path\":\"...\",\"content\":\"...\",\"create_mode\":\"create\"}}],\"files_to_update\":[{{\"file\":\"...\",\"start_marker\":\"...\",\"end_marker\":\"...\",\"code\":\"...\"}}]}}\n\
\n\
Rules:\n\
- You may only create files whose paths are implied by build.sources, build.include_paths, link.linker_script, debug.gdb_script, or operation editable targets.\n\
- Do not emit explanations outside the JSON block.\n\
- All content/code fields must be strict JSON strings: escape newlines as \\n and do not emit invalid backslash escapes such as \\v, \\0, or \\#.\n\
- Skeleton projection must only create buildable file scaffolds and exact editable-region markers. Module implementation code is generated later by module_codegen_batch.\n\
- For every REQUIRED_EDITABLE_REGION below, the skeleton must contain the exact start_marker and end_marker in the target file.\n\
- If a required target file does not already exist, create that file in files_to_create and include all required marker pairs for that file.\n\
- Do not implement operation bodies inside editable regions. Leave the region empty or put one minimal placeholder comment/statement needed only for syntax.\n\
- Do not generate full subsystem logic in files_to_create; keep declarations, includes, entry symbols, linker sections, function shells, and marker placement only.\n\
\n\
CURRENT STAGE\n\
{stage}\n\
\n\
ARCHITECTURE SUMMARY\n\
{arch_summary}\n\
\n\
ENABLED MODULES\n\
{modules}\n\
\n\
SKELETON FEATURES\n\
{features}\n\
\n\
MODULE DEPENDENCY DAG\n\
{dag}\n\
\n\
REQUIRED_EDITABLE_REGIONS\n\
{editable_regions}\n\
\n\
TOOLCHAIN\n\
target_triple: {target_triple}\n\
c_compiler: {c_compiler}\n\
asm_compiler: {asm_compiler}\n\
linker: {linker}\n\
linker_script: {linker_script}\n\
output_artifacts:\n{artifacts}\n\
run_emulator: {emulator}\n\
kernel_arg: {kernel_arg}\n\
allowed_paths:\n{allowed}\n",
        stage = compose.current_stage,
        arch_summary = normalized.architecture.seed.architecture_summary,
        modules = yaml_lines(&compose.enabled_modules),
        features = yaml_lines(&compose.skeleton_features),
        dag = compose
            .module_dependency_dag
            .iter()
            .map(|(module, deps)| format!("- {module}: {}", deps.join(", ")))
            .collect::<Vec<_>>()
            .join("\n"),
        editable_regions = editable_regions,
        target_triple = toolchain.toolchain.target_triple,
        c_compiler = toolchain.toolchain.c_compiler,
        asm_compiler = toolchain.toolchain.asm_compiler,
        linker = toolchain.toolchain.linker,
        linker_script = toolchain.link.linker_script.display(),
        artifacts = yaml_paths(&toolchain.build.generated_artifacts),
        emulator = toolchain.run.emulator,
        kernel_arg = toolchain.run.kernel_arg,
        allowed = yaml_paths(
            &allowed_paths
                .iter()
                .map(|path| {
                    path.strip_prefix(project_root)
                        .unwrap_or(path)
                        .to_path_buf()
                })
                .collect::<Vec<_>>(),
        ),
    )
}

fn required_editable_regions(
    normalized: &NormalizedSpecBundle,
    enabled_modules: &[String],
) -> String {
    let mut regions = normalized
        .operations
        .iter()
        .filter(|operation| enabled_modules.contains(&operation.module))
        .map(|operation| {
            format!(
                "- id: {}\n  file: {}\n  start_marker: {}\n  end_marker: {}",
                operation.id,
                operation.llm_codegen.editable_region.file.display(),
                operation.llm_codegen.editable_region.start_marker,
                operation.llm_codegen.editable_region.end_marker
            )
        })
        .collect::<Vec<_>>();
    regions.sort();
    if regions.is_empty() {
        "- none".into()
    } else {
        regions.join("\n")
    }
}

pub fn build_skeleton_retry_prompt(
    normalized: &NormalizedSpecBundle,
    compose: &ArchitectureComposeResult,
    project_root: &Path,
    allowed_paths: &[std::path::PathBuf],
    feedback: &[String],
) -> String {
    let mut base =
        build_skeleton_projection_prompt(normalized, compose, project_root, allowed_paths);
    let mut addon = String::from("\nRETRY_FEEDBACK\n");
    for item in feedback {
        addon.push_str("- ");
        addon.push_str(item);
        addon.push('\n');
    }
    addon.push_str(
        "Fix all items above. Ensure every required editable region marker pair is present exactly once in its target file. Return one JSON code block only. Do not include explanations.\n",
    );
    base.push_str(&addon);
    base
}
