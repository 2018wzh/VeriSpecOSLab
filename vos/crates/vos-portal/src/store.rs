use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::json;
use uuid::Uuid;
use vos_course::{
    AgentAuditRecord, AgentRiskLevel, Course, CourseStatus, CreateCourseRequest,
    CreateExperimentRequest, CreateProjectRequest, CreateStageGateRequest, DesignReviewStatus,
    DesignSubmission, EvaluationRubric, EvidenceIngestResponse, EvidenceRecord,
    EvidenceRequirement, EvidenceResult, Experiment, ExperimentType, GateKind, GateStatus,
    IncomingEvidenceReport, PipelineRun, PipelineStatus, Project, ProjectOverview, ProjectStatus,
    PublicSummary, PublishState, RubricStatus, ScoreItem, ScoreSummary, StageGate, StageGateConfig,
    StageProgress, TeacherProjectRow, TriggerType, User, UserRole, UserStatus, VisibilityScope,
    check_stage_promotion, recompute_scores, summarize_evidence,
};

use crate::error::{PortalError, PortalResult};
use crate::time::now_timestamp;

#[derive(Default)]
struct PortalData {
    users: HashMap<Uuid, User>,
    users_by_name: HashMap<String, Uuid>,
    tokens: HashMap<String, Uuid>,
    courses: HashMap<Uuid, Course>,
    experiments: HashMap<Uuid, Experiment>,
    stages: HashMap<Uuid, StageGate>,
    projects: HashMap<Uuid, Project>,
    submissions: HashMap<Uuid, DesignSubmission>,
    pipelines: HashMap<Uuid, PipelineRun>,
    evidence: HashMap<Uuid, EvidenceRecord>,
    rubrics: HashMap<Uuid, EvaluationRubric>,
    scores: HashMap<Uuid, ScoreItem>,
    audits: HashMap<Uuid, AgentAuditRecord>,
}

pub struct InMemoryStore {
    data: Mutex<PortalData>,
}

impl InMemoryStore {
    pub fn seeded_demo() -> Self {
        let now = now_timestamp();
        let mut data = PortalData::default();

        let teacher = User {
            id: Uuid::new_v4(),
            username: "teacher".into(),
            display_name: "Course Teacher".into(),
            role: UserRole::Teacher,
            status: UserStatus::Active,
            password_hash: Some("demo:teacher".into()),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let student = User {
            id: Uuid::new_v4(),
            username: "student".into(),
            display_name: "Demo Student".into(),
            role: UserRole::Student,
            status: UserStatus::Active,
            password_hash: Some("demo:student".into()),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let ta = User {
            id: Uuid::new_v4(),
            username: "ta".into(),
            display_name: "Teaching Assistant".into(),
            role: UserRole::Ta,
            status: UserStatus::Active,
            password_hash: Some("demo:ta".into()),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        for user in [teacher.clone(), student.clone(), ta] {
            data.users_by_name.insert(user.username.clone(), user.id);
            data.users.insert(user.id, user);
        }
        data.tokens.insert("demo-teacher".into(), teacher.id);
        data.tokens.insert("demo-student".into(), student.id);

        let course = Course {
            id: Uuid::new_v4(),
            code: "VOS-2026".into(),
            name: "VeriSpecOSLab Operating Systems".into(),
            term: "Spring 2026".into(),
            description: Some("Spec-first OS lab course with staged evidence and AI audit.".into()),
            status: CourseStatus::Active,
            owner_user_id: teacher.id,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        data.courses.insert(course.id, course.clone());

        let experiment = Experiment {
            id: Uuid::new_v4(),
            course_id: course.id,
            title: "xv6 Spec-Driven Kernel".into(),
            description: Some("Progressive boot, memory, trap, process, and syscall lab.".into()),
            experiment_type: ExperimentType::Os,
            spec_version: "xv6-spec-demo".into(),
            base_repo_url: Some("local://examples/xv6-spec".into()),
            publish_state: PublishState::Published,
            config: json!({
                "adapter": "vos-os",
                "visibility": "student-public",
                "runner": "local-demo"
            }),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        data.experiments.insert(experiment.id, experiment.clone());

        let boot_stage = StageGate {
            id: Uuid::new_v4(),
            experiment_id: experiment.id,
            key: "boot-minimum".into(),
            name: "Boot Minimum".into(),
            sequence: 0,
            gate_type: GateKind::Hybrid,
            status: GateStatus::Active,
            config: StageGateConfig {
                required_artifacts: vec!["spec/architecture/slices/01-boot.yaml".into()],
                required_evidence: vec![EvidenceRequirement {
                    suite: "boot".into(),
                    case_name: "serial_banner_check".into(),
                    required_result: EvidenceResult::Pass,
                }],
                manual_review_required: false,
                visibility_scope: Some(VisibilityScope::StudentPublic),
            },
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let memory_stage = StageGate {
            id: Uuid::new_v4(),
            experiment_id: experiment.id,
            key: "memory-management".into(),
            name: "Memory Management".into(),
            sequence: 1,
            gate_type: GateKind::Hybrid,
            status: GateStatus::Active,
            config: StageGateConfig {
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
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let trap_stage = StageGate {
            id: Uuid::new_v4(),
            experiment_id: experiment.id,
            key: "trap-privilege".into(),
            name: "Trap / Privilege".into(),
            sequence: 2,
            gate_type: GateKind::Hybrid,
            status: GateStatus::Active,
            config: StageGateConfig {
                required_artifacts: vec!["spec/architecture/slices/03-trap.yaml".into()],
                required_evidence: vec![EvidenceRequirement {
                    suite: "trap".into(),
                    case_name: "invalid_user_pointer".into(),
                    required_result: EvidenceResult::Pass,
                }],
                manual_review_required: true,
                visibility_scope: Some(VisibilityScope::StudentPublic),
            },
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let syscall_stage = StageGate {
            id: Uuid::new_v4(),
            experiment_id: experiment.id,
            key: "syscall-surface".into(),
            name: "Syscall Surface".into(),
            sequence: 3,
            gate_type: GateKind::Hybrid,
            status: GateStatus::Active,
            config: StageGateConfig {
                required_artifacts: vec!["spec/modules/kernel/syscall/module.yaml".into()],
                required_evidence: vec![EvidenceRequirement {
                    suite: "syscall".into(),
                    case_name: "copyin_copyout_contract".into(),
                    required_result: EvidenceResult::Pass,
                }],
                manual_review_required: true,
                visibility_scope: Some(VisibilityScope::StudentPublic),
            },
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let final_stage = StageGate {
            id: Uuid::new_v4(),
            experiment_id: experiment.id,
            key: "final-defense".into(),
            name: "Final Defense".into(),
            sequence: 4,
            gate_type: GateKind::Manual,
            status: GateStatus::Active,
            config: StageGateConfig {
                required_artifacts: vec!["docs/design-defense.md".into()],
                required_evidence: vec![EvidenceRequirement {
                    suite: "integration".into(),
                    case_name: "public_regression_suite".into(),
                    required_result: EvidenceResult::Pass,
                }],
                manual_review_required: true,
                visibility_scope: Some(VisibilityScope::StaffFull),
            },
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        for stage in [
            boot_stage.clone(),
            memory_stage,
            trap_stage,
            syscall_stage,
            final_stage,
        ] {
            data.stages.insert(stage.id, stage);
        }

        let project = Project {
            id: Uuid::new_v4(),
            student_user_id: student.id,
            experiment_id: experiment.id,
            repo_url: Some("local://student/xv6-spec".into()),
            workspace_ref: Some("workspace-demo-student".into()),
            current_stage_id: boot_stage.id,
            status: ProjectStatus::Active,
            last_commit_sha: Some("demo001".into()),
            adapter_profile: json!({
                "domain": "os",
                "isa": "riscv64",
                "machine": "virt",
                "vos_project_root": "examples/xv6-spec"
            }),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        data.projects.insert(project.id, project.clone());

        let pipeline = PipelineRun {
            id: Uuid::new_v4(),
            project_id: project.id,
            commit_sha: "demo001".into(),
            trigger_type: TriggerType::Demo,
            status: PipelineStatus::Passed,
            stage_scope: Some("boot-minimum".into()),
            public_summary: Some(PublicSummary {
                status: PipelineStatus::Passed,
                passed: 1,
                failed: 0,
                total: 1,
                failure_class: None,
                message: "1/1 public evidence checks passed".into(),
            }),
            retry_of: None,
            started_at: now.clone(),
            finished_at: Some(now.clone()),
        };
        data.pipelines.insert(pipeline.id, pipeline.clone());

        let evidence = EvidenceRecord {
            id: Uuid::new_v4(),
            project_id: project.id,
            pipeline_run_id: pipeline.id,
            commit_sha: "demo001".into(),
            kind: vos_course::EvidenceKind::Test,
            suite: "boot".into(),
            case_name: "serial_banner_check".into(),
            result: EvidenceResult::Pass,
            metrics: json!({"boot_ms": 912, "signal": "XV6_BOOT_OK"}),
            log_segment: Some("[SPECLAB] kernel_init\nXV6_BOOT_OK".into()),
            artifact_uri: Some(".vos/runs/demo/qemu.log".into()),
            created_at: now.clone(),
        };
        data.evidence.insert(evidence.id, evidence);

        let rubric = EvaluationRubric {
            id: Uuid::new_v4(),
            experiment_id: experiment.id,
            name: "Boot evidence".into(),
            status: RubricStatus::Active,
            target_kind: vos_course::EvidenceKind::Test,
            target_suite: Some("boot".into()),
            target_case: Some("serial_banner_check".into()),
            weight: 10.0,
            description: Some("Boot banner and success marker are present.".into()),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let rubric_id = rubric.id;
        data.rubrics.insert(rubric.id, rubric);
        let score = ScoreItem {
            id: Uuid::new_v4(),
            project_id: project.id,
            rubric_id,
            auto_score: 10.0,
            manual_score: None,
            feedback: Some("Boot evidence passed in the seeded public verification run.".into()),
            is_final: false,
            updated_at: now.clone(),
        };
        data.scores.insert(score.id, score);

        Self {
            data: Mutex::new(data),
        }
    }

    pub fn authenticate(&self, username: &str, password: &str) -> PortalResult<(String, User)> {
        let mut data = self.lock()?;
        let user_id = data
            .users_by_name
            .get(username)
            .copied()
            .ok_or(PortalError::Unauthorized)?;
        let user = data
            .users
            .get(&user_id)
            .cloned()
            .ok_or(PortalError::Unauthorized)?;
        let expected = format!("demo:{password}");
        if user.password_hash.as_deref() != Some(expected.as_str()) {
            return Err(PortalError::Unauthorized);
        }
        let token = format!("demo-{}-{}", user.username, Uuid::new_v4());
        data.tokens.insert(token.clone(), user.id);
        Ok((token, user))
    }

    pub fn user_for_token(&self, token: &str) -> PortalResult<User> {
        let data = self.lock()?;
        let user_id = data
            .tokens
            .get(token)
            .copied()
            .ok_or(PortalError::Unauthorized)?;
        data.users
            .get(&user_id)
            .cloned()
            .ok_or(PortalError::Unauthorized)
    }

    pub fn list_courses(&self) -> PortalResult<Vec<Course>> {
        let data = self.lock()?;
        let mut courses: Vec<_> = data.courses.values().cloned().collect();
        courses.sort_by(|a, b| a.code.cmp(&b.code));
        Ok(courses)
    }

    pub fn create_course(
        &self,
        owner: &User,
        request: CreateCourseRequest,
    ) -> PortalResult<Course> {
        Self::require_staff(owner)?;
        let mut data = self.lock()?;
        if data
            .courses
            .values()
            .any(|course| course.code == request.code)
        {
            return Err(PortalError::Conflict(format!(
                "course code {} already exists",
                request.code
            )));
        }
        let now = now_timestamp();
        let course = Course {
            id: Uuid::new_v4(),
            code: request.code,
            name: request.name,
            term: request.term,
            description: request.description,
            status: CourseStatus::Draft,
            owner_user_id: owner.id,
            created_at: now.clone(),
            updated_at: now,
        };
        data.courses.insert(course.id, course.clone());
        Ok(course)
    }

    pub fn list_experiments(&self, course_id: Option<Uuid>) -> PortalResult<Vec<Experiment>> {
        let data = self.lock()?;
        let mut experiments: Vec<_> = data
            .experiments
            .values()
            .filter(|experiment| course_id.is_none_or(|id| experiment.course_id == id))
            .cloned()
            .collect();
        experiments.sort_by(|a, b| a.title.cmp(&b.title));
        Ok(experiments)
    }

    pub fn create_experiment(
        &self,
        actor: &User,
        request: CreateExperimentRequest,
    ) -> PortalResult<Experiment> {
        Self::require_staff(actor)?;
        let mut data = self.lock()?;
        if !data.courses.contains_key(&request.course_id) {
            return Err(PortalError::missing("course", request.course_id));
        }
        let now = now_timestamp();
        let experiment = Experiment {
            id: Uuid::new_v4(),
            course_id: request.course_id,
            title: request.title,
            description: request.description,
            experiment_type: request.experiment_type,
            spec_version: request.spec_version.unwrap_or_else(|| "draft".into()),
            base_repo_url: request.base_repo_url,
            publish_state: request.publish_state.unwrap_or(PublishState::Draft),
            config: request.config,
            created_at: now.clone(),
            updated_at: now,
        };
        data.experiments.insert(experiment.id, experiment.clone());
        Ok(experiment)
    }

    pub fn list_stage_gates(&self, experiment_id: Uuid) -> PortalResult<Vec<StageGate>> {
        let data = self.lock()?;
        let mut stages: Vec<_> = data
            .stages
            .values()
            .filter(|stage| stage.experiment_id == experiment_id)
            .cloned()
            .collect();
        stages.sort_by_key(|stage| stage.sequence);
        Ok(stages)
    }

    pub fn create_stage_gate(
        &self,
        actor: &User,
        request: CreateStageGateRequest,
    ) -> PortalResult<StageGate> {
        Self::require_staff(actor)?;
        let mut data = self.lock()?;
        if !data.experiments.contains_key(&request.experiment_id) {
            return Err(PortalError::missing("experiment", request.experiment_id));
        }
        let now = now_timestamp();
        let stage = StageGate {
            id: Uuid::new_v4(),
            experiment_id: request.experiment_id,
            key: request.key,
            name: request.name,
            sequence: request.sequence,
            gate_type: request.gate_type,
            status: GateStatus::Draft,
            config: request.config,
            created_at: now.clone(),
            updated_at: now,
        };
        data.stages.insert(stage.id, stage.clone());
        Ok(stage)
    }

    pub fn create_project(
        &self,
        actor: &User,
        request: CreateProjectRequest,
    ) -> PortalResult<Project> {
        Self::require_staff(actor)?;
        let mut data = self.lock()?;
        if !data.experiments.contains_key(&request.experiment_id) {
            return Err(PortalError::missing("experiment", request.experiment_id));
        }
        let initial_stage = data
            .stages
            .values()
            .filter(|stage| stage.experiment_id == request.experiment_id)
            .min_by_key(|stage| stage.sequence)
            .ok_or_else(|| PortalError::BadRequest("experiment has no stage gates".into()))?;
        let now = now_timestamp();
        let project = Project {
            id: Uuid::new_v4(),
            student_user_id: request.student_user_id,
            experiment_id: request.experiment_id,
            repo_url: request.repo_url,
            workspace_ref: None,
            current_stage_id: initial_stage.id,
            status: ProjectStatus::Provisioning,
            last_commit_sha: None,
            adapter_profile: json!({"adapter": "local-demo"}),
            created_at: now.clone(),
            updated_at: now,
        };
        data.projects.insert(project.id, project.clone());
        Ok(project)
    }

    pub fn list_project_overviews(&self, actor: &User) -> PortalResult<Vec<ProjectOverview>> {
        let data = self.lock()?;
        let projects: Vec<_> = data
            .projects
            .values()
            .filter(|project| {
                matches!(
                    actor.role,
                    UserRole::Admin | UserRole::Teacher | UserRole::Ta
                ) || project.student_user_id == actor.id
            })
            .cloned()
            .collect();
        projects
            .iter()
            .map(|project| Self::project_overview_locked(&data, project))
            .collect()
    }

    pub fn project_overview(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<ProjectOverview> {
        let data = self.lock()?;
        let project = data
            .projects
            .get(&project_id)
            .cloned()
            .ok_or_else(|| PortalError::missing("project", project_id))?;
        Self::require_project_access(actor, &project)?;
        Self::project_overview_locked(&data, &project)
    }

    pub fn stage_progress(&self, actor: &User, project_id: Uuid) -> PortalResult<StageProgress> {
        let data = self.lock()?;
        let project = data
            .projects
            .get(&project_id)
            .cloned()
            .ok_or_else(|| PortalError::missing("project", project_id))?;
        Self::require_project_access(actor, &project)?;
        let current_stage = data
            .stages
            .get(&project.current_stage_id)
            .cloned()
            .ok_or_else(|| PortalError::missing("stage", project.current_stage_id))?;
        let mut stages: Vec<_> = data
            .stages
            .values()
            .filter(|stage| stage.experiment_id == project.experiment_id)
            .cloned()
            .collect();
        stages.sort_by_key(|stage| stage.sequence);
        let evidence: Vec<_> = data
            .evidence
            .values()
            .filter(|record| record.project_id == project.id)
            .cloned()
            .collect();
        let submissions: Vec<_> = data
            .submissions
            .values()
            .filter(|submission| submission.project_id == project.id)
            .cloned()
            .collect();
        let progress = stages
            .iter()
            .map(|stage| {
                let missing_evidence =
                    vos_course::missing_required_evidence(&stage.config, &evidence);
                let manual_review_status = submissions
                    .iter()
                    .filter(|submission| submission.stage_gate_id == stage.id)
                    .max_by_key(|submission| &submission.updated_at)
                    .map(|submission| submission.review_status);
                let passed = missing_evidence.is_empty()
                    && (!stage.config.manual_review_required
                        || matches!(manual_review_status, Some(DesignReviewStatus::Approved)));
                vos_course::StageGateProgress {
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

    pub fn run_pipeline(
        &self,
        actor: &User,
        project_id: Uuid,
        commit_sha: String,
        trigger_type: TriggerType,
        stage_scope: Option<String>,
    ) -> PortalResult<PipelineRun> {
        let mut data = self.lock()?;
        let project = data
            .projects
            .get(&project_id)
            .cloned()
            .ok_or_else(|| PortalError::missing("project", project_id))?;
        Self::require_project_access(actor, &project)?;
        let now = now_timestamp();
        let pipeline = PipelineRun {
            id: Uuid::new_v4(),
            project_id,
            commit_sha,
            trigger_type,
            status: PipelineStatus::Running,
            stage_scope,
            public_summary: None,
            retry_of: None,
            started_at: now,
            finished_at: None,
        };
        data.pipelines.insert(pipeline.id, pipeline.clone());
        Ok(pipeline)
    }

    pub fn list_pipelines(&self, actor: &User, project_id: Uuid) -> PortalResult<Vec<PipelineRun>> {
        let data = self.lock()?;
        let project = data
            .projects
            .get(&project_id)
            .ok_or_else(|| PortalError::missing("project", project_id))?;
        Self::require_project_access(actor, project)?;
        let mut pipelines: Vec<_> = data
            .pipelines
            .values()
            .filter(|pipeline| pipeline.project_id == project_id)
            .cloned()
            .collect();
        pipelines.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(pipelines)
    }

    pub fn pipeline(&self, actor: &User, pipeline_id: Uuid) -> PortalResult<PipelineRun> {
        let data = self.lock()?;
        let pipeline = data
            .pipelines
            .get(&pipeline_id)
            .cloned()
            .ok_or_else(|| PortalError::missing("pipeline", pipeline_id))?;
        let project = data
            .projects
            .get(&pipeline.project_id)
            .ok_or_else(|| PortalError::missing("project", pipeline.project_id))?;
        Self::require_project_access(actor, project)?;
        Ok(pipeline)
    }

    pub fn ingest_evidence(
        &self,
        report: IncomingEvidenceReport,
    ) -> PortalResult<EvidenceIngestResponse> {
        let mut data = self.lock()?;
        let project = data
            .projects
            .get(&report.project_id)
            .cloned()
            .ok_or_else(|| PortalError::missing("project", report.project_id))?;
        let now = now_timestamp();
        let pipeline_id = if let Some(id) = report.pipeline_run_id {
            id
        } else {
            let pipeline = PipelineRun {
                id: Uuid::new_v4(),
                project_id: project.id,
                commit_sha: report.commit_sha.clone(),
                trigger_type: TriggerType::Manual,
                status: PipelineStatus::Running,
                stage_scope: None,
                public_summary: None,
                retry_of: None,
                started_at: now.clone(),
                finished_at: None,
            };
            let id = pipeline.id;
            data.pipelines.insert(id, pipeline);
            id
        };

        let mut inserted = Vec::new();
        for incoming in report.records {
            let record = EvidenceRecord {
                id: Uuid::new_v4(),
                project_id: project.id,
                pipeline_run_id: pipeline_id,
                commit_sha: report.commit_sha.clone(),
                kind: incoming.kind,
                suite: incoming.suite,
                case_name: incoming.case_name,
                result: incoming.result,
                metrics: incoming.metrics,
                log_segment: incoming.log_segment,
                artifact_uri: incoming.artifact_uri,
                created_at: now.clone(),
            };
            data.evidence.insert(record.id, record.clone());
            inserted.push(record);
        }

        let project_evidence: Vec<_> = data
            .evidence
            .values()
            .filter(|record| record.project_id == project.id)
            .cloned()
            .collect();
        let summary = summarize_evidence(&inserted);
        let pipeline = data
            .pipelines
            .get_mut(&pipeline_id)
            .ok_or_else(|| PortalError::missing("pipeline", pipeline_id))?;
        pipeline.status = summary.status;
        pipeline.public_summary = Some(summary);
        pipeline.finished_at = Some(now.clone());
        let pipeline = pipeline.clone();

        if let Some(project_mut) = data.projects.get_mut(&project.id) {
            project_mut.last_commit_sha = Some(report.commit_sha.clone());
            project_mut.updated_at = now.clone();
        }

        let stages: Vec<_> = data
            .stages
            .values()
            .filter(|stage| stage.experiment_id == project.experiment_id)
            .cloned()
            .collect();
        let submissions: Vec<_> = data
            .submissions
            .values()
            .filter(|submission| submission.project_id == project.id)
            .cloned()
            .collect();
        let mut promoted_stage_id = None;
        let latest_project = data
            .projects
            .get(&project.id)
            .cloned()
            .ok_or_else(|| PortalError::missing("project", project.id))?;
        let promotion =
            check_stage_promotion(&latest_project, &stages, &submissions, &project_evidence);
        if promotion.eligible {
            if let Some(next_stage_id) = promotion.next_stage_id {
                if let Some(project_mut) = data.projects.get_mut(&project.id) {
                    project_mut.current_stage_id = next_stage_id;
                    project_mut.updated_at = now.clone();
                }
                promoted_stage_id = Some(next_stage_id);
            }
        }

        let rubrics: Vec<_> = data.rubrics.values().cloned().collect();
        let scores: Vec<_> = data.scores.values().cloned().collect();
        let recomputed = recompute_scores(&project, &rubrics, &scores, &project_evidence, now);
        for score in &recomputed.updated_scores {
            data.scores.insert(score.id, score.clone());
        }

        Ok(EvidenceIngestResponse {
            pipeline,
            inserted,
            promoted_stage_id,
            recomputed_scores: recomputed.updated_scores,
        })
    }

    pub fn list_evidence(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<Vec<EvidenceRecord>> {
        let data = self.lock()?;
        let project = data
            .projects
            .get(&project_id)
            .ok_or_else(|| PortalError::missing("project", project_id))?;
        Self::require_project_access(actor, project)?;
        let mut evidence: Vec<_> = data
            .evidence
            .values()
            .filter(|record| record.project_id == project_id)
            .cloned()
            .collect();
        evidence.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(evidence)
    }

    pub fn list_scores(&self, actor: &User, project_id: Uuid) -> PortalResult<Vec<ScoreItem>> {
        let data = self.lock()?;
        let project = data
            .projects
            .get(&project_id)
            .ok_or_else(|| PortalError::missing("project", project_id))?;
        Self::require_project_access(actor, project)?;
        Ok(data
            .scores
            .values()
            .filter(|score| score.project_id == project_id)
            .cloned()
            .collect())
    }

    pub fn update_score(
        &self,
        actor: &User,
        project_id: Uuid,
        rubric_id: Uuid,
        manual_score: Option<f32>,
        feedback: Option<String>,
        is_final: Option<bool>,
    ) -> PortalResult<ScoreItem> {
        Self::require_staff(actor)?;
        let mut data = self.lock()?;
        if !data.projects.contains_key(&project_id) {
            return Err(PortalError::missing("project", project_id));
        }
        if !data.rubrics.contains_key(&rubric_id) {
            return Err(PortalError::missing("rubric", rubric_id));
        }
        let now = now_timestamp();
        let existing_id = data
            .scores
            .values()
            .find(|score| score.project_id == project_id && score.rubric_id == rubric_id)
            .map(|score| score.id);
        let score = if let Some(score_id) = existing_id {
            let mut score = data
                .scores
                .get(&score_id)
                .cloned()
                .ok_or_else(|| PortalError::missing("score", score_id))?;
            score.manual_score = manual_score;
            score.feedback = feedback;
            score.is_final = is_final.unwrap_or(score.is_final);
            score.updated_at = now;
            score
        } else {
            ScoreItem {
                id: Uuid::new_v4(),
                project_id,
                rubric_id,
                auto_score: 0.0,
                manual_score,
                feedback,
                is_final: is_final.unwrap_or(false),
                updated_at: now,
            }
        };
        data.scores.insert(score.id, score.clone());
        Ok(score)
    }

    pub fn submit_design(
        &self,
        actor: &User,
        project_id: Uuid,
        stage_gate_id: Uuid,
        commit_sha: String,
        artifact_ref: Option<String>,
    ) -> PortalResult<DesignSubmission> {
        let mut data = self.lock()?;
        let project = data
            .projects
            .get(&project_id)
            .cloned()
            .ok_or_else(|| PortalError::missing("project", project_id))?;
        Self::require_project_access(actor, &project)?;
        let now = now_timestamp();
        let submission = DesignSubmission {
            id: Uuid::new_v4(),
            project_id,
            stage_gate_id,
            commit_sha,
            artifact_ref,
            review_status: DesignReviewStatus::Submitted,
            reviewer_user_id: None,
            feedback: None,
            created_at: now.clone(),
            updated_at: now,
        };
        data.submissions.insert(submission.id, submission.clone());
        Ok(submission)
    }

    pub fn review_design(
        &self,
        actor: &User,
        submission_id: Uuid,
        status: DesignReviewStatus,
        feedback: Option<String>,
    ) -> PortalResult<DesignSubmission> {
        Self::require_staff(actor)?;
        let mut data = self.lock()?;
        let submission = data
            .submissions
            .get_mut(&submission_id)
            .ok_or_else(|| PortalError::missing("design submission", submission_id))?;
        submission.review_status = status;
        submission.reviewer_user_id = Some(actor.id);
        submission.feedback = feedback;
        submission.updated_at = now_timestamp();
        Ok(submission.clone())
    }

    pub fn freeze_project(&self, actor: &User, project_id: Uuid) -> PortalResult<Project> {
        Self::require_staff(actor)?;
        let mut data = self.lock()?;
        let project = data
            .projects
            .get_mut(&project_id)
            .ok_or_else(|| PortalError::missing("project", project_id))?;
        project.status = ProjectStatus::Frozen;
        project.updated_at = now_timestamp();
        Ok(project.clone())
    }

    pub fn teacher_rows(
        &self,
        actor: &User,
        experiment_id: Uuid,
    ) -> PortalResult<Vec<TeacherProjectRow>> {
        Self::require_staff(actor)?;
        let data = self.lock()?;
        let mut rows = Vec::new();
        for project in data
            .projects
            .values()
            .filter(|project| project.experiment_id == experiment_id)
        {
            let student = data
                .users
                .get(&project.student_user_id)
                .cloned()
                .ok_or_else(|| PortalError::missing("user", project.student_user_id))?;
            let overview = Self::project_overview_locked(&data, project)?;
            let risk_flags = data
                .audits
                .values()
                .filter(|audit| {
                    audit.project_id == project.id
                        && matches!(
                            audit.risk_level,
                            AgentRiskLevel::High | AgentRiskLevel::Critical
                        )
                })
                .flat_map(|audit| audit.risk_flags.clone())
                .collect();
            rows.push(TeacherProjectRow {
                project: project.clone(),
                student,
                current_stage: overview.current_stage,
                latest_pipeline: overview.latest_pipeline,
                score_summary: overview.score_summary,
                risk_flags,
            });
        }
        Ok(rows)
    }

    pub fn record_audit(&self, audit: AgentAuditRecord) -> PortalResult<AgentAuditRecord> {
        let mut data = self.lock()?;
        data.audits.insert(audit.id, audit.clone());
        Ok(audit)
    }

    pub fn list_audits(
        &self,
        actor: &User,
        project_id: Uuid,
    ) -> PortalResult<Vec<AgentAuditRecord>> {
        let data = self.lock()?;
        let project = data
            .projects
            .get(&project_id)
            .ok_or_else(|| PortalError::missing("project", project_id))?;
        Self::require_project_access(actor, project)?;
        let mut audits: Vec<_> = data
            .audits
            .values()
            .filter(|audit| audit.project_id == project_id)
            .cloned()
            .collect();
        audits.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(audits)
    }

    fn project_overview_locked(
        data: &PortalData,
        project: &Project,
    ) -> PortalResult<ProjectOverview> {
        let current_stage = data
            .stages
            .get(&project.current_stage_id)
            .cloned()
            .ok_or_else(|| PortalError::missing("stage", project.current_stage_id))?;
        let latest_pipeline = data
            .pipelines
            .values()
            .filter(|pipeline| pipeline.project_id == project.id)
            .max_by_key(|pipeline| &pipeline.started_at)
            .cloned();
        let score_summary = Self::score_summary_locked(data, project);
        Ok(ProjectOverview {
            project: project.clone(),
            current_stage,
            latest_pipeline,
            score_summary,
        })
    }

    fn score_summary_locked(data: &PortalData, project: &Project) -> ScoreSummary {
        let earned = data
            .scores
            .values()
            .filter(|score| score.project_id == project.id)
            .map(|score| score.manual_score.unwrap_or(score.auto_score))
            .sum();
        let possible = data
            .rubrics
            .values()
            .filter(|rubric| rubric.experiment_id == project.experiment_id)
            .map(|rubric| rubric.weight)
            .sum();
        let project_scores: Vec<_> = data
            .scores
            .values()
            .filter(|score| score.project_id == project.id)
            .collect();
        ScoreSummary {
            earned,
            possible,
            finalized: !project_scores.is_empty()
                && project_scores.iter().all(|score| score.is_final),
        }
    }

    fn require_project_access(actor: &User, project: &Project) -> PortalResult<()> {
        if matches!(
            actor.role,
            UserRole::Admin | UserRole::Teacher | UserRole::Ta
        ) || actor.id == project.student_user_id
        {
            Ok(())
        } else {
            Err(PortalError::Forbidden)
        }
    }

    fn require_staff(actor: &User) -> PortalResult<()> {
        if matches!(
            actor.role,
            UserRole::Admin | UserRole::Teacher | UserRole::Ta
        ) {
            Ok(())
        } else {
            Err(PortalError::Forbidden)
        }
    }

    fn lock(&self) -> PortalResult<std::sync::MutexGuard<'_, PortalData>> {
        self.data
            .lock()
            .map_err(|_| PortalError::Internal("portal store lock is poisoned".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vos_course::{EvidenceKind, IncomingEvidenceRecord};

    #[test]
    fn demo_auth_and_project_listing_work() {
        let store = InMemoryStore::seeded_demo();
        let (_token, user) = store.authenticate("student", "student").unwrap();
        let projects = store.list_project_overviews(&user).unwrap();
        assert_eq!(projects.len(), 1);
    }

    #[test]
    fn evidence_ingest_recomputes_pipeline_summary() {
        let store = InMemoryStore::seeded_demo();
        let (_token, user) = store.authenticate("teacher", "teacher").unwrap();
        let project_id = store.list_project_overviews(&user).unwrap()[0].project.id;
        let response = store
            .ingest_evidence(IncomingEvidenceReport {
                project_id,
                pipeline_run_id: None,
                commit_sha: "abc".into(),
                records: vec![IncomingEvidenceRecord {
                    kind: EvidenceKind::Test,
                    suite: "memory".into(),
                    case_name: "page_allocator_tests".into(),
                    result: EvidenceResult::Fail,
                    metrics: json!({}),
                    log_segment: Some("allocator assertion failed".into()),
                    artifact_uri: None,
                }],
                vos_report: None,
            })
            .unwrap();
        assert_eq!(response.pipeline.status, PipelineStatus::Failed);
        assert_eq!(response.inserted.len(), 1);
    }
}
