use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use crate::{PipelineRun, Project, ProjectProjection};

#[derive(Debug, Error)]
pub enum CourseAdapterError {
    #[error("adapter is not configured: {0}")]
    NotConfigured(String),
    #[error("adapter rejected request: {0}")]
    Rejected(String),
    #[error("adapter failed: {0}")]
    Failed(String),
}

pub type AdapterResult<T> = Result<T, CourseAdapterError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoProvisionRequest {
    pub project_id: Uuid,
    pub experiment_id: Uuid,
    pub student_login: String,
    pub template_repo: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoProvisionResult {
    pub repo_url: String,
    pub workspace_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PipelinePlanRequest {
    pub project: Project,
    pub commit_sha: String,
    pub projection: ProjectProjection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PipelinePlan {
    pub command: String,
    #[serde(default)]
    pub steps: Vec<String>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentGatewayRequest {
    pub user_id: Uuid,
    pub project_id: Uuid,
    pub model: String,
    pub prompt_summary: String,
    pub projection: ProjectProjection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentGatewayResponse {
    pub response_summary: String,
    #[serde(default)]
    pub tool_calls: Vec<String>,
    #[serde(default)]
    pub risk_flags: Vec<String>,
}

#[async_trait]
pub trait RepoProvisioner: Send + Sync {
    async fn provision_repo(
        &self,
        request: RepoProvisionRequest,
    ) -> AdapterResult<RepoProvisionResult>;
}

#[async_trait]
pub trait PipelineOrchestrator: Send + Sync {
    async fn plan_pipeline(&self, request: PipelinePlanRequest) -> AdapterResult<PipelinePlan>;
    async fn enqueue_pipeline(&self, plan: PipelinePlan) -> AdapterResult<PipelineRun>;
}

#[async_trait]
pub trait ExperimentAdapter: Send + Sync {
    async fn visible_spec_summary(&self, project: &Project) -> AdapterResult<Value>;
    async fn derive_pipeline_plan(
        &self,
        request: PipelinePlanRequest,
    ) -> AdapterResult<PipelinePlan>;
}

#[async_trait]
pub trait AgentGateway: Send + Sync {
    async fn complete(&self, request: AgentGatewayRequest) -> AdapterResult<AgentGatewayResponse>;
}
