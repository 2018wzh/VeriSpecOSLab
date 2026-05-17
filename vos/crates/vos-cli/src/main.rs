use clap::{Args, Parser, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vos_core::{
    artifact, envelope, not_implemented_payload, CommandEnvelope, CommandStatus, DiagnosticPayload,
    FailurePayload, NotImplementedPayload, ProgressEvent,
};

const TOOLCHAIN_DOC: &str = "/E:/文件/ECNU/比赛/OS/VeriSpecOSLab/docs/design/toolchain/06-adapters-and-command-model.md";
const AGENT_DOC: &str = "/E:/文件/ECNU/比赛/OS/VeriSpecOSLab/docs/design/toolchain/07-agent-gateway.md";

#[derive(Parser)]
#[command(name = "vos")]
struct Cli {
    #[arg(long, default_value = ".")]
    project_root: PathBuf,
    #[arg(long, default_value_t = false)]
    json: bool,
    #[arg(long)]
    report: Option<PathBuf>,
    #[arg(long)]
    evidence_dir: Option<PathBuf>,
    #[arg(long)]
    agent_session: Option<String>,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Init,
    Stage {
        #[command(subcommand)]
        command: StageCommands,
    },
    Spec {
        #[command(subcommand)]
        command: SpecCommands,
    },
    Arch {
        #[command(subcommand)]
        command: ArchCommands,
    },
    Build(BuildArgs),
    Run {
        #[command(subcommand)]
        command: RunCommands,
    },
    Test(TestArgs),
    Verify {
        #[command(subcommand)]
        command: VerifyCommands,
    },
    Trace {
        #[command(subcommand)]
        command: TraceCommands,
    },
    Debug {
        #[command(subcommand)]
        command: DebugCommands,
    },
    Agent {
        #[command(subcommand)]
        command: AgentCommands,
    },
    Report {
        #[command(subcommand)]
        command: ReportCommands,
    },
    Submit {
        #[command(subcommand)]
        command: SubmitCommands,
    },
}

#[derive(Subcommand)]
enum StageCommands {
    Show,
}

#[derive(Subcommand)]
enum SpecCommands {
    Lint(SpecPathArgs),
    Normalize(SpecPathArgs),
    CheckConsistency(SpecPathArgs),
    Patch {
        #[command(subcommand)]
        command: SpecPatchCommands,
    },
}

#[derive(Subcommand)]
enum SpecPatchCommands {
    Lint(PatchPathArgs),
    Apply(PatchPathArgs),
}

#[derive(Subcommand)]
enum ArchCommands {
    Lint(ArchPathArgs),
    Compose(ArchPathArgs),
    DeriveTests(ArchPathArgs),
}

#[derive(Args)]
struct BuildArgs {
    #[arg(long)]
    profile: Option<String>,
}

#[derive(Subcommand)]
enum RunCommands {
    Qemu(BuildArgs),
}

#[derive(Args)]
struct TestArgs {
    #[arg(long)]
    suite: Option<String>,
}

#[derive(Subcommand)]
enum VerifyCommands {
    Public,
    Patch(PatchPathArgs),
    Full,
    Invariant,
    Fuzz,
}

#[derive(Subcommand)]
enum TraceCommands {
    Syscall,
}

#[derive(Subcommand)]
enum DebugCommands {
    ExplainLog(DebugExplainArgs),
}

#[derive(Subcommand)]
enum AgentCommands {
    Serve(AgentServeArgs),
    Context(AgentContextArgs),
    Plan(AgentPlanArgs),
    ApplyPatch(AgentApplyPatchArgs),
    Log,
}

#[derive(Subcommand)]
enum ReportCommands {
    Generate,
}

#[derive(Subcommand)]
enum SubmitCommands {
    Pack,
}

#[derive(Args)]
struct SpecPathArgs {
    spec_path: PathBuf,
}

#[derive(Args)]
struct ArchPathArgs {
    architecture_path: PathBuf,
}

#[derive(Args)]
struct PatchPathArgs {
    patch_path: PathBuf,
}

#[derive(Args)]
struct DebugExplainArgs {
    log_path: PathBuf,
}

#[derive(Args)]
struct AgentServeArgs {
    #[arg(long)]
    host: Option<String>,
    #[arg(long)]
    port: Option<u16>,
}

#[derive(Args)]
struct AgentContextArgs {
    #[arg(long)]
    spec_path: Option<PathBuf>,
    #[arg(long)]
    log_path: Option<PathBuf>,
    #[arg(long)]
    stage: Option<String>,
    #[arg(long)]
    visibility: Option<String>,
}

#[derive(Args)]
struct AgentPlanArgs {
    #[arg(long)]
    task: Option<String>,
    #[arg(long)]
    spec_path: Option<PathBuf>,
    #[arg(long)]
    log_path: Option<PathBuf>,
    #[arg(long)]
    stage: Option<String>,
}

#[derive(Args)]
struct AgentApplyPatchArgs {
    patch_path: Option<PathBuf>,
    #[arg(long, default_value_t = false)]
    apply: bool,
    #[arg(long, default_value_t = false)]
    require_spec: bool,
    #[arg(long, default_value_t = false)]
    run_validation: bool,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let project_root = if cli.project_root.is_absolute() {
        cli.project_root.clone()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(&cli.project_root))
            .unwrap_or_else(|_| cli.project_root.clone())
    };

    let progress = if cli.json { None } else { Some(make_progress()) };
    let progress_cb = progress.as_ref().map(|pb| {
        let pb = Arc::clone(pb);
        Arc::new(move |event: ProgressEvent| {
            let entity = match (&event.entity_kind, &event.entity_id) {
                (Some(kind), Some(id)) => format!(" [{kind}:{id}]"),
                (Some(kind), None) => format!(" [{kind}]"),
                _ => String::new(),
            };
            let counter = match (event.position, event.total) {
                (Some(position), Some(total)) => format!(" ({position}/{total})"),
                _ => String::new(),
            };
            pb.set_message(format!(
                "{}{}{}: {}",
                event.stage, counter, entity, event.message
            ));
            pb.tick();
            if event.stage == "finished" {
                pb.finish_and_clear();
            }
        }) as Arc<dyn Fn(ProgressEvent) + Send + Sync>
    });

    let result = match cli.command {
        Commands::Init => emit_envelope(
            cli.json,
            not_implemented(
                "vos init",
                "init workflow is documented but not implemented in the current runtime",
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos arch lint spec/architecture/seed.yaml".into()],
            ),
        ),
        Commands::Stage {
            command: StageCommands::Show,
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos stage show",
                "stage introspection is documented but not implemented in the current runtime",
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos arch lint spec/architecture/seed.yaml".into()],
            ),
        ),
        Commands::Spec {
            command: SpecCommands::Lint(args),
        } => emit_result(
            cli.json,
            "vos spec lint",
            spec_lint_envelope(&project_root, &args.spec_path),
        ),
        Commands::Spec {
            command: SpecCommands::Normalize(args),
        } => emit_result(
            cli.json,
            "vos spec normalize",
            spec_normalize_envelope(&project_root, &args.spec_path),
        ),
        Commands::Spec {
            command: SpecCommands::CheckConsistency(args),
        } => emit_result(
            cli.json,
            "vos spec check-consistency",
            spec_check_consistency_envelope(&project_root, &args.spec_path),
        ),
        Commands::Spec {
            command: SpecCommands::Patch {
                command: SpecPatchCommands::Lint(args),
            },
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos spec patch lint",
                format!(
                    "patch lint is not implemented yet for {}",
                    args.patch_path.display()
                ),
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos spec check-consistency spec/".into()],
            ),
        ),
        Commands::Spec {
            command: SpecCommands::Patch {
                command: SpecPatchCommands::Apply(args),
            },
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos spec patch apply",
                format!(
                    "patch apply is not implemented yet for {}",
                    args.patch_path.display()
                ),
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos spec patch lint <patch-path>".into()],
            ),
        ),
        Commands::Arch {
            command: ArchCommands::Lint(args),
        } => emit_result(
            cli.json,
            "vos arch lint",
            arch_lint_envelope(&project_root, &args.architecture_path),
        ),
        Commands::Arch {
            command: ArchCommands::Compose(args),
        } => emit_result(
            cli.json,
            "vos arch compose",
            arch_compose_envelope(&project_root, &args.architecture_path),
        ),
        Commands::Arch {
            command: ArchCommands::DeriveTests(args),
        } => emit_result(
            cli.json,
            "vos arch derive-tests",
            arch_derive_tests_envelope(&project_root, &args.architecture_path),
        ),
        Commands::Build(args) => emit_async_result(
            cli.json,
            "vos build",
            build_envelope(&project_root, args.profile, progress_cb.as_deref()).await,
        ),
        Commands::Run {
            command: RunCommands::Qemu(args),
        } => emit_async_result(
            cli.json,
            "vos run qemu",
            run_qemu_envelope(&project_root, args.profile, progress_cb.as_deref()).await,
        ),
        Commands::Test(_args) => emit_envelope(
            cli.json,
            not_implemented(
                "vos test",
                "test adapter orchestration is documented but not implemented in the current runtime",
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos verify public".into()],
            ),
        ),
        Commands::Verify {
            command: VerifyCommands::Public,
        } => emit_async_result(
            cli.json,
            "vos verify public",
            verify_public_envelope(&project_root, progress_cb.as_deref()).await,
        ),
        Commands::Verify {
            command: VerifyCommands::Patch(args),
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos verify patch",
                format!(
                    "patch verification DAG is not implemented yet for {}",
                    args.patch_path.display()
                ),
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos spec patch lint <patch-path>".into()],
            ),
        ),
        Commands::Verify {
            command: VerifyCommands::Full,
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos verify full",
                "full verification including private checks is not implemented yet",
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos verify public".into()],
            ),
        ),
        Commands::Verify {
            command: VerifyCommands::Invariant,
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos verify invariant",
                "invariant checking is not implemented yet",
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos spec check-consistency spec/".into()],
            ),
        ),
        Commands::Verify {
            command: VerifyCommands::Fuzz,
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos verify fuzz",
                "fuzz orchestration is not implemented yet",
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos verify public".into()],
            ),
        ),
        Commands::Trace {
            command: TraceCommands::Syscall,
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos trace syscall",
                "syscall tracing is not implemented yet",
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos run qemu".into()],
            ),
        ),
        Commands::Debug {
            command: DebugCommands::ExplainLog(args),
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos debug explain-log",
                format!(
                    "log explanation is not implemented yet for {}",
                    args.log_path.display()
                ),
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos build --json".into(), "vos run qemu --json".into()],
            ),
        ),
        Commands::Agent {
            command: AgentCommands::Serve(_args),
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos agent serve",
                "agent gateway is documented but not implemented in the current runtime",
                vec![AGENT_DOC.into()],
                vec!["vos spec lint spec/modules/...".into()],
            ),
        ),
        Commands::Agent {
            command: AgentCommands::Context(args),
        } => emit_result(
            cli.json,
            "vos agent context",
            agent_context_envelope(
                &project_root,
                args.stage.as_deref(),
                args.visibility.as_deref(),
            ),
        ),
        Commands::Agent {
            command: AgentCommands::Plan(args),
        } => emit_result(
            cli.json,
            "vos agent plan",
            agent_plan_envelope(&project_root, args.stage.as_deref(), args.task.as_deref()),
        ),
        Commands::Agent {
            command: AgentCommands::ApplyPatch(args),
        } => emit_async_result(
            cli.json,
            "vos agent apply-patch",
            agent_apply_patch_envelope(&project_root, args, progress_cb.as_deref()).await,
        ),
        Commands::Agent {
            command: AgentCommands::Log,
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos agent log",
                "agent collaboration log is documented but not implemented in the current runtime",
                vec![AGENT_DOC.into()],
                vec!["vos report generate".into()],
            ),
        ),
        Commands::Report {
            command: ReportCommands::Generate,
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos report generate",
                "report generation is documented but not implemented in the current runtime",
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos build".into(), "vos run qemu".into()],
            ),
        ),
        Commands::Submit {
            command: SubmitCommands::Pack,
        } => emit_envelope(
            cli.json,
            not_implemented(
                "vos submit pack",
                "submission packaging is documented but not implemented in the current runtime",
                vec![TOOLCHAIN_DOC.into()],
                vec!["vos report generate".into()],
            ),
        ),
    };

    if let Err(err) = result {
        if let Some(pb) = progress {
            pb.finish_and_clear();
        }
        let failure = envelope(
            "vos",
            CommandStatus::Failed,
            Vec::new(),
            FailurePayload {
                kind: "runtime_error".into(),
                message: err,
                diagnostics: Vec::new(),
            },
        );
        print_envelope(cli.json, &failure).expect("failed to print envelope");
        std::process::exit(1);
    }
}

fn make_progress() -> Arc<ProgressBar> {
    let pb = Arc::new(ProgressBar::new_spinner());
    pb.set_style(
        ProgressStyle::with_template("{spinner:.green} {msg}")
            .unwrap()
            .tick_strings(&["-", "\\", "|", "/"]),
    );
    pb.enable_steady_tick(std::time::Duration::from_millis(100));
    pb
}

fn emit_envelope<T: serde::Serialize + std::fmt::Debug>(
    json: bool,
    envelope: CommandEnvelope<T>,
) -> Result<(), String> {
    print_envelope(json, &envelope)
}

fn emit_result<T: serde::Serialize + std::fmt::Debug>(
    json: bool,
    command: &str,
    value: Result<CommandEnvelope<T>, String>,
) -> Result<(), String> {
    match value {
        Ok(envelope) => print_envelope(json, &envelope),
        Err(err) => {
            let envelope = envelope(
                command,
                CommandStatus::Failed,
                Vec::new(),
                FailurePayload {
                    kind: "runtime_error".into(),
                    message: err,
                    diagnostics: Vec::new(),
                },
            );
            print_envelope(json, &envelope)
        }
    }
}

fn emit_async_result<T: serde::Serialize + std::fmt::Debug>(
    json: bool,
    command: &str,
    value: Result<CommandEnvelope<T>, String>,
) -> Result<(), String> {
    emit_result(json, command, value)
}

fn print_envelope<T: serde::Serialize + std::fmt::Debug>(
    json: bool,
    envelope: &CommandEnvelope<T>,
) -> Result<(), String> {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(envelope).map_err(|e| e.to_string())?
        );
    } else {
        println!("{envelope:#?}");
    }
    Ok(())
}

fn not_implemented(
    command: &str,
    reason: impl Into<String>,
    related_docs: Vec<String>,
    suggested_next_commands: Vec<String>,
) -> CommandEnvelope<NotImplementedPayload> {
    envelope(
        command,
        CommandStatus::NotImplemented,
        Vec::new(),
        not_implemented_payload(reason, related_docs, suggested_next_commands),
    )
}

fn spec_lint_envelope(
    project_root: &Path,
    spec_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let (module, operation) =
        infer_module_operation_from_spec_path(project_root, spec_path).map_err(|e| e.to_string())?;
    let payload = vos_runtime::lint_spec(project_root, &module, &operation)
        .map_err(|e| e.to_string())?;
    let artifacts = vec![artifact("spec_path", spec_path.display().to_string())];
    Ok(envelope(
        "vos spec lint",
        CommandStatus::Ok,
        artifacts,
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

fn spec_normalize_envelope(
    project_root: &Path,
    spec_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload =
        vos_runtime::normalize_spec(project_root, Some(spec_path)).map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos spec normalize",
        CommandStatus::Ok,
        vec![artifact("spec_path", spec_path.display().to_string())],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

fn spec_check_consistency_envelope(
    project_root: &Path,
    spec_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload =
        vos_runtime::check_consistency(project_root, Some(spec_path)).map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos spec check-consistency",
        if payload.ok {
            CommandStatus::Ok
        } else {
            CommandStatus::Failed
        },
        vec![artifact("spec_path", spec_path.display().to_string())],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

fn arch_lint_envelope(
    project_root: &Path,
    architecture_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    match vos_runtime::lint_architecture(project_root, Some(architecture_path)) {
        Ok(payload) => Ok(envelope(
            "vos arch lint",
            CommandStatus::Ok,
            vec![artifact(
                "architecture_path",
                architecture_path.display().to_string(),
            )],
            serde_json::to_value(payload).map_err(|e| e.to_string())?,
        )),
        Err(err) => Ok(envelope(
            "vos arch lint",
            CommandStatus::Failed,
            vec![artifact(
                "architecture_path",
                architecture_path.display().to_string(),
            )],
            serde_json::to_value(DiagnosticPayload {
                kind: "schema_mismatch".into(),
                message: err.to_string(),
                diagnostics: vec![
                    "current architecture parser is not yet aligned with the documented schema".into(),
                    format!("input: {}", architecture_path.display()),
                ],
            })
            .map_err(|e| e.to_string())?,
        )),
    }
}

fn arch_compose_envelope(
    project_root: &Path,
    architecture_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::compose_architecture(project_root, Some(architecture_path))
        .map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos arch compose",
        CommandStatus::Ok,
        vec![artifact(
            "architecture_path",
            architecture_path.display().to_string(),
        )],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

fn arch_derive_tests_envelope(
    project_root: &Path,
    architecture_path: &Path,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::derive_tests(project_root, Some(architecture_path))
        .map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos arch derive-tests",
        CommandStatus::Ok,
        vec![artifact(
            "architecture_path",
            architecture_path.display().to_string(),
        )],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

async fn build_envelope(
    project_root: &Path,
    profile: Option<String>,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::build_with_progress(project_root, profile, progress)
        .await
        .map_err(|e| e.to_string())?;
    let status = if payload.success {
        CommandStatus::Ok
    } else {
        CommandStatus::Failed
    };
    let mut artifacts = vec![artifact("build_log", payload.log_path.display().to_string())];
    if payload.generated_artifacts.is_empty() {
        artifacts.push(artifact("build_command", payload.command.clone()));
    } else {
        artifacts.extend(
            payload
                .generated_artifacts
                .iter()
                .map(|path| artifact("generated_artifact", path.display().to_string())),
        );
    }
    Ok(envelope(
        "vos build",
        status,
        artifacts,
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

async fn run_qemu_envelope(
    project_root: &Path,
    profile: Option<String>,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::run_qemu_with_progress(project_root, profile, progress)
        .await
        .map_err(|e| e.to_string())?;
    let status = if payload.success {
        CommandStatus::Ok
    } else {
        CommandStatus::Failed
    };
    Ok(envelope(
        "vos run qemu",
        status,
        vec![artifact("qemu_log", payload.log_path.display().to_string())],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

fn agent_context_envelope(
    project_root: &Path,
    stage: Option<&str>,
    visibility: Option<&str>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload =
        vos_runtime::agent_context(project_root, stage, visibility).map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos agent context",
        CommandStatus::Ok,
        Vec::new(),
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

fn agent_plan_envelope(
    project_root: &Path,
    stage: Option<&str>,
    task: Option<&str>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::agent_plan(project_root, stage, task).map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos agent plan",
        CommandStatus::Ok,
        Vec::new(),
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

async fn agent_apply_patch_envelope(
    project_root: &Path,
    args: AgentApplyPatchArgs,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::agent_apply_patch(
        project_root,
        vos_runtime::AgentApplyOptions {
            patch_path: args.patch_path,
            apply: args.apply,
            require_spec: args.require_spec,
            run_validation: args.run_validation,
            stage: None,
        },
        progress,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos agent apply-patch",
        CommandStatus::Ok,
        vec![artifact("manifest", payload.manifest_path.display().to_string())],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

async fn verify_public_envelope(
    project_root: &Path,
    progress: Option<&vos_runtime::ProgressSink>,
) -> Result<CommandEnvelope<serde_json::Value>, String> {
    let payload = vos_runtime::verify_public(project_root, progress)
        .await
        .map_err(|e| e.to_string())?;
    Ok(envelope(
        "vos verify public",
        CommandStatus::Ok,
        vec![
            artifact("build_log", payload.build.log_path.display().to_string()),
            artifact("qemu_log", payload.run.log_path.display().to_string()),
        ],
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    ))
}

fn infer_module_operation_from_spec_path(
    project_root: &Path,
    spec_path: &Path,
) -> Result<(String, String), String> {
    let absolute = if spec_path.is_absolute() {
        spec_path.to_path_buf()
    } else {
        project_root.join(spec_path)
    };
    let components = absolute
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let ops_index = components
        .iter()
        .position(|component| component == "ops")
        .ok_or_else(|| format!("spec path does not point to an operation spec: {}", absolute.display()))?;
    if ops_index == 0 || ops_index + 1 >= components.len() {
        return Err(format!(
            "spec path does not contain module/operation binding: {}",
            absolute.display()
        ));
    }
    let module = components[ops_index - 1].clone();
    let operation = absolute
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| format!("invalid operation spec filename: {}", absolute.display()))?
        .to_string();
    Ok((module, operation))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clap_accepts_documented_spec_lint_shape() {
        let cli = Cli::try_parse_from([
            "vos",
            "--json",
            "spec",
            "lint",
            "spec/modules/boot/ops/boot_banner.yaml",
        ])
        .expect("documented spec lint command should parse");

        assert!(cli.json);
        match cli.command {
            Commands::Spec {
                command: SpecCommands::Lint(args),
            } => {
                assert_eq!(
                    args.spec_path,
                    PathBuf::from("spec/modules/boot/ops/boot_banner.yaml")
                );
            }
            _ => panic!("unexpected parsed command"),
        }
    }

    #[test]
    fn clap_accepts_documented_agent_command_shape() {
        let cli = Cli::try_parse_from(["vos", "agent", "serve"])
            .expect("documented agent serve command should parse");

        match cli.command {
            Commands::Agent {
                command: AgentCommands::Serve(_),
            } => {}
            _ => panic!("unexpected parsed command"),
        }
    }

    #[test]
    fn old_codegen_command_is_rejected() {
        let err = match Cli::try_parse_from(["vos", "codegen", "run"]) {
            Ok(_) => panic!("legacy codegen command should not parse"),
            Err(err) => err,
        };
        let rendered = err.to_string();
        assert!(rendered.contains("unrecognized subcommand"));
        assert!(rendered.contains("codegen"));
    }

    #[test]
    fn not_implemented_envelope_uses_stable_shape() {
        let envelope = not_implemented(
            "vos test",
            "not implemented yet",
            vec![TOOLCHAIN_DOC.into()],
            vec!["vos verify public".into()],
        );

        let json = serde_json::to_value(&envelope).expect("envelope should serialize");
        assert_eq!(json["command"], "vos test");
        assert_eq!(json["status"], "not_implemented");
        assert_eq!(json["payload"]["reason"], "not implemented yet");
    }
}
