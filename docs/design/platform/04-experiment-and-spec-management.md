# 04 Experiment And Spec Management

回答的问题：

- 教师如何创建课程、实验、阶段门禁、评分规则和 AI Policy
- 平台如何管理 `ExperimentSpec` 版本和可见性投影
- Spec Service 需要提供哪些接口

上游依赖文档：

- [03-domain-model.md](./03-domain-model.md)
- [../spec/README.md](../spec/README.md)
- [../workflow/README.md](../workflow/README.md)

下游消费者：

- 教师 Portal
- Backend API
- Spec Service
- Pipeline Orchestrator
- Agent governance / audit

## 1. 职责与边界

本模块负责云端课程规则和实验定义，不负责学生仓库本地 `spec/` 编辑。

云端受管对象至少包括：

- `ExperimentSpec`
- `DesignSpace`
- `StageGate`
- `VerificationPolicy`
- `EvaluationRubric`
- `AIPolicy`
- `JudgePolicy`
- `VisibilityPolicy`

## 2. 版本策略

每类规则都采用显式版本：

```text
draft -> versioned -> active -> superseded
```

约束：

1. 已经有学生项目依赖的活跃版本不能原地覆盖。
2. 更新活跃规则必须生成新版本并记录迁移说明。
3. 每个 `StudentProject` 必须绑定一组规则快照，而不是动态追随最新草稿。

## 3. 可见性投影

同一份规则需要至少生成三种投影：

```text
student-public
agent-public
staff-full
```

其中：

- `student-public` 仅包含公开要求、公开评分项、公开阶段门禁和公开反馈。
- `agent-public` 在 `student-public` 基础上增加 agent-only 风险标签，但不包含 hidden tests 细节。
- `staff-full` 包含所有课程规则、隐藏验证和评分细节。

## 4. 关键接口

### 4.1 实验定义接口

```http
POST /api/experiments
PUT  /api/experiments/{id}
POST /api/experiments/{id}/versions
POST /api/experiments/{id}/publish
GET  /api/experiments/{id}
```

请求必须包含：

- 元数据
- 实验类型
- 规则引用
- 版本说明

失败返回：

- `409` 已有活跃版本冲突
- `422` 阶段门禁或评分规则不完整

### 4.2 StageGate 管理接口

```http
POST /api/experiments/{id}/stage-gates
PUT  /api/stage-gates/{stageGateId}
POST /api/stage-gates/{stageGateId}/activate
```

StageGate 输入至少包含：

- `stage_name`
- `required_artifacts`
- `checks`
- `unlock_conditions`
- `visibility_scope`

### 4.3 规则投影接口

```http
GET /api/projects/{projectId}/projections/student
GET /api/projects/{projectId}/projections/agent
GET /api/projects/{projectId}/projections/staff
```

语义：

- 幂等读取
- 返回绑定到项目快照的投影，不返回最新草稿

## 5. 关键流程

### 5.1 教师创建实验

```text
创建 Course
  -> 创建 Experiment
  -> 填写 DesignSpace / StageGate / Rubric / Policy
  -> 版本化
  -> 预检一致性
  -> 发布
```

完成判据：

- 所有关键规则均有活跃版本
- 至少一个实验模板仓库已绑定
- 至少一套基础验证策略已配置

### 5.2 更新实验规则

```text
教师创建新规则版本
  -> 预览 student/agent/staff 投影
  -> 选择是否迁移现有项目
  -> 发布新版本
```

异常分支：

- 已冻结项目不自动迁移
- 正在评测的提交不能切换规则版本

## 6. 失败模式与约束

- 不能把 hidden rules 投影到学生或普通 Agent。
- 不能在缺少评分规则快照时发布实验。
- 不能让活跃实验引用不存在的模板仓库或适配器。

## 7. VeriSpecOSLab 特化说明

VeriSpecOSLab 的 `DesignSpace` 至少需要包含：

- 目标 ISA / machine
- boot chain 约束
- architecture slice 范围
- 个性化目标类别
- 验证边界模板

`VerificationPolicy` 至少需要包含：

- boot / memory / trap / syscall / userland / benchmark 类策略
- 串口标记与运行成功判据

## 8. 后续扩展点

- 可视化规则差异对比
- 规则迁移模拟器
- staff-only policy linter
