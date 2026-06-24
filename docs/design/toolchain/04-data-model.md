# 04 Data Model

回答的问题：

- `vos` 内部需要哪些稳定 JSON / TypeScript 数据结构
- 各结构的字段语义、来源和消费者是什么
- `.vos/` 目录如何映射到这些结构

上游依赖文档：

- [02-architecture.md](./02-architecture.md)
- [03-runtime-modules.md](./03-runtime-modules.md)

下游消费者：

- `vos-core`
- `vos-spec`
- `vos-core` policy
- `vos-runtime`
- `vos-runtime`
- `vos-core` evidence
- `vos-core agent session`

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

- 描述某个 commit-backed `SpecPatch` 或代码 patch 会影响哪些 spec、哪些测试与哪些验证

字段：

- `patch_id`
- `commit_sha`
- `parent_sha`
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
- `spec patch apply`

`spec patch apply` 会把 `PatchImpactReport` 写入：

```text
.vos/cache/patches/<patch_id>/impact.json
.vos/cache/patches/<patch_id>/verification-plan.json
.vos/cache/patches/<patch_id>/status.json
```

验证通过后才更新：

```text
.vos/cache/patches/applied.json
```

`applied.json` 至少记录 `patch_id`、`commit_sha`、`parent_sha`、
`spec_commit_sha`、`impact_ref` 与 `verification_ref`。验证失败只更新
`status.json` 和 run evidence，不得把失败 patch 标记为已应用。

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

- `vos-core` evidence

消费者：

- `report generate`
- `debug explain-log`
- 平台审计

`verify-behavior` 是 generated/fuzz 验证过程产生的行为测试 evidence
artifact。它记录 TestPlan、临时 patch、case stdout/stderr 与 oracle result，
用于 DebugAgent 解释失败路径；verify runtime 本身不输出 trace 字段，也不把
trace 作为 suite 映射。

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

## 6. `AgentSession`

用途：

- 记录一次 Agent 身份、能力包、上下文和策略快照的绑定

字段：

- `agent_identity_id`
- `role_prompt_id`
- `capability_pack_id`
- `user_persona`
- `visibility_scope`
- `context_ref`
- `policy_snapshot_ref`
- `required_evidence`

来源：

- `vos-core agent session`

消费者：

- `agent context`
- `agent serve`

## 7. `AgentTaskRecord`

用途：

- 表示 Agent 的任务输出、写入目标和验证要求

字段：

- `task`
- `related_specs`
- `changed_targets`
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
    patches/
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
- `cache/projections/`：本地 student / agent / staff 投影缓存；云端投影可覆盖但不能成为离线运行前提
- `cache/patches/`：SpecPatch impact、verification plan、status 与 applied state
- `runs/<run-id>/manifest.json`：`RunManifest`
- `runs/<run-id>/events.jsonl`：逐事件日志
- `index/evidence.json`：跨 run evidence 索引
- `locks/`：QEMU、trace、build 等互斥资源锁

## 相关文档

- [05-runtime-and-concurrency.md](./05-runtime-and-concurrency.md)
- [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)
- [07-agent-gateway.md](./07-agent-gateway.md)
