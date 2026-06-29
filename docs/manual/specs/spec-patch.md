# SpecPatch 编写指南

SpecPatch 用于记录规格的演化。当你的设计需要变更时，**先修改规格（通过 SpecPatch），再修改代码**。不能跳过规格直接改代码。

## 为什么需要 SpecPatch

设计不是一成不变的。你会遇到以下情况：

- 最初的设计在实现时发现不可行
- 两个模块的接口在组合时发现不匹配
- 个性化目标引入的新机制需要修改既有规格
- 测试失败暴露出规格中的漏洞

SpecPatch 让这些变更**可追溯**——任何人在任何时候都能理解：这个规格为什么变了、从什么变成什么、影响范围多大。

## SpecPatch vs Git Commit

SpecPatch 不是 Git commit 的替代品，而是 commit 的**语义补充**：

- **Git commit** 是不可变的历史记录，记录了"什么文件变了"。
- **SpecPatch** 是语义解释，记录了"为什么变、从什么变成什么、影响是什么"。
- 两者协同：SpecPatch 引用 commit SHA 作为审计锚点，commit message 中引用 SpecPatch ID。

## 推荐目录

```text
spec/evolution/
  patch-001-initial-spec.yaml
  patch-002-fix-page-alloc-invariant.yaml
  patch-003-cow-fork.yaml
```

## 完整字段

```yaml
id: "patch-003-cow-fork"
stage: "syscall-ipc"
title: "引入 Copy-on-Write fork"
reason: >
  当前 fork 直接复制全部用户页（uvmcopy），导致大进程 fork
  非常慢且浪费内存。引入 CoW 机制，父子进程共享只读页，
  写入时触发 page fault 后复制。

kind: "architecture_change"  # architecture_change | module_change | operation_change | toolchain_change

# Git 锚点
commit_sha: "abc123def456"         # 实现此变更的 commit
parent_sha: "789xyz012uvw"         # 变更前的 commit
spec_commit_sha: "spec456abc789"   # 先行的 spec commit（推荐）

# 影响范围
affected_specs:
  - "spec/architecture/slices/05-syscall.yaml"
  - "spec/architecture/composition/process-memory-isolation.yaml"
affected_modules:
  - "kernel/memory"
  - "kernel/vm"
  - "kernel/trap"
affected_operations:
  - "kernel/memory.uvmcopy"
  - "kernel/vm.copy_page_on_write"
  - "kernel/trap.page_fault_handler"

# 变更前后对比
before:
  description: "fork 时 uvmcopy 完整复制父进程全部用户页"
  semantics: "fork 后父子进程各自拥有独立的物理页"
after:
  description: "fork 时父子进程共享只读页，写入时复制"
  semantics: "fork 后父子进程共享物理页（只读），首次写入时分配新页"

# 风险
risks:
  - "CoW 实现错误可能导致父子进程互相影响内存"
  - "引用计数错误可能导致页过早释放或泄漏"
  - "page fault handler 中的 CoW 逻辑增加了 trap 路径的复杂度"

# 回归要求
required_regressions:
  - "public,memory"
  - "public,process"
  - "public,trap"

# 审批
approval_notes: "需确认 CoW 不破坏 process-memory-isolation 组合不变量"
```

## 两段式提交流程（推荐）

```text
第一步：spec commit
  - 编写 SpecPatch YAML（spec/evolution/patch-003-*.yaml）
  - 更新受影响的 ArchitectureSlice / ADR / CompositionSpec / ModuleSpec / OperationContract
  - git commit -m "[spec] Add CoW fork SpecPatch"
  - 记录 spec_commit_sha

第二步：implementation commit
  - 实现 CoW fork 的代码变更
  - git commit -m "[kernel] Implement CoW fork
      
      Spec-Patch-ID: patch-003-cow-fork
      Spec-Stage: syscall-ipc
      Spec-Kind: architecture_change
      Affected-Specs: spec/modules/kernel/vm/ops/uvmcopy.yaml
      Required-Regressions: public,memory,process,trap
      Spec-Commit-SHA: spec456abc789"
```

## 何时触发 SpecPatch

以下变更**强制**触发 SpecPatch：

1. 引入新的资源模型或权限模型
2. 改变 syscall / IPC / trap 等核心语义
3. 改变跨模块不变量
4. 改变启动链、链接布局、ABI
5. 引入新的个性化目标或替换既有目标

以下变更**不需要** SpecPatch：

- 修复实现 bug（行为与 Spec 一致但代码有错）
- 代码重构（不改行为）
- 增加注释或文档
- 增加新的测试（不改变被测试对象的行为）

## 质量要求

1. **before/after 必须描述语义差异**，不能只写"改了"。
2. **risks 必须诚实**，不能写"无风险"除非真的无风险。
3. **required_regressions 必须完整**，所有可能受影响的测试套件都应列入。
