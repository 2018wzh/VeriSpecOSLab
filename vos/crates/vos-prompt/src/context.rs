use std::path::PathBuf;

use crate::shared::{plan_summary, yaml_lines, yaml_paths};

pub fn build_agent_context_prompt(
    requested_scope: &str,
    visibility_scope: &str,
    resolved_specs: &[String],
    recent_evidence: &[String],
    allowed_paths: &[PathBuf],
    recommended_commands: &[String],
    plan: Option<(&str, &[String], &[String], &[Vec<String>])>,
) -> String {
    format!(
        "Context scope: {}\nVisibility: {}\nResolved specs:\n{}\nRecent evidence:\n{}\nAllowed paths:\n{}\nRecommended commands:\n{}\nPlan summary:\n{}",
        requested_scope,
        visibility_scope,
        yaml_lines(resolved_specs),
        yaml_lines(recent_evidence),
        yaml_paths(allowed_paths),
        yaml_lines(recommended_commands),
        plan.map(
            |(task, related_specs, required_validations, generation_waves)| {
                plan_summary(task, related_specs, required_validations, generation_waves)
            }
        )
        .unwrap_or_else(|| "- none".into())
    )
}
