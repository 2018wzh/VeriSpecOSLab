# Lab 1: 操作系统初步 — 定义你要构建的 OS

## 1. 设计问题

在写任何代码之前，你必须回答：我要构建一个什么样的操作系统？它的目标是什么？参考了谁？拒绝了什么？

本 Lab 不涉及任何代码实现。你的所有产出都是规格文件和分析文档。

## 2. 设计空间

你必须在这个阶段做出以下关键设计决策。**没有"标准答案"，只有你自己的答案。**

| 决策 | 你需要回答的问题 |
|------|----------------|
| 内核架构 | 宏内核、微内核、混合内核还是其他？这个选择如何影响你后续阶段的设计？ |
| 目标平台 | RISC-V 64？ARM？x86？QEMU 还是真实硬件？什么机器型号？ |
| 设计目标 | 教学清晰性？兼容已有 ABI？安全性？特定性能指标？优先级如何排序？ |
| 系统 ABI | 用什么可执行格式？syscall 的调用约定？大概提供哪些 syscall 类别？ |
| 参考系统 | 参考了哪些 OS？借鉴了什么？修改了什么？拒绝了什么？为什么？ |
| 范围边界 | 什么在你的 OS 范围内？什么明确不在？ |

## 3. 背景阅读

在动笔之前，建议你先了解：

- 至少 2 个已有教学 OS 的整体架构（推荐 xv6 和 seL4，它们代表了两种不同的设计哲学）
- RISC-V 特权规范（至少了解 M/S/U 三级特权的基本概念）
- 你选择的目标平台的基本信息（QEMU `virt` 机器的内存布局、外设列表）
- [Spec-first 工作流详解](../specs/spec-workflow.md) — 理解你接下来要做的事情在整体流程中的位置

## 4. 规格要求

### 4.1 ArchitectureSeed（必做）

创建 `spec/architecture/seed.yaml`，包含以下必填字段：

```yaml
id:             # 你的项目唯一标识
project:        # 项目名称
domain:         # "teaching-os"
target_platform: # 如 "riscv64-qemu-virt"
architecture_name: # 你的 OS 名称
architecture_summary: # 一句话描述

reference_systems:  # 至少 1 个参考系统
  - system:         # 参考系统的名称
    borrowed_concepts: []  # 借鉴的概念
    modified_concepts: []  # 修改的概念（可为空）
    rejected_concepts: []  # 拒绝的概念（至少 1 项）
    reason:          # 拒绝的理由

goals: []           # 你的目标（至少 3 项）
non_goals: []       # 你的非目标（至少 3 项）
constraints: []     # 技术约束
initial_validation_binding: []  # 验证判据（至少 3 项，可测试）
```

详细字段说明见 [ArchitectureDesignSpec 编写指南](../specs/architecture-design-spec.md)。

### 4.2 CompositionSpec 骨架（必做）

创建 `spec/architecture/composition.yaml`，写出至少 1 条初始的跨组件规则。在阶段 1，这条规则可以很简单，例如：

```yaml
cross_component_rules:
  - name: "内核模块通过函数调用交互"
    description: "所有内核模块编译为单一镜像，模块间通过直接函数调用交互"
```

### 4.3 知识库导入（必做）

使用 `vos kb add` 导入至少 2 份参考资料。例如：

```bash
vos kb add docs/reference/riscv-privileged-manual.pdf
vos kb add docs/reference/xv6-book.pdf
```

## 5. 质量门禁

### 规格门禁

```bash
vos arch lint    # 检查架构规格的内部一致性
```

手动检查：
- [ ] `goals` 和 `non_goals` 均非空且具体
- [ ] `reference_systems` 至少 1 个，包含至少 1 项 `rejected_concepts` 且附 `reason`
- [ ] `initial_validation_binding` 中的每项都是可测试的
- [ ] `constraints` 包含 ISA 和目标平台

### 知识库门禁

```bash
vos kb list       # 确认至少 2 条记录
```

## 6. 设计理据要求

完成本 Lab 后，你必须能回答以下问题（不需要写在文档里，但最终答辩会被问到）：

1. 你选择的架构形式的理由是什么？你考虑过什么替代方案？
2. 你拒绝了参考系统中的什么概念？如果现在重新选择，还会拒绝吗？
3. 你的 OS 最大的设计约束是什么？这个约束会如何影响阶段 2（启动）和阶段 3（内存管理）的设计？
4. 你的 OS 的 `non_goals` 中，哪一项最可能在未来某个阶段因为实际情况变成 `goal`？

## 7. AI 使用边界

**允许**：
- 让 AI 审查你的 ArchitectureSeed 草稿，指出可能遗漏的设计维度
- 让 AI 解释参考系统中的概念（如"seL4 的 capability 模型和 Unix fd 模型的核心区别是什么"）
- 让 AI 建议可能的 `rejected_concepts`（但你需要自己判断是否真的拒绝）

**限制**：
- AI 不能替你写 ArchitectureSeed——目标和设计哲学必须是你的

**禁止**：
- 跳过 ArchitectureSeed 直接进入阶段 2

## 8. 提交物

- `spec/architecture/seed.yaml` — 你的 ArchitectureSeed
- `spec/architecture/composition.yaml` — CompositionSpec 骨架
- 知识库导入确认（`vos kb list` 的输出）

（以下为进阶探索方向，可在 ArchitectureSeed 中预留空间：是否设定可形式化验证的目标？是否考虑多 ISA 移植？如果目标兼容 Linux ELF，哪些 syscall 是必须实现的？）
