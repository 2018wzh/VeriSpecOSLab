# 00 Overview

回答的问题：

- 为什么需要 `SpecLab Platform`
- 平台解决什么问题，不解决什么问题
- 平台闭环、主线和主要消费者是什么

上游依赖文档：

- [../workflow/README.md](../workflow/README.md)
- [../spec/00-overview.md](../spec/00-overview.md)
- [../toolchain/00-overview.md](../toolchain/00-overview.md)

下游消费者：

- `speclab-portal`
- `speclab-backend`
- `speclab-spec-service`
- `speclab-pipeline`
- `speclab-judge`
- `speclab-agent-governance`
- 运维与课程实施团队

## 1. 定位

`SpecLab Platform` 是围绕 Spec 驱动实验构建的课程平台。它不把实验当成“提交代码并跑固定评测”的一次性活动，而是把：

```text
课程规则
  + 学生设计规格
  + 仓库与工具链
  + 验证与评测
  + Agent 协作与审计
```

组织成一个可追溯、可验证、可评分、可复盘的工程化教学闭环。

对 VeriSpecOSLab 而言，平台的目标是让教师能发布递进式 OS 实验，让学生在受控 Agent 辅助下完成个性化系统构建，并让平台基于设计和证据而不是只基于最终二进制进行评价。

## 2. 平台闭环

平台闭环为：

```text
course setup
  -> project provisioning
  -> staged development
  -> verification
  -> scoring
  -> teaching feedback
```

拆开后可表示为：

```text
教师定义课程与实验
  -> 学生加入实验并获得仓库/工作区
  -> 学生提交阶段设计与代码
  -> 平台执行公开验证和私有验证
  -> Judge 形成标准评分结果
  -> Agent 和教师基于证据提供反馈
  -> 学生继续演化设计与实现
```

## 3. 四条主线

平台由四条主线共同组成：

```text
Spec Line:
  CourseSpec -> ExperimentSpec -> StageGate -> VisibilityProjection

Project Line:
  Enrollment -> RepositoryProvisioning -> StudentProject -> Submission

Verification Line:
  PipelinePlan -> TestMatrix -> EvidenceBundle -> JudgeResult

Agent Line:
  ContextProjection -> ToolExecutionPolicy -> AuditLog -> Feedback
```

四条主线共用同一组身份、项目、阶段、提交和证据对象。

## 4. 主要目标

平台必须支持：

1. 管理课程、实验、阶段门禁、评分规则、AI Policy 和验证策略。
2. 自动创建学生项目、仓库、工作区、Runner 和 Judge 绑定。
3. 消费 authenticated `vos` 产出的本地 `spec` / `ToolchainSpec` 摘要、evidence 和 report，派生公开验证和私有验证。
4. 为本地 Agent、Portal、CI、Judge 和教师看板提供统一数据模型和审计记录。
5. 支持 VeriSpecOSLab 的 OS 特化验证，并为其他 SpecLab 实验保留扩展点。

## 5. 非目标

平台明确不做：

1. 不直接替学生生成完整系统实现。
2. 不把隐藏测试、mutation 规则和 staff-only 评分细节暴露给学生。
3. 不把 `vos`、QEMU 或 Agent Runtime 的内部实现细节重复定义在平台文档中。
4. 不要求所有实验共享同一测试套件或同一架构模板。
5. 不把 AI prompt 本身当作设计真相。

## 6. VeriSpecOSLab 特化说明

平台必须显式支持：

- `QEMU` / `KVM` 驱动的 OS 验证
- 由 `vos` 摘要和 evidence 支撑的 `spec/architecture/` 阶段切片审核
- 由 `vos` 执行的 `ToolchainSpec` 构建/镜像/运行契约
- 串口标记、镜像产物、trace、benchmark 和 AI 审计日志归档

这些能力通过实验类型适配器进入平台，不应污染全部课程核心模型。

## 7. 后续扩展点

- `spec-db-lab` 的数据库 workload / recovery / benchmark 适配器
- `spec-compiler-lab` 的 IR / codegen / semantic test 适配器
- `spec-net-lab` 的 packet trace / protocol state machine 适配器
