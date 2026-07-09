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

## 2a. 设计决策引导

### 决策 1：时钟 Tick 粒度

| Tick 间隔 | 上下文切换开销 | 交互响应性 | 适合 |
|:--------:|:----------:|:--------:|------|
| 1 ms (1000 Hz) | 高（1% CPU 被调度器吃掉） | 极好 | 桌面/实时系统 |
| 10 ms (100 Hz) | 低（0.1%） | 良好 | 教学 OS 首选 |
| 100 ms (10 Hz) | 极低 | 差（按键延迟可感知） | 批处理/不推荐 |

**零基础建议**：选 10 ms。它是 Linux 2.4 时代的默认值（HZ=100），足够简单，响应性在教学场景中完全够用。

### 决策 2：设备发现方式

两种方案的关键差异不在于"谁更正确"——而在于"你的内核启动时怎么知道 UART 和定时器在哪里"。

| 方案 | 启动依赖 | 可移植性 | 调试难度 |
|------|:------:|:------:|:------:|
| 硬编码 MMIO 地址 | 无 | 差 | 低——地址写死在代码里 |
| DTB 解析 | 需要 DTB 地址（OpenSBI 通过 `a1` 传递） | 好 | 中——DTB 解析器本身可能引入 bug |

**零基础建议**：硬编码。RISC-V `virt` 机器的 UART0 在 `0x10000000`，PLIC 在 `0x0C000000`，CLINT 在 `0x02000000`。把这三地址写在 `platform.h` 里集中管理。阶段 9 要做硬件移植时再统一替换为 DTB 解析。

## 2b. 逐步操作指引

### 步骤 1：使能和配置 PLIC + 时钟中断（预计 45 分钟）

```c
// PLIC 初始化（RISC-V virt）
#define PLIC_BASE      0x0C000000L
#define PLIC_PRIORITY  0x0000    // 中断优先级寄存器偏移
#define PLIC_ENABLE    0x2000    // 中断使能（per-context）
#define PLIC_THRESHOLD 0x200000  // 优先级阈值（per-context）
#define PLIC_CLAIM     0x200004  // Claim/Complete（per-context）

#define UART0_IRQ      10

static void plic_init(void) {
    // 1. 设置 UART0 中断优先级（非零即可使能）
    uint32_t *prio = (uint32_t *)(PLIC_BASE + PLIC_PRIORITY + UART0_IRQ * 4);
    *prio = 1;
    
    // 2. 为 HART 0 的 S-mode context 使能 UART0 中断
    uint32_t *en = (uint32_t *)(PLIC_BASE + PLIC_ENABLE);
    *en = (1 << UART0_IRQ);
    
    // 3. 设置 HART 0 S-mode 的优先级阈值为 0（接受所有优先级的中断）
    uint32_t *thr = (uint32_t *)(PLIC_BASE + PLIC_THRESHOLD);
    *thr = 0;
}

// 时钟中断初始化
static void timer_init(void) {
    // 设置第一个定时器中断在 10ms 后
    uint64_t next = r_mtime() + (10000000UL);  // 10ms at 1GHz clock
    w_mtimecmp(next);  // SBI call: sbi_set_timer(next)
    
    // 使能 S-mode 时钟中断
    w_sie(r_sie() | SIE_STIE);
}
```

**自检点**：10 秒内 tick 计数应为 1000（如果 tick=10ms）。

## 常见错误与排查（开发中参考）

### 错误 1：时钟中断不触发
- 检查 `sie.STIE` = 1, `sstatus.SIE` = 1
- 检查 `mtimecmp` 的值 > `mtime`（如果 mtimecmp < mtime，中断永远不触发）

### 错误 2：PLIC claim 返回 0
这不是错误——说明当前没有待处理的中断。在多核环境下尤其常见（另一个 HART 已经 claim 了）。

### 错误 3：UART 接收中断触发但读不到数据
先读 `UART_LSR` 检查 DR (Data Ready) 位。如果 DR=0，可能是 UART 的 FIFO 被误配置或其他 bug 导致虚假中断。

### 错误 4：中断返回后内核栈被破坏
中断 handler 中使用了过大的局部变量（如大数组），导致栈溢出。中断上下文的内核栈和进程上下文共享同一个栈——栈溢出会破坏进程上下文的数据。

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
