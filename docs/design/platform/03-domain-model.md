# 03 Domain Model

回答的问题：

- 平台有哪些核心实体
- 每个实体的状态、关联和生命周期是什么
- 哪些对象跨子系统共享

上游依赖文档：

- [02-system-architecture.md](./02-system-architecture.md)

下游消费者：

- 数据库 schema 设计
- API 设计
- 事件模型设计
- Portal 列表与详情页设计

## 1. 统一建模原则

1. 平台状态只落在领域实体，不落在日志文件名或外部服务临时结果中。
2. 每次验证、评测、审查和 Agent 交互都必须能定位到唯一的项目、阶段和提交。
3. 证据与成绩分离：证据可复算，成绩可复核。

## 2. 核心实体

### 2.1 User

- 标识：`user_id`
- 关键字段：`login`、`display_name`、`role_bindings`、`status`
- 状态：`active | suspended | archived`
- 关联：`CourseMembership`、`StudentProject`、`AgentSession`
- 生命周期事件：`user.created`、`user.role_bound`、`user.suspended`

### 2.2 Course

- 标识：`course_id`
- 关键字段：`term`、`owner_team`、`default_policies`
- 状态：`draft | active | closed | archived`
- 关联：`Experiment`、`User`
- 生命周期事件：`course.created`、`course.activated`、`course.closed`

### 2.3 Experiment

- 标识：`experiment_id`
- 关键字段：`type`、`course_id`、`spec_version`、`publish_state`
- 状态：`draft | published | frozen | archived`
- 关联：`ExperimentSpec`、`StageGate`、`EvaluationRubric`、`StudentProject`
- 生命周期事件：`experiment.created`、`experiment.published`、`experiment.frozen`

### 2.4 ExperimentSpec

- 标识：`experiment_spec_id`
- 关键字段：`version`、`design_space_ref`、`visibility_policy_ref`
- 状态：`editing | versioned | published | superseded`
- 关联：`Experiment`
- 生命周期事件：`spec.versioned`、`spec.published`、`spec.superseded`

### 2.5 StageGate

- 标识：`stage_gate_id`
- 关键字段：`stage_name`、`required_artifacts`、`checks`、`visibility_scope`
- 状态：`draft | active | retired`
- 关联：`Experiment`、`StudentProject`、`DesignSubmission`
- 生命周期事件：`stage_gate.activated`、`stage_gate.retired`

### 2.6 StudentProject

- 标识：`project_id`
- 关键字段：`student_id`、`experiment_id`、`current_stage`、`provisioning_state`
- 状态：`provisioning | active | stage_locked | frozen | completed | archived`
- 关联：`Repository`、`DesignSubmission`、`PipelineRun`、`JudgeSubmission`、`Artifact`
- 生命周期事件：`project.provisioning_started`、`project.activated`、`project.frozen`

### 2.7 DesignSubmission

- 标识：`design_submission_id`
- 关键字段：`project_id`、`stage`、`commit_sha`、`parsed_design_ref`、`review_status`
- 状态：`submitted | validating | under_review | approved | rejected | superseded`
- 关联：`StageGate`、`Artifact`、`AgentSession`
- 生命周期事件：`design.submitted`、`design.approved`、`design.rejected`

### 2.8 PipelineRun

- 标识：`pipeline_run_id`
- 关键字段：`project_id`、`trigger`、`commit_sha`、`stage_scope`、`public_summary`
- 状态：`queued | preparing | running | passed | failed | cancelled | timed_out`
- 关联：`Artifact`、`VerificationCaseResult`
- 生命周期事件：`pipeline.queued`、`pipeline.started`、`pipeline.finished`

### 2.9 JudgeSubmission

- 标识：`judge_submission_id`
- 关键字段：`project_id`、`frozen_commit_sha`、`submission_kind`
- 状态：`queued | running | scored | failed | invalidated`
- 关联：`JudgeResult`、`Artifact`
- 生命周期事件：`judge.submitted`、`judge.scored`、`judge.invalidated`

### 2.10 JudgeResult

- 标识：`judge_result_id`
- 关键字段：`score`、`status`、`suite_results`、`evidence_bundle_ref`
- 状态：`provisional | published | appealed | revised | final`
- 关联：`JudgeSubmission`、`EvaluationRubric`
- 生命周期事件：`judge_result.published`、`judge_result.revised`

### 2.11 Artifact

- 标识：`artifact_id`
- 关键字段：`kind`、`uri`、`producer_type`、`retention_policy`
- 状态：`available | quarantined | expired | deleted`
- 关联：几乎所有运行类实体
- 生命周期事件：`artifact.created`、`artifact.quarantined`、`artifact.expired`

### 2.12 AgentSession

- 标识：`agent_session_id`
- 关键字段：`user_id`、`project_id`、`role`、`tool_policy_snapshot`
- 状态：`open | closed | escalated | flagged`
- 关联：`Artifact`、`AuditRecord`
- 生命周期事件：`agent_session.opened`、`agent_session.flagged`、`agent_session.closed`

### 2.13 EvaluationRubric

- 标识：`rubric_id`
- 关键字段：`weights`、`evidence_rules`、`manual_review_rules`
- 状态：`draft | active | superseded`
- 关联：`Experiment`、`JudgeResult`
- 生命周期事件：`rubric.activated`、`rubric.superseded`

## 3. 关键关联

```text
Course 1 -> N Experiment
Experiment 1 -> N StageGate
Experiment 1 -> N StudentProject
StudentProject 1 -> N DesignSubmission
StudentProject 1 -> N PipelineRun
StudentProject 1 -> N JudgeSubmission
JudgeSubmission 1 -> 1 JudgeResult
StudentProject 1 -> N AgentSession
Any runtime entity -> N Artifact
```

## 4. 事件模型

平台至少需要发布以下事件：

- `project.provisioned`
- `design.review_requested`
- `pipeline.public_failed`
- `pipeline.evidence_published`
- `judge.result_published`
- `agent.audit_flagged`
- `score.recomputed`

事件必须包含：

- `project_id`
- `experiment_id`
- `stage`
- `actor`
- `time`
- `causation_id`

## 5. 失败模式与约束

- 不允许 `PipelineRun` 和 `JudgeSubmission` 指向不明确的提交。
- 不允许 `JudgeResult` 在没有 `EvaluationRubric` 快照时发布。
- 不允许 `Artifact` 作为唯一业务真相来源。
- 不允许 `AgentSession` 丢失工具策略快照。

## 6. VeriSpecOSLab 特化说明

VeriSpecOSLab 在公共模型上额外要求：

- `StudentProject` 需要保存当前 ISA / machine / boot profile 摘要
- `PipelineRun` 需要能关联 `serial.log`、`qemu.log`、镜像、trace
- `JudgeResult` 需要能区分 boot、syscall、memory、verification、benchmark 类 suite

## 7. 后续扩展点

- `ExperimentAdapter`
- `VerificationCaseTemplate`
- `CoursePolicySnapshot`
