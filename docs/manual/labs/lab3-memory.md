# Lab 3：内存管理——物理分配与虚拟映射

> **对应教材**：[第 3 章：内存管理](../book/ch03-memory.md)

> **本 Lab 概览**
>
> - **学完能做什么**：写出一套可检查的内存管理子系统，包括物理页分配器、不变量检查器和分页切换，并说清每条内存不变量为什么成立。
> - **预计耗时**：15–20 小时，建议安排 1–2 周。其中分配器与不变量检查器约占一半，页表与用户映射占另一半。
> - **前置依赖**：已完成 Lab 2（内核能启动并输出 banner），阅读第 3 章与对应 ISA 的页表参考。
> - **产出物**：覆盖物理分配与虚拟映射的 `kernel/memory` ModuleSpec、对应实现与公开测试、内存地图与分页切换日志、不变量检查器及故障注入结果。
> - **评分构成**：质量门禁 70% + 设计理据 20% + 挑战/加分 10%（可选）。实际分值以教师公布为准。
> - **实际耗时**：在提交物里记录本次 Lab 实际投入小时数。

## 1. 设计问题

- 可用物理内存从哪里获得，哪些区域必须保留？
- 空闲页如何组织，耗尽、重复释放和非法地址如何失败？
- 页表采用什么层级、地址空间布局和权限模型？
- 修改页表后，何时执行 TLB shootdown 或本地刷新？
- 分配器在多核环境中如何同步，哪些操作可在中断上下文调用？

这五个问题对应五类决策。你不需要一次答完：先回答前两个（内存来源、空闲页组织），页表问题在实现时逐步明确，多核同步放到 Lab 4 之后再回来看。

## 2. 设计空间

> **与教材的关系**：设计维度的详细论述见[教材第 3 章 §3.4](../book/ch03-memory.md)。下表只列本 Lab 要决策的问题；两处如有出入，以教材为准。

| 决策 | 常见选择 | 必须写清的取舍 |
| --- | --- | --- |
| 内存发现 | 固定布局、固件传入、设备树 | 可移植性、启动依赖、保留区来源 |
| 页分配器 | freelist、bitmap、buddy | 分配复杂度、碎片、连续页能力 |
| 内核映射 | identity map、higher-half direct map | 启动切换成本、地址转换方式 |
| 用户隔离 | 独立页表、共享内核映射 | 权限边界、切换成本、攻击面 |
| 小对象分配 | 不做、slab/size class | 内部碎片、生命周期、调试能力 |

首次实现可采用 freelist 和 4 KiB 页，但"简单"不等于省略检查。至少要拒绝未对齐地址、保留区域、重复释放和超出物理范围的页。

## 3. 分步操作指引

Lab 3 建议按下面五个步骤推进。每步都有自检点：只有上一步自检通过，才进入下一步。这样出问题时能立刻判断是哪一层。

### 步骤 1：建立物理内存地图

从 DesignSpec 的机器配置和启动模块输入中确定 RAM、内核镜像、固件、设备树、MMIO 与保留区。

- 启动日志至少打印每个区间的起止地址、来源和对齐结果。
- 不要把 QEMU 的默认地址写成适用于所有板卡的事实；来源写清楚是"QEMU 默认"还是"设备树解析"。

**自检点**：地图中所有区间之和不超过 RAM 总量；内核镜像、固件、MMIO 全部落在保留区；没有一个字节同时属于两个区间。

### 步骤 2：实现页分配器

分配与释放必须保持以下性质：

- 同一物理页在任一时刻只有一个所有者；
- 空闲集合不含内核镜像、页表、固件或 MMIO 页；
- 返回地址按页大小对齐；
- 耗尽返回明确定义的错误；
- 分配前清零，释放后可填充 poison pattern 以暴露 use-after-free。

初始化空闲链表时，不要通过普通 `free` 路径错误地递减"已分配页"计数。为引导阶段提供单独的 `add_free_range`，或让计数模型明确区分"导入空闲页"和"释放已分配页"。

下面的状态转换表应先于代码完成：

| 操作 | 前置条件 | 成功后 | 失败 |
| --- | --- | --- | --- |
| import range | 页对齐、属于 RAM、未保留 | 页进入 free 集合 | 配置错误，启动失败 |
| allocate | free 集合非空 | 页从 free 转为 allocated，内容清零 | out-of-memory |
| free | 页属于 allocated | 页 poison 后回到 free | invalid/double free |
| reserve | 页尚未分配 | 页进入 reserved | overlap/configuration error |

freelist 节点可以存放在空闲页自身，但这意味着释放后的页内容已不属于旧所有者。任何调试读取都必须在 poison 和入链之前完成。

**自检点**：写一个测试，连续分配直到耗尽，确认最后一个分配返回 `out-of-memory` 而不是越界；再全部释放，确认计数回到初始值。

### 步骤 3：编写不变量检查器

至少检查：链表无环、节点无重复、地址对齐、节点属于可用区、统计值一致。开发构建可在每次分配/释放后运行完整检查；常规构建可以降低频率，但不能删除检查入口。

判环使用 Floyd 算法或有界 visited set；不要在链表异常时执行无界二重遍历。计数检查要同时验证：

```text
usable pages = free + allocated + reserved-runtime
free list length = recorded free count
free ∩ allocated = ∅
```

故障注入可以临时构造 self-loop、重复节点、未对齐节点和保留区节点。检查器必须在超时前报告具体地址与违反的不变量 ID。

**自检点**：人工注入一个链表环，检查器在超时前报出具体地址；解除注入后检查器通过。把这次注入和结果留作证据。

### 步骤 4：建立内核页表

在写入页表根寄存器前，确认当前 PC、栈、页表本身和串口 MMIO 在新地址空间中可访问。切换后立即输出一个短标记，再进入复杂初始化。页表更新必须先写入有效条目，再按 ISA 要求刷新 TLB。

分页切换采用两阶段标记：切换前打印 `MMU:PREPARED`，切换后的第一段汇编只打印 `MMU:ON`。若第二个标记缺失，优先检查取指和栈；若标记出现后才崩溃，再检查数据、MMIO 和后续页表遍历。

**自检点**：`MMU:ON` 出现后，内核能继续输出后续日志，说明 PC、栈、串口和内核数据在新地址空间中全部可访问。

### 步骤 5：建立用户映射边界

用户映射不得以用户权限指向内核代码、内核数据、页表或设备寄存器。对 `map`、`unmap`、`protect` 和地址翻译分别测试合法路径与越界路径。

页表测试至少覆盖叶条目与非叶条目混淆、重复映射、跨层大页冲突、权限收紧、取消映射后刷新，以及虚拟地址规范性检查。不同 ISA 的页表位和刷新规则以所选架构规范为准，并在 HAL 层集中处理格式和刷新指令差异。

**自检点**：用一个用户页表访问内核代码地址，确认触发页错误而不是读到内容；再对合法用户页读写，确认正常通过。

## 4. Spec 与 Agent 工作流

参考课程把物理分配、内核页表和用户映射收在同一个 `kernel/memory` ModuleSpec 中，以便统一声明页所有权、映射权限和 TLB 可见性。若学生的架构确实需要拆分模块，必须为新增模块提供稳定 ID、独立 `owns` 和明确依赖，不能在本 Lab 提前引用后续课程模块。涉及锁、跨核 TLB 或中断上下文时使用 L3；否则至少使用 L2。

最小字段骨架如下，`TODO` 必须换成你从前文设计问题推导出的契约：

```yaml
id: kernel/memory
module: kernel/memory
level: TODO_LEVEL
purpose: TODO
owns: [TODO_IMPLEMENTATION_PATH, TODO_TEST_PATH]
interface: [TODO_OPERATION]
properties: [TODO]
errors: [TODO]
state: { TODO_STATE: TODO }
preconditions: [TODO]
postconditions: [TODO]
invariants: [TODO]
dependencies: [toolchain]
```

```sh
vos agent ask "物理页分配、地址空间与 TLB 约束应如何写进同一个分级 ModuleSpec？"
# 学生根据本节设计问题和字段骨架手写 spec/modules/kernel/memory.yaml
vos spec lint kernel/memory
vos agent review kernel/memory -i
# 学生修改后再次 lint，并手动提交
vos spec lint kernel/memory
git add spec/modules/kernel/memory.yaml
git commit -m "[spec][memory] Define Lab 3 memory contract"
vos agent implement kernel/memory
vos build
vos run qemu
vos verify
```

ModuleSpec 应覆盖：

- `owns`：实现与公开测试路径，不含 Spec、`.git` 或 `.vos`；
- `state`：空闲集合、保留区、映射关系和计数；
- 操作：allocate、free、map、unmap、protect、translate、check invariants；
- `pre`/`post` 与 errors：对齐、范围、所有权、耗尽、重复映射；
- invariants：唯一所有权、权限隔离、统计一致；
- dependencies：启动、工具链和平台内存描述；
- L3 concurrency/rely/guarantee：锁顺序、TLB 可见性和调用上下文。

测试 target 在 `vos.yaml` 中绑定稳定 ID `kernel/memory`；不同性质可以拆成多条 public、contract、fuzz 和 trace target。若启用分页需要同时改变 boot 的可观察语义，先手写并提交 SpecPatch，再实现跨模块修改。

## 5. 质量门禁

```sh
vos build
vos run qemu
vos verify
```

- [ ] 连续分配直到耗尽，错误语义符合 Spec。
- [ ] 释放后重新分配，所有权与清零策略正确。
- [ ] 非对齐、保留区、越界和 double-free 被拒绝。
- [ ] 不变量检查器能主动发现人工注入的链表环或重复节点。
- [ ] 启用分页后 PC、栈、串口和内核数据仍可访问。
- [ ] 用户映射无法获得内核页或 MMIO 的用户权限。
- [ ] 多核压力下没有重复分配，TLB 更新在目标核心可见。

## 5a. 最小成功输出样例

分页切换采用两阶段标记。运行 `vos run qemu` 后，日志中应按顺序出现：

```text
[0] memory map: RAM 0x80000000..0x88000000
[0] free pages: 4096
[0] MMU:PREPARED
[0] MMU:ON
[0] kernel resumed after page switch
```

对照门禁：

- `MMU:PREPARED` 与 `MMU:ON` 都出现，且顺序正确；
- `MMU:ON` 之后内核还能继续输出（说明 PC、栈、串口在新地址空间中可访问）；
- 若只有 `MMU:PREPARED`：先查取指与栈（切换后第一条指令没执行）；
- 若 `MMU:ON` 出现后崩溃：再查数据、MMIO 与后续页表遍历。

## 6. 设计理据

1. 所选分配器最坏情况下的时间和碎片行为是什么？
2. 地址空间布局由哪些硬件与安全约束决定？
3. 哪些不变量可运行时检查，哪些只能靠结构或审查保证？
4. 如果未来需要 DMA 连续页，当前设计如何演进？

## 7. AI 使用边界

Agent 可以审查不变量、生成测试框架和解释页错误证据。学生必须决定地址空间、所有权和错误语义，并能解释页表位与 TLB 刷新顺序。不要通过移除检查器或放宽权限来"修复"测试。

## 8. 提交物

- [ ] `spec/modules/kernel/memory.yaml`；
- [ ] 实现、公开测试和 `verifies` 映射；
- [ ] 物理内存地图与分页切换日志；
- [ ] 不变量检查器及故障注入结果；
- [ ] 设计取舍说明；
- [ ] 实际耗时（一个整数小时数）；
- [ ] 必要时提交的 SpecPatch。

## 9. 常见问题与排查

### 写入页表根后立即失去输出

先检查当前指令页、栈和 UART 映射，再检查根页表物理地址及页表位。不要在没有串口前置标记的情况下同时修改链接地址和分页布局。

### 空闲页计数初始化后溢出

初始化路径把"从内存地图导入空闲页"当成"释放已分配页"。拆开两条状态转换，并为计数下溢设置断言。

### `sfence.vma` 后才崩溃

旧 TLB 曾掩盖错误映射。保留页表条目转储，确认先发布新条目，再执行符合 ISA 规则的刷新。

## 10. 参考卡

- [Book 第 3 章：内存管理](../book/ch03-memory.md)：内存发现、分配器设计空间与分页原理。
- [带注释的示例 ModuleSpec](example-page-allocator.md)：一份完整的物理页分配器 ModuleSpec 写法示范，与 Lab 3 验收点无直接对应，只作"字段填到什么程度算合格"的锚点。

RISC-V Sv39/Sv48、x86-64 PML4/PDPT/PD/PT 和 AArch64 多级页表在层数、权限位、地址规范性和 TLB 维护上不同。你要记录的是当前平台的页表根、叶条目、权限、保留区和刷新时机，以及这些信息从哪里得到；不要把 QEMU 的 RAM 起始地址、MMIO 区间或页表格式散落在 allocator 和通用映射代码里。把架构特有的页表编码、`sfence.vma`、`invlpg` 或 TLBI 操作包在平台/HAL 接口中，通用内存模块只处理统一语义。

本 Lab 的 ModuleSpec 字段骨架、L3 并发约束和跨模块 SpecPatch 说明已经写在前文。修改 boot 的可观察语义时，按本 Lab 的 SpecPatch 流程记录影响范围，不从仓库内部手册复制旧 schema。
