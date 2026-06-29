# OperationContract 编写指南

OperationContract 描述**单个操作**的精确行为。它回答：调用这个操作前必须满足什么？调用后保证什么？失败了会怎样？

OperationContract 是 VeriSpecOSLab 中最重要的规格粒度——因为 LLM 辅助代码生成真正需要的是操作级的上下文，而不是模块级的概述。

## 在 Spec 体系中的位置

```text
ModuleSpec      ← 模块管理什么状态？
       ↓
OperationContract  ← 每个操作的具体契约是什么？
       ↓
Code + Tests    ← 实现和验证
```

## 推荐目录

```text
spec/modules/kernel/memory/ops/
  kalloc.yaml
  kfree.yaml
  kinit.yaml
  check_page_allocator_invariant.yaml
```

## 完整字段

```yaml
id: "kernel/memory.kalloc"
module: "kernel/memory"
operation: "kalloc"
stage: "memory-management"
purpose: "分配一个清零的物理页"

# 依赖关系
depends_on:
  requires_modules: ["kernel/lock", "kernel/start"]
  requires_ops: ["kernel/memory.kinit"]

# 依赖假设（rely）——调用者必须保证什么
rely:
  state_assumptions:
    - "kinit 已被调用且成功返回"
    - "freelist 锁未被当前 CPU 持有"
  callable_interfaces:
    - "kernel/lock.acquire"
    - "kernel/lock.release"
    - "kernel/string.memset"
  resource_assumptions:
    - "目标物理页 4 KiB 对齐"
  lock_assumptions:
    - "调用者不持有任何锁（kalloc 内部获取 freelist 锁）"

# 保证效果（guarantee）——操作完成后保证什么
guarantee:
  returns: "成功时返回指向已清零物理页的指针；无可用页时返回 NULL"
  state_updates:
    - "该物理页从 freelist 中移除"
    - "allocated_count 加 1"
  side_effects:
    - "填充返回的页为零"
  emitted_events: []

# 正确性条件
preconditions:
  - "kinit 已完成"  # 隐含：freelist 已初始化
postconditions:
  - "返回值要么是有效的物理页指针（零填充），要么是 NULL"
  - "如果返回非 NULL，该页不在 freelist 中"
  - "如果返回 NULL，allocated_count 不变"
invariants_preserved:
  - "freelist_no_duplicate"
  - "allocated_not_in_freelist"
  - "reserved_never_allocated"
  - "page_zeroed_on_alloc"

# 失败语义
failure_semantics:
  - condition: "freelist 为空"
    result: "返回 NULL，不修改任何状态"
  - condition: "内存不足无法清零"
    result: "不适用（清零操作本身不会失败）"

# 并发语义
concurrency:
  atomicity: "整个操作在 freelist 锁保护下是原子的"
  lock_order: "获取 freelist 锁，操作完成后释放"
  interrupt_state: "操作期间中断可启用"
  wait_wakeup_rules: []

# 安全
security:
  authority_check: "无（内核内部调用）"
  isolation_boundary: "返回的物理地址不得泄漏到用户态"
  user_pointer_policy: "不适用（不接收用户指针）"

# 可观测性
observability:
  traces: []
  counters: ["allocated_count"]
  expected_logs: []

# 测试义务
test_obligations:
  public:
    - "分配所有可用页直到返回 NULL"
    - "分配一页释放一页循环 N 次"
    - "验证返回的页内容全为零"
  generated:
    - "随机分配/释放序列后的不变量检查"
    - "并发分配/释放的不变量检查"
  hidden_tags: ["double_free", "freelist_corruption"]

# 代码生成目标
codegen:
  targets:
    - kind: "symbol"
      path: "kernel/kalloc.c"
      symbols: ["kalloc"]
      owner: "student"
      mode: "implement"
  forbidden_changes:
    - "不允许移除 freelist 锁"
    - "不允许跳过清零步骤"
  required_followup_checks:
    - "运行 page_allocator_tests"
    - "运行 check_page_allocator_invariant"
```

## 字段分组说明

### rely → guarantee

这是 OperationContract 的核心：`rely` 描述**调用者必须保证的条件**，`guarantee` 描述**操作完成后的承诺**。

这种二分对 AI 辅助代码生成特别有效——AI 可以假设 `rely` 条件成立，只需确保 `guarantee` 被满足。

### preconditions / postconditions

与传统契约式设计（Design by Contract）一致的前置/后置条件。区别在于 `rely/guarantee` 更侧重于"环境假设 vs 行为保证"，而 pre/post 更侧重于逻辑条件。

### failure_semantics

必须覆盖所有可能的失败路径。不能只说"失败时返回错误"——要说清楚什么情况算失败、返回什么、状态如何。

### concurrency

并发语义是 OS 内核中最容易出错的维度。OperationContract 强制你显式声明：
- 操作的原子性范围
- 锁的获取顺序
- 中断状态要求

### codegen.targets

这是 Agent 辅助代码生成的**边界声明**。如果你声明了 `"forbidden_changes": ["不允许移除 freelist 锁"]`，Agent 在生成代码时不能移除这个锁。如果你声明了 `"required_followup_checks"`，Agent 生成代码后会提醒你运行这些检查。

## 操作之间的依赖

`depends_on.requires_ops` 声明了操作之间的顺序依赖。例如 `kalloc` 要求 `kinit` 先完成。这有助于 Agent 理解操作的调用顺序约束。
