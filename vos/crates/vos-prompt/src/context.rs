use vos_core::{ContextBundle, PlanDraft, PromptEnvelope, SpecRef};

use crate::shared::{plan_summary, yaml_lines, yaml_paths};

pub fn build_agent_context_prompt(
    context: &ContextBundle,
    plan: Option<&PlanDraft>,
) -> PromptEnvelope {
    let prompt = format!(
        "Context scope: {}\nVisibility: {}\nResolved specs:\n{}\nRecent evidence:\n{}\nAllowed paths:\n{}\nRecommended commands:\n{}\nPlan summary:\n{}",
        context.requested_scope,
        context.visibility_scope,
        yaml_lines(&context.resolved_specs),
        yaml_lines(&context.recent_evidence),
        yaml_paths(&context.allowed_paths),
        yaml_lines(&context.recommended_commands),
        plan.map(plan_summary).unwrap_or_else(|| "- none".into())
    );
    PromptEnvelope {
        task_kind: "agent_context".into(),
        phase: "context".into(),
        spec_ref: SpecRef {
            module: "agent".into(),
            operation: "context".into(),
        },
        allowed_paths: context.allowed_paths.clone(),
        prompt,
    }
}
