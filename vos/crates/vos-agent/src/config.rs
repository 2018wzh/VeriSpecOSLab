use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct AgentApplyOptions {
    pub patch_path: Option<PathBuf>,
    pub apply: bool,
    pub require_spec: bool,
    pub run_validation: bool,
    pub stage: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AgentGenerateOptions {
    pub target: Option<String>,
    pub from_patch: Option<PathBuf>,
    pub apply: bool,
    pub build: bool,
    pub run: bool,
}
