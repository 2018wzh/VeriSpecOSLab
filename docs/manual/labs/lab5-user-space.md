# Lab 5: 用户空间 — 从 Trap 到 Hello World

## 1. 设计问题

用户态和内核态的边界在哪里？trap 如何分发和处理？进程如何抽象和管理？syscall 机制如何设计？用户程序如何加载和调度？

本 Lab 是课程中最长、最复杂的阶段。它被分为三个子阶段，每个子阶段可独立验证。

## 2. 设计空间

> **🔑 内核架构决策节点**：Lab 5 是你正式决定内核架构的时刻。Lab 2-4 默认沿宏内核路径，此时你可以：保持宏内核（无需额外记录），或切换到微内核/混合内核（需写 ADR 记录切换理由）。详见 [Book 第 1 章](../book/ch01-overview-design.md) §1.11.2 问题二（五种内核架构对比）和 §1.10.2（微内核论战）。

| 子阶段 | 关键决策 |
|--------|---------|
| 5a: Trap | trap vector 组织方式？Trampoline 页的位置和权限？用户 trap 和内核 trap 的分发策略？ |
| 5b: 进程与调度 | 进程状态机？fork+exec 还是 spawn？上下文切换的寄存器约定？调度策略？（多核：per-CPU 队列 vs 全局队列？锁策略？负载均衡？） |
| 5c: Syscall 与加载 | syscall 分发表结构？用户指针验证策略？ELF 加载器的安全验证？ |

## 3. 背景阅读

- [附录：RISC-V 参考](../appendices/riscv-reference.md)（Trap、CSR、Sv39 全部）
- [附录：链接脚本指南](../appendices/linker-script.md)（用户程序链接）
- [Book 第 1 章](../book/ch01-overview-design.md) §1.11.2 问题二（内核架构对比）、§1.10.2（微内核论战）、§1.11.3 问题三（OS 存在目的）
- [Spec: OperationContract 编写指南](../specs/operation-contract.md)
- [Spec: ConcurrencySpec 编写指南](../specs/concurrency-spec.md)
- ELF 格式规范（至少了解 ELF header 和 Program Header）

## 4. 规格要求

### 4.1 ArchitectureSlice（必做）

创建 `spec/architecture/slices/04-user-space.yaml`，覆盖 trap、进程、syscall 全部。

### 4.2 ModuleSpec（必做，至少 3 个）

- `spec/modules/trap/module.yaml`：trap 处理模块
- `spec/modules/process/module.yaml`：进程管理模块
- `spec/modules/syscall/module.yaml`：syscall 分发模块
- `spec/modules/exec/module.yaml`：可执行文件加载模块

每个模块包含完整的 `owned_state`、`exported_interfaces`、`module_invariants`。

### 4.3 ADR（必做，至少 2 个）

建议：调度策略选择、可执行格式选择、进程模型选择。

### 4.4 OperationContract（必做）

按子阶段分别编写：

**5a: Trap 操作**：
- trap 入口（trap_entry）
- 用户 trap 分发（handle_user_trap）
- 内核 trap 处理（handle_kernel_trap）
- trap 返回（trap_return）

**5b: 进程操作**：
- 上下文切换（context_switch）
- 进程创建（如 fork 或 spawn）
- 进程退出（exit）
- 进程等待（wait）
- 调度（schedule）

**5c: Syscall 操作**：
- syscall 分发
- syscall 参数获取
- 用户指针验证和安全复制
- 程序加载（load_executable）

### 4.5 ConcurrencySpec（必做，至少 2 个）

- `spec/modules/process/concurrency.yaml`：进程表锁、调度器锁
- `spec/modules/trap/concurrency.yaml`：中断上下文与 trap 处理的并发规则

### 4.6 GoalValidationContract (mini)（可选）

如果你选择非常规的调度策略或进程模型，通过 mini contract 声明你的选择和验证标准。

## 5. 子阶段与质量门禁

### 5a: Trap 路径

**任务**：
- 设置 `stvec` 指向 trap vector
- 实现 trampoline 页（共享于用户和内核页表）
- 实现 `handle_user_trap()`：解析 `scause`，分发到 syscall / page fault / timer / device
- 实现 `handle_kernel_trap()`：处理内核态异常
- 实现 `trap_return()`：恢复寄存器，执行 `sret`

**质量门禁**：
```bash
vos test --suite trap
```
- [ ] 用户态 ecall 触发 trap 并被正确分发
- [ ] trap 返回后用户程序可继续执行
- [ ] 用户态页错误不导致内核 panic

### 5b: 进程与调度

**任务**：
- 定义进程结构（至少包含：状态、页表、trapframe、上下文）
- 实现进程创建、销毁、等待（按你选择的模型）
- 实现上下文切换（汇编 `swtch`）
- 实现调度器主循环和调度策略

**质量门禁**：
```bash
vos test --suite process
```
- [ ] 多个进程可被创建
- [ ] 进程状态转换正确
- [ ] 调度器公平运行（按你声明的公平性定义）

### 5c: Syscall 与用户程序

**任务**：
- 实现 syscall 分发表
- 实现参数获取和用户指针验证
- 实现至少 `write` 和 `exit` 两个 syscall
- 实现 ELF 加载器（或你选择的其他格式）
- 编写第一个用户程序（如 `hello`）

**质量门禁**：
```bash
vos build
vos test --suite syscall
vos run qemu --case user-hello
```
- [ ] `hello` 程序可被加载并运行
- [ ] `hello` 可调用 `write` syscall 输出信息
- [ ] `hello` 可调用 `exit` syscall 正常退出
- [ ] 非法 syscall 编号被正确处理
- [ ] 同一进程不在两个 CPU 上同时运行（多核调度正确性）

## 6. Seed 更新（🔑 核心决策节点）

Lab 5 是 Seed 填充的分水岭。前面四个 Lab 你都在搭基础设施，Lab 5 才第一次面对"我的 OS 到底长什么样"这个全局问题。此时你要填写 goals、non_goals 和 reference_systems，并正式决定内核架构。

1. **写 goals**：在理解了 trap、进程、syscall 之后，你能写出绑着实际经验的目标了：
   ```yaml
   goals:
     - "教学清晰性优先：所有内核数据结构可遍历、所有关键路径可追踪"
     - "支持至少 3 个并发用户进程"
     - "进程间通过 MMU 严格隔离"
   ```

2. **写 non_goals**：实现过之后你知道哪些东西不值得做了：
   ```yaml
   non_goals:
     - "不支持多核并发调度（仅单 HART）"
     - "不追求 syscall 性能优化"
     - "不支持动态链接"
   ```

3. **写 reference_systems**：现在你有资格做有意义的 borrow/modify/reject 分析了：
   ```yaml
   reference_systems:
     - system: "xv6-riscv"
       borrowed_concepts:
         - "进程模型：fork/exec/wait 生命周期"
         - "trap 路径：trampoline 页 + uservec/usertrap"
       modified_concepts:
         - "调度器：从 round-robin 改为 MLFQ（理由见 ADR-00X）"
       rejected_concepts:
         - "sleeplock：改用 mutex + condition variable（理由见 ADR-00Y）"
       reason: "xv6 的简洁性适合教学，但 sleeplock 语义过于隐式"
   ```

4. **决定内核架构**：保持默认宏内核路径，无需额外操作。要切到微内核或混合内核，写 ADR 说清楚三件事：为什么 Lab 5 才切换（而不是更早或更晚），Lab 2-4 的哪些代码需要重构，隔离收益和 IPC 开销你怎么取舍。

5. 更新 `architecture_summary`：经过五个 Lab，你对你的 OS 有了完整的理解，把摘要重写成一句准确的话。
6. 运行 `vos seed status` 确认 Lab 5 字段已填充。
7. 运行 `vos stage save --intent "architecture decisions finalized"`。

## 7. 设计理据要求

完成本 Lab 后，你必须能回答：

1. 你的 trap 路径中为什么如此设计 trampoline？是否有不需要 trampoline 的设计方案？
2. 你选择 fork+exec 还是 spawn 模型？这种选择如何影响你的 exec 加载器和 shell 设计（阶段 7）？
3. 你的调度策略公平性的定义是什么？如何验证？
4. 你的 ELF 加载器拒绝了哪些类型的 ELF 文件？如果加载了一个恶意构造的 ELF，你的加载器会怎样？

## 8. AI 使用边界

**允许**：
- 让 AI 审查 trap 路径的寄存器保存/恢复是否完整
- 让 AI 帮助编写用户指针验证的检查逻辑
- 让 AI 生成 ELF header 解析代码框架

**禁止**：
- 在没有 ModuleSpec 的情况下让 AI 生成进程管理或 syscall 分发的核心代码
- 让 AI 生成未经验证的用户指针复制代码

## 9. 提交物

见各子阶段门禁中的具体产物。

## 10. 常见错误与排查

### 子阶段 5a (Trap) 高发错误

**错误 1：`sret` 后 CPU 在 U-mode 执行的第一条指令就 page fault**

最常见的原因：`sepc` 指向了一个未在用户页表中映射的地址。检查：
- `ecall` 后 `sepc += 4` 了吗？如果没递增，`sret` 会再次执行 `ecall`——无限循环
- 用户页表包含 trampoline 映射吗？在调用 `sret` 之前，确认 `satp` 指向用户页表

**错误 2：Trap handler 中调用 `printf`（或你自己的 `uart_puts`）导致嵌套 trap**

如果在 S-mode 的 trap handler 中触发了另一个异常（如页错误），`stvec` 被再次调用——如果 handler 没准备好处理"来自 S-mode 的 trap"，会导致无限递归或内核 panic。解决方案：在 handler 中尽早检查 `sstatus.SPP`——如果是 S-mode 触发的 trap，直接 panic。

### 子阶段 5b (进程) 高发错误

**错误 3：上下文切换后第一个进程在跑，第二个从未被调度**

检查三件事：
1. 时钟中断是否正常触发？（看阶段 4 的 tick 计数器）
2. `yield()` 是否在 tick handler 中被调用？
3. 调度器的 `schedule()` 函数是否真的遍历了所有 runnable 进程？

**错误 4：`swtch` 返回后内核栈内容不对**

`swtch` 保存和恢复的是 callee-saved 寄存器（`s0-s11`, `sp`, `ra`）。如果 `swtch` 之后 `sp` 是错的，检查 `swtch` 的汇编实现中 `sp` 的 load/store 顺序。

### 子阶段 5c (Syscall) 高发错误

**错误 5：`exec` 后程序不运行——GDB 显示 PC 在未映射的地址**

常见原因：
- ELF Program Headers 的 `p_vaddr` 和你分配的虚拟地址不匹配
- 忘记在进入用户态前设置 `a0`（argc）和 `sp`（用户栈）
- `exec` 替换了页表但忘了刷新 TLB

## 最终提交物汇总

- ArchitectureSlice(user-space)
- ModuleSpec × 3-4 + 关键操作 OperationContract
- ConcurrencySpec × 2
- ADR × 2+
- 实现源码（trap 路径、进程管理、syscall 分发、ELF 加载、调度器）
- 用户程序源码（如 `hello`）
- QEMU 启动日志（含 hello 输出）

（进阶方向：实现 Copy-on-Write fork——共享物理页、写入时 page fault 复制；实现 MLFQ 等多级调度策略；实现类 Unix 信号机制实现进程间异步通知；支持动态链接 ELF 并实现简易动态链接器。）
