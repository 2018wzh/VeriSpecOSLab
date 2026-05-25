use std::path::{Path, PathBuf};

use vos_core::{ArchitectureComposeResult, NormalizedSpecBundle, ToolchainSpecBundle};

pub fn build_toolchain_codegen_prompt(
    toolchain: &ToolchainSpecBundle,
    normalized: &NormalizedSpecBundle,
    compose: &ArchitectureComposeResult,
    project_root: &Path,
    allowed_paths: &[PathBuf],
    allowed_formats: &[&str],
    required_phases: &[String],
) -> String {
    format!(
        "You are generating a local build system for an OS project from strict toolchain specs.\n\
Task kind: toolchain_codegen\n\
Return one JSON code block matching this shape exactly:\n\
{{\"artifact_format\":\"...\",\"files\":[{{\"path\":\"...\",\"content\":\"...\"}}],\"command_program\":\"...\",\"command_args\":[\"...\"],\"entry_target\":\"...\",\"phases\":[\"...\"]}}\n\
\n\
Rules:\n\
- Emit JSON only inside a single fenced code block.\n\
- files.path must be one of the ALLOWED OUTPUT PATHS.\n\
- command_args must include the literal placeholder {{phase}} exactly once.\n\
- command_program must be a direct build tool binary, never sh, bash, python, env, or a shell wrapper.\n\
- phases must match the required execution order from REQUIRED PHASES.\n\
- entry_target must match the final required phase.\n\
- Build files must be suitable for being written directly into the project root.\n\
- Build files must preserve existing editable-region source files and compile/link according to TOOLCHAIN SPEC.\n\
\n\
CURRENT STAGE\n\
{stage}\n\
\n\
TARGET MODULES\n\
{modules}\n\
\n\
ALLOWED OUTPUT FORMATS\n\
{formats}\n\
\n\
ALLOWED OUTPUT PATHS\n\
{paths}\n\
\n\
REQUIRED PHASES\n\
{phases}\n\
\n\
TOOLCHAIN SPEC\n\
{toolchain_yaml}\n\
\n\
ARCHITECTURE SUMMARY\n\
{arch_summary}\n\
\n\
PROJECT SOURCE SUMMARY\n\
{source_summary}\n",
        stage = compose.current_stage,
        modules = compose.enabled_modules.join(", "),
        formats = allowed_formats.join(", "),
        paths = allowed_paths
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join("\n"),
        phases = required_phases.join("\n"),
        toolchain_yaml = serde_yaml::to_string(toolchain).unwrap_or_default(),
        arch_summary = normalized.architecture.seed.architecture_summary,
        source_summary = summarize_project_sources(project_root),
    )
}

fn summarize_project_sources(project_root: &Path) -> String {
    let mut files = Vec::new();
    for root in ["kernel", "include", "user", "xtask"] {
        let dir = project_root.join(root);
        if !dir.exists() {
            continue;
        }
        collect_files(project_root, &dir, &mut files);
    }
    files.sort();
    if files.is_empty() {
        "- none".into()
    } else {
        files.join("\n")
    }
}

fn collect_files(project_root: &Path, dir: &Path, files: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(project_root, &path, files);
        } else if let Ok(rel) = path.strip_prefix(project_root) {
            files.push(format!("- {}", rel.display()));
        }
    }
}
