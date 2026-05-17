use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::task::JoinSet;
use tokio::time::{timeout, Duration};
use vos_core::{
    is_valid_env_var_name, new_run_id, AppConfig, ApplyPatchResult, ArchitectureComposeResult,
    ArchitectureLintResult, BuildRequest, BuildResult, CodegenRequest, ConsistencyReport,
    ContextBundle, DerivedTestMatrix, DoctorReport, NormalizedSpecBundle, PlanDraft,
    ProgressEvent, PublicVerifyResult, QemuRunResult, RegionEdit, Result, RunManifest,
    SkeletonFileEdit, SpecLintResult, ToolchainLintResult, ToolchainSpecBundle, VosError,
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

#[derive(Debug, serde::Deserialize)]
struct PatchFileInput {
    #[serde(default)]
    files_to_create: Vec<SkeletonFileEdit>,
    #[serde(default)]
    files_to_update: Vec<RegionEdit>,
    #[serde(default)]
    region_edits: Vec<RegionEdit>,
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
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let build_command = if spec_root.exists() {
        Some(derive_build_command(
            project_root,
            &vos_spec::load_toolchain_spec(project_root, &spec_root)?,
        ))
    } else {
        None
    };
    Ok(DoctorReport {
        provider_api_key_present: env::var(resolve_api_key_env(&config)).is_ok(),
        provider_kind: resolve_provider_kind(&config),
        api_key_env: resolve_api_key_env(&config).to_string(),
        model: resolve_model(&config),
        base_url: resolve_base_url(&config),
        build_command,
        project_root: project_root.to_path_buf(),
        writable: is_writable(project_root),
    })
}

pub fn lint_spec(project_root: &Path, module: &str, operation: &str) -> Result<SpecLintResult> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let bundle = vos_spec::load_spec_bundle(project_root, &spec_root, module, operation)?;
    Ok(SpecLintResult {
        ok: true,
        module: module.into(),
        operation: operation.into(),
        target_file: project_root.join(&bundle.operation_contract.llm_codegen.editable_region.file),
        required_followup_checks: bundle.operation_contract.llm_codegen.required_followup_checks,
    })
}

pub fn lint_architecture(project_root: &Path, architecture_path: Option<&Path>) -> Result<ArchitectureLintResult> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, architecture_path, &config)?;
    vos_spec::lint_architecture(project_root, &spec_root)
}

pub fn lint_toolchain(project_root: &Path) -> Result<ToolchainLintResult> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let bundle = vos_spec::load_toolchain_spec(project_root, &spec_root)?;
    Ok(ToolchainLintResult {
        ok: true,
        target_arch: bundle.toolchain.target_arch.clone(),
        target_triple: bundle.toolchain.target_triple.clone(),
        required_tools: bundle.environment.required_tools.clone(),
        emulator: bundle.run.emulator.clone(),
        success_signal: bundle.run.success_signal.clone(),
    })
}

pub fn normalize_spec(project_root: &Path, spec_path: Option<&Path>) -> Result<NormalizedSpecBundle> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, spec_path, &config)?;
    let normalized = vos_spec::load_normalized_spec_bundle(project_root, &spec_root)?;
    let normalized_dir = project_root.join(".vos").join("cache").join("normalized");
    fs::create_dir_all(&normalized_dir)?;
    write_json(
        &normalized_dir.join("architecture.json"),
        &normalized.architecture,
    )?;
    write_json(&normalized_dir.join("modules.json"), &normalized.modules)?;
    write_json(&normalized_dir.join("operations.json"), &normalized.operations)?;
    write_json(
        &normalized_dir.join("toolchain.json"),
        &normalized.toolchain_profiles,
    )?;
    write_json(&normalized_dir.join("bundle.json"), &normalized)?;
    Ok(normalized)
}

pub fn check_consistency(project_root: &Path, spec_path: Option<&Path>) -> Result<ConsistencyReport> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, spec_path, &config)?;
    let normalized = normalize_spec(project_root, Some(&spec_root))?;
    let report = vos_spec::check_consistency(project_root, &spec_root, &normalized)?;
    let run_dir = project_root.join(".vos").join("runs").join(new_run_id());
    fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("consistency-report.json"), &report)?;
    Ok(report)
}

pub fn compose_architecture(
    project_root: &Path,
    architecture_path: Option<&Path>,
) -> Result<ArchitectureComposeResult> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, architecture_path, &config)?;
    let stage = resolve_stage(project_root, &spec_root, architecture_path)?;
    let result = vos_spec::compose_architecture(project_root, &spec_root, &stage)?;
    let run_dir = project_root.join(".vos").join("runs").join(new_run_id());
    fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("compose-result.json"), &result)?;
    Ok(result)
}

pub fn derive_tests(
    project_root: &Path,
    architecture_path: Option<&Path>,
) -> Result<DerivedTestMatrix> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, architecture_path, &config)?;
    let stage = resolve_stage(project_root, &spec_root, architecture_path)?;
    let result = vos_spec::derive_tests(project_root, &spec_root, &stage)?;
    let run_dir = project_root.join(".vos").join("runs").join(new_run_id());
    fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("derived-tests.json"), &result)?;
    Ok(result)
}

pub fn agent_context(
    project_root: &Path,
    stage: Option<&str>,
    visibility: Option<&str>,
) -> Result<ContextBundle> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let normalized = normalize_spec(project_root, Some(&spec_root))?;
    let stage_name = stage
        .map(str::to_string)
        .unwrap_or_else(|| current_stage(&normalized).unwrap_or_else(|| "unknown".into()));
    let _compose = vos_spec::compose_architecture(project_root, &spec_root, &stage_name)?;
    Ok(ContextBundle {
        requested_scope: format!("stage:{stage_name}"),
        resolved_specs: normalized
            .hashes
            .keys()
            .cloned()
            .collect(),
        recent_evidence: recent_evidence_refs(project_root),
        allowed_paths: allowed_paths(&normalized, project_root),
        recommended_commands: vec![
            "vos spec normalize spec".into(),
            "vos spec check-consistency spec".into(),
            "vos agent plan".into(),
        ],
        visibility_scope: visibility.unwrap_or("public").to_string(),
    })
}

pub fn agent_plan(
    project_root: &Path,
    stage: Option<&str>,
    task: Option<&str>,
) -> Result<PlanDraft> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let normalized = normalize_spec(project_root, Some(&spec_root))?;
    let stage_name = stage
        .map(str::to_string)
        .unwrap_or_else(|| current_stage(&normalized).unwrap_or_else(|| "unknown".into()));
    let queue = vos_spec::build_generation_queue(project_root, &spec_root, &stage_name)?;
    let compose = vos_spec::compose_architecture(project_root, &spec_root, &stage_name)?;
    let plan = PlanDraft {
        task: task
            .unwrap_or("strict spec -> skeleton projection -> module generation -> build -> run")
            .to_string(),
        related_specs: normalized.hashes.keys().cloned().collect(),
        suspected_files: allowed_paths(&normalized, project_root),
        required_validations: vec![
            "spec normalize".into(),
            "spec check-consistency".into(),
            "arch compose".into(),
            "arch derive-tests".into(),
            "build".into(),
            "run qemu".into(),
        ],
        notes: vec![
            format!("current_stage={}", compose.current_stage),
            "skeleton projection runs before module batch codegen".into(),
            "module generation executes by dependency waves".into(),
        ],
        generation_waves: queue.waves,
    };
    let run_dir = project_root.join(".vos").join("runs").join(new_run_id());
    fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("agent-plan.json"), &plan)?;
    Ok(plan)
}

pub async fn agent_apply_patch(
    project_root: &Path,
    options: AgentApplyOptions,
    progress: Option<&ProgressSink>,
) -> Result<ApplyPatchResult> {
    let config = load_config(project_root)?;
    validate_provider_config(&config)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let normalized = normalize_spec(project_root, Some(&spec_root))?;
    emit(progress, "normalizing_spec", "normalized strict spec bundle");
    let consistency = vos_spec::check_consistency(project_root, &spec_root, &normalized)?;
    emit(progress, "checking_consistency", "checked cross-spec consistency");
    if !consistency.ok {
        return Err(VosError::Message(format!(
            "consistency check failed: {}",
            consistency.errors.join("; ")
        )));
    }
    let stage = options
        .stage
        .clone()
        .or_else(|| current_stage(&normalized))
        .ok_or_else(|| VosError::Message("no architecture stage found".into()))?;
    let compose = vos_spec::compose_architecture(project_root, &spec_root, &stage)?;
    emit(progress, "composing_architecture", "composed architecture graph");
    let _tests = vos_spec::derive_tests(project_root, &spec_root, &stage)?;
    emit(progress, "deriving_tests", "derived public build/run checks");
    let queue = vos_spec::build_generation_queue(project_root, &spec_root, &stage)?;
    let plan = agent_plan(project_root, Some(&stage), None)?;

    let run_id = new_run_id();
    let run_dir = project_root.join(".vos").join("runs").join(&run_id);
    let artifacts_dir = run_dir.join("artifacts");
    fs::create_dir_all(&artifacts_dir)?;
    write_json(&run_dir.join("consistency-report.json"), &consistency)?;
    write_json(&run_dir.join("compose-result.json"), &compose)?;
    write_json(&run_dir.join("agent-plan.json"), &plan)?;

    let mut created_files = Vec::new();
    let mut updated_regions = Vec::new();
    let mut build_result = None;
    let mut run_result = None;
    let allowed = allowed_paths(&normalized, project_root);

    let (skeleton_create, skeleton_update, module_region_edits) = if let Some(patch_path) = options.patch_path {
        let parsed = read_patch_file(&patch_path)?;
        (parsed.files_to_create, parsed.files_to_update, parsed.region_edits)
    } else {
        let api_key = env::var(resolve_api_key_env(&config))
            .map_err(|_| VosError::Message(format!("{} is required", resolve_api_key_env(&config))))?;
        emit(progress, "projecting_skeleton", "requesting skeleton projection");
        let skeleton_prompt =
            vos_prompt::build_skeleton_projection_prompt(&normalized, &compose, project_root);
        let skeleton_response = call_json_prompt(
            &api_key,
            &config,
            run_dir.join("skeleton_projection"),
            &skeleton_prompt,
        )
        .await?;
        let skeleton = vos_prompt::parse_skeleton_projection_response(&skeleton_response)
            .map_err(VosError::Message)?;
        let batch_region_edits =
            generate_module_waves(project_root, &config, &normalized, &queue, progress, &run_dir)
                .await?;
        (
            skeleton.files_to_create,
            skeleton.files_to_update,
            batch_region_edits,
        )
    };

    validate_skeleton_files(project_root, &allowed, &skeleton_create)?;
    validate_region_edits(project_root, &allowed, &skeleton_update)?;
    validate_region_edits(project_root, &allowed, &module_region_edits)?;

    if options.apply {
        emit(progress, "applying_code", "writing skeleton and region edits");
        for file in &skeleton_create {
            let absolute = project_root.join(&file.path);
            if let Some(parent) = absolute.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&absolute, &file.content)?;
            created_files.push(file.path.clone());
        }
        for edit in skeleton_update.iter().chain(module_region_edits.iter()) {
            apply_region_edit(project_root, edit)?;
            if !updated_regions.contains(&edit.file) {
                updated_regions.push(edit.file.clone());
            }
        }
        let build = build_with_progress(project_root, None, progress).await?;
        build_result = Some(build.clone());
        emit(progress, "building_system", "built generated system");
        if options.run_validation {
            let run = run_qemu_with_progress(project_root, None, progress).await?;
            run_result = Some(run.clone());
            emit(progress, "running_boot_smoke", "ran qemu boot smoke");
        }
    }

    let manifest = build_run_manifest(
        &run_id,
        "vos agent apply-patch",
        &normalized,
        &created_files,
        &updated_regions,
    );
    let manifest_path = run_dir.join("manifest.json");
    write_json(&manifest_path, &manifest)?;
    let result = ApplyPatchResult {
        run_id,
        created_files,
        updated_regions,
        build: build_result,
        run: run_result,
        manifest_path: manifest_path.clone(),
    };
    write_json(&run_dir.join("apply-patch-result.json"), &result)?;
    emit(progress, "finished", "agent apply-patch finished");
    Ok(result)
}

pub async fn verify_public(
    project_root: &Path,
    progress: Option<&ProgressSink>,
) -> Result<PublicVerifyResult> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let normalized = normalize_spec(project_root, Some(&spec_root))?;
    emit(progress, "normalizing_spec", "normalized strict spec bundle");
    let consistency = vos_spec::check_consistency(project_root, &spec_root, &normalized)?;
    emit(progress, "checking_consistency", "checked consistency");
    if !consistency.ok {
        return Err(VosError::Message(format!(
            "consistency check failed: {}",
            consistency.errors.join("; ")
        )));
    }
    let build = build_with_progress(project_root, None, progress).await?;
    let run = run_qemu_with_progress(project_root, None, progress).await?;
    emit(progress, "finished", "public verification finished");
    Ok(PublicVerifyResult {
        normalize_ok: true,
        consistency_ok: true,
        required_checks: normalized.architecture.toolchain.validation.must_pass.clone(),
        build,
        run,
    })
}

pub async fn build(project_root: &Path, profile: Option<String>) -> Result<BuildResult> {
    build_with_progress(project_root, profile, None).await
}

pub async fn build_with_progress(
    project_root: &Path,
    profile: Option<String>,
    progress: Option<&ProgressSink>,
) -> Result<BuildResult> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let toolchain = vos_spec::load_toolchain_spec(project_root, &spec_root)?;
    let build_request = BuildRequest {
        command: derive_build_command(project_root, &toolchain),
        cwd: project_root.to_path_buf(),
        profile,
        generated_artifacts: toolchain.build.generated_artifacts.clone(),
    };
    let run_dir = project_root.join(".vos").join("runs").join(new_run_id());
    fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("toolchain-resolved.json"), &toolchain)?;
    emit(progress, "building_system", "building system artifacts");
    run_build(&run_dir, build_request).await
}

pub async fn run_qemu(project_root: &Path, profile: Option<String>) -> Result<QemuRunResult> {
    run_qemu_with_progress(project_root, profile, None).await
}

pub async fn run_qemu_with_progress(
    project_root: &Path,
    _profile: Option<String>,
    progress: Option<&ProgressSink>,
) -> Result<QemuRunResult> {
    let config = load_config(project_root)?;
    let spec_root = resolve_spec_root(project_root, None, &config)?;
    let toolchain = vos_spec::load_toolchain_spec(project_root, &spec_root)?;
    let kernel_artifact = resolve_kernel_artifact(project_root, &toolchain)?;
    if !kernel_artifact.exists() {
        return Err(VosError::Message(format!(
            "required artifact missing: {}",
            kernel_artifact.display()
        )));
    }
    let run_dir = project_root.join(".vos").join("runs").join(new_run_id());
    fs::create_dir_all(&run_dir)?;
    write_json(&run_dir.join("toolchain-resolved.json"), &toolchain)?;
    emit(progress, "building_system", "resolved build artifacts");
    emit(progress, "running_boot_smoke", "launching emulator");
    let command = build_qemu_command(project_root, &toolchain);
    let started = Instant::now();
    let (program, args) = build_qemu_invocation(project_root, &toolchain)?;
    let (exit_code, output) =
        program_with_timeout(&program, &args, project_root, toolchain.run.timeout_secs).await?;
    let duration_ms = started.elapsed().as_millis();
    let log_path = run_dir.join("qemu.log");
    fs::write(&log_path, format!("$ {command}\n{output}"))?;
    let detected_signal = if output.contains(&toolchain.run.success_signal) {
        Some(toolchain.run.success_signal.clone())
    } else {
        None
    };
    let result = QemuRunResult {
        command,
        success: detected_signal.is_some(),
        exit_code,
        detected_signal,
        log_path: log_path.clone(),
        duration_ms,
    };
    write_json(&run_dir.join("smoke-result.json"), &result)?;
    emit(progress, "finished", "emulator run finished");
    Ok(result)
}

fn resolve_spec_root(project_root: &Path, input: Option<&Path>, config: &AppConfig) -> Result<PathBuf> {
    if let Some(path) = input {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            project_root.join(path)
        };
        for candidate in absolute.ancestors() {
            if candidate.join("architecture").exists()
                && candidate.join("modules").exists()
                && candidate.join("toolchain").exists()
            {
                return candidate
                    .strip_prefix(project_root)
                    .map(Path::to_path_buf)
                    .map_err(|_| VosError::Message("spec root must be inside project root".into()));
            }
        }
        return Err(VosError::Message(format!(
            "could not resolve strict spec root from {}",
            absolute.display()
        )));
    }
    Ok(config
        .spec_root
        .clone()
        .unwrap_or_else(|| PathBuf::from("spec")))
}

fn resolve_stage(project_root: &Path, spec_root: &Path, input: Option<&Path>) -> Result<String> {
    if let Some(path) = input {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            project_root.join(path)
        };
        if absolute
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            == Some("slices")
        {
            let value: serde_yaml::Value = serde_yaml::from_str(&fs::read_to_string(absolute)?)?;
            if let Some(stage) = value.get("stage").and_then(|item| item.as_str()) {
                return Ok(stage.to_string());
            }
        }
    }
    let normalized = vos_spec::load_normalized_spec_bundle(project_root, spec_root)?;
    current_stage(&normalized).ok_or_else(|| VosError::Message("no architecture stage found".into()))
}

fn current_stage(normalized: &NormalizedSpecBundle) -> Option<String> {
    normalized
        .architecture
        .slices
        .last()
        .map(|slice| slice.stage.clone())
}

fn validate_provider_config(config: &AppConfig) -> Result<()> {
    let kind = resolve_provider_kind(config);
    if kind != "openai-compatible" && kind != "openai" {
        return Err(VosError::Message(format!(
            "unsupported provider.kind `{kind}`; use `openai-compatible`"
        )));
    }
    let env_name = resolve_api_key_env(config);
    if !is_valid_env_var_name(env_name) {
        return Err(VosError::Message(format!(
            "provider.api_key_env must be an environment variable name, got `{env_name}`"
        )));
    }
    Ok(())
}

fn load_project_dotenv(project_root: &Path) {
    let dotenv_path = project_root.join(".env");
    if dotenv_path.exists() {
        let _ = dotenvy::from_path(dotenv_path);
    }
}

fn resolve_model(config: &AppConfig) -> String {
    config.provider.model.clone().unwrap_or_else(|| "gpt-5.4".into())
}

fn resolve_base_url(config: &AppConfig) -> String {
    config
        .provider
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.openai.com/v1".into())
}

fn resolve_provider_kind(config: &AppConfig) -> String {
    config
        .provider
        .kind
        .clone()
        .unwrap_or_else(|| "openai-compatible".into())
}

fn resolve_api_key_env(config: &AppConfig) -> &str {
    config
        .provider
        .api_key_env
        .as_deref()
        .unwrap_or("OPENAI_API_KEY")
}

fn resolve_timeout_secs(config: &AppConfig) -> u64 {
    config.provider.timeout_secs.unwrap_or(120)
}

fn resolve_kernel_artifact(project_root: &Path, toolchain: &ToolchainSpecBundle) -> Result<PathBuf> {
    let artifact = toolchain
        .image
        .required_artifacts
        .first()
        .or_else(|| toolchain.build.generated_artifacts.first())
        .ok_or_else(|| VosError::Message("toolchain image.required_artifacts must not be empty".into()))?;
    Ok(project_root.join(artifact))
}

fn derive_build_command(project_root: &Path, toolchain: &ToolchainSpecBundle) -> String {
    let objects_dir = project_root.join(".vos").join("build");
    let object_paths = toolchain
        .build
        .sources
        .iter()
        .map(|source| {
            let stem = source
                .file_stem()
                .and_then(|item| item.to_str())
                .unwrap_or("object");
            objects_dir.join(format!("{stem}.o"))
        })
        .collect::<Vec<_>>();
    let mut commands = Vec::new();
    commands.push(format!(
        "New-Item -ItemType Directory -Force -Path \"{}\" | Out-Null",
        objects_dir.display()
    ));
    for (source, object) in toolchain.build.sources.iter().zip(object_paths.iter()) {
        let extension = source.extension().and_then(|ext| ext.to_str()).unwrap_or("");
        let compiler = if matches!(extension, "S" | "s" | "asm") {
            &toolchain.toolchain.asm_compiler
        } else {
            &toolchain.toolchain.c_compiler
        };
        let flags = if matches!(extension, "S" | "s" | "asm") {
            toolchain.build.asmflags.clone()
        } else {
            toolchain.build.cflags.clone()
        };
        let includes = toolchain
            .build
            .include_paths
            .iter()
            .map(|path| format!("-I\"{}\"", project_root.join(path).display()))
            .collect::<Vec<_>>();
        commands.push(format!(
            "& \"{compiler}\" {} {} -c \"{}\" -o \"{}\"",
            flags.join(" "),
            includes.join(" "),
            project_root.join(source).display(),
            object.display()
        ));
    }
    let output = resolve_kernel_artifact(project_root, toolchain)
        .unwrap_or_else(|_| project_root.join("build/kernel.elf"));
    if let Some(parent) = output.parent() {
        commands.push(format!(
            "New-Item -ItemType Directory -Force -Path \"{}\" | Out-Null",
            parent.display()
        ));
    }
    commands.push(format!(
        "& \"{}\" -T \"{}\" {} -o \"{}\" {}",
        toolchain.toolchain.linker,
        project_root.join(&toolchain.link.linker_script).display(),
        toolchain.build.ldflags.join(" "),
        output.display(),
        object_paths
            .iter()
            .map(|path| format!("\"{}\"", path.display()))
            .collect::<Vec<_>>()
            .join(" ")
    ));
    commands.join("; ")
}

async fn run_build(run_dir: &Path, build_request: BuildRequest) -> Result<BuildResult> {
    let (exit_code, text) =
        shell_command_with_timeout(&build_request.command, &build_request.cwd, 600).await?;
    let log_path = run_dir.join("build.log");
    fs::write(&log_path, format!("$ {}\n{}", build_request.command, text))?;
    Ok(BuildResult {
        command: build_request.command,
        success: exit_code == Some(0),
        exit_code,
        log_path,
        generated_artifacts: build_request.generated_artifacts,
    })
}

fn build_qemu_command(project_root: &Path, toolchain: &ToolchainSpecBundle) -> String {
    let (program, args) = build_qemu_invocation(project_root, toolchain)
        .unwrap_or_else(|_| (toolchain.run.emulator.clone(), Vec::new()));
    std::iter::once(program)
        .chain(args)
        .map(shell_quote)
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_qemu_invocation(
    project_root: &Path,
    toolchain: &ToolchainSpecBundle,
) -> Result<(String, Vec<String>)> {
    let kernel = resolve_kernel_artifact(project_root, toolchain)?;
    let mut args = vec![
        "-machine".to_string(),
        toolchain.run.machine.clone(),
        "-cpu".to_string(),
        toolchain.run.cpu.clone(),
        "-m".to_string(),
        toolchain.run.memory.clone(),
    ];
    if let Some(bios) = &toolchain.run.bios {
        args.push("-bios".to_string());
        args.push(bios.clone());
    }
    args.push(toolchain.run.kernel_arg.clone());
    args.push(kernel.display().to_string());
    args.extend(toolchain.run.extra_args.iter().cloned());
    Ok((toolchain.run.emulator.clone(), args))
}

async fn shell_command_with_timeout(
    command: &str,
    cwd: &Path,
    timeout_secs: u64,
) -> Result<(Option<i32>, String)> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("powershell");
        c.arg("-NoProfile").arg("-Command").arg(command);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-lc").arg(command);
        c
    };
    let fut = cmd
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    let output = timeout(Duration::from_secs(timeout_secs), fut)
        .await
        .map_err(|_| VosError::Message(format!("command timed out after {timeout_secs}s: {command}")))??;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    Ok((output.status.code(), text))
}

async fn program_with_timeout(
    program: &str,
    args: &[String],
    cwd: &Path,
    timeout_secs: u64,
) -> Result<(Option<i32>, String)> {
    let fut = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    let output = timeout(Duration::from_secs(timeout_secs), fut)
        .await
        .map_err(|_| VosError::Message(format!("command timed out after {timeout_secs}s: {program}")))??;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    Ok((output.status.code(), text))
}

async fn call_json_prompt(
    api_key: &str,
    config: &AppConfig,
    run_dir: PathBuf,
    prompt: &vos_core::PromptEnvelope,
) -> Result<String> {
    fs::create_dir_all(&run_dir)?;
    let request = CodegenRequest {
        spec_ref: prompt.spec_ref.clone(),
        phase: prompt.phase.clone(),
        model: resolve_model(config),
        prompt: prompt.prompt.clone(),
    };
    write_json(&run_dir.join("request.json"), &request)?;
    fs::write(run_dir.join("prompt.txt"), &prompt.prompt)?;
    let response = vos_openai::generate_code(
        api_key,
        &resolve_base_url(config),
        resolve_timeout_secs(config),
        &request,
    )
    .await?;
    fs::write(run_dir.join("response.txt"), &response.raw_text)?;
    Ok(response.extracted_code)
}

async fn generate_module_waves(
    project_root: &Path,
    config: &AppConfig,
    normalized: &NormalizedSpecBundle,
    queue: &vos_core::GenerationQueue,
    progress: Option<&ProgressSink>,
    run_dir: &Path,
) -> Result<Vec<RegionEdit>> {
    let api_key = env::var(resolve_api_key_env(config))
        .map_err(|_| VosError::Message(format!("{} is required", resolve_api_key_env(config))))?;
    let mut edits = Vec::new();
    for (wave_index, wave) in queue.waves.iter().enumerate() {
        let mut set = JoinSet::new();
        for module_name in wave {
            let module_spec = normalized
                .modules
                .iter()
                .find(|module| &module.module == module_name)
                .ok_or_else(|| VosError::Message(format!("module spec not found: {module_name}")))?
                .clone();
            let operations = normalized
                .operations
                .iter()
                .filter(|op| op.module == *module_name)
                .cloned()
                .collect::<Vec<_>>();
            let concurrency = normalized
                .modules
                .iter()
                .find(|module| module.module == *module_name)
                .and_then(|_| vos_spec::load_concurrency_spec(
                    project_root,
                    &resolve_spec_root(project_root, None, config).unwrap_or_else(|_| PathBuf::from("spec")),
                    module_name,
                ).ok().flatten());
            let prompt = vos_prompt::build_module_codegen_batch_prompt(
                &module_spec,
                &operations,
                concurrency.as_ref(),
                normalized,
                project_root,
            );
            let module_run_dir = run_dir.join(format!("module_{}", module_name));
            let api_key = api_key.clone();
            let config = config.clone();
            emit_entity(
                progress,
                "generating_module",
                "sending module batch prompt",
                "module",
                Some(module_name),
                Some(wave_index + 1),
                Some(queue.waves.len()),
            );
            set.spawn(async move {
                let raw = call_json_prompt(&api_key, &config, module_run_dir, &prompt).await?;
                vos_prompt::parse_module_batch_response(&raw).map_err(VosError::Message)
            });
        }
        while let Some(joined) = set.join_next().await {
            let batch = joined.map_err(|err| VosError::Message(err.to_string()))??;
            edits.extend(batch.region_edits);
        }
    }
    Ok(edits)
}

fn read_patch_file(path: &Path) -> Result<PatchFileInput> {
    let mut content = String::new();
    fs::File::open(path)?.read_to_string(&mut content)?;
    serde_json::from_str(&content).map_err(|err| VosError::Message(format!("invalid patch file: {err}")))
}

fn validate_skeleton_files(
    project_root: &Path,
    allowed_paths: &[PathBuf],
    files: &[SkeletonFileEdit],
) -> Result<()> {
    for file in files {
        let absolute = project_root.join(&file.path);
        if !is_allowed_path(&absolute, allowed_paths) {
            return Err(VosError::Message(format!(
                "skeleton file outside allowed paths: {}",
                file.path.display()
            )));
        }
    }
    Ok(())
}

fn validate_region_edits(
    project_root: &Path,
    allowed_paths: &[PathBuf],
    edits: &[RegionEdit],
) -> Result<()> {
    for edit in edits {
        let absolute = project_root.join(&edit.file);
        if !is_allowed_path(&absolute, allowed_paths) {
            return Err(VosError::Message(format!(
                "region edit outside allowed paths: {}",
                edit.file.display()
            )));
        }
    }
    Ok(())
}

fn allowed_paths(normalized: &NormalizedSpecBundle, project_root: &Path) -> Vec<PathBuf> {
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

fn is_allowed_path(candidate: &Path, allowed_paths: &[PathBuf]) -> bool {
    allowed_paths.iter().any(|allowed| {
        candidate == allowed
            || allowed.extension().is_none() && candidate.starts_with(allowed)
    })
}

fn apply_region_edit(project_root: &Path, edit: &RegionEdit) -> Result<()> {
    let target_file = project_root.join(&edit.file);
    let content = fs::read_to_string(&target_file)?;
    let start = content
        .find(&edit.start_marker)
        .ok_or_else(|| VosError::Message(format!("start marker not found in {}", edit.file.display())))?;
    let end = content
        .find(&edit.end_marker)
        .ok_or_else(|| VosError::Message(format!("end marker not found in {}", edit.file.display())))?;
    if end <= start {
        return Err(VosError::Message(format!(
            "editable region markers reversed in {}",
            edit.file.display()
        )));
    }
    let prefix = &content[..start + edit.start_marker.len()];
    let suffix = &content[end..];
    let new_content = format!("{prefix}\n{}\n{suffix}", edit.code);
    fs::write(target_file, new_content)?;
    Ok(())
}

fn build_run_manifest(
    run_id: &str,
    command: &str,
    normalized: &NormalizedSpecBundle,
    created_files: &[PathBuf],
    updated_regions: &[PathBuf],
) -> RunManifest {
    RunManifest {
        run_id: run_id.to_string(),
        command: command.to_string(),
        arguments: Vec::new(),
        git_rev: None,
        spec_hash: stable_bundle_hash(normalized),
        projection_version: "strict-doc-v1".into(),
        started_at: timestamp_now(),
        finished_at: None,
        status: "ok".into(),
        artifacts: created_files
            .iter()
            .chain(updated_regions.iter())
            .cloned()
            .collect(),
        evidence_refs: Vec::new(),
    }
}

fn recent_evidence_refs(project_root: &Path) -> Vec<String> {
    let runs_dir = project_root.join(".vos").join("runs");
    if !runs_dir.exists() {
        return Vec::new();
    }
    let mut refs = fs::read_dir(runs_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(|entry| entry.ok()))
        .map(|entry| entry.path().display().to_string())
        .collect::<Vec<_>>();
    refs.sort();
    refs.into_iter().rev().take(5).collect()
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}

fn stable_bundle_hash(normalized: &NormalizedSpecBundle) -> String {
    normalized
        .hashes
        .values()
        .cloned()
        .collect::<Vec<_>>()
        .join(":")
}

fn timestamp_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn shell_quote(value: String) -> String {
    if value.contains([' ', '\t', '"']) {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value
    }
}

fn is_writable(project_root: &Path) -> bool {
    let probe = project_root.join(".vos-write-probe");
    let write = fs::write(&probe, "ok");
    let _ = fs::remove_file(&probe);
    write.is_ok()
}

fn emit(progress: Option<&ProgressSink>, stage: &str, message: &str) {
    if let Some(cb) = progress {
        cb(ProgressEvent {
            stage: stage.into(),
            message: message.into(),
            entity_kind: None,
            entity_id: None,
            position: None,
            total: None,
        });
    }
}

fn emit_entity(
    progress: Option<&ProgressSink>,
    stage: &str,
    message: &str,
    entity_kind: &str,
    entity_id: Option<&str>,
    position: Option<usize>,
    total: Option<usize>,
) {
    if let Some(cb) = progress {
        cb(ProgressEvent {
            stage: stage.into(),
            message: message.into(),
            entity_kind: Some(entity_kind.into()),
            entity_id: entity_id.map(str::to_string),
            position,
            total,
        });
    }
}
