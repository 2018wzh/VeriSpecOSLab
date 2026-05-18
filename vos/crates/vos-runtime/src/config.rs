use std::fs;
use std::path::{Path, PathBuf};

use vos_core::{AppConfig, DoctorReport, ProgressEvent, Result, ToolchainLintResult};

use crate::fs_guard::is_writable;
use crate::provider::{
    load_project_dotenv, resolve_active_provider, resolve_api_key_env, resolve_base_url,
    resolve_model, resolve_provider_kind, validate_provider_config,
};

pub type ProgressSink = dyn Fn(ProgressEvent) + Send + Sync;

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
    pub target: String,
    pub from_patch: Option<PathBuf>,
    pub apply: bool,
    pub build: bool,
    pub run: bool,
}

pub fn load_config(project_root: &Path) -> Result<AppConfig> {
    load_project_dotenv(project_root);
    let candidate = project_root.join(".vos").join("config.toml");
    if candidate.exists() {
        return Ok(toml::from_str(&fs::read_to_string(candidate)?)?);
    }
    Ok(AppConfig::default())
}

pub async fn doctor(project_root: &Path) -> Result<DoctorReport> {
    let config = load_config(project_root)?;
    validate_provider_config(&config)?;
    let active_provider = resolve_active_provider(&config)?;
    let spec_root = crate::scope::resolve_spec_root(project_root, None, &config)?;
    let build_command = if spec_root.exists() {
        let _ = vos_spec::load_toolchain_spec(project_root, &spec_root)?;
        Some("vos toolchain lint && vos build --generator makefile".into())
    } else {
        None
    };
    Ok(DoctorReport {
        active_provider: active_provider.name.clone(),
        provider_api_key_present: std::env::var(resolve_api_key_env(&active_provider.profile))
            .is_ok(),
        provider_kind: resolve_provider_kind(&active_provider.profile),
        api_key_env: resolve_api_key_env(&active_provider.profile).to_string(),
        model: resolve_model(&active_provider.profile),
        base_url: resolve_base_url(&active_provider.profile),
        build_command,
        project_root: project_root.to_path_buf(),
        writable: is_writable(project_root),
    })
}

pub fn lint_toolchain(project_root: &Path) -> Result<ToolchainLintResult> {
    let config = load_config(project_root)?;
    let spec_root = crate::scope::resolve_spec_root(project_root, None, &config)?;
    let bundle = vos_spec::load_toolchain_spec(project_root, &spec_root)?;
    Ok(ToolchainLintResult {
        ok: true,
        target_arch: bundle.toolchain.target_arch.clone(),
        target_triple: bundle.toolchain.target_triple.clone(),
        required_tools: bundle
            .environment
            .required_tools
            .iter()
            .map(|t| match &t.version_req {
                Some(v) => format!("{}: {}", t.name, v),
                None => t.name.clone(),
            })
            .collect(),
        emulator: bundle.run.emulator.clone(),
        success_signal: bundle.run.success_signal.clone(),
    })
}
