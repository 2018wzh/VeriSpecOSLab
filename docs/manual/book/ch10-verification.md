# 第 10 章：验证方法论 — 证明你的系统是正确的

## 10.1 形式化验证在 OS 中的历史——从"测试"到"证明"

### 前史：当程序正确性还是个哲学问题

在 1960 年代之前，程序员对"程序是正确的"这件事的态度是纯粹经验主义的——"跑了几组测试数据，结果都对，那就是正确的。"没有人系统性地问：**在数学上，怎么证明一个程序对所有可能的输入都正确？**

**Dijkstra（1968）——程序正确性可以（而且应该）被证明。** Edsger Dijkstra 在 1968 年发表了一篇只有两页的短文，标题既挑衅又精准：**"Go To Statement Considered Harmful"**（`goto` 语句被认为有害）。文章的核心论点不是"`goto` 不好"——而是："**一个程序的正确性无法通过测试来确立，只能通过对其结构的数学推理来论证。** 而 `goto` 语句的存在，使得这种推理变得几乎不可能。"

这篇两页的短文开启了**结构化编程**运动——用 `if/else`、`while`、函数调用代替 `goto`，正是因为这些结构化的控制流让你可以**分段证明程序的正确性**：证明"这个循环结束后变量 x 满足什么性质"，然后把这个性质作为下一段代码的前置条件。这就是你写 OperationContract 时所用的 `precondition → computation → postcondition` 范式的起源。

> **原始文献：** E. W. Dijkstra, "Go To Statement Considered Harmful," *Communications of the ACM*, vol. 11, no. 3, pp. 147-148, March 1968. 这篇两页的短文可能是计算机科学历史上被引用最多的文章——它的影响远超编程语言设计，直接催生了程序验证这个领域。

**Hoare（1969）——程序正确性的数学基础。** 在 Dijkstra 的宣言发表一年后，牛津大学的 Tony Hoare（后来因"空指针是十亿美元的错误"名言和 Quicksort 算法的发明而更广为人知）发表了一篇论文，奠定了程序验证的数学基础。他提出了一组逻辑规则——后来被称为 **Hoare 逻辑**——用数学符号精确地描述"如果 P 在执行代码 C 之前成立，那么 Q 在 C 执行之后成立。"这个 `{P} C {Q}` 三元组，是你每次写 `precondition → operation → postcondition` 时的理论祖先。

> **原始文献：** C. A. R. Hoare, "An Axiomatic Basis for Computer Programming," *Communications of the ACM*, vol. 12, no. 10, pp. 576-580, October 1969. 这篇论文定义了 Hoare 三元组、赋值公理、复合公理、迭代公理——这些至今仍然是所有程序验证工具的理论基础。

### seL4（2009）——当理论变成工程现实

Dijkstra 在 1968 年说"程序的正确性应该被证明"。但他说的是几十行的算法——quicksort、Dijkstra 最短路径。把一个**完整的、运行的、有 MMU 和中断和并发的操作系统内核**全部形式化验证——这曾经被认为是不可能的。

2009 年，NICTA（澳大利亚国家 ICT 研究所）的团队完成了 seL4 微内核的形式化验证——这是人类历史上第一个被完整证明"实现满足规范"的通用操作系统内核。他们在 Isabelle/HOL 证明助手中写了约 20 万行形式化规范，证明了约 9000 行 C 代码在形式化模型下没有任何 bug（包括不会死锁、不会空指针、不会缓冲区溢出等）。从 Dijkstra 1968 年的两页宣言到 seL4 2009 年的 20 万行证明——这个领域走了 40 年。

seL4 验证的关键洞见：**形式化验证的不是万能的，但它迫使你精确定义"正确"的含义。** 形式化规范本身就是一份极其精确的设计文档——每个函数的输入约束、输出保证、不变量都在数学上无歧义。开发过程中，大量设计缺陷在写规范阶段就被发现了——而不是在实现后。

> **原始文献：** G. Klein et al., "seL4: Formal Verification of an OS Kernel," *Proceedings of the 22nd ACM Symposium on Operating Systems Principles (SOSP)*, pp. 207-220, October 2009. 这篇论文获得了 SOSP 最佳论文奖。注意作者列表有 15 人——这是一个团队的成果，表明了形式化验证 OS 的复杂度和工作量。

但 seL4 也暴露了形式化验证的边界：验证覆盖了内核的 C 实现，但不覆盖硬件（CPU、MMU 可能不符合规范）、不覆盖编译器（GCC 可能引入 bug）、不覆盖用户态代码。形式化验证让你在一个精确模型内获得极端信心，但模型之外的假设仍然存在。

### 对你这门课的意义

你不会做形式化验证（那需要专门的工具和大量时间）。但你正在做的事情——写 ModuleSpec 定义精确的 precondition/postcondition、写不变量检查器在运行时持续验证——是 Dijkstra-Hoare-seL4 这条线索的直接延续。你写下的每一个 `assert(freelist has no duplicates)` 都是在实践 Dijkstra 在 1968 年提出的命题：**"程序正确性不能靠测试来证明——只能靠精确的结构化推理。"** 你用的不是数学定理，是 C 的 `assert` 和运行时检查——但精神是完全一致的。

## 10.2 验证的层次——从"跑通了"到"我确信它是对的"

### 层次 1：功能测试

验证系统"做了该做的事"。你的公开测试套件属于这一层。

### 层次 2：不变量检查

验证系统"没做不该做的事"。你的不变量检查器属于这一层。

功能测试只能证明"在我测试的场景下它是正确的"。不变量检查能证明"在它运行的所有时刻，某些性质都是正确的"。

### 层次 3：跨组件验证

验证"模块拼在一起后仍然正确"。你的 CompositionSpec 定义的跨模块不变量属于这一层。

### 层次 4：设计一致性

验证"你的设计文档内部没有矛盾"。`vos arch lint` 检查这一层。

### 层次 5：演化追溯

验证"你的设计变更是有记录、有理由、可审查的"。你的 SpecPatch 属于这一层。

## 10.3 不变量检查器的设计原则

### 原则 1：检查器不修改状态

检查器是只读的观察者。它验证不变量但不改变系统。

### 原则 2：检查器在关键点触发

- 每次操作的完成点（如每次分配/释放后检查分配器不变量）
- 定期的安全点（如每个时钟 tick）
- 手动触发点（通过特殊的 syscall 或调试命令）

### 原则 3：检查失败必须提供诊断信息

不是仅仅"panic"，而是指明：
- 哪个不变量被违反
- 违反时相关变量的值
- 触发检查的操作

### 原则 4：检查器的代价要可接受

不变量检查有运行时开销。在教学 OS 中这可能不重要，但你需要知道：
- 在 benchmark 测试时可以关闭检查器
- 有些高频路径（如每个 syscall 都触发全量检查）可能导致不可接受的性能退化

### 10.3.1 编写你的第一个不变量检查器：一个完整的教程

让我们从零开始为一个 freelist 物理页分配器编写不变量检查器。这个教程的目的是让你掌握"从规格到检查代码"的完整流程。

**第一步：从不变量描述开始（白板阶段）**

不要直接写代码。先在不引用任何实现细节的前提下，写下你的分配器应该满足的精确性质：

1. **无重复分配**：对于任意两个已分配的页 P1 和 P2，P1 ≠ P2（同一个物理页不能同时被分配给两个调用者）
2. **保留区域保护**：对于任意已分配的页 P，P 不在 [内核代码段起始, 内核代码段结束] 范围内，也不在 [MMIO 区域起始, MMIO 区域结束] 范围内
3. **计数一致性**：freelist 中空闲页数 + 已分配页数 = 总可用页数
4. **freelist 无环**：freelist 不含循环（防止遍历时的死循环）

**第二步：翻译为可检查的代码结构**

对每条不变量，设计对应的检查函数：

```c
// 不变量 1: 无重复分配
// 策略：遍历 freelist，用 Floyd 判圈算法检测重复和循环
static int check_no_duplicate_or_cycle(void) {
    if (!freelist) return 1;  // 空链表天然满足
    
    struct node *slow = freelist, *fast = freelist;
    int steps = 0, max_steps = total_free_pages + 100;
    
    while (fast && fast->next && steps < max_steps) {
        slow = slow->next;
        fast = fast->next->next;
        steps++;
        
        if (slow == fast) {
            log("INVARIANT VIOLATION: Cycle detected in freelist at step %d\n", steps);
            return 0;
        }
    }
    return 1;
}

// 不变量 2: 保留区域保护
// 策略：遍历 freelist，每个节点的地址与保留区域比较
static int check_no_reserved_pages(void) {
    struct node *p = freelist;
    while (p) {
        uint64_t addr = (uint64_t)p;
        if ((addr >= KERNEL_START_PA && addr < KERNEL_END_PA) ||
            (addr >= MMIO_START && addr < MMIO_END)) {
            log("INVARIANT VIOLATION: Reserved page 0x%lx in freelist!\n", addr);
            return 0;
        }
        p = p->next;
    }
    return 1;
}

// 不变量 3: 计数一致性
static int check_count_consistency(void) {
    int actual_free = 0;
    struct node *p = freelist;
    while (p) { actual_free++; p = p->next; }
    
    if (actual_free + total_allocated != total_available) {
        log("INVARIANT VIOLATION: free=%d + alloc=%d != total=%d\n",
            actual_free, total_allocated, total_available);
        return 0;
    }
    return 1;
}
```

**第三步：决定检查点（何时触发检查）**

不要在每次分配/释放时都运行所有检查——有些检查是 O(n) 的（如遍历整个 freelist）。分两层：

- **轻量检查（每次分配/释放后运行）**：检查本次操作的结果（返回的页不为 NULL 且不在保留区域、释放的页不在 freelist 中）
- **重量检查（定期或手动触发）**：遍历 freelist 的全量检查（O(n)），在调试版本中每 100 次操作运行一次

```c
void kalloc_invariant_check_light(void) {
    // O(1) 检查，每次分配/释放后调用
    // 在生产级代码中也可以保留——它们几乎零开销
}

void kalloc_invariant_check_full(void) {
    // O(n) 检查，每 100 次操作或手动触发
    int ok = 1;
    ok &= check_no_duplicate_or_cycle();
    ok &= check_no_reserved_pages();
    ok &= check_count_consistency();
    if (ok) log("[PASS] All allocator invariants hold\n");
}
```

**第四步：验证检查器本身**

一个从不触发的检查器和没有检查器一样无用。你需要确认你的检查器能捕获已知的 bug：

```c
// 故意注入 double-free bug，确认检查器能抓到
void test_invariant_checker_catches_double_free(void) {
    void *p = kalloc_page();
    kfree_page(p);
    kfree_page(p);  // 故意 double-free
    
    // 此时全量检查应报 "duplicate detected"
    assert(kalloc_invariant_check_full() == 0);
    log("[PASS] Invariant checker correctly detected double-free\n");
}
```

### 10.3.2 各子系统的不变量模板

以下是你应该在每个阶段建立的标准不变量。复制这些模板，根据你的具体设计修改。

#### 启动（阶段 2）不变量

| 编号 | 不变量 | 检查方式 |
|:---:|------|------|
| B1 | BSS 段所有字节为零 | 遍历 `_bss_start` 到 `_bss_end`，断言 `*p == 0` |
| B2 | 栈指针在分配范围内 | 断言 `sp >= _stack_bottom && sp <= _stack_top` |
| B3 | 链接布局顺序正确 | 断言 `_text_start < _data_start < _bss_start < _stack_bottom` |
| B4 | 只有 HART 0 执行初始化 | 断言 `hartid == 0` 在 kernel_main 入口 |

#### 内存管理（阶段 3）不变量

| 编号 | 不变量 | 检查方式 |
|:---:|------|------|
| M1 | freelist 无重复页 | Floyd 判圈/双重遍历 |
| M2 | 保留区域无分配 | 每个已分配页 vs 保留区域范围 |
| M3 | 计数一致 | freelist 长度 + 已分配计数 = 总可用页数 |
| M4 | 分配的页内容为零 | 在 kalloc_page 返回前抽样检查 |
| M5 | 页表无悬挂映射 | 遍历所有 PTE，映射的物理页必须在"已分配"或"保留"集合中 |

#### 中断（阶段 4）不变量

| 编号 | 不变量 | 检查方式 |
|:---:|------|------|
| I1 | 中断禁用区间 < 阈值 | `mtime` 时间戳差 < 10μs |
| I2 | PLIC complete 与 claim 配对 | 每 claim 一次后必须 complete 一次（维护计数器） |
| I3 | Tick 间隔偏差 < 10% | 记录连续 tick 的 mtime 差值 |

#### 进程（阶段 5）不变量

| 编号 | 不变量 | 检查方式 |
|:---:|------|------|
| P1 | 同一进程不在两个 CPU 上运行 | 全局位图 `running_cpus[PID]` |
| P2 | RUNNING 进程总数 ≤ CPU 数 | 计数 active processes |
| P3 | ZOMBIE 进程无页表、无 fd | 遍历进程表 |
| P4 | 当前进程的页表 = 当前的 satp 值 | 比较 `proc->pgdir` 和 `r_satp()` |

#### 文件系统（阶段 6）不变量

| 编号 | 不变量 | 检查方式 |
|:---:|------|------|
| F1 | 每个 inode 的引用计数 = 引用它的对象数 | 遍历 fd 表 + 目录项 |
| F2 | Buffer cache 中无重复块 | 遍历 buffer 链表查重 |
| F3 | 日志区域无溢出 | 日志写入前检查 `log_offset < LOG_SIZE` |

#### 跨组件不变量（所有阶段适用）

| 编号 | 不变量 | 涉及模块 |
|:---:|------|------|
| C1 | 进程退出后所有资源释放 | 进程管理 + 内存 + fd 表 |
| C2 | syscall 参数中的指针不指向内核地址 | syscall 分发 + VM |
| C3 | 中断处理程序不持有 sleeplock | 中断 + 锁管理 |

## 10.4 证据管理

验证的产出是**证据**。证据需要：

- **可复现**：相同的代码 + 相同的环境 → 相同的证据
- **可追溯**：证据关联到特定的 Git commit 和 Spec 版本
- **可审计**：第三方（教师、助教）可以独立验证证据的真实性

`.vos/runs/` 目录中的每次 pipeline 运行都是一条证据链。

## 10.5 Final Lab 的验证密度要求

Final Lab 要求你的系统具有以下验证密度：

| 要求 | 最低标准 |
|------|---------|
| 不变量检查器 | 至少 5 个可运行且通过 |
| 跨组件不变量 | 至少 1 个已在 CompositionSpec 中定义且可验证 |
| SpecPatch 演化 | 至少 1 个有效的 SpecPatch 案例（从原因到影响到回归） |
| AI 修正案例 | 至少 1 个 AI 出错后被你发现并修正的案例 |
| 失败分析 | 至少 2 个曾失败的场景的完整分析（现象→定位→原因→修正→证据） |

### ⚡ 挑战：Syscall Fuzzing 与性能回归检测

#### 挑战 A：Syscall Fuzzer 入门

测试只能验证"已知的正确行为"。Fuzzing 探索"未知的边界行为"——随机生成 syscall 序列和参数，观察内核是否崩溃。

**最简单的 syscall fuzzer**（可在用户态实现）：
1. 随机选择一个 syscall 编号
2. 随机生成参数（全零、全 0xFF、随机值、有效指针、无效指针）
3. 执行 syscall
4. 检查结果：内核 panic？返回了未预期的错误码？系统变得无响应？

**关键原则**：
- Fuzzer 运行在内核之外的 host 进程（通过 QEMU monitor 或特殊测试 harness）
- 每次 fuzzing 运行后自动重启 QEMU（确保干净状态）
- 记录导致 crash 的 syscall 序列和参数——这是最小可复现用例

**与阶段 8 的关联**：如果你选了 O4（安全加固），fuzzer 是你的"红队"——它试图打破你的安全防线。fuzzer 无 crash 是你的 O4 方向的核心 benchmark。

#### 挑战 B：性能回归检测

你的 OS 在持续演化——每次添加新功能，都可能无意中退化已有路径的性能。

**最小性能回归检测**：
1. 定义一组性能基准（如：syscall 往返延迟、fork+exec 延迟、文件读写吞吐量）
2. 每次提交后自动运行基准
3. 如果任何基准恶化超过 10%，CI 报告警告
4. 在 `.vos/runs/` 中保留历史基准数据，形成趋势图

**关键基准建议**：
- `syscall_latency`: 空 syscall（立即返回）的往返时间
- `fork_latency`: fork 一个最小进程的时间
- `exec_latency`: exec 一个最小 ELF 的时间
- `fs_read_throughput`: 顺序读 1 MB 文件的吞吐量
- `ctx_switch_latency`: 两个进程之间 ping-pong 上下文切换的时间

**教学价值**：性能回归检测让你形成"测量→优化→再测量"的科学习惯。你的优化是否真的有效？数据说了算——而不是你的直觉。

## 10.6 常见陷阱

1. **不变量太弱**："分配器不崩溃"不是不变量。不变量应该是"freelist 中无重复页"这样的精确性质。
2. **不变量检查器永远不触发**：如果检查器放在一个永远不会被调用的路径上，它不能证明任何东西。
3. **证据不可复现**：依赖了随机数或时间戳的证据需要固定种子才能复现。
4. **SpecPatch 无 before/after**：只记录了"我改了 X"，没记录从什么改成什么——这不是 SpecPatch，是 changelog。
