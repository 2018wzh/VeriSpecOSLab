use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::json;
use uuid::Uuid;
use vos_course::{
    AdapterResult, AgentGateway, AgentGatewayRequest, AgentGatewayResponse, CourseAdapterError,
    ExperimentAdapter, PipelineOrchestrator, PipelinePlan, PipelinePlanRequest, PipelineRun,
    Project,
};

use crate::InMemoryStore;

#[derive(Debug)]
pub struct LocalExperimentAdapter {
    spec_root: PathBuf,
}

impl LocalExperimentAdapter {
    pub fn new(spec_root: PathBuf) -> Self {
        Self { spec_root }
    }
}

#[async_trait]
impl ExperimentAdapter for LocalExperimentAdapter {
    async fn visible_spec_summary(&self, project: &Project) -> AdapterResult<serde_json::Value> {
        let architecture_path = self.spec_root.join("architecture").join("seed.yaml");
        let summary = if architecture_path.exists() {
            match std::fs::read_to_string(&architecture_path) {
                Ok(text) => json!({
                    "source": architecture_path,
                    "available": true,
                    "excerpt": text.lines().take(24).collect::<Vec<_>>().join("\n"),
                    "adapter_profile": project.adapter_profile,
                }),
                Err(error) => json!({
                    "source": architecture_path,
                    "available": false,
                    "error": error.to_string(),
                    "adapter_profile": project.adapter_profile,
                }),
            }
        } else {
            json!({
                "source": architecture_path,
                "available": false,
                "message": "local demo adapter did not find a spec/architecture/seed.yaml",
                "adapter_profile": project.adapter_profile,
            })
        };
        Ok(summary)
    }

    async fn derive_pipeline_plan(
        &self,
        request: PipelinePlanRequest,
    ) -> AdapterResult<PipelinePlan> {
        let stage = request
            .project
            .adapter_profile
            .get("stage")
            .and_then(|value| value.as_str())
            .unwrap_or("current");
        Ok(PipelinePlan {
            command: "vos verify public".into(),
            steps: vec![
                "vos spec check-consistency spec".into(),
                "vos arch compose spec/architecture/seed.yaml".into(),
                "vos build".into(),
                format!("vos verify public --stage {stage}"),
            ],
            metadata: json!({
                "adapter": "local-vos-os",
                "project_id": request.project.id,
                "commit_sha": request.commit_sha,
                "projection_scope": request.projection.scope,
            }),
        })
    }
}

pub struct LocalPipelineOrchestrator {
    store: Arc<InMemoryStore>,
}

impl LocalPipelineOrchestrator {
    pub fn new(store: Arc<InMemoryStore>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl PipelineOrchestrator for LocalPipelineOrchestrator {
    async fn plan_pipeline(&self, request: PipelinePlanRequest) -> AdapterResult<PipelinePlan> {
        Ok(PipelinePlan {
            command: "vos verify public".into(),
            steps: vec![
                "spec".into(),
                "build".into(),
                "qemu".into(),
                "verify".into(),
            ],
            metadata: json!({
                "project_id": request.project.id,
                "commit_sha": request.commit_sha,
            }),
        })
    }

    async fn enqueue_pipeline(&self, plan: PipelinePlan) -> AdapterResult<PipelineRun> {
        let project_id = plan
            .metadata
            .get("project_id")
            .and_then(|value| value.as_str())
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| CourseAdapterError::Rejected("missing project_id in plan".into()))?;
        let commit_sha = plan
            .metadata
            .get("commit_sha")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string();
        let teacher = self
            .store
            .authenticate("teacher", "teacher")
            .map_err(|error| CourseAdapterError::Failed(error.to_string()))?
            .1;
        self.store
            .run_pipeline(
                &teacher,
                project_id,
                commit_sha,
                vos_course::TriggerType::Manual,
                None,
            )
            .map_err(|error| CourseAdapterError::Failed(error.to_string()))
    }
}

#[derive(Debug, Default)]
pub struct LocalAgentGateway;

#[async_trait]
impl AgentGateway for LocalAgentGateway {
    async fn complete(&self, request: AgentGatewayRequest) -> AdapterResult<AgentGatewayResponse> {
        let risk_flags = if request.prompt_summary.len() > 4000 {
            vec!["large_prompt".into()]
        } else {
            Vec::new()
        };
        Ok(AgentGatewayResponse {
            response_summary: format!(
                "Demo Agent reviewed the request for project {} using {}. Real model routing is configured through the AgentGateway adapter.",
                request.project_id, request.model
            ),
            tool_calls: vec!["context_projection.read".into()],
            risk_flags,
        })
    }
}
