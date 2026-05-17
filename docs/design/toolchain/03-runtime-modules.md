# 03 Runtime Modules

回答的问题：

- Rust + Tokio 实现应该拆成哪些 crate / module
- 每个模块的责任、输入输出和边界是什么
- 依赖方向如何固定，避免未来耦合失控

上游依赖文档：

- [02-architecture.md](./02-architecture.md)
- [../spec/05-toolchain-spec.md](../spec/05-toolchain-spec.md)

下游消费者：

- 实现 `vos` 的 Rust 工程
- crate workspace 设计
- code review 与模块 ownership 划分

## 1. Workspace 划分

建议使用 Cargo workspace，最少包含以下 crate：

- `vos-cli`
- `vos-core`
- `vos-spec`
- `vos-arch`
- `vos-patch`
- `vos-runtime`
- `vos-adapter`
- `vos-evidence`
- `vos-agent`
- `vos-policy`

## 2. 模块职责

### `vos-cli`

责任：

- 解析子命令与参数
- 调用对应 runtime 接口
- 控制文本输出与 `--json` 输出

主要输入 / 输出：

- 输入：CLI args
- 输出：stdout/stderr、退出码

核心类型 / trait：

- `CliCommand`
- `OutputMode`

### `vos-core`

责任：

- 定义跨 crate 共用的核心类型与错误模型

主要输入 / 输出：

- 输入：无
- 输出：共享类型

核心类型 / trait：

- `RunId`
- `SpecId`
- `PatchId`
- `StageId`
- `EvidenceRef`
- `CommandOutcome`
- `VosError`

### `vos-spec`

责任：

- 解析、校验并规范化 `spec/`

主要输入 / 输出：

- 输入：YAML 文本、spec 根目录
- 输出：`NormalizedSpecBundle`

核心类型 / trait：

- `SpecParser`
- `SpecNormalizer`
- `ConsistencyChecker`

### `vos-arch`

责任：

- 架构 lint、compose、test derivation、stage gating

主要输入 / 输出：

- 输入：架构 spec、normalized bundle
- 输出：架构 diagnostics、公开 test matrix

核心类型 / trait：

- `ArchitectureComposer`
- `TestDeriver`

### `vos-patch`

责任：

- 处理 `SpecPatch` DAG 与影响分析

主要输入 / 输出：

- 输入：patch 文件、normalized bundle
- 输出：`PatchImpactReport`

核心类型 / trait：

- `PatchGraph`
- `ImpactAnalyzer`

### `vos-runtime`

责任：

- 构建并执行 `ExecutionPlan`
- 负责子进程调度、超时、取消、资源互斥

主要输入 / 输出：

- 输入：执行计划、adapter 选择结果
- 输出：`RunEvent`、`CommandOutcome`

核心类型 / trait：

- `VosCommand`
- `ExecutionEngine`
- `ExecutionNode`

### `vos-adapter`

责任：

- 将 `ToolchainSpec` 解析为可执行 build / run / test / debug / trace 计划

主要输入 / 输出：

- 输入：`ToolchainSpec`、命令参数、workspace 状态
- 输出：adapter-ready 子进程配置

核心类型 / trait：

- `BuildAdapter`
- `RunAdapter`
- `TestAdapter`
- `DebugAdapter`
- `TraceAdapter`

### `vos-evidence`

责任：

- 归档 manifest、日志、artifact 与 evidence 索引

主要输入 / 输出：

- 输入：`RunEvent`、结果文件
- 输出：`RunManifest`、`evidence.json`

核心类型 / trait：

- `EvidenceWriter`
- `ManifestBuilder`

### `vos-agent`

责任：

- 实现 `agent context / plan / apply-patch / serve / log`

主要输入 / 输出：

- 输入：spec、logs、policy、patch
- 输出：`ContextBundle`、`PlanDraft`

核心类型 / trait：

- `ContextAssembler`
- `PatchApplier`
- `AgentGateway`

### `vos-policy`

责任：

- 执行命令白名单、路径白名单、可见性与阶段限制

主要输入 / 输出：

- 输入：调用上下文、角色、路径
- 输出：allow / deny verdict

核心类型 / trait：

- `PolicyEngine`
- `VisibilityScope`

## 3. 固定依赖方向

必须保证：

- `vos-cli -> *`
- `vos-runtime` 不依赖 `vos-cli`
- `vos-adapter` 消费 `ToolchainSpec`，不反向依赖 Spec authoring 文档
- `vos-evidence` 不反向依赖 `vos-agent`
- `vos-policy` 不依赖具体 adapter 实现

推荐依赖图：

```text
vos-cli
  -> vos-core
  -> vos-spec
  -> vos-arch
  -> vos-patch
  -> vos-runtime
  -> vos-adapter
  -> vos-evidence
  -> vos-agent
  -> vos-policy
```

## 4. 模块 ownership 建议

- `vos-spec` / `vos-arch`：规格与语义检查
- `vos-runtime` / `vos-adapter`：命令执行编排
- `vos-evidence` / `vos-agent` / `vos-policy`：证据、协作与安全边界

## 相关文档

- [04-data-model.md](./04-data-model.md)
- [05-runtime-and-concurrency.md](./05-runtime-and-concurrency.md)
- [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)
