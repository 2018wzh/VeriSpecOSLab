# 05 Runtime And Concurrency

回答的问题：

- Rust + Tokio 下 `VOS Runtime` 应如何执行命令与采集日志
- 哪些步骤必须串行，哪些可以并发
- 超时、取消、资源互斥如何统一处理

上游依赖文档：

- [03-runtime-modules.md](./03-runtime-modules.md)
- [04-data-model.md](./04-data-model.md)

下游消费者：

- `vos-runtime`
- `vos-adapter`
- `vos-evidence`

## 1. 执行模型

所有可执行命令实现统一的异步接口：

```text
async trait VosCommand {
  async fn plan(...) -> ExecutionPlan;
  async fn run(...) -> CommandOutcome;
}
```

`vos-cli` 负责解析命令，`vos-runtime` 负责：

- 从高层命令生成 `ExecutionPlan`
- 逐节点调度 `ExecutionNode`
- 向 evidence 层发送 `RunEvent`

## 2. 子进程执行

底层命令统一通过：

- `tokio::process::Command`

启动。要求：

- stdout / stderr 分开异步读取
- 按行写入终端输出和 artifact 文件
- 每个子进程都绑定 timeout
- 退出码、信号、超时、取消都要归一化为 `CommandOutcome`

## 3. 事件流

`vos-runtime` 使用事件总线广播执行过程：

- `mpsc`：点对点发送执行结果给 evidence writer
- `broadcast`：向 CLI UI、日志流、调试订阅者发送 `RunEvent`

`RunEvent` 至少包括：

- `run_started`
- `node_started`
- `stdout_line`
- `stderr_line`
- `node_finished`
- `run_finished`
- `run_cancelled`

## 4. 并发控制

统一使用 Tokio `Semaphore` 控制并发度：

- 测试并发度：可配置，默认按 suite 分类限流
- QEMU：默认独占一类资源锁
- trace：默认与同一 QEMU profile 互斥
- build：同一 workspace 默认串行，避免 artifact 竞争

资源锁推荐映射：

- `build:<workspace>`
- `qemu:<profile>`
- `trace:<profile>`
- `report:<run-id>`

## 5. 取消与超时

统一使用：

- `CancellationToken`

处理：

- CLI `ctrl-c`
- 上层 Agent 取消
- 超时触发
- 平台中止

取消语义：

- 未启动节点：标记 skipped
- 已启动节点：先发送 graceful terminate，再在超时后强制 kill
- `vos-evidence` 必须照常写出 `manifest.json`，状态记为 cancelled 或 timed_out

## 6. 串行与并行规则

必须串行：

- `spec normalize -> spec consistency -> patch impact`
- 同一 build 输出目录的连续 `build`
- `report generate` 对同一 `run-id` 的最终归档

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

## 相关文档

- [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)
- [08-evidence-reporting-and-ci.md](./08-evidence-reporting-and-ci.md)
- [09-roadmap-and-acceptance.md](./09-roadmap-and-acceptance.md)
