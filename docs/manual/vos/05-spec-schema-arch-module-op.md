# 05 Spec Schema 参考（上）：架构、模块、操作

本章给出 Architecture Spec、Module Spec 和 Operation Contract 各 YAML 类型的字段定义，每条配 xv6-spec 示例项目中的真实片段。

---

## 5.1 Architecture Spec

### 5.1.1 推荐目录

```text
spec/architecture/
  seed.yaml          # ArchitectureSeed：系统方向与目标
  timeline.yaml      # 阶段时间线
  slices/            # ArchitectureSlice：每阶段引入的机制
    01-boot.yaml
    02-memory.yaml
  decisions/         # ADR：关键设计决策
    ADR-001-paging-model.yaml
  composition.yaml   # 架构级组合不变量
  final-synthesis.yaml
```

---

### 5.1.2 ArchitectureSeed

**用途**：描述系统的阶段性设计总方向。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 稳定标识符，如 `xv6-riscv-seed` |
| `project` | string | 是 | 项目名 |
| `domain` | string | 是 | 领域，如 `teaching-operating-system` |
| `target_platform` | string | 是 | 目标平台，如 `riscv64-qemu-virt` |
| `architecture_name` | string | 是 | 架构名 |
| `architecture_summary` | string | 是 | 架构摘要 |
| `reference_systems` | list | 是 | 参考系统列表（见子字段） |
| `goals` | list | 是 | 系统目标 |
| `non_goals` | list | 是 | 明确排除的目标 |
| `constraints` | list | 是 | 约束条件 |
| `initial_validation_binding` | list | 否 | 初始验证绑定 |

**`reference_systems` 子字段**：

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `system` | string | 是 | 参考系统名 |
| `borrowed_concepts` | list | 是 | 借鉴的概念 |
| `modified_concepts` | list | 是 | 修改后的概念 |
| `rejected_concepts` | list | 是 | 明确拒绝的概念 |
| `reason` | string | 是 | 选择/拒绝理由 |

**xv6 示例**（`spec/architecture/seed.yaml` 片段）：

```yaml
id: xv6-riscv-seed
project: xv6-riscv-kernel
domain: teaching-operating-system
target_platform: riscv64-qemu-virt
architecture_name: xv6-riscv-layered
architecture_summary: >
  A layered RISC-V 64-bit teaching kernel inspired by MIT xv6.
  Core subsystems are built incrementally: boot, memory, trap,
  process, and syscall.

reference_systems:
  - system: xv6-riscv (MIT 6.S081)
    borrowed_concepts:
      - physical page allocator with freelist
      - three-level RISC-V page table (Sv39)
      - trap frame for user/kernel context switch
      - round-robin scheduler
    modified_concepts:
      - simplified boot path (single-hart, no S-mode init)
      - spec-driven code generation instead of hand-written C
    rejected_concepts:
      - COW fork (left to later stages)
      - multi-core support (left to later stages)
      - networking stack
    reason: >
      Full xv6-riscv specification covering all core subsystems.

goals:
  - boot to supervisor mode and print a banner
  - manage physical memory with a page allocator
  - set up Sv39 virtual memory with kernel page table
  - handle traps (interrupts, exceptions, syscalls)
non_goals:
  - multi-core support (single-hart only)
  - networking stack
  - full POSIX compliance
constraints:
  - riscv64-unknown-elf-gcc toolchain
  - qemu-system-riscv64 virt machine
  - no_std bare-metal (no libc)
initial_validation_binding:
  - build_kernel
  - qemu_boot_smoke
  - verify_page_allocator
```

---

### 5.1.3 ArchitectureSlice

**用途**：每阶段引入的机制、依赖和验证计划。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 如 `slice-01-boot` |
| `stage` | string | 是 | 对应阶段名，如 `boot` |
| `title` | string | 是 | 切片标题 |
| `summary` | string | 是 | 切片摘要 |
| `depends_on_slices` | list | 否 | 依赖的前置切片 |
| `depends_on_adrs` | list | 否 | 依赖的 ADR |
| `mechanisms` | list | 是 | 本阶段引入的机制 |
| `affected_modules` | list | 是 | 受影响的模块 |
| `new_operations` | list | 否 | 新增操作（全限定名如 `kernel/boot.boot_banner`） |
| `removed_or_replaced_mechanisms` | list | 否 | 移除或替换的旧机制 |
| `invariants` | list | 是 | 本阶段不变量 |
| `security_boundaries` | list | 否 | 安全边界 |
| `concurrency_highlights` | list | 否 | 并发要点 |
| `validation_binding` | object | 是 | 验证绑定（`must_pass` 列表） |
| `open_questions` | list | 否 | 开放问题 |

**xv6 示例**（`spec/architecture/slices/01-boot.yaml` 片段）：

```yaml
id: slice-01-boot
stage: boot
title: Early Boot and Banner
summary: >
  Minimal entry sequence: set up stack, zero BSS, initialize
  SBI console, print boot banner, and signal boot completion.
depends_on_slices: []
mechanisms:
  - RISC-V S-mode entry from OpenSBI
  - stack allocation in BSS
  - SBI console putchar via ecall
  - boot banner display
  - shutdown via SBI SRST
affected_modules:
  - kernel/headers
  - kernel/boot
new_operations:
  - kernel/boot.boot_banner
  - kernel/boot.console_putchar
  - kernel/boot.shutdown
invariants:
  - kernel entry runs on a single hart
  - BSS is zeroed before any global variable access
validation_binding:
  must_pass:
    - build_kernel
    - qemu_boot_smoke
    - verify_boot_banner
```

---

### 5.1.4 ADR (Architecture Decision Record)

**用途**：记录关键设计决策及其替代方案。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 如 `ADR-001-paging-model` |
| `date` | string | 是 | 决策日期 |
| `status` | string | 是 | `proposed` / `accepted` / `deprecated` / `superseded` |
| `decision` | string | 是 | 决策内容 |
| `context` | string | 是 | 决策背景 |
| `alternatives` | list | 是 | 替代方案及取舍理由 |
| `tradeoffs` | list | 是 | 权衡说明 |
| `affected_specs` | list | 是 | 受影响的 spec 文件 |
| `verification_impact` | list | 否 | 验证影响 |

---

### 5.1.5 ArchitectureCompositionSpec

**用途**：跨模块架构级组合不变量，汇总所有 CompositionSpec 和 Slice 的跨模块约束。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 标识符 |
| `title` | string | 是 | 标题 |
| `summary` | string | 是 | 摘要 |
| `related_slices` | list | 是 | 关联的切片 |
| `affected_modules` | list | 是 | 受影响的模块 |
| `cross_component_rules` | list | 是 | 跨组件规则（见子字段） |

**`cross_component_rules` 子字段**：

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 规则名 |
| `description` | string | 是 | 规则描述 |
| `invariant` | string | 是 | 不变量 |
| `authority_boundary` | string | 否 | 权限边界 |
| `concurrency_boundary` | string | 否 | 并发边界 |
| `failure_boundary` | string | 否 | 失败边界 |
| `affected_modules` | list | 是 | 受影响的模块 |
| `tests` | list | 否 | 关联测试 |

---

## 5.2 Module Spec

### 5.2.1 推荐目录

```text
spec/modules/
  kernel/
    module.yaml            # 聚合父模块
    memory/
      module.yaml          # ModuleSpec
      concurrency.yaml     # ConcurrencySpec
      tests.yaml           # 测试表面
      ops/                 # OperationContract
        kalloc.yaml
        kfree.yaml
        kvmmake.yaml
    syscall/
      module.yaml
      concurrency.yaml
      ops/
        sys_write.yaml
        sys_fork.yaml
  user/
    module.yaml
    programs/
      module.yaml
      ops/
        init.yaml
```

约定：
- `module` 字段必须与 `spec/modules/` 下的相对目录一致
- 父模块是一等 `ModuleSpec`，可只做聚合，不必拥有自己的 `ops/`
- 跨模块操作引用优先写全限定形式，如 `kernel/syscall.sys_write`

---

### 5.2.2 ModuleSpec

**用途**：描述一个模块的状态空间、接口族、不变量和测试表面。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 如 `kernel/memory` |
| `module` | string | 是 | 模块路径，与目录一致 |
| `stage` | string | 是 | 所属阶段 |
| `purpose` | string | 是 | 模块用途 |
| `related_slices` | list | 是 | 关联的 ArchitectureSlice |
| `related_adrs` | list | 否 | 关联的 ADR |
| `owned_state` | list | 是 | 模块管理的状态 |
| `exported_interfaces` | list | 是 | 对外提供的接口（函数名列表） |
| `imported_interfaces` | list | 是 | 依赖的外部接口 |
| `module_invariants` | list | 是 | 模块级不变量 |
| `error_model` | list | 是 | 错误模型 |
| `resource_lifetime_rules` | list | 是 | 资源生命周期规则 |
| `security_boundary` | list | 是 | 安全边界 |
| `test_surfaces` | list | 是 | 测试表面 |

**xv6 示例**（`spec/modules/kernel/memory/module.yaml` 片段）：

```yaml
id: kernel/memory
module: kernel/memory
stage: memory
purpose: >
  Physical page allocator with freelist, Sv39 page table
  construction, kernel virtual address mapping, and user
  page table management.
related_slices:
  - slice-02-memory
owned_state:
  - physical page freelist
  - kernel page table (kernel_pagetable)
  - physical memory layout bounds
exported_interfaces:
  - kinit
  - kalloc
  - kfree
  - kvmmake
  - kvmmap
  - walk
  - uvmcreate
  - uvmalloc
  - uvmfree
  - uvmcopy
  - copyin
  - copyout
imported_interfaces: []
module_invariants:
  - every allocated page is 4096-byte aligned
  - freelist is a singly-linked list of free pages
  - a page is either on the freelist OR allocated, never both
  - kernel_pagetable provides identity mapping 0x80000000..0x88000000
error_model:
  - kalloc returns NULL when freelist is exhausted
  - walk returns NULL for invalid virtual addresses
resource_lifetime_rules:
  - allocated pages are freed back to freelist via kfree
  - page tables are freed recursively (3-level walk)
security_boundary:
  - kernel page table entries have U-bit clear
  - copyin/copyout validate user addresses via walkaddr
test_surfaces:
  - alloc-free cycle coverage
  - page table walk correctness
  - copyin/copyout boundary checks
```

---

### 5.2.3 ConcurrencySpec

**用途**：对并发敏感模块显式维护锁规则和并发约束。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `module` | string | 是 | 所属模块 |
| `shared_state` | list | 是 | 共享状态 |
| `lock_types` | list | 是 | 锁类型（如 `spinlock`、`sleeplock`） |
| `lock_order` | list | 是 | 锁获取顺序 |
| `atomic_sections` | list | 否 | 原子操作区 |
| `interrupt_rules` | list | 否 | 中断规则 |
| `wait_wakeup_rules` | list | 否 | 等待/唤醒规则 |
| `rely` | list | 否 | 依赖的并发假设 |
| `guarantee` | list | 否 | 保证的并发性质 |
| `forbidden_patterns` | list | 否 | 禁止的并发模式 |

---

## 5.3 Operation Contract

### 5.3.1 OperationContract

**用途**：描述单个操作的精确行为——前置/后置条件、锁规则、失败语义、测试义务和代码生成目标。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 全限定操作 ID，如 `kernel/memory.kalloc` |
| `module` | string | 是 | 所属模块 |
| `operation` | string | 是 | 操作名（函数名） |
| `stage` | string | 是 | 所属阶段 |
| `purpose` | string | 是 | 操作用途 |
| `related_slice` | string | 否 | 关联的 ArchitectureSlice |
| `related_adr` | string/null | 否 | 关联的 ADR |
| `depends_on` | object | 是 | 依赖声明（见子字段） |
| `rely` | object | 是 | 依赖假设（见子字段） |
| `guarantee` | object | 是 | 保证效果（见子字段） |
| `preconditions` | list | 是 | 前置条件 |
| `postconditions` | list | 是 | 后置条件 |
| `invariants_preserved` | list | 是 | 保持的不变量 |
| `failure_semantics` | string/list | 是 | 失败语义 |
| `concurrency` | object | 是 | 并发约束（见子字段） |
| `security` | object | 是 | 安全约束（见子字段） |
| `observability` | object | 否 | 可观察性（见子字段） |
| `test_obligations` | object | 是 | 测试义务（见子字段） |
| `codegen` | object | 否 | 代码生成目标（见子字段） |

---

### 5.3.2 `depends_on` 子字段

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `requires_modules` | list | 是 | 依赖的模块 |
| `requires_ops` | list | 否 | 依赖的其他操作（全限定 ID） |

---

### 5.3.3 `rely` 子字段

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `state_assumptions` | list | 否 | 状态假设 |
| `callable_interfaces` | list | 否 | 可调用接口 |
| `resource_assumptions` | list | 否 | 资源假设 |
| `lock_assumptions` | list | 否 | 锁假设 |

---

### 5.3.4 `guarantee` 子字段

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `returns` | list | 是 | 返回值语义（如 `void *`、`-1 on error`） |
| `state_updates` | list | 否 | 状态更新 |
| `side_effects` | list | 否 | 副作用 |
| `emitted_events` | list | 否 | 发出的事件 |

---

### 5.3.5 `concurrency` 子字段

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `atomicity` | string | 是 | 原子性描述 |
| `lock_order` | list | 是 | 锁获取顺序 |
| `interrupt_state` | string | 是 | 中断状态 |
| `wait_wakeup_rules` | list | 否 | 等待/唤醒规则 |

---

### 5.3.6 `security` 子字段

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `authority_check` | string | 是 | 权限检查 |
| `isolation_boundary` | string | 是 | 隔离边界 |
| `user_pointer_policy` | string | 是 | 用户指针策略 |

---

### 5.3.7 `observability` 子字段

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `traces` | list | 否 | 追踪点 |
| `counters` | list | 否 | 计数器 |
| `expected_logs` | list | 否 | 预期日志 |

---

### 5.3.8 `test_obligations` 子字段

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `public` | list | 是 | 公开测试义务（学生可见） |
| `generated` | list | 否 | 自动生成测试 |
| `hidden_tags` | list | 否 | 隐藏测试标签（仅 staff 可见） |

---

### 5.3.9 `codegen` 子字段

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `targets` | list | 是 | 代码生成目标列表（见子字段） |
| `forbidden_changes` | list | 否 | 禁止的修改 |
| `required_followup_checks` | list | 否 | 生成后必须执行的检查 |

**`targets` 子字段**：

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | string | 是 | 目标类型：`file` / `symbol` / `module` / `test` / `build` |
| `path` | string | 是 | 目标文件路径 |
| `symbols` | list | 否 | 目标符号（`kind=symbol` 时） |
| `owner` | string | 是 | 所属模块 |
| `mode` | string | 是 | `create` / `modify` / `replace` |

**生成器注意事项**：生成器需根据 `editable_region.file` 的扩展名选择目标语言/格式：

| 操作类型 | 示例 | `editable_region` 指向 | 需生成格式 |
|---------|------|----------------------|-----------|
| C 函数 | `kernel/memory.kalloc` | `kernel/memory.c` | C 代码 |
| 汇编函数 | `kernel/process.swtch` | `kernel/swtch.S` | RISC-V 汇编 |
| 头文件 | `kernel/headers.types` | `include/types.h` | C 头文件 |
| 链接脚本 | `kernel/headers.link_ld` | `kernel/link.ld` | GNU ld 脚本 |
| 用户程序 | `user/programs.init` | `user/init.c` | freestanding 用户 C 代码 |

---

### 5.3.10 完整示例

**xv6 示例**（`spec/modules/kernel/memory/ops/kalloc.yaml`）：

```yaml
id: kernel/memory.kalloc
module: kernel/memory
operation: kalloc
stage: memory
purpose: >
  Allocate one 4096-byte physical page from the freelist.
  Zero the page before returning.
related_slice: slice-02-memory
depends_on:
  requires_modules:
    - kernel/memory
  requires_ops:
    - kernel/memory.kinit

rely:
  state_assumptions:
    - freelist has been initialized by kinit
  callable_interfaces:
    - kmem.freelist (global)
  resource_assumptions:
    - at least one free page exists (or NULL is returned)
  lock_assumptions:
    - acquires kmem.lock

guarantee:
  returns:
    - void * to a 4096-byte zeroed page on success
    - NULL on exhaustion
  side_effects:
    - page is removed from freelist
    - page content is zeroed

preconditions:
  - kernel is initialized past kinit
postconditions:
  - returned page is 4096-byte aligned and zeroed
invariants_preserved:
  - freelist integrity (no double-links)
failure_semantics:
  - returns NULL when freelist is empty

concurrency:
  atomicity: freelist pop under spinlock
  lock_order:
    - kmem.lock
  interrupt_state: lock is push_off / pop_off

security:
  authority_check: none
  isolation_boundary: caller decides use
  user_pointer_policy: never returns user-accessible memory

observability:
  counters:
    - allocation count

test_obligations:
  public:
    - kalloc_exhaustion
    - kalloc_alignment
  generated:
    - kalloc_zeroed
  hidden_tags:
    - kalloc_race
    - kalloc_memory_leak

codegen:
  targets:
    - kind: symbol
      path: kernel/memory.c
      symbols: [kalloc]
      owner: kernel/memory
      mode: create
  forbidden_changes:
    - do not modify code outside the marked region
    - do not create helper files
    - do not modify build scripts
  required_followup_checks:
    - make build
    - verify page alignment
```

---

## 5.4 StageGate 约束

VOS 强制执行以下门禁规则：

1. 没有对应 `ArchitectureSlice`，不得引入新核心模块
2. 没有 `ModuleSpec`，不得生成该模块核心实现
3. 没有 `OperationContract`，不得修改核心函数
4. 没有 `CompositionSpec`，不得合并跨模块机制
5. 没有 commit-backed `SpecPatch`，不得引入架构级变化
6. 没有 `test_obligations`，不得进入 `verify patch`

---

## 5.5 相关文档

- [06 Spec Schema 参考（下）：工具链、验证、演化、目标](./06-spec-schema-toolchain-verify-evolution.md)
- [02 CLI 命令参考（上）：项目、Spec 与架构](./02-commands-spec-arch.md)
- [04 CLI 命令参考（下）：验证、Agent、报告与知识库](./04-commands-verify-agent-report.md)
