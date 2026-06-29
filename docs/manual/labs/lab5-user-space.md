# Lab 5: 用户空间 — 从 Trap 到 Hello World

## 1. 设计问题

用户态和内核态的边界在哪里？trap 如何分发和处理？进程如何抽象和管理？syscall 机制如何设计？用户程序如何加载和调度？

本 Lab 是课程中最长、最复杂的阶段。它被分为三个子阶段，每个子阶段可独立验证。

## 2. 设计空间

| 子阶段 | 关键决策 |
|--------|---------|
| 5a: Trap | trap vector 组织方式？Trampoline 页的位置和权限？用户 trap 和内核 trap 的分发策略？ |
| 5b: 进程与调度 | 进程状态机？fork+exec 还是 spawn？上下文切换的寄存器约定？调度策略？（多核：per-CPU 队列 vs 全局队列？锁策略？负载均衡？） |
| 5c: Syscall 与加载 | syscall 分发表结构？用户指针验证策略？ELF 加载器的安全验证？ |

## 3. 背景阅读

- [附录：RISC-V 参考](../appendices/riscv-reference.md)（Trap、CSR、Sv39 全部）
- [附录：链接脚本指南](../appendices/linker-script.md)（用户程序链接）
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

## 6. 设计理据要求

完成本 Lab 后，你必须能回答：

1. 你的 trap 路径中为什么如此设计 trampoline？是否有不需要 trampoline 的设计方案？
2. 你选择 fork+exec 还是 spawn 模型？这种选择如何影响你的 exec 加载器和 shell 设计（阶段 7）？
3. 你的调度策略公平性的定义是什么？如何验证？
4. 你的 ELF 加载器拒绝了哪些类型的 ELF 文件？如果加载了一个恶意构造的 ELF，你的加载器会怎样？

## 7. AI 使用边界

**允许**：
- 让 AI 审查 trap 路径的寄存器保存/恢复是否完整
- 让 AI 帮助编写用户指针验证的检查逻辑
- 让 AI 生成 ELF header 解析代码框架

**禁止**：
- 在没有 ModuleSpec 的情况下让 AI 生成进程管理或 syscall 分发的核心代码
- 让 AI 生成未经验证的用户指针复制代码

## 8. 提交物

- ArchitectureSlice(user-space)
- ModuleSpec × 3-4 + 关键操作 OperationContract
- ConcurrencySpec × 2
- ADR × 2+
- 实现源码（trap 路径、进程管理、syscall 分发、ELF 加载、调度器）
- 用户程序源码（如 `hello`）
- QEMU 启动日志（含 hello 输出）

（进阶方向：实现 Copy-on-Write fork——共享物理页、写入时 page fault 复制；实现 MLFQ 等多级调度策略；实现类 Unix 信号机制实现进程间异步通知；支持动态链接 ELF 并实现简易动态链接器。）
