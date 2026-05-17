# 09 Roles Workflow And Stage Gates

回答的问题：

- 教师、助教、学生、平台、Agent 如何协作
- 平台需要支持哪些状态转换
- 阶段门禁、阶段解锁、设计审核、最终冻结如何实现

上游依赖文档：

- [04-experiment-and-spec-management.md](./04-experiment-and-spec-management.md)
- [05-project-lifecycle-and-repository-provisioning.md](./05-project-lifecycle-and-repository-provisioning.md)
- [../workflow/README.md](../workflow/README.md)

下游消费者：

- Portal
- Backend API
- 审核流实现
- 通知系统

## 1. 角色

- 管理员：维护平台配置、资源池和安全策略
- 教师：定义课程规则、审核设计、发布成绩
- 助教：协助审核、排查异常、处理补跑和申诉
- 学生：提交设计、代码、阶段成果和最终报告
- Agent：在受控权限下提供设计、实现、验证和审计辅助

## 2. 阶段门禁模型

每个 `StageGate` 至少包含：

- 阶段名
- 前置阶段
- 必需产物
- 自动检查
- 人工审核要求
- 解锁条件
- 超时/补交流程

## 3. 关键流程

### 3.1 教师建课并发布实验

```text
create course
  -> configure experiment
  -> version stage gates
  -> bind template / policies / rubric
  -> publish
```

### 3.2 学生加入实验

```text
enroll
  -> project provisioning
  -> initial stage unlocked
  -> student sees public projection
```

### 3.3 阶段设计审核

```text
student submits design
  -> automatic checks
  -> teacher/ta review if required
  -> approve or reject
  -> unlock next stage if passed
```

完成判据：

- 当前阶段有已批准 `DesignSubmission`
- 当前阶段 required checks 通过
- 下一阶段投影已生成

### 3.4 代码提交与验证

```text
student push
  -> pipeline run
  -> public summary
  -> stage status update
```

如果失败：

- 项目继续保持当前阶段
- 可选标记为 `needs_fix`
- 不自动解锁下一阶段

### 3.5 最终冻结与评分

```text
teacher or policy freeze
  -> final submission snapshot
  -> judge run
  -> score publication
  -> appeal window
```

## 4. 状态转换约束

- 未通过前置阶段不得解锁后续阶段。
- 设计审核通过不等于自动通过代码验证。
- 最终冻结后普通 push 不改变评分输入。
- 人工 override 必须记录原因和审批者。

## 5. 接口与事件

```http
POST /api/projects/{projectId}/submit-design
POST /api/design-submissions/{id}/review
POST /api/projects/{projectId}/unlock-next-stage
POST /api/projects/{projectId}/freeze
GET  /api/projects/{projectId}/progress
```

关键事件：

- `stage.submission_received`
- `stage.review_passed`
- `stage.review_rejected`
- `stage.unlocked`
- `project.frozen`

## 6. 失败模式与约束

- 阶段状态不能只靠 Portal 前端计算。
- 自动检查失败不得伪装成人工审核通过。
- 补交流程不得破坏原有证据链。

## 7. VeriSpecOSLab 特化说明

VeriSpecOSLab 的典型阶段包括：

- architecture-seed
- boot-minimum
- memory-management
- trap-privilege
- execution
- syscall-ipc
- resource-and-namespace
- final-synthesis

平台应允许课程调整具体阶段名，但应保留统一的阶段门禁语义。

## 8. 后续扩展点

- 分组项目
- 阶段并行分支
- 面向助教的批量审核队列
