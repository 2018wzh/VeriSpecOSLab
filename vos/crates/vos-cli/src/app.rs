use clap::Parser;
use vos_core::{CommandStatus, FailurePayload};

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

    let progress = if cli.json {
        None
    } else {
        Some(make_progress())
    };
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
        Commands::Toolchain {
            command: ToolchainCommands::Lint,
        } => emit_result(
            cli.json,
            "vos toolchain lint",
            toolchain_lint_envelope(&project_root),
        ),
        Commands::Spec {
            command:
                SpecCommands::Patch {
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
            command:
                SpecCommands::Patch {
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
            build_envelope(&project_root, args, progress_cb.as_deref()).await,
        ),
        Commands::Run {
            command: RunCommands::Qemu(args),
        } => emit_async_result(
            cli.json,
            "vos run qemu",
            run_qemu_envelope(&project_root, args.profile, progress_cb.as_deref()).await,
        ),
        Commands::Test(args) => emit_async_result(
            cli.json,
            "vos test",
            test_envelope(&project_root, args.suite, progress_cb.as_deref()).await,
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
        } => emit_async_result(
            cli.json,
            "vos verify patch",
            verify_patch_envelope(&project_root, &args.patch_path, progress_cb.as_deref()).await,
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
        } => emit_result(
            cli.json,
            "vos debug explain-log",
            debug_explain_log_envelope(&project_root, &args.log_path),
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
            command: AgentCommands::Generate(args),
        } => emit_async_result(
            cli.json,
            "vos agent generate",
            agent_generate_envelope(&project_root, args, progress_cb.clone()).await,
        ),
        Commands::Agent {
            command: AgentCommands::ApplyPatch(args),
        } => emit_async_result(
            cli.json,
            "vos agent apply-patch",
            agent_apply_patch_envelope(&project_root, args, progress_cb.clone()).await,
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

    if let Some(pb) = progress.as_ref() {
        pb.finish_and_clear();
    }

    if let Err(err) = result {
        let (run_id, message) =
            vos_core::extract_run_id_marker(&err).unwrap_or_else(|| (vos_core::new_run_id(), err));
        let failure = vos_core::envelope_with_run_id(
            run_id,
            "vos",
            CommandStatus::Failed,
            Vec::new(),
            FailurePayload {
                kind: "runtime_error".into(),
                message,
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
        let cli = Cli::try_parse_from(["vos", "agent", "generate", "memory"])
            .expect("documented agent generate command should parse");

        match cli.command {
            Commands::Agent {
                command: AgentCommands::Generate(args),
            } => assert_eq!(args.target.as_deref(), Some("memory")),
            _ => panic!("unexpected parsed command"),
        }
    }

    #[test]
    fn clap_accepts_generate_without_target() {
        let cli = Cli::try_parse_from(["vos", "agent", "generate"])
            .expect("agent generate without target should parse");

        match cli.command {
            Commands::Agent {
                command: AgentCommands::Generate(args),
            } => assert_eq!(args.target, None),
            _ => panic!("unexpected parsed command"),
        }
    }

    #[test]
    fn clap_accepts_generate_flags() {
        let cli = Cli::try_parse_from([
            "vos",
            "agent",
            "generate",
            "process",
            "--apply",
            "--build",
            "--run",
            "--from-patch",
            "tmp/patch.json",
        ])
        .expect("agent generate flags should parse");

        match cli.command {
            Commands::Agent {
                command: AgentCommands::Generate(args),
            } => {
                assert_eq!(args.target.as_deref(), Some("process"));
                assert!(args.apply);
                assert!(args.build);
                assert!(args.run);
                assert_eq!(
                    args.from_patch,
                    Some(std::path::PathBuf::from("tmp/patch.json"))
                );
            }
            _ => panic!("unexpected parsed command"),
        }
    }

    #[test]
    fn clap_accepts_generate_flags_without_target() {
        let cli = Cli::try_parse_from([
            "vos",
            "agent",
            "generate",
            "--apply",
            "--build",
            "--from-patch",
            "tmp/patch.json",
        ])
        .expect("agent generate flags without target should parse");

        match cli.command {
            Commands::Agent {
                command: AgentCommands::Generate(args),
            } => {
                assert_eq!(args.target, None);
                assert!(args.apply);
                assert!(args.build);
                assert_eq!(
                    args.from_patch,
                    Some(std::path::PathBuf::from("tmp/patch.json"))
                );
            }
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

    #[test]
    fn clap_accepts_new_build_contract_flags() {
        let cli = Cli::try_parse_from([
            "vos",
            "build",
            "--stage",
            "2",
            "--generator",
            "makefile",
            "--dry-run",
            "--toolchain",
            "spec/toolchain/toolchain.yaml",
        ])
        .expect("new build flags should parse");

        match cli.command {
            Commands::Build(args) => {
                assert_eq!(args.stage.as_deref(), Some("2"));
                assert_eq!(args.generator.as_deref(), Some("makefile"));
                assert!(args.dry_run);
                assert_eq!(
                    args.toolchain,
                    Some(std::path::PathBuf::from("spec/toolchain/toolchain.yaml"))
                );
            }
            _ => panic!("unexpected parsed command"),
        }
    }

    #[test]
    fn clap_accepts_toolchain_lint() {
        let cli = Cli::try_parse_from(["vos", "toolchain", "lint"])
            .expect("toolchain lint command should parse");

        match cli.command {
            Commands::Toolchain {
                command: ToolchainCommands::Lint,
            } => {}
            _ => panic!("unexpected parsed command"),
        }
    }
}
