use std::path::Path;
use vos_core::{ArchitectureComposeResult, NormalizedSpecBundle, PromptEnvelope, SpecRef};

use crate::shared::{yaml_lines, yaml_paths};

pub fn build_skeleton_projection_prompt(
    normalized: &NormalizedSpecBundle,
    compose: &ArchitectureComposeResult,
    project_root: &Path,
    allowed_paths: &[std::path::PathBuf],
) -> PromptEnvelope {
    let toolchain = &normalized.architecture.toolchain;
    let prompt = format!(
        "You are projecting an operating system skeleton from strict architecture, module, and toolchain specs.\n\
Task kind: skeleton_projection\n\
Return one JSON code block matching this shape exactly:\n\
{{\"files_to_create\":[{{\"path\":\"...\",\"content\":\"...\",\"create_mode\":\"create\"}}],\"files_to_update\":[{{\"file\":\"...\",\"start_marker\":\"...\",\"end_marker\":\"...\",\"code\":\"...\"}}]}}\n\
\n\
Rules:\n\
- You may only create files whose paths are implied by build.sources, build.include_paths, link.linker_script, debug.gdb_script, or operation editable targets.\n\
- Do not emit explanations outside the JSON block.\n\
- Do not fill subsystem logic beyond minimal skeletons, signatures, entry points, linker files, and placeholder regions.\n\
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
    );

    PromptEnvelope {
        task_kind: "skeleton_projection".into(),
        phase: "skeleton_projection".into(),
        spec_ref: SpecRef {
            module: "architecture".into(),
            operation: compose.current_stage.clone(),
        },
        allowed_paths: allowed_paths.to_vec(),
        prompt,
    }
}

pub fn build_skeleton_retry_prompt(
    normalized: &NormalizedSpecBundle,
    compose: &ArchitectureComposeResult,
    project_root: &Path,
    allowed_paths: &[std::path::PathBuf],
    feedback: &[String],
) -> PromptEnvelope {
    let mut base =
        build_skeleton_projection_prompt(normalized, compose, project_root, allowed_paths);
    let mut addon = String::from("\nRETRY_FEEDBACK\n");
    for item in feedback {
        addon.push_str("- ");
        addon.push_str(item);
        addon.push('\n');
    }
    addon.push_str(
        "Fix all items above. Return one JSON code block only. Do not include explanations.\n",
    );
    base.prompt.push_str(&addon);
    base
}
