# Lab 1: 准备——理解操作系统与选择技术路线

## 1. 本 Lab 要解决什么

本 Lab 不写代码。你要做三件事：

1. **理解操作系统是什么、它解决什么问题。** 如果你只有裸机编程经验，这一节帮你建立 OS 视角。
2. **选择编程语言和目标 ISA。** 这是贯穿后续所有 Lab 的基础决策。课程提供对比指南，但选择是你自己的。
3. **初始化 VOS 项目环境，创建 Seed 骨架。** Seed 是你 OS 设计文档的起点。Lab 1 只填写身份信息（项目名、平台、语言等），架构决策会在后续每个 Lab 中逐步填入——你遇到具体设计问题时才做选择，每次选择后更新 Seed。

## 2. 从 0 起步

首先需要安装 Bun（[https://bun.sh/](https://bun.sh/)），然后安装工具链

```sh
bun install -g -f github:2018wzh/VeriSpecOSLab
```
这条命令需要在每次 lab 开始前运行一次，确保你用的是最新版本的 `vos` 工具链，然后准备在一个新目录中开始课程项目。

```sh
mkdir my-os
cd my-os

vos init
vos doctor
```

`vos init` 会创建 VOS 本地配置、默认策略、`.gitignore` 和 `AGENTS.md`。如果当前目录还不是 Git 仓库，它会先执行 `git init`。如果仓库还没有初始提交，它只会暂存并提交自己创建或维护的初始化入口文件，不会把你的草稿、下载资料或本地实验文件一起提交。

如果 `vos init` 提示缺少 Git 用户名或邮箱，先配置本仓库的 Git identity，再重新运行：

```sh
git config user.name "Your Name"
git config user.email "you@example.com"
vos init
```

## 2a. 配置 Agent

`vos init` 已经在项目根目录创建了 `AGENTS.md`。这份文件定义了 AI Agent 在本项目中的行为边界——它能读什么、改什么、用什么工具。花五分钟把 Agent 配置好，后续九个阶段你会反复用到它。

### 2a.1 Agent 是什么

VeriSpecOSLab 内置了一个项目级 AI Agent（基于 `vos-agent`），它不是你平常用的通用聊天 AI。Agent 受三层约束：

1. **身份（Identity）** — 决定 Agent 扮演什么角色。Lab 1 阶段主要用到 `knowledgebase.v1`（设计问答）。
2. **能力包（Capability Pack）** — 限制 Agent 能调用哪些工具、能读写哪些路径。
3. **阶段门禁（Stage Gate）** — 根据你当前所处的实验阶段，动态开放或关闭 Agent 的能力。阶段 1 只开放知识库查询，不允许生成代码或规格。

这三层约束的核心目的：**让 AI 帮你思考，但不替你思考。**

### 2a.2 配置 Provider

Agent 依赖 LLM provider 运行。至少配置一个 provider 的 API key。推荐同时配置两个——`smart` 模式（Anthropic）用于日常问答，`deep` 模式（OpenAI 兼容）用于复杂设计推理。

```sh
# 方案 A：只用 Anthropic（够用）
export ANTHROPIC_API_KEY="sk-ant-..."

# 方案 B：Anthropic + OpenAI（推荐）
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

如果你使用 OpenAI 兼容的第三方 provider（如 Azure、DeepSeek、本地 Ollama），额外配置 `OPENAI_BASE_URL`：

```sh
export OPENAI_BASE_URL="https://your-provider.com/v1"
export OPENAI_API_KEY="sk-..."
```

验证配置是否生效：

```sh
vos agent ask "RISC-V 的 S-mode 和 M-mode 有什么区别？为什么内核通常运行在 S-mode？"
```

如果 Agent 返回了有引用的回答，配置成功。如果报 `provider not configured`，检查环境变量是否正确 export，以及 key 是否有效。

### 2a.3 理解 AGENTS.md

打开项目根目录的 `AGENTS.md`。初始内容大致如下：

```markdown
# AGENTS.md

Guidance for agents and humans working in this VOS project.

## Project
This is a VeriSpecOSLab teaching OS project. ...

## Agent Instructions
- Inspect relevant specs and existing files before proposing patches.
- Keep changes scoped to the requested task and allowed paths.
- Do not edit generated `.vos/runs/` or `.vos/worktrees/` artifacts.
```

Lab 1 阶段你不需要修改这份文件。但理解它的作用很重要：**Agent 每次被调用时，会先读这份文件来理解你的项目约定和边界。** 后续阶段如果你引入了新的设计规则（比如"所有 syscall 编号必须从 100 开始"），你应该更新 `AGENTS.md` 让 Agent 知道。

### 2a.4 Agent 在 Lab 1 的使用方式

Lab 1 的核心任务是理解 OS 背景和选择技术路线。Agent 在这个阶段的正确用法是**问答和解释**。

**推荐的 Agent 使用模式：**

```sh
# 进入交互式问答模式
vos agent ask -i

# 然后尝试这些对话：
> RISC-V 和 x86-64 在教学场景下各有什么优劣？
> 用 Rust 写内核，no_std 环境下哪些标准库功能不可用？
> OS 的"职责边界"具体指什么？能举例说明吗？
```

**Lab 1 中 Agent 不能做的事：**

- 替你决定语言和 ISA（可以列出选项和后果，但不能说"你应该选 X"）
- 生成任何 `.c`/`.rs`/`.zig` 实现代码（阶段 1 未开放代码生成能力）
- 替你写 seed.yaml（你需要自己理解每个字段的含义）

**Lab 1 中 Agent 擅长的事：**

- 解释不同 ISA 的启动流程差异
- 对比编程语言在 OS 开发中的生态和工具链
- 回答关于 OS 基本概念的问题

### 2a.5 知识库（KB）准备

Agent 的设计问答依赖知识库。Lab 1 你需要导入语言和 ISA 相关的参考资料。具体步骤见下方 [§7 导入知识库](#7-导入知识库)。

这里先记住一点：**知识库是你的 Agent 的"记忆"。只有你导入的资料，Agent 才能在设计问答中引用。** 每个阶段开始前，导入该阶段需要的参考资料——不要一次性导入所有资料，避免 Agent 的检索质量下降。

---

## 3. 操作系统是什么

在选语言和 ISA 之前，先回答一个更基本的问题：操作系统到底是什么？

### 3.1 一个简短的历史视角

理解操作系统最好的方式不是背定义，是看它怎么一步一步变成今天这样的。

**1940s-1950s：没有操作系统的时代。** 程序员直接操作硬件——插拔电缆、设置开关。一台计算机一次只跑一个程序。程序崩溃？整台机器停摆。

**1950s：批处理的诞生。** 把多个程序攒成一批，一个接一个地跑。这叫"批处理监控程序"——操作系统的雏形。但它解决的是效率问题，不是易用性问题。

**1960s：多道程序与分时系统。** IBM OS/360 让多个程序"同时"驻留内存——一个程序等 I/O 时 CPU 跑另一个。MIT CTSS 让多个用户通过终端"同时"使用一台计算机。**分时系统的出现，让"隔离"和"保护"成为操作系统的核心命题。**

**1970s：Unix 的时代。** Ken Thompson 和 Dennis Ritchie 在贝尔实验室写了 Unix。Unix 带来了几个影响深远的决定：一切皆文件、层级文件系统、Shell 作为普通用户程序、管道（`|`）作为 IPC 原语。Unix 哲学：**"Do one thing and do it well."**

**1980s-1990s：微内核之争。** Tanenbaum vs Torvalds。宏内核（Linux）赢了市场，微内核（seL4）赢了安全性。这场论战的核心启示：**没有"最好"的内核架构，只有最适合你目标的架构。** 你将在 Lab 5 中正式决定你的内核架构。

**2000s-至今：虚拟化、容器、Unikernel。** 操作系统设计的边界在持续扩展。

**这段历史对你的意义**：你在后续 Lab 中要做的每个设计决策——内存模型、进程抽象、文件系统——是上述历史的直接延续。你知道历史，你的选择就是有理由的设计判断。

### 3.2 裸机 vs OS：同一件事的两种做法

如果你只有单片机裸机编程经验（STM32、Arduino），你可能会问：我的程序直接操作硬件跑得很好，为什么需要操作系统？

考虑一个简单的任务：让 LED 每秒闪烁一次，同时在串口输出 `"Hello"`。

**在裸机上**，你需要大约 50 行代码，其中 40 行是硬件初始化——查数据手册找寄存器地址、配置时钟树、设置 GPIO 模式、计算波特率。代码绑定特定芯片型号，换一块开发板就要重写 80%。

**在 OS 上**，不到 20 行代码。没有寄存器地址。没有时钟树配置。同一份代码可以在 x86 PC、ARM 树莓派、RISC-V 开发板上编译运行。

```c
// 裸机：直接操作寄存器
volatile uint32_t *GPIOC_ODR = (volatile uint32_t *)0x4001100C;
*GPIOC_ODR ^= (1 << 13);  // 翻转 LED
for (volatile int i = 0; i < 500000; i++);  // 忙等延时

// OS：通过抽象接口
FILE *led = fopen("/sys/class/leds/user-led/brightness", "w");
fputc('1', led);  // 亮
sleep(1);
```

核心差异：

| 维度 | 裸机 | OS 环境 |
|------|------|---------|
| 硬件访问 | 直接读/写物理寄存器地址 | 通过驱动 + syscall |
| 可移植性 | 绑定特定芯片 | 同一源码跨硬件运行 |
| 多任务 | 不存在，while(1) 独占 CPU | 调度器自动分配时间片 |
| 内存安全 | 全靠程序员不越界 | MMU 隔离——程序崩溃不影响内核 |
| 开发效率 | 40 行硬件初始化 / 10 行业务逻辑 | 10 行完成全部任务 |

> **延伸阅读**：如果你有裸机编程经验，建议阅读 [附录：裸机编程参考](../appendices/stm32-bare-metal-lab.md)。该附录以 STM32F103 为例，展示了同一任务在裸机和 OS 环境下的完整代码差异——包括多任务上下文切换的汇编实现。

### 3.3 OS 的职责边界

每个操作系统在三个维度上做文章。理解这三个维度有助于你在后续 Lab 中判断"这件事应该是内核做还是用户态做"。

**资源抽象与复用。** CPU 只有一个（或几个），跑的程序有几十个。你怎么让每个程序都觉得"自己独占 CPU"？基本思路是快速切换——一个程序跑几毫秒，切换到下一个。内存也是——物理 RAM 是一块连续的，但每个程序看到的是私有的"虚拟地址空间"。

**隔离与保护。** 资源复用产生了新问题：程序 A 怎么保证程序 B 不会偷看它的内存？答案是 MMU——把每个程序的虚拟地址翻译成物理地址的过程中检查权限。程序 A 的地址 X → 物理地址 Y，程序 B 的地址 X → 物理地址 Z——各自以为在同一个地址，实际上被硬件强制分离。

**服务与接口。** 用户程序怎么请求内核做事？通过 syscall——用户程序通过一条特殊指令（RISC-V 的 `ecall`）"叫"内核，内核在更高特权级执行请求，返回结果。这个接口的设计决定了你的 OS 的"性格"——它暴露了什么抽象？隐藏了什么细节？

这三个维度贯穿全部后续 Lab：Lab 3（内存管理）主要是"隔离与保护"，Lab 5（用户空间）主要是"服务与接口"，Lab 6（文件系统）和 Lab 7（资源模型）主要是"资源抽象与复用"。

---

## 4. 选择你的技术路线

在创建 Seed 骨架之前，你需要做出两个基础决策：目标 ISA 和编程语言。这些决策会在后续 Lab 的设计中反复影响你的选择。

### 4.1 选择 ISA

本课程支持所有主流 ISA。各 ISA 的关键差异在后续 Lab 中会以对比形式标注。这里给出快速概览：

| 维度 | RISC-V 64 | AArch64 (ARMv8) | x86-64 |
|------|-----------|-----------------|--------|
| 特权级 | M/S/U 三级，清晰分层 | EL3/EL2/EL1/EL0 四级 | Ring 0/1/2/3，历史包袱重 |
| 页表 | Sv39 (3级)，规范约100页 | VMSAv8-64 (4级)，规范复杂 | 4-level PML4，历史兼容多 |
| 中断控制器 | PLIC（平台级），简单清晰 | GICv3/v4，功能丰富但复杂 | APIC/x2APIC，最复杂 |
| syscall | `ecall` 指令，统一入口 | `svc` 指令，统一入口 | `syscall`/`sysenter`，历史遗留多 |
| 教学友好度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |

**默认推荐：RISC-V 64 + QEMU `virt`。**

理由：
- RISC-V 的规范简洁——特权级规范约 100 页，x86 的相应文档超过 2000 页
- QEMU `virt` 机器是课程工具链的一等公民——所有示例、测试和验证脚本基于此配置
- 参考资料最丰富——xv6-riscv 是课程的主要参考系统

> 选择 x86-64 或 ARM 不会受到惩罚。你需要付出额外的自行调研工作，并理解课程工具链对你的 ISA 的支持程度。

### 4.2 选择编程语言

内核可以用多种系统编程语言编写。没有一种在所有维度上最优——你的选择取决于你最看重什么。

| 维度 | C | Rust (no_std) | Zig |
|------|---|---------------|-----|
| 内存安全 | 完全依赖程序员纪律 | 编译期所有权+借用检查杜绝 use-after-free 等 bug 类别 | 编译期无所有权检查；提供 `defer`、错误联合类型等防御工具 |
| 代表项目 | Linux、xv6、FreeBSD、seL4 | Redox（微内核）、Tock（嵌入式RTOS）、rCore、Theseus | Bun（JS运行时）、TigerBeetle（金融DB） |
| 构建系统 | Make/CMake/Meson | Cargo + `rustup target add` | `build.zig` 可编程构建；`zig cc` 可作为 C 编译器 |
| 交叉编译 | 需手动安装目标工具链 | `rustup target add` | `zig build -Dtarget=riscv64-freestanding` |
| 学习曲线 | 语法简单（~32关键字），UB 陷阱隐蔽且多 | 所有权+借用+生命周期需数周适应 | 语法中等，`comptime` 是独特优势 |
| 内核开发资料 | 最丰富（xv6、Linux、seL4 等） | 快速增长（rCore 教程、Rust OSDev） | 较少但增长中 |
| 适合你的场景 | 想把精力全花在 OS 设计上 | 想用编译器消灭内存 bug | 想要一流交叉编译体验 |

**默认推荐：C。** 理由：
- 参考资料最丰富——xv6、xv6-riscv book、OSDev wiki 中的大多数示例使用 C
- 语法简单——你不会花数周学习语言特性，而是直接进入 OS 设计
- "内存不安全"在教学场景中反而是优势——你会亲身经历 buffer overflow 如何摧毁内核，从而深刻理解 MMU 和隔离的价值

> 选择 Rust 或 Zig 不会受到惩罚。你需要额外投入时间学习语言特性，但在后续 Lab 中你可能获得更少的调试时间（Rust 编译期检查）或更好的构建体验（Zig 交叉编译）。

### 4.3 默认推荐路径

如果你不确定怎么选，以下是最低风险的组合：

```
ISA:   RISC-V 64 + QEMU virt
语言:   C
构建:   Make + RISC-V GNU 工具链
```

这不是"正确答案"——不存在唯一正确答案。这是一条**参考资料最丰富、踩坑最少**的路径。你当然可以偏离它——只要你在后续的 ADR 中说清楚理由。

---

## 5. 创建 Seed 骨架

Seed（`spec/architecture/seed.yaml`）是你 OS 设计文档的核心。**在 Lab 1，你只填写身份信息**。其他字段——goals、non_goals、reference_systems、validation_binding——在后续 Lab 中逐步填充。

创建目录：

```sh
mkdir -p spec/architecture
```

### 5.1 最小 Seed 骨架

创建 `spec/architecture/seed.yaml`，填入以下字段。标记 `(TODO)` 的字段在后续 Lab 中补充：

```yaml
# ============================================================
# Lab 1 填写：身份信息
# ============================================================
id: my-os-seed
project: my-os
domain: teaching-operating-system
target_platform: riscv64-qemu-virt    # 或 x86-64/arm64，见 §4.1
language: c                            # 或 rust/zig，见 §4.2
architecture_name: my-os
architecture_summary: >
  用一句话说明你的 OS 目标和主要取舍。
  （此时可以模糊——后续 Lab 中你会逐步细化这句话。）

# ============================================================
# Lab 2 填写：启动策略
# ============================================================
constraints:
  - "TODO: Lab 2 填入启动方式、bootloader 选择、内存布局约束"

# ============================================================
# Lab 3 填写：内存模型
# ============================================================
# constraints 追加：分页模型、物理内存范围
# TODO: Lab 3

# ============================================================
# Lab 4 填写：设备与中断模型
# ============================================================
# TODO: Lab 4

# ============================================================
# Lab 5 填写：内核架构 + 进程模型 + syscall 策略
#   这是种子最重要的更新节点。
#   goals, non_goals, reference_systems 在此阶段首次填写。
# ============================================================
goals:
  - "TODO: Lab 5 填入至少 3 条具体目标"
non_goals:
  - "TODO: Lab 5 填入至少 3 条明确排除的内容"
reference_systems:
  # TODO: Lab 5 填入参考系统及 borrow/modify/reject 分析

# ============================================================
# Lab 6 填写：文件系统策略
# ============================================================
# TODO: Lab 6

# ============================================================
# Lab 7 填写：资源模型
# ============================================================
# TODO: Lab 7

# ============================================================
# Lab 8 填写：个性化目标
# ============================================================
# TODO: Lab 8

# ============================================================
# Lab 9 填写：硬件移植约束
# ============================================================
# TODO: Lab 9

# ============================================================
# Final Lab 汇总：validation_binding 汇总
# ============================================================
initial_validation_binding:
  - "TODO: 各 Lab 的验证判据在对应阶段收集，Final Lab 汇总"
```

### 5.2 为什么 Seed 是逐步填充的

在 Lab 1 就要求你决定内核架构、参考系统和设计目标，有三个问题：

- **没有上下文的选择只能是猜。** 你连分页机制都没见过，就要判断"参考 xv6 的 Sv39 还是 Linux 的 5-level paging"。
- **早期决策推翻时没有记录机制。** 后面 Lab 发现之前选错了，改了代码，但 seed 没人更新，设计意图和实现逐渐脱节。逐步填充要求每次变更都走 ADR，seed 跟着改，演化路径可追溯。
- **一次性填满像填表。** 所有字段一次填完，学生倾向于把 seed 当成作业模板而不是设计工具。在你真正面对一个设计问题时再写对应的 seed 字段，你写下的每个决策都绑着一个你亲手撞过的墙。

### 5.3 如何更新 Seed（后续 Lab 中使用）

在每个后续 Lab 结束时，你会：

1. 根据该 Lab 的设计问题，填写 seed.yaml 中对应的 `TODO` 字段
2. 如果有与已有决策冲突的新选择，写 ADR 记录"为什么改变主意"
3. 运行 `vos seed status` 检查填充进度
4. 运行 `vos stage save` 保存本阶段状态

> 详细指引见每个 Lab 的"Seed 更新"小节，以及 [ArchitectureDesignSpec 编写指南](../specs/architecture-design-spec.md) 中的"Seed 演化"章节。

---

## 6. 检查与保存

完成 seed 骨架和 KB 导入后，运行：

```sh
vos spec lint          # 对空白字段不报错，只检查已填字段格式
vos stage save --intent "initialize project and create seed skeleton"
```

> **注意**：`vos arch lint` 在 Lab 1 不强制——seed 中还没有足够的内容供架构检查。该命令从 Lab 2 开始启用。

---

## 7. 导入知识库

先把项目 spec 加入本地 KB：

```sh
vos kb add spec --source-kind project --recursive
```

再按你的技术路线导入对应参考资料。

**如果你选择了默认推荐路径（C + RISC-V）：**

```sh
# RISC-V 基础
vos kb add docs/reference/riscv-privileged-manual.pdf --source-kind course --title "RISC-V Privileged Spec"

# C 语言 OS 开发
vos kb add docs/reference/xv6-book.pdf --source-kind course --title "xv6 book"
```

**如果你选择了 Rust：**

```sh
vos kb add docs/reference/rust-embedded-book.pdf --source-kind course --title "Rust Embedded Book"
vos kb add docs/reference/rcore-tutorial.pdf --source-kind course --title "rCore Tutorial"
```

**如果你选择了 Zig：**

```sh
vos kb add docs/reference/zig-bare-metal.pdf --source-kind course --title "Zig Bare Metal Guide"
```

验证导入：

```sh
vos kb list
```

---

## 8. 质量门禁

自动检查：

- [ ] `vos doctor` 通过。
- [ ] `seed.yaml` 存在，`id`/`project`/`domain`/`target_platform`/`language`/`architecture_name`/`architecture_summary` 均已填写。
- [ ] `vos spec lint` 通过（对空白字段不报错）。
- [ ] `vos kb list` 能看到项目 spec 和至少一份与你技术路线相关的参考资料。
- [ ] `vos stage save --intent "initialize project and create seed skeleton"` 已完成阶段保存。

手动检查：

- [ ] 理解 OS 的三个职责维度（资源抽象、隔离保护、服务接口），能用自己的话解释。
- [ ] 语言和 ISA 的选择有理由（不是随机选的）。如果是默认推荐路径，至少要理解"为什么推荐这个组合"。
- [ ] seed.yaml 的 `architecture_summary` 不是空话——虽然此时不需要精确，但要反映出你大致的意图方向。

---

## 9. AI 使用边界

允许：

- 让 AI 解释不同 ISA 的差异（如"RISC-V PLIC 和 ARM GIC 的中断模型有什么不同？"）。
- 让 AI 对比语言在 OS 开发中的优劣。
- 让 AI 解释 OS 的基本概念（如"什么是 MMU？""什么是特权级？"）。
- 让 AI 审查 seed 骨架格式是否正确。

不允许：

- 让 AI 替你决定语言和 ISA。
- 让 AI 替你写 `architecture_summary`。
- 让 AI 生成实现代码（阶段 1 未开放代码生成能力）。
- 跳过 Lab 1 直接进入 Lab 2（seed 骨架是后续所有 Lab 的前提）。

---

## 10. 提交物

- 代码仓库地址
- `vos doctor` 输出摘要
- `seed.yaml` 文件（Lab 1 身份字段已填写）
- `vos kb list` 输出摘要
- `vos spec lint` 输出摘要
- `vos stage save --intent "initialize project and create seed skeleton"` 的完成摘要
