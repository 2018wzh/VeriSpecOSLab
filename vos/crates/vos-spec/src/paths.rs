use std::fs;
use std::path::{Path, PathBuf};

use vos_core::{Result, VosError};

pub(crate) fn read_dir_paths(dir: &Path) -> Result<Vec<PathBuf>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut paths = fs::read_dir(dir)?
        .map(|entry| entry.map(|item| item.path()))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    paths.sort();
    Ok(paths)
}

pub(crate) fn read_yaml_files(dir: &Path) -> Result<Vec<PathBuf>> {
    Ok(read_dir_paths(dir)?
        .into_iter()
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("yaml"))
                .unwrap_or(false)
        })
        .collect())
}

pub(crate) fn collect_spec_files(project_root: &Path, spec_root: &Path) -> Result<Vec<PathBuf>> {
    let root = project_root.join(spec_root);
    let mut files = Vec::new();
    collect_yaml_recursive(&root, &mut files)?;
    files.sort();
    Ok(files)
}

pub(crate) fn collect_yaml_recursive(dir: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    for path in read_dir_paths(dir)? {
        if path.is_dir() {
            collect_yaml_recursive(&path, files)?;
        } else if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("yaml"))
            .unwrap_or(false)
        {
            files.push(path);
        }
    }
    Ok(())
}

pub fn infer_module_operation_from_spec_path(
    project_root: &Path,
    spec_path: &Path,
) -> Result<(String, String)> {
    let absolute = if spec_path.is_absolute() {
        spec_path.to_path_buf()
    } else {
        project_root.join(spec_path)
    };
    let components = absolute
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let modules_index = components
        .iter()
        .rposition(|component| component == "modules")
        .ok_or_else(|| {
            VosError::Message(format!(
                "spec path does not point inside spec/modules: {}",
                absolute.display()
            ))
        })?;
    let ops_index = components
        .iter()
        .enumerate()
        .skip(modules_index + 1)
        .find(|(_, component)| *component == "ops")
        .map(|(index, _)| index)
        .ok_or_else(|| {
            VosError::Message(format!(
                "spec path does not point to an operation spec: {}",
                absolute.display()
            ))
        })?;
    if ops_index <= modules_index + 1 || ops_index + 1 >= components.len() {
        return Err(VosError::Message(format!(
            "spec path does not contain module/operation binding: {}",
            absolute.display()
        )));
    }
    let module = components[(modules_index + 1)..ops_index].join("/");
    let operation = absolute
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| {
            VosError::Message(format!(
                "invalid operation spec filename: {}",
                absolute.display()
            ))
        })?
        .to_string();
    Ok((module, operation))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_nested_module_and_operation_from_spec_path() {
        let project_root = Path::new("E:/demo");
        let path = Path::new("spec/modules/kernel/boot/ops/boot_banner.yaml");

        let (module, operation) =
            infer_module_operation_from_spec_path(project_root, path).expect("spec path");

        assert_eq!(module, "kernel/boot");
        assert_eq!(operation, "boot_banner");
    }

    #[test]
    fn ignores_unrelated_ops_segments_before_modules_root() {
        let project_root = Path::new("E:/demo/ops/worktree");
        let path = Path::new("spec/modules/kernel/boot/ops/boot_banner.yaml");

        let (module, operation) =
            infer_module_operation_from_spec_path(project_root, path).expect("spec path");

        assert_eq!(module, "kernel/boot");
        assert_eq!(operation, "boot_banner");
    }
}
