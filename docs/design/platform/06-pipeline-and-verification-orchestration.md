# 06 Pipeline And Verification Orchestration

回答的问题：

- 平台如何编排 CI/CD 与验证流程
- 测试矩阵如何从本地 `spec/` 和云端规则派生
- 证据如何归档和回传

上游依赖文档：

- [04-experiment-and-spec-management.md](./04-experiment-and-spec-management.md)
- [05-project-lifecycle-and-repository-provisioning.md](./05-project-lifecycle-and-repository-provisioning.md)
- [../toolchain/README.md](../toolchain/README.md)
- [../spec/06-verification-and-evidence.md](../spec/06-verification-and-evidence.md)

下游消费者：

- Pipeline Orchestrator
- Runner
- Portal
- Judge Controller
- Analytics

## 1. 执行契约

平台将一次验证执行统一建模为：

```text
PipelinePlan
  -> Step[]
  -> EvidenceBundle
  -> PublicSummary
```

标准步骤至少包括：

```text
prepare
lint
build
run
public verify
hidden verify
evidence collect
report publish
```

其中 `hidden verify` 仅对 staff / Judge 可见。

## 2. 输入

生成 `PipelinePlan` 的输入为：

- `project_id`
- `commit_sha`
- 当前阶段
- 项目绑定的规则快照
- 学生仓库当前 `spec/` 摘要
- `ToolchainSpec` 摘要
- 触发类型

## 3. 测试矩阵派生

测试矩阵由三部分组成：

```text
Base Tests
  + Design-Driven Tests
  + Goal-Specific Tests
```

派生来源：

- 本地 `spec/architecture/`
- 本地 `spec/modules/`
- 本地 `spec/goals/`
- 云端 `VerificationPolicy`
- staff-only 风险扩展规则

派生失败回退：

- 如果本地 `spec/` 不完整，则只执行最低公共验证并标记 `spec_incomplete`
- 如果目标声明不合法，则拒绝生成对应 Goal-Specific Tests

## 4. 关键接口

```http
POST /api/projects/{projectId}/pipelines/run
GET  /api/pipelines/{pipelineRunId}
GET  /api/pipelines/{pipelineRunId}/public-summary
GET  /api/pipelines/{pipelineRunId}/artifacts
POST /api/pipelines/{pipelineRunId}/retry
POST /api/pipelines/{pipelineRunId}/cancel
```

异步语义：

- `run` 返回 `pipeline_run_id`
- `retry` 仅在策略允许时可用

权限要求：

- 学生可触发公共验证
- 教师/助教可触发补跑、强制回归或带 staff-only 范围的验证

## 5. 执行流程

```text
load project snapshot
  -> derive test matrix
  -> allocate runner
  -> execute vos commands
  -> collect evidence
  -> classify result
  -> write public summary
  -> emit events
```

每步都必须保存：

- 输入快照
- 开始/结束时间
- 退出状态
- artifact 引用

## 6. 失败分类

标准失败分类：

```text
spec_error
build_error
runtime_error
verification_failure
infra_failure
timeout
policy_blocked
```

公共摘要只能暴露：

- 失败类别
- 可公开日志片段
- 建议检查方向

不能暴露：

- hidden oracle
- mutation 点
- staff-only 判定细节

## 7. 重试策略

- `infra_failure` 支持自动有限次重试
- `timeout` 默认不自动重试
- `spec_error`、`verification_failure` 仅允许人工重新触发
- 重试必须新建 `PipelineRun`，并保留 `retry_of`

## 8. 证据归档格式

每次运行至少生成：

- `pipeline.json`
- `step-results.json`
- `public-summary.md`
- `artifact-index.json`
- 原始日志与结构化日志引用

VeriSpecOSLab 额外生成：

- `serial.log`
- `qemu.log`
- `image-manifest.json`
- `trace/*.json`

## 9. 平台回传摘要格式

公共摘要至少包含：

- 触发提交
- 当前阶段
- 执行套件概览
- 通过/失败统计
- 可公开失败分类
- 下一步建议

## 10. VeriSpecOSLab 特化说明

平台通过 `vos` 与 OS 项目交互，至少调用：

```text
vos spec lint
vos arch lint
vos build
vos run qemu
vos verify public --stage <stage>
```

平台不直接替代 `vos` 做本地解析或 QEMU 编排。

## 11. 后续扩展点

- 并行测试分片
- 验证缓存
- 风险驱动的自适应测试矩阵
