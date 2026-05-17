use std::fs;
use std::path::{Path, PathBuf};

use vos_core::Result;

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
