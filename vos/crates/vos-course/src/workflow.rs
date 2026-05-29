use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    DesignReviewStatus, DesignSubmission, EvaluationRubric, EvidenceRecord, EvidenceRequirement,
    EvidenceResult, PipelineStatus, Project, PublicSummary, ScoreItem, StageGate, StageGateConfig,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StagePromotionDecision {
    pub eligible: bool,
    pub next_stage_id: Option<Uuid>,
    #[serde(default)]
    pub missing_evidence: Vec<EvidenceRequirement>,
    pub manual_review_status: Option<DesignReviewStatus>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScoreComputation {
    #[serde(default)]
    pub updated_scores: Vec<ScoreItem>,
    pub summary: crate::ScoreSummary,
}

pub fn check_stage_promotion(
    project: &Project,
    stages: &[StageGate],
    design_submissions: &[DesignSubmission],
    evidence: &[EvidenceRecord],
) -> StagePromotionDecision {
    let Some(current) = stages
        .iter()
        .find(|stage| stage.id == project.current_stage_id)
    else {
        return StagePromotionDecision {
            eligible: false,
            next_stage_id: None,
            missing_evidence: Vec::new(),
            manual_review_status: None,
            reason: "current stage is missing from stage gate set".into(),
        };
    };

    let Some(next) = stages
        .iter()
        .filter(|stage| stage.sequence > current.sequence)
        .min_by_key(|stage| stage.sequence)
    else {
        return StagePromotionDecision {
            eligible: false,
            next_stage_id: None,
            missing_evidence: Vec::new(),
            manual_review_status: None,
            reason: "project is already at the final stage".into(),
        };
    };

    let missing_evidence = missing_required_evidence(&next.config, evidence);
    let manual_review_status = design_submissions
        .iter()
        .filter(|submission| {
            submission.project_id == project.id && submission.stage_gate_id == current.id
        })
        .max_by_key(|submission| &submission.updated_at)
        .map(|submission| submission.review_status);

    let manual_ok = !next.config.manual_review_required
        || matches!(manual_review_status, Some(DesignReviewStatus::Approved));
    let evidence_ok = missing_evidence.is_empty();

    let eligible = manual_ok && evidence_ok;
    let reason = if eligible {
        format!("all requirements met for {}", next.key)
    } else if !manual_ok {
        "manual review is required before promotion".into()
    } else {
        "required evidence is missing".into()
    };

    StagePromotionDecision {
        eligible,
        next_stage_id: Some(next.id),
        missing_evidence,
        manual_review_status,
        reason,
    }
}

pub fn missing_required_evidence(
    config: &StageGateConfig,
    evidence: &[EvidenceRecord],
) -> Vec<EvidenceRequirement> {
    config
        .required_evidence
        .iter()
        .filter(|requirement| {
            !evidence.iter().any(|record| {
                record.suite == requirement.suite
                    && record.case_name == requirement.case_name
                    && record.result == requirement.required_result
            })
        })
        .cloned()
        .collect()
}

pub fn summarize_evidence(records: &[EvidenceRecord]) -> PublicSummary {
    let passed = records
        .iter()
        .filter(|record| record.result == EvidenceResult::Pass)
        .count();
    let failed = records
        .iter()
        .filter(|record| matches!(record.result, EvidenceResult::Fail | EvidenceResult::Error))
        .count();
    let total = records.len();
    let status = if failed == 0 {
        PipelineStatus::Passed
    } else {
        PipelineStatus::Failed
    };
    let message = if total == 0 {
        "no evidence records were published".into()
    } else if failed == 0 {
        format!("{passed}/{total} public evidence checks passed")
    } else {
        format!("{passed}/{total} public evidence checks passed; {failed} require attention")
    };

    PublicSummary {
        status,
        passed,
        failed,
        total,
        failure_class: (failed > 0).then(|| "verification_failure".into()),
        message,
    }
}

pub fn recompute_scores(
    project: &Project,
    rubrics: &[EvaluationRubric],
    existing_scores: &[ScoreItem],
    evidence: &[EvidenceRecord],
    now: impl Into<String>,
) -> ScoreComputation {
    let now = now.into();
    let existing_by_rubric: BTreeMap<Uuid, &ScoreItem> = existing_scores
        .iter()
        .filter(|score| score.project_id == project.id)
        .map(|score| (score.rubric_id, score))
        .collect();

    let mut updated_scores = Vec::new();
    for rubric in rubrics
        .iter()
        .filter(|rubric| rubric.experiment_id == project.experiment_id)
    {
        let auto_score = evidence
            .iter()
            .filter(|record| evidence_matches_rubric(record, rubric))
            .map(|record| {
                if record.result == EvidenceResult::Pass {
                    rubric.weight
                } else {
                    0.0
                }
            })
            .fold(0.0_f32, f32::max);

        let score = if let Some(existing) = existing_by_rubric.get(&rubric.id) {
            if existing.is_final {
                (*existing).clone()
            } else {
                ScoreItem {
                    auto_score,
                    updated_at: now.clone(),
                    ..(*existing).clone()
                }
            }
        } else {
            ScoreItem {
                id: Uuid::new_v4(),
                project_id: project.id,
                rubric_id: rubric.id,
                auto_score,
                manual_score: None,
                feedback: None,
                is_final: false,
                updated_at: now.clone(),
            }
        };
        updated_scores.push(score);
    }

    let earned = updated_scores
        .iter()
        .map(|score| score.manual_score.unwrap_or(score.auto_score))
        .sum();
    let possible = rubrics
        .iter()
        .filter(|rubric| rubric.experiment_id == project.experiment_id)
        .map(|rubric| rubric.weight)
        .sum();
    let finalized = !updated_scores.is_empty() && updated_scores.iter().all(|score| score.is_final);

    ScoreComputation {
        updated_scores,
        summary: crate::ScoreSummary {
            earned,
            possible,
            finalized,
        },
    }
}

fn evidence_matches_rubric(record: &EvidenceRecord, rubric: &EvaluationRubric) -> bool {
    record.kind == rubric.target_kind
        && rubric
            .target_suite
            .as_ref()
            .is_none_or(|suite| suite == &record.suite)
        && rubric
            .target_case
            .as_ref()
            .is_none_or(|case_name| case_name == &record.case_name)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{
        EvidenceKind, GateKind, GateStatus, ProjectStatus, RubricStatus, Timestamp, VisibilityScope,
    };

    fn ts() -> Timestamp {
        "1".into()
    }

    fn project(stage_id: Uuid, experiment_id: Uuid) -> Project {
        Project {
            id: Uuid::new_v4(),
            student_user_id: Uuid::new_v4(),
            experiment_id,
            repo_url: None,
            workspace_ref: None,
            current_stage_id: stage_id,
            status: ProjectStatus::Active,
            last_commit_sha: None,
            adapter_profile: json!({}),
            created_at: ts(),
            updated_at: ts(),
        }
    }

    fn stage(
        experiment_id: Uuid,
        sequence: i32,
        required_evidence: Vec<EvidenceRequirement>,
    ) -> StageGate {
        StageGate {
            id: Uuid::new_v4(),
            experiment_id,
            key: format!("stage-{sequence}"),
            name: format!("Stage {sequence}"),
            sequence,
            gate_type: GateKind::Auto,
            status: GateStatus::Active,
            config: StageGateConfig {
                required_artifacts: Vec::new(),
                required_evidence,
                manual_review_required: false,
                visibility_scope: Some(VisibilityScope::StudentPublic),
            },
            created_at: ts(),
            updated_at: ts(),
        }
    }

    #[test]
    fn promotion_requires_evidence_for_next_stage() {
        let experiment_id = Uuid::new_v4();
        let boot = stage(experiment_id, 0, Vec::new());
        let memory = stage(
            experiment_id,
            1,
            vec![EvidenceRequirement {
                suite: "boot".into(),
                case_name: "banner".into(),
                required_result: EvidenceResult::Pass,
            }],
        );
        let project = project(boot.id, experiment_id);

        let blocked = check_stage_promotion(&project, &[boot.clone(), memory.clone()], &[], &[]);
        assert!(!blocked.eligible);
        assert_eq!(blocked.missing_evidence.len(), 1);

        let record = EvidenceRecord {
            id: Uuid::new_v4(),
            project_id: project.id,
            pipeline_run_id: Uuid::new_v4(),
            commit_sha: "abc".into(),
            kind: EvidenceKind::Test,
            suite: "boot".into(),
            case_name: "banner".into(),
            result: EvidenceResult::Pass,
            metrics: json!({}),
            log_segment: None,
            artifact_uri: None,
            created_at: ts(),
        };
        let promoted = check_stage_promotion(&project, &[boot, memory], &[], &[record]);
        assert!(promoted.eligible);
    }

    #[test]
    fn score_prefers_manual_value_but_preserves_possible_points() {
        let experiment_id = Uuid::new_v4();
        let stage = Uuid::new_v4();
        let project = project(stage, experiment_id);
        let rubric = EvaluationRubric {
            id: Uuid::new_v4(),
            experiment_id,
            name: "Boot".into(),
            status: RubricStatus::Active,
            target_kind: EvidenceKind::Test,
            target_suite: Some("boot".into()),
            target_case: Some("banner".into()),
            weight: 10.0,
            description: None,
            created_at: ts(),
            updated_at: ts(),
        };
        let record = EvidenceRecord {
            id: Uuid::new_v4(),
            project_id: project.id,
            pipeline_run_id: Uuid::new_v4(),
            commit_sha: "abc".into(),
            kind: EvidenceKind::Test,
            suite: "boot".into(),
            case_name: "banner".into(),
            result: EvidenceResult::Pass,
            metrics: json!({}),
            log_segment: None,
            artifact_uri: None,
            created_at: ts(),
        };

        let computed = recompute_scores(&project, &[rubric], &[], &[record], ts());
        assert_eq!(computed.summary.earned, 10.0);
        assert_eq!(computed.summary.possible, 10.0);
    }
}
