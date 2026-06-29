# ConcurrencySpec 编写指南

ConcurrencySpec 描述模块的并发规则：锁的使用、原子操作、中断交互、等待/唤醒机制。它是可选的——仅当模块涉及并发时需要。

## 何时需要 ConcurrencySpec

如果你的模块满足以下任一条件，必须编写 ConcurrencySpec：

- 模块的状态被多个 CPU 或中断上下文访问
- 模块使用了锁（spinlock / sleeplock / mutex）
- 模块涉及原子操作
- 模块涉及 sleep/wakeup 等待机制
- 模块在中断处理程序中被调用

## 推荐目录

放在对应模块目录下：

```text
spec/modules/kernel/memory/
  module.yaml
  concurrency.yaml    # ← 并发规则
  ops/
    kalloc.yaml
```

## 完整字段

```yaml
id: "kernel/memory.concurrency"
module: "kernel/memory"

shared_state:
  - name: "kmem.freelist"
    protection: "spinlock kmem.lock"
    description: "空闲页链表，被 kalloc/kfree 访问"
  - name: "kmem.allocated_count"
    protection: "spinlock kmem.lock"
    description: "分配计数，与 freelist 一起受保护"

lock_types:
  - name: "kmem.lock"
    type: "spinlock"
    description: "保护 freelist 和 allocated_count"
    init: "kinit 中调用 initlock"

lock_order:
  - description: "kalloc/kfree 内部获取 kmem.lock，不获取其他锁"
  - description: "kmem.lock 在任意进程锁之前获取（如需要）"

atomic_sections:
  - description: "kalloc 中从获取 kmem.lock 到释放之间是原子的"
  - description: "kfree 中从获取 kmem.lock 到释放之间是原子的"

interrupt_rules:
  - rule: "在持有 kmem.lock 期间，中断可以启用"
    reason: "kmem.lock 不会被中断处理程序获取，所以无死锁风险"

wait_wakeup_rules:
  - description: "kalloc 当 freelist 为空时不等待，直接返回 NULL"
```

## 字段说明

### shared_state

列出模块的所有共享状态及其保护机制。每个状态必须绑定到一个具体的锁或原子操作。

**质量要求**：不能只写"受锁保护"而不说是哪个锁。

### lock_types

列出模块使用的所有锁及其类型。类型区分很重要：

- `spinlock`：忙等待，持有期间禁止睡眠，中断可能禁用
- `sleeplock`：可睡眠，持有期间可以阻塞，但不能在中断上下文中获取
- `mutex`：类似 sleeplock，但语义可能不同

### lock_order

锁的获取顺序。**这是防止死锁的最重要文档**。

如果你在模块 A 中先获取锁 X 再获取锁 Y，那么在任何其他模块中都不能先获取 Y 再获取 X。

### interrupt_rules

中断上下文和进程上下文的交互规则：

- 哪些锁在中断处理程序中被获取？
- 在持有哪些锁时中断必须禁用？
- 哪些锁永远不会被中断上下文获取（因此持有这些锁时中断可以安全启用）？

### wait_wakeup_rules

如果模块涉及 sleep/wakeup：

- 什么条件下进入睡眠？
- 什么事件触发唤醒？
- 如何避免丢失唤醒（lost wakeup）？

## 常见并发模式

### 模式 1：spinlock 保护简单的共享数据

```yaml
shared_state:
  - name: "counter"
    protection: "spinlock counter_lock"
lock_types:
  - name: "counter_lock"
    type: "spinlock"
lock_order:
  - "counter_lock 在文件系统锁之前获取"
interrupt_rules:
  - "持有 counter_lock 期间中断可启用（中断处理程序不获取此锁）"
```

### 模式 2：sleeplock 保护可能阻塞的操作

```yaml
shared_state:
  - name: "inode 数据和元数据"
    protection: "sleeplock inode.lock"
lock_order:
  - "inode.lock 在 buffer cache 锁之后获取"
interrupt_rules:
  - "持有 inode.lock 期间中断可启用，但不可睡眠等待其他锁"
```

### 模式 3：中断处理程序访问共享数据

```yaml
shared_state:
  - name: "uart_tx_buffer"
    protection: "spinlock uart_tx_lock（在进程上下文和中断上下文中都被获取）"
interrupt_rules:
  - "在进程上下文中获取 uart_tx_lock 之前，必须禁用 UART 中断（防止同一 CPU 上的死锁）"
```

## 并发相关的不变量

在 ModuleSpec 的 `module_invariants` 中，可以包含并发相关的不变量。例如：

```yaml
module_invariants:
  - name: "freelist_lock_held_when_modifying"
    description: "任何修改 freelist 的代码必须在持有 kmem.lock 的情况下执行"
```

但更推荐将并发规则集中在 ConcurrencySpec 中，ModuleSpec 专注于功能性不变量。
