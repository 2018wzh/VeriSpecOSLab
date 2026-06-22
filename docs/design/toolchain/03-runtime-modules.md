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
    vos-agent-session/
    vos-server/
  apps/
    vos-agent/
    vos-portal/（prototype: vos-web）
```

命名约定：

- `packages/*` 放可复用 runtime、CLI、policy、evidence、agent-session、server façade 和其他共享逻辑。
- `apps/vos-agent` 放本地 LLM runner、TUI、headless API 和本地 OpenAI-compatible façade。
- `apps/vos-portal`（当前原型为 `apps/vos-web`）/ Portal 前端只做平台展示与控制面，不放 workspace runtime 逻辑。

### `vos-server`

责任：

- 提供 `vos serve` 的 HTTP 入口：作业执行、SSE 订阅、manifest/events 查询与 QA 回调
- 统一 CLI command execution context，转发到 `vos-cli` 调度层
- 保持与 `vos-agent` / portal 预期一致的 request/response 契约

主要输入 / 输出：

- 输入：`commandId`、HTTP 参数、token 与请求体
- 输出：命令结果、SSE stream、run 信息

核心类型：

- `VosHttpRun`
- `VosCommandExecutionContext`
- `VosCommandResult`

## 2. 模块职责

### `vos-cli`

责任：

- 解析 `vos` 子命令与参数
- 提供 `vos login` / `logout` / `whoami` 的 Portal 身份入口
- 提供 `vos serve` 命令入口，委托 HTTP façade 到 `vos-server`
- 调用对应 runtime / agent-core 接口
- 对本地 CLI 与 HTTP run 执行同一 auth / policy gate
- 控制文本输出与 `--json` 输出
- 为课程命令统一传递 `--project-root`、`--agent-session` 等上下文

主要输入 / 输出：

- 输入：CLI args 或 HTTP command RPC
- 输出：stdout/stderr、退出码、稳定 JSON、SSE progress events

核心类型：

- `CliCommand`
- `OutputMode`
- `VosHttpRun`
- `AuthSession`

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
- 合并 Portal policy snapshot 与本地 `.vos/policy.yaml`，其中本地 policy 只能收窄权限

主要输入 / 输出：

- 输入：调用上下文、Portal token 校验结果、角色、路径、stage、visibility scope
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

### `vos-agent-session`

责任：

- 解析 `AgentIdentity` 与其唯一绑定的 `CapabilityPack`
- 构造 `agent_session`、上下文引用与 policy snapshot
- 调用 `apps/vos-agent` 的 headless runner 或共享 runner API
- 校验模型返回的结构化输出
- 写入 `AICollaborationLog` 与 evidence
- 通过 authenticated `vos-cli` / `vos serve` 路径执行 repo 工具

主要输入 / 输出：

- 输入：spec、logs、policy、patch、stage、recent evidence
- 输出：context ref、agent session record、changed targets、diagnostic summary、audit record

核心接口：

- `ContextAssembler`
- `AgentSessionResolver`
- `AgentRunnerClient`
- `PatchGate`
- `AgentAuditWriter`

## 3. 固定依赖方向

必须保证：

- `vos-cli` 可以依赖所有 package，但 package 不反向依赖 `vos-cli`
- `vos-runtime` 不依赖 `apps/vos-agent`
- `vos-adapter` 消费 `ToolchainSpec`，不反向依赖 Spec authoring 文档
- `vos-evidence` 不反向依赖 `vos-agent-session`
- `vos-policy` 不依赖具体 adapter 实现
- `apps/vos-agent` 可以复用 `vos-agent-session`，但不能绕过 `vos-policy` 和 `vos-evidence`
- `apps/vos-agent` 不是 Portal 后端；Portal / platform API 是独立控制面

推荐依赖图：

```text
vos-cli
  -> vos-core
  -> vos-spec
  -> vos-policy
  -> vos-evidence
  -> vos-runtime
  -> vos-adapter
  -> vos-agent-session
  -> vos-server

vos-agent-session
  -> vos-core
  -> vos-spec
  -> vos-policy
  -> vos-evidence
  -> vos-runtime

vos-server
  -> vos-core
  -> vos-policy
  -> vos-evidence

apps/vos-agent
  -> vos-agent-session
  -> vos-core

apps/vos-portal（当前原型实现为 vos-web）
  -> vos-core
```

## 4. 模块 ownership 建议

- `vos-spec`：规格与语义检查
- `vos-runtime` / `vos-adapter`：命令执行编排
- `vos-evidence` / `vos-policy`：证据、审计与安全边界
- `vos-server`：`vos serve` HTTP façade、run 生命周期与 SSE/查询转发
- `vos-agent-session` / `apps/vos-agent`：本地 Agent identity resolution、capability packs 与 LLM runner
- `apps/vos-portal`（当前原型实现为 `apps/vos-web`）：课程平台前端，只消费平台 API 与 `vos` 结构化产物

## 相关文档

- [04-data-model.md](./04-data-model.md)
- [05-runtime-and-concurrency.md](./05-runtime-and-concurrency.md)
- [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)
- [../agent/README.md](../agent/README.md)
