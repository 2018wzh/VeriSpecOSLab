use std::path::Path;

use vos_core::{AppConfig, PromptEnvelope, Result};

#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub enum RigStage {
    Context,
    Plan,
    PromptAssemble,
    ProviderCall,
    Parse,
    ValidateGate,
    Evidence,
}

pub struct RigWorkflow<'a> {
    config: &'a AppConfig,
}

impl<'a> RigWorkflow<'a> {
    pub fn new(config: &'a AppConfig) -> Self {
        Self { config }
    }

    pub async fn run_prompt_stage(
        &self,
        run_dir: &Path,
        _stage: RigStage,
        prompt: &PromptEnvelope,
    ) -> Result<String> {
        crate::provider::call_json_prompt(self.config, run_dir, prompt).await
    }
}
