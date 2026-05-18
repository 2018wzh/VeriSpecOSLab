use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostPlatformKind {
    Windows,
    Unix,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostPlatform {
    kind: HostPlatformKind,
}

impl HostPlatform {
    pub fn current() -> Self {
        Self {
            kind: if cfg!(windows) {
                HostPlatformKind::Windows
            } else {
                HostPlatformKind::Unix
            },
        }
    }

    pub fn is_windows(self) -> bool {
        matches!(self.kind, HostPlatformKind::Windows)
    }

    pub fn makefile_path(self, path: impl AsRef<Path>) -> String {
        path.as_ref().to_string_lossy().replace('\\', "/")
    }

    pub fn quote(self, value: impl AsRef<str>) -> String {
        let value = value.as_ref();
        if value.is_empty() || value.contains([' ', '\t', '"']) {
            format!("\"{}\"", value.replace('"', "\\\""))
        } else {
            value.to_string()
        }
    }
}
