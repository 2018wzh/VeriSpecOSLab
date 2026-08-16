# Lab 2：最小内核启动——用 Spec 描述从硬件到第一条指令

> **对应教材**：[第 2 章：最小内核启动](../book/ch02-boot.md)

> **本 Lab 概览**
>
> - **学完能做什么**：用 YAML Spec 精确描述启动序列的行为和契约，让 Agent 从你的 Spec 生成能通过 QEMU 启动的内核，并读懂串口证据。
> - **预计耗时**：10–14 小时，建议安排 1 周。**本 Lab 不要求学生手写实现代码**，时间花在 Spec 设计、工具链投影、Agent 实现审查与验证上。
> - **前置依赖**：已完成 Lab 1（DesignSpec 已提交），阅读第 2 章和你在 Lab 1 选定板卡的启动文档。
> - **产出物**：`spec/modules/kernel/boot.yaml`（L3）、更新后的工具链 ModuleSpec 与 `vos.yaml`、启动实现、QEMU 串口 evidence、clean HEAD 验证结果。

## 1. 设计问题

从硬件上电到你的内核输出第一条消息，这条路径上发生了什么？你的内核如何从固件手中接管控制权？最小的可运行内核需要建立什么执行环境？

你需要用 Spec 来回答，先想清楚**行为**和**不变量**，再让工具链和 Agent 帮你把行为映射到具体代码。

> **本 Lab 的核心转变**：在传统 OS 实验中，你会直接写 `_start` 汇编和 `kernel_main` C 代码。在这个 Lab 中，你**不写任何实现代码**。你写的是：启动序列必须完成哪些操作、每个操作的前置条件和后置条件是什么、启动过程中维护什么不变量。代码由 Agent 生成，你审查代码是否符合你的 Spec。

## 2. 设计空间

> **关于内核架构**：此时你还不必决定宏内核还是微内核，这个选择推迟到 Lab 5。Lab 2-4 默认沿宏内核路径（所有内核模块在同一地址空间），这是最简单、参考资料最丰富的路线。如果你已有明确计划走微内核，先按宏内核走完 Lab 2-4，到 Lab 5 再通过设计理由切换。

| 决策     | 你需要回答的问题                                                              | 对应 Spec 制品                                    |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| 启动序列 | 固件→内核的交接状态是什么？从入口到主初始化之间需要哪些步骤？                | `entry` + `kernel_main` ModuleSpec 操作条目     |
| 启动方式 | 固件直启、bootloader 还是 UEFI？每种方式把 CPU 留在什么特权级、给你什么信息？ | ModuleSpec 顶层 `rely` 与 `entry.pre` |
| 多核策略 | 多个核心同时启动还是主从模式？非启动核心如何等待？                            | ModuleSpec 的 concurrency 契约（内联到各 ModuleSpec 操作条目）     |
| 内存布局 | 栈放哪里？代码和数据段的加载地址？BSS 在哪里？                                | `spec/modules/toolchain.yaml` 与 `vos.yaml` |
| 输出通道 | 你的内核通过什么机制输出第一条消息？UART MMIO？SBI ecall？BIOS INT 10h？      | `console_output` ModuleSpec 操作条目              |
| 构建链路 | 什么编译器？链接脚本定义了什么入口符号和段布局？                              | `spec/modules/toolchain.yaml`                 |
| 验证手段 | 如何确认启动成功？banner 内容检查还是超时检测？                               | `vos.yaml` 的 QEMU runner 与 public check |

> **预读**：[Book 第 1 章](../book/ch01-overview-design.md) §1.10.3 问题三（ISA 差异）和 §1.9（为什么先设计再写代码）。平台特定细节见本章末尾的[参考卡](#4-参考卡)。

## 2a. 设计决策引导

以下每个问题不是选择题，你需要**想清楚**你的设计，然后把答案写到对应的 Spec 字段中。

### 决策 1：启动方式

你选择的启动方式决定了入口时 CPU 的状态。这些状态必须写入 ModuleSpec 顶层 `rely` 和 `entry.pre`。

| 路径                 | 典型场景                                                |     入口特权级     | 你需要查询的信息                                          |
| -------------------- | ------------------------------------------------------- | :----------------: | --------------------------------------------------------- |
| **固件直启**   | RISC-V OpenSBI → kernel；ARM TrustedFirmware → kernel |    S-mode / EL1    | 固件通过哪些寄存器/结构体传递信息？内存布局是否已初始化？ |
| **Bootloader** | GRUB/Multiboot2、Limine、U-Boot                         |   保护模式 / EL2   | bootloader 提供的启动信息结构体格式？页表是否已建立？     |
| **UEFI 直启**  | 直接生成 PE/COFF 镜像由 UEFI 固件加载                   | 32/64-bit 保护模式 | UEFI Boot Services 是否还可用？GOP/ACPI 表地址？          |

**设计自检**：

- 你在 Lab 1 的 `spec/design.yaml` 中声明了什么 ISA、QEMU 机器和 canonical board？对照本章的启动参考卡和板卡手册确认入口状态。
- 入口时的特权级是什么？你需要自己提升特权级，还是固件已经帮你做好了？
- 固件/bootloader 通过什么机制传递硬件信息（设备树、ACPI、Multiboot info structure）？

### 决策 2：入口代码的最小集合

无论你选择什么语言写内核（C/C++/Rust/Zig），有一小段代码**必须**用汇编（或语言内置的裸寄存器操作）完成。你需要想清楚的只有一件事：**哪些操作绝对不可能用高级语言完成？**

答案在几乎所有平台上是相同的三个：

1. **设置栈指针**：高级语言没有直接设置栈寄存器的语法（这是 ABI 约定的一部分，编译器自动管理，但入口时栈还不存在）
2. **跳转到高级语言入口**：控制流从汇编转移到高级语言（对于某些语言，这还涉及调用约定的对齐要求）
3. **暂存固件信息**：固件通过寄存器传递的信息（核心 ID、设备树指针、启动信息结构体指针），必须在调用高级语言函数前保存到高级语言能访问的位置

此外，**BSS 清零**在大多数情况下也在入口汇编中完成，它不是必须用汇编，而是它正好在"栈已就绪、高级语言尚未进入"的窗口里。

> 关于 Rust/Zig：如果你选择了这些语言，`#[no_mangle] pub extern "C" fn _start()` 或 Zig 的裸入口函数可以替代汇编文件，但你仍然需要处理栈指针设置。查阅对应语言的 freestanding/OS 开发指南。

**设计自检**（写入 ModuleSpec 顶层 `guarantee` 和 `entry.post`）：

- 入口代码结束时，栈指针指向哪里？BSS 是否已清零？固件信息是否已保存到可访问位置？
- 你的入口代码是尾调用（`j` / `b` / `tail`）还是常规调用（`call` / `bl`）？这对栈有什么影响？

### 决策 3：栈的大小和位置

教学 OS 的栈通常设为 4–16 KiB。你可以先设一个值，后面需要时再调整。

栈的位置有两个通用约束（与平台无关）：

- 不能在代码段或数据段内部（会互相覆盖）
- 不能覆盖内存映射 I/O（MMIO）区域

一种通用的内存布局结构（具体地址查阅架构手册、QEMU 机器文档和板卡手册）：

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
- 查阅本章参考卡和板卡手册：RAM 的起始地址和典型大小是多少？内核加载地址是多少？
- 栈大小写在哪里？是链接脚本中的符号，还是代码中的常量？工具链 ModuleSpec 和 `vos.yaml` 分别需要记录什么？

### 决策 4：BSS 清零的策略

BSS 清零的方法取决于你的语言选择和入口实现：

| 方案                         | 适合                              | 注意事项                                                                              |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| **入口汇编中循环清零** | 所有语言，最通用                  | 注意清零粒度（逐字节 vs 按平台字长），确保 BSS 大小不是字长的整数倍时不会漏清末尾字节 |
| **调用 memset**        | C/C++，如果 memset 已在入口前实现 | 增加依赖：memset 必须在 BSS 清零前可用                                                |
| **语言运行时负责**     | Rust/Zig（运行时通常处理 BSS）    | 需确认你的 freestanding 目标是否保留了此行为                                          |

**设计自检**：

- 你的 BSS 清零操作是否处理了非对齐大小？把条件写入对应操作的 `pre` 和 `post`。
- BSS 清零的边界符号（`_bss_start`、`_bss_end`）由链接脚本定义。工具链 ModuleSpec 说明约束，`vos.yaml` 只负责执行构建与检查命令。

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
    读取当前核心 ID（方式见架构手册和固件启动约定）
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
        自旋等待（`wfi`、`hlt` 或 `yield` 的语义见架构手册）
```

**为什么需要锁？** 控制台输出（UART/SBI）通常不是多核安全的。如果两个核心同时向 UART 的 THR 寄存器写入，字符会交错，Core 0 写 `'H'`、Core 1 写 `'X'`，输出变成 `"HXelXlHoX"`。自旋锁确保每次只有一个核心在操作输出通道。

**自旋锁的最小设计**：一个整数标志位（0=未锁定，1=已锁定）+ 原子"测试并设置"指令（如 RISC-V 的 `amoswap`、x86 的 `xchg`、ARM 的 `ldxr/stxr`）+ 内存屏障（如 RISC-V 的 `fence`、x86 的 `mfence`、ARM 的 `dmb`）。

> **为什么不是纯 "while (flag) {}"？** 普通的 while 循环不提供原子性和内存序保证。两个核心可能同时读到 `flag==0`、同时写入 `flag=1`、都认为"我拿到了锁"，这就是经典的"丢失更新"竞态。原子指令和内存屏障缺一不可。自旋锁的实现细节在后续 ModuleSpec 操作条目中展开。

**设计自检**：
- 你的平台如何获取当前核心 ID？这项假设写在顶层 `rely`，还是 `entry.pre`？
- 每个核心的栈是独立的吗？栈大小和位置如何由工具链 ModuleSpec 约束，并由构建目标落实？
- BSS 清零只执行一次，你的 Spec 如何保证 core 1 不会在 core 0 清零 BSS 之前访问 BSS 中的全局变量？
- 你的自旋锁使用什么原子指令和内存屏障？查阅架构手册，并在 HAL 边界记录这些差异。

> 多核启动的并发约束直接写在 ModuleSpec 顶层 `concurrency` 中，例如原子性、锁顺序、入口中断状态和非启动核心的等待规则。对外部状态的假设写入 `rely`，模块承诺写入 `guarantee`；单个操作的局部条件仍写在对应的 `pre` 和 `post`。

## 2b. 逐步操作指引

Lab 2 把前面的启动分析收敛到一个 L3 ModuleSpec、工具链 ModuleSpec 和结构化 `vos.yaml`。技术细节仍由学生决定，文件形状由严格 schema 约束。

### 步骤 1：讨论并手写启动模块

```sh
vos agent ask "启动模块的状态、并发假设和可观察错误应如何区分？"
```

启动模块通常需要 L3，因为它包含多核协作、内存序和中断状态。Ask Agent 只用于澄清概念，下面的内容要由学生写入 `spec/modules/kernel/boot.yaml`：

- 稳定 `id`、`module`、`level: 3` 和明确 `purpose`；
- 只覆盖启动实现与相应测试的 `owns`；
- `entry`、`bss_zero`、`console_output`、`boot_banner`、`shutdown` 等操作；
- 可验证的 properties、错误语义和模块不变量；
- state、preconditions、postconditions 和 dependencies；
- concurrency、rely、guarantee 和 algorithm_intent。

先按最小字段骨架填写，不要复制现成答案：

```yaml
id: kernel/boot
module: kernel/boot
level: 3
purpose: TODO
owns:
  - TODO_IMPLEMENTATION_PATH
  - TODO_TEST_PATH
interface:
  - name: TODO_OPERATION
    pre:
      - TODO
    post:
      - TODO
    errors:
      - TODO
    properties:
      - TODO
properties:
  - TODO
errors:
  - TODO
state:
  TODO_STATE: TODO
preconditions:
  - TODO
postconditions:
  - TODO
invariants:
  - TODO
dependencies:
  - toolchain
concurrency:
  TODO_CONCURRENCY_FIELD: TODO
rely:
  - TODO
guarantee:
  - TODO
algorithm_intent: TODO
```

`owns` 是 Agent 的硬边界，只能使用仓库相对路径，不能包含 `..`、绝对路径、Spec 文件、`.git` 或 `.vos`。操作契约直接写在 `interface` 中，不再创建独立操作文件；并发契约也直接写在模块文件中。

### 步骤 2：lint、评审与手动提交

```sh
vos spec lint kernel/boot
vos agent review kernel/boot -i
# 学生按建议修改 spec/modules/kernel/boot.yaml
vos spec lint kernel/boot
git add spec/modules/kernel/boot.yaml
git commit -m "[spec][boot] Define Lab 2 boot contract"
```

非交互评审中只有 blocker 会让命令返回 `validation_failed`。交互评审始终是建议，不替学生改文件或提交。

### 步骤 3：描述工具链与运行投影

`spec/modules/toolchain.yaml` 说明工具链模块的职责、状态和性质；`vos.yaml` 只保存可执行投影。不要把 shell 字符串塞进 `program`，也不要把参数拼成一行。

```yaml
version: vos.project.v1
build:
  program: make
  args: [all]
  cwd: .
  env: [PATH, TOOLPREFIX]
  timeout: 180000
  artifacts:
    - build/kernel.elf
runners:
  qemu:
    program: qemu-system-riscv64
    args:
      - -machine
      - virt
      - -nographic
      - -kernel
      - build/kernel.elf
    cwd: .
    env: [PATH]
    timeout: 30000
    artifacts:
      - build/qemu-boot.log
    workload: boot-smoke
    success_pattern: 'XV6_BOOT_OK(?:\r?\n|$)'
    failure_pattern: 'panic|PANIC|fatal|FATAL|unexpected trap'
checks:
  boot_banner:
    kind: public
    program: sh
    args: [tests/public/boot.sh]
    cwd: .
    env: [PATH]
    timeout: 30000
    verifies:
      - kernel/boot
```

示例中的程序名、镜像参数、成功/失败模式和产物路径必须按所选平台调整。所有 `cwd` 与 artifact 都是仓库相对路径；`env` 只是允许继承的变量名。QEMU 建议使用非图形串口，避免图形界面让日志采集失去确定性。成功模式应匹配完整、稳定的完成标记，失败模式则覆盖 panic、致命错误和未预期 trap。两者都没命中时，超时仍会单独报告为 `timed_out`。

这里的 `runners.qemu` 只负责启动你的项目和采集证据。它与 Lab 9 的 QEMU 板级移植命令不是一回事：`vos run qemu` 不会修改 QEMU 源码；`vos agent qemu preflight/execute` 也不会替你补全这个 runner 或改写 `vos.yaml`。如果后续进行板级 QEMU 移植，仍要保留当前 runner 的 QEMU 回归，并另外记录 QemuSpec 的版本、材料和机器模型 commit。

**结构约束自检：**

- `qemu-system-*` 命令必须有 `-nographic`，不能依赖图形窗口判断成功；
- `success_pattern` 与 `failure_pattern` 都要是有效正则，且不能把半条 banner、panic 前的输出或退出码缺失误判为通过；
- QEMU 日志和镜像产物写到仓库相对路径，运行身份绑定当前 build/HEAD；
- 机器名、内存、固件和 UART 参数来自当前 ISA/QEMU 文档，不能把 `virt` 的固定地址直接当作 canonical board 的硬件事实。

### 步骤 4：先验证 Spec 和构建投影

```sh
vos spec lint kernel/boot
vos build
```

`vos spec lint` 检查未知字段、重复 ID、引用、等级、路径、`owns` 和 `vos.yaml` 映射。`vos build` 执行 `vos.yaml` 的结构化 argv。构建失败时保留原始 stdout、stderr、退出码和 target；不要用兜底命令掩盖真实错误。

脏树允许开发态 build，但 evidence 会标记为不可提交。在调用 Agent 实现前，把 Spec 和工具链投影提交干净。

### 步骤 5：让 Agent 实现启动模块

```sh
git status --short
vos agent implement kernel/boot
```

`implement` 要求 clean HEAD 和已提交 Spec。Agent 在 detached linked worktree 中生成实现与 public/contract/fuzz/trace/hidden tests，VOS 校验 target 提案后更新 `vos.yaml`，再运行 build 与全部非隐藏门禁。成功后，若原工作树 HEAD 未漂移且所有实现和测试改动都落在允许的 `owns` 中，VOS 才会创建 `[vos][agent] Implement boot` 提交。

以下情况不会修改原工作树：

- 构建、公开测试或契约检查失败；
- 修改越过允许的 `owns`；
- 原工作树 HEAD 在运行期间发生变化；
- Agent 主动中止；
- 达到 `maxIterations`。

如果启动实现确实需要改动其他模块，先手写并提交 `spec/patches/<patch>.yaml`，说明 `changes` 和新的组合不变量。VOS 根据 patch 推导受影响模块与回归范围；不要用扩大单个模块 `owns` 的方式绕开边界。

### 步骤 6：运行并核对串口证据

```sh
vos run qemu
```

至少检查：

- QEMU 在超时内启动；
- 串口日志包含稳定 banner；
- panic、异常和重启不会被成功正则误判；
- 多核启动时每条 banner 完整，不出现字符交错；
- build identity 与当前 HEAD 一致。

开发态运行允许脏树，但 evidence 不可提交。要形成权威证据，先清理工作树，再运行 `vos verify`。

### 步骤 7：确定性验证

```sh
vos verify
```

`verify` 要求 clean HEAD，并依次执行 spec lint、build、全部 public、contract、固定种子 fuzz 和有界 trace targets。它不调用模型；本地 hidden tests 只在显式运行 `vos verify --hidden` 时执行。每个 `checks` target 都应通过 `verifies` 绑定稳定 Spec ID；启动阶段至少覆盖 `kernel/boot`。

## 3. 设计审查问题

提交前，用自己的话回答：

1. 固件交给内核时，特权级、寄存器和内存状态分别是什么？
2. 为什么必须先建立栈，再调用高级语言入口？
3. BSS 清零如何保证只发生一次，其他核心如何观察到完成状态？
4. 链接地址来自硬件、固件、镜像格式还是你的选择？
5. 控制台输出失败或无限等待时，系统如何暴露错误？
6. QEMU 成功条件如何避免把 panic 文本或半条 banner 当成通过？

## 4. 参考卡

- [Book 第 2 章：启动](../book/ch02-boot.md)：固件、复位向量、ELF、链接、栈、BSS、UART 和多核启动。

链接脚本至少要明确 `ENTRY`、加载地址与链接地址、代码/只读数据/数据/BSS 的边界、栈位置和对齐约束。入口地址来自镜像格式、固件约定或你的平台选择，不能把 QEMU 的默认地址直接当作板卡事实。修改链接脚本后，先用符号表和最小串口标记确认入口、栈和 BSS，再进入复杂初始化。

RISC-V、x86-64 和 AArch64 的特权级、寄存器、页表和启动传参不同。正文只保留本 Lab 需要的入口状态、栈、BSS、核心启动、输出和关机问题；具体字段回到所选 ISA 规范、QEMU 机器文档和板卡手册核对。把这些差异放在启动 HAL 中，核心启动状态机只依赖统一语义。

如果未来从 QEMU `virt` 移植到真实板卡，补画 `Boot ROM → SPL/TPL → OpenSBI/UEFI → U-Boot → 内核` 的交接图。记录 U-Boot 的 `defconfig`、DTB、`mmc`/SPI 探测、镜像格式、加载地址、`bootargs` 和入口寄存器；`fatload`/`booti` 成功只证明加载链路，不能证明内核已经完成 SDIO/SPI、DMA/cache 或文件系统初始化。

ModuleSpec 的 L1/L2/L3、操作契约、并发字段和跨模块 SpecPatch 已在本 Lab 的字段骨架和检查项中展开。不要从仓库内部手册复制旧字段，也不要把 `owns` 扩大成平台万能写权限。

## 5. 质量门禁

- [ ] `spec/modules/kernel/boot.yaml` 为 L3，结构校验通过。
- [ ] `owns` 只包含启动实现和相关公开测试。
- [ ] 每个操作都有 pre、post、errors 和可验证性质。
- [ ] 工具链命令全部使用 `program + args`，没有 shell 字符串拼接。
- [ ] boot public check 的 `verifies` 包含启动模块稳定 ID。
- [ ] `vos build` 通过。
- [ ] `vos run qemu` 采集到非图形串口日志。
- [ ] clean HEAD 上的 `vos verify` 通过。
- [ ] Agent 成功时生成独立实现提交；失败时原工作树不变。

## 6. AI 使用边界

Agent 可以解释启动链、生成入口汇编草案和审查 Spec 字段。学生必须亲自决定启动方式、内存布局与多核策略，并核对 Agent 生成的实现是否符合 Spec。`implement` 失败时保留诊断，不要用跳过门禁的参数换取通过。

## 7. 提交物

- [ ] `spec/modules/kernel/boot.yaml`；
- [ ] 更新后的 `spec/modules/toolchain.yaml`；
- [ ] 更新后的 `vos.yaml`；
- [ ] 启动实现与公开测试；
- [ ] QEMU 串口 evidence；
- [ ] clean HEAD 上的验证结果；
- [ ] 如有跨模块变更，对应的已提交 SpecPatch。

## 8. 常见问题与排查

### `vos spec lint` 报未知字段

当前 ModuleSpec 使用严格 schema。不要加入旧版阶段关联字段，也不要创建独立的操作或并发规格文件；把这些语义写入现有 ModuleSpec。

### `vos agent implement kernel/boot` 拒绝启动

先检查工作树是否干净，ModuleSpec 是否已提交，以及 `owns` 是否覆盖目标实现。不要使用跳过门禁的参数。

### QEMU 有输出但 target 超时

核对串口设备、`-nographic`、成功条件和超时。保留原始日志；如果日志缺少关键状态，先补充可观测性，再修改判断条件。

### Agent 修改了工具链文件

启动模块不能拥有 `vos.yaml`、Makefile 或工具链测试。先回退候选变更；如果这是必要的架构调整，手写并提交 SpecPatch，让允许范围变成 boot 与 toolchain 两个模块 `owns` 的并集。
