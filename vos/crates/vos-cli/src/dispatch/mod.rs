mod agent;
mod arch;
mod build;
mod debug;
mod run;
mod spec;
mod test;
mod verify;

pub use agent::*;
pub use arch::*;
pub use build::*;
pub use debug::*;
pub use run::*;
pub use spec::*;
pub use test::*;
pub use verify::*;

pub const TOOLCHAIN_DOC: &str =
    "/E:/文件/ECNU/比赛/OS/VeriSpecOSLab/docs/design/toolchain/06-adapters-and-command-model.md";
pub const AGENT_DOC: &str =
    "/E:/文件/ECNU/比赛/OS/VeriSpecOSLab/docs/design/toolchain/07-agent-gateway.md";
