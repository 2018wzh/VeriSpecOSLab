# VeriSpecOSLab：面向学生个性化构建可验证完整操作系统的 AI 辅助规格驱动教学实验方案

## 一、方案概述

**VeriSpecOSLab** 是一种面向操作系统课程、系统软件实践和科研训练的教学实验方案。该方案以“规格驱动、AI 协作、验证反馈、个性化架构设计、可复现评价”为核心，支持学生在 AI 辅助下独立完成一个可运行、可测试、可验证、可演化的完整教学操作系统，并在条件允许时将系统从模拟器迁移到真实物理硬件。

本方案借鉴 SYSSPEC 的思想：不直接使用模糊自然语言提示生成复杂系统代码，而是通过结构化规格描述系统的功能、模块关系、并发约束和演化关系，再由 AI 辅助生成、验证和演化实现。其核心启发在于：将系统开发重心从低层代码编写转向高层规格设计，并通过验证反馈约束 AI 生成过程。

VeriSpecOSLab 将这一思想从文件系统扩展到完整操作系统教学实验中，使学生不再只是补全教师预设代码，而是围绕自己提出的架构设计、技术栈、验证目标和演化目标，从零构建具有个人设计特色的 OS。

---

## 二、方案名称

**VeriSpecOSLab：面向学生个性化构建可验证完整操作系统的 AI 辅助规格驱动教学实验方案**

名称含义：

```text
Veri  = Verification / Verifiable，可验证
Spec  = Specification，规格驱动
OS    = Operating System，操作系统
Lab   = 教学实验平台 / 实验方案
```

该名称强调四个核心要素：

```text
AI-assisted：AI 辅助
Spec-guided：规格驱动
Verifiable：可验证
Personalized OS Construction：个性化操作系统构建
```

---

## 三、总体目标

本实验方案的目标不是让所有学生实现同一种教学内核，而是在统一的规格方法、验证框架和 AI 协作规范下，允许学生自由设计系统架构、选择技术栈、定义系统目标和优化方向，最终完成具有个人设计特色的完整操作系统。

总体目标包括：

1. **完整系统构建能力**  
   学生需要完成从启动、内存管理、异常处理、线程/进程、系统调用或 IPC、用户态程序、I/O、文件系统或服务抽象到 shell/demo 程序的完整链路。

2. **规格化设计能力**  
   学生需要为核心模块编写结构化规格，包括前置条件、后置条件、不变量、模块依赖、并发规则、错误语义和测试义务。

3. **架构设计与掌控能力**  
   学生需要维护一组递进式架构设计产物，包括 `ArchitectureSeed`、`ArchitectureSlice[]`、`ArchitectureDecisionRecord[]`、`ArchitectureCompositionSpec` 和 `FinalArchitectureSynthesis`，明确说明自己的 OS 由哪些架构机制组成、参考了哪些现有系统、修改和拒绝了哪些机制、各模块如何组合、跨机制不变量如何保持。

4. **AI 协作开发能力**  
   学生通过规格约束 AI，而不是简单让 AI 代写代码。AI 主要用于架构规格检查、模块规格生成、代码生成、测试生成、错误定位、验证反馈和演化建议。

5. **可验证系统能力**  
   系统不仅要能运行，还要通过自动测试、运行时断言、不变量检查、模糊测试、模型检查或局部形式化证明提供正确性证据。

6. **个性化目标实现能力**  
   学生可选择二进制兼容、系统调用性能优化、IPC 性能优化、文件系统优化、实时性优化、安全隔离、可验证性增强、镜像体积优化、启动速度优化等目标。

7. **物理硬件移植能力**  
   在完成 QEMU 或其他模拟环境中的基础系统后，鼓励学生将内核移植到真实开发板或通用硬件平台，理解 boot chain、设备树/ACPI、串口、定时器、中断控制器、内存布局、外设驱动和真实硬件调试方法。

---

## 四、核心教学理念

VeriSpecOSLab 的基本思想可以概括为：

> **以规格约束 AI，以验证保障正确，以架构设计训练系统掌控能力。**

传统 OS 实验通常是：

```text
教师给框架 → 学生补代码 → 跑通测试
```

VeriSpecOSLab 改为：

```text
学生提出 ArchitectureSeed
    ↓
随课程阶段提交 ArchitectureSlice
    ↓
每个 Slice 绑定 ModuleSpec、实现、测试与验证证据
    ↓
关键设计选择记录为 ArchitectureDecisionRecord
    ↓
通过 SpecPatch 演化系统
    ↓
平台 Agent 根据当前阶段和历史设计动态派生验证
    ↓
课程末期合成 FinalArchitectureSynthesis
    ↓
可选移植到物理硬件
    ↓
形成完整个性化 OS
```

因此，学生学习的重点从“写出某段代码”提升为：

```text
定义什么是正确
说明为什么这样设计
约束 AI 如何实现
验证实现是否满足规格
解释架构设计取舍
维护和演化复杂系统
```

---

## 五、个性化架构设计说明

实验要求学生提交一组结构化的递进式架构设计产物，明确说明自己的系统由哪些架构机制组成、参考了哪些现有系统、修改了哪些设计、拒绝了哪些设计、各模块如何组合，以及这些组合如何被验证。

### 1. ArchitectureSeed 与阶段性架构说明

学生围绕阶段性设计持续维护，课程末期可以归纳为如下综合视图：

```yaml
NormalizedArchitectureDesign:
  architecture_name:
  architecture_summary:

  reference_systems:
    - system:
      borrowed_concepts:
      modified_concepts:
      rejected_concepts:
      reason:

  kernel_organization:
    type: monolithic | microkernel | hybrid | exokernel | library_os | custom
    explanation:
    trusted_computing_base:
    in_kernel_components:
    user_space_services:

  execution_model:
    unit:
      - process
      - thread
      - task
      - fiber
      - actor
    scheduling:
      scheduler_type:
      preemption:
      priority_model:
      blocking_model:
    lifecycle:
      create:
      destroy:
      wait:
      signal_or_notify:

  protection_model:
    privilege_levels:
    address_spaces:
    isolation_boundary:
    permission_mechanism:
      - page_table
      - capability
      - handle_rights
      - namespace_permission
      - custom
    user_pointer_policy:
    kernel_object_access_policy:

  communication_model:
    mechanisms:
      - syscall
      - IPC
      - message_passing
      - shared_memory
      - event_channel
      - file_interface
    synchronous_or_async:
    copy_policy:
      - copy
      - zero_copy
      - shared_page
    security_check:
    failure_semantics:

  resource_model:
    resource_abstractions:
      - fd
      - handle
      - capability
      - port
      - file
      - object
      - endpoint
    lifetime_management:
    reference_counting:
    ownership_transfer:
    revocation:

  namespace_model:
    global_namespace:
    per_process_namespace:
    mount_or_bind:
    object_naming:
    path_resolution:

  syscall_or_api_model:
    interface_style:
      - POSIX_like
      - NT_like
      - Mach_like
      - L4_like
      - Plan9_like
      - custom
    abi:
    error_model:
    blocking_semantics:

  memory_model:
    physical_memory:
    virtual_memory:
    user_kernel_split:
    mmap_or_region_model:
    page_fault_policy:
    sharing_policy:

  io_model:
    device_driver_location:
      - kernel
      - user
      - mixed
    block_io:
    console_io:
    network_io:
    file_io:
    async_io:

  file_or_storage_model:
    required: true | false
    abstraction:
      - VFS
      - file_server
      - object_store
      - raw_block
      - custom
    consistency:
    cache_policy:

  compatibility_model:
    target:
      - none
      - Linux_static_ELF_subset
      - POSIX_source_subset
      - MachO_subset
      - PE_COFF_subset
      - custom_ABI
    compatibility_scope:
    non_goals:

  evolution_model:
    spec_patch_policy:
    module_dependency_graph:
    replaceable_components:

  validation_binding:
    base_tests:
    selected_architecture_tests:
    custom_tests:
    invariants:
    benchmarks:
    trace_oracles:
```

### 2. Reference Systems

学生可以参考 Linux、L4/seL4、Darwin/XNU、Windows NT、Plan 9、RTOS、Unikernel 等系统，但必须说明借鉴、修改和拒绝的内容。

示例：

```yaml
reference_systems:
  - system: Linux
    borrowed_concepts:
      - static ELF loading
      - syscall ABI subset
      - file descriptor table
    modified_concepts:
      - no fork
      - simplified VFS
      - no signal subsystem
    rejected_concepts:
      - full POSIX process model
      - dynamic linker
    reason:
      - reduce implementation complexity
      - focus on syscall compatibility

  - system: seL4/L4
    borrowed_concepts:
      - endpoint IPC
      - explicit capability transfer
    modified_concepts:
      - simplified capability revoke
    rejected_concepts:
      - full verified kernel object model
```

### 3. ArchitectureCompositionSpec

个性化架构组合必须提交 `ArchitectureCompositionSpec`，描述跨机制组合关系与不变量。

```yaml
ArchitectureCompositionSpec:
  cross_component_rules:
    - name: fd_to_object_mapping
      description: fd is a compatibility view over kernel object handles
      invariant:
        - every fd maps to exactly one live object handle
        - closing fd decrements object refcount
        - object cannot be destroyed while fd exists
      affected_modules:
        - fd_table
        - object_manager
        - vfs
      tests:
        - fd_close_refcount
        - invalid_fd_permission

    - name: capability_checked_ipc
      description: IPC endpoint access must be authorized by capability
      invariant:
        - sender must hold send right
        - receiver must hold receive right
        - transferred capability must be explicitly marked transferable
      affected_modules:
        - ipc
        - capability
        - scheduler
      tests:
        - invalid_capability_send
        - endpoint_close_wakeup

    - name: namespace_vfs_resolution
      description: path lookup uses per-process namespace before VFS lookup
      invariant:
        - path resolution cannot escape mounted namespace root
        - device files are resolved through namespace binding
      affected_modules:
        - namespace
        - vfs
        - device_service
      tests:
        - namespace_escape_failure
        - device_service_open
```

该部分用于考察学生是否真正掌控架构组合，而不是机械拼装概念。

### 4. 示例设计

```yaml
DesignGoalSpec:
  project_name: CapFS-OS
  design_intent:
    summary: >
      A small teaching OS combining Linux-compatible syscall entry,
      L4-style capability-checked IPC, and Plan9-style per-process namespace.
    primary_goal:
      - run static ELF user programs
      - support service-oriented device and file abstractions
      - verify capability-protected IPC and namespace isolation
    non_goals:
      - full POSIX compatibility
      - fork/exec semantic completeness
      - SMP scalability

  FinalArchitectureSynthesis:
    reference_systems:
      - system: Linux
        borrowed_concepts:
          - syscall ABI subset
          - ELF loader
          - fd table
        modified_concepts:
          - no fork
          - no signal
          - simplified open/read/write/close
        rejected_concepts:
          - full VFS
          - dynamic linker
        reason: Linux ABI is used only as a compatibility surface.

      - system: L4/seL4
        borrowed_concepts:
          - capability-protected endpoint
          - user-space services
        modified_concepts:
          - simplified capability derivation
        reason: Capability is used as the internal authority model.

      - system: Plan9
        borrowed_concepts:
          - per-process namespace
          - device-as-file interface
        modified_concepts:
          - no full 9P protocol
        reason: Namespace is used to unify service discovery.

    kernel_organization:
      type: hybrid
      in_kernel_components:
        - scheduler
        - memory_manager
        - syscall_dispatcher
        - capability_manager
        - ipc_fast_path
      user_space_services:
        - console_service
        - file_service
        - block_service

    execution_model:
      unit:
        - process
        - thread
      scheduling:
        scheduler_type: round_robin
        preemption: timer_preemptive
        blocking_model: wait_queue

    protection_model:
      privilege_levels:
        - kernel
        - user
      address_spaces: per_process
      permission_mechanism:
        - page_table
        - capability
      user_pointer_policy:
        - copy_from_user required
        - copy_to_user required

    communication_model:
      mechanisms:
        - syscall
        - IPC
      syscall_role: compatibility and kernel service entry
      ipc_role: user service communication
      security_check:
        - endpoint send/recv capability

    resource_model:
      resource_abstractions:
        - fd
        - capability
        - endpoint
        - object
      lifetime_management:
        - refcount
        - explicit close
      ownership_transfer:
        - capability transfer through IPC

    namespace_model:
      per_process_namespace: true
      path_resolution:
        - namespace lookup
        - mount binding
        - service dispatch

    compatibility_model:
      target:
        - Linux_static_ELF_subset
      compatibility_scope:
        syscalls:
          - read
          - write
          - exit
          - openat
          - close
          - fstat
          - brk
      non_goals:
        - mmap
        - fork
        - signal
        - dynamic linking
```

---

## 六、技术栈选择

学生可根据设计目标自由选择技术栈，但必须写入 `TechStackSpec`。

示例：

```yaml
TechStackSpec:
  Language:
    - C
    - Rust no_std
    - Zig
    - C++
    - C/Rust hybrid

  Architecture:
    - RISC-V64
    - x86_64
    - AArch64

  Boot:
    - OpenSBI
    - UEFI
    - Limine
    - Multiboot2
    - custom bootloader

  Toolchain:
    - GCC
    - LLVM/Clang
    - Rust nightly
    - Zig cc
    - LLD

  Runtime:
    - QEMU
    - bare metal
    - virtio
    - microVM

  HardwareTarget:
    - QEMU only
    - Raspberry Pi / AArch64 board
    - RISC-V SBC / FPGA softcore
    - x86_64 PC / NUC
    - microcontroller-class board for RTOS route
```

学生需要说明：

```text
为什么选择该语言
为什么选择该硬件架构
为什么选择该启动方式
是否计划移植到物理硬件，以及目标硬件是什么
该技术栈对安全性、性能、复杂度、可验证性的影响
AI 在该技术栈下的优势与风险
```

---

## 七、统一模块规格框架

虽然架构和技术栈允许个性化，但所有学生必须使用统一的模块规格方法。

每个核心模块都需要提交规格文件：

```yaml
Module:
  name:

Purpose:

State:

Interface:

Preconditions:

Postconditions:

Invariants:

Rely:

Guarantee:

Concurrency:

Safety:

Error Cases:

Test Obligations:

Spec Patch History:
```

### 示例：页分配器规格

```yaml
Module:
  name: PhysicalPageAllocator

State:
  free_pages
  allocated_pages
  reserved_regions
  refcount[]

Interface:
  alloc_page(owner) -> Page | ENOMEM
  free_page(owner, page) -> Result

Invariants:
  - reserved pages are never allocated
  - free page has refcount == 0
  - allocated page has refcount > 0
  - no page is both free and allocated

Postconditions:
  alloc_page success:
    - returned page belongs to owner
    - returned page is removed from free_pages

  alloc_page failure:
    - allocator state remains unchanged
```

---

## 八、实验内容结构

实验分为公共核心阶段、递进式架构设计阶段、个性化机制实现阶段、进阶目标阶段、物理硬件移植阶段和评价阶段。

### 阶段一：公共核心阶段

所有学生都需要完成：

```text
Boot
UART / Console
Trap / Exception
Physical Memory
Virtual Memory
Thread or Process
Basic Scheduler
Syscall or IPC Entry
User Mode
Basic I/O
```

最低目标：

```text
系统可启动
可输出日志
可处理中断和异常
可管理内存
可创建执行单元
可进入用户态
可运行至少一个用户程序
```

### 阶段二：递进式架构设计阶段

学生提交：

```text
DesignGoalSpec
ArchitectureSeed
ArchitectureSlice
ArchitectureDecisionRecord
ArchitectureCompositionSpec
TechStackSpec
ArchitectureReferenceReport
StageValidationBinding
```

评价重点：

```text
核心抽象是否清晰
模块边界是否合理
参考系统理解是否准确
修改和拒绝的机制是否有理由
跨机制不变量是否明确
设计是否绑定到测试与验证
```

### 阶段三：个性化机制实现阶段

学生根据已经批准的 `ArchitectureSlice` 和 `ArchitectureCompositionSpec` 实现架构机制。示例机制包括：

```text
syscall ABI
ELF loader
process / thread / task
fd table
object manager
handle table
capability manager
endpoint IPC
Mach-like port/message
per-process namespace
VFS / file server
user-space service
priority scheduler
single address space runtime
```

机制可以自由组合，但必须在 `ArchitectureCompositionSpec` 中说明组合关系和不变量。

### 阶段四：进阶目标阶段

学生可选择兼容性、优化、安全、验证或硬件移植目标。

#### A. 二进制兼容目标

可选方向：

```text
Linux static ELF compatibility
POSIX source-level compatibility
PE/COFF subset compatibility
Mach-O subset compatibility
Custom ABI compatibility
```

Linux ABI 子集要求示例：

```text
ELF:
  - PT_LOAD 加载
  - 用户栈布局
  - argc / argv / envp
  - auxv 可选

Syscall:
  - read
  - write
  - exit
  - brk
  - mmap
  - munmap
  - openat
  - close
  - fstat
  - getpid
  - clock_gettime
```

验收目标：

```text
运行 hello-static
运行 syscall smoke test
运行简单 busybox applet 子集
syscall trace 与预期一致
```

#### B. 专项优化目标

可选方向：

```text
syscall latency optimization
IPC performance optimization
file system optimization
real-time latency optimization
boot time optimization
image size optimization
memory footprint optimization
verifiability optimization
security isolation optimization
```

每个优化目标必须包含：

```text
baseline
optimization spec
benchmark
before/after result
correctness check
negative tradeoff analysis
```

### 阶段五：物理硬件移植目标

物理硬件移植是 VeriSpecOSLab 的重要教学扩展目标。它不要求所有学生必须完成，但建议作为高阶实践或课程挑战项纳入实验体系。

可选硬件方向：

```text
AArch64 开发板：Raspberry Pi、RK 系列开发板、树莓派兼容板
RISC-V 开发板：HiFive、VisionFive、LicheeRV、QEMU 对应硬件族
x86_64 物理机：旧 PC、NUC、教学实验机
RTOS 板卡：Cortex-M / RISC-V MCU 开发板
FPGA / Softcore：自定义 RISC-V softcore 平台
```

物理移植规格 `HardwarePortSpec` 至少包括：

```yaml
HardwarePortSpec:
  TargetBoard:
  CPUArchitecture:
  BootChain:
    - firmware / boot ROM
    - OpenSBI / U-Boot / UEFI / custom loader
    - kernel entry convention

  MemoryMap:
    - RAM base and size
    - MMIO regions
    - reserved regions
    - kernel load address

  DeviceDiscovery:
    - Device Tree
    - ACPI
    - static board description

  RequiredDrivers:
    - UART / serial console
    - timer
    - interrupt controller
    - optional: block device / SD card / virtio / network

  PortingInvariants:
    - kernel must not allocate reserved memory
    - MMIO regions must not be mapped as normal cacheable RAM
    - interrupt handler must acknowledge device interrupt exactly once
    - timer interrupt must not starve normal scheduling
```

移植阶段建议分三步：

```text
Level 1: Bare-metal bring-up
  - 串口输出
  - 正确解析或静态声明内存布局
  - panic / log 可用

Level 2: Kernel core on hardware
  - 页分配器可用
  - trap / interrupt 可用
  - timer tick 可用
  - 至少一个内核线程或用户程序可运行

Level 3: Device and workload
  - 支持 SD 卡、块设备、网络或显示等至少一种真实外设
  - 运行 shell、测试程序或专项 benchmark
```

---

## 九、AI 协作规范

允许 AI 完成：

```text
根据架构草案生成 ArchitectureSeed 或当前阶段的 ArchitectureSlice 草案
检查架构机制组合冲突
根据规格生成代码
根据规格生成测试
检查规格缺陷
解释编译错误
辅助定位 bug
提出 spec patch 建议
生成文档和注释
```

不允许：

```text
直接要求 AI 一次性生成完整 OS
跳过规格直接生成核心模块
提交未理解的 AI 代码
删除测试以通过实验
绕过 invariant checker
用模糊自然语言替代结构化规格
```

学生必须提交 `AICollaborationLog`：

```text
输入给 AI 的规格
AI 输出摘要
学生采纳内容
学生修改内容
AI 生成错误
验证如何发现问题
规格如何修正
最终代码如何变化
```

每位学生至少需要记录一个 AI 错误案例，例如：

```text
AI 直接解引用用户指针
AI 忘记释放锁
AI 将线程重复加入 run queue
AI 忘记 fd refcount
AI 在阻塞路径持有 spinlock
AI 未处理 syscall 错误返回
AI 混淆 capability 与 fd 的权限边界
AI 将 microkernel 设计误写成全内核服务
```

---

## 十、可验证元素设计

VeriSpecOSLab 的“可验证”采用分层设计。

### 1. 架构规格可检查

通过 `arch_lint` 检查：

```text
是否有 ArchitectureSeed 与当前阶段的 ArchitectureSlice
是否说明 reference_systems
是否说明 borrowed / modified / rejected concepts
是否有 non-goals
是否说明 kernel organization
是否说明 protection / communication / resource model
是否有 ArchitectureCompositionSpec
是否有 cross-component invariants
是否绑定测试、benchmark 或 trace oracle
```

### 2. 模块规格可检查

通过 `spec_lint` 检查：

```text
是否有接口定义
是否有 pre/postcondition
是否有 invariant
是否有 rely/guarantee
是否有错误语义
是否有测试义务
是否存在未定义依赖
是否存在明显循环依赖
```

### 3. 测试可验证

每个模块都需要从规格导出测试：

```text
正常路径测试
错误路径测试
边界条件测试
precondition violation 测试
postcondition 测试
invariant preservation 测试
concurrency stress test
composition consistency test
```

### 4. 运行时不变量检查

Debug kernel 中加入：

```text
check_page_allocator_invariant()
check_page_table_invariant()
check_runqueue_invariant()
check_fdtable_invariant()
check_ipc_queue_invariant()
check_capability_invariant()
check_object_manager_invariant()
check_namespace_invariant()
check_vfs_invariant()
```

### 5. 模型检查

进阶学生可以对关键并发模块使用 TLA+ / PlusCal 建模：

```text
scheduler
IPC endpoint
pipe buffer
fd reference counting
capability revoke
blocking/wakeup protocol
namespace binding
object lifetime
```

### 6. 局部形式化证明

高阶选做：

```text
bitmap allocator
ring buffer
scheduler queue
capability access check
reference counting
handle table lookup
path resolution
```

可选工具：

```text
Dafny
Lean
Coq
CBMC
Kani
Prusti
TLA+
```

---

## 十一、验证测试矩阵

验证体系为：

```text
验证体系 =
  公共核心验证
+ 架构特性验证
+ 架构组合一致性验证
+ 个性化目标验证
```

### 1. 公共核心验证

```text
BaseTestSuite:
  boot:
    - qemu_boot_smoke
    - serial_banner_check
    - panic_path_check

  memory:
    - page_alloc_free
    - reserved_region_not_allocated
    - page_table_map_unmap
    - user_kernel_isolation

  trap:
    - illegal_instruction_trap
    - page_fault_trap
    - syscall_or_ipc_entry
    - timer_interrupt

  execution:
    - create_thread_or_process
    - scheduler_basic
    - user_mode_enter
    - run_user_hello

  io:
    - console_write
    - basic_input_optional
    - block_or_service_io_optional

  invariants:
    - page_allocator_invariant
    - runqueue_invariant
    - handle_or_fd_or_cap_table_invariant
```

### 2. 架构特性验证

平台根据学生声明的 feature 自动生成测试，而不是根据固定 profile 加载测试包。

示例声明：

```yaml
execution_model:
  unit:
    - process
    - thread
communication_model:
  mechanisms:
    - syscall
    - IPC
resource_model:
  resource_abstractions:
    - fd
    - capability
namespace_model:
  per_process_namespace: true
compatibility_model:
  target:
    - Linux_static_ELF_subset
```

平台自动选择：

```text
feature/process_lifecycle
feature/thread_scheduling
feature/syscall_entry
feature/ipc_basic
feature/fd_lifetime
feature/capability_permission
feature/per_process_namespace
feature/linux_static_elf_loader
```

### 3. 架构组合一致性验证

根据 `ArchitectureCompositionSpec` 自动选择：

```text
composition/fd_to_object_lifetime
composition/ipc_capability_permission
composition/syscall_user_pointer_safety
composition/namespace_path_resolution
composition/object_refcount
composition/endpoint_close_wakeup
```

### 4. 个性化目标验证合约

```yaml
GoalValidationContract:
  goal_id: syscall-latency-optimization
  category: optimization

  baseline:
    name: basic_syscall_path
    command: vos bench syscall --baseline

  target:
    metric: syscall_latency_ns
    expected:
      improvement_ratio: ">= 20%"

  correctness_guard:
    - BaseTestSuite
    - ArchitectureFeatureTestSuite
    - CompositionConsistencyTestSuite
    - syscall_semantics_test
    - user_kernel_isolation_test

  benchmark:
    command: vos bench syscall
    repeats: 30
    report: reports/syscall_latency.json

  negative_tradeoff:
    required: true
    check:
      - no_user_pointer_direct_deref
      - no_interrupt_state_leak
      - no_invariant_failure
```

---

## 十二、评价阶段设计

VeriSpecOSLab 的评价阶段不是只检查“能否运行”，而是评价系统的设计、规格、验证、架构个性化、AI 协作和进阶目标完成情况。

评价分为：

```text
1. 基础可运行性评价
2. 架构设计评价
3. 架构组合一致性评价
4. 规格与可验证性评价
5. 个性化目标评价
6. 物理硬件移植评价
7. AI 协作过程评价
8. 最终展示与答辩评价
```

### 1. 基础可运行性评价

所有项目必须满足：

```text
系统可启动
可输出日志
实现基本内存管理
具备内核/用户隔离或明确说明替代隔离模型
支持线程、进程、task 或等价执行单元
支持异常和系统调用或 IPC 入口
至少运行一个用户态程序或等价 workload
具备基本 I/O
```

### 2. 架构设计评价

评价结构：

```text
架构设计评分 =
  架构抽象清晰度 25%
+ 组件边界合理性 20%
+ 架构组合一致性 20%
+ 参考系统理解深度 15%
+ 取舍与非目标说明 10%
+ 可验证性绑定 10%
```

评价重点：

```text
是否只是贴了 Linux/L4/NT 标签
是否清楚说明核心抽象
是否清楚说明模块边界
是否说明跨模块交互
是否说明权限、生命周期、错误语义
是否说明为什么不采用某些现有机制
是否将架构设计绑定到测试、不变量和 benchmark
```

### 3. 架构组合一致性评价

评价内容：

```text
fd、handle、capability、object 等资源抽象之间关系是否明确
syscall、IPC、message、file interface 是否边界清晰
namespace、VFS、device service 是否组合一致
权限检查是否有统一来源
生命周期和引用计数是否一致
错误语义是否跨模块一致
组合不变量是否可测试
```

### 4. 规格与可验证性评价

评价内容：

```text
规格是否完整
pre/postcondition 是否清晰
invariant 是否覆盖关键安全属性
rely/guarantee 是否匹配
并发规则是否明确
错误语义是否完整
是否有 spec patch 演化记录
是否能从规格导出测试
```

最低要求：

```text
核心模块均有规格
至少 5 个关键不变量被运行时检查
至少 1 个模块有并发规格
至少 1 个跨组件组合不变量
至少 1 个功能通过 spec patch 演化
```

### 5. 个性化目标评价

#### 二进制兼容评价

评价内容：

```text
loader 正确性
ABI 约定
syscall 覆盖
错误语义
实际程序运行能力
trace 对比
```

示例测试：

```text
hello-static
echo
cat
ls-lite
busybox applet subset
PE no-import demo
Mach-O simple demo
```

#### 专项优化评价

评价要求：

```text
定义 baseline
定义优化目标
提供 benchmark
提供 before/after 数据
解释性能变化原因
分析正确性风险
说明是否破坏不变量
```

可评价指标：

```text
syscall latency
IPC ping-pong latency
file system throughput
metadata operation latency
real-time max latency
boot-to-shell time
image size
memory footprint
verification coverage
```

### 6. 物理硬件移植评价

评价内容：

```text
目标硬件选择是否合理
Boot chain 是否清晰
linker script 与内存布局是否正确
UART / timer / interrupt controller 是否可用
Device Tree / ACPI / BoardSpec 是否被正确处理
MMIO 映射与 cache 属性是否安全
QEMU 与真实硬件行为差异是否被记录
```

可选验收等级：

```text
Bring-up 级：真实硬件串口输出 kernel banner
Core 级：真实硬件上完成 timer、trap、内存管理和调度
Workload 级：真实硬件上运行用户程序、shell、文件系统或 benchmark
```

### 7. AI 协作过程评价

评价重点：

```text
是否以规格驱动 AI
是否使用 ArchitectureSeed / ArchitectureSlice 约束 AI
是否识别 AI 幻觉
是否通过测试反馈修正代码
是否保留人工设计决策
是否能解释关键实现
是否记录 AI 错误案例
```

### 8. 最终展示与答辩评价

必须展示：

```text
系统启动
用户态程序或等价 workload 运行
核心 syscall / IPC / 文件操作 / 服务调用
至少一个 invariant checker
至少一个架构组合不变量
至少一个 spec patch 演化案例
至少一个 AI 错误修正案例
```

根据设计自选展示：

```text
Linux ABI 兼容：
  静态 ELF / busybox 子集

Capability / IPC：
  IPC benchmark / capability 权限失败案例

Object / Handle：
  object namespace / handle 权限检查

Port / Message：
  port message demo

Namespace / File Server：
  namespace / file server demo

RTOS：
  cyclictest-like 延迟结果

Unikernel / Library OS：
  boot time / image size 对比

Hardware Porting：
  真实硬件串口启动日志 / timer 中断 / 用户程序运行演示
```

---

## 十三、评分结构

建议总成绩采用：

```text
总成绩 = 公共基础能力 30%
       + 架构设计与组合能力 20%
       + 规格与验证能力 25%
       + 个性化目标或硬件移植 15%
       + AI 协作与答辩 10%
```

| 项目 | 比例 | 说明 |
|---|---:|---|
| 公共基础能力 | 30% | 启动、内存、trap、调度、用户态、基本 I/O |
| 架构设计与组合能力 | 20% | ArchitectureSeed、ArchitectureSlice、CompositionSpec、参考系统理解、设计取舍 |
| 规格与验证能力 | 25% | pre/postcondition、invariant、rely/guarantee、测试与断言 |
| 个性化目标或硬件移植 | 15% | 二进制兼容、优化、安全隔离、物理硬件移植等 |
| AI 协作与答辩 | 10% | AI 使用记录、错误分析、人工理解、最终展示 |

---

## 十四、分层评价标准

### 合格

```text
系统可启动
有基本内存管理
有基本执行单元
可运行一个用户态程序或等价 workload
有 ArchitectureSeed 与至少一个阶段设计切片
有核心模块规格
有基础测试
能说明 AI 协作过程
```

### 良好

```text
支持多个用户态程序或多个服务
有基本 syscall / IPC / VFS / namespace / object 等至少一种架构机制
有 ArchitectureCompositionSpec
有运行时 invariant checker
有 spec patch 演化案例
有较完整测试集
```

### 优秀

```text
实现清晰的个性化架构组合
完成二进制兼容、专项优化或硬件移植目标
有可复现 benchmark 或硬件 bring-up 记录
有模型检查或局部形式化证明
能深入分析 AI 错误与规格修正
设计具有可持续演化能力
```

### 卓越

```text
运行真实目标系统程序子集或在物理硬件上稳定运行核心系统
显著优化某项系统指标或完成高质量跨平台移植
提出原创性 OS 架构组合或机制改进
关键模块具备机器验证或模型检查
实验结果可复现、可比较、可扩展
```

---

## 十五、课程时间安排建议

以 12 周实验周期为例：

| 周次 | 内容 | 产出 |
|---:|---|---|
| 第 1 周 | 方法介绍、AI 规范、规格模板 | OSDesignProposal |
| 第 2 周 | 技术栈选择、参考架构分析 | TechStackSpec / ArchitectureReferenceReport |
| 第 3 周 | 架构种子与初始方向 | ArchitectureSeed |
| 第 4 周 | Boot / Memory 设计切片与组合约束 | ArchitectureSlice / ArchitectureCompositionSpec |
| 第 5 周 | Boot 与最小内核 | 可启动内核 |
| 第 6 周 | 物理/虚拟内存 | MemorySpec + allocator/page table |
| 第 7 周 | Trap、syscall 或 IPC 入口 | TrapSpec / SyscallSpec / IPCSpec |
| 第 8 周 | 线程、调度、用户态 | Execution Slice + SchedulerSpec + user program |
| 第 9 周 | 个性化架构机制实现 | Resource / Namespace Slice、ADR、fd/capability/object/VFS/service 等 |
| 第 10 周 | 二进制兼容、优化或硬件移植 | CompatibilitySpec / OptimizationSpec / HardwarePortSpec |
| 第 11 周 | 验证、测试、benchmark 或硬件 bring-up | 测试报告、验证证据与移植记录 |
| 第 12 周 | 最终展示与答辩 | 完整系统、报告、演示 |

---

## 十六、最终提交物

每位学生最终提交：

```text
1. OSDesignProposal
2. TechStackSpec
3. ArchitectureReferenceReport
4. DesignGoalSpec
5. ArchitectureSeed
6. ArchitectureSlice 集合
7. ArchitectureDecisionRecord 集合
8. ArchitectureCompositionSpec
9. FinalArchitectureSynthesis
10. Module Specs
11. Verification Plan
12. CompatibilitySpec、OptimizationSpec 或 HardwarePortSpec
13. AICollaborationLog
14. Spec Patch History
15. Source Code
16. Test Suite
17. Benchmark Results 或 Hardware Bring-up Report
18. ArchitectureReviewReport
19. Final OS Image / Hardware Boot Image
20. Final Report
```

最终系统至少应支持：

```text
可启动
可输出
可管理内存
可处理中断/异常
可创建执行单元
可运行用户程序或等价 workload
具备基本系统调用或 IPC
具备基本 I/O 或文件/服务抽象
具备测试与不变量检查
具备清晰的架构设计说明
```

---

## 十七、开发环境与 Agent 平台

VeriSpecOSLab 应提供统一开发环境和 Agent 接入层。

总体结构：

```text
IDE / Editor / CLI
    ↓ OpenAI-compatible API
Agent Gateway
    ↓
Project Agent Runtime
    ↓
DevBox / Toolchain / CI / QEMU / Test / Spec Repo
```

Agent Gateway 对 IDE 暴露 OpenAI-compatible API：

```text
API Base URL: http://localhost:8080/v1
API Key: vos-local-token
Model: verispecoslab-agent
```

内部 Agent 包括：

```text
ArchitectureSpecAssistant
SpecAssistant
CodeGenAgent / SpecCompiler
SpecValidatorAgent
KernelDebugAgent
TestGenAgent
ReviewAgent
```

统一命令入口：

```bash
vos init
vos arch lint spec/architecture/seed.yaml
vos arch derive-tests spec/architecture/seed.yaml
vos spec lint spec/modules/kernel/memory/ops/kalloc.yaml
vos build
vos run qemu
vos verify base
vos verify architecture
vos verify composition
vos verify goal
vos report
```

---

## 十八、跨课程扩展：SpecLab Platform

VeriSpecOSLab 可以抽象为通用的 **SpecLab Platform**，用于其他 Spec 驱动实验项目。

```text
SpecLab Platform
  ├── SpecOSLab / VeriSpecOSLab
  ├── SpecDBLab
  ├── SpecCompilerLab
  ├── SpecNetLab
  ├── SpecRuntimeLab
  └── SpecHWLab
```

核心可复用机制包括：

```text
结构化规格
+ Agent Gateway
+ 工具链沙箱
+ 测试/验证矩阵
+ 个性化目标合约
+ AI 协作审计
+ 自动报告与评分
```

平台可拆成两层：

```text
SpecLab Core
  - OpenAI-compatible Agent Gateway
  - Project DevBox
  - Spec parser / spec_lint
  - Test runner
  - Benchmark runner
  - Report generator
  - AI collaboration log
  - Rubric / scoring engine

Domain Lab Plugin
  - OS plugin
  - DB plugin
  - Compiler plugin
  - Network plugin
  - Runtime plugin
  - Hardware plugin
```

跨课程连续化教学示例：

```text
OS 课程：
  学生实现 kernel / syscall / fs / IPC

编译器课程：
  学生实现编译器，目标后端可以是自己 OS 的 ABI

数据库课程：
  学生实现数据库，运行在自己 OS 或 Linux 上

网络课程：
  学生实现协议栈或服务，运行在自己 OS 上

体系结构课程：
  学生实现模拟器、自制 ISA 或 FPGA softcore，再移植 OS

分布式系统课程：
  学生实现分布式 KV / Raft / transaction layer
```

---

## 十九、方案创新点

### 1. 从统一教学内核转向个性化 OS 构建

学生不再实现同质化教学内核，而是围绕自己的架构设计构建系统。

### 2. 从代码补全转向规格驱动

学生首先定义系统行为和正确性，再由 AI 辅助实现。

### 3. 从 AI 代写转向 AI 协作

AI 被规格、测试和验证反馈约束，学生仍负责架构设计和正确性判断。

### 4. 从能运行转向可验证

系统需要提供测试、不变量、模型检查或局部证明等正确性证据。

### 5. 从基础 OS 转向兼容与优化

高阶学生可以挑战 Linux ABI、PE/COFF、Mach-O 子集兼容，或进行 IPC、syscall、FS、RT、boot time 等专项优化。

### 6. 从模拟器运行扩展到物理硬件移植

学生可以将系统从 QEMU 迁移到真实开发板或物理机，形成从“能在模拟器运行”到“能在真实硬件运行”的系统工程能力。

### 7. 从单门课程扩展到系统软件课程群

SpecLab 可连接 OS、编译器、数据库、网络、运行时、体系结构和分布式系统课程，使课程成果可延续、可复用、可积累。

---

## 二十、总结

VeriSpecOSLab 是一种面向 AI 时代的操作系统教学实验方案。它不要求学生实现同质化教学内核，也不要求学生在固定的 `*-like` 路线中选择，而是在统一的规格驱动、架构说明和验证反馈框架下，鼓励学生提出自己的系统架构、组合不同系统机制、实现完整 OS，并在进阶阶段探索兼容、优化、验证和真实硬件移植。

该方案的核心不是“让 AI 替学生写 OS”，而是让学生学会：

```text
如何定义系统正确性
如何描述系统架构
如何说明架构取舍
如何用规格约束 AI
如何验证 AI 生成代码
如何维护跨模块不变量
如何演化和优化复杂系统
如何将模拟器中的 OS 移植到物理硬件
```

最终目标是培养学生的系统软件综合能力，使其具备从架构设计、模块规格、AI 协作、底层实现、验证测试、性能优化、兼容性实现到物理硬件移植的完整训练经历。

一句话概括：

> **VeriSpecOSLab 以规格为设计语言，以架构说明为系统蓝图，以 AI 为协作工具，以验证为质量保障，以个性化系统构建为教学入口，训练学生独立设计、实现、验证并演化完整操作系统的能力。**

---

