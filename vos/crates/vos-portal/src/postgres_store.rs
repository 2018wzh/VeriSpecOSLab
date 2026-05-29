use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sqlx::postgres::PgRow;
use sqlx::{PgPool, Row};
use uuid::Uuid;
use vos_course::{
    AgentAuditRecord, AgentRiskLevel, Course, CourseStatus, CreateCourseRequest,
    CreateExperimentRequest, CreateProjectRequest, CreateStageGateRequest, DesignReviewStatus,
    DesignSubmission, EvaluationRubric, EvidenceIngestResponse, EvidenceRecord,
    EvidenceRequirement, EvidenceResult, Experiment, ExperimentType, GateKind, GateStatus,
    IncomingEvidenceReport, PipelineRun, PipelineStatus, Project, ProjectOverview, ProjectStatus,
    PublicSummary, PublishState, RubricStatus, ScoreItem, ScoreSummary, StageGate, StageGateConfig,
    StageGateProgress, StageProgress, TeacherProjectRow, TriggerType, User, UserRole,
    VisibilityScope, check_stage_promotion, missing_required_evidence, recompute_scores,
    summarize_evidence,
};

use crate::error::{PortalError, PortalResult};

const TS_CREATED: &str = "(EXTRACT(EPOCH FROM created_at)::BIGINT)::TEXT AS created_at";
const TS_UPDATED: &str = "(EXTRACT(EPOCH FROM updated_at)::BIGINT)::TEXT AS updated_at";
const TS_STARTED: &str = "(EXTRACT(EPOCH FROM started_at)::BIGINT)::TEXT AS started_at";
const TS_FINISHED: &str = "(EXTRACT(EPOCH FROM finished_at)::BIGINT)::TEXT AS finished_at";

pub struct PostgresStore {
    pub(crate) pool: PgPool,
}

impl PostgresStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn ensure_demo_seed(&self) -> PortalResult<()> {
        let now_config = json!({
            "adapter": "vos-os",
            "visibility": "student-public",
            "runner": "local-demo"
        });
        let teacher = self
            .upsert_demo_user("teacher", "Course Teacher", UserRole::Teacher)
            .await?;
        let student = self
            .upsert_demo_user("student", "Demo Student", UserRole::Student)
            .await?;
        let _ta = self
            .upsert_demo_user("ta", "Teaching Assistant", UserRole::Ta)
            .await?;

        let course = sqlx::query(&format!(
            r#"
            INSERT INTO courses (code, name, term, description, status, owner_user_id)
            VALUES ('VOS-2026', 'VeriSpecOSLab Operating Systems', 'Spring 2026',
                    'Spec-first OS lab course with staged evidence and AI audit.', 'active', $1)
            ON CONFLICT (code) DO UPDATE SET
                name = EXCLUDED.name,
                term = EXCLUDED.term,
                description = EXCLUDED.description,
                status = EXCLUDED.status,
                owner_user_id = EXCLUDED.owner_user_id,
                updated_at = NOW()
            RETURNING id, code, name, term, description, status, owner_user_id, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(teacher.id)
        .fetch_one(&self.pool)
        .await
        .map_err(PortalError::from)
        .and_then(|row| course_from_row(&row))?;

        let experiment = self.upsert_demo_experiment(course.id, now_config).await?;
        let boot_stage = self
            .upsert_demo_stage(
                experiment.id,
                "boot-minimum",
                "Boot Minimum",
                0,
                GateKind::Hybrid,
                StageGateConfig {
                    required_artifacts: vec!["spec/architecture/slices/01-boot.yaml".into()],
                    required_evidence: vec![EvidenceRequirement {
                        suite: "boot".into(),
                        case_name: "serial_banner_check".into(),
                        required_result: EvidenceResult::Pass,
                    }],
                    manual_review_required: false,
                    visibility_scope: Some(VisibilityScope::StudentPublic),
                },
            )
            .await?;
        self.upsert_demo_stage(
            experiment.id,
            "memory-management",
            "Memory Management",
            1,
            GateKind::Hybrid,
            StageGateConfig {
                required_artifacts: vec!["spec/modules/kernel/memory/module.yaml".into()],
                required_evidence: vec![
                    EvidenceRequirement {
                        suite: "memory".into(),
                        case_name: "page_allocator_tests".into(),
                        required_result: EvidenceResult::Pass,
                    },
                    EvidenceRequirement {
                        suite: "memory".into(),
                        case_name: "kernel_pagetable_smoke".into(),
                        required_result: EvidenceResult::Pass,
                    },
                ],
                manual_review_required: true,
                visibility_scope: Some(VisibilityScope::StudentPublic),
            },
        )
        .await?;
        self.upsert_demo_stage(
            experiment.id,
            "trap-privilege",
            "Trap / Privilege",
            2,
            GateKind::Hybrid,
            StageGateConfig {
                required_artifacts: vec!["spec/architecture/slices/03-trap.yaml".into()],
                required_evidence: vec![EvidenceRequirement {
                    suite: "trap".into(),
                    case_name: "invalid_user_pointer".into(),
                    required_result: EvidenceResult::Pass,
                }],
                manual_review_required: true,
                visibility_scope: Some(VisibilityScope::StudentPublic),
            },
        )
        .await?;
        self.upsert_demo_stage(
            experiment.id,
            "syscall-surface",
            "Syscall Surface",
            3,
            GateKind::Hybrid,
            StageGateConfig {
                required_artifacts: vec!["spec/modules/kernel/syscall/module.yaml".into()],
                required_evidence: vec![EvidenceRequirement {
                    suite: "syscall".into(),
                    case_name: "copyin_copyout_contract".into(),
                    required_result: EvidenceResult::Pass,
                }],
                manual_review_required: true,
                visibility_scope: Some(VisibilityScope::StudentPublic),
            },
        )
        .await?;
        self.upsert_demo_stage(
            experiment.id,
            "final-defense",
            "Final Defense",
            4,
            GateKind::Manual,
            StageGateConfig {
                required_artifacts: vec!["docs/design-defense.md".into()],
                required_evidence: vec![EvidenceRequirement {
                    suite: "integration".into(),
                    case_name: "public_regression_suite".into(),
                    required_result: EvidenceResult::Pass,
                }],
                manual_review_required: true,
                visibility_scope: Some(VisibilityScope::StaffFull),
            },
        )
        .await?;

        let project = sqlx::query(&format!(
            r#"
            INSERT INTO projects (
                student_user_id, experiment_id, repo_url, workspace_ref, current_stage_id,
                status, last_commit_sha, adapter_profile
            )
            VALUES ($1, $2, 'local://student/xv6-spec', 'workspace-demo-student', $3,
                    'active', 'demo001', $4)
            ON CONFLICT (student_user_id, experiment_id) DO UPDATE SET
                repo_url = EXCLUDED.repo_url,
                workspace_ref = EXCLUDED.workspace_ref,
                current_stage_id = EXCLUDED.current_stage_id,
                status = EXCLUDED.status,
                last_commit_sha = EXCLUDED.last_commit_sha,
                adapter_profile = EXCLUDED.adapter_profile,
                updated_at = NOW()
            RETURNING id, student_user_id, experiment_id, repo_url, workspace_ref, current_stage_id,
                      status, last_commit_sha, adapter_profile, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(student.id)
        .bind(experiment.id)
        .bind(boot_stage.id)
        .bind(json!({
            "domain": "os",
            "isa": "riscv64",
            "machine": "virt",
            "vos_project_root": "examples/xv6-spec"
        }))
        .fetch_one(&self.pool)
        .await
        .map_err(PortalError::from)
        .and_then(|row| project_from_row(&row))?;

        let pipeline = self.ensure_demo_pipeline(project.id).await?;
        self.ensure_demo_evidence(project.id, pipeline.id).await?;
        let rubric = self.ensure_demo_rubric(experiment.id).await?;
        sqlx::query(
            r#"
            INSERT INTO scores (project_id, rubric_id, auto_score, feedback)
            VALUES ($1, $2, 10.0, 'Boot evidence passed in the seeded public verification run.')
            ON CONFLICT (project_id, rubric_id) DO UPDATE SET
                auto_score = EXCLUDED.auto_score,
                feedback = EXCLUDED.feedback,
                updated_at = NOW()
            "#,
        )
        .bind(project.id)
        .bind(rubric.id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn authenticate(
        &self,
        username: &str,
        password: &str,
    ) -> PortalResult<(String, User)> {
        let user = self
            .user_by_username(username)
            .await?
            .ok_or(PortalError::Unauthorized)?;
        let expected = format!("demo:{password}");
        if user.password_hash.as_deref() != Some(expected.as_str()) {
            return Err(PortalError::Unauthorized);
        }
        Ok((format!("demo-{}", user.username), user))
    }

    pub async fn user_for_token(&self, token: &str) -> PortalResult<User> {
        let username = token
            .strip_prefix("demo-")
            .and_then(|value| value.split('-').next())
            .filter(|value| !value.is_empty())
            .ok_or(PortalError::Unauthorized)?;
        self.user_by_username(username)
            .await?
            .ok_or(PortalError::Unauthorized)
    }

    pub async fn list_courses(&self) -> PortalResult<Vec<Course>> {
        let rows = sqlx::query(&format!(
            "SELECT id, code, name, term, description, status, owner_user_id, {TS_CREATED}, {TS_UPDATED} FROM courses WHERE deleted_at IS NULL ORDER BY code"
        ))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(course_from_row).collect()
    }

    pub async fn create_course(
        &self,
        owner: &User,
        request: CreateCourseRequest,
    ) -> PortalResult<Course> {
        Self::require_staff(owner)?;
        if self.course_code_exists(&request.code).await? {
            return Err(PortalError::Conflict(format!(
                "course code {} already exists",
                request.code
            )));
        }
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO courses (code, name, term, description, status, owner_user_id)
            VALUES ($1, $2, $3, $4, 'draft', $5)
            RETURNING id, code, name, term, description, status, owner_user_id, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(request.code)
        .bind(request.name)
        .bind(request.term)
        .bind(request.description)
        .bind(owner.id)
        .fetch_one(&self.pool)
        .await?;
        course_from_row(&row)
    }

    pub async fn list_experiments(
        &self,
        course_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<Experiment>> {
        let predicate = match (course_id.is_some(), include_deleted) {
            (true, true) => "WHERE course_id = $1",
            (true, false) => "WHERE course_id = $1 AND deleted_at IS NULL",
            (false, true) => "",
            (false, false) => "WHERE deleted_at IS NULL",
        };
        let query = format!(
            "SELECT id, course_id, title, description, experiment_type, spec_version, base_repo_url, publish_state, config, {TS_CREATED}, {TS_UPDATED} FROM experiments {} ORDER BY title",
            predicate
        );
        let rows = if let Some(course_id) = course_id {
            sqlx::query(&query)
                .bind(course_id)
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query(&query).fetch_all(&self.pool).await?
        };
        rows.iter().map(experiment_from_row).collect()
    }

    pub async fn create_experiment(
        &self,
        actor: &User,
        request: CreateExperimentRequest,
    ) -> PortalResult<Experiment> {
        Self::require_staff(actor)?;
        if !self.row_exists("courses", request.course_id).await? {
            return Err(PortalError::missing("course", request.course_id));
        }
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO experiments (
                course_id, title, description, experiment_type, spec_version,
                base_repo_url, publish_state, config
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, course_id, title, description, experiment_type, spec_version,
                      base_repo_url, publish_state, config, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(request.course_id)
        .bind(request.title)
        .bind(request.description)
        .bind(to_db(&request.experiment_type)?)
        .bind(request.spec_version.unwrap_or_else(|| "draft".into()))
        .bind(request.base_repo_url)
        .bind(to_db(
            &request.publish_state.unwrap_or(PublishState::Draft),
        )?)
        .bind(request.config)
        .fetch_one(&self.pool)
        .await?;
        experiment_from_row(&row)
    }

    pub async fn list_stage_gates(&self, experiment_id: Uuid) -> PortalResult<Vec<StageGate>> {
        let rows = sqlx::query(&format!(
            "SELECT id, experiment_id, key, name, sequence, gate_type, status, config, {TS_CREATED}, {TS_UPDATED} FROM stage_gates WHERE experiment_id = $1 AND deleted_at IS NULL ORDER BY sequence"
        ))
        .bind(experiment_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(stage_from_row).collect()
    }

    pub async fn create_stage_gate(
        &self,
        actor: &User,
        request: CreateStageGateRequest,
    ) -> PortalResult<StageGate> {
        Self::require_staff(actor)?;
        if !self
            .row_exists("experiments", request.experiment_id)
            .await?
        {
            return Err(PortalError::missing("experiment", request.experiment_id));
        }
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO stage_gates (experiment_id, key, name, sequence, gate_type, status, config)
            VALUES ($1, $2, $3, $4, $5, 'draft', $6)
            RETURNING id, experiment_id, key, name, sequence, gate_type, status, config, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(request.experiment_id)
        .bind(request.key)
        .bind(request.name)
        .bind(request.sequence)
        .bind(to_db(&request.gate_type)?)
        .bind(serde_json::to_value(request.config).map_err(json_error)?)
        .fetch_one(&self.pool)
        .await?;
        stage_from_row(&row)
    }

    pub async fn create_project(
        &self,
        actor: &User,
        request: CreateProjectRequest,
    ) -> PortalResult<Project> {
        Self::require_staff(actor)?;
        if !self
            .row_exists("experiments", request.experiment_id)
            .await?
        {
            return Err(PortalError::missing("experiment", request.experiment_id));
        }
        let initial_stage = self
            .first_stage(request.experiment_id)
            .await?
            .ok_or_else(|| PortalError::BadRequest("experiment has no stage gates".into()))?;
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO projects (
                student_user_id, experiment_id, repo_url, current_stage_id,
                status, adapter_profile
            )
            VALUES ($1, $2, $3, $4, 'provisioning', $5)
            RETURNING id, student_user_id, experiment_id, repo_url, workspace_ref, current_stage_id,
                      status, last_commit_sha, adapter_profile, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(request.student_user_id)
        .bind(request.experiment_id)
        .bind(request.repo_url)
        .bind(initial_stage.id)
        .bind(json!({"adapter": "local-demo"}))
        .fetch_one(&self.pool)
        .await?;
        project_from_row(&row)
    }

    pub async fn list_project_overviews(&self, actor: &User) -> PortalResult<Vec<ProjectOverview>> {
        let rows = if Self::is_staff(actor) {
            sqlx::query(&format!(
                "SELECT id, student_user_id, experiment_id, repo_url, workspace_ref, current_stage_id, status, last_commit_sha, adapter_profile, {TS_CREATED}, {TS_UPDATED} FROM projects WHERE deleted_at IS NULL ORDER BY created_at"
            ))
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(&format!(
                "SELECT id, student_user_id, experiment_id, repo_url, workspace_ref, current_stage_id, status, last_commit_sha, adapter_profile, {TS_CREATED}, {TS_UPDATED} FROM projects WHERE student_user_id = $1 AND deleted_at IS NULL ORDER BY created_at"
            ))
            .bind(actor.id)
            .fetch_all(&self.pool)
            .await?
        };
        let mut overviews = Vec::new();
        for row in rows {
            let project = project_from_row(&row)?;
            overviews.push(self.project_overview_from_project(&project).await?);
        }
        Ok(overviews)
    }

    pub async fn project_overview(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<ProjectOverview> {
        let project = self.project_by_id(project_id).await?;
        Self::require_project_access(actor, &project)?;
        self.project_overview_from_project(&project).await
    }

    pub async fn stage_progress(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<StageProgress> {
        let project = self.project_by_id(project_id).await?;
        Self::require_project_access(actor, &project)?;
        let current_stage = self.stage_by_id(project.current_stage_id).await?;
        let stages = self.list_stage_gates(project.experiment_id).await?;
        let evidence = self.project_evidence(project.id).await?;
        let submissions = self.project_submissions(project.id).await?;
        let progress = stages
            .iter()
            .map(|stage| {
                let missing_evidence = missing_required_evidence(&stage.config, &evidence);
                let manual_review_status = submissions
                    .iter()
                    .filter(|submission| submission.stage_gate_id == stage.id)
                    .max_by_key(|submission| &submission.updated_at)
                    .map(|submission| submission.review_status);
                let passed = missing_evidence.is_empty()
                    && (!stage.config.manual_review_required
                        || matches!(manual_review_status, Some(DesignReviewStatus::Approved)));
                StageGateProgress {
                    stage: stage.clone(),
                    unlocked: stage.sequence <= current_stage.sequence,
                    passed,
                    missing_evidence,
                    manual_review_status,
                }
            })
            .collect();
        Ok(StageProgress {
            current_stage,
            stages: progress,
        })
    }

    pub async fn run_pipeline(
        &self,
        actor: &User,
        project_id: Uuid,
        commit_sha: String,
        trigger_type: TriggerType,
        stage_scope: Option<String>,
    ) -> PortalResult<PipelineRun> {
        let project = self.project_by_id(project_id).await?;
        Self::require_project_access(actor, &project)?;
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO pipeline_runs (project_id, commit_sha, trigger_type, status, stage_scope)
            VALUES ($1, $2, $3, 'running', $4)
            RETURNING id, project_id, commit_sha, trigger_type, status, stage_scope, public_summary,
                      retry_of, {TS_STARTED}, {TS_FINISHED}
            "#
        ))
        .bind(project_id)
        .bind(commit_sha)
        .bind(to_db(&trigger_type)?)
        .bind(stage_scope)
        .fetch_one(&self.pool)
        .await?;
        pipeline_from_row(&row)
    }

    pub async fn list_pipelines(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<Vec<PipelineRun>> {
        let project = self.project_by_id(project_id).await?;
        Self::require_project_access(actor, &project)?;
        let rows = sqlx::query(&format!(
            "SELECT id, project_id, commit_sha, trigger_type, status, stage_scope, public_summary, retry_of, {TS_STARTED}, {TS_FINISHED} FROM pipeline_runs WHERE project_id = $1 AND deleted_at IS NULL ORDER BY started_at DESC"
        ))
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(pipeline_from_row).collect()
    }

    pub async fn pipeline(&self, actor: &User, pipeline_id: Uuid) -> PortalResult<PipelineRun> {
        let pipeline = self.pipeline_by_id(pipeline_id).await?;
        let project = self.project_by_id(pipeline.project_id).await?;
        Self::require_project_access(actor, &project)?;
        Ok(pipeline)
    }

    pub async fn ingest_evidence(
        &self,
        report: IncomingEvidenceReport,
    ) -> PortalResult<EvidenceIngestResponse> {
        let project = self.project_by_id(report.project_id).await?;
        let pipeline_id = if let Some(id) = report.pipeline_run_id {
            id
        } else {
            let row = sqlx::query(&format!(
                r#"
                INSERT INTO pipeline_runs (project_id, commit_sha, trigger_type, status)
                VALUES ($1, $2, 'manual', 'running')
                RETURNING id, project_id, commit_sha, trigger_type, status, stage_scope,
                          public_summary, retry_of, {TS_STARTED}, {TS_FINISHED}
                "#
            ))
            .bind(project.id)
            .bind(report.commit_sha.clone())
            .fetch_one(&self.pool)
            .await?;
            pipeline_from_row(&row)?.id
        };

        let mut inserted = Vec::new();
        for incoming in report.records {
            let row = sqlx::query(&format!(
                r#"
                INSERT INTO evidence_records (
                    project_id, pipeline_run_id, commit_sha, kind, suite, case_name,
                    result, metrics, log_segment, artifact_uri
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id, project_id, pipeline_run_id, commit_sha, kind, suite, case_name,
                          result, metrics, log_segment, artifact_uri, {TS_CREATED}
                "#
            ))
            .bind(project.id)
            .bind(pipeline_id)
            .bind(report.commit_sha.clone())
            .bind(to_db(&incoming.kind)?)
            .bind(incoming.suite)
            .bind(incoming.case_name)
            .bind(to_db(&incoming.result)?)
            .bind(incoming.metrics)
            .bind(incoming.log_segment)
            .bind(incoming.artifact_uri)
            .fetch_one(&self.pool)
            .await?;
            inserted.push(evidence_from_row(&row)?);
        }

        let summary = summarize_evidence(&inserted);
        let row = sqlx::query(&format!(
            r#"
            UPDATE pipeline_runs
            SET status = $2, public_summary = $3, finished_at = NOW()
            WHERE id = $1
            RETURNING id, project_id, commit_sha, trigger_type, status, stage_scope,
                      public_summary, retry_of, {TS_STARTED}, {TS_FINISHED}
            "#
        ))
        .bind(pipeline_id)
        .bind(to_db(&summary.status)?)
        .bind(serde_json::to_value(&summary).map_err(json_error)?)
        .fetch_one(&self.pool)
        .await?;
        let pipeline = pipeline_from_row(&row)?;

        sqlx::query("UPDATE projects SET last_commit_sha = $2, updated_at = NOW() WHERE id = $1")
            .bind(project.id)
            .bind(report.commit_sha)
            .execute(&self.pool)
            .await?;

        let project_evidence = self.project_evidence(project.id).await?;
        let stages = self.list_stage_gates(project.experiment_id).await?;
        let submissions = self.project_submissions(project.id).await?;
        let latest_project = self.project_by_id(project.id).await?;
        let promotion =
            check_stage_promotion(&latest_project, &stages, &submissions, &project_evidence);
        let mut promoted_stage_id = None;
        if promotion.eligible {
            if let Some(next_stage_id) = promotion.next_stage_id {
                sqlx::query(
                    "UPDATE projects SET current_stage_id = $2, updated_at = NOW() WHERE id = $1",
                )
                .bind(project.id)
                .bind(next_stage_id)
                .execute(&self.pool)
                .await?;
                promoted_stage_id = Some(next_stage_id);
            }
        }

        let rubrics = self.rubrics_for_experiment(project.experiment_id).await?;
        let scores = self.scores_for_project(project.id).await?;
        let recomputed = recompute_scores(
            &project,
            &rubrics,
            &scores,
            &project_evidence,
            crate::time::now_timestamp(),
        );
        let mut updated_scores = Vec::new();
        for score in recomputed.updated_scores {
            updated_scores.push(self.upsert_score(score).await?);
        }

        Ok(EvidenceIngestResponse {
            pipeline,
            inserted,
            promoted_stage_id,
            recomputed_scores: updated_scores,
        })
    }

    pub async fn list_evidence(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<Vec<EvidenceRecord>> {
        let project = self.project_by_id(project_id).await?;
        Self::require_project_access(actor, &project)?;
        self.project_evidence(project_id).await
    }

    pub async fn list_scores(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<Vec<ScoreItem>> {
        let project = self.project_by_id(project_id).await?;
        Self::require_project_access(actor, &project)?;
        self.scores_for_project(project_id).await
    }

    pub async fn update_score(
        &self,
        actor: &User,
        project_id: Uuid,
        rubric_id: Uuid,
        manual_score: Option<f32>,
        feedback: Option<String>,
        is_final: Option<bool>,
    ) -> PortalResult<ScoreItem> {
        Self::require_staff(actor)?;
        if !self.row_exists("projects", project_id).await? {
            return Err(PortalError::missing("project", project_id));
        }
        if !self.row_exists("evaluation_rubrics", rubric_id).await? {
            return Err(PortalError::missing("rubric", rubric_id));
        }
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO scores (project_id, rubric_id, auto_score, manual_score, feedback, is_final)
            VALUES ($1, $2, 0, $3, $4, $5)
            ON CONFLICT (project_id, rubric_id) DO UPDATE SET
                manual_score = EXCLUDED.manual_score,
                feedback = EXCLUDED.feedback,
                is_final = COALESCE($6, scores.is_final),
                updated_at = NOW()
            RETURNING id, project_id, rubric_id, auto_score, manual_score, feedback, is_final,
                      (EXTRACT(EPOCH FROM updated_at)::BIGINT)::TEXT AS updated_at
            "#
        ))
        .bind(project_id)
        .bind(rubric_id)
        .bind(manual_score)
        .bind(feedback)
        .bind(is_final.unwrap_or(false))
        .bind(is_final)
        .fetch_one(&self.pool)
        .await?;
        score_from_row(&row)
    }

    pub async fn submit_design(
        &self,
        actor: &User,
        project_id: Uuid,
        stage_gate_id: Uuid,
        commit_sha: String,
        artifact_ref: Option<String>,
    ) -> PortalResult<DesignSubmission> {
        let project = self.project_by_id(project_id).await?;
        Self::require_project_access(actor, &project)?;
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO design_submissions (project_id, stage_gate_id, commit_sha, artifact_ref)
            VALUES ($1, $2, $3, $4)
            RETURNING id, project_id, stage_gate_id, commit_sha, artifact_ref, review_status,
                      reviewer_user_id, feedback, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(project_id)
        .bind(stage_gate_id)
        .bind(commit_sha)
        .bind(artifact_ref)
        .fetch_one(&self.pool)
        .await?;
        submission_from_row(&row)
    }

    pub async fn review_design(
        &self,
        actor: &User,
        submission_id: Uuid,
        status: DesignReviewStatus,
        feedback: Option<String>,
    ) -> PortalResult<DesignSubmission> {
        Self::require_staff(actor)?;
        let row = sqlx::query(&format!(
            r#"
            UPDATE design_submissions
            SET review_status = $2, reviewer_user_id = $3, feedback = $4, updated_at = NOW()
            WHERE id = $1
            RETURNING id, project_id, stage_gate_id, commit_sha, artifact_ref, review_status,
                      reviewer_user_id, feedback, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(submission_id)
        .bind(to_db(&status)?)
        .bind(actor.id)
        .bind(feedback)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("design submission", submission_id))?;
        submission_from_row(&row)
    }

    pub async fn freeze_project(&self, actor: &User, project_id: Uuid) -> PortalResult<Project> {
        Self::require_staff(actor)?;
        let row = sqlx::query(&format!(
            r#"
            UPDATE projects
            SET status = 'frozen', updated_at = NOW()
            WHERE id = $1
            RETURNING id, student_user_id, experiment_id, repo_url, workspace_ref, current_stage_id,
                      status, last_commit_sha, adapter_profile, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("project", project_id))?;
        project_from_row(&row)
    }

    pub async fn teacher_rows(
        &self,
        actor: &User,
        experiment_id: Uuid,
    ) -> PortalResult<Vec<TeacherProjectRow>> {
        Self::require_staff(actor)?;
        let rows = sqlx::query(&format!(
            "SELECT id, student_user_id, experiment_id, repo_url, workspace_ref, current_stage_id, status, last_commit_sha, adapter_profile, {TS_CREATED}, {TS_UPDATED} FROM projects WHERE experiment_id = $1 AND deleted_at IS NULL ORDER BY created_at"
        ))
        .bind(experiment_id)
        .fetch_all(&self.pool)
        .await?;
        let mut result = Vec::new();
        for row in rows {
            let project = project_from_row(&row)?;
            let student = self.user_by_id(project.student_user_id).await?;
            let overview = self.project_overview_from_project(&project).await?;
            let risk_flags = self.high_risk_flags(project.id).await?;
            result.push(TeacherProjectRow {
                project,
                student,
                current_stage: overview.current_stage,
                latest_pipeline: overview.latest_pipeline,
                score_summary: overview.score_summary,
                risk_flags,
            });
        }
        Ok(result)
    }

    pub async fn record_audit(&self, audit: AgentAuditRecord) -> PortalResult<AgentAuditRecord> {
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO agent_audit_records (
                id, session_id, user_id, project_id, model, task_kind, prompt_summary,
                response_summary, context_summary, tool_calls, risk_flags, risk_level
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id, session_id, user_id, project_id, model, task_kind, prompt_summary,
                      response_summary, context_summary, tool_calls, risk_flags, risk_level, {TS_CREATED}
            "#
        ))
        .bind(audit.id)
        .bind(audit.session_id)
        .bind(audit.user_id)
        .bind(audit.project_id)
        .bind(audit.model)
        .bind(audit.task_kind)
        .bind(audit.prompt_summary)
        .bind(audit.response_summary)
        .bind(audit.context_summary)
        .bind(serde_json::to_value(audit.tool_calls).map_err(json_error)?)
        .bind(serde_json::to_value(audit.risk_flags).map_err(json_error)?)
        .bind(to_db(&audit.risk_level)?)
        .fetch_one(&self.pool)
        .await?;
        audit_from_row(&row)
    }

    pub async fn list_audits(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<Vec<AgentAuditRecord>> {
        let project = self.project_by_id(project_id).await?;
        Self::require_project_access(actor, &project)?;
        let rows = sqlx::query(&format!(
            "SELECT id, session_id, user_id, project_id, model, task_kind, prompt_summary, response_summary, context_summary, tool_calls, risk_flags, risk_level, {TS_CREATED} FROM agent_audit_records WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC"
        ))
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(audit_from_row).collect()
    }

    async fn upsert_demo_user(
        &self,
        username: &str,
        display_name: &str,
        role: UserRole,
    ) -> PortalResult<User> {
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO users (username, display_name, role, status, password_hash)
            VALUES ($1, $2, $3, 'active', $4)
            ON CONFLICT (username) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                role = EXCLUDED.role,
                status = EXCLUDED.status,
                password_hash = EXCLUDED.password_hash,
                updated_at = NOW()
            RETURNING id, username, display_name, role, status, password_hash, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(username)
        .bind(display_name)
        .bind(to_db(&role)?)
        .bind(format!("demo:{username}"))
        .fetch_one(&self.pool)
        .await?;
        user_from_row(&row)
    }

    async fn upsert_demo_experiment(
        &self,
        course_id: Uuid,
        config: Value,
    ) -> PortalResult<Experiment> {
        let existing = sqlx::query(&format!(
            "SELECT id, course_id, title, description, experiment_type, spec_version, base_repo_url, publish_state, config, {TS_CREATED}, {TS_UPDATED} FROM experiments WHERE course_id = $1 AND title = 'xv6 Spec-Driven Kernel'"
        ))
        .bind(course_id)
        .fetch_optional(&self.pool)
        .await?;
        if let Some(row) = existing {
            return experiment_from_row(&row);
        }
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO experiments (
                course_id, title, description, experiment_type, spec_version,
                base_repo_url, publish_state, config
            )
            VALUES ($1, 'xv6 Spec-Driven Kernel',
                    'Progressive boot, memory, trap, process, and syscall lab.',
                    'os', 'xv6-spec-demo', 'local://examples/xv6-spec', 'published', $2)
            RETURNING id, course_id, title, description, experiment_type, spec_version,
                      base_repo_url, publish_state, config, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(course_id)
        .bind(config)
        .fetch_one(&self.pool)
        .await?;
        experiment_from_row(&row)
    }

    async fn upsert_demo_stage(
        &self,
        experiment_id: Uuid,
        key: &str,
        name: &str,
        sequence: i32,
        gate_type: GateKind,
        config: StageGateConfig,
    ) -> PortalResult<StageGate> {
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO stage_gates (experiment_id, key, name, sequence, gate_type, status, config)
            VALUES ($1, $2, $3, $4, $5, 'active', $6)
            ON CONFLICT (experiment_id, key) DO UPDATE SET
                name = EXCLUDED.name,
                sequence = EXCLUDED.sequence,
                gate_type = EXCLUDED.gate_type,
                status = EXCLUDED.status,
                config = EXCLUDED.config,
                updated_at = NOW()
            RETURNING id, experiment_id, key, name, sequence, gate_type, status, config, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(experiment_id)
        .bind(key)
        .bind(name)
        .bind(sequence)
        .bind(to_db(&gate_type)?)
        .bind(serde_json::to_value(config).map_err(json_error)?)
        .fetch_one(&self.pool)
        .await?;
        stage_from_row(&row)
    }

    async fn ensure_demo_pipeline(&self, project_id: Uuid) -> PortalResult<PipelineRun> {
        if let Some(row) = sqlx::query(&format!(
            "SELECT id, project_id, commit_sha, trigger_type, status, stage_scope, public_summary, retry_of, {TS_STARTED}, {TS_FINISHED} FROM pipeline_runs WHERE project_id = $1 AND trigger_type = 'demo' ORDER BY started_at DESC LIMIT 1"
        ))
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?
        {
            return pipeline_from_row(&row);
        }
        let summary = PublicSummary {
            status: PipelineStatus::Passed,
            passed: 1,
            failed: 0,
            total: 1,
            failure_class: None,
            message: "1/1 public evidence checks passed".into(),
        };
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO pipeline_runs (
                project_id, commit_sha, trigger_type, status, stage_scope, public_summary, finished_at
            )
            VALUES ($1, 'demo001', 'demo', 'passed', 'boot-minimum', $2, NOW())
            RETURNING id, project_id, commit_sha, trigger_type, status, stage_scope,
                      public_summary, retry_of, {TS_STARTED}, {TS_FINISHED}
            "#
        ))
        .bind(project_id)
        .bind(serde_json::to_value(summary).map_err(json_error)?)
        .fetch_one(&self.pool)
        .await?;
        pipeline_from_row(&row)
    }

    async fn ensure_demo_evidence(
        &self,
        project_id: Uuid,
        pipeline_id: Uuid,
    ) -> PortalResult<EvidenceRecord> {
        if let Some(row) = sqlx::query(&format!(
            "SELECT id, project_id, pipeline_run_id, commit_sha, kind, suite, case_name, result, metrics, log_segment, artifact_uri, {TS_CREATED} FROM evidence_records WHERE project_id = $1 AND suite = 'boot' AND case_name = 'serial_banner_check' LIMIT 1"
        ))
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?
        {
            return evidence_from_row(&row);
        }
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO evidence_records (
                project_id, pipeline_run_id, commit_sha, kind, suite, case_name,
                result, metrics, log_segment, artifact_uri
            )
            VALUES ($1, $2, 'demo001', 'test', 'boot', 'serial_banner_check',
                    'pass', $3, $4, '.vos/runs/demo/qemu.log')
            RETURNING id, project_id, pipeline_run_id, commit_sha, kind, suite, case_name,
                      result, metrics, log_segment, artifact_uri, {TS_CREATED}
            "#
        ))
        .bind(project_id)
        .bind(pipeline_id)
        .bind(json!({"boot_ms": 912, "signal": "XV6_BOOT_OK"}))
        .bind("[SPECLAB] kernel_init\nXV6_BOOT_OK")
        .fetch_one(&self.pool)
        .await?;
        evidence_from_row(&row)
    }

    async fn ensure_demo_rubric(&self, experiment_id: Uuid) -> PortalResult<EvaluationRubric> {
        if let Some(row) = sqlx::query(&format!(
            "SELECT id, experiment_id, name, status, target_kind, target_suite, target_case, weight, description, {TS_CREATED}, {TS_UPDATED} FROM evaluation_rubrics WHERE experiment_id = $1 AND name = 'Boot evidence' LIMIT 1"
        ))
        .bind(experiment_id)
        .fetch_optional(&self.pool)
        .await?
        {
            return rubric_from_row(&row);
        }
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO evaluation_rubrics (
                experiment_id, name, status, target_kind, target_suite, target_case,
                weight, description
            )
            VALUES ($1, 'Boot evidence', 'active', 'test', 'boot', 'serial_banner_check',
                    10.0, 'Boot banner and success marker are present.')
            RETURNING id, experiment_id, name, status, target_kind, target_suite, target_case,
                      weight, description, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(experiment_id)
        .fetch_one(&self.pool)
        .await?;
        rubric_from_row(&row)
    }

    async fn course_code_exists(&self, code: &str) -> PortalResult<bool> {
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM courses WHERE code = $1)")
                .bind(code)
                .fetch_one(&self.pool)
                .await?;
        Ok(exists)
    }

    pub(crate) async fn row_exists(&self, table: &str, id: Uuid) -> PortalResult<bool> {
        let query = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = $1)");
        let exists = sqlx::query_scalar::<_, bool>(&query)
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        Ok(exists)
    }

    async fn first_stage(&self, experiment_id: Uuid) -> PortalResult<Option<StageGate>> {
        let row = sqlx::query(&format!(
            "SELECT id, experiment_id, key, name, sequence, gate_type, status, config, {TS_CREATED}, {TS_UPDATED} FROM stage_gates WHERE experiment_id = $1 ORDER BY sequence LIMIT 1"
        ))
        .bind(experiment_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(stage_from_row).transpose()
    }

    async fn user_by_username(&self, username: &str) -> PortalResult<Option<User>> {
        let row = sqlx::query(&format!(
            "SELECT id, username, display_name, role, status, password_hash, {TS_CREATED}, {TS_UPDATED} FROM users WHERE username = $1"
        ))
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(user_from_row).transpose()
    }

    async fn user_by_id(&self, user_id: Uuid) -> PortalResult<User> {
        let row = sqlx::query(&format!(
            "SELECT id, username, display_name, role, status, password_hash, {TS_CREATED}, {TS_UPDATED} FROM users WHERE id = $1"
        ))
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("user", user_id))?;
        user_from_row(&row)
    }

    async fn project_by_id(&self, project_id: Uuid) -> PortalResult<Project> {
        let row = sqlx::query(&format!(
            "SELECT id, student_user_id, experiment_id, repo_url, workspace_ref, current_stage_id, status, last_commit_sha, adapter_profile, {TS_CREATED}, {TS_UPDATED} FROM projects WHERE id = $1 AND deleted_at IS NULL"
        ))
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("project", project_id))?;
        project_from_row(&row)
    }

    async fn stage_by_id(&self, stage_id: Uuid) -> PortalResult<StageGate> {
        let row = sqlx::query(&format!(
            "SELECT id, experiment_id, key, name, sequence, gate_type, status, config, {TS_CREATED}, {TS_UPDATED} FROM stage_gates WHERE id = $1"
        ))
        .bind(stage_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("stage", stage_id))?;
        stage_from_row(&row)
    }

    async fn pipeline_by_id(&self, pipeline_id: Uuid) -> PortalResult<PipelineRun> {
        let row = sqlx::query(&format!(
            "SELECT id, project_id, commit_sha, trigger_type, status, stage_scope, public_summary, retry_of, {TS_STARTED}, {TS_FINISHED} FROM pipeline_runs WHERE id = $1"
        ))
        .bind(pipeline_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("pipeline", pipeline_id))?;
        pipeline_from_row(&row)
    }

    async fn latest_pipeline(&self, project_id: Uuid) -> PortalResult<Option<PipelineRun>> {
        let row = sqlx::query(&format!(
            "SELECT id, project_id, commit_sha, trigger_type, status, stage_scope, public_summary, retry_of, {TS_STARTED}, {TS_FINISHED} FROM pipeline_runs WHERE project_id = $1 AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1"
        ))
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(pipeline_from_row).transpose()
    }

    async fn project_overview_from_project(
        &self,
        project: &Project,
    ) -> PortalResult<ProjectOverview> {
        let current_stage = self.stage_by_id(project.current_stage_id).await?;
        let latest_pipeline = self.latest_pipeline(project.id).await?;
        let score_summary = self.score_summary(project).await?;
        Ok(ProjectOverview {
            project: project.clone(),
            current_stage,
            latest_pipeline,
            score_summary,
        })
    }

    async fn score_summary(&self, project: &Project) -> PortalResult<ScoreSummary> {
        let row = sqlx::query(
            r#"
            SELECT
                COALESCE(SUM(COALESCE(manual_score, auto_score)), 0)::REAL AS earned,
                COUNT(*)::BIGINT AS score_count,
                COALESCE(BOOL_AND(is_final), FALSE) AS all_final
            FROM scores
            WHERE project_id = $1 AND deleted_at IS NULL
            "#,
        )
        .bind(project.id)
        .fetch_one(&self.pool)
        .await?;
        let possible = sqlx::query_scalar::<_, f32>(
            "SELECT COALESCE(SUM(weight), 0)::REAL FROM evaluation_rubrics WHERE experiment_id = $1 AND deleted_at IS NULL",
        )
        .bind(project.experiment_id)
        .fetch_one(&self.pool)
        .await?;
        let score_count: i64 = row.try_get("score_count")?;
        Ok(ScoreSummary {
            earned: row.try_get("earned")?,
            possible,
            finalized: score_count > 0 && row.try_get::<bool, _>("all_final")?,
        })
    }

    async fn project_evidence(&self, project_id: Uuid) -> PortalResult<Vec<EvidenceRecord>> {
        let rows = sqlx::query(&format!(
            "SELECT id, project_id, pipeline_run_id, commit_sha, kind, suite, case_name, result, metrics, log_segment, artifact_uri, {TS_CREATED} FROM evidence_records WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC"
        ))
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(evidence_from_row).collect()
    }

    async fn project_submissions(&self, project_id: Uuid) -> PortalResult<Vec<DesignSubmission>> {
        let rows = sqlx::query(&format!(
            "SELECT id, project_id, stage_gate_id, commit_sha, artifact_ref, review_status, reviewer_user_id, feedback, {TS_CREATED}, {TS_UPDATED} FROM design_submissions WHERE project_id = $1 AND deleted_at IS NULL"
        ))
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(submission_from_row).collect()
    }

    async fn rubrics_for_experiment(
        &self,
        experiment_id: Uuid,
    ) -> PortalResult<Vec<EvaluationRubric>> {
        let rows = sqlx::query(&format!(
            "SELECT id, experiment_id, name, status, target_kind, target_suite, target_case, weight, description, {TS_CREATED}, {TS_UPDATED} FROM evaluation_rubrics WHERE experiment_id = $1 AND deleted_at IS NULL"
        ))
        .bind(experiment_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(rubric_from_row).collect()
    }

    async fn scores_for_project(&self, project_id: Uuid) -> PortalResult<Vec<ScoreItem>> {
        let rows = sqlx::query(
            r#"
            SELECT id, project_id, rubric_id, auto_score, manual_score, feedback, is_final,
                   (EXTRACT(EPOCH FROM updated_at)::BIGINT)::TEXT AS updated_at
            FROM scores
            WHERE project_id = $1 AND deleted_at IS NULL
            ORDER BY updated_at DESC
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(score_from_row).collect()
    }

    async fn upsert_score(&self, score: ScoreItem) -> PortalResult<ScoreItem> {
        let row = sqlx::query(
            r#"
            INSERT INTO scores (
                id, project_id, rubric_id, auto_score, manual_score, feedback, is_final
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (project_id, rubric_id) DO UPDATE SET
                auto_score = EXCLUDED.auto_score,
                manual_score = EXCLUDED.manual_score,
                feedback = EXCLUDED.feedback,
                is_final = EXCLUDED.is_final,
                updated_at = NOW()
            RETURNING id, project_id, rubric_id, auto_score, manual_score, feedback, is_final,
                      (EXTRACT(EPOCH FROM updated_at)::BIGINT)::TEXT AS updated_at
            "#,
        )
        .bind(score.id)
        .bind(score.project_id)
        .bind(score.rubric_id)
        .bind(score.auto_score)
        .bind(score.manual_score)
        .bind(score.feedback)
        .bind(score.is_final)
        .fetch_one(&self.pool)
        .await?;
        score_from_row(&row)
    }

    async fn high_risk_flags(&self, project_id: Uuid) -> PortalResult<Vec<String>> {
        let rows = sqlx::query(
            "SELECT risk_flags FROM agent_audit_records WHERE project_id = $1 AND deleted_at IS NULL AND risk_level IN ('high', 'critical')",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        let mut flags = Vec::new();
        for row in rows {
            let value: Value = row.try_get("risk_flags")?;
            let mut row_flags: Vec<String> = serde_json::from_value(value).map_err(json_error)?;
            flags.append(&mut row_flags);
        }
        Ok(flags)
    }

    pub(crate) fn require_project_access(actor: &User, project: &Project) -> PortalResult<()> {
        if Self::is_staff(actor) || actor.id == project.student_user_id {
            Ok(())
        } else {
            Err(PortalError::Forbidden)
        }
    }

    pub(crate) fn require_staff(actor: &User) -> PortalResult<()> {
        if Self::is_staff(actor) {
            Ok(())
        } else {
            Err(PortalError::Forbidden)
        }
    }

    pub(crate) fn is_staff(actor: &User) -> bool {
        matches!(
            actor.role,
            UserRole::Admin | UserRole::Teacher | UserRole::Ta
        )
    }
}

pub(crate) fn to_db<T: Serialize>(value: &T) -> PortalResult<String> {
    match serde_json::to_value(value).map_err(json_error)? {
        Value::String(value) => Ok(value),
        value => Err(PortalError::Internal(format!(
            "expected string enum serialization, got {value}"
        ))),
    }
}

pub(crate) fn from_db<T: DeserializeOwned>(value: String) -> PortalResult<T> {
    serde_json::from_value(Value::String(value)).map_err(json_error)
}

pub(crate) fn json_error(error: serde_json::Error) -> PortalError {
    PortalError::Internal(error.to_string())
}

pub(crate) fn user_from_row(row: &PgRow) -> PortalResult<User> {
    Ok(User {
        id: row.try_get("id")?,
        username: row.try_get("username")?,
        display_name: row.try_get("display_name")?,
        role: from_db(row.try_get("role")?)?,
        status: from_db(row.try_get("status")?)?,
        password_hash: row.try_get("password_hash")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn course_from_row(row: &PgRow) -> PortalResult<Course> {
    Ok(Course {
        id: row.try_get("id")?,
        code: row.try_get("code")?,
        name: row.try_get("name")?,
        term: row.try_get("term")?,
        description: row.try_get("description")?,
        status: from_db::<CourseStatus>(row.try_get("status")?)?,
        owner_user_id: row.try_get("owner_user_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn experiment_from_row(row: &PgRow) -> PortalResult<Experiment> {
    Ok(Experiment {
        id: row.try_get("id")?,
        course_id: row.try_get("course_id")?,
        title: row.try_get("title")?,
        description: row.try_get("description")?,
        experiment_type: from_db::<ExperimentType>(row.try_get("experiment_type")?)?,
        spec_version: row.try_get("spec_version")?,
        base_repo_url: row.try_get("base_repo_url")?,
        publish_state: from_db::<PublishState>(row.try_get("publish_state")?)?,
        config: row.try_get("config")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn stage_from_row(row: &PgRow) -> PortalResult<StageGate> {
    let config: Value = row.try_get("config")?;
    Ok(StageGate {
        id: row.try_get("id")?,
        experiment_id: row.try_get("experiment_id")?,
        key: row.try_get("key")?,
        name: row.try_get("name")?,
        sequence: row.try_get("sequence")?,
        gate_type: from_db::<GateKind>(row.try_get("gate_type")?)?,
        status: from_db::<GateStatus>(row.try_get("status")?)?,
        config: serde_json::from_value(config).map_err(json_error)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn project_from_row(row: &PgRow) -> PortalResult<Project> {
    Ok(Project {
        id: row.try_get("id")?,
        student_user_id: row.try_get("student_user_id")?,
        experiment_id: row.try_get("experiment_id")?,
        repo_url: row.try_get("repo_url")?,
        workspace_ref: row.try_get("workspace_ref")?,
        current_stage_id: row.try_get("current_stage_id")?,
        status: from_db::<ProjectStatus>(row.try_get("status")?)?,
        last_commit_sha: row.try_get("last_commit_sha")?,
        adapter_profile: row.try_get("adapter_profile")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn submission_from_row(row: &PgRow) -> PortalResult<DesignSubmission> {
    Ok(DesignSubmission {
        id: row.try_get("id")?,
        project_id: row.try_get("project_id")?,
        stage_gate_id: row.try_get("stage_gate_id")?,
        commit_sha: row.try_get("commit_sha")?,
        artifact_ref: row.try_get("artifact_ref")?,
        review_status: from_db::<DesignReviewStatus>(row.try_get("review_status")?)?,
        reviewer_user_id: row.try_get("reviewer_user_id")?,
        feedback: row.try_get("feedback")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn pipeline_from_row(row: &PgRow) -> PortalResult<PipelineRun> {
    let summary: Option<Value> = row.try_get("public_summary")?;
    Ok(PipelineRun {
        id: row.try_get("id")?,
        project_id: row.try_get("project_id")?,
        commit_sha: row.try_get("commit_sha")?,
        trigger_type: from_db::<TriggerType>(row.try_get("trigger_type")?)?,
        status: from_db::<PipelineStatus>(row.try_get("status")?)?,
        stage_scope: row.try_get("stage_scope")?,
        public_summary: summary
            .map(serde_json::from_value)
            .transpose()
            .map_err(json_error)?,
        retry_of: row.try_get("retry_of")?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
    })
}

pub(crate) fn evidence_from_row(row: &PgRow) -> PortalResult<EvidenceRecord> {
    Ok(EvidenceRecord {
        id: row.try_get("id")?,
        project_id: row.try_get("project_id")?,
        pipeline_run_id: row.try_get("pipeline_run_id")?,
        commit_sha: row.try_get("commit_sha")?,
        kind: from_db(row.try_get("kind")?)?,
        suite: row.try_get("suite")?,
        case_name: row.try_get("case_name")?,
        result: from_db(row.try_get("result")?)?,
        metrics: row.try_get("metrics")?,
        log_segment: row.try_get("log_segment")?,
        artifact_uri: row.try_get("artifact_uri")?,
        created_at: row.try_get("created_at")?,
    })
}

pub(crate) fn rubric_from_row(row: &PgRow) -> PortalResult<EvaluationRubric> {
    Ok(EvaluationRubric {
        id: row.try_get("id")?,
        experiment_id: row.try_get("experiment_id")?,
        name: row.try_get("name")?,
        status: from_db::<RubricStatus>(row.try_get("status")?)?,
        target_kind: from_db(row.try_get("target_kind")?)?,
        target_suite: row.try_get("target_suite")?,
        target_case: row.try_get("target_case")?,
        weight: row.try_get("weight")?,
        description: row.try_get("description")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn score_from_row(row: &PgRow) -> PortalResult<ScoreItem> {
    Ok(ScoreItem {
        id: row.try_get("id")?,
        project_id: row.try_get("project_id")?,
        rubric_id: row.try_get("rubric_id")?,
        auto_score: row.try_get("auto_score")?,
        manual_score: row.try_get("manual_score")?,
        feedback: row.try_get("feedback")?,
        is_final: row.try_get("is_final")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn audit_from_row(row: &PgRow) -> PortalResult<AgentAuditRecord> {
    let tool_calls: Value = row.try_get("tool_calls")?;
    let risk_flags: Value = row.try_get("risk_flags")?;
    Ok(AgentAuditRecord {
        id: row.try_get("id")?,
        session_id: row.try_get("session_id")?,
        user_id: row.try_get("user_id")?,
        project_id: row.try_get("project_id")?,
        model: row.try_get("model")?,
        task_kind: row.try_get("task_kind")?,
        prompt_summary: row.try_get("prompt_summary")?,
        response_summary: row.try_get("response_summary")?,
        context_summary: row.try_get("context_summary")?,
        tool_calls: serde_json::from_value(tool_calls).map_err(json_error)?,
        risk_flags: serde_json::from_value(risk_flags).map_err(json_error)?,
        risk_level: from_db::<AgentRiskLevel>(row.try_get("risk_level")?)?,
        created_at: row.try_get("created_at")?,
    })
}
