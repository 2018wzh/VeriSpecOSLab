use std::path::Path;

use crate::host::HostPlatform;

pub struct HostPath;

impl HostPath {
    pub fn mkdir_command(path: impl AsRef<Path>) -> String {
        let platform = HostPlatform::current();
        let path = platform.quote(platform.makefile_path(path));
        if platform.is_windows() {
            format!("mkdir {path}")
        } else {
            format!("mkdir -p {path}")
        }
    }
}
