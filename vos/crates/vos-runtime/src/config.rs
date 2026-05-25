use std::fs;
use std::path::Path;

use vos_core::{AppConfig, DoctorReport, Result, ToolchainLintResult};

use crate::fs_guard::is_writable;
use crate::provider_helpers::{
    ResolvedAgentConfig, load_project_dotenv, resolve_agent_runtime_config, resolve_provider_kind,
    validate_agent_runtime_config,
};

pub fn load_config(project_root: &Path) -> Result<AppConfig> {
    load_project_dotenv(project_root);
    let candidate = project_root.join(".vos").join("config.toml");
    if candidate.exists() {
        return Ok(toml::from_str(&fs::read_to_string(candidate)?)?);
    }
    Ok(AppConfig::default())
}

pub fn validate_agent_config(config: &AppConfig) -> Result<()> {
    validate_agent_runtime_config(config)
}

pub fn resolve_agent_config(config: &AppConfig) -> Result<ResolvedAgentConfig> {
    resolve_agent_runtime_config(config)
}

pub async fn doctor(project_root: &Path) -> Result<DoctorReport> {
    let config = load_config(project_root)?;
    let active_provider = resolve_agent_runtime_config(&config)?;
    let spec_root = crate::scope::resolve_spec_root(project_root, None, &config)?;
    let build_command = if spec_root.exists() {
        let _ = vos_spec::load_toolchain_spec(project_root, &spec_root)?;
        Some("vos agent generate --apply && vos build".into())
    } else {
        None
    };
    Ok(DoctorReport {
        active_provider: active_provider.provider.as_str().to_string(),
        provider_api_key_present: std::env::var(&active_provider.api_key_env).is_ok(),
        provider_kind: resolve_provider_kind(&active_provider),
        api_key_env: active_provider.api_key_env,
        model: active_provider.model,
        base_url: active_provider.base_url,
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
