use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use uuid::Uuid;
use vos_course::{
    AgentAuditRecord, AgentGateway, AgentGatewayRequest, AgentRiskLevel, ChatChoice,
    ChatCompletionRequest, ChatCompletionResponse, ChatMessage, CreateAgentAuditRequest,
    CreateCourseRequest, CreateDesignSubmissionRequest, CreateEvidenceRecordRequest,
    CreateExperimentRequest, CreatePipelineRunRequest, CreateProjectRequest, CreateRubricRequest,
    CreateScoreRequest, CreateStageGateRequest, CreateUserRequest, EvidenceIngestResponse,
    ExperimentAdapter, IncomingEvidenceReport, LoginRequest, LoginResponse, ProjectProjection,
    ReviewDesignRequest, RunPipelineRequest, SubmitDesignRequest,
    TeacherExperimentStudentsResponse, UpdateAgentAuditRequest, UpdateCourseRequest,
    UpdateDesignSubmissionRequest, UpdateEvidenceRecordRequest, UpdateExperimentRequest,
    UpdatePipelineRunRequest, UpdateProjectRequest, UpdateRubricRequest, UpdateScoreRequest,
    UpdateStageGateRequest, UpdateUserRequest, VisibilityScope,
};

use crate::AppState;
use crate::auth::user_from_headers;
use crate::error::{PortalError, PortalResult};
use crate::time::now_timestamp;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/users", get(list_users).post(create_user))
        .route(
            "/api/v1/users/{id}",
            get(get_user).patch(update_user).delete(delete_user),
        )
        .route("/api/v1/courses", get(list_courses).post(create_course))
        .route(
            "/api/v1/courses/{id}",
            get(get_course).patch(update_course).delete(delete_course),
        )
        .route(
            "/api/v1/experiments",
            get(list_experiments).post(create_experiment),
        )
        .route(
            "/api/v1/experiments/{id}",
            get(get_experiment)
                .patch(update_experiment)
                .delete(delete_experiment),
        )
        .route(
            "/api/v1/experiments/{id}/stage-gates",
            get(list_stage_gates).post(create_stage_gate),
        )
        .route(
            "/api/v1/stage-gates/{id}",
            get(get_stage_gate)
                .patch(update_stage_gate)
                .delete(delete_stage_gate),
        )
        .route("/api/v1/projects", get(list_projects).post(create_project))
        .route(
            "/api/v1/projects/{id}",
            get(get_project)
                .patch(update_project)
                .delete(delete_project),
        )
        .route("/api/v1/projects/{id}/progress", get(project_progress))
        .route(
            "/api/v1/projects/{id}/projections/{scope}",
            get(project_projection),
        )
        .route("/api/v1/projects/{id}/submit-design", post(submit_design))
        .route(
            "/api/v1/design-submissions",
            get(list_design_submissions).post(create_design_submission),
        )
        .route(
            "/api/v1/design-submissions/{id}",
            get(get_design_submission)
                .patch(update_design_submission)
                .delete(delete_design_submission),
        )
        .route(
            "/api/v1/design-submissions/{id}/review",
            post(review_design),
        )
        .route("/api/v1/projects/{id}/freeze", post(freeze_project))
        .route(
            "/api/v1/projects/{id}/pipelines",
            get(list_pipelines).post(run_pipeline),
        )
        .route(
            "/api/v1/pipelines",
            get(list_all_pipelines).post(create_pipeline),
        )
        .route(
            "/api/v1/pipelines/{id}",
            get(get_pipeline)
                .patch(update_pipeline)
                .delete(delete_pipeline),
        )
        .route("/api/v1/projects/{id}/evidence", get(list_evidence))
        .route(
            "/api/v1/evidence",
            get(list_all_evidence).post(create_evidence),
        )
        .route(
            "/api/v1/evidence/{id}",
            get(get_evidence)
                .patch(update_evidence)
                .delete(delete_evidence),
        )
        .route("/api/v1/internal/evidence", post(ingest_evidence))
        .route("/api/v1/projects/{id}/scores", get(project_scores))
        .route("/api/v1/rubrics", get(list_rubrics).post(create_rubric))
        .route(
            "/api/v1/rubrics/{id}",
            get(get_rubric).patch(update_rubric).delete(delete_rubric),
        )
        .route("/api/v1/scores", get(list_all_scores).post(create_score))
        .route(
            "/api/v1/scores/{id}",
            get(get_score)
                .patch(update_score_by_id)
                .delete(delete_score),
        )
        .route(
            "/api/v1/teacher/experiments/{id}/students",
            get(teacher_students),
        )
        .route("/api/v1/teacher/projects/{id}/scores", get(project_scores))
        .route("/api/v1/teacher/projects/{id}/grade", post(update_score))
        .route("/api/v1/projects/{id}/agent-audit", get(agent_audit))
        .route(
            "/api/v1/agent-audits",
            get(list_agent_audits).post(create_agent_audit),
        )
        .route(
            "/api/v1/agent-audits/{id}",
            get(get_agent_audit)
                .patch(update_agent_audit)
                .delete(delete_agent_audit),
        )
        .route("/v1/models", get(openai_models))
        .route("/v1/chat/completions", post(chat_completions))
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "service": "vos-portal",
        "demo_mode": state.config.demo_mode,
        "database": state.database_enabled(),
    }))
}

async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> PortalResult<Json<LoginResponse>> {
    let (token, user) = state
        .authenticate(&request.username, &request.password)
        .await?;
    Ok(Json(LoginResponse { token, user }))
}

async fn logout() -> Json<serde_json::Value> {
    Json(json!({"ok": true}))
}

async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> PortalResult<Json<vos_course::User>> {
    Ok(Json(user_from_headers(&state, &headers).await?))
}

async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<IncludeDeletedQuery>,
) -> PortalResult<Json<Vec<vos_course::User>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state.list_users(&user, query.include_deleted()).await?,
    ))
}

async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateUserRequest>,
) -> PortalResult<Json<vos_course::User>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.create_user(&user, request).await?))
}

async fn get_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
    Query(query): Query<IncludeDeletedQuery>,
) -> PortalResult<Json<vos_course::User>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .get_user(&user, user_id, query.include_deleted())
            .await?,
    ))
}

async fn update_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
    Json(request): Json<UpdateUserRequest>,
) -> PortalResult<Json<vos_course::User>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.update_user(&user, user_id, request).await?))
}

async fn delete_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.delete_user(&user, user_id).await?))
}

async fn list_courses(
    State(state): State<AppState>,
) -> PortalResult<Json<Vec<vos_course::Course>>> {
    Ok(Json(state.list_courses().await?))
}

async fn create_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateCourseRequest>,
) -> PortalResult<Json<vos_course::Course>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.create_course(&user, request).await?))
}

async fn get_course(
    State(state): State<AppState>,
    Path(course_id): Path<Uuid>,
    Query(query): Query<IncludeDeletedQuery>,
) -> PortalResult<Json<vos_course::Course>> {
    Ok(Json(
        state.get_course(course_id, query.include_deleted()).await?,
    ))
}

async fn update_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(course_id): Path<Uuid>,
    Json(request): Json<UpdateCourseRequest>,
) -> PortalResult<Json<vos_course::Course>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.update_course(&user, course_id, request).await?))
}

async fn delete_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(course_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.delete_course(&user, course_id).await?))
}

#[derive(Debug, Deserialize)]
struct IncludeDeletedQuery {
    include_deleted: Option<bool>,
}

impl IncludeDeletedQuery {
    fn include_deleted(&self) -> bool {
        self.include_deleted.unwrap_or(false)
    }
}

#[derive(Debug, Deserialize)]
struct ResourceQuery {
    include_deleted: Option<bool>,
    project_id: Option<Uuid>,
    experiment_id: Option<Uuid>,
}

impl ResourceQuery {
    fn include_deleted(&self) -> bool {
        self.include_deleted.unwrap_or(false)
    }
}

#[derive(Debug, Deserialize)]
struct ExperimentQuery {
    course_id: Option<Uuid>,
    include_deleted: Option<bool>,
}

async fn list_experiments(
    State(state): State<AppState>,
    Query(query): Query<ExperimentQuery>,
) -> PortalResult<Json<Vec<vos_course::Experiment>>> {
    Ok(Json(
        state
            .list_experiments(query.course_id, query.include_deleted.unwrap_or(false))
            .await?,
    ))
}

async fn create_experiment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateExperimentRequest>,
) -> PortalResult<Json<vos_course::Experiment>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.create_experiment(&user, request).await?))
}

async fn get_experiment(
    State(state): State<AppState>,
    Path(experiment_id): Path<Uuid>,
    Query(query): Query<IncludeDeletedQuery>,
) -> PortalResult<Json<vos_course::Experiment>> {
    Ok(Json(
        state
            .get_experiment(experiment_id, query.include_deleted())
            .await?,
    ))
}

async fn update_experiment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(experiment_id): Path<Uuid>,
    Json(request): Json<UpdateExperimentRequest>,
) -> PortalResult<Json<vos_course::Experiment>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .update_experiment(&user, experiment_id, request)
            .await?,
    ))
}

async fn delete_experiment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(experiment_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.delete_experiment(&user, experiment_id).await?))
}

async fn list_stage_gates(
    State(state): State<AppState>,
    Path(experiment_id): Path<Uuid>,
) -> PortalResult<Json<Vec<vos_course::StageGate>>> {
    Ok(Json(state.list_stage_gates(experiment_id).await?))
}

async fn create_stage_gate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(experiment_id): Path<Uuid>,
    Json(mut request): Json<CreateStageGateRequest>,
) -> PortalResult<Json<vos_course::StageGate>> {
    let user = user_from_headers(&state, &headers).await?;
    request.experiment_id = experiment_id;
    Ok(Json(state.create_stage_gate(&user, request).await?))
}

async fn get_stage_gate(
    State(state): State<AppState>,
    Path(stage_id): Path<Uuid>,
    Query(query): Query<IncludeDeletedQuery>,
) -> PortalResult<Json<vos_course::StageGate>> {
    Ok(Json(
        state
            .get_stage_gate(stage_id, query.include_deleted())
            .await?,
    ))
}

async fn update_stage_gate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(stage_id): Path<Uuid>,
    Json(request): Json<UpdateStageGateRequest>,
) -> PortalResult<Json<vos_course::StageGate>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state.update_stage_gate(&user, stage_id, request).await?,
    ))
}

async fn delete_stage_gate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(stage_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.delete_stage_gate(&user, stage_id).await?))
}

async fn list_projects(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> PortalResult<Json<Vec<vos_course::ProjectOverview>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.list_project_overviews(&user).await?))
}

async fn create_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateProjectRequest>,
) -> PortalResult<Json<vos_course::Project>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.create_project(&user, request).await?))
}

async fn get_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::ProjectOverview>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.project_overview(&user, project_id).await?))
}

async fn update_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(request): Json<UpdateProjectRequest>,
) -> PortalResult<Json<vos_course::Project>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state.update_project(&user, project_id, request).await?,
    ))
}

async fn delete_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.delete_project(&user, project_id).await?))
}

async fn project_progress(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::StageProgress>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.stage_progress(&user, project_id).await?))
}

async fn project_projection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((project_id, scope)): Path<(Uuid, String)>,
) -> PortalResult<Json<ProjectProjection>> {
    let user = user_from_headers(&state, &headers).await?;
    let scope = parse_scope(&scope)?;
    let overview = state.project_overview(&user, project_id).await?;
    let visible_spec_summary = state
        .experiment_adapter
        .visible_spec_summary(&overview.project)
        .await?;
    let projection = ProjectProjection {
        project: overview.clone(),
        scope,
        stage_rules: serde_json::to_value(&overview.current_stage.config)
            .map_err(|error| PortalError::Internal(error.to_string()))?,
        visible_spec_summary,
        policy_summary: json!({
            "agent_tools": ["context_projection.read", "vos.verify.public"],
            "hidden_rules_visible": matches!(scope, VisibilityScope::StaffFull),
            "adapter": "local-vos-os"
        }),
    };
    Ok(Json(projection))
}

async fn submit_design(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(request): Json<SubmitDesignRequest>,
) -> PortalResult<Json<vos_course::DesignSubmission>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .submit_design(
                &user,
                project_id,
                request.stage_gate_id,
                request.commit_sha,
                request.artifact_ref,
            )
            .await?,
    ))
}

async fn list_design_submissions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ResourceQuery>,
) -> PortalResult<Json<Vec<vos_course::DesignSubmission>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .list_design_submissions(&user, query.project_id, query.include_deleted())
            .await?,
    ))
}

async fn create_design_submission(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateDesignSubmissionRequest>,
) -> PortalResult<Json<vos_course::DesignSubmission>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.create_design_submission(&user, request).await?))
}

async fn get_design_submission(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(submission_id): Path<Uuid>,
    Query(query): Query<IncludeDeletedQuery>,
) -> PortalResult<Json<vos_course::DesignSubmission>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .get_design_submission(&user, submission_id, query.include_deleted())
            .await?,
    ))
}

async fn update_design_submission(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(submission_id): Path<Uuid>,
    Json(request): Json<UpdateDesignSubmissionRequest>,
) -> PortalResult<Json<vos_course::DesignSubmission>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .update_design_submission(&user, submission_id, request)
            .await?,
    ))
}

async fn delete_design_submission(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(submission_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state.delete_design_submission(&user, submission_id).await?,
    ))
}

async fn review_design(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(submission_id): Path<Uuid>,
    Json(request): Json<ReviewDesignRequest>,
) -> PortalResult<Json<vos_course::DesignSubmission>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .review_design(&user, submission_id, request.status, request.feedback)
            .await?,
    ))
}

async fn freeze_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::Project>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.freeze_project(&user, project_id).await?))
}

async fn run_pipeline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(request): Json<RunPipelineRequest>,
) -> PortalResult<Json<vos_course::PipelineRun>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .run_pipeline(
                &user,
                project_id,
                request.commit_sha,
                request.trigger_type,
                request.stage_scope,
            )
            .await?,
    ))
}

async fn list_pipelines(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> PortalResult<Json<Vec<vos_course::PipelineRun>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.list_pipelines(&user, project_id).await?))
}

async fn list_all_pipelines(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ResourceQuery>,
) -> PortalResult<Json<Vec<vos_course::PipelineRun>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .list_all_pipelines(&user, query.project_id, query.include_deleted())
            .await?,
    ))
}

async fn create_pipeline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreatePipelineRunRequest>,
) -> PortalResult<Json<vos_course::PipelineRun>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.create_pipeline_run(&user, request).await?))
}

async fn get_pipeline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(pipeline_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::PipelineRun>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.pipeline(&user, pipeline_id).await?))
}

async fn update_pipeline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(pipeline_id): Path<Uuid>,
    Json(request): Json<UpdatePipelineRunRequest>,
) -> PortalResult<Json<vos_course::PipelineRun>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .update_pipeline_run(&user, pipeline_id, request)
            .await?,
    ))
}

async fn delete_pipeline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(pipeline_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.delete_pipeline_run(&user, pipeline_id).await?))
}

async fn ingest_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(report): Json<IncomingEvidenceReport>,
) -> PortalResult<Json<EvidenceIngestResponse>> {
    require_internal_evidence_token(&state, &headers)?;
    Ok(Json(state.ingest_evidence(report).await?))
}

async fn list_all_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ResourceQuery>,
) -> PortalResult<Json<Vec<vos_course::EvidenceRecord>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .list_all_evidence(&user, query.project_id, query.include_deleted())
            .await?,
    ))
}

async fn create_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateEvidenceRecordRequest>,
) -> PortalResult<Json<vos_course::EvidenceRecord>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.create_evidence_record(&user, request).await?))
}

async fn get_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(evidence_id): Path<Uuid>,
    Query(query): Query<IncludeDeletedQuery>,
) -> PortalResult<Json<vos_course::EvidenceRecord>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .get_evidence_record(&user, evidence_id, query.include_deleted())
            .await?,
    ))
}

async fn update_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(evidence_id): Path<Uuid>,
    Json(request): Json<UpdateEvidenceRecordRequest>,
) -> PortalResult<Json<vos_course::EvidenceRecord>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .update_evidence_record(&user, evidence_id, request)
            .await?,
    ))
}

async fn delete_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(evidence_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state.delete_evidence_record(&user, evidence_id).await?,
    ))
}

async fn list_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> PortalResult<Json<Vec<vos_course::EvidenceRecord>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.list_evidence(&user, project_id).await?))
}

async fn project_scores(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> PortalResult<Json<Vec<vos_course::ScoreItem>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.list_scores(&user, project_id).await?))
}

async fn list_rubrics(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ResourceQuery>,
) -> PortalResult<Json<Vec<vos_course::EvaluationRubric>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .list_rubrics(&user, query.experiment_id, query.include_deleted())
            .await?,
    ))
}

async fn create_rubric(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateRubricRequest>,
) -> PortalResult<Json<vos_course::EvaluationRubric>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.create_rubric(&user, request).await?))
}

async fn get_rubric(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(rubric_id): Path<Uuid>,
    Query(query): Query<IncludeDeletedQuery>,
) -> PortalResult<Json<vos_course::EvaluationRubric>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .get_rubric(&user, rubric_id, query.include_deleted())
            .await?,
    ))
}

async fn update_rubric(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(rubric_id): Path<Uuid>,
    Json(request): Json<UpdateRubricRequest>,
) -> PortalResult<Json<vos_course::EvaluationRubric>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.update_rubric(&user, rubric_id, request).await?))
}

async fn delete_rubric(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(rubric_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.delete_rubric(&user, rubric_id).await?))
}

async fn list_all_scores(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ResourceQuery>,
) -> PortalResult<Json<Vec<vos_course::ScoreItem>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .list_all_scores(&user, query.project_id, query.include_deleted())
            .await?,
    ))
}

async fn create_score(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateScoreRequest>,
) -> PortalResult<Json<vos_course::ScoreItem>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.create_score(&user, request).await?))
}

async fn get_score(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(score_id): Path<Uuid>,
    Query(query): Query<IncludeDeletedQuery>,
) -> PortalResult<Json<vos_course::ScoreItem>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .get_score(&user, score_id, query.include_deleted())
            .await?,
    ))
}

async fn update_score_by_id(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(score_id): Path<Uuid>,
    Json(request): Json<UpdateScoreRequest>,
) -> PortalResult<Json<vos_course::ScoreItem>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state.update_score_by_id(&user, score_id, request).await?,
    ))
}

async fn delete_score(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(score_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.delete_score(&user, score_id).await?))
}

async fn teacher_students(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(experiment_id): Path<Uuid>,
) -> PortalResult<Json<TeacherExperimentStudentsResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(TeacherExperimentStudentsResponse {
        rows: state.teacher_rows(&user, experiment_id).await?,
    }))
}

async fn update_score(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(request): Json<UpdateScoreRequest>,
) -> PortalResult<Json<vos_course::ScoreItem>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .update_score(
                &user,
                project_id,
                request.rubric_id,
                request.manual_score,
                request.feedback,
                request.is_final,
            )
            .await?,
    ))
}

async fn agent_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> PortalResult<Json<Vec<AgentAuditRecord>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.list_audits(&user, project_id).await?))
}

async fn list_agent_audits(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ResourceQuery>,
) -> PortalResult<Json<Vec<AgentAuditRecord>>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .list_agent_audits(&user, query.project_id, query.include_deleted())
            .await?,
    ))
}

async fn create_agent_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateAgentAuditRequest>,
) -> PortalResult<Json<AgentAuditRecord>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.create_agent_audit(&user, request).await?))
}

async fn get_agent_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(audit_id): Path<Uuid>,
    Query(query): Query<IncludeDeletedQuery>,
) -> PortalResult<Json<AgentAuditRecord>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state
            .get_agent_audit(&user, audit_id, query.include_deleted())
            .await?,
    ))
}

async fn update_agent_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(audit_id): Path<Uuid>,
    Json(request): Json<UpdateAgentAuditRequest>,
) -> PortalResult<Json<AgentAuditRecord>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(
        state.update_agent_audit(&user, audit_id, request).await?,
    ))
}

async fn delete_agent_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(audit_id): Path<Uuid>,
) -> PortalResult<Json<vos_course::DeleteResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    Ok(Json(state.delete_agent_audit(&user, audit_id).await?))
}

async fn openai_models() -> Json<serde_json::Value> {
    Json(json!({
        "object": "list",
        "data": [
            {
                "id": "vos-local-agent",
                "object": "model",
                "owned_by": "vos-portal"
            }
        ]
    }))
}

async fn chat_completions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ChatCompletionRequest>,
) -> PortalResult<Json<ChatCompletionResponse>> {
    let user = user_from_headers(&state, &headers).await?;
    let project_id = if let Some(project_id) = request.project_id {
        project_id
    } else {
        state
            .list_project_overviews(&user)
            .await?
            .first()
            .map(|overview| overview.project.id)
            .ok_or_else(|| {
                PortalError::BadRequest("no project available for agent request".into())
            })?
    };
    let overview = state.project_overview(&user, project_id).await?;
    let spec_summary = state
        .experiment_adapter
        .visible_spec_summary(&overview.project)
        .await?;
    let projection = ProjectProjection {
        project: overview.clone(),
        scope: VisibilityScope::AgentPublic,
        stage_rules: serde_json::to_value(&overview.current_stage.config)
            .map_err(|error| PortalError::Internal(error.to_string()))?,
        visible_spec_summary: spec_summary,
        policy_summary: json!({
            "agent_tools": ["context_projection.read"],
            "hidden_rules_visible": false,
            "adapter": "local-vos-os"
        }),
    };
    let prompt_summary = request
        .messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.content.clone())
        .unwrap_or_else(|| "empty prompt".into());
    let adapter_response = state
        .agent_gateway
        .complete(AgentGatewayRequest {
            user_id: user.id,
            project_id,
            model: request.model.clone(),
            prompt_summary: prompt_summary.clone(),
            projection,
        })
        .await?;
    let risk_level = if adapter_response.risk_flags.is_empty() {
        AgentRiskLevel::Low
    } else {
        AgentRiskLevel::Medium
    };
    state
        .record_audit(AgentAuditRecord {
            id: Uuid::new_v4(),
            session_id: format!("agent-{}", Uuid::new_v4()),
            user_id: user.id,
            project_id,
            model: request.model.clone(),
            task_kind: "chat_completion".into(),
            prompt_summary,
            response_summary: Some(adapter_response.response_summary.clone()),
            context_summary: json!({
                "scope": "agent_public",
                "current_stage": overview.current_stage.key,
            }),
            tool_calls: adapter_response.tool_calls,
            risk_flags: adapter_response.risk_flags,
            risk_level,
            created_at: now_timestamp(),
        })
        .await?;

    Ok(Json(ChatCompletionResponse {
        id: format!("chatcmpl-{}", Uuid::new_v4()),
        object: "chat.completion".into(),
        model: request.model,
        choices: vec![ChatChoice {
            index: 0,
            message: ChatMessage {
                role: "assistant".into(),
                content: adapter_response.response_summary,
            },
            finish_reason: "stop".into(),
        }],
    }))
}

fn parse_scope(value: &str) -> PortalResult<VisibilityScope> {
    match value {
        "student" | "student-public" => Ok(VisibilityScope::StudentPublic),
        "agent" | "agent-public" => Ok(VisibilityScope::AgentPublic),
        "staff" | "staff-full" => Ok(VisibilityScope::StaffFull),
        _ => Err(PortalError::BadRequest(format!(
            "unknown projection scope {value}"
        ))),
    }
}

fn require_internal_evidence_token(state: &AppState, headers: &HeaderMap) -> PortalResult<()> {
    if state.config.demo_mode && state.config.internal_token.is_none() {
        return Ok(());
    }
    let Some(expected) = state.config.internal_token.as_deref() else {
        return Err(PortalError::Unauthorized);
    };
    let provided = headers
        .get("x-vos-internal-token")
        .and_then(|value| value.to_str().ok())
        .or_else(|| {
            headers
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
        });
    if provided == Some(expected) {
        Ok(())
    } else {
        Err(PortalError::Unauthorized)
    }
}
