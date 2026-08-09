# Lab 4：中断与设备驱动——响应外部事件

> 对应教材：[第 4 章：中断与设备](../book/ch04-interrupts.md)

本 Lab 恢复时钟、中断控制器、UART、trap 上下文和多核分发的完整训练。能收到一次中断只是起点；返回路径、可重入边界和错误证据同样属于验收范围。

## 1. 设计问题

- trap 入口保存哪些寄存器，何时切换栈，返回前恢复哪些状态？
- 时钟源、tick 粒度和调度时钟如何关联？
- 外部中断如何 claim、分发、complete，未知 IRQ 如何处理？
- 驱动采用轮询还是中断，缓冲区满/空时如何失败或等待？
- 多核下中断亲和性、锁顺序和 IPI 如何定义？

## 2. 设计空间

| 决策 | 选择 | 审查重点 |
| --- | --- | --- |
| tick | 固定周期、tickless | 精度、功耗、调度依赖 |
| 设备发现 | 固定表、设备树、ACPI | 启动复杂度、板卡适配 |
| UART | 轮询、中断、DMA | 吞吐、丢字符、并发 |
| 分发 | 静态表、注册表 | 未知 IRQ、生命周期 |
| 中断嵌套 | 禁止、受控允许 | 栈深度、锁与优先级 |

## 3. 实施顺序

1. 先完成同步 exception/trap 入口与返回，使用受控 `ecall` 或断点验证寄存器保存。
2. 配置每核定时器，记录首次触发、连续 tick 和重编程时间。
3. 配置外部中断控制器，显式记录 enable、priority、threshold、claim 与 complete。
4. 把 UART 从轮询迁移为中断驱动环形缓冲区，分别测试 RX、TX、溢出与空缓冲。
5. 多核路径增加每核计数、目标 hart 和 IPI 证据。

中断处理程序不能无限等待普通线程持有的锁。若驱动需要延迟工作，应在中断中确认设备状态并排队，把耗时处理留给可调度上下文。

### 3.1 时钟参数

先测量计数器频率，不要假设 QEMU 与板卡相同。固定 tick 需要说明频率、舍入误差和重编程公式；tickless 需要说明最近 deadline、取消和并发更新。日志记录 tick 序号即可，不要每次中断都打印整段文本造成串口反压。

### 3.2 外部中断生命周期

对 PLIC/GIC/APIC 等控制器，都要把以下阶段分开观察：

```text
device pending → source enabled → target enabled → claim/ack
→ handler → device clear → complete/EOI
```

遗漏 device clear 会形成中断风暴，遗漏 complete/EOI 会让后续中断消失。为每个阶段保留计数器，比只打印“IRQ happened”更容易定位。

### 3.3 UART 环形缓冲区

明确 head/tail 的所有者、满/空判定和内存序。RX 中断负责把硬件字节搬入缓冲区并唤醒读者；TX 中断负责在硬件可写时继续发送。缓冲区满时是丢弃、覆盖、流控还是阻塞，必须写进错误/并发契约。

### 3.4 Trap frame 对照检查

用一个测试程序给通用寄存器写入不同哨兵值，再触发 trap。返回后逐一比对，能比“运行 hello 没崩”更直接地发现偏移和恢复次序错误。

## 4. Spec 与接口

trap/interrupt ModuleSpec 通常为 L3。trap frame、IRQ 注册接口或用户/内核可见的异常 ABI 使用 InterfaceSpec；设备内部寄存器操作仍留在模块中。

```sh
vos agent spec interrupt
vos spec check
vos agent implement interrupt
vos agent review interrupt
```

Spec 至少声明 trap 入口、timer tick、external dispatch、UART RX/TX 和 IPI 操作；写清中断状态、栈、锁顺序、可重入性、未知 IRQ 与缓冲区溢出错误。`owns` 只覆盖中断/驱动实现和相应测试。

## 5. 验证门禁

- [ ] 同步 trap 返回后，所有承诺保留的寄存器与特权状态不变。
- [ ] 时钟连续触发，计数单调，重编程不会造成中断风暴。
- [ ] 外部 IRQ 完成 claim/complete，未知 IRQ 有可诊断失败路径。
- [ ] UART 持续输入输出时不丢失已承诺的数据，不发生死锁。
- [ ] 高中断频率下内核仍能推进普通工作。
- [ ] 多核时每个核心收到预期时钟，IPI 到达指定目标。
- [ ] public/contract targets 的 `verifies` 覆盖模块和 trap-frame 接口 ID。

压力测试至少包含持续串口输入、较高 tick 频率、设备与时钟同时到达、处理中再次触发同源 IRQ，以及多核 IPI 交叉发送。每项都设置有界运行时间，超时视为失败。

## 6. 设计理据与提交物

解释 tick 粒度、设备发现方式、中断嵌套策略和 UART 缓冲策略。提交 L3 ModuleSpec、必要 InterfaceSpec、实现、压力测试、IRQ 统计和一次失败诊断记录。

## 7. AI 使用边界

Agent 可以解释控制器寄存器、审查 trap frame 和分析串口日志。学生必须决定中断上下文规则和锁策略。`debug` 角色只读；不能让 Agent 通过屏蔽 IRQ、删除 complete 或吞掉未知中断来制造通过。

## 8. 常见错误

### 定时器只触发一次

处理程序没有设置下一次 deadline，或设置值仍在过去。记录当前计数器、比较值和写入顺序。

### claim 总是返回 0

逐项检查设备源 enable、目标上下文 enable、priority、threshold 和设备自身中断开关，不要只反复修改 IRQ 编号。

### 返回后栈损坏

对照 trap frame 偏移和 ABI，检查入口/出口是否对称，尤其是栈切换、嵌套中断和浮点/扩展寄存器策略。
