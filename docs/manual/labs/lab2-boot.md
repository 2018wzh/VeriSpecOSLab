# Lab 2: 最小内核启动 — 用 Spec 描述从硬件到第一条指令

> **本 Lab 不写代码。** 你需要用 YAML Spec 精确描述启动序列的**行为**和**契约**——而不是在哪个文件里写什么代码。平台细节通过附录按需查阅。代码在 Lab 末尾由 `vos agent generate --apply` 从你的 Spec 生成。

## 1. 设计问题

从硬件上电到你的内核输出第一条消息，这条路径上发生了什么？你的内核如何从固件手中接管控制权？最小的可运行内核需要建立什么执行环境？

你需要用 Spec 来回答——先想清楚**行为**和**不变量**，再让工具链和 Agent 帮你把行为映射到具体代码。

> **本 Lab 的核心转变**：在传统 OS 实验中，你会直接写 `_start` 汇编和 `kernel_main` C 代码。在这个 Lab 中，你**不写任何实现代码**。你写的是：启动序列必须完成哪些操作、每个操作的前置条件和后置条件是什么、启动过程中维护什么不变量。代码由 Agent 生成，你审查代码是否符合你的 Spec。

## 2. 设计空间

> **关于内核架构**：此时你还不必决定宏内核还是微内核，这个选择推迟到 Lab 5。Lab 2-4 默认沿宏内核路径（所有内核模块在同一地址空间），这是最简单、参考资料最丰富的路线。如果你已有明确计划走微内核，先按宏内核走完 Lab 2-4，到 Lab 5 再通过 ADR 切换。

| 决策     | 你需要回答的问题                                                              | 对应 Spec 制品                                    |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| 启动序列 | 固件→内核的交接状态是什么？从入口到主初始化之间需要哪些步骤？                | `entry` + `kernel_main` OperationContract     |
| 启动方式 | 固件直启、bootloader 还是 UEFI？每种方式把 CPU 留在什么特权级、给你什么信息？ | `rely.state_assumptions` 中声明                 |
| 多核策略 | 多个核心同时启动还是主从模式？非启动核心如何等待？                            | ConcurrencySpec（内联到各 OperationContract）     |
| 内存布局 | 栈放哪里？代码和数据段的加载地址？BSS 在哪里？                                | `spec/toolchain/link.yaml`                      |
| 输出通道 | 你的内核通过什么机制输出第一条消息？UART MMIO？SBI ecall？BIOS INT 10h？      | `console_output` OperationContract              |
| 构建链路 | 什么编译器？链接脚本定义了什么入口符号和段布局？                              | `spec/toolchain/toolchain.yaml`                 |
| 验证手段 | 如何确认启动成功？banner 内容检查还是超时检测？                               | `spec/toolchain/run.yaml` 的 `success_signal` |

> **背景阅读**：[Book 第 1 章](../book/ch01-overview-design.md) §1.11.4 问题四（ISA 差异）和 §1.9（为什么先设计再写代码）。平台特定细节见下方"背景阅读"列的附录。

## 2a. 设计决策引导

以下每个问题不是选择题——你需要**想清楚**你的设计，然后把答案写到对应的 Spec 字段中。

### 决策 1：启动方式

你选择的启动方式决定了入口时 CPU 的状态——这些状态**必须**出现在 OperationContract 的 `rely.state_assumptions` 中。

| 路径                 | 典型场景                                                |     入口特权级     | 你需要查询的信息                                          |
| -------------------- | ------------------------------------------------------- | :----------------: | --------------------------------------------------------- |
| **固件直启**   | RISC-V OpenSBI → kernel；ARM TrustedFirmware → kernel |    S-mode / EL1    | 固件通过哪些寄存器/结构体传递信息？内存布局是否已初始化？ |
| **Bootloader** | GRUB/Multiboot2、Limine、U-Boot                         |   保护模式 / EL2   | bootloader 提供的启动信息结构体格式？页表是否已建立？     |
| **UEFI 直启**  | 直接生成 PE/COFF 镜像由 UEFI 固件加载                   | 32/64-bit 保护模式 | UEFI Boot Services 是否还可用？GOP/ACPI 表地址？          |

**设计自检**：

- 你在 Lab 1 的 seed.yaml 中声明了什么 `target_platform`？查阅对应 [平台附录](#3-背景阅读) 获取入口状态约定。
- 入口时的特权级是什么？你需要自己提升特权级，还是固件已经帮你做好了？
- 固件/bootloader 通过什么机制传递硬件信息（设备树、ACPI、Multiboot info structure）？

### 决策 2：入口代码的最小集合

无论你选择什么语言写内核（C/C++/Rust/Zig），有一小段代码**必须**用汇编（或语言内置的裸寄存器操作）完成。你需要想清楚的只有一件事：**哪些操作绝对不可能用高级语言完成？**

答案在几乎所有平台上是相同的三个：

1. **设置栈指针** — 高级语言没有直接设置栈寄存器的语法（这是 ABI 约定的一部分，编译器自动管理，但入口时栈还不存在）
2. **跳转到高级语言入口** — 控制流从汇编转移到高级语言（对于某些语言，这还涉及调用约定的对齐要求）
3. **暂存固件信息** — 固件通过寄存器传递的信息（核心 ID、设备树指针、启动信息结构体指针），必须在调用高级语言函数前保存到高级语言能访问的位置

此外，**BSS 清零**在大多数情况下也在入口汇编中完成——它不是必须用汇编，而是它正好在"栈已就绪、高级语言尚未进入"的窗口里。

> 关于 Rust/Zig：如果你选择了这些语言，`#[no_mangle] pub extern "C" fn _start()` 或 Zig 的裸入口函数可以替代汇编文件——但你仍然需要处理栈指针设置。查阅对应语言的 freestanding/OS 开发指南。

**设计自检**（写到 `entry` OperationContract 的 `guarantee.side_effects` 中）：

- 入口代码结束时，栈指针指向哪里？BSS 是否已清零？固件信息是否已保存到可访问位置？
- 你的入口代码是尾调用（`j` / `b` / `tail`）还是常规调用（`call` / `bl`）？这对栈有什么影响？

### 决策 3：栈的大小和位置

教学 OS 的栈通常设为 4–16 KiB。你可以先设一个值，后面需要时再调整。

栈的位置有两个通用约束（与平台无关）：

- 不能在代码段或数据段内部（会互相覆盖）
- 不能覆盖内存映射 I/O（MMIO）区域

一种通用的内存布局结构（具体地址查阅平台附录）：

```
RAM_BASE    ┌──────────────┐
            │   .text      │  代码段
            ├──────────────┤
            │   .rodata    │  只读数据
            ├──────────────┤
            │   .data      │  已初始化数据
            ├──────────────┤
            │   .bss       │  未初始化数据（入口清零）
            ├──────────────┤
            │              │
            │   (空闲)     │  ← 将来用于堆/页分配器
            │              │
            ├──────────────┤
            │   栈区       │  ← 栈指针指向高地址，向下增长
RAM_BASE    │              │
  + SIZE    └──────────────┘
```

**设计自检**：

- 你的栈放在什么位置？如果栈溢出（向低地址方向），它会覆盖 BSS 段还是空闲区域？
- 查阅平台附录：RAM 的起始地址和典型大小是多少？内核加载地址是多少？
- 栈大小写在哪里？是链接脚本中的符号，还是代码中的常量？在 ToolchainSpec 中如何声明？

### 决策 4：BSS 清零的策略

BSS 清零的方法取决于你的语言选择和入口实现：

| 方案                         | 适合                              | 注意事项                                                                              |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| **入口汇编中循环清零** | 所有语言，最通用                  | 注意清零粒度（逐字节 vs 按平台字长），确保 BSS 大小不是字长的整数倍时不会漏清末尾字节 |
| **调用 memset**        | C/C++，如果 memset 已在入口前实现 | 增加依赖：memset 必须在 BSS 清零前可用                                                |
| **语言运行时负责**     | Rust/Zig（运行时通常处理 BSS）    | 需确认你的 freestanding 目标是否保留了此行为                                          |

**设计自检**：

- 你的 BSS 清零操作是否处理了非对齐大小？写出对应的 OperationContract 的 `preconditions` 和 `postconditions`。
- BSS 清零的边界符号（`_bss_start`、`_bss_end`）由链接脚本定义——在 ToolchainSpec 的 `link.yaml` 中声明它们。

### 决策 5：多核/多 HART 启动策略

多核启动的核心问题是：**所有核心都执行入口代码吗？如何协调它们的输出和初始化？**

本 Lab 的策略是：**所有核心各自启动，通过自旋锁（spinlock）协调**。每个核心在入口处设置自己的栈，然后通过同一把锁保护控制台输出，确保每个核心的 banner 完整打印、不与其他核心的字符交错。

| 策略 | 描述 | 复杂度 | 适合 |
|------|------|:----:|------|
| **全部启动+锁协调** | 所有核心执行入口代码，核心 0 清零 BSS，每个核心用自旋锁保护 banner 输出 | 中 | **本 Lab 推荐**——从第一天就建立并发思维 |
| **主从模式** | 只有启动核心（core 0）执行初始化，其他核心自旋等待 | 低 | 想先跑通单核再考虑多核时可选 |
| **同时启动** | 所有核心同时执行入口代码，通过原子操作协调全部初始化 | 高 | 对启动延迟敏感的实时系统 |

**多核启动+锁协调的通用伪代码**：

```text
入口:
    读取当前核心 ID（方式见平台附录）
    设置该核心的专属栈指针（每个核心的栈独立）
    如果 核心 ID == 0:
        清零 BSS（仅一次）
    跳转到 kernel_main(core_id)

kernel_main(core_id):
    获取控制台锁（spinlock_acquire）
    打印 banner（含核心 ID）
    释放控制台锁（spinlock_release）
    如果 核心 ID == 0:
        执行后续初始化
    否则:
        自旋等待（wfi / hlt / yield 指令见平台附录）
```

**为什么需要锁？** 控制台输出（UART/SBI）通常不是多核安全的。如果两个核心同时向 UART 的 THR 寄存器写入，字符会交错——Core 0 写 `'H'`、Core 1 写 `'X'`、输出变成 `"HXelXlHoX"`。自旋锁确保每次只有一个核心在操作输出通道。

**自旋锁的最小设计**：一个整数标志位（0=未锁定，1=已锁定）+ 原子"测试并设置"指令（如 RISC-V 的 `amoswap`、x86 的 `xchg`、ARM 的 `ldxr/stxr`）+ 内存屏障（如 RISC-V 的 `fence`、x86 的 `mfence`、ARM 的 `dmb`）。

> **为什么不是纯 "while (flag) {}"？** 普通的 while 循环不提供原子性和内存序保证。两个核心可能同时读到 `flag==0`、同时写入 `flag=1`、都认为"我拿到了锁"——这就是经典的"丢失更新"竞态。原子指令 + 内存屏障是唯一正确的解法。自旋锁的实现细节在后续步骤的 OperationContract 中展开。

**设计自检**：
- 你的平台如何获取当前核心 ID？写在哪条 OperationContract 的 `rely.state_assumptions` 中？
- 每个核心的栈是独立的吗？栈大小和位置在 ToolchainSpec 中如何声明？
- BSS 清零只执行一次——你的 Spec 如何保证 core 1 不会在 core 0 清零 BSS 之前访问 BSS 中的全局变量？
- 你的自旋锁使用什么原子指令和内存屏障？查阅平台附录。

> 关于并发 Spec：多核启动涉及并发控制。本 Lab 中，并发相关字段直接写在 OperationContract 的 `concurrency` 块中——包含 `atomicity`（谁执行、是否原子）、`lock_order`（锁获取顺序）、`interrupt_state`（入口时中断状态）、`wait_wakeup_rules`（非启动核心如何等待）。新增的 `spinlock_acquire` 和 `spinlock_release` 操作通过 `rely.lock_assumptions` 和 `concurrency.lock_order` 声明锁的约束。

## 2b. 逐步操作指引

以下是阶段 2 的推荐执行步骤。每一步后面标注了"自检点"——如果你在这一步卡住了，说明哪个前置步骤可能没做对。

> **开始前**：回顾 Lab 1 产出的 `spec/architecture/seed.yaml`，确认你的 `target_platform`、`goals`、`constraints`。Lab 2 的所有 Spec 制品都基于 Lab 1 的 seed 决策。

### 步骤 1：创建 Spec 目录结构（预计 5 分钟）

```sh
# 在你的项目根目录下
mkdir -p spec/architecture/slices
mkdir -p spec/modules/boot/ops
mkdir -p spec/toolchain
```

**预期产物**：三个空目录就位。

**自检点**：`ls spec/architecture/slices/ spec/modules/boot/ops/ spec/toolchain/` 三个路径均存在。

---

### 步骤 2：编写 ArchitectureSlice（预计 20 分钟）

创建 `spec/architecture/slices/01-boot.yaml`。ArchitectureSlice 回答：**这个阶段引入了什么机制？依赖什么？**

```yaml
id: slice-01-boot          # 唯一标识，建议格式 slice-{序号}-{阶段名}
stage: boot                # 阶段名，与 seed.yaml 的阶段列表对应
title: "Early Boot"        # 简洁标题
summary: >                 # 一段话：本阶段的核心行为和约束
  Minimal boot sequence: 从固件入口到第一条控制台输出。
  所有核心各自启动、各设栈。核心 0 清零 BSS。
  每个核心通过自旋锁获取控制台、打印含核心 ID 的 banner。
  非启动核心输出后自旋等待。

depends_on_slices: []      # Lab 2 是第一阶段，无前序依赖
depends_on_adrs: []        # 无 ADR 依赖（如果启动方式选择显著偏离主流推荐，需要 ADR）

mechanisms:                # 本阶段引入的机制（通用描述，不写具体技术名）
  - "从固件/bootloader 的入口状态接管控制权"
  - "栈分配与初始化（每核心独立栈）"
  - "BSS 段清零（仅核心 0 执行一次）"
  - "控制台字符输出（平台特定输出通道）"
  - "自旋锁（spinlock）——原子测试并设置 + 内存屏障，保护控制台输出"
  - "boot banner 输出（每核心一条，含核心 ID）"
  - "关机/终止（优雅退出 QEMU 或硬件）"

affected_modules:          # 本阶段涉及的模块（namespace）
  - boot                   # 启动模块

new_operations:             # 本阶段新引入的操作（模块.操作 命名）
  - boot.entry             # 入口代码
  - boot.kernel_main       # 内核主入口
  - boot.bss_zero          # BSS 清零
  - boot.spinlock          # 自旋锁获取/释放
  - boot.console_output    # 通用控制台输出
  - boot.boot_banner       # boot banner
  - boot.shutdown          # 关机

removed_or_replaced_mechanisms: []

invariants:                # 本阶段保证的不变量
  - "BSS 仅清零一次（由核心 0 执行）"
  - "BSS 在任何全局变量访问前清零"
  - "每个核心的 banner 完整输出、字符不交错（spinlock 序列化）"
  - "自旋锁获取和释放正确配对"

security_boundaries:       # 安全边界
  - "无用户上下文存在；所有代码运行在内核特权级"

concurrency_highlights:    # 并发要点
  - "所有核心并发进入入口；核心 0 负责一次性 BSS 清零"
  - "spinlock 序列化 banner 输出；内存屏障保证多核可见性"
  - "所有中断在启动阶段保持禁用"

validation_binding:        # 绑定到验证矩阵的检查项
  must_pass:
    - spec_lint            # Spec 格式检查
    - spec_consistency     # Spec 引用一致性检查
    - build_dry_run        # 构建计划有效性检查
    - generate_code        # 代码生成检查（末尾）

open_questions: []         # 留空或记录待解决的开放问题
```

**自检点**：

- `id` 是否唯一且不与 xv6-spec 或其他示例冲突？
- `mechanisms` 是否全部用了通用描述（不含平台特定术语）？
- `new_operations` 是否完整覆盖了你的启动序列？

**如果卡住**：参考 `examples/xv6-spec/spec/architecture/slices/01-boot.yaml`，但注意——你的 mechanisms 和 invariants 应该反映**你自己的设计**，不是照抄。

---

### 步骤 3：编写 ModuleSpec（预计 15 分钟）

创建 `spec/modules/boot/module.yaml`。ModuleSpec 回答：**这个模块管理什么状态？提供什么接口？维护什么不变量？**

```yaml
id: boot                       # 唯一标识（不需要 namespace 前缀）
module: boot                   # 模块 namespace
stage: boot                    # 阶段
purpose: >                     # 一段话：模块职责
  Early boot path: 栈设置、BSS 清零、控制台输出抽象、
  boot banner 打印、优雅关机。

related_slices:
  - slice-01-boot              # 关联的 ArchitectureSlice ID
related_adrs: []

owned_state:                   # 模块管理的状态（本阶段很少）
  - name: "boot_banner_text"
    type: "static string"
    description: "启动 banner 字符串，编译期确定"
  - name: "console_output_contract"
    type: "output channel abstraction"
    description: "控制台输出的抽象契约，由平台特定驱动实现"
  - name: "console_lock"
    type: "spinlock (int flag)"
    description: "保护控制台输出的自旋锁。0=未锁定，1=已锁定。多核环境下通过原子操作保护。"

exported_interfaces:           # 对外暴露的操作
  - entry                      # 入口
  - kernel_main                # 主初始化
  - bss_zero                   # BSS 清零
  - spinlock_acquire           # 获取自旋锁
  - spinlock_release           # 释放自旋锁
  - console_output             # 控制台输出
  - boot_banner                # boot banner
  - shutdown                   # 关机

imported_interfaces: []        # 本阶段无外部依赖（boot 是最底层）

module_invariants:             # 模块不变量
  - "boot banner 可在无堆分配的情况下打印"
  - "启动路径为 freestanding（无标准库依赖）"
  - "所有控制台输出通过统一的 console_output 接口"
  - "console_lock 在每次 console_output 调用前被获取、调用后被释放"
  - "spinlock_acquire 和 spinlock_release 严格配对"

error_model:                   # 错误模型
  - "console_output 在平台约定中为不可失败操作"
  - "shutdown 不返回"
  - "spinlock_acquire 在锁已持有时死锁（调用者负责不重入）"

resource_lifetime_rules:       # 资源生命周期
  - "boot banner 为静态字符串，无限生命周期"

security_boundary:
  - "启动阶段无用户/内核边界"

test_surfaces:                 # 可测试表面
  - "boot banner 内容验证"
  - "控制台输出 smoke test"
  - "关机信号检测"
```

**自检点**：

- `exported_interfaces` 是否与 ArchitectureSlice 的 `new_operations` 一致？
- `module_invariants` 是否可以从你的设计决策中推导出来？
- `test_surfaces` 是否覆盖了全部对外接口？

---

### 步骤 4：编写 OperationContract（预计 45 分钟，本 Lab 最核心步骤）

OperationContract 是 VeriSpecOSLab 中**最重要的 Spec 粒度**——因为它直接告诉 Agent 每个操作"在什么条件下做什么"。Agent 生成代码时依赖的就是这些契约。

#### 本 Lab 的 OperationContract 字段集

你的每个 OperationContract 必须包含以下字段。对比 xv6-spec 的完整字段集，本 Lab 使用**简化版 + 并发**：省略 `security`、`observability`、`emitted_events` 字段，这些将在 Lab 4（中断与并发）和 Lab 5（用户空间与隔离）逐步引入。

| 字段组   | 字段                                              | 含义                           | 必填 |
| -------- | ------------------------------------------------- | ------------------------------ | :--: |
| 标识     | `id`、`module`、`operation`、`stage`      | 命名和阶段归属                 |  ✓  |
| 目的     | `purpose`                                       | 一段话说明这个操作做什么       |  ✓  |
| 依赖     | `depends_on.requires_modules`、`requires_ops` | 依赖哪些模块和操作             |  ✓  |
| 依赖假设 | `rely.state_assumptions`                        | 调用前必须满足的状态条件       |  ✓  |
|          | `rely.callable_interfaces`                      | 可调用的其他接口               |  ✓  |
|          | `rely.resource_assumptions`                     | 资源假设（如栈空间）           |  ✓  |
|          | `rely.lock_assumptions`                         | 锁假设（本阶段为 none）        |  ✓  |
| 保证效果 | `guarantee.returns`                             | 返回值约定                     |  ✓  |
|          | `guarantee.state_updates`                       | 状态变更                       |  ✓  |
|          | `guarantee.side_effects`                        | 副作用（I/O、硬件操作等）      |  ✓  |
| 正确性   | `preconditions`                                 | 前置条件                       |  ✓  |
|          | `postconditions`                                | 后置条件                       |  ✓  |
|          | `invariants_preserved`                          | 维护的不变量                   |  ✓  |
| 失败     | `failure_semantics`                             | 什么情况下失败、失败后什么状态 |  ✓  |
| 并发     | `concurrency.atomicity`                         | 原子性要求                     |  ✓  |
|          | `concurrency.lock_order`                        | 锁顺序（本阶段为空）           |  ✓  |
|          | `concurrency.interrupt_state`                   | 中断状态                       |  ✓  |
|          | `concurrency.wait_wakeup_rules`                 | 等待/唤醒规则                  |  ✓  |

#### 本 Lab 必须编写的 7 个 OperationContract

创建以下文件（放在 `spec/modules/boot/ops/`）：

> 以下模板中的 `◉` 是需要你根据自己的设计决策和平台附录填充的占位符。

##### 4a. `entry.yaml` — 入口契约

```yaml
id: boot.entry
module: boot
operation: entry
stage: boot
purpose: >
  平台入口点。所有核心从固件或 bootloader 接收控制权。
  每个核心设置自己的栈指针；仅核心 0 清零 BSS 段。
  暂存固件信息后，所有核心各自跳转到 kernel_main。

depends_on:
  requires_modules:
    - boot
  requires_ops: []

rely:
  state_assumptions:
    - "所有核心以 ◉特权级 进入，来自 ◉固件/bootloader"
    - "内存从 ◉RAM_BASE 开始可访问"
    - "◉固件通过 ◉寄存器/结构体 传递 ◉信息类型（含核心 ID）至内核"
  callable_interfaces:
    - "kernel_main(core_id)"
  resource_assumptions:
    - "每个核心的栈空间已在 BSS 中预留（大小由链接脚本定义）"
  lock_assumptions:
    - "无锁——入口阶段尚未持有任何锁"

guarantee:
  returns:
    - "void（永不返回；转移控制权至 kernel_main）"
  state_updates: []
  side_effects:
    - "每个核心的栈指针设置为各自 ◉栈顶地址"
    - "BSS 段从 _bss_start 至 _bss_end 清零（仅由核心 0 执行一次）"
    - "固件信息（含核心 ID）暂存至高级语言可访问位置"
    - "所有核心各自跳转至 kernel_main(core_id)"

preconditions:
  - "所有核心处于 ◉特权级"
  - "内存管理单元（MMU/MPU）尚未配置"
  - "中断处于禁用状态"
postconditions:
  - "每个核心拥有独立栈 + 高级语言运行环境"
  - "BSS 已清零（全局变量初始值可靠——包括 console_lock）"
invariants_preserved:
  - "BSS 仅清零一次"
  - "每个核心有独立栈（栈不共享）"
failure_semantics:
  - "未定义行为：如果 BSS 或栈与内核镜像重叠"
  - "未定义行为：如果入口代码未正确对齐或入口符号与链接脚本不一致"

concurrency:
  atomicity: "多核心并发进入；BSS 清零由核心 0 独占（通过核心 ID 判断保证单次执行）"
  lock_order: []
  interrupt_state: "所有中断禁用"
  wait_wakeup_rules: []
```

##### 4b. `bss_zero.yaml` — BSS 清零契约

```yaml
id: boot.bss_zero
module: boot
operation: bss_zero
stage: boot
purpose: >
  将 BSS 段（未初始化静态数据）的所有字节清零。
  此操作必须在任何全局变量访问之前完成。

depends_on:
  requires_modules:
    - boot
  requires_ops: []

rely:
  state_assumptions:
    - "链接脚本已定义 _bss_start 和 _bss_end 符号"
    - "栈已设置（此操作可能使用栈）"
  callable_interfaces: []
  resource_assumptions:
    - "BSS 区域不与内核其他段或 MMIO 区域重叠"
  lock_assumptions:
    - "无"

guarantee:
  returns:
    - "void"
  state_updates:
    - "BSS 区域 [_bss_start, _bss_end) 所有字节为 0"
  side_effects:
    - "遍历并写入 BSS 区域"

preconditions:
  - "_bss_start <= _bss_end"
  - "_bss_start 和 _bss_end 按 ◉平台字长 对齐"
  - "当前核心 ID == 0（其他核心不执行此操作）"
postconditions:
  - "∀ addr ∈ [_bss_start, _bss_end): *addr == 0"
invariants_preserved:
  - "BSS 区域在首次全局变量访问前已清零"
failure_semantics:
  - condition: "_bss_start > _bss_end（链接脚本错误）"
    result: "清零循环不执行或执行零次，BSS 未清零，后续全局变量读取到未定义值"
  - condition: "BSS 区域包含 MMIO 地址"
    result: "清零操作向 MMIO 寄存器写入零，可能触发意外硬件行为"

concurrency:
  atomicity: "仅核心 0 执行——通过核心 ID 判断保证独占；无需原子操作"
  lock_order: []
  interrupt_state: "中断禁用（入口阶段）"
  wait_wakeup_rules: []
```

##### 4c. `console_output.yaml` — 控制台输出契约

```yaml
id: boot.console_output
module: boot
operation: console_output
stage: boot
purpose: >
  通过平台特定的输出通道输出一个字符或字符串。
  这是内核与外部世界通信的第一条通道。

depends_on:
  requires_modules:
    - boot
  requires_ops: []

rely:
  state_assumptions:
    - "◉输出通道 已由固件初始化（如 UART 被固件配置、SBI 可用、BIOS INT 10h 可用等）"
  callable_interfaces:
    - "◉平台特定输出机制（MMIO 写入 / ecall / BIOS 中断 / EFI Simple Text Output）"
  resource_assumptions:
    - "输出通道的 MMIO 基地址或调用约定已知（在 ToolchainSpec 或平台附录中声明）"
  lock_assumptions:
    - "调用者必须持有 console_lock（通过 spinlock_acquire 获取）"

guarantee:
  returns:
    - "void"
  state_updates: []
  side_effects:
    - "字符或字符串被传输至控制台/串口"

preconditions:
  - "输出通道已初始化（由固件保证）"
  - "传入的字符或字符串为有效的可打印内容"
  - "调用者持有 console_lock"
postconditions:
  - "数据已排队或发送至输出通道"
invariants_preserved:
  - "内核内存不被输出操作修改"
failure_semantics:
  - "平台约定：控制台输出为 best-effort——如果缓冲区满，字符可能被丢弃"
  - "无错误返回（静默失败）"

concurrency:
  atomicity: "单指令（MMIO 写或 ecall）为原子操作；锁保护调用序列"
  lock_order:
    - "console_lock（由调用者在调用前获取）"
  interrupt_state: "调用者决定——大多数启动阶段输出在中断禁用下执行"
  wait_wakeup_rules: []
```

##### 4d. `boot_banner.yaml` — Boot Banner 契约

```yaml
id: boot.boot_banner
module: boot
operation: boot_banner
stage: boot
purpose: >
  返回内核启动 banner 字符串。该字符串在启动早期打印，
  用于确认内核已成功加载并开始执行。

depends_on:
  requires_modules:
    - boot
  requires_ops: []

rely:
  state_assumptions:
    - "banner 在堆分配器和任何子系统初始化之前被消费"
  callable_interfaces:
    - "console_output（打印 banner 内容）"
  resource_assumptions:
    - "banner 字符串为编译期常量，不占用运行时堆"
  lock_assumptions:
    - "无"

guarantee:
  returns:
    - "指向以 null 结尾的静态字符串的指针"
  state_updates: []
  side_effects:
    - "无（纯函数：仅返回字符串指针）"

preconditions:
  - "实现必须在 freestanding 环境中有效（无标准库）"
postconditions:
  - "返回值非空"
  - "返回值指向以 null 结尾的可打印字符串"
invariants_preserved:
  - "banner 内容在启动期间不变"

failure_semantics:
  - "无——此操作不可失败"

concurrency:
  atomicity: "无共享状态——天然线程安全"
  lock_order: []
  interrupt_state: "无关"
  wait_wakeup_rules: []
```

##### 4e. `shutdown.yaml` — 关机契约

```yaml
id: boot.shutdown
module: boot
operation: shutdown
stage: boot
purpose: >
  优雅终止系统。在 QEMU 中触发退出，在真实硬件上触发关机或重启。
  此操作不返回。

depends_on:
  requires_modules:
    - boot
  requires_ops: []

rely:
  state_assumptions:
    - "所有必要的输出（如 boot banner）已完成"
  callable_interfaces:
    - "◉平台特定关机机制（SBI SRST / ACPI 关机 / QEMU ISA-debug-exit / psci system_off）"
  resource_assumptions:
    - "无"
  lock_assumptions:
    - "无"

guarantee:
  returns:
    - "永不返回"
  state_updates: []
  side_effects:
    - "QEMU 退出或硬件关机/重启"

preconditions:
  - "系统处于可关机状态（无未完成的关键 I/O）"
postconditions:
  - "系统不再执行指令（无后置状态）"
invariants_preserved:
  - "N/A（关机后无状态）"

failure_semantics:
  - "不可失败——如果平台关机机制不可用，进入无限循环（while(1)）作为最后的兜底"

concurrency:
  atomicity: "在所有核心上停止执行"
  lock_order: []
  interrupt_state: "无关（关机后不再响应）"
  wait_wakeup_rules: []
```

##### 4f. `spinlock.yaml` — 自旋锁契约

```yaml
id: boot.spinlock
module: boot
operation: spinlock
stage: boot
purpose: >
  提供自旋锁的获取（acquire）和释放（release）操作。
  自旋锁保护多核环境下的共享资源（如控制台输出通道）。
  使用平台特定的原子指令和内存屏障。

depends_on:
  requires_modules:
    - boot
  requires_ops: []

rely:
  state_assumptions:
    - "锁变量（int flag）初始值为 0（未锁定），由 BSS 清零保证"
    - "所有核心运行在同一特权级、共享同一物理内存"
  callable_interfaces:
    - "◉平台特定原子指令（amoswap / xchg / ldxr+stxr）"
    - "◉平台特定内存屏障指令（fence / mfence / dmb）"
  resource_assumptions:
    - "锁变量位于可缓存内存中"
  lock_assumptions:
    - "spinlock 本身不依赖其他锁"

guarantee:
  returns:
    - "spinlock_acquire: void（阻塞至获取成功）"
    - "spinlock_release: void"
  state_updates:
    - "spinlock_acquire: flag 0→1（原子操作）"
    - "spinlock_release: flag 1→0（原子操作 + 释放屏障）"
  side_effects:
    - "spinlock_acquire: 原子读-修改-写 + 获取内存屏障"
    - "spinlock_release: 释放内存屏障 + 原子写"

preconditions:
  spinlock_acquire:
    - "调用者当前不持有此锁（禁止重入）"
  spinlock_release:
    - "调用者当前持有此锁（flag == 1）"
postconditions:
  spinlock_acquire:
    - "调用者独占持有此锁（flag == 1）"
    - "获取屏障确保后续读写不会被重排到锁获取之前"
  spinlock_release:
    - "锁被释放（flag == 0）"
    - "释放屏障确保之前的读写全部完成"
invariants_preserved:
  - "互斥：同一时刻最多一个核心持有锁"
  - "无死锁：单锁场景不存在死锁（前提：不重入）"
failure_semantics:
  - "spinlock_acquire 可能无限自旋（如果持有者永不释放）——调用者负责保证锁最终被释放"
  - "spinlock_release 在锁未被持有时释放会导致未定义行为"

concurrency:
  atomicity: "原子指令保证读-改-写的不可分割性"
  lock_order: []
  interrupt_state: "调用者决定——通常在中断禁用下调用以避免死锁"
  wait_wakeup_rules:
    - "spinlock_acquire: 自旋等待（不调用 wfi——短暂自旋）"
```

##### 4g. `kernel_main.yaml` — 内核主入口契约

```yaml
id: boot.kernel_main
module: boot
operation: kernel_main
stage: boot
purpose: >
  内核高级语言主入口。每个核心调用此函数。
  获取控制台锁、打印含核心 ID 的 boot banner、释放锁。
  核心 0 在所有核心输出完成后调用 shutdown。

depends_on:
  requires_modules:
    - boot
  requires_ops:
    - boot.spinlock
    - boot.console_output
    - boot.boot_banner
    - boot.shutdown

rely:
  state_assumptions:
    - "从 entry 进入，栈和 BSS 已就绪"
    - "core_id 由 entry 传入"
  callable_interfaces:
    - "spinlock_acquire, spinlock_release"
    - "console_output"
    - "boot_banner"
    - "shutdown（核心 0 在所有核心输出完成后调用）"
  resource_assumptions:
    - "每个核心有独立栈"
  lock_assumptions:
    - "console_lock 在调用 console_output 前获取、调用后释放"

guarantee:
  returns:
    - "void（核心 0 调用 shutdown 后不返回；其他核心进入自旋）"
  state_updates: []
  side_effects:
    - "每个核心获取 console_lock → 打印 banner → 释放 console_lock"
    - "banner 含核心 ID（如 'Core 0: MyOS Kernel'）"
    - "核心 0 在所有核心输出完成后调用 shutdown"

preconditions:
  - "entry 已成功完成"
  - "每个核心的栈独立且充足"
postconditions:
  - "所有核心的 banner 已完整输出（字符不交错）"
  - "核心 0 调用 shutdown（系统终止）"
invariants_preserved:
  - "banner 输出原子性：每个核心的 banner 不与其他核心交错"
  - "spinlock 获取/释放配对"
failure_semantics:
  - "非启动核心：自旋等待永远不退出（设计意图）"

concurrency:
  atomicity: "所有核心并发执行；console_lock 序列化 banner 输出"
  lock_order:
    - "console_lock（仅此一把锁）"
  interrupt_state: "所有中断禁用（启动阶段）"
  wait_wakeup_rules:
    - "spinlock_acquire: 自旋等待锁释放"
    - "非启动核心（core_id != 0）: 打印 banner 后进入 wfi 自旋"
```

**预期产物**：7 个 YAML 文件，每个包含上述字段的填充版本。

**自检点**：

- 每个契约的 `preconditions` 是否可被 `rely.state_assumptions` 满足？
- 每个契约的 `postconditions` 是否与其 `guarantee` 一致？
- `◉` 占位符是否已全部替换为你的设计决策？
- `invariants_preserved` 是否与 ArchitectureSlice 的 `invariants` 对齐？

**如果卡住**：参考 `examples/xv6-spec/spec/modules/kernel/boot/ops/*.yaml` 了解完整字段的写法——但你的契约应该反映**你的**平台选择和设计决策，不需要照抄示例。

---

### 步骤 5：编写 ToolchainSpec（预计 30 分钟）

ToolchainSpec 描述你的内核**如何构建、链接和运行**。比手写 Makefile 更精确——因为它是结构化的数据，可以被 vos 解析和验证。

#### 5a. `spec/toolchain/toolchain.yaml` — 工具链总索引

```yaml
# 工具链 Spec 入口——被 vos-runtime 消费
# 详细规格按关注点拆分为独立文件

includes:
  - link.yaml
  - run.yaml

validation:
  must_pass:
    - spec_lint
    - build_dry_run
    - generate_code
```

#### 5b. `spec/toolchain/link.yaml` — 链接布局

```yaml
# 链接规格——描述最终可执行镜像的布局

link:
  # 入口符号——固件/bootloader 跳转到的第一条指令
  entry_symbol: "◉_start"           # 替换为你的入口符号名

  # 段布局规则
  section_rules:
    - "text 段位于 ◉RAM_BASE 或固件指定的加载地址"
    - "data 段紧随 text 段"
    - "bss 段紧随 data 段"

  # 重定位模型：static（无动态链接）或 dynamic
  relocation_model: static

  # ABI 约束（查阅平台附录）
  abi_constraints:
    - "◉ABI 约定（如 riscv64 lp64d / x86-64 System V / aarch64 lp64）"
```

#### 5c. `spec/toolchain/run.yaml` — 运行参数

```yaml
# 运行规格——描述如何启动 QEMU（或其他模拟器）以及什么算"成功"

run:
  # 模拟器可执行文件（查阅平台附录）
  emulator: "◉qemu-system-riscv64"

  # 机器型号
  machine: "◉virt"

  # CPU 型号
  cpu: "◉rv64"

  # 内存大小
  memory: "◉128M"

  # 固件/BIOS
  bios: "◉default"

  # 如何传递内核镜像（-kernel / -bios / -device loader）
  kernel_arg: "-kernel"

  # 额外 QEMU 参数
  extra_args:
    - "-nographic"
    - "-no-reboot"
    - "-serial"
    - "mon:stdio"

  # 成功信号——QEMU 输出中匹配此正则表达式表示启动成功
  success_signal: "◉boot banner 中的特征字符串（如 'MyOS Kernel'）"

  # 超时（秒）——超时无匹配则视为失败
  timeout_secs: 30
```

> **注意**：`link.yaml` 和 `run.yaml` 中标记 `◉` 的字段需要查阅对应平台附录获取准确值。如果你选了 RISC-V + QEMU virt，参考 [RISC-V 参考附录](../appendices/riscv-reference.md)。如果你选了其他 ISA，你需要找到对应平台的技术文档来填写这些值——这正是"平台细节在附录"的设计意图。

**预期产物**：3 个 YAML 文件（toolchain.yaml、link.yaml、run.yaml）。

**自检点**：

- `entry_symbol` 是否与 `entry` OperationContract 中描述的操作一致？
- `section_rules` 是否与 ModuleSpec 中的内存布局描述一致？
- `success_signal` 是否能匹配你的 boot banner 输出？
- 所有 `◉` 占位符是否已根据平台附录填写？

---

### 步骤 6：运行验证门禁（预计 10 分钟）

这是你**第一次**验证你的 Spec 是否合法——在你写任何代码之前。

```bash
# 1. Spec 格式检查
vos spec lint

# 2. Spec 一致性检查（模块引用是否完整、ID 是否唯一、阶段是否匹配）
vos spec check-consistency

# 3. 构建计划检查（ToolchainSpec 能否生成合法构建计划）
vos build --dry-run
```

**预期产物**：三个命令均无错误退出。

**自检点**：

- `vos spec lint` 无 YAML 语法错误、无缺失必填字段、无 ID 冲突
- `vos spec check-consistency` 无"引用不存在的模块"、无"阶段不匹配"错误
- `vos build --dry-run` 输出一个来源合法的构建计划

**如果卡住**：

- YAML 语法错误：检查缩进（只用空格，不用 Tab）、检查字符串中的冒号需要引号包裹
- "引用不存在的模块"：检查 OperationContract 的 `depends_on.requires_modules` 是否引用了已定义的模块
- "阶段不匹配"：检查 ArchitectureSlice 和 ModuleSpec 的 `stage` 字段是否一致（都应为 `boot`）
- "构建计划无法生成"：检查 `link.yaml` 是否缺少必填字段（`entry_symbol`、`section_rules`）

---

### 步骤 7：运行代码生成（预计 10 分钟）

Spec 通过所有 lint 和一致性检查后，运行代码生成——让你的 Spec 变成可编译的代码。

```bash
# 查看 Agent 的生成计划（不实际生成代码）
vos agent plan --stage boot

# 生成代码并写入工作区
vos agent generate --apply
```

**预期产物**：

- 项目中出现生成的源文件（入口汇编/裸函数、内核主入口、控制台驱动、链接脚本、Makefile 或等价构建文件）。
- Agent 日志显示每个 OperationContract 被映射到了哪些源文件和函数。

**自检点**（生成后）：

- 生成的代码结构是否与你的 ModuleSpec 的 `exported_interfaces` 一致？
- 生成的入口代码是否反映了你的 `entry` OperationContract 的 `guarantee.side_effects`？
- 如果某些生成代码与你的预期不符——是 Spec 写得不精确，还是 Agent 的理解有偏差？记录你的发现。

> **重要**：本 Lab 的代码生成是**首次**验证你的 Spec 是否足够精确。如果你发现生成的代码与你的设计意图不一致，不要直接改代码——回到步骤 4 修改对应的 OperationContract，重新运行 `vos spec lint` 和 `vos agent generate --apply`。这正是 Spec-first 的核心理念：**改 Spec 驱动改代码，而不是反过来。**

---

### 步骤 8（进阶）：运行 QEMU 验证生成的代码

如果你已完成步骤 7 且平台工具链已安装，可以尝试运行生成的代码。

```bash
vos run qemu
```

确认 QEMU 输出中出现你的 boot banner，并在超时时间内正常退出或持续运行。

> 这一步不是 Lab 2 的硬性要求——你的平台工具链可能还没装好，或者生成的代码可能需要微调（这是 Lab 3 的主题）。把它当作"如果顺手就跑一下"的可选项。

## 3. 背景阅读

### 平台附录（必读——根据你在 Lab 1 选择的 target_platform 查阅对应文档）

| 平台      | 附录                                                                    | 关键信息                                                                     |
| --------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| RISC-V 64 | [RISC-V 参考](../appendices/riscv-reference.md) | 特权级模型、SBI 约定、入口寄存器（a0=hartid, a1=DTB）、QEMU `virt` 内存布局 |
| x86-64    | [x86-64 启动参考](../appendices/x86-boot-reference.md)                   | Multiboot2/UEFI 入口状态、保护模式/长模式切换、GDT/IDT 初始状态              |
| AArch64   | [ARM 启动参考](../appendices/arm-boot-reference.md)                      | 异常级别（EL）、U-Boot/设备树入口约定、QEMU `virt` 内存布局                 |

### 通用附录

- [附录：开发环境搭建](../appendices/dev-environment.md) — 多 ISA 工具链安装
- [附录：链接脚本指南](../appendices/linker-script.md) — 通用链接脚本结构与关键符号
- [附录：QEMU 使用指南](../appendices/qemu-guide.md) — QEMU 命令行参数与调试技巧
- [附录：AI 使用策略](../appendices/ai-policy.md) — Spec 编写中 AI 的使用边界

### Spec 编写规范

- [Spec 总论：为什么写规格](../specs/overview.md) — 七层 Spec 体系与 Spec-first 理念
- [Spec-first 工作流详解](../specs/spec-workflow.md) — 从设计到验证的完整流程（Lab 2 是首个实践案例）
- [ModuleSpec 编写指南](../specs/module-spec.md) — ModuleSpec 字段说明与示例
- [OperationContract 编写指南](../specs/operation-contract.md) — OperationContract 字段说明与示例

### 参考项目

- `examples/xv6-spec/spec/architecture/slices/01-boot.yaml` — ArchitectureSlice 参考示例
- `examples/xv6-spec/spec/modules/kernel/boot/` — 完整的 ModuleSpec 和 OperationContract 参考示例
- `examples/xv6-spec/spec/toolchain/` — ToolchainSpec 参考示例

## 4. 规格要求

### 4.1 ArchitectureSlice(boot)（必做）

创建 `spec/architecture/slices/01-boot.yaml`，定义本阶段引入了什么机制、依赖什么前序决策。

最小必填字段：`id`、`stage`、`title`、`summary`、`depends_on_slices`、`mechanisms`、`affected_modules`、`new_operations`、`invariants`、`concurrency_highlights`、`validation_binding`。

### 4.2 ModuleSpec（必做）

创建 `spec/modules/boot/module.yaml`，描述启动模块的状态、接口和不变量。

最小必填字段：`id`、`module`、`stage`、`purpose`、`related_slices`、`exported_interfaces`、`module_invariants`、`error_model`、`test_surfaces`。

### 4.3 OperationContract（必做，至少 7 个）

为以下操作编写 OperationContract（放在 `spec/modules/boot/ops/`）：

| 操作                    | 文件                    | 描述                               |
| ----------------------- | ----------------------- | ---------------------------------- |
| `boot.entry`          | `entry.yaml`          | 入口代码——所有核心从固件到高级语言的契约 |
| `boot.bss_zero`       | `bss_zero.yaml`       | BSS 段清零（仅核心 0 执行一次）        |
| `boot.console_output` | `console_output.yaml` | 通用控制台输出（平台特定实现）     |
| `boot.boot_banner`    | `boot_banner.yaml`    | Boot banner 字符串                 |
| `boot.shutdown`       | `shutdown.yaml`       | 系统关机/终止                      |
| `boot.spinlock`       | `spinlock.yaml`       | 自旋锁获取/释放——原子操作 + 内存屏障 |
| `boot.kernel_main`    | `kernel_main.yaml`    | 内核主入口——每个核心输出自己的 banner |

每个 OperationContract 必须包含：标识字段（id/module/operation/stage）、purpose、depends_on、rely（含 state/callable/resource/lock 假设）、guarantee（returns/state_updates/side_effects）、preconditions、postconditions、invariants_preserved、failure_semantics、concurrency（atomicity/lock_order/interrupt_state/wait_wakeup_rules）。

### 4.4 ToolchainSpec（必做）

创建 `spec/toolchain/toolchain.yaml`（总索引）、`spec/toolchain/link.yaml`（链接布局）和 `spec/toolchain/run.yaml`（运行参数）。

最小必填字段见步骤 5 的模板。所有平台特定值（模拟器名称、机器型号、入口符号、ABI 约定）必须查阅对应平台附录后填写。

## 5. 质量门禁

### Spec 格式门禁

```bash
vos spec lint
```

确认：

- [ ] 无 YAML 语法错误
- [ ] 无缺失必填字段
- [ ] 无 ID 冲突

### Spec 一致性门禁

```bash
vos spec check-consistency
```

确认：

- [ ] 所有 OperationContract 引用的模块在 ModuleSpec 中已定义
- [ ] 所有阶段标记一致（`stage: boot`）
- [ ] ArchitectureSlice 的 `new_operations` 与 ModuleSpec 的 `exported_interfaces` 一致

### 构建计划门禁

```bash
vos build --dry-run
```

确认：

- [ ] 无"无法解析 ToolchainSpec"错误
- [ ] 无"缺少必要字段"错误
- [ ] 构建计划可读且合理（源文件列表、编译阶段、链接步骤完整）

### 代码生成门禁

```bash
vos agent generate --apply
```

确认：

- [ ] Agent 成功生成代码（无 fatal error）
- [ ] 生成的代码结构与你 ModuleSpec 定义的接口一致
- [ ] 如果代码与预期不符，回到 Spec 修改而非直接改代码

## 6. Seed 更新

本 Lab 结束时，更新 `spec/architecture/seed.yaml`：

1. 在 `constraints` 中追加你的启动策略决策：

   ```yaml
   constraints:
     - "启动方式：◉（固件直启 / bootloader / UEFI），CPU 运行于 ◉特权级"
     - "多核策略：所有核心同时启动，spinlock 协调 banner 输出"
     - "内存布局：内核加载至 ◉加载地址，栈顶 ◉栈顶地址，栈大小 ◉栈大小"
     - "构建：◉编译器 + 自定义链接脚本"
   ```
2. 在 `architecture_summary` 中追加启动策略简述：

   ```yaml
   architecture_summary: >
     通过 ◉启动方式 启动，所有核心并发进入。
     每个核心设置独立栈，核心 0 清零 BSS。
     自旋锁保护控制台，每个核心输出含核心 ID 的 banner。
     控制台输出通过 ◉输出机制 实现。
   ```
3. 运行 `vos seed status` 确认 Lab 2 字段已填充。
4. 运行 `vos stage save --intent "boot strategy decided"`。

> 如果本 Lab 中有多个可选方案，你做出了选择，不需要写 ADR——启动方式选择是 Lab 2 的自然产出。只有当你的选择**与主流推荐显著偏离**时（如选了 UEFI 直启而非固件直启），才需要 ADR。

## 7. 设计理据要求

在 Spec 之外，用一段话（放在 ModuleSpec 的注释中或单独的设计笔记中）回答以下问题：

1. **你的启动序列为什么是这个顺序？** 有没有步骤可以调换或省略？例如：BSS 清零可以在设置栈指针之前吗？为什么？
2. **你的链接脚本中内核加载地址的由来是什么？** 这个地址是硬件规定、固件约定、还是你任意选择的？
3. **你如何保证每个核心的 banner 完整输出、不与其他核心交错？** 你的 spinlock 获取和释放之间保护了哪些操作？如果 spinlock_acquire 在某个核心上无限自旋（持有者崩溃），会发生什么？
4. **你的 console_output 的不可失败假设在什么条件下成立？** 如果你的平台实际上可能失败（如 UART 缓冲区满），你打算在什么阶段处理这个复杂度？为什么推迟？
5. **你的 BSS 清零如何保证只执行一次？** 如果核心 1 在核心 0 清零 BSS 之前访问了 BSS 中的全局变量（如 console_lock），会发生什么？你的 Spec 如何防护这种竞态？

## 8. AI 使用边界

**允许**：

- 让 AI 审查你的 Spec 的完整性（是否缺少关键的 preconditions？invariants 是否与 guarantee 一致？）
- 让 AI 解释 Spec 字段的含义和填写规范
- 让 AI 根据你的平台附录帮你填写 ToolchainSpec 中的平台特定字段（如 QEMU 机器型号、入口寄存器约定）
- 让 AI 生成 OperationContract 的骨架（你需理解每个字段的含义并填充实际内容）

**禁止**：

- 让 AI 一次性生成所有 7 个 OperationContract 而自己不逐条审查和修改
- 让 AI 直接生成代码而不通过 Spec → Agent 的正规路径
- 在 `vos agent generate --apply` 生成的代码不符合预期时，让 AI 直接改代码而不是回到 Spec 修改

## 9. 提交物

- [ ] `spec/architecture/slices/01-boot.yaml` — ArchitectureSlice
- [ ] `spec/modules/boot/module.yaml` — ModuleSpec
- [ ] `spec/modules/boot/ops/entry.yaml` — 入口 OperationContract
- [ ] `spec/modules/boot/ops/bss_zero.yaml` — BSS 清零 OperationContract
- [ ] `spec/modules/boot/ops/console_output.yaml` — 控制台输出 OperationContract
- [ ] `spec/modules/boot/ops/boot_banner.yaml` — Boot Banner OperationContract
- [ ] `spec/modules/boot/ops/shutdown.yaml` — 关机 OperationContract
- [ ] `spec/modules/boot/ops/spinlock.yaml` — 自旋锁 OperationContract
- [ ] `spec/modules/boot/ops/kernel_main.yaml` — 内核主入口 OperationContract
- [ ] `spec/toolchain/toolchain.yaml` — 工具链总索引
- [ ] `spec/toolchain/link.yaml` — 链接布局
- [ ] `spec/toolchain/run.yaml` — 运行参数
- [ ] `vos spec lint` 通过输出（终端截图或日志）
- [ ] `vos spec check-consistency` 通过输出
- [ ] `vos build --dry-run` 通过输出
- [ ] `vos agent generate --apply` 生成的代码（生成后状态，不是手写的）
- [ ] 更新后的 `spec/architecture/seed.yaml`
- [ ] 设计理据笔记（回答 §7 的五个问题）

（进阶方向：为你的 console_output 编写平台特定的子契约——例如 `uart_mmio_write` 或 `sbi_putchar`——描述具体的硬件交互；在 OperationContract 中增加性能注释——如从 `entry` 到 `kernel_main` 的预计指令数——以建立启动性能基线。）

## 10. 常见错误与排查

### 错误 1：`vos spec lint` 报 "YAML syntax error"

**原因**：YAML 对缩进和特殊字符敏感。

**排查**：

- 确保使用空格缩进（不是 Tab）
- 检查字符串中包含 `:` 的地方——必须用引号包裹（如 `"S-mode: 固件已初始化"`）
- 检查多行字符串是否正确使用 `>`（折叠换行）或 `|`（保留换行）
- 用在线 YAML 验证器检查语法：复制粘贴到 https://www.yamllint.com/

### 错误 2：`vos spec check-consistency` 报 "module not found"

**原因**：OperationContract 引用了不存在或 ID 不匹配的模块。

**排查**：

- 确认 `spec/modules/boot/module.yaml` 存在且 `id` 字段与 OperationContract 中的 `module` 引用匹配
- 检查路径：ModuleSpec 必须放在 `spec/modules/{module_name}/module.yaml`
- 确认 OperationContract 的 `depends_on.requires_modules` 中的模块名与 ModuleSpec 的 `module` 字段一致

### 错误 3：`vos build --dry-run` 报 "null entry_symbol"

**原因**：`spec/toolchain/link.yaml` 中 `entry_symbol` 的 `◉` 占位符未替换。

**排查**：

- 确认 `link.yaml` 中所有 `◉` 占位符已替换为实际值
- `entry_symbol` 必须与你平台约定一致（RISC-V 通常为 `_start`，x86-64 Multiboot2 也通常是 `_start`，UEFI 则是 `efi_main` 或类似——查阅平台附录）

### 错误 4：OperationContract 的 preconditions 与 guarantee 矛盾

**原因**：前置条件声明了某条件已满足，但 guarantee 的 side_effects 又做了建立该条件的操作。

**示例**：

```yaml
# ❌ 矛盾
preconditions:
  - "控制台已初始化"
guarantee:
  side_effects:
    - "初始化控制台并输出字符"  # 前置条件已经说控制台初始化了，为什么还要再初始化？

# ✅ 一致
preconditions:
  - "控制台已由固件初始化（uart 时钟和波特率已配置）"
guarantee:
  side_effects:
    - "通过已初始化的控制台输出一个字符"
```

**排查**：逐条对比 `preconditions`、`rely.state_assumptions` 和 `guarantee.side_effects`——是否有 A 条件要求 X 已完成但 guarantee 中又做了 X？

### 错误 5：架构层 invariants 与操作层 invariants_preserved 不对齐

**原因**：ArchitectureSlice 声明了一个不变量，但在 OperationContract 中没有哪个操作维护它。

**排查**：把 ArchitectureSlice 的 `invariants` 列表拿出来，逐个核对每个不变量是否至少在**一个** OperationContract 的 `invariants_preserved` 中出现。

### 错误 6：所有文件都没问题，但 `vos agent generate --apply` 生成的代码不工作

**原因**：Spec 的抽象层次不够精确。Agent 可以生成"语法正确"的代码，但不能生成"语义正确"的代码——除非你的 Spec 提供了足够的语义约束。

**常见遗漏**：

- 没有约束 BSS 清零的对齐粒度——Agent 可能生成逐字节清零（正确但慢）或按 8 字节清零（快但可能遗漏末尾）
- 没有约束入口代码是否保存返回地址——Agent 可能生成 `call` 而非 `j`（尾调用），导致不必要的栈使用
- 没有约束 boot banner 的输出顺序——Agent 可能先生成 banner 再初始化控制台

**解决方案**：回到步骤 4，在对应 OperationContract 的 `preconditions` 或 `guarantee.side_effects` 中增加缺失的约束，重新运行生成。这是 Spec-first 的**正常迭代循环**——不是 bug，而是 Spec 编写的一部分。

### 错误 7：banner 输出字符交错或乱码（多核竞态）

**原因**：多核并发写控制台时未正确使用锁，或锁的原子性/内存序不完整。

**排查**：
- 检查 `console_output` 的 `rely.lock_assumptions` 是否声明了需要持有 `console_lock`
- 检查 `kernel_main` 的 `guarantee.side_effects` 是否在 `console_output` 前后分别调用了 `spinlock_acquire` 和 `spinlock_release`
- 检查 `spinlock` 的 `guarantee.side_effects` 是否声明了原子操作和内存屏障——缺少 `fence` 的锁在弱内存序 CPU（RISC-V、ARM）上可能失效
- 检查 `BSS 清零` 的 `preconditions` 是否约束了"仅核心 0 执行"——如果核心 1 在 BSS 清零前访问了 `console_lock` 变量，锁的初始值可能是随机的（不一定为 0，即"未锁定"状态）
- 如果 QEMU 输出正常但真实硬件乱码：QEMU 的默认内存模型比真实硬件强——在真实 RISC-V/ARM 硬件上，缺少 `fence` 的锁几乎必定失效
