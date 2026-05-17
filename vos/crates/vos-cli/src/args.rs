use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "vos")]
pub struct Cli {
    #[arg(long, default_value = ".")]
    pub project_root: PathBuf,
    #[arg(long, default_value_t = false)]
    pub json: bool,
    #[arg(long)]
    pub report: Option<PathBuf>,
    #[arg(long)]
    pub evidence_dir: Option<PathBuf>,
    #[arg(long)]
    pub agent_session: Option<String>,
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
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
pub enum StageCommands {
    Show,
}

#[derive(Subcommand)]
pub enum SpecCommands {
    Lint(SpecPathArgs),
    Normalize(SpecPathArgs),
    CheckConsistency(SpecPathArgs),
    Patch {
        #[command(subcommand)]
        command: SpecPatchCommands,
    },
}

#[derive(Subcommand)]
pub enum SpecPatchCommands {
    Lint(PatchPathArgs),
    Apply(PatchPathArgs),
}

#[derive(Subcommand)]
pub enum ArchCommands {
    Lint(ArchPathArgs),
    Compose(ArchPathArgs),
    DeriveTests(ArchPathArgs),
}

#[derive(Args)]
pub struct BuildArgs {
    #[arg(long)]
    pub profile: Option<String>,
}

#[derive(Subcommand)]
pub enum RunCommands {
    Qemu(BuildArgs),
}

#[derive(Args)]
pub struct TestArgs {
    #[arg(long)]
    pub suite: Option<String>,
}

#[derive(Subcommand)]
pub enum VerifyCommands {
    Public,
    Patch(PatchPathArgs),
    Full,
    Invariant,
    Fuzz,
}

#[derive(Subcommand)]
pub enum TraceCommands {
    Syscall,
}

#[derive(Subcommand)]
pub enum DebugCommands {
    ExplainLog(DebugExplainArgs),
}

#[derive(Subcommand)]
pub enum AgentCommands {
    Serve(AgentServeArgs),
    Context(AgentContextArgs),
    Plan(AgentPlanArgs),
    ApplyPatch(AgentApplyPatchArgs),
    Log,
}

#[derive(Subcommand)]
pub enum ReportCommands {
    Generate,
}

#[derive(Subcommand)]
pub enum SubmitCommands {
    Pack,
}

#[derive(Args)]
pub struct SpecPathArgs {
    pub spec_path: PathBuf,
}

#[derive(Args)]
pub struct ArchPathArgs {
    pub architecture_path: PathBuf,
}

#[derive(Args)]
pub struct PatchPathArgs {
    pub patch_path: PathBuf,
}

#[derive(Args)]
pub struct DebugExplainArgs {
    pub log_path: PathBuf,
}

#[derive(Args)]
pub struct AgentServeArgs {
    #[arg(long)]
    pub host: Option<String>,
    #[arg(long)]
    pub port: Option<u16>,
}

#[derive(Args)]
pub struct AgentContextArgs {
    #[arg(long)]
    pub spec_path: Option<PathBuf>,
    #[arg(long)]
    pub log_path: Option<PathBuf>,
    #[arg(long)]
    pub stage: Option<String>,
    #[arg(long)]
    pub visibility: Option<String>,
}

#[derive(Args)]
pub struct AgentPlanArgs {
    #[arg(long)]
    pub task: Option<String>,
    #[arg(long)]
    pub spec_path: Option<PathBuf>,
    #[arg(long)]
    pub log_path: Option<PathBuf>,
    #[arg(long)]
    pub stage: Option<String>,
}

#[derive(Args)]
pub struct AgentApplyPatchArgs {
    pub patch_path: Option<PathBuf>,
    #[arg(long, default_value_t = false)]
    pub apply: bool,
    #[arg(long, default_value_t = false)]
    pub require_spec: bool,
    #[arg(long, default_value_t = false)]
    pub run_validation: bool,
}
