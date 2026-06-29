# ArchitectureCompositionSpec 编写指南

CompositionSpec 描述跨模块的组合不变量。它回答的问题是：**当我把这些模块拼在一起时，什么性质必须保持？**

## 为什么需要 CompositionSpec

单个模块可能各自正确，但组合起来出错。例如：

- 内存模块正确隔离了用户页表，但 syscall 模块在 copyin 时未检查用户指针边界
- 进程模块正确管理了 PID，但文件系统模块在记录文件所有者时使用了已释放的 PID

CompositionSpec 强制你在模块边界处显式定义不变量。

## 推荐目录

```text
spec/composition/
  process-memory-isolation.yaml
  syscall-mm-trap.yaml
  fd-pipe-process.yaml
```

## 字段说明

```yaml
id: "process-memory-isolation"
title: "进程间内存隔离"
related_slices: ["myos-slice-03-memory", "myos-slice-05-process"]
affected_modules: ["kernel/memory", "kernel/vm", "kernel/process"]

cross_component_rules:
  - name: "user_page_isolation"
    description: "进程 A 的页表中不存在映射到进程 B 用户内存的条目"
    invariant: "对任意两个不同的进程 A 和 B，进程 A 的页表中不存在 PTE 其 PPN 指向 B 的用户物理页且 U 位为 1"
    authority_boundary: "页表切换由 scheduler 和 exec 控制"
    concurrency_boundary: "页表修改只在持有进程锁时进行"
    failure_boundary: "违反此不变量意味着 fork 或 exec 实现有 bug"
    tests: ["pt_fork_isolation", "pt_exec_isolation"]

  - name: "kernel_memory_not_leaked_to_user"
    description: "用户页表中不存在指向内核物理内存的映射"
    invariant: "任意用户页表中不存在 PTE 其 PPN 指向内核保留区域且 U 位为 1"
    authority_boundary: "map_page 必须检查目标地址范围和 U 位"
    concurrency_boundary: "map_page 调用者必须持有页表锁"
    failure_boundary: "违反此不变量意味着权限检查缺失"
    tests: ["kernel_memory_leak_check"]
```

## 组合规则的质量要求

1. **必须指出受影响模块**，而不能只说"内存隔离很重要"这种空话。
2. **不变量必须可验证**，最好能写成不变量检查器。
3. **必须说明失败边界**：如果此不变量被违反，可能是什么模块的什么操作出了问题。
4. **必须说明并发边界**：在什么锁保护下此不变量成立？

## 组合规则的层次

组合规则通常分三个层次：

### 正确性组合

"如果 A 做 X 且 B 做 Y，整个系统不会出错。"

例如："syscall 传递的用户指针必须指向用户地址空间（由 VM 模块保证）内的有效区域（由进程模块保证）"

### 安全组合

"模块 A 不能以模块 B 不允许的方式访问模块 B 的资源。"

例如："文件系统模块不能直接读取进程模块的私有内存，必须通过 VM 提供的 copyin/copyout"

### 资源生命周期组合

"资源 X 的生命周期在模块 A 和模块 B 之间如何协调？"

例如："一个 inode 只有在所有引用它的 fd 都关闭后，才能被释放"

## 建议的 CompositionSpec 最少要求

课程最终要求至少 1 个跨组件不变量。以下是最低建议：

| 组合 | 不变量 |
|------|--------|
| process ↔ memory | 用户进程间内存隔离 |
| syscall ↔ memory ↔ trap | 用户指针通过 syscall 传递时的安全验证链 |
| fd ↔ file ↔ fs | 文件描述符、file 结构和 inode 之间的引用一致性 |
| pipe ↔ process | pipe 的读写端与进程生命周期的协调 |
