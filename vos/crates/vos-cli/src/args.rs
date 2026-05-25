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
    Toolchain {
        #[command(subcommand)]
        command: ToolchainCommands,
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
pub enum ToolchainCommands {
    Lint,
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
    #[arg(long)]
    pub stage: Option<String>,
    #[arg(long)]
    pub generator: Option<String>,
    #[arg(long, value_delimiter = ',')]
    pub generators: Vec<String>,
    #[arg(long, default_value_t = false)]
    pub dry_run: bool,
    #[arg(long)]
    pub toolchain: Option<PathBuf>,
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
    Generate(AgentGenerateArgs),
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

#[derive(Args)]
#[command(
    about = "Generate code from spec. Omit [target] to generate the whole current system at the current stage; pass <module> to generate one module plus its dependency closure; pass <stage> to generate the full system at that stage."
)]
pub struct AgentGenerateArgs {
    #[arg(
        value_name = "target",
        help = "Optional module or stage target. Omit to generate the whole current system at the current stage."
    )]
    pub target: Option<String>,
    #[arg(long)]
    pub from_patch: Option<PathBuf>,
    #[arg(
        long,
        value_name = "run_id_or_path",
        help = "Resume generation from an existing .vos/runs/<run_id> directory."
    )]
    pub resume_run: Option<PathBuf>,
    #[arg(long, default_value_t = false)]
    pub apply: bool,
    #[arg(long, default_value_t = false)]
    pub build: bool,
    #[arg(long, default_value_t = false)]
    pub run: bool,
}
