use serde_json::json;
use sqlx::Row;
use uuid::Uuid;
use vos_course::{
    AgentAuditRecord, Course, CreateAgentAuditRequest, CreateDesignSubmissionRequest,
    CreateEvidenceRecordRequest, CreatePipelineRunRequest, CreateRubricRequest, CreateScoreRequest,
    CreateUserRequest, DeleteResponse, DesignSubmission, EvaluationRubric, EvidenceRecord,
    PipelineRun, PipelineStatus, Project, ScoreItem, StageGate, UpdateAgentAuditRequest,
    UpdateCourseRequest, UpdateDesignSubmissionRequest, UpdateEvidenceRecordRequest,
    UpdateExperimentRequest, UpdatePipelineRunRequest, UpdateProjectRequest, UpdateRubricRequest,
    UpdateScoreRequest, UpdateStageGateRequest, UpdateUserRequest, User,
};

use crate::error::{PortalError, PortalResult};
use crate::postgres_store::{
    PostgresStore, audit_from_row, course_from_row, evidence_from_row, experiment_from_row,
    json_error, pipeline_from_row, project_from_row, rubric_from_row, score_from_row,
    stage_from_row, submission_from_row, to_db, user_from_row,
};

const TS_CREATED: &str = "(EXTRACT(EPOCH FROM created_at)::BIGINT)::TEXT AS created_at";
const TS_UPDATED: &str = "(EXTRACT(EPOCH FROM updated_at)::BIGINT)::TEXT AS updated_at";
const TS_STARTED: &str = "(EXTRACT(EPOCH FROM started_at)::BIGINT)::TEXT AS started_at";
const TS_FINISHED: &str = "(EXTRACT(EPOCH FROM finished_at)::BIGINT)::TEXT AS finished_at";

impl PostgresStore {
    pub async fn list_users(&self, actor: &User, include_deleted: bool) -> PortalResult<Vec<User>> {
        Self::require_staff(actor)?;
        let filter = deleted_filter(include_deleted);
        let rows = sqlx::query(&format!(
            "SELECT id, username, display_name, role, status, password_hash, {TS_CREATED}, {TS_UPDATED} FROM users {filter} ORDER BY username"
        ))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(user_from_row).collect()
    }

    pub async fn create_user(
        &self,
        actor: &User,
        request: CreateUserRequest,
    ) -> PortalResult<User> {
        Self::require_staff(actor)?;
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO users (username, display_name, role, status, password_hash)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, username, display_name, role, status, password_hash, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(request.username)
        .bind(request.display_name)
        .bind(to_db(&request.role)?)
        .bind(to_db(&request.status)?)
        .bind(request.password.map(|password| format!("demo:{password}")))
        .fetch_one(&self.pool)
        .await?;
        user_from_row(&row)
    }

    pub async fn get_user(
        &self,
        actor: &User,
        user_id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<User> {
        Self::require_staff(actor)?;
        let filter = if include_deleted {
            "id = $1"
        } else {
            "id = $1 AND deleted_at IS NULL"
        };
        let row = sqlx::query(&format!(
            "SELECT id, username, display_name, role, status, password_hash, {TS_CREATED}, {TS_UPDATED} FROM users WHERE {filter}"
        ))
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("user", user_id))?;
        user_from_row(&row)
    }

    pub async fn update_user(
        &self,
        actor: &User,
        user_id: Uuid,
        request: UpdateUserRequest,
    ) -> PortalResult<User> {
        Self::require_staff(actor)?;
        let current = self.get_user(actor, user_id, true).await?;
        let row = sqlx::query(&format!(
            r#"
            UPDATE users
            SET username = $2,
                display_name = $3,
                role = $4,
                status = $5,
                password_hash = $6,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, username, display_name, role, status, password_hash, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(user_id)
        .bind(request.username.unwrap_or(current.username))
        .bind(request.display_name.unwrap_or(current.display_name))
        .bind(to_db(&request.role.unwrap_or(current.role))?)
        .bind(to_db(&request.status.unwrap_or(current.status))?)
        .bind(
            request
                .password
                .map(|password| format!("demo:{password}"))
                .or(current.password_hash),
        )
        .fetch_one(&self.pool)
        .await?;
        user_from_row(&row)
    }

    pub async fn delete_user(&self, actor: &User, user_id: Uuid) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete("users", user_id, Some("status = 'archived'"))
            .await
    }

    pub async fn get_course(&self, course_id: Uuid, include_deleted: bool) -> PortalResult<Course> {
        let filter = if include_deleted {
            "id = $1"
        } else {
            "id = $1 AND deleted_at IS NULL"
        };
        let row = sqlx::query(&format!(
            "SELECT id, code, name, term, description, status, owner_user_id, {TS_CREATED}, {TS_UPDATED} FROM courses WHERE {filter}"
        ))
        .bind(course_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("course", course_id))?;
        course_from_row(&row)
    }

    pub async fn update_course(
        &self,
        actor: &User,
        course_id: Uuid,
        request: UpdateCourseRequest,
    ) -> PortalResult<Course> {
        Self::require_staff(actor)?;
        let current = self.get_course(course_id, true).await?;
        let row = sqlx::query(&format!(
            r#"
            UPDATE courses
            SET code = $2, name = $3, term = $4, description = $5, status = $6, updated_at = NOW()
            WHERE id = $1
            RETURNING id, code, name, term, description, status, owner_user_id, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(course_id)
        .bind(request.code.unwrap_or(current.code))
        .bind(request.name.unwrap_or(current.name))
        .bind(request.term.unwrap_or(current.term))
        .bind(request.description.or(current.description))
        .bind(to_db(&request.status.unwrap_or(current.status))?)
        .fetch_one(&self.pool)
        .await?;
        course_from_row(&row)
    }

    pub async fn delete_course(
        &self,
        actor: &User,
        course_id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete("courses", course_id, Some("status = 'archived'"))
            .await
    }

    pub async fn get_experiment(
        &self,
        experiment_id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<vos_course::Experiment> {
        let filter = if include_deleted {
            "id = $1"
        } else {
            "id = $1 AND deleted_at IS NULL"
        };
        let row = sqlx::query(&format!(
            "SELECT id, course_id, title, description, experiment_type, spec_version, base_repo_url, publish_state, config, {TS_CREATED}, {TS_UPDATED} FROM experiments WHERE {filter}"
        ))
        .bind(experiment_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("experiment", experiment_id))?;
        experiment_from_row(&row)
    }

    pub async fn update_experiment(
        &self,
        actor: &User,
        experiment_id: Uuid,
        request: UpdateExperimentRequest,
    ) -> PortalResult<vos_course::Experiment> {
        Self::require_staff(actor)?;
        let current = self.get_experiment(experiment_id, true).await?;
        let row = sqlx::query(&format!(
            r#"
            UPDATE experiments
            SET course_id = $2, title = $3, description = $4, experiment_type = $5,
                spec_version = $6, base_repo_url = $7, publish_state = $8, config = $9,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, course_id, title, description, experiment_type, spec_version,
                      base_repo_url, publish_state, config, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(experiment_id)
        .bind(request.course_id.unwrap_or(current.course_id))
        .bind(request.title.unwrap_or(current.title))
        .bind(request.description.or(current.description))
        .bind(to_db(
            &request.experiment_type.unwrap_or(current.experiment_type),
        )?)
        .bind(request.spec_version.unwrap_or(current.spec_version))
        .bind(request.base_repo_url.or(current.base_repo_url))
        .bind(to_db(
            &request.publish_state.unwrap_or(current.publish_state),
        )?)
        .bind(request.config.unwrap_or(current.config))
        .fetch_one(&self.pool)
        .await?;
        experiment_from_row(&row)
    }

    pub async fn delete_experiment(
        &self,
        actor: &User,
        experiment_id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete(
            "experiments",
            experiment_id,
            Some("publish_state = 'archived'"),
        )
        .await
    }

    pub async fn get_stage_gate(
        &self,
        stage_id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<StageGate> {
        let filter = if include_deleted {
            "id = $1"
        } else {
            "id = $1 AND deleted_at IS NULL"
        };
        let row = sqlx::query(&format!(
            "SELECT id, experiment_id, key, name, sequence, gate_type, status, config, {TS_CREATED}, {TS_UPDATED} FROM stage_gates WHERE {filter}"
        ))
        .bind(stage_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("stage", stage_id))?;
        stage_from_row(&row)
    }

    pub async fn update_stage_gate(
        &self,
        actor: &User,
        stage_id: Uuid,
        request: UpdateStageGateRequest,
    ) -> PortalResult<StageGate> {
        Self::require_staff(actor)?;
        let current = self.get_stage_gate(stage_id, true).await?;
        let row = sqlx::query(&format!(
            r#"
            UPDATE stage_gates
            SET key = $2, name = $3, sequence = $4, gate_type = $5, status = $6,
                config = $7, updated_at = NOW()
            WHERE id = $1
            RETURNING id, experiment_id, key, name, sequence, gate_type, status, config, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(stage_id)
        .bind(request.key.unwrap_or(current.key))
        .bind(request.name.unwrap_or(current.name))
        .bind(request.sequence.unwrap_or(current.sequence))
        .bind(to_db(&request.gate_type.unwrap_or(current.gate_type))?)
        .bind(to_db(&request.status.unwrap_or(current.status))?)
        .bind(serde_json::to_value(request.config.unwrap_or(current.config)).map_err(json_error)?)
        .fetch_one(&self.pool)
        .await?;
        stage_from_row(&row)
    }

    pub async fn delete_stage_gate(
        &self,
        actor: &User,
        stage_id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete("stage_gates", stage_id, Some("status = 'retired'"))
            .await
    }

    pub async fn update_project(
        &self,
        actor: &User,
        project_id: Uuid,
        request: UpdateProjectRequest,
    ) -> PortalResult<Project> {
        let current = self.project_overview(actor, project_id).await?.project;
        if !Self::is_staff(actor) && request.status.is_some() {
            return Err(PortalError::Forbidden);
        }
        let row = sqlx::query(&format!(
            r#"
            UPDATE projects
            SET repo_url = $2, workspace_ref = $3, current_stage_id = $4, status = $5,
                last_commit_sha = $6, adapter_profile = $7, updated_at = NOW()
            WHERE id = $1
            RETURNING id, student_user_id, experiment_id, repo_url, workspace_ref, current_stage_id,
                      status, last_commit_sha, adapter_profile, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(project_id)
        .bind(request.repo_url.or(current.repo_url))
        .bind(request.workspace_ref.or(current.workspace_ref))
        .bind(request.current_stage_id.unwrap_or(current.current_stage_id))
        .bind(to_db(&request.status.unwrap_or(current.status))?)
        .bind(request.last_commit_sha.or(current.last_commit_sha))
        .bind(request.adapter_profile.unwrap_or(current.adapter_profile))
        .fetch_one(&self.pool)
        .await?;
        project_from_row(&row)
    }

    pub async fn delete_project(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete("projects", project_id, Some("status = 'archived'"))
            .await
    }

    pub async fn list_design_submissions(
        &self,
        actor: &User,
        project_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<DesignSubmission>> {
        let mut query = format!(
            "SELECT id, project_id, stage_gate_id, commit_sha, artifact_ref, review_status, reviewer_user_id, feedback, {TS_CREATED}, {TS_UPDATED} FROM design_submissions"
        );
        let filter = deleted_condition(include_deleted);
        let rows = if let Some(project_id) = project_id {
            let project = self.project_overview(actor, project_id).await?.project;
            Self::require_project_access(actor, &project)?;
            query.push_str(&format!(
                " WHERE project_id = $1{filter} ORDER BY created_at DESC"
            ));
            sqlx::query(&query)
                .bind(project_id)
                .fetch_all(&self.pool)
                .await?
        } else {
            Self::require_staff(actor)?;
            query.push_str(&format!(" WHERE TRUE{filter} ORDER BY created_at DESC"));
            sqlx::query(&query).fetch_all(&self.pool).await?
        };
        rows.iter().map(submission_from_row).collect()
    }

    pub async fn create_design_submission(
        &self,
        actor: &User,
        request: CreateDesignSubmissionRequest,
    ) -> PortalResult<DesignSubmission> {
        self.submit_design(
            actor,
            request.project_id,
            request.stage_gate_id,
            request.commit_sha,
            request.artifact_ref,
        )
        .await
    }

    pub async fn get_design_submission(
        &self,
        actor: &User,
        submission_id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<DesignSubmission> {
        let filter = if include_deleted {
            "id = $1"
        } else {
            "id = $1 AND deleted_at IS NULL"
        };
        let row = sqlx::query(&format!(
            "SELECT id, project_id, stage_gate_id, commit_sha, artifact_ref, review_status, reviewer_user_id, feedback, {TS_CREATED}, {TS_UPDATED} FROM design_submissions WHERE {filter}"
        ))
        .bind(submission_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("design submission", submission_id))?;
        let submission = submission_from_row(&row)?;
        let project = self
            .project_overview(actor, submission.project_id)
            .await?
            .project;
        Self::require_project_access(actor, &project)?;
        Ok(submission)
    }

    pub async fn update_design_submission(
        &self,
        actor: &User,
        submission_id: Uuid,
        request: UpdateDesignSubmissionRequest,
    ) -> PortalResult<DesignSubmission> {
        let current = self
            .get_design_submission(actor, submission_id, true)
            .await?;
        if !Self::is_staff(actor)
            && (request.review_status.is_some() || request.reviewer_user_id.is_some())
        {
            return Err(PortalError::Forbidden);
        }
        let row = sqlx::query(&format!(
            r#"
            UPDATE design_submissions
            SET artifact_ref = $2, review_status = $3, reviewer_user_id = $4, feedback = $5, updated_at = NOW()
            WHERE id = $1
            RETURNING id, project_id, stage_gate_id, commit_sha, artifact_ref, review_status,
                      reviewer_user_id, feedback, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(submission_id)
        .bind(request.artifact_ref.or(current.artifact_ref))
        .bind(to_db(&request.review_status.unwrap_or(current.review_status))?)
        .bind(request.reviewer_user_id.or(current.reviewer_user_id))
        .bind(request.feedback.or(current.feedback))
        .fetch_one(&self.pool)
        .await?;
        submission_from_row(&row)
    }

    pub async fn delete_design_submission(
        &self,
        actor: &User,
        submission_id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete("design_submissions", submission_id, None)
            .await
    }

    pub async fn list_all_pipelines(
        &self,
        actor: &User,
        project_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<PipelineRun>> {
        let filter = deleted_condition(include_deleted);
        let rows = if let Some(project_id) = project_id {
            let project = self.project_overview(actor, project_id).await?.project;
            Self::require_project_access(actor, &project)?;
            sqlx::query(&format!(
                "SELECT id, project_id, commit_sha, trigger_type, status, stage_scope, public_summary, retry_of, {TS_STARTED}, {TS_FINISHED} FROM pipeline_runs WHERE project_id = $1{filter} ORDER BY started_at DESC"
            ))
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?
        } else {
            Self::require_staff(actor)?;
            sqlx::query(&format!(
                "SELECT id, project_id, commit_sha, trigger_type, status, stage_scope, public_summary, retry_of, {TS_STARTED}, {TS_FINISHED} FROM pipeline_runs WHERE TRUE{filter} ORDER BY started_at DESC"
            ))
            .fetch_all(&self.pool)
            .await?
        };
        rows.iter().map(pipeline_from_row).collect()
    }

    pub async fn create_pipeline_run(
        &self,
        actor: &User,
        request: CreatePipelineRunRequest,
    ) -> PortalResult<PipelineRun> {
        let project = self
            .project_overview(actor, request.project_id)
            .await?
            .project;
        Self::require_project_access(actor, &project)?;
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO pipeline_runs (project_id, commit_sha, trigger_type, status, stage_scope)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, project_id, commit_sha, trigger_type, status, stage_scope, public_summary,
                      retry_of, {TS_STARTED}, {TS_FINISHED}
            "#
        ))
        .bind(request.project_id)
        .bind(request.commit_sha)
        .bind(to_db(&request.trigger_type)?)
        .bind(to_db(&request.status.unwrap_or(PipelineStatus::Running))?)
        .bind(request.stage_scope)
        .fetch_one(&self.pool)
        .await?;
        pipeline_from_row(&row)
    }

    pub async fn update_pipeline_run(
        &self,
        actor: &User,
        pipeline_id: Uuid,
        request: UpdatePipelineRunRequest,
    ) -> PortalResult<PipelineRun> {
        Self::require_staff(actor)?;
        let current = self.pipeline(actor, pipeline_id).await?;
        let public_summary = request
            .public_summary
            .map(|summary| serde_json::to_value(summary).map_err(json_error))
            .transpose()?
            .or_else(|| {
                current
                    .public_summary
                    .and_then(|summary| serde_json::to_value(summary).ok())
            });
        let row = sqlx::query(&format!(
            r#"
            UPDATE pipeline_runs
            SET status = $2,
                stage_scope = $3,
                public_summary = $4,
                finished_at = CASE WHEN $5 THEN NOW() ELSE finished_at END
            WHERE id = $1
            RETURNING id, project_id, commit_sha, trigger_type, status, stage_scope, public_summary,
                      retry_of, {TS_STARTED}, {TS_FINISHED}
            "#
        ))
        .bind(pipeline_id)
        .bind(to_db(&request.status.unwrap_or(current.status))?)
        .bind(request.stage_scope.or(current.stage_scope))
        .bind(public_summary)
        .bind(request.finished.unwrap_or(false))
        .fetch_one(&self.pool)
        .await?;
        pipeline_from_row(&row)
    }

    pub async fn delete_pipeline_run(
        &self,
        actor: &User,
        pipeline_id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete("pipeline_runs", pipeline_id, Some("status = 'cancelled'"))
            .await
    }

    pub async fn list_all_evidence(
        &self,
        actor: &User,
        project_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<EvidenceRecord>> {
        if let Some(project_id) = project_id {
            return self.list_evidence(actor, project_id).await;
        }
        Self::require_staff(actor)?;
        let filter = deleted_filter(include_deleted);
        let rows = sqlx::query(&format!(
            "SELECT id, project_id, pipeline_run_id, commit_sha, kind, suite, case_name, result, metrics, log_segment, artifact_uri, {TS_CREATED} FROM evidence_records {filter} ORDER BY created_at DESC"
        ))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(evidence_from_row).collect()
    }

    pub async fn create_evidence_record(
        &self,
        actor: &User,
        request: CreateEvidenceRecordRequest,
    ) -> PortalResult<EvidenceRecord> {
        let project = self
            .project_overview(actor, request.project_id)
            .await?
            .project;
        Self::require_project_access(actor, &project)?;
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO evidence_records (
                project_id, pipeline_run_id, commit_sha, kind, suite, case_name,
                result, metrics, log_segment, artifact_uri, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id, project_id, pipeline_run_id, commit_sha, kind, suite, case_name,
                      result, metrics, log_segment, artifact_uri, {TS_CREATED}
            "#
        ))
        .bind(request.project_id)
        .bind(request.pipeline_run_id)
        .bind(request.commit_sha)
        .bind(to_db(&request.kind)?)
        .bind(request.suite)
        .bind(request.case_name)
        .bind(to_db(&request.result)?)
        .bind(request.metrics)
        .bind(request.log_segment)
        .bind(request.artifact_uri)
        .bind(request.metadata)
        .fetch_one(&self.pool)
        .await?;
        evidence_from_row(&row)
    }

    pub async fn get_evidence_record(
        &self,
        actor: &User,
        evidence_id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<EvidenceRecord> {
        let filter = if include_deleted {
            "id = $1"
        } else {
            "id = $1 AND deleted_at IS NULL"
        };
        let row = sqlx::query(&format!(
            "SELECT id, project_id, pipeline_run_id, commit_sha, kind, suite, case_name, result, metrics, log_segment, artifact_uri, {TS_CREATED} FROM evidence_records WHERE {filter}"
        ))
        .bind(evidence_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("evidence", evidence_id))?;
        let evidence = evidence_from_row(&row)?;
        let project = self
            .project_overview(actor, evidence.project_id)
            .await?
            .project;
        Self::require_project_access(actor, &project)?;
        Ok(evidence)
    }

    pub async fn update_evidence_record(
        &self,
        actor: &User,
        evidence_id: Uuid,
        request: UpdateEvidenceRecordRequest,
    ) -> PortalResult<EvidenceRecord> {
        Self::require_staff(actor)?;
        let current = self.get_evidence_record(actor, evidence_id, true).await?;
        let row = sqlx::query(&format!(
            r#"
            UPDATE evidence_records
            SET artifact_uri = $2,
                review_status = COALESCE($3, review_status),
                visibility_state = COALESCE($4, visibility_state),
                metadata = COALESCE($5, metadata)
            WHERE id = $1
            RETURNING id, project_id, pipeline_run_id, commit_sha, kind, suite, case_name,
                      result, metrics, log_segment, artifact_uri, {TS_CREATED}
            "#
        ))
        .bind(evidence_id)
        .bind(request.artifact_uri.or(current.artifact_uri))
        .bind(request.review_status)
        .bind(request.visibility_state)
        .bind(request.metadata)
        .fetch_one(&self.pool)
        .await?;
        evidence_from_row(&row)
    }

    pub async fn delete_evidence_record(
        &self,
        actor: &User,
        evidence_id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete(
            "evidence_records",
            evidence_id,
            Some("visibility_state = 'hidden'"),
        )
        .await
    }

    pub async fn list_rubrics(
        &self,
        actor: &User,
        experiment_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<EvaluationRubric>> {
        Self::require_staff(actor)?;
        let filter = deleted_condition(include_deleted);
        let rows = if let Some(experiment_id) = experiment_id {
            sqlx::query(&format!(
                "SELECT id, experiment_id, name, status, target_kind, target_suite, target_case, weight, description, {TS_CREATED}, {TS_UPDATED} FROM evaluation_rubrics WHERE experiment_id = $1{filter} ORDER BY name"
            ))
            .bind(experiment_id)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(&format!(
                "SELECT id, experiment_id, name, status, target_kind, target_suite, target_case, weight, description, {TS_CREATED}, {TS_UPDATED} FROM evaluation_rubrics WHERE TRUE{filter} ORDER BY name"
            ))
            .fetch_all(&self.pool)
            .await?
        };
        rows.iter().map(rubric_from_row).collect()
    }

    pub async fn create_rubric(
        &self,
        actor: &User,
        request: CreateRubricRequest,
    ) -> PortalResult<EvaluationRubric> {
        Self::require_staff(actor)?;
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO evaluation_rubrics (
                experiment_id, name, status, target_kind, target_suite, target_case, weight, description
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, experiment_id, name, status, target_kind, target_suite, target_case,
                      weight, description, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(request.experiment_id)
        .bind(request.name)
        .bind(to_db(&request.status)?)
        .bind(to_db(&request.target_kind)?)
        .bind(request.target_suite)
        .bind(request.target_case)
        .bind(request.weight)
        .bind(request.description)
        .fetch_one(&self.pool)
        .await?;
        rubric_from_row(&row)
    }

    pub async fn get_rubric(
        &self,
        actor: &User,
        rubric_id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<EvaluationRubric> {
        Self::require_staff(actor)?;
        let filter = if include_deleted {
            "id = $1"
        } else {
            "id = $1 AND deleted_at IS NULL"
        };
        let row = sqlx::query(&format!(
            "SELECT id, experiment_id, name, status, target_kind, target_suite, target_case, weight, description, {TS_CREATED}, {TS_UPDATED} FROM evaluation_rubrics WHERE {filter}"
        ))
        .bind(rubric_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("rubric", rubric_id))?;
        rubric_from_row(&row)
    }

    pub async fn update_rubric(
        &self,
        actor: &User,
        rubric_id: Uuid,
        request: UpdateRubricRequest,
    ) -> PortalResult<EvaluationRubric> {
        let current = self.get_rubric(actor, rubric_id, true).await?;
        let row = sqlx::query(&format!(
            r#"
            UPDATE evaluation_rubrics
            SET name = $2, status = $3, target_kind = $4, target_suite = $5,
                target_case = $6, weight = $7, description = $8, updated_at = NOW()
            WHERE id = $1
            RETURNING id, experiment_id, name, status, target_kind, target_suite, target_case,
                      weight, description, {TS_CREATED}, {TS_UPDATED}
            "#
        ))
        .bind(rubric_id)
        .bind(request.name.unwrap_or(current.name))
        .bind(to_db(&request.status.unwrap_or(current.status))?)
        .bind(to_db(&request.target_kind.unwrap_or(current.target_kind))?)
        .bind(request.target_suite.or(current.target_suite))
        .bind(request.target_case.or(current.target_case))
        .bind(request.weight.unwrap_or(current.weight))
        .bind(request.description.or(current.description))
        .fetch_one(&self.pool)
        .await?;
        rubric_from_row(&row)
    }

    pub async fn delete_rubric(
        &self,
        actor: &User,
        rubric_id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete(
            "evaluation_rubrics",
            rubric_id,
            Some("status = 'superseded'"),
        )
        .await
    }

    pub async fn list_all_scores(
        &self,
        actor: &User,
        project_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<ScoreItem>> {
        if let Some(project_id) = project_id {
            return self.list_scores(actor, project_id).await;
        }
        Self::require_staff(actor)?;
        let filter = deleted_filter(include_deleted);
        let rows = sqlx::query(&format!(
            "SELECT id, project_id, rubric_id, auto_score, manual_score, feedback, is_final, (EXTRACT(EPOCH FROM updated_at)::BIGINT)::TEXT AS updated_at FROM scores {filter} ORDER BY updated_at DESC"
        ))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(score_from_row).collect()
    }

    pub async fn create_score(
        &self,
        actor: &User,
        request: CreateScoreRequest,
    ) -> PortalResult<ScoreItem> {
        Self::require_staff(actor)?;
        let row = sqlx::query(
            r#"
            INSERT INTO scores (project_id, rubric_id, auto_score, manual_score, feedback, is_final)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, project_id, rubric_id, auto_score, manual_score, feedback, is_final,
                      (EXTRACT(EPOCH FROM updated_at)::BIGINT)::TEXT AS updated_at
            "#,
        )
        .bind(request.project_id)
        .bind(request.rubric_id)
        .bind(request.auto_score.unwrap_or(0.0))
        .bind(request.manual_score)
        .bind(request.feedback)
        .bind(request.is_final.unwrap_or(false))
        .fetch_one(&self.pool)
        .await?;
        score_from_row(&row)
    }

    pub async fn get_score(
        &self,
        actor: &User,
        score_id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<ScoreItem> {
        let filter = if include_deleted {
            "id = $1"
        } else {
            "id = $1 AND deleted_at IS NULL"
        };
        let row = sqlx::query(&format!(
            "SELECT id, project_id, rubric_id, auto_score, manual_score, feedback, is_final, (EXTRACT(EPOCH FROM updated_at)::BIGINT)::TEXT AS updated_at FROM scores WHERE {filter}"
        ))
        .bind(score_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("score", score_id))?;
        let score = score_from_row(&row)?;
        let project = self
            .project_overview(actor, score.project_id)
            .await?
            .project;
        Self::require_project_access(actor, &project)?;
        Ok(score)
    }

    pub async fn update_score_by_id(
        &self,
        actor: &User,
        score_id: Uuid,
        request: UpdateScoreRequest,
    ) -> PortalResult<ScoreItem> {
        Self::require_staff(actor)?;
        let current = self.get_score(actor, score_id, true).await?;
        let row = sqlx::query(
            r#"
            UPDATE scores
            SET rubric_id = $2, manual_score = $3, feedback = $4, is_final = $5, updated_at = NOW()
            WHERE id = $1
            RETURNING id, project_id, rubric_id, auto_score, manual_score, feedback, is_final,
                      (EXTRACT(EPOCH FROM updated_at)::BIGINT)::TEXT AS updated_at
            "#,
        )
        .bind(score_id)
        .bind(request.rubric_id)
        .bind(request.manual_score.or(current.manual_score))
        .bind(request.feedback.or(current.feedback))
        .bind(request.is_final.unwrap_or(current.is_final))
        .fetch_one(&self.pool)
        .await?;
        score_from_row(&row)
    }

    pub async fn delete_score(&self, actor: &User, score_id: Uuid) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete("scores", score_id, None).await
    }

    pub async fn list_agent_audits(
        &self,
        actor: &User,
        project_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<AgentAuditRecord>> {
        if let Some(project_id) = project_id {
            return self.list_audits(actor, project_id).await;
        }
        Self::require_staff(actor)?;
        let filter = deleted_filter(include_deleted);
        let rows = sqlx::query(&format!(
            "SELECT id, session_id, user_id, project_id, model, task_kind, prompt_summary, response_summary, context_summary, tool_calls, risk_flags, risk_level, {TS_CREATED} FROM agent_audit_records {filter} ORDER BY created_at DESC"
        ))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(audit_from_row).collect()
    }

    pub async fn create_agent_audit(
        &self,
        actor: &User,
        request: CreateAgentAuditRequest,
    ) -> PortalResult<AgentAuditRecord> {
        Self::require_staff(actor)?;
        self.record_audit(AgentAuditRecord {
            id: Uuid::new_v4(),
            session_id: format!("agent-{}", Uuid::new_v4()),
            user_id: request.user_id,
            project_id: request.project_id,
            model: request.model,
            task_kind: request.task_kind,
            prompt_summary: request.prompt_summary,
            response_summary: request.response_summary,
            context_summary: request.context_summary,
            tool_calls: request.tool_calls,
            risk_flags: request.risk_flags,
            risk_level: request.risk_level,
            created_at: crate::time::now_timestamp(),
        })
        .await
    }

    pub async fn get_agent_audit(
        &self,
        actor: &User,
        audit_id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<AgentAuditRecord> {
        let filter = if include_deleted {
            "id = $1"
        } else {
            "id = $1 AND deleted_at IS NULL"
        };
        let row = sqlx::query(&format!(
            "SELECT id, session_id, user_id, project_id, model, task_kind, prompt_summary, response_summary, context_summary, tool_calls, risk_flags, risk_level, {TS_CREATED} FROM agent_audit_records WHERE {filter}"
        ))
        .bind(audit_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| PortalError::missing("agent audit", audit_id))?;
        let audit = audit_from_row(&row)?;
        let project = self
            .project_overview(actor, audit.project_id)
            .await?
            .project;
        Self::require_project_access(actor, &project)?;
        Ok(audit)
    }

    pub async fn update_agent_audit(
        &self,
        actor: &User,
        audit_id: Uuid,
        request: UpdateAgentAuditRequest,
    ) -> PortalResult<AgentAuditRecord> {
        Self::require_staff(actor)?;
        let current = self.get_agent_audit(actor, audit_id, true).await?;
        let row = sqlx::query(&format!(
            r#"
            UPDATE agent_audit_records
            SET review_status = COALESCE($2, review_status),
                visibility_state = COALESCE($3, visibility_state),
                metadata = COALESCE($4, metadata)
            WHERE id = $1
            RETURNING id, session_id, user_id, project_id, model, task_kind, prompt_summary,
                      response_summary, context_summary, tool_calls, risk_flags, risk_level, {TS_CREATED}
            "#
        ))
        .bind(audit_id)
        .bind(request.review_status)
        .bind(request.visibility_state)
        .bind(request.metadata.unwrap_or(json!({"reviewed_audit": current.id})))
        .fetch_one(&self.pool)
        .await?;
        audit_from_row(&row)
    }

    pub async fn delete_agent_audit(
        &self,
        actor: &User,
        audit_id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        Self::require_staff(actor)?;
        self.soft_delete(
            "agent_audit_records",
            audit_id,
            Some("visibility_state = 'hidden'"),
        )
        .await
    }

    async fn soft_delete(
        &self,
        table: &str,
        id: Uuid,
        extra_set: Option<&str>,
    ) -> PortalResult<DeleteResponse> {
        let set_clause = if let Some(extra_set) = extra_set {
            format!("deleted_at = NOW(), {extra_set}")
        } else {
            "deleted_at = NOW()".into()
        };
        let query = format!(
            "UPDATE {table} SET {set_clause} WHERE id = $1 AND deleted_at IS NULL RETURNING id"
        );
        let row = sqlx::query(&query)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| PortalError::missing(table, id))?;
        Ok(DeleteResponse {
            ok: true,
            id: row.try_get("id")?,
            deleted: true,
        })
    }
}

fn deleted_filter(include_deleted: bool) -> &'static str {
    if include_deleted {
        ""
    } else {
        "WHERE deleted_at IS NULL"
    }
}

fn deleted_condition(include_deleted: bool) -> &'static str {
    if include_deleted {
        ""
    } else {
        " AND deleted_at IS NULL"
    }
}
