use clap::Parser;
use vos_core::{envelope, CommandStatus, FailurePayload};

use crate::args::*;
use crate::dispatch::*;
use crate::render::*;

pub async fn run() {
    let cli = Cli::parse();
    let project_root = if cli.project_root.is_absolute() {
        cli.project_root.clone()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(&cli.project_root))
            .unwrap_or_else(|_| cli.project_root.clone())
    };

    let progress = if cli.json { None } else { Some(make_progress()) };
    let progress_cb = progress.as_ref().map(make_progress_callback);

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
                    std::path::PathBuf::from("spec/modules/boot/ops/boot_banner.yaml")
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
