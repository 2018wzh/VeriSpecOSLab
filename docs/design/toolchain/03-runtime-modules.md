# 03 Runtime Modules

回答的问题：

- TypeScript 实现应该拆成哪些 package / module
- 每个模块的责任、输入输出和边界是什么
- 依赖方向如何固定，避免未来耦合失控

上游依赖文档：

- [02-architecture.md](./02-architecture.md)
- [../spec/05-toolchain-spec.md](../spec/05-toolchain-spec.md)

下游消费者：

- 实现 `vos` 的 TypeScript workspace
- package 边界设计
- code review 与模块 ownership 划分

## 1. Workspace 划分

目标实现使用 Bun / TypeScript workspace，最少包含以下 package：

```text
vos/
  packages/
    vos-core/
    vos-spec/
    vos-policy/
    vos-evidence/
    vos-runtime/
    vos-adapter/
    vos-agent-core/
    vos-cli/
  apps/
    vos-agent/
    vos-web/
```

命名约定：

- `packages/*` 放可复用 runtime、CLI、policy、evidence 和 agent 编排逻辑。
- `apps/vos-agent` 放 LLM runner、TUI、OpenAI-compatible façade 与 Portal API 后端。
- `apps/vos-web` 放 Portal 前端。

## 2. 模块职责

### `vos-cli`

责任：

- 解析 `vos` 子命令与参数
- 调用对应 runtime / agent-core 接口
- 控制文本输出与 `--json` 输出
- 为课程命令统一传递 `--project-root`、`--agent-session` 等上下文

主要输入 / 输出：

- 输入：CLI args
- 输出：stdout/stderr、退出码、稳定 JSON

核心类型：

- `CliCommand`
- `OutputMode`

### `vos-core`

责任：

- 定义跨 package 共用的核心类型与错误模型

主要输入 / 输出：

- 输入：无
- 输出：共享类型

核心类型：

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

核心接口：

- `SpecParser`
- `SpecNormalizer`
- `ConsistencyChecker`

### `vos-policy`

责任：

- 执行命令白名单、路径白名单、可见性与阶段限制
- 为 `vos agent` wrapper 决定哪些工具和上下文可以暴露给模型

主要输入 / 输出：

- 输入：调用上下文、角色、路径、stage、visibility scope
- 输出：allow / deny verdict、policy snapshot

核心接口：

- `PolicyEngine`
- `VisibilityScope`
- `ToolPolicy`

### `vos-evidence`

责任：

- 归档 manifest、events、日志、artifact 与 evidence 索引

主要输入 / 输出：

- 输入：`RunEvent`、命令结果、产物文件
- 输出：`RunManifest`、`events.jsonl`、`evidence.json`

核心接口：

- `EvidenceWriter`
- `ManifestBuilder`
- `EventLogWriter`

### `vos-runtime`

责任：

- 构建并执行 `ExecutionPlan`
- 负责子进程调度、超时、取消、资源互斥
- 将 build / run / test / verify / debug 统一为结构化结果

主要输入 / 输出：

- 输入：执行计划、adapter 选择结果、policy snapshot
- 输出：`RunEvent`、`CommandOutcome`

核心接口：

- `VosCommand`
- `ExecutionEngine`
- `ExecutionNode`

### `vos-adapter`

责任：

- 将 `ToolchainSpec` 解析为可执行 build / run / test / debug / trace 计划
- 连接 Makefile、QEMU、公开测试 harness 等外部工具

主要输入 / 输出：

- 输入：`ToolchainSpec`、命令参数、workspace 状态
- 输出：adapter-ready 子进程配置

核心接口：

- `BuildAdapter`
- `RunAdapter`
- `TestAdapter`
- `DebugAdapter`
- `TraceAdapter`

### `vos-agent-core`

责任：

- 实现 `agent context / plan / generate / apply-patch / debug / log` 的确定性编排
- 构造 `ContextBundle`、`PromptEnvelope` 与 fixed prompt 输入
- 调用 `apps/vos-agent` 的 headless runner 或共享 runner API
- 校验模型返回的结构化输出
- 写入 `AICollaborationLog` 与 evidence

主要输入 / 输出：

- 输入：spec、logs、policy、patch、stage、recent evidence
- 输出：`ContextBundle`、`PlanDraft`、patch proposal、`DiagnosticReport` 增强、audit record

核心接口：

- `ContextAssembler`
- `PromptEnvelopeBuilder`
- `AgentRunnerClient`
- `PatchGate`
- `AgentAuditWriter`

## 3. 固定依赖方向

必须保证：

- `vos-cli` 可以依赖所有 package，但 package 不反向依赖 `vos-cli`
- `vos-runtime` 不依赖 `apps/vos-agent`
- `vos-adapter` 消费 `ToolchainSpec`，不反向依赖 Spec authoring 文档
- `vos-evidence` 不反向依赖 `vos-agent-core`
- `vos-policy` 不依赖具体 adapter 实现
- `apps/vos-agent` 可以复用 `vos-agent-core`，但不能绕过 `vos-policy` 和 `vos-evidence`

推荐依赖图：

```text
vos-cli
  -> vos-core
  -> vos-spec
  -> vos-policy
  -> vos-evidence
  -> vos-runtime
  -> vos-adapter
  -> vos-agent-core

vos-agent-core
  -> vos-core
  -> vos-spec
  -> vos-policy
  -> vos-evidence
  -> vos-runtime

apps/vos-agent
  -> vos-agent-core
  -> vos-core

apps/vos-web
  -> vos-core
```

## 4. 模块 ownership 建议

- `vos-spec`：规格与语义检查
- `vos-runtime` / `vos-adapter`：命令执行编排
- `vos-evidence` / `vos-policy`：证据、审计与安全边界
- `vos-agent-core` / `apps/vos-agent`：Agent wrapper、LLM runner 与固定 prompt contract
- `apps/vos-web`：课程平台前端

## 相关文档

- [04-data-model.md](./04-data-model.md)
- [05-runtime-and-concurrency.md](./05-runtime-and-concurrency.md)
- [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)
- [../agent/10-typescript-cli-wrapper.md](../agent/10-typescript-cli-wrapper.md)
