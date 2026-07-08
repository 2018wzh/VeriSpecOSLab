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
- `commit_sha`，作为唯一复现锚点
- 当前阶段
- 项目绑定的规则快照
- Portal 签发或校验的 `vos` policy snapshot
- 由 `vos` 产出的学生仓库 `spec/` 摘要
- 由 `vos` 产出的 `ToolchainSpec` 摘要
- 触发类型

Pipeline 不接受本地未提交文件、未跟踪文件或本地 `.vos/runs/` 作为复现
输入。所有可复现 metadata 必须来自提交历史中的 `.vos/commit-ledger.jsonl`
或等价 tracked trailer。

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

平台可以用上述信息生成规则快照和验证意图，但不直接解析 repo 语义或执行
QEMU。repo 内的 spec/toolchain 消费、构建、运行和 evidence 生成必须由
authenticated `vos-cli` 完成。

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
checkout commit_sha
  -> verify commit ledger
  -> load project snapshot
  -> bind Portal user / project / stage / policy snapshot
  -> derive test matrix
  -> allocate runner
  -> start vos serve or invoke authenticated vos
  -> execute vos build generate
  -> execute vos build
  -> execute vos verify
  -> collect evidence
  -> classify result
  -> write public summary
  -> emit events
```

每步都必须保存：

- 输入快照
- `commit_sha`
- ledger record ref
- policy snapshot ref 与 auth verdict
- 开始/结束时间
- 退出状态
- artifact 引用

平台 Runner 的复现入口必须从 clean tree 和当前 `HEAD` ledger 记录开始。
关键入口包括 `vos build generate`、非 dry-run `vos build`、`vos run qemu`、
`vos test`、`vos verify` 和提交前检查。只读检查、上下文查看、知识问答和诊断说明
不要求 clean tree gate；checkout 后进入构建、验证或提交前仍必须通过等价 gate。

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
reproducibility_error
```

缺少 ledger 记录、ledger 与 commit diff 不匹配、提交包引用非当前 `HEAD`、
或复现依赖未提交文件时，标记为 `policy_blocked` 或
`reproducibility_error`。

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

- `run/<case>/serial.log`
- `run/<case>/stderr.log`
- `run/<case>/result.json`
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

平台通过 sandbox runner 中的 authenticated `vos` 与 OS 项目交互。推荐由
runner 启动单项目绑定的 `vos serve`，再通过命令 RPC 创建 run；也可以在
同一 auth / policy gate 下直接调用 CLI。典型命令包括：

```text
git checkout <commit_sha>
vos serve --portal-url <url> --project-id <project_id>
vos build generate
vos spec lint
vos arch lint
vos build
vos run qemu
vos verify public --stage <stage>
```

平台不直接替代 `vos` 做本地解析、ToolchainSpec 消费、QEMU 编排、Agent
工具执行或 patch gate。hidden / staff-only 规则只作为 policy snapshot 或
runner 输入参与裁决，不进入学生 repo、本地学生 Agent 或 Portal 前端可见输出。

## 11. 后续扩展点

- 并行测试分片
- 验证缓存
- 风险驱动的自适应测试矩阵
