# 05 Runtime And Concurrency

回答的问题：

- Bun / TypeScript 下 `VOS Runtime` 应如何执行命令与采集日志
- 哪些步骤必须串行，哪些可以并发
- 超时、取消、资源互斥如何统一处理

上游依赖文档：

- [03-runtime-modules.md](./03-runtime-modules.md)
- [04-data-model.md](./04-data-model.md)

下游消费者：

- `vos-runtime`
- `vos-runtime`
- `vos-core` evidence

## 1. 执行模型

所有可执行命令实现统一的异步接口：

```ts
interface VosCommand {
  plan(input: CommandInput): Promise<ExecutionPlan>;
  run(plan: ExecutionPlan, ctx: RunContext): Promise<CommandOutcome>;
}
```

`vos-cli` 负责解析命令，`vos-runtime` 负责：

- 从高层命令生成 `ExecutionPlan`
- 逐节点调度 `ExecutionNode`
- 向 evidence 层发送 `RunEvent`
- 在所有出口上返回稳定 JSON 或结构化错误

## 2. 子进程执行

底层命令统一通过 Bun / Node 兼容的子进程封装启动。优先使用
`Bun.spawn`；如某些测试或平台需要 Node API，可在 adapter 内封装
`node:child_process`，但对外仍返回同一 `CommandOutcome`。

要求：

- stdout / stderr 分开异步读取
- 按行写入终端输出和 artifact 文件
- 每个子进程都绑定 timeout
- 退出码、信号、超时、取消都要归一化为 `CommandOutcome`
- 子进程环境必须来自 `ToolchainSpec`、project config 与受控 allowlist

## 3. 事件流

`vos-runtime` 使用 TypeScript 事件分发器广播执行过程。实现可以是
`EventTarget`、async iterator 或轻量 emitter，但必须提供两个消费面：

- evidence writer：可靠接收完整 `RunEvent` 序列并写入 `events.jsonl`
- CLI / Agent / Portal：订阅公开事件，用于展示进度或诊断

`RunEvent` 至少包括：

- `run_started`
- `node_started`
- `stdout_line`
- `stderr_line`
- `node_finished`
- `run_finished`
- `run_cancelled`

事件对象必须包含 `run_id`、`node_id`、时间戳和 visibility 标记，避免
student-facing 输出泄露 staff-only 或 hidden 信息。

## 4. 并发控制

统一在 `vos-runtime` 内维护资源锁与并发队列：

- 测试并发度：可配置，默认按 suite 分类限流
- QEMU：默认独占一类资源锁
- trace：默认与同一 QEMU profile 互斥
- build：同一 workspace 默认串行，避免 artifact 竞争

资源锁推荐映射：

- `build:<workspace>`
- `qemu:<profile>`
- `trace:<profile>`
- `report:<run-id>`

实现可使用 in-process semaphore；后续如需要多进程或 CI worker 协调，再扩展为 `.vos/locks/` 文件锁或平台锁服务。无论实现形态如何，锁行为必须进入 `events.jsonl`，便于解释排队和超时。

## 5. 取消与超时

统一使用 `AbortController` / `AbortSignal` 传播取消：

- CLI `ctrl-c`
- 上层 Agent 取消
- 超时触发
- 平台中止

取消语义：

- 未启动节点：标记 skipped
- 已启动节点：先发送 graceful terminate，再在超时后强制 kill
- `vos-core` evidence 必须照常写出 `manifest.json`，状态记为 cancelled 或 timed_out

所有 timeout 都应在 `ExecutionNode` 或 adapter profile 中可追溯，不能隐藏在 prompt 或任意脚本里。

## 6. 串行与并行规则

必须串行：

- `spec normalize -> spec consistency -> patch impact`
- 同一 build 输出目录的连续 `build`
- `report generate` 对同一 `run-id` 的最终归档
- `agent apply-patch` 的 policy / spec binding / path check / apply / validation DAG

可并行：

- 独立 unit / syscall / regression suite
- 多个 log / trace 的只读分析
- 不共享资源的公开测试派生

需互斥：

- 共享 QEMU profile 的运行
- 会覆盖同一 serial log 的执行
- 会写入同一镜像输出路径的构建

## 7. 错误归一化

所有执行节点失败必须落到统一分类：

- `SpecError`
- `PlanningError`
- `BuildError`
- `RunError`
- `TestError`
- `TimeoutError`
- `CancelledError`
- `PolicyError`
- `AgentOutputError`

`AgentOutputError` 只表示 Agent 身份输出不满足声明的 output contract 或结构化校验失败；它不能被当作 policy 通过，也不能替代写入、验证和审计的确定性 gate。

## 相关文档

- [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)
- [08-evidence-reporting-and-ci.md](./08-evidence-reporting-and-ci.md)
- [09-roadmap-and-acceptance.md](./09-roadmap-and-acceptance.md)
- [../agent/README.md](../agent/README.md)
