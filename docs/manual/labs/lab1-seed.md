# Lab 1: 项目初始化与操作系统初步

## 1. 本 Lab 要解决什么

本 Lab 的重点不是马上写代码，而是把项目从空目录推进到一个可检查、可追踪的 VOS 项目，并写出第一版 ArchitectureSeed。

你要先回答一个问题：这个 OS 为什么存在？目标确定后，再选择内核架构、目标平台、ABI、参考系统和验证判据。后续阶段遇到取舍时，都要回到这份 seed 看你的目标和 non-goals。

## 2. 从 0 起步

以下命令假设你已经安装 Bun，并准备在一个新目录中开始课程项目。

```sh
bun install -g github:2018wzh/VeriSpecOSLab

mkdir my-os
cd my-os

vos --project-root . init
vos --project-root . doctor
```

`vos init` 会创建 VOS 本地配置、默认策略、`.gitignore` 和 `AGENTS.md`。如果当前目录还不是 Git 仓库，它会先执行 `git init`。如果仓库还没有初始提交，它只会暂存并提交自己创建或维护的初始化入口文件，不会把你的草稿、下载资料或本地实验文件一起提交。

如果 `vos init` 提示缺少 Git 用户名或邮箱，先配置本仓库的 Git identity，再重新运行：

```sh
git config user.name "Your Name"
git config user.email "you@example.com"
vos --project-root . init
```

## 3. 目标先行

在写 `seed.yaml` 之前，先写下三类内容：

- 你最想训练或证明的能力，例如教学清晰性、Linux 静态 ELF 兼容、capability 隔离、启动速度或可验证性。
- 你明确不做的事情，例如网络、多用户、动态链接、完整 POSIX、真实硬件移植。
- 你的约束，例如一学期时间、单人项目、RISC-V 64 + QEMU `virt`、C/Rust/Zig 中的一种语言。

目标要能影响设计。比如“教学清晰性优先”会推向更少的抽象层和更简单的 syscall 集；“安全隔离优先”可能推向 capability 或微内核；“兼容 Linux 静态 ELF”会让 ABI、ELF loader 和 syscall 编号更早变成硬约束。

## 4. 规格文件

创建目录：

```sh
mkdir -p spec/architecture
```

### 4.1 ArchitectureSeed

创建 `spec/architecture/seed.yaml`。至少包含这些字段：

```yaml
id: my-os-seed
project: my-os
domain: teaching-operating-system
target_platform: riscv64-qemu-virt
architecture_name: my-os
architecture_summary: >
  用一句话说明你的 OS 目标和主要取舍。

reference_systems:
  - system: xv6-riscv
    borrowed_concepts:
      - "例如：Sv39 分页和简单进程模型"
    modified_concepts:
      - "例如：缩小 syscall 集合"
    rejected_concepts:
      - "例如：暂不做多核"
    reason: "说明为什么借鉴、修改或拒绝这些机制。"

goals:
  - "至少 3 条，必须具体。"
non_goals:
  - "至少 3 条，说明本项目不优化或不实现什么。"
constraints:
  - "写清 ISA、目标平台、语言、工具链和时间约束。"
initial_validation_binding:
  - "至少 3 条可检查判据，例如 qemu_boot_smoke。"
```

详细字段见 [ArchitectureDesignSpec 编写指南](../specs/architecture-design-spec.md)。

### 4.2 CompositionSpec 骨架

创建 `spec/architecture/composition.yaml`，写出至少一条跨组件规则。阶段 1 的规则可以很朴素，但要和你的目标一致。

```yaml
id: my-os-composition
title: Initial Architecture Composition
summary: >
  第一版跨组件规则，用于约束后续 boot、memory 和 syscall 设计。

cross_component_rules:
  - name: boot-before-memory
    description: "启动路径必须先建立可观察输出，再进入后续内存管理工作。"
    invariant: "boot 阶段失败时必须留下串口日志或 VOS evidence。"
    affected_modules: [kernel/boot, kernel/memory]
    tests: [qemu_boot_smoke]
```

## 5. 导入知识库

先把项目 spec 加入本地 KB：

```sh
vos --project-root . kb add spec --source-kind project --recursive
```

再按你的设计目标导入至少一份参考资料。资料可以来自课程发放的本地文件，也可以是你自己选择的公开参考资料。

```sh
vos --project-root . kb add docs/reference/xv6-book.pdf --source-kind course --title "xv6 book"
vos --project-root . kb list
```

如果你选择微内核、capability、Linux ELF 兼容或硬件移植，参考资料也应对应这些目标。不要只导入和自己路线无关的材料。

## 5a. 可选：裸机编程参考阅读

> 如果你有 STM32 或 Arduino 裸机编程经验，建议在写 ArchitectureSeed 之前阅读 [附录：裸机编程参考](../appendices/stm32-bare-metal-lab.md)。该附录以 STM32F103 为例，对比展示了同一任务在裸机和 OS 环境下的完整代码差异，帮助你明确"我的 OS 至少要抽象掉哪些裸机细节"。

读完后，在 ArchitectureSeed 的 `design_notes` 中记录你的发现：

```yaml
design_notes:
  - "基于裸机对比参考，本 OS 至少需要抽象：(1) 硬件无关的输出接口，(2) 非忙等的延时机制，(3) 多任务间的内存隔离"
```

---

## 6. 检查与保存

完成 seed、composition 和 KB 导入后，运行：

```sh
vos --project-root . doctor
vos --project-root . spec lint
vos --project-root . spec check-consistency
vos --project-root . arch lint
vos --project-root . kb list
vos --project-root . stage save --intent "complete architecture seed"
```

`architecture-seed` 阶段还不要求 `.vos/toolchain.json`。从 boot 阶段开始，`vos doctor` 会继续检查工具链 manifest 和其中声明的构建、运行、验证工具。

## 7. 质量门禁

自动检查：

- [ ] `vos doctor` 通过，或只留下与后续 boot 工具链相关的可解释提示。
- [ ] `vos spec lint` 通过。
- [ ] `vos spec check-consistency` 通过。
- [ ] `vos arch lint` 通过。
- [ ] `vos kb list` 能看到项目 spec 和至少一份与你目标相关的参考资料。
- [ ] `vos stage save --intent "complete architecture seed"` 已完成阶段保存。

手动检查：

- [ ] `goals` 和 `non_goals` 都具体，能影响后续设计选择。
- [ ] 参考系统不是标签式引用，写清借鉴、修改和拒绝的具体机制。
- [ ] 至少一项拒绝理由说清了代价或边界。
- [ ] `initial_validation_binding` 都能落到可观测检查，不写“系统稳定”“体验良好”这类空泛目标。
- [ ] CompositionSpec 至少包含一条和目标相关的跨组件规则。
- [ ] （可选）完成裸机对比实验，ArchitectureSeed 中记录了至少一条"本 OS 需要抽象掉的裸机细节"。

## 8. AI 使用边界

允许：

- 让 AI 解释参考系统的机制。
- 让 AI 审查 seed 草稿是否目标过大、non-goals 太少、验证判据不可测。
- 让 AI 提醒你某个目标会影响哪些后续阶段。

不允许：

- 让 AI 替你决定目标和设计哲学。
- 直接跳过 ArchitectureSeed 进入 boot 代码。
- 把没有理解的参考系统机制写进 borrowed_concepts。

## 9. 提交物

- `spec/architecture/seed.yaml`
- `spec/architecture/composition.yaml`
- `vos kb list` 输出摘要
- `vos doctor`、`vos spec lint`、`vos spec check-consistency`、`vos arch lint` 输出摘要
- `vos stage save --intent "complete architecture seed"` 的完成摘要
