mod agent;
mod arch;
mod build;
mod run;
mod spec;
mod verify;

pub use agent::*;
pub use arch::*;
pub use build::*;
pub use run::*;
pub use spec::*;
pub use verify::*;

pub const TOOLCHAIN_DOC: &str =
    "/E:/文件/ECNU/比赛/OS/VeriSpecOSLab/docs/design/toolchain/06-adapters-and-command-model.md";
pub const AGENT_DOC: &str =
    "/E:/文件/ECNU/比赛/OS/VeriSpecOSLab/docs/design/toolchain/07-agent-gateway.md";
