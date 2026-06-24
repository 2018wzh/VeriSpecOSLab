# 03 Runtime Modules

回答的问题：

- TypeScript workspace 保留哪些 package / app
- 每个模块的责任、输入输出和边界是什么
- 依赖方向如何固定，避免重新拆出薄壳包

## 1. Workspace 划分

VOS 使用 Bun / TypeScript workspace。共享 package 只保留：

```text
vos/
  packages/
    vos-core/
    vos-runtime/
    vos-kb/
    vos-spec/
    vos-server/
  apps/
    vos-cli/
    vos-agent/
    vos-web/
```

`vos-core` policy、`vos-core` evidence、`vos-runtime` 和 `vos-core agent session` 不再作为独立 package 存在；仍有用的类型和实现分别并入 `vos-core` 或 `vos-runtime`。

## 2. Package 职责

### `vos-core`

共享执行核心。它负责命令执行编排、auth / policy gate、evidence manifest/events、progress sink、agent command glue、report / KB / spec 命令 glue，以及跨 package 的核心类型。

主要接口：

- `executeCliInvocation`
- `executeVosCommand`
- `executeCommand`
- `EvidenceWriter`
- `ProgressUpdate`
- `RunEvent`
- `CommandOutcome`

### `vos-runtime`

执行引擎与 adapter contract。它负责执行节点、资源锁、子进程执行模型，以及 build / run / test / debug / trace adapter 接口和注册表。

主要接口：

- `ExecutionEngine`
- `ExecutionNode`
- `ToolchainAdapter`
- `InMemoryAdapterRegistry`

### `vos-server`

`vos serve` 的薄 HTTP façade。它只处理 typed 路由、Zod 请求校验、OpenAPI 生成、Bearer token 内存传递、SSE、cancel、artifact 只读下载和内存 run registry；命令执行委托 `vos-core`。

HTTP API：

```http
GET  /health
GET  /api/v1/openapi.json
POST /api/v1/build/runs
POST /api/v1/verify/runs
POST /api/v1/agent/generate-runs
GET  /api/v1/runs/{run_id}
GET  /api/v1/runs/{run_id}/events
POST /api/v1/runs/{run_id}/cancel
GET  /api/v1/runs/{run_id}/manifest
GET  /api/v1/runs/{run_id}/artifacts?path=<relative-artifact-path>
```

HTTP 不接受 `command: string|string[]`。旧 `/api/v1/commands/runs` 和 `/api/v1/vos/runs` 路由不保留 alias。

### `vos-spec`

解析、校验并规范化 `spec/`，输出 `NormalizedSpecBundle`、diagnostics、patch impact 和 test matrix。

### `vos-kb`

本地 KB ingestion、sqlite-vec 检索、object manifest import/export，以及 `vos-kb` stdio MCP server。

## 3. App 职责

### `vos-cli`

只保留命令入口外壳：bin、argv/help、terminal progress rendering、JSON / pretty output、signal wiring、`vos serve` 启动。所有真实命令执行委托 `vos-core`。

### `vos-agent`

本地 LLM runner、TUI、headless API、OpenAI-compatible façade、MCP client 和 tool profile。`vos-agent` 不依赖 `vos-core`；由 `vos-core` 在需要 agent task 时调用 `vos-agent/headless`。

### `vos-web`

Portal prototype 前端，只消费平台 API 与 VOS 结构化产物，不执行 workspace runtime。

## 4. 固定依赖方向

推荐依赖图：

```text
vos-cli
  -> vos-core
  -> vos-server

vos-server
  -> vos-core

vos-core
  -> vos-runtime
  -> vos-spec
  -> vos-kb
  -> vos-agent/headless

vos-runtime
  (no VOS package dependency)

vos-agent
  (no dependency on vos-core)
```

约束：

- package 不反向依赖 `vos-cli`
- `vos-server` 保持薄 façade，不做持久队列、重试或 Portal evidence 上传
- Bearer token 只在内存中用于 Portal policy/user 查询，不写入 manifest、events、result 或 logs
- agent progress MCP 只提供 `report_progress`，不提供读取任意 run 的接口

## 相关文档

- [04-data-model.md](./04-data-model.md)
- [05-runtime-and-concurrency.md](./05-runtime-and-concurrency.md)
- [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)
- [../agent/README.md](../agent/README.md)
