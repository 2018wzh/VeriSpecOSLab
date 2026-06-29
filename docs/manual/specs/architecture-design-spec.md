# ArchitectureDesignSpec 编写指南

ArchitectureDesignSpec 是架构层的规格集合，由 ArchitectureSeed、ArchitectureSlice、ADR 和 CompositionSpec 组成。

## ArchitectureSeed：你的 OS 的出生证

ArchitectureSeed 回答一个根本问题：**我要构建一个什么样的 OS？**

这不是随意填写的表单——它是你后续所有设计决策的根基。之后的每个 ArchitectureSlice、每个 ADR 都应该可以从 ArchitectureSeed 中找到动机。

### 最小字段

```yaml
id: "student-os-2026"
project: "MyOS"
domain: "teaching-os"
target_platform: "riscv64-qemu-virt"
architecture_name: "MyOS"
architecture_summary: "一个面向学习的宏内核，参考 xv6 但使用更现代的..."

reference_systems:
  - system: "xv6-riscv"
    borrowed_concepts:
      - "进程模型：fork/exec/wait 生命周期"
      - "文件系统：inode 为基础的磁盘布局"
    modified_concepts:
      - "调度器：从 round-robin 改为 MLFQ"
    rejected_concepts:
      - "sleeplock：改用 mutex + condition variable"
    reason: "sleeplock 的语义过于隐式，mutex 更清晰"

goals:
  - "能在 QEMU virt 机器上启动并运行用户程序"
  - "支持至少 3 个并发进程"
  - "文件系统支持基本 CRUD 操作"
non_goals:
  - "不追求高性能"
  - "不支持网络"
  - "不支持多用户"
constraints:
  - "使用 RISC-V 64 位"
  - "使用 Sv39 分页"
  - "内核使用 C 语言"
initial_validation_binding:
  - "QEMU 启动后输出 kernel banner"
  - "通过基础内存分配测试"
```

### 质量要求

1. **不允许只写标签**。`reference_systems` 不能只写 `Linux-like` 或 `L4-like`。必须说明具体借鉴了什么、修改了什么、拒绝什么、为什么。
2. **goals 和 non_goals 必须同时存在**。只说"我要做什么"而不说"我不做什么"会导致范围蔓延。
3. **constraints 必须具体**。不要写"高性能"，写"syscall 延迟 < 10μs"。
4. **validation_binding 必须可测**。不要写"系统稳定运行"，写"通过 47 项公开测试"。

## ArchitectureSlice：每阶段的增量设计

每个实验阶段产出一个 ArchitectureSlice，描述本阶段引入的机制。

### 最小字段

```yaml
id: "myos-slice-03-memory"
stage: "memory-management"
title: "物理页分配与 Sv39 分页"

depends_on_slices: ["myos-slice-02-boot"]
depends_on_adrs: ["ADR-001-paging-model"]

mechanisms:
  - name: "物理页分配器"
    description: "基于 freelist 的物理页分配，支持 kalloc/kfree"
  - name: "Sv39 分页"
    description: "3 级页表，内核 identity mapping，用户空间独立页表"

affected_modules: ["kernel/memory", "kernel/vm"]
new_operations: ["kalloc", "kfree", "kinit", "setup_kernel_pagetable", "map_page"]

invariants:
  - "freelist 中无重复页"
  - "保留区域页从不被分配"
  - "内核页表覆盖全部内核代码和数据"

validation_binding:
  - "page_alloc_free 测试通过"
  - "reserved_region_not_allocated 测试通过"
  - "paging_enabled 后内核继续正常运行"
```

### Slice 的依赖关系

每个 Slice 声明它依赖哪些前序 Slice 和 ADR。这形成了一条可追溯的设计链——你可以从任意 Slice 向前追溯到最初的 ArchitectureSeed。

## ADR：关键决策记录

当一个设计决策有多个可选方案、有重要 tradeoff、或者可能被后续挑战时，写入 ADR。

### 最小字段

```yaml
id: "ADR-001-paging-model"
date: "2026-03-15"
status: "accepted"  # proposed | accepted | deprecated | superseded
decision: "使用 Sv39 虚拟内存，3 级页表，4 KiB 页大小"
context: "RISC-V 支持 Sv39/Sv48/Sv57。教学场景下 Sv39 足矣。Sv48 和 Sv57 增加了页表层级但不增加教学价值。"
alternatives:
  - "Sv48：页表多一级，但增加了实现复杂度"
  - "BARE：无分页，但无法实现用户/内核隔离"
tradeoffs:
  - "Sv39 的 512 GB 虚拟地址空间对教学场景足够"
  - "3 级页表遍历比 Sv48 的 4 级更快，但支持的内存更少"
affected_specs: ["spec/modules/kernel/memory/module.yaml"]
verification_impact: "需要验证 3 级页表遍历正确性"
```

### 什么时候需要 ADR

- 你做了一个有争议的选择
- 你在两个可行方案之间做了取舍
- 你的选择可能影响后续阶段
- 你的选择与常见做法不同

### 什么时候不需要 ADR

- 实现细节（"我用了宏而不是函数"）
- 编程风格选择（"我用 4 空格缩进"）
- 显而易见的决定（"我用 C 而不用 Python 写内核"）

## FinalArchitectureSynthesis

课程末期生成的综合视图，汇总：
- 整体架构图
- 所有 Slice 的时间线
- 所有 ADR 的决策网络
- 最终组合不变量
- 个性化目标的验证结果

它不是重写历史，而是让历史可追溯的综合。
