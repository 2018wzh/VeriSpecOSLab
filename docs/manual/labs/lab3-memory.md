# Lab 3: 内存管理 — 物理分配与虚拟映射

## 1. 设计问题

物理内存如何分配和回收？虚拟地址空间如何组织？用户和内核如何隔离在各自的地址空间中？内存管理的正确性由什么不变量保证？

## 2. 设计空间

| 决策 | 你需要回答的问题 |
|------|----------------|
| 物理内存布局 | 如何获取可用物理内存范围？哪些区域需要保留？ |
| 分配器算法 | 用什么数据结构管理空闲页？分配的粒度是多少？ |
| 分页模型 | 使用几级页表？内核地址空间如何映射？ |
| 隔离边界 | 用户地址空间和内核地址空间的隔离线在哪里？ |
| 内核内存管理 | 除了页分配，是否需要小对象分配？引用计数？ |

## 2a. 设计决策引导

### 决策 1：如何获取物理内存布局

你面前有三种选择：

| 方案 | 实现成本 | 灵活性 | 适合 |
|------|:------:|:------:|------|
| **硬编码** | 最低 | 差——换 QEMU 配置需改代码 | 快速原型、教学场景 |
| **设备树解析** | 中等——需要写一个最小 DTB 解析器 | 好——内核自动适配 QEMU 的 `-m` 参数 | 通用 OS、阶段 9 硬件移植 |
| **从阶段 2 传入** | 低——boot 阶段传一个结构体 | 中 | 不想写 DTB 解析但也不想硬编码 |

**零基础建议**：先用硬编码。QEMU `virt` 机器的 RAM 从 `0x80000000` 开始，大小由 `-m` 参数指定（如 `-m 128M`）。等你分配器跑通后，再考虑设备树解析——那是一个独立的小项目，不是阶段 3 的核心任务。

### 决策 2：分配器算法选择

| 算法 | 代码量 | 碎片风险 | 连续多页分配 | 学到了什么 |
|------|:-----:|:------:|:----------:|------|
| **Freelist** | ~50 行 | 中 | 不天然支持 | 最基本的数据结构驱动设计 |
| **Buddy System** | ~200 行 | 低 | 天然支持 | 2 的幂次管理、伙伴合并、递归分裂 |
| **Bitmap** | ~80 行 | 高 | 支持（扫描连续 bit） | 位运算技巧、内存-效率权衡 |

**零基础建议**：先从 freelist 开始。用 50 行代码跑通"分配+释放+不变量检查"的完整闭环，比用 200 行写 buddy system 但调不通要高效得多。freelist 的不变量检查器可以写得非常简洁（遍历链表查重复、查保留区域越界），是学习"不变量驱动开发"的最佳起点。

### 决策 3：启用分页的时机

你必须在某个时刻写入 `satp` 寄存器来启用 MMU。这个时刻的选择影响你之后的代码怎么写：

**时机 A：在 `kernel_main` 早期就启用。** 建立内核页表（identity mapping），写入 `satp`，之后的代码都在分页模式下运行。

**时机 B：在分配器跑通之后再启用。** 先用物理地址裸跑，确认分配器正常后，再建立页表。

时机 A 是正确的选择——它让你尽早进入"分页是常态"的思维模式。但在启用分页的那一瞬间，有一条黄金规则：**`satp` 写入指令所在的页，必须在新的页表中有相同的映射。** 否则 CPU 取不到下一条指令，直接崩溃。

### 决策 4：用户/内核地址空间边界

在 64 位地址空间中，你有 256 GB（Sv39）的虚拟地址空间可以分配。两种主流布局：

**方案 A：低地址内核 + 高地址用户（如 xv6）**
```
0x0000_0000_0000_0000 ─── 内核代码/数据（identity mapping）
0x0000_003F_FFFF_FFFF ─── 用户空间
```

**方案 B：低地址用户 + 高地址内核（HHDM，如 Linux）**
```
0x0000_0000_0000_0000 ─── 用户空间
0xFFFF_FFC0_0000_0000 ─── 内核（直接映射偏移）
```

零基础建议：先做方案 A（xv6 风格）。它简单——内核虚拟地址 = 物理地址，没有偏移转换。等你理解了分页的基本工作机制后，改到方案 B 只是一次地址偏移量的调整。

## 2b. 逐步操作指引

### 步骤 1：获取物理内存布局（预计 15 分钟）

```c
// 硬编码方式：从 QEMU virt 机器获取内存布局
#define RAM_BASE     0x80000000UL
#define RAM_SIZE     (128UL * 1024 * 1024)  // 假设 -m 128M

// 内核自身占用的区域（从链接脚本符号获取）
extern char _kernel_start[];  // 内核镜像起始
extern char _kernel_end[];    // 内核镜像结束（含 BSS）

static uint64_t kernel_pages_start;
static uint64_t kernel_pages_end;

static void init_memory_map(void) {
    // 内核占用的物理页也需要标记为"保留"
    kernel_pages_start = ((uint64_t)_kernel_start) & ~0xFFF;  // 对齐到页
    kernel_pages_end   = (((uint64_t)_kernel_end) + 0xFFF) & ~0xFFF;
    
    uart_puts("[INFO] Physical memory: 0x");
    // 打印 RAM_BASE ~ RAM_BASE+RAM_SIZE
    uart_puts("[INFO] Kernel occupies: 0x");
    // 打印 kernel_pages_start ~ kernel_pages_end
}
```

### 步骤 2：实现最小 Freelist 分配器（预计 45 分钟）

```c
// freelist 节点——直接利用空闲页自身存储链表指针
struct freelist_node {
    struct freelist_node *next;
};

static struct freelist_node *freelist = NULL;
static uint64_t total_free_pages = 0;
static uint64_t total_allocated_pages = 0;

// 初始化：将所有可用物理页加入 freelist
void kalloc_init(void) {
    for (uint64_t pa = RAM_BASE; pa < RAM_BASE + RAM_SIZE; pa += 4096) {
        // 跳过内核占用的页
        if (pa >= kernel_pages_start && pa < kernel_pages_end)
            continue;
        // 跳过 MMIO 区域（RISC-V virt: 0x10000000 附近）
        if (pa >= 0x10000000UL && pa < 0x20000000UL)
            continue;
        
        kfree_page((void *)pa);
    }
    uart_puts("[PASS] kalloc initialized\n");
}

// 分配一个物理页
void *kalloc_page(void) {
    if (!freelist) return NULL;  // 内存耗尽
    
    struct freelist_node *node = freelist;
    freelist = node->next;
    
    total_free_pages--;
    total_allocated_pages++;
    
    // 清零——安全实践
    memset((void *)node, 0, 4096);
    
    return (void *)node;
}

// 释放一个物理页
void kfree_page(void *pa) {
    if (!pa) return;  // 安全处理 NULL
    
    struct freelist_node *node = (struct freelist_node *)pa;
    node->next = freelist;
    freelist = node;
    
    total_free_pages++;
    total_allocated_pages--;
}
```

**自检点**：
- `kalloc_page()` 连续调用 N 次后返回 NULL（内存耗尽）
- 释放后再分配，得到的是同一页
- 分配的页内容全为零

### 步骤 3：写不变量检查器（预计 30 分钟）

这是阶段 3 最关键的一步——它在后续几个月里会帮你抓到几十个 bug。

```c
// 不变量 1：freelist 中没有重复节点
static int check_no_duplicates(void) {
    struct freelist_node *slow = freelist, *fast;
    int count = 0;
    
    // Floyd 判圈算法检测循环（安全网——如果有环，遍历会死循环）
    while (slow) {
        fast = slow->next;
        // 检查当前节点是否在后续链表中重复出现
        struct freelist_node *p = slow->next;
        while (p) {
            if (p == slow) {
                uart_puts("[FAIL] Duplicate in freelist!\n");
                return 0;
            }
            p = p->next;
            count++;
            if (count > total_free_pages + 10) {  // 安全上限
                uart_puts("[FAIL] Freelist appears to have a cycle!\n");
                return 0;
            }
        }
        slow = slow->next;
    }
    return 1;
}

// 不变量 2：freelist 中没有保留区域的页
static int check_no_reserved(void) {
    struct freelist_node *p = freelist;
    while (p) {
        uint64_t addr = (uint64_t)p;
        // 检查是否在内核镜像范围内
        if (addr >= kernel_pages_start && addr < kernel_pages_end) {
            uart_puts("[FAIL] Reserved page in freelist!\n");
            return 0;
        }
        // 检查是否在 MMIO 范围
        if (addr >= 0x10000000UL && addr < 0x20000000UL) {
            uart_puts("[FAIL] MMIO page in freelist!\n");
            return 0;
        }
        p = p->next;
    }
    return 1;
}

// 不变量 3：计数一致性
static int check_counts(void) {
    // 遍历 freelist 统计实际空闲页数
    int actual_free = 0;
    struct freelist_node *p = freelist;
    while (p) { actual_free++; p = p->next; }
    
    if (actual_free != total_free_pages) {
        uart_puts("[FAIL] Free count mismatch!\n");
        return 0;
    }
    return 1;
}

// 统一入口
void kalloc_invariant_check(void) {
    int pass = 1;
    pass &= check_no_duplicates();
    pass &= check_no_reserved();
    pass &= check_counts();
    
    if (pass)
        uart_puts("[PASS] All allocator invariants hold\n");
}
```

**预期产物**：在每次分配/释放后调用 `kalloc_invariant_check()`，确认不变量始终成立。

### 步骤 4：建立内核页表并启用 MMU（预计 45 分钟） |

## 3. 背景阅读

- [附录：RISC-V 参考](../appendices/riscv-reference.md)（Sv39 分页和 CSR 部分）
- [附录：不变量检查器编写指南](../appendices/invariant-checker.md)
- [Spec: ModuleSpec 编写指南](../specs/module-spec.md)
- [Spec: ConcurrencySpec 编写指南](../specs/concurrency-spec.md)
- 你的目标平台的内存映射文档

## 4. 规格要求

### 4.1 ArchitectureSlice(memory)（必做）

创建 `spec/architecture/slices/02-memory.yaml`

### 4.2 ModuleSpec（必做）

- `spec/modules/memory/module.yaml`：物理内存模块的完整 ModuleSpec
- `spec/modules/vm/module.yaml`：虚拟内存模块的 ModuleSpec
- `spec/modules/memory/concurrency.yaml`：分配器的并发规则

### 4.3 ADR（必做，至少 1 个）

至少记录分页模型选择（如 Sv39）的决策理由和替代方案分析。

### 4.4 OperationContract（必做）

至少为以下关键操作编写完整契约：
- 物理页分配
- 物理页释放
- 分配器不变量检查
- 建立内核页表
- 页表映射（map_page）
- 取消页表映射（unmap_page）

每个契约需包含：rely/guarantee、pre/postconditions、failure_semantics、concurrency。

### 4.5 GoalValidationContract (mini)（可选）

如果你选择了非平凡的分配器算法或地址空间布局策略，可以用 mini contract 声明你的选择和验证标准。

## 5. 质量门禁

### 测试门禁

```bash
vos spec lint           # 规格格式检查
vos build               # 构建
vos test --suite memory # 公开测试
vos verify public       # 基础验证
```

### 分配器不变量门禁

你的分配器不变量检查器必须可运行并通过。至少包含：
- [ ] 不重复分配（同一页不被分配两次）
- [ ] 保留区域保护（保留区域的页永不返回）
- [ ] 释放后不可用（释放后的页在下次分配前不可被访问）

### 分页门禁

- [ ] 启用分页后内核可继续正常运行（无立即崩溃）
- [ ] 内核可以访问 MMIO 区域（UART 可正常输出）

### 用户/内核隔离门禁

- [ ] 如果已建立用户页表概念，确认用户页表中不存在指向内核物理内存的 U=1 映射

## 6. 设计理据要求

1. 你选择的分配器算法的最坏情况行为是什么？这影响你在后续阶段的什么设计？
2. 你的地址空间布局为什么是这个结构？有什么设计约束促成了这个选择？
3. 你的不变量检查器覆盖了你分配器的所有关键不变量吗？有没有不变量无法在运行时检查？

## 7. AI 使用边界

**允许**：
- 让 AI 审查你的 ModuleSpec，指出缺失的不变量
- 让 AI 生成不变量检查器的框架代码
- 让 AI 解释页错误日志

**禁止**：
- 在没有 ModuleSpec 的情况下让 AI 生成分配器或页表代码
- 让 AI 移除或弱化不变量检查器

## 8. 提交物

- ArchitectureSlice(memory)
- 两个 ModuleSpec（memory + vm）及关键操作的 OperationContract
- ConcurrencySpec（分配器）
- ADR（至少 1 个：分页模型或分配器算法）
- 实现源码
- 不变量检查器输出日志

（进阶方向：对比多种分配器策略如 freelist vs buddy 的性能；调研 KASLR 在教学 OS 中的可行性；利用 Sv39 的 2 MiB/1 GiB 大页减少 TLB 压力；实现惰性分配——页在首次 page fault 时才分配物理页。）

## 9. 常见错误与排查

### 错误 1：启用 MMU 后内核立刻崩溃，没有任何输出

**原因**：`satp` 写入后，CPU 开始使用页表翻译地址，但新页表中没有正确映射内核代码所在的页。

**排查**：
```gdb
# 在 satp 写入指令处设断点
(gdb) b *0x80000100   # 假设这是写入 satp 的地址
(gdb) c
# 单步执行 satp 写入
(gdb) si
# 下一条指令如果崩溃——页表有问题
# 检查页表内容
(gdb) x/512gx 0x80001000  # 假设你的 L1 页表在这里
```

**最常见的具体原因**：
- Identity mapping 不完整——映射了部分内核地址，但 PC 刚好落在未映射的页
- 页表物理地址写错了——`satp` 要求的是物理页号（`PPN = pa >> 12`），而不是物理地址
- 忘了设 PTE_V 位——映射条目看起来正确但 V=0

### 错误 2：分配器返回的页不是全零

**原因**：`kalloc_page` 里忘了调 `memset`。

**为什么有时测试通过？** 因为 QEMU 中 RAM 的初始值恰好是零——但真实硬件上 RAM 内容不确定。今天是零（测试通过），明天 QEMU 版本更新了就不一定了。

**解决**：在 `kalloc_page` 返回前强制清零。同时在 `kfree_page` 时把页内容填充为 poison pattern（如 `0xDEADBEEF`）以便调试 use-after-free。

### 错误 3：释放一个页之后仍然能正常读写它

**原因**：你没有启用 MMU，或者页表映射没有正确取消。物理地址总是可访问的——除非你主动 unmapped 它。

**这是正常的吗？** 在没有 MMU 的情况下——是的。裸机上"释放内存"只是一个约定（"我不再使用这块区域了"），没有任何硬件强制。只有启用了 MMU 并正确配置了页表权限，访问已释放的内存才会触发 page fault。

### 错误 4：不变量检查器报 "Duplicate in freelist"（double-free）

**原因**：同一个物理页被 `kfree_page` 调用了两次。

**排查**：在不变量检查器中打印重复节点的地址。然后在 `kfree_page` 入口加日志——记录每次释放的地址。找到两次释放同一个地址的调用栈。

**预防**：在 `kfree_page` 中给页内容写 poison pattern。如果 poison pattern 已经存在，说明是 double-free——可以直接 panic。

### 错误 5：分配器运行一段时间后返回 NULL，但明明还有空闲内存

**原因**：外部碎片——所有的空闲页都是零散的，但你需要的是一块连续的多页区域。freelist 分配器不自动合并相邻空闲页。

**是否为 bug？** 如果你的设计不要求连续多页分配——不是 bug。但如果将来需要连续多页（如 DMA 缓冲区），你需要 buddy system 或至少实现碎片整理。

### 错误 6：`sfence.vma` 之后程序崩溃

**原因**：`sfence.vma` 刷新了 TLB，但你没有正确重新建立需要的映射——或者在错误的时机调用了它。

**黄金规则**：只有在页表中已有正确的新映射时，才调用 `sfence.vma` 清除旧的 TLB 条目。如果你先 flush TLB 再修改页表——在 flush 和 修改之间的窗口，CPU 可能访问到一个既不在 TLB 也不在页表中的地址。
