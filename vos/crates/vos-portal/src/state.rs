use std::sync::Arc;

#[cfg(feature = "postgres")]
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;
use vos_course::{
    AgentAuditRecord, Course, CreateAgentAuditRequest, CreateCourseRequest,
    CreateDesignSubmissionRequest, CreateEvidenceRecordRequest, CreateExperimentRequest,
    CreatePipelineRunRequest, CreateProjectRequest, CreateRubricRequest, CreateScoreRequest,
    CreateStageGateRequest, CreateUserRequest, DeleteResponse, DesignReviewStatus,
    DesignSubmission, EvaluationRubric, EvidenceIngestResponse, EvidenceRecord, Experiment,
    IncomingEvidenceReport, PipelineRun, Project, ProjectOverview, ScoreItem, StageGate,
    StageProgress, TeacherProjectRow, TriggerType, UpdateAgentAuditRequest, UpdateCourseRequest,
    UpdateDesignSubmissionRequest, UpdateEvidenceRecordRequest, UpdateExperimentRequest,
    UpdatePipelineRunRequest, UpdateProjectRequest, UpdateRubricRequest, UpdateScoreRequest,
    UpdateStageGateRequest, UpdateUserRequest, User,
};

#[cfg(feature = "postgres")]
use crate::PostgresStore;
use crate::adapters::{LocalAgentGateway, LocalExperimentAdapter, LocalPipelineOrchestrator};
use crate::{InMemoryStore, PortalConfig, PortalError, PortalResult};

#[derive(Clone)]
pub struct AppState {
    pub config: PortalConfig,
    #[cfg(feature = "postgres")]
    pub pg_store: Option<Arc<PostgresStore>>,
    pub store: Arc<InMemoryStore>,
    pub experiment_adapter: Arc<LocalExperimentAdapter>,
    pub pipeline_orchestrator: Arc<LocalPipelineOrchestrator>,
    pub agent_gateway: Arc<LocalAgentGateway>,
}

#[cfg_attr(not(feature = "postgres"), allow(unused_variables))]
impl AppState {
    pub async fn demo(config: PortalConfig) -> anyhow::Result<Self> {
        #[cfg(feature = "postgres")]
        let pg_store = if let Some(database_url) = config.database_url.as_ref() {
            let pool = PgPoolOptions::new()
                .max_connections(8)
                .connect(database_url)
                .await?;
            sqlx::migrate!("./migrations").run(&pool).await?;
            let pg_store = Arc::new(PostgresStore::new(pool));
            if config.demo_mode {
                pg_store.ensure_demo_seed().await?;
            }
            Some(pg_store)
        } else {
            None
        };
        let store = Arc::new(InMemoryStore::seeded_demo());
        let experiment_adapter = Arc::new(LocalExperimentAdapter::new(config.spec_root.clone()));
        let pipeline_orchestrator = Arc::new(LocalPipelineOrchestrator::new(store.clone()));
        let agent_gateway = Arc::new(LocalAgentGateway::default());

        Ok(Self {
            config,
            #[cfg(feature = "postgres")]
            pg_store,
            store,
            experiment_adapter,
            pipeline_orchestrator,
            agent_gateway,
        })
    }

    pub fn database_enabled(&self) -> bool {
        #[cfg(feature = "postgres")]
        {
            self.pg_store.is_some()
        }
        #[cfg(not(feature = "postgres"))]
        {
            false
        }
    }

    pub async fn authenticate(
        &self,
        username: &str,
        password: &str,
    ) -> PortalResult<(String, User)> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.authenticate(username, password).await;
        }
        self.store.authenticate(username, password)
    }

    pub async fn user_for_token(&self, token: &str) -> PortalResult<User> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.user_for_token(token).await;
        }
        self.store.user_for_token(token)
    }

    pub async fn list_courses(&self) -> PortalResult<Vec<Course>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.list_courses().await;
        }
        self.store.list_courses()
    }

    pub async fn create_course(
        &self,
        owner: &User,
        request: CreateCourseRequest,
    ) -> PortalResult<Course> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_course(owner, request).await;
        }
        self.store.create_course(owner, request)
    }

    pub async fn list_experiments(
        &self,
        course_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<Experiment>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.list_experiments(course_id, include_deleted).await;
        }
        self.store.list_experiments(course_id)
    }

    pub async fn create_experiment(
        &self,
        actor: &User,
        request: CreateExperimentRequest,
    ) -> PortalResult<Experiment> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_experiment(actor, request).await;
        }
        self.store.create_experiment(actor, request)
    }

    pub async fn list_stage_gates(&self, experiment_id: Uuid) -> PortalResult<Vec<StageGate>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.list_stage_gates(experiment_id).await;
        }
        self.store.list_stage_gates(experiment_id)
    }

    pub async fn create_stage_gate(
        &self,
        actor: &User,
        request: CreateStageGateRequest,
    ) -> PortalResult<StageGate> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_stage_gate(actor, request).await;
        }
        self.store.create_stage_gate(actor, request)
    }

    pub async fn create_project(
        &self,
        actor: &User,
        request: CreateProjectRequest,
    ) -> PortalResult<Project> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_project(actor, request).await;
        }
        self.store.create_project(actor, request)
    }

    pub async fn list_project_overviews(&self, actor: &User) -> PortalResult<Vec<ProjectOverview>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.list_project_overviews(actor).await;
        }
        self.store.list_project_overviews(actor)
    }

    pub async fn project_overview(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<ProjectOverview> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.project_overview(actor, project_id).await;
        }
        self.store.project_overview(actor, project_id)
    }

    pub async fn stage_progress(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<StageProgress> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.stage_progress(actor, project_id).await;
        }
        self.store.stage_progress(actor, project_id)
    }

    pub async fn run_pipeline(
        &self,
        actor: &User,
        project_id: Uuid,
        commit_sha: String,
        trigger_type: TriggerType,
        stage_scope: Option<String>,
    ) -> PortalResult<PipelineRun> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .run_pipeline(actor, project_id, commit_sha, trigger_type, stage_scope)
                .await;
        }
        self.store
            .run_pipeline(actor, project_id, commit_sha, trigger_type, stage_scope)
    }

    pub async fn list_pipelines(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<Vec<PipelineRun>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.list_pipelines(actor, project_id).await;
        }
        self.store.list_pipelines(actor, project_id)
    }

    pub async fn pipeline(&self, actor: &User, pipeline_id: Uuid) -> PortalResult<PipelineRun> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.pipeline(actor, pipeline_id).await;
        }
        self.store.pipeline(actor, pipeline_id)
    }

    pub async fn ingest_evidence(
        &self,
        report: IncomingEvidenceReport,
    ) -> PortalResult<EvidenceIngestResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.ingest_evidence(report).await;
        }
        self.store.ingest_evidence(report)
    }

    pub async fn list_evidence(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<Vec<EvidenceRecord>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.list_evidence(actor, project_id).await;
        }
        self.store.list_evidence(actor, project_id)
    }

    pub async fn list_scores(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<Vec<ScoreItem>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.list_scores(actor, project_id).await;
        }
        self.store.list_scores(actor, project_id)
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
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .update_score(
                    actor,
                    project_id,
                    rubric_id,
                    manual_score,
                    feedback,
                    is_final,
                )
                .await;
        }
        self.store.update_score(
            actor,
            project_id,
            rubric_id,
            manual_score,
            feedback,
            is_final,
        )
    }

    pub async fn submit_design(
        &self,
        actor: &User,
        project_id: Uuid,
        stage_gate_id: Uuid,
        commit_sha: String,
        artifact_ref: Option<String>,
    ) -> PortalResult<DesignSubmission> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .submit_design(actor, project_id, stage_gate_id, commit_sha, artifact_ref)
                .await;
        }
        self.store
            .submit_design(actor, project_id, stage_gate_id, commit_sha, artifact_ref)
    }

    pub async fn review_design(
        &self,
        actor: &User,
        submission_id: Uuid,
        status: DesignReviewStatus,
        feedback: Option<String>,
    ) -> PortalResult<DesignSubmission> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .review_design(actor, submission_id, status, feedback)
                .await;
        }
        self.store
            .review_design(actor, submission_id, status, feedback)
    }

    pub async fn freeze_project(&self, actor: &User, project_id: Uuid) -> PortalResult<Project> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.freeze_project(actor, project_id).await;
        }
        self.store.freeze_project(actor, project_id)
    }

    pub async fn teacher_rows(
        &self,
        actor: &User,
        experiment_id: Uuid,
    ) -> PortalResult<Vec<TeacherProjectRow>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.teacher_rows(actor, experiment_id).await;
        }
        self.store.teacher_rows(actor, experiment_id)
    }

    pub async fn record_audit(&self, audit: AgentAuditRecord) -> PortalResult<AgentAuditRecord> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.record_audit(audit).await;
        }
        self.store.record_audit(audit)
    }

    pub async fn list_audits(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<Vec<AgentAuditRecord>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.list_audits(actor, project_id).await;
        }
        self.store.list_audits(actor, project_id)
    }

    pub async fn list_users(&self, actor: &User, include_deleted: bool) -> PortalResult<Vec<User>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.list_users(actor, include_deleted).await;
        }
        Self::postgres_required()
    }

    pub async fn create_user(
        &self,
        actor: &User,
        request: CreateUserRequest,
    ) -> PortalResult<User> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_user(actor, request).await;
        }
        Self::postgres_required()
    }

    pub async fn get_user(
        &self,
        actor: &User,
        user_id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<User> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.get_user(actor, user_id, include_deleted).await;
        }
        Self::postgres_required()
    }

    pub async fn update_user(
        &self,
        actor: &User,
        user_id: Uuid,
        request: UpdateUserRequest,
    ) -> PortalResult<User> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_user(actor, user_id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_user(&self, actor: &User, user_id: Uuid) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_user(actor, user_id).await;
        }
        Self::postgres_required()
    }

    pub async fn get_course(&self, course_id: Uuid, include_deleted: bool) -> PortalResult<Course> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.get_course(course_id, include_deleted).await;
        }
        Self::postgres_required()
    }

    pub async fn update_course(
        &self,
        actor: &User,
        course_id: Uuid,
        request: UpdateCourseRequest,
    ) -> PortalResult<Course> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_course(actor, course_id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_course(
        &self,
        actor: &User,
        course_id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_course(actor, course_id).await;
        }
        Self::postgres_required()
    }

    pub async fn get_experiment(
        &self,
        id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<Experiment> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.get_experiment(id, include_deleted).await;
        }
        Self::postgres_required()
    }

    pub async fn update_experiment(
        &self,
        actor: &User,
        id: Uuid,
        request: UpdateExperimentRequest,
    ) -> PortalResult<Experiment> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_experiment(actor, id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_experiment(&self, actor: &User, id: Uuid) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_experiment(actor, id).await;
        }
        Self::postgres_required()
    }

    pub async fn get_stage_gate(&self, id: Uuid, include_deleted: bool) -> PortalResult<StageGate> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.get_stage_gate(id, include_deleted).await;
        }
        Self::postgres_required()
    }

    pub async fn update_stage_gate(
        &self,
        actor: &User,
        id: Uuid,
        request: UpdateStageGateRequest,
    ) -> PortalResult<StageGate> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_stage_gate(actor, id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_stage_gate(&self, actor: &User, id: Uuid) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_stage_gate(actor, id).await;
        }
        Self::postgres_required()
    }

    pub async fn update_project(
        &self,
        actor: &User,
        id: Uuid,
        request: UpdateProjectRequest,
    ) -> PortalResult<Project> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_project(actor, id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_project(&self, actor: &User, id: Uuid) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_project(actor, id).await;
        }
        Self::postgres_required()
    }

    pub async fn list_design_submissions(
        &self,
        actor: &User,
        project_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<DesignSubmission>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .list_design_submissions(actor, project_id, include_deleted)
                .await;
        }
        Self::postgres_required()
    }

    pub async fn create_design_submission(
        &self,
        actor: &User,
        request: CreateDesignSubmissionRequest,
    ) -> PortalResult<DesignSubmission> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_design_submission(actor, request).await;
        }
        Self::postgres_required()
    }

    pub async fn get_design_submission(
        &self,
        actor: &User,
        id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<DesignSubmission> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .get_design_submission(actor, id, include_deleted)
                .await;
        }
        Self::postgres_required()
    }

    pub async fn update_design_submission(
        &self,
        actor: &User,
        id: Uuid,
        request: UpdateDesignSubmissionRequest,
    ) -> PortalResult<DesignSubmission> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_design_submission(actor, id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_design_submission(
        &self,
        actor: &User,
        id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_design_submission(actor, id).await;
        }
        Self::postgres_required()
    }

    pub async fn list_all_pipelines(
        &self,
        actor: &User,
        project_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<PipelineRun>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .list_all_pipelines(actor, project_id, include_deleted)
                .await;
        }
        Self::postgres_required()
    }

    pub async fn create_pipeline_run(
        &self,
        actor: &User,
        request: CreatePipelineRunRequest,
    ) -> PortalResult<PipelineRun> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_pipeline_run(actor, request).await;
        }
        Self::postgres_required()
    }

    pub async fn update_pipeline_run(
        &self,
        actor: &User,
        id: Uuid,
        request: UpdatePipelineRunRequest,
    ) -> PortalResult<PipelineRun> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_pipeline_run(actor, id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_pipeline_run(
        &self,
        actor: &User,
        id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_pipeline_run(actor, id).await;
        }
        Self::postgres_required()
    }

    pub async fn list_all_evidence(
        &self,
        actor: &User,
        project_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<EvidenceRecord>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .list_all_evidence(actor, project_id, include_deleted)
                .await;
        }
        Self::postgres_required()
    }

    pub async fn create_evidence_record(
        &self,
        actor: &User,
        request: CreateEvidenceRecordRequest,
    ) -> PortalResult<EvidenceRecord> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_evidence_record(actor, request).await;
        }
        Self::postgres_required()
    }

    pub async fn get_evidence_record(
        &self,
        actor: &User,
        id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<EvidenceRecord> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.get_evidence_record(actor, id, include_deleted).await;
        }
        Self::postgres_required()
    }

    pub async fn update_evidence_record(
        &self,
        actor: &User,
        id: Uuid,
        request: UpdateEvidenceRecordRequest,
    ) -> PortalResult<EvidenceRecord> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_evidence_record(actor, id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_evidence_record(
        &self,
        actor: &User,
        id: Uuid,
    ) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_evidence_record(actor, id).await;
        }
        Self::postgres_required()
    }

    pub async fn list_rubrics(
        &self,
        actor: &User,
        experiment_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<EvaluationRubric>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .list_rubrics(actor, experiment_id, include_deleted)
                .await;
        }
        Self::postgres_required()
    }

    pub async fn create_rubric(
        &self,
        actor: &User,
        request: CreateRubricRequest,
    ) -> PortalResult<EvaluationRubric> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_rubric(actor, request).await;
        }
        Self::postgres_required()
    }

    pub async fn get_rubric(
        &self,
        actor: &User,
        id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<EvaluationRubric> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.get_rubric(actor, id, include_deleted).await;
        }
        Self::postgres_required()
    }

    pub async fn update_rubric(
        &self,
        actor: &User,
        id: Uuid,
        request: UpdateRubricRequest,
    ) -> PortalResult<EvaluationRubric> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_rubric(actor, id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_rubric(&self, actor: &User, id: Uuid) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_rubric(actor, id).await;
        }
        Self::postgres_required()
    }

    pub async fn list_all_scores(
        &self,
        actor: &User,
        project_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<ScoreItem>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .list_all_scores(actor, project_id, include_deleted)
                .await;
        }
        Self::postgres_required()
    }

    pub async fn create_score(
        &self,
        actor: &User,
        request: CreateScoreRequest,
    ) -> PortalResult<ScoreItem> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_score(actor, request).await;
        }
        Self::postgres_required()
    }

    pub async fn get_score(
        &self,
        actor: &User,
        id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<ScoreItem> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.get_score(actor, id, include_deleted).await;
        }
        Self::postgres_required()
    }

    pub async fn update_score_by_id(
        &self,
        actor: &User,
        id: Uuid,
        request: UpdateScoreRequest,
    ) -> PortalResult<ScoreItem> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_score_by_id(actor, id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_score(&self, actor: &User, id: Uuid) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_score(actor, id).await;
        }
        Self::postgres_required()
    }

    pub async fn list_agent_audits(
        &self,
        actor: &User,
        project_id: Option<Uuid>,
        include_deleted: bool,
    ) -> PortalResult<Vec<AgentAuditRecord>> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store
                .list_agent_audits(actor, project_id, include_deleted)
                .await;
        }
        Self::postgres_required()
    }

    pub async fn create_agent_audit(
        &self,
        actor: &User,
        request: CreateAgentAuditRequest,
    ) -> PortalResult<AgentAuditRecord> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.create_agent_audit(actor, request).await;
        }
        Self::postgres_required()
    }

    pub async fn get_agent_audit(
        &self,
        actor: &User,
        id: Uuid,
        include_deleted: bool,
    ) -> PortalResult<AgentAuditRecord> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.get_agent_audit(actor, id, include_deleted).await;
        }
        Self::postgres_required()
    }

    pub async fn update_agent_audit(
        &self,
        actor: &User,
        id: Uuid,
        request: UpdateAgentAuditRequest,
    ) -> PortalResult<AgentAuditRecord> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.update_agent_audit(actor, id, request).await;
        }
        Self::postgres_required()
    }

    pub async fn delete_agent_audit(&self, actor: &User, id: Uuid) -> PortalResult<DeleteResponse> {
        #[cfg(feature = "postgres")]
        if let Some(store) = self.pg_store.as_ref() {
            return store.delete_agent_audit(actor, id).await;
        }
        Self::postgres_required()
    }

    fn postgres_required<T>() -> PortalResult<T> {
        Err(PortalError::BadRequest(
            "postgres feature and DATABASE_URL are required for this CRUD endpoint".into(),
        ))
    }
}
