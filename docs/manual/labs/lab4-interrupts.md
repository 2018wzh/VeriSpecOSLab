# Lab 4: 中断与设备驱动 — 响应外部世界

## 1. 设计问题

中断如何从硬件路由到你的处理代码？时钟中断如何周期性触发？设备如何通过中断驱动方式工作？中断上下文和进程上下文如何协调？

## 2. 设计空间

| 决策 | 你需要回答的问题 |
|------|----------------|
| 中断路由 | 使用什么中断控制器（PLIC）？中断向量如何设置？ |
| 时钟 Tick | Tick 间隔多大？每个 tick 做什么？ |
| 设备发现 | DTB 解析还是硬编码？你的选择的理由？ |
| 驱动注册模型 | 设备驱动如何向内核注册？中断处理程序如何绑定到 IRQ？ |
| 中断/进程上下文 | 哪些数据被中断上下文访问？锁策略是什么？ |
| 多核中断 | 每个 HART 的 trap 入口如何设置？IPI（CPU 间中断）如何实现？哪些中断路由到哪个 HART？ |

## 3. 背景阅读

- [附录：RISC-V 参考](../appendices/riscv-reference.md)（中断与 CSR 部分）
- [Spec: ConcurrencySpec 编写指南](../specs/concurrency-spec.md)（中断上下文的并发规则）
- 你目标平台的设备树文档或 QEMU `virt` 机器手册

## 4. 规格要求

### 4.1 ArchitectureSlice(interrupt)（必做）

创建 `spec/architecture/slices/03-interrupt.yaml`

### 4.2 ModuleSpec（必做）

- `spec/modules/interrupt/module.yaml`：中断子系统
- `spec/modules/device/uart/module.yaml`：UART 驱动（中断驱动）
- `spec/modules/device/timer/module.yaml`：时钟中断
- `spec/modules/interrupt/concurrency.yaml`：中断上下文的并发规则

### 4.3 ADR（必做，至少 1 个）

建议：设备发现方式的选择（DTB vs 硬编码）及其 tradeoff 分析。

### 4.4 OperationContract（必做）

至少为以下操作编写契约：
- PLIC 初始化和中断 claim/complete
- 时钟中断 handler
- UART 中断 handler（接收和发送）
- 中断处理程序注册

## 5. 质量门禁

### 测试门禁

```bash
vos spec lint
vos build
vos test --suite interrupt
vos verify public
```

### 功能门禁

- [ ] 时钟中断周期性触发，系统计数器递增
- [ ] UART 可通过中断驱动方式接收和发送数据
- [ ] 中断处理程序被正确分发给对应的 IRQ
- [ ] 每个 HART 能接收自己的时钟中断（多核）
- [ ] IPI（CPU 间中断）能正确触发目标 HART 的处理（多核）

### 稳定性门禁

- [ ] 在高频率中断下（如持续串口输入）系统不崩溃
- [ ] 中断处理完成后内核可继续正常执行

## 6. 设计理据要求

1. 你的 tick 粒度选择如何影响后续的调度器设计？
2. 你的设备发现方式（DTB vs 硬编码）的选择理由是什么？如果你要移植到另一种机器型号，需要改动什么？
3. 你的中断上下文和进程上下文的锁策略是什么？有没有可能出现死锁？

## 7. AI 使用边界

**允许**：
- 让 AI 帮助解析设备树结构
- 让 AI 解释中断相关的 CSR 配置
- 让 AI 生成中断 handler 框架（需有对应的 Spec）

**禁止**：
- 在没有 ConcurrencySpec 的情况下让 AI 生成涉及锁的中断处理代码

## 8. 提交物

- ArchitectureSlice(interrupt)
- 中断子系统和设备驱动的 ModuleSpec + OperationContract
- ConcurrencySpec（中断上下文规则）
- ADR（设备发现方式）
- 实现源码
- 中断处理验证日志

（进阶方向：实现 tickless 内核——只在需要时设置定时器；编写通用 DTB 解析模块支持设备节点遍历；追踪每个 IRQ 的触发频率以建立中断负载统计。）
