# VeriSpecOSLab 实验指导书

## 本指导书的定位

这份指导书不是"照着做就一定能得到正确答案"的操作手册。它是一份**设计导航**——告诉你每个阶段要解决什么问题、要考虑哪些设计维度、要产出什么规格制品、要通过哪些质量门禁。至于你选择什么算法、设计什么数据结构、定义什么 syscall 接口，都是你自己的决策，不是指导书预先给出的答案。

指导书的组织方式反映了 VeriSpecOSLab 的核心教学理念：

> **以规格约束 AI，以验证保障正确，以架构设计训练系统掌控能力。**

## 阅读路径

### 学生路径

```text
Start Here（本页）
    ↓
Lab 1：初始化项目与目标制定 → 准备课程运行环境
    ↓
Book：按章节阅读 → 理解每个阶段的设计问题
    ↓
Labs：按 Lab 卡片执行 → 完成设计、规格、实现、验证
    ↓
Specs 手册：随时查阅 → 学习如何写好规格
    ↓
Final Lab：综合集成、失败分析、最终报告
```

**首次进入**：先读本页 → 回到 [Book 第 0 章](book/ch00-overview.md) 了解课程全貌 → 打开 [Lab 1](labs/lab1-seed.md)，按其中的 0 起点流程安装 `vos`、初始化项目、检查课程运行环境并完成 ArchitectureSeed。

**日常实验**：打开当前 Lab 卡片 → 阅读"设计问题"和"设计空间" → 编写对应 Spec 制品 → 实现 → 运行验证命令 → 检查质量门禁。

### 教师 / 助教路径

从 [Teacher 手册](teacher/course-plan.md) 进入，包含课程计划、阶段门禁配置、评分细则、AI 审计策略和答辩题库。

## 一站四册

本指导书由四个部分和一个入口组成：

| 部分 | 路径 | 读者 | 内容 |
|------|------|------|------|
| **Book** | `book/` | 学生 | 教材型章节，描述每个阶段的设计空间、背景知识和典型路线 |
| **Labs** | `labs/` | 学生 | 实验卡片，列出设计问题、规格要求、质量门禁和提交物 |
| **Specs** | `specs/` | 学生 | 规格写作手册，教你怎么写 ArchitectureSeed / ModuleSpec / OperationContract 等 |
| **Appendices** | `appendices/` | 学生 | 工具参考：vos 命令、QEMU、GDB、RISC-V、AI 策略等 |
| **Teacher** | `teacher/` | 教师/助教 | 课程计划、评分细则、门禁策略、AI 审计、答辩题库 |

## 9 阶段路线图

| # | 阶段 | 核心设计问题 |
|---|------|-------------|
| 1 | 操作系统初步 | 我要构建一个什么样的 OS？ |
| 2 | 最小内核启动 | 从硬件复位到内核第一条指令的路径？ |
| 3 | 内存管理 | 物理内存如何管理？虚拟地址空间如何组织？ |
| 4 | 中断与设备驱动 | 如何响应外部世界？设备如何被发现和驱动？ |
| 5 | 用户空间 | 用户态与内核态的边界？进程抽象？syscall 机制？ |
| 6 | 文件系统 | 数据如何可靠持久化？一致性和崩溃安全？ |
| 7 | 资源模型与 ABI | 系统资源如何抽象暴露给用户？ |
| 8 | 个性化剖面 | 我的 OS 的独特剖面是什么？方向如何组合？ |
| 9 | 移植到实际硬件 | 如何在真实硬件上运行？ |
| — | Final Lab | 综合集成、失败分析、最终报告 |

## 前置知识

开始本课程前，你应该已经掌握：

- **系统编程语言**：C、Rust 或 Zig 中的一种——能够操作指针、管理内存、理解调用约定
- **基本的汇编语言概念**：寄存器、调用约定、栈（不需要精通）
- **基本的计算机组成原理**：CPU、内存、总线、MMIO
- **Git 基本操作**

你不需要预先掌握：

- 任何特定操作系统的内核源码
- 特定 ISA 的汇编（设计原理跨 ISA 通用）
- YAML 或规格语言（本课程会教）

**关于 ISA**：本指导书的设计原理适用于 RISC-V、ARM、x86-64 等所有主流 ISA。各 ISA 的关键差异在 Book 各章节中以对比形式标注。

**关于语言**：本指导书支持 C、Rust、Zig 等系统编程语言。语言选择的考量在[第 1 章](book/ch01-design-space.md)中详细说明。

## 设计哲学

本指导书遵循三条核心约束：

1. **描述设计问题，不预设实现方案。** 指导书会告诉你"这个阶段必须解决资源命名和生命周期管理的问题"，但不会告诉你"用 file descriptor table"。
2. **定义质量门禁，不指定通过方式。** 指导书会告诉你"分配器不能返回已被分配的页"，但不会告诉你"用 freelist 还是 buddy"。
3. **要求设计理据，不接受"就是这样"。** 每个设计决策都需要记录在 ArchitectureSlice 或 ADR 中：你借鉴了什么？修改了什么？拒绝了什么？为什么？

## PDF 导出

教学交付版 PDF 由仓库内的 Bun workspace 脚本生成，不依赖本机安装的 Pandoc、TeX 或浏览器。首次导出前安装依赖和本地 Chromium：

```sh
cd vos
bun install
bun run manual:pdf:install
```

按 Lab 组织生成教学交付 PDF：

```sh
bun run manual:pdf
```

默认输出到项目根目录下的 `dist/manual/`。入口 `README.md` 不会进入 PDF；每个 Lab 目录包含对应的教材章节和实验卡片，例如：

```text
dist/manual/
  lab1/
    lab1-book.pdf
    lab1-lab.pdf
  lab2/
    lab2-book.pdf
    lab2-lab.pdf
  final-lab/
    final-lab-book.pdf
    final-lab-lab.pdf
  shared/
    shared-specs.pdf
    shared-appendices.pdf
    shared-vos.pdf
  teacher/
    teacher.pdf
```

该目录是生成产物，不纳入版本控制。需要指定标题或输出目录时：

```sh
bun run manual:pdf -- --title "VeriSpecOSLab 实验指导书" --output-dir ../dist/manual
```

## 许可证与引用

本指导书是 VeriSpecOSLab 项目的一部分。设计文档位于 `docs/design/`。参考实现示例位于 `examples/xv6-spec/`。
