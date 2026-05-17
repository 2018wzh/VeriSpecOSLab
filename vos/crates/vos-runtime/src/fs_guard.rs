use std::path::{Path, PathBuf};

use vos_core::NormalizedSpecBundle;

pub(crate) fn allowed_paths(normalized: &NormalizedSpecBundle, project_root: &Path) -> Vec<PathBuf> {
    let mut allowed = normalized
        .operations
        .iter()
        .map(|op| project_root.join(&op.llm_codegen.editable_region.file))
        .collect::<Vec<_>>();
    allowed.extend(
        normalized
            .architecture
            .toolchain
            .build
            .sources
            .iter()
            .map(|path| project_root.join(path)),
    );
    allowed.extend(
        normalized
            .architecture
            .toolchain
            .build
            .include_paths
            .iter()
            .map(|path| project_root.join(path)),
    );
    allowed.push(project_root.join(&normalized.architecture.toolchain.link.linker_script));
    if let Some(script) = &normalized.architecture.toolchain.debug.gdb_script {
        allowed.push(project_root.join(script));
    }
    allowed.sort();
    allowed.dedup();
    allowed
}

pub(crate) fn is_allowed_path(candidate: &Path, allowed_paths: &[PathBuf]) -> bool {
    allowed_paths.iter().any(|allowed| {
        candidate == allowed || allowed.extension().is_none() && candidate.starts_with(allowed)
    })
}

pub(crate) fn is_writable(project_root: &Path) -> bool {
    let probe = project_root.join(".vos-write-probe");
    let write = std::fs::write(&probe, "ok");
    let _ = std::fs::remove_file(&probe);
    write.is_ok()
}
