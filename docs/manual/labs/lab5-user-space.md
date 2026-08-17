# Lab 5：用户空间——从 trap 到第一个进程

> **对应教材**：[第 5 章：用户空间](../book/ch05-user-space.md)

> **本 Lab 概览**
>
> - **学完能做什么**：让第一个用户程序在自己的地址空间中运行，通过 syscall 请求内核服务并正常退出；能解释用户态进入内核、调度切换、返回用户态的完整路径。
> - **预计耗时**：20–28 小时，建议安排 2–3 周。这是课程中工作量最大的阶段之一，三个子阶段各占约三分之一。
> - **前置依赖**：已完成 Lab 4（中断与定时器可用），阅读第 5 章与对应 ISA 的用户态/特权级参考。
> - **产出物**：trap、process/scheduler、syscall 三个 ModuleSpec，trap-frame 与 syscall 两个 InterfaceSpec，三个子阶段的实现与独立测试，上下文切换与坏指针证据。
> - **评分构成**：质量门禁 70% + 设计理据 20% + 挑战/加分 10%（可选）。实际分值以教师公布为准。
> - **实际耗时**：在提交物里记录本次 Lab 实际投入小时数。

## 1. 设计问题

- 用户进入内核时，trap frame 在哪里，哪些状态由硬件保存？
- 进程拥有哪些资源，生命周期如何转换，退出后谁回收？
- 调度器的公平性和抢占点如何定义？
- syscall 编号、参数、返回值和错误码如何形成稳定 ABI？
- 用户指针如何校验，复制过程中遇到页错误怎么办？

本 Lab 分三段完成：用户 trap、进程与调度、syscall 与第一个用户程序。每段都必须独立可验证，避免把 trap、页表、调度和 ABI 问题混成一次黑屏。

## 2. 子阶段 A：用户 trap

先构造最小用户页表和一段只执行 `ecall` 的用户代码。验证路径：

```text
用户指令 → trap 入口 → 保存用户状态 → 内核分发 → 恢复状态 → 用户继续
```

trap frame 是跨边界 ABI，应写入 `spec/interfaces/trap-frame.yaml`。明确通用寄存器、PC、状态寄存器、用户栈、内核栈和地址空间标识。非法指令、用户页错误和未知 trap 不得直接破坏内核。

**自检点**：`ecall` 被正确识别，返回 PC 不会重复执行同一指令；trap 返回后，承诺保留的用户寄存器不变。

门禁：

- [ ] `ecall` 被正确识别，返回 PC 不会重复执行同一指令。
- [ ] trap 返回后，承诺保留的用户寄存器不变。
- [ ] 用户页错误终止或通知当前进程，不让内核 panic。
- [ ] 用户不能伪造内核 trap frame 地址或特权状态。

## 3. 子阶段 B：进程与调度

进程 ModuleSpec 至少声明 created、runnable、running、blocked、zombie/terminated 等状态及合法转换。调度器为 L3，写清每核运行状态、run queue 锁、抢占点和"同一进程不得同时在两个 CPU 运行"的保证。

先跑协作式切换，再打开定时器抢占。每次上下文切换记录前后 PID、CPU、原因和单调序号；常规构建可以降低日志级别，但证据字段必须完整保留。

**自检点**：多个进程可创建、运行、阻塞、唤醒和退出；状态转换只经过 Spec 允许的边。

门禁：

- [ ] 多个进程可创建、运行、阻塞、唤醒和退出。
- [ ] 状态转换只经过 Spec 允许的边。
- [ ] 同一进程不会同时运行在两个 CPU。
- [ ] 公平性测试符合你声明的窗口和误差，而不是只检查"都运行过一次"。
- [ ] lost wakeup 测试能重复运行并留下等待队列证据。

## 4. 子阶段 C：syscall 与用户程序

跨用户/内核边界的 syscall 写入 InterfaceSpec。至少定义 syscall number、参数寄存器、返回寄存器、错误表示、指针方向、长度单位和可观察副作用。

首批接口建议只保留 `write`、`exit` 以及加载测试所需的最小集合。`copyin`/`copyout` 必须逐页验证权限和范围，防止跨页尾部绕过检查。

**自检点**：第一个用户程序能加载、调用 `write` 并正常 `exit`；未知 syscall 返回稳定错误。

门禁：

- [ ] 第一个用户程序能加载、调用 `write` 并正常 `exit`。
- [ ] 未知 syscall 返回稳定错误，不执行任意分支。
- [ ] NULL、内核地址、跨页坏指针和长度溢出均被拒绝。
- [ ] 返回值和错误码与 InterfaceSpec 一致。

## 5. Spec 与 Agent 工作流

trap、process 和 syscall 各自使用同样的严格字段骨架。先替换模块 ID，再按职责填写；跨用户/内核边界的 ABI 另写 InterfaceSpec。

```yaml
id: TODO_MODULE_ID
module: TODO_MODULE_ID
level: TODO_LEVEL
purpose: TODO
owns: [TODO_IMPLEMENTATION_PATH, TODO_TEST_PATH]
interface: [TODO_OPERATION]
properties: [TODO]
errors: [TODO]
state: { TODO_STATE: TODO }
preconditions: [TODO]
postconditions: [TODO]
invariants: [TODO]
dependencies: [TODO]
```

```sh
vos agent ask "用户态、进程与 syscall ABI 应如何分配到 ModuleSpec 和 InterfaceSpec？"
# 学生手写三个 ModuleSpec 与跨用户/内核边界的 InterfaceSpec
vos spec lint kernel/trap
vos agent review kernel/trap
vos spec lint kernel/process
vos agent review kernel/process
vos spec lint kernel/syscall
vos agent review kernel/syscall -i
# 学生修改、再次 lint，并手动提交本 Lab 的 Spec
vos spec lint all
git add spec/modules spec/interfaces
git commit -m "[spec][user] Define Lab 5 user-space contracts"
vos agent implement kernel/trap
vos agent implement kernel/process
vos agent implement kernel/syscall
vos build
vos run qemu
vos verify
```

trap、process/scheduler 和 syscall 分属不同 ModuleSpec；trap frame 与 syscall ABI 使用 InterfaceSpec。若一个实现切片必须跨模块修改，先提交 SpecPatch。每个测试 target 用 `verifies` 绑定对应模块或接口稳定 ID。

## 6. 可观测性与故障注入

至少保留以下诊断能力：trap 原因与 PC、进程状态转换、上下文切换原因、syscall 编号与遮蔽后的参数类别。不要在日志中打印用户缓冲区原文或凭据。

故障注入至少覆盖：非法指令、用户页错误、未知 syscall、坏用户指针、运行队列重复项和退出时仍持有资源。

建议使用统一事件格式：

```text
TRAP cpu=<n> pid=<n> cause=<kind> pc=<hex>
SCHED seq=<n> cpu=<n> from=<pid> to=<pid> reason=<kind>
SYSCALL pid=<n> id=<n> result=<code>
```

不要记录完整用户缓冲区。需要证明 copyin/copyout 跨页时，可记录页数、权限类别、失败页索引和内容哈希。

## 7. 设计理据

1. 为什么选择当前内核组织方式，宏内核/微内核取舍体现在哪里？
2. 调度公平性如何定义，测试窗口为什么足够？
3. syscall ABI 如何保持稳定，又如何允许未来扩展？
4. 用户指针检查在哪个可信边界完成？

## 8. AI 使用边界

Agent 可以审查 trap 保存集合、状态机和 ABI 测试。学生必须决定进程模型、调度策略和 ABI。不能用关闭抢占、跳过坏指针检查或把用户异常提升为内核 panic 的方式换取短期通过。

## 9. 提交物

- [ ] trap、process/scheduler、syscall ModuleSpec；
- [ ] trap-frame 与 syscall InterfaceSpec；
- [ ] 三个子阶段的实现和独立 public/contract targets；
- [ ] 上下文切换与异常证据；
- [ ] 调度公平性和坏指针测试；
- [ ] 实际耗时（一个整数小时数）；
- [ ] 必要的 SpecPatch。

## 9a. 最小成功输出样例

三个子阶段各有独立的验收标记。运行 `vos run qemu` 后，示例日志：

```text
[0] process 1: user trap ok (a7=0x1)
[0] scheduler: run queue [1, 2, 3]
[0] hello from user program: pid=1
[0] process 1: exit status 0
```

对照门禁：

- 子阶段 A：用户程序首次进入内核并返回，日志有 trap 路径标记（如 `user trap ok`）与保存/恢复的寄存器证据；
- 子阶段 B：调度日志显示进程在 run queue 中轮转，公平性窗口内各进程推进次数符合预期；
- 子阶段 C：用户程序输出 `hello`（或等价输出）并通过 syscall 正常退出，退出码为 0；
- 坏指针测试：传非法指针的 syscall 返回错误（如 `-EFAULT`），内核不 panic。

## 10. 常见问题与排查

### 用户态不断重复 `ecall`

返回 PC 没有越过触发指令，或保存/恢复了错误的 PC 字段。记录 trap 前后 PC 并对照 ISA 约定。

### 第二个进程启动后随机崩溃

检查每进程内核栈、上下文结构和地址空间切换，尤其是被错误共享的 trap frame 或页表根。

### `write` 的短缓冲通过，跨页缓冲失败

指针只验证了起始地址。按页遍历整个 `[ptr, ptr + len)`，同时检查整数溢出和每页权限。

### trap 返回后第一个用户寄存器错误

入口保存顺序与结构偏移不一致，或出口提前覆盖了保存区。用哨兵寄存器测试逐项定位，不要只调整汇编偏移直到 hello 偶然运行。

### 多核下偶发同一 PID 同时运行

从 run queue 取出进程和把状态改为 running 不是一个原子状态转换。检查持锁范围、每核 current 指针和抢占路径。

### `exit` 后父进程永远等待

退出路径没有在发布 zombie/terminated 状态后唤醒等待者，或唤醒发生在状态可见之前。将状态发布与 wait queue 语义写入同一 L3 契约。

## 11. 参考卡

- [Book 第 5 章：用户空间](../book/ch05-user-space.md)：trap、进程、调度与 syscall 的完整背景。

RISC-V 的 S/U 特权级、`sret` 和 `ecall`，x86-64 的 ring 0/3 与 `syscall/sysret`，AArch64 的 EL0/EL1 与 SVC，都会影响 trap frame、返回 PC、寄存器保存集合和用户指针检查。把这些架构差异放在上下文/HAL 接口中，syscall 分发和用户资源模型只处理统一的成功、错误和权限语义。

本 Lab 前文已经给出 ModuleSpec、InterfaceSpec 和跨模块 SpecPatch 的字段用法。最终检查时要能从 ABI 字段追到实现、测试和失败证据，不要依赖仓库内部手册链接。
