# 不变量检查器编写指南

不变量（invariant）是"在系统运行期间始终为真"的性质。不变量检查器（invariant checker）是一段代码，在运行时主动验证这些性质是否保持。

在 VeriSpecOSLab 中，不变量是你设计中最重要的正确性论据。

## 不变量的层次

### 模块级不变量

在单个模块内部始终成立。例如：

- 物理页分配器：freelist 中不存在重复页；已被分配的页不在 freelist 中；保留区域中的页从未被分配。
- 进程表：每个进程 ID 唯一；RUNNING 状态的进程数不超过 CPU 数。
- 文件系统：inode 的引用计数等于指向它的目录项数。

### 跨模块不变量（CompositionSpec）

涉及多个模块的组合性质。例如：

- 进程内存隔离：进程 A 的页表中没有映射到进程 B 的用户内存页。
- syscall-memory-trap 链：通过 syscall 传递的用户指针必须指向用户地址空间内的有效区域。

## 不变量检查器的设计原则

### 原则 1：检查器不应修改系统状态

检查器是只读的。它观察状态、验证不变量，但不改变任何东西。

### 原则 2：检查器在可控点触发

常见的触发时机：
- **操作完成后**：每次分配/释放后运行 allocator invariant checker
- **定期触发**：每个时钟 tick 运行轻量级检查
- **手动触发**：通过 syscall 或调试命令触发全量检查

### 原则 3：检查失败必须清晰报告

失败时至少报告：
- 哪个不变量被违反
- 违反时的系统状态（相关变量的值）
- 触发检查的操作是什么

### 原则 4：检查器的正确性本身也需要被审查

检查器也是代码，也会出错。在设计审查中，检查器的不变量覆盖度和正确性也在审查范围内。

## 编写示例

以页分配器不变量检查器为例：

```c
// 不变量 1：freelist 中无重复页
// 不变量 2：已分配页不在 freelist 中
// 不变量 3：保留区域页从未分配

void check_page_allocator_invariant(void) {
    // 遍历 freelist，检查重复
    // 遍历已分配页集合，确认不在 freelist 中
    // 检查保留区域的页是否被分配

    if (violation_detected) {
        panic("page_allocator_invariant: <具体违反的不变量>");
    }
}
```

对应的 Spec 描述（ModuleSpec）：

```yaml
module_invariants:
  - name: freelist_no_duplicate
    description: "freelist 中每个物理页只出现一次"
    check_trigger: "每次 kalloc/kfree 后"
  - name: allocated_not_in_freelist
    description: "已被分配的页不存在于 freelist 中"
  - name: reserved_never_allocated
    description: "保留区域的物理页从未被分配器返回"
```

## 不变量覆盖度

Final Lab 要求至少 5 个不变量检查器、至少 1 个跨组件不变量。你可以通过以下维度提升覆盖度：

| 维度 | 低覆盖 | 高覆盖 |
|------|--------|--------|
| 模块覆盖面 | 只检查页分配器 | 覆盖内存、进程、文件系统、IPC |
| 触发频率 | 只在手动触发时运行 | 每次关键操作后自动运行 |
| 跨组件 | 只有模块级不变量 | 有跨模块不变量（如进程隔离、syscall-memory 安全） |
| 并发 | 不考虑并发 | 考虑了锁持有和中断上下文下的不变量的安全性 |

## 注意事项

- 不变量检查器在调试/验证模式下运行，可能影响性能。在基准测试时可以关闭。
- 检查器代码本身不能引入新的不变量违反（如检查过程中获取锁导致死锁）。
- 不变量应定义在 Spec 中，而不是仅在代码中以 assert 形式隐式存在。
