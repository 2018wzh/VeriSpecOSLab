# VeriSpecOSLab / SpecLab 递进式课程工作流

> 本文档说明 VeriSpecOSLab / SpecLab 的递进式课程工作流。学生的个性化设计随课程阶段逐步形成、验证、修正和收敛；教师控制课程边界与评价公平性，学生负责真实设计与实现，平台与 Agent 负责阶段化验证、反馈和过程证据。

---

## 1. 总体原则

VeriSpecOSLab 的课程工作流采用：

```text
Progressive Design → Spec → Implementation → Verification → Feedback → Evolution → Final Synthesis
```

对应教学含义是：

```text
学生先提交轻量 ArchitectureSeed
  ↓
每个课程阶段提交 ArchitectureSlice
  ↓
每个 Slice 绑定 ModuleSpec、实现、测试和验证证据
  ↓
关键设计选择记录为 ArchitectureDecisionRecord
  ↓
关键设计变化通过 SpecPatch 演化
  ↓
平台 Agent 根据阶段设计动态派生验证
  ↓
课程末期合成 FinalArchitectureSynthesis
```

个性化设计由一次性文档变为贯穿课程的工程过程。学生不是先完整设计一个理想 OS 再实现，而是在 Boot、Memory、Trap、Execution、Syscall/IPC、Resource、File/Service 等阶段逐步建立自己的系统架构。

---

## 2. 核心产物

### 2.1 学生产物

```text
student-specs/
  architecture/
    seed.yaml                         # 初始设计种子
    timeline.yaml                     # 架构演化时间线
    slices/
      01-boot.yaml
      02-memory.yaml
      03-trap-privilege.yaml
      04-execution.yaml
      05-syscall-basic.yaml
      06-resource-fd-object.yaml
      07-capability-ipc.yaml
      08-namespace-service.yaml
    decisions/
      ADR-001-boot-chain.yaml
      ADR-002-user-pointer-policy.yaml
      ADR-003-syscall-before-ipc.yaml
    composition.yaml                  # 当前跨模块组合规则
    final-synthesis.yaml              # 课程末期最终架构综合

  modules/
    boot/
    memory/
    trap/
    scheduler/
    syscall/
    ipc/
    object/
    capability/
    namespace/
    vfs-or-service/
    driver/

  goals/
    compatibility.yaml
    optimization.yaml
    hardware-port.yaml
    formal-verification.yaml

  evolution/
    patch-001-*.yaml
    patch-002-*.yaml

  reports/
    student-verification-report.md
    ai-collaboration-log.md
    knowledge-base-reference-log.md
    final-report.md
```

### 2.2 教师产物

```text
course-specs/
  experiment.yaml
  problem.yaml
  design-space.yaml
  base-requirements.yaml
  stage-gates.yaml
  verification-policy.yaml
  evaluation-rubric.yaml
  ai-policy.yaml
  judge-policy.yaml
  interface-contracts/
```

### 2.3 平台 / Agent 产物

```text
agent-generated-specs/
  normalized-design.yaml
  architecture-evolution-summary.yaml
  stage-review-report.yaml
  risk-model.yaml
  derived-verification-plan.yaml
  derived-test-matrix.yaml
  hidden-test-plan.yaml
  fuzz-plan.yaml
  invariant-check-plan.yaml
  oracle-binding.yaml
  grading-evidence-map.yaml
```

---

## 3. 教师工作流

## 3.1 课程准备

教师首先定义课程边界，而不是定义唯一标准答案。

```text
创建课程
  ↓
编写 course-specs
  ↓
配置阶段门禁 stage-gates
  ↓
配置模板仓库
  ↓
配置公共测试、隐藏测试、fuzz、benchmark
  ↓
配置 AI Policy 与 Judge Policy
  ↓
配置知识库材料
  ↓
发布实验
```

教师需要特别准备 `stage-gates.yaml`：

```yaml
StageGates:
  - stage: architecture-seed
    required_artifacts:
      - student-specs/architecture/seed.yaml
    checks:
      - goal_scope_reasonable
      - non_goals_declared
      - no_label_only_design

  - stage: boot-minimum
    required_artifacts:
      - student-specs/architecture/slices/01-boot.yaml
      - student-specs/modules/boot/boot_entry.yaml
    checks:
      - boot_model_defined
      - qemu_boot_smoke
      - serial_banner_check

  - stage: memory-management
    required_artifacts:
      - student-specs/architecture/slices/02-memory.yaml
      - student-specs/modules/memory/page_allocator.yaml
    checks:
      - memory_invariants_declared
      - spec_lint_passed
      - page_allocator_tests_passed
```

---

## 3.2 阶段发布与审核

教师不再只审核一次统一总设计，而是按课程阶段审核设计成熟度。

| 阶段 | 教师审核重点 | 典型证据 |
|---|---|---|
| ArchitectureSeed | 方向是否合理，目标是否过大，non-goals 是否明确 | seed.yaml、DesignAgent 报告 |
| Boot | boot chain、入口约定、日志路径是否清楚 | boot slice、QEMU log |
| Memory | 物理页、保留区、虚拟内存计划是否自洽 | ModuleSpec、allocator tests |
| Trap / Privilege | trap frame、用户态、用户指针策略是否安全 | trap tests、invalid pointer tests |
| Execution | process/thread/task、调度、阻塞模型是否明确 | scheduler spec、runqueue invariant |
| Syscall / IPC | ABI、错误语义、权限边界是否具体 | syscall trace、IPC tests |
| Resource | fd/object/capability 生命周期是否一致 | composition tests |
| File / Service | namespace、VFS 或服务模型是否和资源模型一致 | namespace tests、service tests |
| Personalized Goal | 目标是否通过 SpecPatch 合法引入 | goal contract、benchmark |
| Final Synthesis | 最终设计能否从历史演化中追溯 | final-synthesis、timeline、report |

---

## 3.3 开发过程监督

每次学生提交后，平台运行：

```text
pull repository
  ↓
check stage artifacts
  ↓
run arch_lint / spec_lint
  ↓
build
  ↓
unit test
  ↓
QEMU / emulator test
  ↓
design-driven tests
  ↓
composition tests
  ↓
goal-specific tests
  ↓
fuzz / hidden tests
  ↓
generate feedback
  ↓
update grading evidence
```

教师查看的是过程证据：

```text
- 当前学生处于哪个阶段
- 当前阶段设计是否完整
- 哪些设计变化通过 SpecPatch 引入
- 哪些测试由学生声明触发
- 哪些测试由平台风险模型派生
- AI 是否参与核心修改
- 学生是否记录 AI 错误与人工修改
- 是否存在绕过测试或复制参考代码风险
```

---

## 3.4 最终评分

评分从“最终系统是否能运行”扩展为“设计演进是否真实、可验证、可解释”。

```yaml
EvaluationRubric:
  architecture_design: 20
  module_spec_quality: 15
  implementation_correctness: 25
  platform_derived_verification: 20
  evolution_and_debugging: 10
  documentation_and_ai_log: 10

  architecture_design_breakdown:
    architecture_seed: 2
    stage_slices: 6
    decision_records: 4
    composition_invariants: 4
    final_synthesis: 4

  evolution_and_debugging_breakdown:
    spec_patch_quality: 4
    validation_feedback_usage: 3
    design_revision_explanation: 3
```

教师最终结合：

```text
公共测试结果
隐藏测试结果
设计驱动测试结果
个性化目标验证结果
架构演化时间线
AI 协作日志
知识库引用日志
答辩解释能力
```

---

## 4. 学生工作流

## 4.1 加入实验

```text
加入课程实验
  ↓
平台创建仓库
  ↓
平台注入模板、course-specs、CI 配置、.speclab.yml
  ↓
平台创建 Agent Workspace
  ↓
学生阅读课程要求和 AI Policy
```

学生首先不需要设计完整 OS，只需要理解课程边界和阶段目标。

---

## 4.2 Stage 0：ArchitectureSeed

学生提交初始方向：

```yaml
ArchitectureSeed:
  project_name: CapFS-OS

  target:
    isa: riscv64
    machine: qemu-virt
    language: rust
    boot_protocol: opensbi

  initial_intent:
    summary: >
      Build a small teaching OS that first supports user programs
      through a Linux-like syscall subset, and later explores
      capability-checked IPC and service-oriented file abstractions.

  tentative_reference_systems:
    - system: Linux
      possible_borrowed:
        - static ELF loading
        - syscall ABI subset
        - fd table
    - system: seL4/L4
      possible_borrowed:
        - endpoint IPC
        - capability rights
    - system: Plan9
      possible_borrowed:
        - namespace-like service discovery

  initial_non_goals:
    - full POSIX
    - SMP
    - fork
    - dynamic linking
    - full formal verification
```

学生可请求：

```bash
vos agent arch review student-specs/architecture/seed.yaml
```

Agent 只提示风险，不替学生决定最终架构。

---

## 4.3 Stage 1：Boot Design Slice

学生提交 boot 切片：

```yaml
ArchitectureSlice:
  stage: boot-minimum

  boot_model:
    firmware: OpenSBI
    privilege_entry: S-mode
    kernel_format: ELF
    machine: qemu-virt

  decisions:
    - use OpenSBI as firmware
    - kernel starts in S-mode
    - early console uses SBI console or UART
    - no virtual memory in first boot milestone

  invariants:
    - kernel entry address matches linker script
    - boot stack is valid before calling rust_main
    - panic path can print serial log

  validation_binding:
    - qemu_boot_smoke
    - serial_banner_check
    - panic_path_check
```

学生实现最小 boot 后运行：

```bash
vos build
vos run qemu
vos verify stage boot-minimum
```

---

## 4.4 Stage 2：Memory Design Slice

```yaml
ArchitectureSlice:
  stage: memory-management

  memory_model:
    physical_memory:
      allocator: bitmap
      page_size: 4KiB
      reserved_regions:
        - firmware
        - kernel_text
        - kernel_data
        - boot_stack

    virtual_memory:
      stage: kernel_only_mapping
      later_plan:
        - user_kernel_split
        - per_process_address_space

  decisions:
    - use bitmap allocator instead of free list
    - use identity mapping during early kernel
    - introduce high-half mapping later

  invariants:
    - reserved pages are never allocated
    - allocated page is not in free set
    - free_count + allocated_count + reserved_count == total_pages

  validation_binding:
    - page_alloc_free
    - reserved_region_not_allocated
    - double_free_rejected
```

对应模块规格：

```yaml
ModuleSpec:
  name: PhysicalPageAllocator

  state:
    - memory_map
    - page_bitmap
    - reserved_regions

  interface:
    - alloc_page() -> PhysPage | ENOMEM
    - free_page(page) -> OK | INVALID_PAGE | DOUBLE_FREE

  invariants:
    - reserved pages are never allocated
    - no allocated page appears in free bitmap
    - double free must be rejected
```

学生执行：

```bash
vos spec lint student-specs/modules/memory/page_allocator.yaml
vos verify stage memory-management
```

---

## 4.5 Stage 3：Trap / Privilege Design Slice

```yaml
ArchitectureSlice:
  stage: trap-and-privilege

  privilege_model:
    levels:
      - kernel: S-mode
      - user: U-mode

  trap_model:
    entry:
      - save trap frame
      - switch to kernel stack
      - dispatch exception / interrupt / syscall
    return:
      - restore user context
      - sret

  user_pointer_policy:
    - kernel must not directly dereference user pointer
    - copy_from_user required
    - copy_to_user required

  invariants:
    - trap frame must preserve user registers
    - kernel cannot return to invalid user pc
    - user memory access must be checked

  validation_binding:
    - illegal_instruction_trap
    - page_fault_trap
    - user_kernel_isolation
    - invalid_user_pointer
```

关键决策记录：

```yaml
ArchitectureDecisionRecord:
  id: ADR-002
  title: Use explicit copy_from_user for all syscall buffers

  context:
    - future syscall write/read will accept user pointers
    - direct dereference may break isolation

  decision:
    - all user pointers are represented by UserPtr<T>
    - syscall handlers must call copy_from_user/copy_to_user

  consequence:
    - syscall implementation becomes slightly more verbose
    - invalid pointer tests can be generated
```

---

## 4.6 Stage 4：Execution Model Design Slice

```yaml
ArchitectureSlice:
  stage: execution-model

  execution_model:
    unit:
      - process
      - kernel_thread
    scheduling:
      scheduler_type: round_robin
      preemption: timer_preemptive
      blocking_model: wait_queue

  decisions:
    - process owns address space
    - kernel thread used for background service
    - wait_queue used for blocking syscall and future IPC

  invariants:
    - runnable task appears in exactly one run queue
    - blocked task does not appear in run queue
    - wakeup moves task from wait queue to run queue atomically

  validation_binding:
    - scheduler_basic
    - timer_interrupt
    - double_enqueue_rejected
    - missed_wakeup
```

涉及并发时必须提交：

```yaml
ConcurrencySpec:
  module: Scheduler

  shared_state:
    - run_queue
    - wait_queues
    - task_state

  locking_rules:
    - lock: scheduler_lock
      protects:
        - run_queue
        - task_state
      cannot_sleep_while_held: true

  atomicity:
    - operation: block_current
      guarantee:
        - task is either runnable or blocked, never both
    - operation: wake_task
      guarantee:
        - wakeup is not lost if event happens before sleep commit
```

---

## 4.7 Stage 5：Syscall Basic Design Slice

```yaml
ArchitectureSlice:
  stage: syscall-basic

  syscall_model:
    interface_style: Linux_static_ELF_subset
    arch: riscv64
    syscall_number_register: a7
    arg_registers: [a0, a1, a2, a3, a4, a5]
    return_register: a0
    error_model: negative_errno

  supported_syscalls_stage_5:
    - write
    - exit

  decisions:
    - syscall is used as compatibility entry
    - internal kernel objects are not exposed directly
    - fd table will be introduced in later stage

  invariants:
    - invalid syscall returns -ENOSYS
    - invalid user buffer returns -EFAULT
    - write must not read kernel memory through user pointer

  validation_binding:
    - user_hello_write
    - syscall_exit
    - invalid_syscall_number
    - write_bad_user_pointer
```

对应接口规格：

```yaml
SyscallABISpec:
  name: LinuxStaticSubset
  arch: riscv64

  calling_convention:
    syscall_number: a7
    args: [a0, a1, a2, a3, a4, a5]
    return_value: a0
    error_encoding: negative_errno

  syscalls:
    - name: write
      number: 64
      args:
        - fd: int
        - buf: user_ptr
        - len: usize
      returns:
        - bytes_written
        - -EBADF
        - -EFAULT
      preconditions:
        - buf must be readable user memory
      postconditions:
        - writes at most len bytes
        - does not read kernel memory through user pointer
```

---

## 4.8 Stage 6：Resource / FD / Object Design Slice

```yaml
ArchitectureSlice:
  stage: resource-model

  resource_model:
    abstractions:
      - fd
      - object_handle
      - kernel_object

  decisions:
    - fd is process-local compatibility handle
    - object_handle is internal kernel reference
    - fd table maps integer fd to object_handle
    - close(fd) decrements object reference count

  invariants:
    - every fd maps to exactly one live object handle
    - closing fd decrements object refcount
    - object cannot be destroyed while fd exists
    - invalid fd cannot access object

  validation_binding:
    - fd_open_close
    - invalid_fd_permission
    - fd_close_refcount
    - object_lifetime
```

组合规则：

```yaml
ArchitectureCompositionSpec:
  cross_component_rules:
    - name: fd_to_object_mapping
      description: fd is a compatibility view over kernel object handles
      affected_modules:
        - fd_table
        - object_manager
        - syscall
      invariant:
        - every fd maps to exactly one live object handle
        - closing fd decrements object refcount
        - object cannot be destroyed while fd exists
      validation_intent:
        - fd_close_refcount
        - invalid_fd_permission
```

---

## 4.9 Stage 7：Capability IPC 个性化演化

学生通过 SpecPatch 引入高级个性化目标，而不是直接改代码。

```yaml
SpecPatch:
  patch_id: patch-004-capability-ipc
  stage: personalized-goal
  title: Introduce capability-checked endpoint IPC

  motivation:
    - syscall path is enough for basic user programs
    - user-space services need protected communication
    - fd should not be used as authority for IPC endpoints

  design_change:
    communication_model:
      add:
        - endpoint_ipc
    protection_model:
      add:
        - capability_rights

  affected_specs:
    - architecture/slices/07-capability-ipc.yaml
    - architecture/composition.yaml
    - modules/ipc/endpoint.yaml
    - modules/capability/capability.yaml
    - modules/object/object_manager.yaml
    - modules/scheduler/scheduler.yaml

  added_invariants:
    - sender must hold endpoint send right
    - receiver must hold endpoint receive right
    - transferred capability must be explicitly transferable
    - endpoint close wakes blocked tasks safely

  validation_binding:
    - ipc_basic_send_recv
    - invalid_capability_send
    - endpoint_close_wakeup
    - transfer_nontransferable_cap
    - ipc_message_integrity
```

---

## 4.10 Stage 8：Namespace / File Service Design Slice

```yaml
ArchitectureSlice:
  stage: filesystem-or-service

  namespace_model:
    per_process_namespace: true
    path_resolution:
      - process namespace table
      - mount binding
      - service endpoint dispatch

  file_or_service_model:
    abstraction: file_service
    device_as_file: true

  decisions:
    - do not implement full in-kernel VFS
    - use file service for open/read/write
    - namespace maps paths to service endpoints
    - fd remains compatibility handle for opened objects

  invariants:
    - path resolution cannot escape namespace root
    - opened file fd maps to live object handle
    - service endpoint access requires capability
    - namespace binding cannot bypass capability check

  validation_binding:
    - namespace_open
    - namespace_escape_failure
    - service_file_read
    - fd_object_lifetime
```

---

## 4.11 Stage 9：Final Architecture Synthesis

课程末期，学生合成最终设计，而不是重新编造一份完整设计。

```yaml
FinalArchitectureSynthesis:
  project_name: CapFS-OS

  architecture_summary: >
    CapFS-OS is a RISC-V64 teaching OS that starts from a Linux-like
    static syscall subset for user program compatibility, then introduces
    an internal object manager, fd compatibility layer, capability-checked
    endpoint IPC, and a namespace-based file service model.

  confirmed_mechanisms:
    boot:
      - OpenSBI S-mode boot
      - serial panic log
    memory:
      - bitmap physical allocator
      - per-process address space
      - copy_from_user policy
    execution:
      - process
      - kernel thread
      - round-robin scheduler
      - wait queue blocking
    syscall:
      - Linux static subset
      - write / exit / openat / close / read
      - negative errno
    resource:
      - fd table
      - object handle
      - refcounted kernel object
    ipc:
      - endpoint IPC
      - send / receive rights
      - capability transfer
    namespace:
      - per-process namespace
      - service endpoint binding

  rejected_mechanisms:
    - full POSIX fork
    - dynamic linking
    - full in-kernel VFS
    - SMP
    - full seL4-style verified capability derivation

  validation_summary:
    base:
      - qemu_boot_smoke
      - user_hello
      - page_alloc_free
      - syscall_write_exit
    architecture_features:
      - linux_static_elf_loader
      - fd_lifetime
      - capability_ipc
      - namespace_isolation
    composition:
      - fd_to_object_mapping
      - capability_checked_ipc
      - namespace_to_service_endpoint
    personalized_goals:
      - ipc_pingpong_latency
      - namespace_escape_failure
      - invalid_capability_send
```

---

## 5. Agent 参与流程

Agent 的角色也变为阶段化辅助。

```text
GatewayAgent:
  识别课程、学生、项目、当前阶段、当前文件和任务类型。

DesignAgent:
  审查当前 ArchitectureSlice，比较历史设计，提示设计冲突。

SpecAgent:
  检查当前阶段 ModuleSpec、InterfaceSpec、ConcurrencySpec。

ImplementationAgent:
  只根据已批准规格生成局部候选 patch。

VerificationAgent:
  根据当前阶段设计派生测试、运行验证、生成证据。

DebugAgent:
  解释构建、QEMU、测试、Judge 日志。

KnowledgeBaseAgent:
  根据当前阶段和学生设计推荐教学材料，而不是完整答案。

ReviewAgent:
  审计 AI 使用、知识库引用、相似度风险和是否绕过测试。

ReportAgent:
  汇总阶段证据，帮助最终合成报告。
```

---

## 6. AI 使用边界

允许：

```text
- 解释课程要求
- 审查阶段设计
- 帮助整理 ArchitectureSlice
- 检查 ModuleSpec 缺陷
- 根据已批准规格生成局部候选 patch
- 根据日志定位问题
- 生成测试建议
- 整理验证证据和报告结构
```

禁止：

```text
- 一次性生成完整 OS
- 跳过 ArchitectureSlice 直接生成核心模块
- 没有 ModuleSpec 时生成核心实现
- 删除测试或关闭 invariant checker
- 绕过权限检查
- 直接复制知识库代码
- 隐瞒 AI 参与
- 编造验证结果
```

---

## 7. 最终课程运行示例：CapFS-OS

```text
Week 1:
  Alice 提交 ArchitectureSeed。
  目标：RISC-V64 + Rust + QEMU + Linux syscall subset exploratory。

Week 2:
  提交 Boot Slice。
  通过 qemu_boot_smoke 和 serial_banner_check。

Week 3:
  提交 Memory Slice 和 PageAllocator ModuleSpec。
  修复 double_free 失败并记录 AI 错误案例。

Week 4:
  提交 Trap / Privilege Slice。
  明确 copy_from_user 策略。

Week 5:
  提交 Execution Slice。
  实现 round-robin scheduler 和 wait queue。

Week 6:
  提交 Syscall Basic Slice。
  实现 write / exit，运行 hello user program。

Week 7:
  提交 Resource Slice。
  引入 fd table、object handle、refcount。

Week 8:
  通过 SpecPatch 引入 capability IPC。
  平台增加 invalid_capability_send、endpoint_close_wakeup 测试。

Week 9:
  提交 Namespace / File Service Slice。
  验证 namespace_escape_failure。

Week 10:
  提交 FinalArchitectureSynthesis、VerificationReport、AICollaborationLog。
  OJ 运行公共测试、隐藏测试、组合测试和个性化目标测试。
```

---

## 8. 结论

最终工作流的核心是：

```text
教师定义边界和阶段；
学生递进式设计和实现；
Agent 阶段化辅助但不替代学生；
平台根据设计动态验证；
评分依据最终系统，也依据设计演化过程。
```

该流程更符合操作系统实验的认知规律：学生先理解 boot，再理解 memory，再理解 trap 和 privilege，再设计 syscall / IPC、resource lifetime、file/service 和个性化目标。最终得到的个性化 OS 不是一次性声明出来的，而是在课程中逐步构建、验证和演化出来的。
