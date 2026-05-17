# 04 Data Model

回答的问题：

- `vos` 内部需要哪些稳定 JSON / Rust 数据结构
- 各结构的字段语义、来源和消费者是什么
- `.vos/` 目录如何映射到这些结构

上游依赖文档：

- [02-architecture.md](./02-architecture.md)
- [03-runtime-modules.md](./03-runtime-modules.md)

下游消费者：

- `vos-core`
- `vos-spec`
- `vos-patch`
- `vos-runtime`
- `vos-evidence`
- `vos-agent`

## 1. `NormalizedSpecBundle`

用途：

- 作为 `spec lint`、`arch derive-tests`、`verify patch` 等命令的统一输入

字段：

- `modules`: 规范化后的模块规格集合
- `operations`: 规范化后的操作级规格集合
- `architecture`: 架构规格摘要
- `toolchain_profiles`: 从 `spec/toolchain/` 读取的 profile 集合
- `hashes`: 每份源 spec 的内容 hash
- `visibility`: public / agent-only / platform-only 标记

来源：

- `vos-spec`

消费者：

- `vos-arch`
- `vos-patch`
- `vos-agent`

## 2. `PatchImpactReport`

用途：

- 描述某个 `SpecPatch` 或代码 patch 会影响哪些 spec、哪些测试与哪些验证

字段：

- `patch_id`
- `affected_specs`
- `affected_code_paths`
- `required_checks`
- `selected_tests`
- `requires_cloud_projection_refresh`

来源：

- `vos-patch`

消费者：

- `verify patch`
- `agent apply-patch`

## 3. `ExecutionPlan`

用途：

- 将一次高层命令展开成可执行 DAG

字段：

- `plan_id`
- `command_name`
- `nodes`
- `artifacts_root`
- `concurrency_profile`

`nodes` 中每个 `ExecutionNode` 至少包含：

- `node_id`
- `kind`
- `adapter`
- `inputs`
- `timeout`
- `depends_on`
- `resource_locks`

来源：

- `vos-arch`
- `vos-patch`
- `vos-runtime`

消费者：

- `vos-runtime`

## 4. `RunManifest`

用途：

- 描述一次 `vos` 执行的完整审计快照

字段：

- `run_id`
- `command`
- `arguments`
- `git_rev`
- `spec_hash`
- `projection_version`
- `started_at`
- `finished_at`
- `status`
- `artifacts`
- `evidence_refs`

来源：

- `vos-evidence`

消费者：

- `report generate`
- `debug explain-log`
- 平台审计

## 5. `DiagnosticReport`

用途：

- 将日志、trace 和失败结果映射回 spec 与下一步命令

字段：

- `kind`
- `summary`
- `phase`
- `related_specs`
- `evidence_refs`
- `suggested_next_commands`

来源：

- `vos debug explain-log`

消费者：

- 学生 CLI
- `vos-agent`

## 6. `ContextBundle`

用途：

- 为 Agent 暴露受控上下文，而不是整个仓库快照

字段：

- `requested_scope`
- `resolved_specs`
- `recent_evidence`
- `allowed_paths`
- `recommended_commands`
- `visibility_scope`

来源：

- `vos-agent`

消费者：

- `agent context`
- `agent serve`

## 7. `PlanDraft`

用途：

- 表示 Agent 的非执行性计划输出

字段：

- `task`
- `related_specs`
- `suspected_files`
- `required_validations`
- `notes`

来源：

- `vos-agent`

消费者：

- `agent plan`

## 8. `.vos/` 目录模型

```text
.vos/
  project.yaml
  policy.yaml
  cache/
    normalized/
    projections/
  runs/
    <run-id>/
      manifest.json
      events.jsonl
      artifacts/
  index/
    evidence.json
  locks/
```

字段约定：

- `project.yaml`：项目 id、profile、spec root、cloud course
- `policy.yaml`：角色权限、可见性与路径限制
- `cache/normalized/`：`NormalizedSpecBundle` 与局部 normalize 结果
- `cache/projections/`：云端公开约束投影缓存
- `runs/<run-id>/manifest.json`：`RunManifest`
- `runs/<run-id>/events.jsonl`：逐事件日志
- `index/evidence.json`：跨 run evidence 索引
- `locks/`：QEMU、trace、build 等互斥资源锁

## 相关文档

- [05-runtime-and-concurrency.md](./05-runtime-and-concurrency.md)
- [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)
- [07-agent-gateway.md](./07-agent-gateway.md)
