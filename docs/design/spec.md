# VeriSpecOSLab Spec 体系设计

> 面向 AI 辅助、规格驱动、可验证、可个性化操作系统课程实验的 Spec 组织方案。  
> 核心目标：用学生规格表达设计，用平台 Agent 派生验证，用教师策略保证公平，用动态测试提高验证真实性。

---

## 1. 设计目标

VeriSpecOSLab 的 Spec 体系用于支撑如下完整流程：

```text
Design → Development → Test → Verification → Evaluation → Evolution
```

也就是：

```text
架构设计
  ↓
模块规格
  ↓
实现开发
  ↓
测试生成
  ↓
动态验证
  ↓
评分证据
  ↓
规格补丁演化
```

本设计不要求所有学生实现同一个固定教学内核，而是在统一课程边界、最低能力要求、验证策略和评分规则下，允许学生自由设计自己的操作系统架构、模块边界、接口语义、兼容目标、性能目标和硬件移植目标。

关键原则如下：

```text
教师 Spec：定义课程边界、最低要求、评分原则、安全规则
学生 Spec：定义个性化架构、模块语义、设计取舍、目标范围
平台 Agent Spec：动态生成验证规格、测试矩阵、隐藏检查、oracle 绑定和评分证据
```

其中：

```text
学生负责设计真实性；
教师负责课程公平性；
平台 Agent 负责验证真实性与验证灵活度。
```

---

## 2. 为什么需要三方 Spec 分工

如果所有验证相关 Spec 都由学生编写，会出现两个问题：

```text
1. 学生可能有意或无意地将验证范围写得过窄；
2. 学生可能只验证正常路径，忽略异常路径、并发竞态、资源生命周期和安全边界。
```

如果所有验证 Spec 都由教师固定，又会出现另一个问题：

```text
1. 课程容易退化为固定路线实验；
2. microkernel、monolithic、unikernel、capability OS、Linux-compatible OS 等不同架构难以统一验证；
3. 个性化目标会被固定测试矩阵限制。
```

因此体系采用三方协作：

```text
教师制定规则；
学生描述系统；
平台 Agent 根据学生系统动态派生验证。
```

学生不能完全控制最终验证内容，但学生必须写清楚设计意图、不变量、接口语义和目标范围。平台 Agent 不能替学生设计系统，但可以根据教师策略和学生规格生成更真实、更灵活的验证计划。

---

## 3. Spec 总体分层

最终 Spec 分为三层：

```text
course-specs/                 # 教师编写并锁定
student-specs/                # 学生编写并维护
agent-generated-specs/        # 平台 Agent 动态生成
```

完整目录建议如下：

```text
verispecoslab/
  course-specs/
    experiment.yaml
    problem.yaml
    design-space.yaml
    base-requirements.yaml
    verification-policy.yaml
    evaluation-rubric.yaml
    ai-policy.yaml
    judge-policy.yaml
    interface-contracts/
      boot-riscv64.yaml
      boot-x86_64.yaml
      boot-aarch64.yaml
      serial-log.yaml
      syscall-common.yaml

  templates/
    architecture-design.template.yaml
    architecture-composition.template.yaml
    module-spec.template.yaml
    interface-spec.template.yaml
    concurrency-spec.template.yaml
    goal-contract.template.yaml
    spec-patch.template.yaml
    hardware-port.template.yaml
    ai-collaboration-log.template.md

  student-specs/
    architecture/
      seed.yaml
      slices/
      composition.yaml
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
      vfs/
      fs/
      driver/
    goals/
      compatibility.yaml
      optimization.yaml
      hardware-port.yaml
      formal-verification.yaml
    evolution/
      patch-001.yaml
      patch-002.yaml
    reports/
      ai-collaboration-log.md
      student-verification-report.md

  agent-generated-specs/
    normalized-design.yaml
    risk-model.yaml
    derived-verification-plan.yaml
    derived-test-matrix.yaml
    hidden-test-plan.yaml
    fuzz-plan.yaml
    invariant-check-plan.yaml
    oracle-binding.yaml
    trace-check-plan.yaml
    mutation-test-plan.yaml
    coverage-requirement.yaml
    review-questions.yaml
    grading-evidence-map.yaml

  src/
  tests/
    public/
    generated/
    hidden/
    fuzz/
    benchmark/
  tools/
  ci/
  reports/
    agent-verification-report.md
    final-report.md
```

---

## 4. 教师编写并锁定的 Spec

教师 Spec 用于控制课程内容、最低要求、评分规则和安全边界。学生只读，不能修改。

### 4.1 ExperimentSpec

文件：

```text
course-specs/experiment.yaml
```

作用：定义实验基本信息、阶段、提交物和平台行为。

```yaml
ExperimentSpec:
  id: verispec-oslab-2026
  type: os
  title: AI-assisted verifiable OS construction lab

  stages:
    - spec-reading
    - architecture-design
    - boot-minimum
    - memory-management
    - trap-and-interrupt
    - process-or-thread
    - syscall-or-ipc
    - filesystem-or-service
    - verification
    - hardware-porting
    - final-report

  required_artifacts:
    - student-specs/architecture/seed.yaml
    - student-specs/architecture/slices/
    - student-specs/architecture/composition.yaml
    - student-specs/modules/
    - student-specs/goals/
    - source-code
    - reports/student-verification-report.md
    - reports/ai-collaboration-log.md
    - reports/final-report.md
```

### 4.2 ProblemSpec

文件：

```text
course-specs/problem.yaml
```

作用：定义实验要解决的问题，但不规定唯一架构。

```yaml
ProblemSpec:
  title: Build a verifiable teaching operating system
  target: Students should build a complete OS with AI assistance

  expected_outcome:
    - bootable kernel
    - memory management
    - trap or exception handling
    - schedulable execution unit
    - user program or user service execution
    - syscall or IPC interface
    - basic I/O path
    - verification evidence
    - final design documentation

  hard_constraints:
    - must run under QEMU before optional hardware porting
    - must provide serial log
    - must pass base boot test
    - must not disable invariant checker
    - must not remove required tests
```

### 4.3 DesignSpaceSpec

文件：

```text
course-specs/design-space.yaml
```

作用：定义允许的设计空间，防止学生只贴标签而不说明机制。

```yaml
DesignSpaceSpec:
  architecture_description_required: true

  allowed_kernel_organization:
    - monolithic
    - microkernel
    - hybrid
    - exokernel
    - unikernel
    - library_os
    - custom

  allowed_reference_systems:
    - Linux
    - L4
    - seL4
    - Darwin
    - XNU
    - Windows NT
    - Plan 9
    - RTOS
    - unikernel
    - custom research system

  required_design_dimensions:
    - boot_model
    - memory_model
    - privilege_model
    - execution_model
    - syscall_or_ipc_model
    - resource_model
    - namespace_model
    - driver_model
    - verification_boundary

  forbidden_shortcuts:
    - using only "Linux-like" without mechanism description
    - using only "microkernel-like" without isolation and IPC design
    - claiming compatibility without ABI scope
    - changing architecture without updating the current ArchitectureSlice or SpecPatch
```

### 4.4 BaseRequirementSpec

文件：

```text
course-specs/base-requirements.yaml
```

作用：定义所有学生必须满足的最低系统能力。

```yaml
BaseRequirementSpec:
  boot:
    required:
      - kernel_entry
      - serial_output
      - panic_log
      - qemu_boot_success

  memory:
    required:
      - physical_page_allocator
      - kernel_heap_or_region_allocator
      - user_kernel_isolation

  trap:
    required:
      - exception_entry
      - timer_interrupt_or_equivalent
      - syscall_or_ipc_entry

  execution:
    required:
      - at_least_one_schedulable_unit
      - user_program_or_user_service
      - controlled_exit

  io:
    required:
      - console_output
      - basic_input_or_scripted_workload

  verification:
    required:
      - base_ci_pass
      - invariant_checks
      - verification_report
```

### 4.5 VerificationPolicySpec

文件：

```text
course-specs/verification-policy.yaml
```

作用：定义验证类别、隐藏测试规则、fuzz 策略和最低通过要求。

```yaml
VerificationPolicySpec:
  categories:
    - static_check
    - spec_lint
    - arch_lint
    - build
    - unit_test
    - qemu_boot_test
    - integration_test
    - syscall_or_ipc_test
    - fuzz_test
    - invariant_check
    - trace_compare
    - benchmark
    - formal_check_optional

  minimum_pass:
    - static_check
    - build
    - qemu_boot_test
    - base_integration_test

  hidden_tests:
    enabled: true
    scope:
      - syscall_error_cases
      - memory_isolation
      - invalid_user_pointer
      - resource_lifetime
      - concurrency_edge_cases

  fuzz:
    enabled: true
    default_timeout_sec: 60
    stop_on:
      - kernel_panic
      - invariant_violation
      - emulator_crash
```

### 4.6 EvaluationRubricSpec

文件：

```text
course-specs/evaluation-rubric.yaml
```

作用：定义评分权重。

```yaml
EvaluationRubricSpec:
  weights:
    architecture_design: 20
    module_spec_quality: 15
    implementation_correctness: 25
    platform_derived_verification: 20
    evolution_and_debugging: 10
    documentation_and_ai_log: 10

  verification_breakdown:
    public_tests: 25
    hidden_tests: 25
    invariant_checks: 20
    fuzz_and_negative_tests: 15
    oracle_or_trace_validation: 10
    mutation_test_effectiveness: 5

  bonus:
    binary_compatibility: 10
    hardware_porting: 10
    formal_proof: 10
    performance_optimization: 8
```

### 4.7 AIPolicySpec

文件：

```text
course-specs/ai-policy.yaml
```

作用：约束 Agent 和学生如何使用 AI。

```yaml
AIPolicySpec:
  allowed:
    - refine_spec
    - generate_patch_from_spec
    - generate_tests_from_spec
    - explain_build_error
    - analyze_qemu_log
    - suggest_spec_patch
    - generate_review_questions

  restricted:
    - core_module_requires_spec
    - concurrency_module_requires_concurrency_spec
    - architecture_change_requires_architecture_spec_update
    - syscall_ipc_vfs_vm_change_requires_regression_test

  forbidden:
    - generate_entire_os_once
    - bypass_tests
    - remove_invariant_checker
    - submit_unexplained_ai_code
    - hide_agent_generated_code
```

### 4.8 JudgePolicySpec

文件：

```text
course-specs/judge-policy.yaml
```

作用：定义 Online Judge、隐藏测试和沙箱策略。

```yaml
JudgePolicySpec:
  sandbox:
    runner: qemu
    isolation: container
    network: disabled_by_default
    artifact_limit_mb: 512
    timeout_sec: 120

  visibility:
    public_tests_visible: true
    hidden_tests_visible: false
    hidden_test_names_visible: partial
    hidden_failure_summary_visible: true

  anti_gaming:
    detect_hardcoded_log_markers: true
    detect_test_name_branching: true
    mutation_test_enabled: true
    random_seed_rotation: true
```

---

## 5. 学生必须编写的 Spec

学生 Spec 是课程训练重点。学生必须通过 Spec 说明自己的架构、模块边界、接口语义、不变量、并发规则、目标范围和演化过程。

架构设计不再由单个一次性文档承担，而是由一组按课程阶段持续演化的 Spec 共同表达：

```text
ArchitectureSeed
+ ArchitectureSlice[]
+ ArchitectureDecisionRecord[]
+ ArchitectureCompositionSpec
+ SpecPatch[]
+ StageValidationBinding[]
+ FinalArchitectureSynthesis
```

推荐目录结构：

```text
student-specs/architecture/
  seed.yaml
  timeline.yaml
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
    ADR-001-*.yaml
    ADR-002-*.yaml
  composition.yaml
  final-synthesis.yaml
```

### 5.1 ArchitectureSeed

文件：

```text
student-specs/architecture/seed.yaml
```

作用：描述学生要从什么方向开始构建系统，以及课程前期暂时不承诺什么。

```yaml
ArchitectureSeed:
  architecture_name: CapFS-OS
  initial_summary: >
    A teaching OS that starts from a Linux-compatible syscall entry,
    and may later introduce capability-checked IPC and a namespace-based
    file service model.

  target:
    isa: riscv64
    machine: qemu-virt
    language: rust
    boot_protocol: opensbi

  tentative_reference_systems:
    - system: Linux
      borrowed_concepts:
        - static ELF loading
        - fd table
        - syscall ABI subset
      modified_concepts:
        - no fork
        - simplified VFS
      rejected_concepts:
        - full POSIX signal model
        - dynamic linker
      reason: use Linux only as compatibility surface

    - system: L4/seL4
      borrowed_concepts:
        - endpoint IPC
        - capability rights
      modified_concepts:
        - simplified revoke
      rejected_concepts:
        - full formal kernel object model
      reason: use capability as internal authority model

  initial_non_goals:
    - no full POSIX signal model
    - no dynamic linker
```

### 5.2 ArchitectureSlice

文件：

```text
student-specs/architecture/slices/*.yaml
```

作用：描述每个课程阶段的局部设计决策，并把该决策绑定到规格、实现、测试和验证证据。

```yaml
ArchitectureSlice:
  stage: syscall-basic
  design_question:
    - how user programs enter kernel
    - how user pointers are checked
    - how write/exit errors are reported
  affected_specs:
    - student-specs/modules/syscall/syscall_abi.yaml
    - student-specs/modules/memory/user_copy.yaml
  decisions:
    interface_style: Linux_static_ELF_subset
    error_model: negative_errno
    blocking_semantics: wait_queue
  invariants:
    - user pointers must be validated before dereference
    - write must not leak kernel memory on invalid buffer
  validation_binding:
    public:
      - write_stdout_smoke
    generated:
      - write_bad_user_pointer
```

### 5.3 ArchitectureDecisionRecord

文件：

```text
student-specs/architecture/decisions/ADR-*.yaml
```

作用：记录关键设计取舍与后果，避免阶段设计只留下结论不留下理由。

```yaml
ArchitectureDecisionRecord:
  id: ADR-002
  stage: trap-privilege
  title: Use explicit copy_from_user / copy_to_user boundary
  context: user programs are introduced before full VFS support
  decision: all user buffers are copied through checked helpers
  alternatives:
    - direct dereference after address range check
  reason: simpler fault boundary and easier negative testing
  consequences:
    - syscall ABI must define EFAULT behavior
    - memory spec must expose user copy helpers
```

### 5.4 ArchitectureCompositionSpec

文件：

```text
student-specs/architecture/composition.yaml
```

作用：描述跨模块组合关系和系统级不变量，防止只是拼装概念。

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
      validation_intent:
        - fd_close_refcount
        - invalid_fd_permission

    - name: capability_checked_ipc
      description: endpoint access must be authorized by capability
      invariant:
        - sender must hold send right
        - receiver must hold receive right
        - transferred capability must be explicitly transferable
      affected_modules:
        - ipc
        - capability
        - scheduler
      validation_intent:
        - invalid_capability_send
        - endpoint_close_wakeup
```

### 5.5 StageValidationBinding

文件：

```text
student-specs/architecture/timeline.yaml
student-specs/evidence/stage-*.yaml
```

作用：把阶段设计绑定到测试、验证和证据，形成“设计声明过什么、系统验证了什么”的审计链。

```yaml
StageValidationBinding:
  stage: resource-fd-object
  declared_capability:
    - fd maps to live object handle
    - close decrements refcount
  tests:
    public:
      - fd_close_smoke
    generated:
      - refcount_double_close
    hidden:
      - orphan_handle_cleanup
  evidence:
    - reports/resource-stage.json
```

### 5.6 FinalArchitectureSynthesis

文件：

```text
student-specs/architecture/final-synthesis.yaml
```

作用：在课程末期汇总各阶段已确认的机制、被拒绝的机制以及验证证据。它是对历史设计的合成，不是重新发明一份脱离过程的新设计。

```yaml
FinalArchitectureSynthesis:
  project_name: CapFS-OS
  architecture_summary: >
    A RISC-V64 teaching OS that combines a Linux-like static syscall subset,
    an internal object manager, capability-checked IPC, and a namespace-based
    file service.
  confirmed_mechanisms:
    - per_process_address_space
    - negative_errno
    - endpoint_ipc
    - namespace_service
  rejected_mechanisms:
    - full_POSIX_signal_model
    - dynamic_linker
  validation_summary:
    - boot_to_userspace
    - invalid_user_pointer
    - endpoint_close_wakeup
    - namespace_escape_failure
```

### 5.7 ModuleSpec

目录：

```text
student-specs/modules/
```

作用：描述每个核心模块的状态、接口、前置条件、后置条件、不变量、错误语义、并发规则和测试意图。

通用格式：

```yaml
ModuleSpec:
  name: PageAllocator
  domain: os.memory
  purpose: allocate and free physical pages

  state:
    - free_list
    - allocated_bitmap
    - reserved_regions

  interface:
    - alloc_page() -> PhysPage | OUT_OF_MEMORY
    - free_page(page: PhysPage) -> OK | INVALID_PAGE | DOUBLE_FREE

  preconditions:
    - allocator_initialized
    - page must be page-aligned when freeing
    - page must not belong to reserved region

  postconditions:
    - alloc_page returns a page not currently allocated
    - free_page makes page available for future allocation
    - failed allocation does not modify allocator state

  invariants:
    - no page appears twice in free_list
    - allocated page is not in free_list
    - reserved memory is never allocated
    - free_count + allocated_count + reserved_count == total_pages

  dependencies:
    - boot_memory_map
    - spinlock

  error_cases:
    - double_free
    - invalid_page
    - out_of_memory

  validation_intent:
    - allocate_all_pages
    - free_and_reallocate
    - double_free_rejected
    - reserved_region_never_allocated
```

建议至少编写以下模块规格：

```text
boot/boot_entry.yaml
memory/page_allocator.yaml
memory/virtual_memory.yaml
trap/trap_entry.yaml
scheduler/scheduler.yaml
syscall/syscall_dispatch.yaml 或 ipc/endpoint.yaml
object/object_manager.yaml 按需
capability/capability.yaml 按需
namespace/namespace.yaml 按需
vfs/vfs.yaml 或 fs/fs.yaml 按需
driver/console.yaml
```

### 5.8 InterfaceSpec / ABISpec

目录：

```text
student-specs/modules/syscall/
student-specs/modules/ipc/
```

作用：描述学生选择的 syscall、IPC、ABI 或服务接口。

示例：

```yaml
SyscallABISpec:
  name: LinuxStaticSubset
  arch: riscv64

  calling_convention:
    syscall_number: a7
    args:
      - a0
      - a1
      - a2
      - a3
      - a4
      - a5
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
        - fd must refer to writable object
        - buf must be readable user memory
      postconditions:
        - writes at most len bytes
        - does not read kernel memory through user pointer
      validation_intent:
        - write_stdout
        - write_invalid_fd
        - write_bad_user_ptr
```

如果学生选择 Mach-like、NT-like、Plan9-like 或 custom API，也必须给出对应 InterfaceSpec，而不能只写“类某系统”。

### 5.9 ConcurrencySpec

文件：

```text
student-specs/modules/*/concurrency.yaml
```

作用：凡涉及调度、IPC、wait queue、文件系统、引用计数、锁、原子操作或中断交互的模块必须编写。

```yaml
ConcurrencySpec:
  module: Scheduler

  shared_state:
    - run_queue
    - sleeping_queue
    - task_state

  locking_rules:
    - lock: scheduler_lock
      protects:
        - run_queue
        - task_state
      cannot_sleep_while_held: true

  atomicity:
    - operation: wake_task
      guarantee:
        - task is either in sleeping_queue or run_queue, never both
        - wakeup is not lost if event happens before sleep commit

  interrupt_rules:
    - timer_interrupt may call scheduler_tick
    - scheduler_tick must not acquire blocking mutex

  validation_intent:
    - missed_wakeup
    - double_enqueue
    - preemption_during_block
```

### 5.10 GoalValidationContract

目录：

```text
student-specs/goals/
```

作用：描述个性化目标的范围、非目标、指标和验证意图。最终验证由平台 Agent 派生。

兼容性目标示例：

```yaml
GoalValidationContract:
  goal_id: linux-static-elf-compat
  category: compatibility

  objective:
    - run static ELF hello
    - run syscall smoke test
    - run selected busybox applets

  scope:
    included_syscalls:
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
    excluded:
      - fork
      - signal
      - dynamic_linker
      - pthread

  oracle_intent:
    - syscall_trace_compare
    - expected_stdout
    - return_code

  non_goals:
    - full POSIX compatibility
    - glibc dynamic binary support
```

性能目标示例：

```yaml
GoalValidationContract:
  goal_id: ipc-latency-optimization
  category: performance

  baseline:
    implementation: simple_copy_ipc
    benchmark: ipc_pingpong_10000

  optimization_spec:
    mechanism:
      - shared_page_fast_path
      - direct_wakeup

  metrics:
    - median_latency_ns
    - p99_latency_ns
    - context_switch_count

  correctness_requirements:
    - ipc_permission_check_must_hold
    - ipc_message_integrity_must_hold
    - endpoint_close_race_must_not_panic

  tradeoff_analysis_required: true
```

### 5.11 SpecPatch

目录：

```text
student-specs/evolution/
```

作用：所有大规模功能演化必须先提交 SpecPatch，再修改代码。

```yaml
SpecPatch:
  patch_id: patch-002-capability-ipc
  title: Add capability check to IPC endpoint

  motivation:
    - current IPC allows any task to send to any endpoint
    - architecture design requires explicit send right

  affected_specs:
    - architecture/composition.yaml
    - modules/ipc/endpoint.yaml
    - modules/capability/capability.yaml

  changed_invariants:
    added:
      - sender must hold send right
      - transferred capability must be transferable
    removed: []

  affected_modules:
    - ipc
    - capability
    - scheduler

  migration_plan:
    - add capability field to endpoint
    - update ipc_send precondition
    - add invalid_capability_send validation intent

  expected_regressions:
    - ipc_basic
    - invalid_capability_send
    - endpoint_close_wakeup
```

### 5.12 HardwarePortSpec

文件：

```text
student-specs/goals/hardware-port.yaml
```

作用：选择物理硬件移植的学生必须编写。

```yaml
HardwarePortSpec:
  target_board: VisionFive2
  cpu_architecture: riscv64

  boot_chain:
    - boot_rom
    - opensbi
    - u-boot
    - kernel_elf

  memory_map:
    ram:
      base: 0x40000000
      size: 4GiB
    reserved:
      - region: firmware
        start: 0x40000000
        size: 2MiB
    mmio:
      - name: uart0
        base: 0x10000000
        size: 0x1000

  device_discovery:
    method: device_tree

  required_drivers:
    - uart
    - timer
    - interrupt_controller

  porting_invariants:
    - kernel must not allocate reserved memory
    - MMIO must not be mapped as normal cacheable RAM
    - interrupt handler must acknowledge device interrupt exactly once

  validation_intent:
    - serial_boot_log
    - timer_tick
    - simple_user_program
```

### 5.13 AICollaborationLog

文件：

```text
student-specs/reports/ai-collaboration-log.md
```

作用：记录 AI 协作证据。

```markdown
# AI Collaboration Log

## Entry 001: PageAllocator free_page

- Date:
- Related spec: `student-specs/modules/memory/page_allocator.yaml`
- Prompt summary:
  - Asked AI to implement `free_page` according to invariants.
- AI output summary:
  - Generated patch for bitmap and free_list update.
- Student review:
  - Found missing double-free check.
- Validation:
  - `double_free_rejected` failed before fix.
  - Added precondition and test intent.
- Final decision:
  - Accepted modified version.
```

---

## 6. 平台 Agent 动态生成的 Spec

平台 Agent 根据以下输入生成验证类 Spec：

```text
教师 Spec
+ 学生 ArchitectureSeed / ArchitectureSlice / FinalArchitectureSynthesis
+ 学生 ArchitectureCompositionSpec
+ 学生 ModuleSpec
+ 学生 GoalValidationContract
+ 仓库代码结构
+ CI 日志
+ 历史提交
+ 失败记录
```

平台 Agent 生成的 Spec 不替代学生设计，而是对学生设计进行验证派生。

### 6.1 NormalizedDesignSpec

文件：

```text
agent-generated-specs/normalized-design.yaml
```

作用：将学生自由书写的架构归一化为机器可验证模型。

```yaml
NormalizedDesignSpec:
  project_id: verispec-oslab-2026-alice
  target:
    isa: riscv64
    machine: qemu-virt
    boot_protocol: opensbi

  declared_architecture:
    kernel_organization: hybrid
    execution_model: process_thread
    protection_model:
      - page_table
      - capability
    communication_model:
      - syscall
      - ipc
    namespace_model: per_process_namespace

  detected_claims:
    - static_elf_loader
    - linux_syscall_subset
    - capability_checked_ipc
    - fd_object_mapping
    - user_space_file_service

  unresolved_claims:
    - vfs_consistency_model_missing
    - revoke_semantics_unspecified
```

### 6.2 RiskModelSpec

文件：

```text
agent-generated-specs/risk-model.yaml
```

作用：根据学生架构生成风险模型，决定验证重点。

```yaml
RiskModelSpec:
  high_risk_properties:
    - id: user_pointer_safety
      reason: syscall interface accepts user pointers
      affected_modules:
        - syscall
        - memory
      suggested_tests:
        - invalid_user_pointer
        - kernel_address_as_user_buffer
        - unmapped_user_buffer

    - id: capability_lifetime
      reason: IPC endpoint uses capability rights and object refcount
      affected_modules:
        - ipc
        - capability
        - object
      suggested_tests:
        - use_after_revoke
        - endpoint_close_while_blocked
        - transfer_nontransferable_cap

    - id: namespace_escape
      reason: per-process namespace declared
      affected_modules:
        - namespace
        - vfs
      suggested_tests:
        - path_escape_dotdot
        - bind_mount_escape
```

### 6.3 DerivedVerificationPlan

文件：

```text
agent-generated-specs/derived-verification-plan.yaml
```

作用：生成最终验证计划。

```yaml
DerivedVerificationPlan:
  source:
    teacher_policy: course-specs/verification-policy.yaml
    student_design:
      - student-specs/architecture/seed.yaml
      - student-specs/architecture/slices/
    student_composition: student-specs/architecture/composition.yaml

  required_suites:
    - base_boot
    - memory_safety
    - trap_entry
    - user_execution
    - syscall_or_ipc_smoke

  architecture_suites:
    - linux_static_elf_subset
    - capability_ipc
    - fd_object_lifetime
    - namespace_isolation

  goal_suites:
    - ipc_latency_benchmark
    - static_busybox_subset

  negative_suites:
    - invalid_user_pointer
    - invalid_capability
    - double_free
    - namespace_escape

  evidence_required:
    - qemu_log
    - junit_report
    - syscall_trace
    - invariant_report
    - benchmark_result
```

### 6.4 DerivedTestMatrixSpec

文件：

```text
agent-generated-specs/derived-test-matrix.yaml
```

作用：统一组织公开测试、生成测试、隐藏测试、负例测试、benchmark 和 fuzz。

```yaml
DerivedTestMatrixSpec:
  matrix:
    - test: boot_to_userspace
      type: qemu
      visibility: public
      source: base_requirement
      timeout_sec: 20

    - test: write_bad_user_pointer
      type: syscall_negative
      visibility: hidden
      source: inferred_from_syscall_abi
      property: user_pointer_safety

    - test: endpoint_close_wakeup
      type: integration
      visibility: public
      source: architecture_composition
      property: capability_checked_ipc

    - test: cap_revoke_use_after_revoke
      type: hidden
      visibility: hidden
      source: risk_model
      property: capability_lifetime

    - test: ipc_pingpong_latency
      type: benchmark
      visibility: public
      source: goal_contract
      metric:
        - median_latency_ns
        - p99_latency_ns
```

### 6.5 HiddenTestPlanSpec

文件：

```text
agent-generated-specs/hidden-test-plan.yaml
```

作用：生成学生不可完全可见的隐藏测试。

```yaml
HiddenTestPlanSpec:
  tests:
    - name: kernel_pointer_as_user_buffer
      property: user_pointer_safety
      derived_from:
        - SyscallABISpec.write
        - RiskModelSpec.user_pointer_safety
      visibility: hidden

    - name: endpoint_revoke_during_blocked_receive
      property: capability_lifetime
      derived_from:
        - ArchitectureCompositionSpec.capability_checked_ipc
      visibility: hidden
```

### 6.6 FuzzPlanSpec

文件：

```text
agent-generated-specs/fuzz-plan.yaml
```

作用：根据接口和风险模型生成 fuzz 计划。

```yaml
FuzzPlanSpec:
  targets:
    - name: syscall_fuzz
      input_space:
        syscall_number: declared_syscalls_plus_invalid
        args:
          - valid_user_pointer
          - invalid_user_pointer
          - kernel_pointer
          - unmapped_pointer
          - oversized_length
      stop_conditions:
        - kernel_panic
        - invariant_violation
        - timeout

    - name: ipc_fuzz
      input_space:
        endpoint_state:
          - open
          - closed
          - revoked
        rights:
          - send
          - receive
          - none
        payload_size:
          - 0
          - 1
          - page_size
          - oversized
```

### 6.7 OracleBindingSpec

文件：

```text
agent-generated-specs/oracle-binding.yaml
```

作用：为不同目标绑定不同 oracle。

```yaml
OracleBindingSpec:
  oracles:
    - property: linux_static_elf_write_semantics
      oracle_type: trace_compare
      reference:
        system: linux
        runner: qemu_linux_user_or_native_container
      compare:
        - syscall_number
        - return_value_class
        - stdout
        - exit_code

    - property: allocator_safety
      oracle_type: invariant_checker
      reference:
        spec: student-specs/modules/memory/page_allocator.yaml
      compare:
        - no_duplicate_free_page
        - reserved_never_allocated

    - property: ipc_message_integrity
      oracle_type: metamorphic_test
      relation:
        - send_then_receive_preserves_payload
        - invalid_sender_does_not_change_receiver_state
```

### 6.8 MutationTestPlanSpec

文件：

```text
agent-generated-specs/mutation-test-plan.yaml
```

作用：检查学生测试和平台派生测试是否真的能发现错误。

```yaml
MutationTestPlanSpec:
  mutations:
    - id: remove_user_pointer_check
      target: syscall_copy_from_user
      expected_failure:
        - write_bad_user_pointer
        - syscall_fuzz

    - id: disable_double_free_check
      target: page_allocator_free
      expected_failure:
        - double_free_rejected
        - allocator_invariant_check

    - id: skip_capability_right_check
      target: ipc_send
      expected_failure:
        - invalid_capability_send
        - cap_revoke_use_after_revoke
```

### 6.9 ReviewQuestionsSpec

文件：

```text
agent-generated-specs/review-questions.yaml
```

作用：平台 Agent 根据学生设计和风险模型生成答辩/代码审查问题。

```yaml
ReviewQuestionsSpec:
  questions:
    - topic: user_pointer_safety
      question: >
        Your syscall ABI accepts user pointers. Which function enforces that
        kernel addresses cannot be passed as user buffers, and which invariant
        would fail if this check is removed?

    - topic: capability_lifetime
      question: >
        What happens if a task blocks on an endpoint and another task revokes
        the receive capability before wakeup?

    - topic: namespace_isolation
      question: >
        How does your path resolution prevent escaping the process namespace root?
```

### 6.10 GradingEvidenceMap

文件：

```text
agent-generated-specs/grading-evidence-map.yaml
```

作用：将评分项映射到可追溯证据。

```yaml
GradingEvidenceMap:
  items:
    - rubric: architecture_design
      evidence:
        - student-specs/architecture/seed.yaml
        - student-specs/architecture/slices/
        - agent-generated-specs/normalized-design.yaml
        - reports/architecture-review-report.md

    - rubric: platform_derived_verification
      evidence:
        - agent-generated-specs/derived-verification-plan.yaml
        - reports/test-results.xml
        - reports/invariant-report.json
        - reports/fuzz-report.json

    - rubric: originality
      evidence:
        - student-specs/architecture/seed.yaml
        - student-specs/architecture/slices/
        - student-specs/evolution/
        - agent-generated-specs/review-questions.yaml
```

---

## 7. Spec 可见性策略

平台 Agent 生成的 Spec 需要分级可见，兼顾教学反馈和验证真实性。

```yaml
GeneratedSpecVisibility:
  public_to_student:
    - normalized-design.yaml
    - risk-model.summary.yaml
    - derived-verification-plan.public.yaml
    - public-test-matrix.yaml
    - oracle-binding.summary.yaml

  partially_visible_to_student:
    - fuzz-plan.summary.yaml
    - benchmark-plan.yaml
    - review-questions.yaml

  hidden_from_student:
    - hidden-test-plan.yaml
    - mutation-test-plan.yaml
    - hidden-oracle-details.yaml
    - anti-gaming-checks.yaml

  visible_to_teacher_and_ta:
    - all_agent_generated_specs
    - full_test_results
    - grading-evidence-map.yaml
```

原则：

```text
学生应知道自己会被验证哪些性质；
学生不应知道全部隐藏输入、变异点和反作弊检查；
教师和助教可以查看全部 Agent 派生规格与评分证据。
```

---

## 8. 工作流

课程中的 Spec 工作流如下：

```text
教师发布 Course Spec
    ↓
学生提交 ArchitectureSeed
    ↓
平台按阶段发布 StageGate
    ↓
学生提交当前阶段的 ArchitectureSlice
    ↓
学生补充 ModuleSpec / InterfaceSpec / ConcurrencySpec / GoalValidationContract
    ↓
平台 Agent 进行 spec normalization
    ↓
平台 Agent 生成 RiskModelSpec
    ↓
平台 Agent 生成 DerivedVerificationPlan
    ↓
平台 Agent 生成 DerivedTestMatrix / FuzzPlan / OracleBinding
    ↓
学生实现系统并提交代码
    ↓
CI 运行公开测试与生成测试
    ↓
Online Judge 运行隐藏测试、fuzz、trace oracle、benchmark
    ↓
平台 Agent 生成验证报告与评分证据
    ↓
学生根据反馈修改 Slice、SpecPatch 或代码
    ↓
进入下一阶段并累积回归测试
    ↓
课程末期生成 FinalArchitectureSynthesis、最终报告与答辩
```

对应命令入口可以设计为：

```bash
vos spec lint student-specs/
vos arch seed init
vos arch slice lint student-specs/architecture/slices/01-boot.yaml
vos agent normalize-design
vos agent derive-risk-model
vos agent derive-verification-plan
vos agent derive-test-matrix
vos verify stage boot-minimum
vos build
vos test public
vos verify generated
vos judge submit
vos arch synthesize-final
vos report generate
```

---

## 9. 权责矩阵

| Spec 类型 | 教师 | 学生 | 平台 Agent | 说明 |
|---|---:|---:|---:|---|
| ExperimentSpec | 主责 | 只读 | 读取 | 控制课程阶段 |
| ProblemSpec | 主责 | 只读 | 读取 | 定义实验问题 |
| DesignSpaceSpec | 主责 | 只读 | 读取 | 控制设计空间 |
| BaseRequirementSpec | 主责 | 只读 | 读取并派生测试 | 所有人最低要求 |
| InterfaceContractSpec | 主责 | 只读 | 读取并绑定 Judge | 平台调用接口 |
| VerificationPolicySpec | 主责 | 只读 | 读取并生成最终验证 | 验证边界 |
| EvaluationRubricSpec | 主责 | 可见 | 生成证据映射 | 评分规则 |
| AIPolicySpec | 主责 | 遵守 | 执行 | AI 使用边界 |
| JudgePolicySpec | 主责 | 只读部分 | 执行 | 隐藏测试和沙箱 |
| ArchitectureSeed | 审核 | 主责 | 归一化与审查 | 初始方向与 non-goals |
| ArchitectureSlice | 审核 | 主责 | 阶段审查与派生验证 | 课程主线设计产物 |
| ArchitectureDecisionRecord | 抽查 | 主责 | 读取并追踪影响 | 记录关键取舍 |
| ArchitectureCompositionSpec | 审核 | 主责 | 派生组合测试 | 防止概念拼装 |
| StageValidationBinding | 抽查 | 主责 | 检查证据绑定 | 设计与验证闭环 |
| FinalArchitectureSynthesis | 审核 | 主责 | 汇总并校验可追溯性 | 课程末期设计综合 |
| ModuleSpec | 抽查 | 主责 | lint 与生成测试 | 描述模块语义 |
| InterfaceSpec / ABISpec | 抽查 | 主责 | 生成 ABI 测试 | 接口语义 |
| ConcurrencySpec | 抽查 | 主责 | 生成并发测试 | 并发风险 |
| GoalValidationContract | 审核 | 主责 | 生成目标验证 | 个性化目标 |
| VerificationPlan | 定义策略 | 提供意图 | 主责生成最终版 | 提高验证真实性 |
| TestMatrix | 定义边界 | 提供自测 | 主责生成 | 支持动态评测 |
| HiddenTestPlan | 主控 | 不可见 | 主责生成 | 防止迎合测试 |
| FuzzPlan | 定义策略 | 部分可见 | 主责生成 | 覆盖异常路径 |
| OracleBinding | 定义可用 oracle | 提供目标语义 | 主责生成 | 支持兼容/性能/语义验证 |
| MutationTestPlan | 可查看 | 不可见 | 主责生成 | 检查测试有效性 |
| GradingEvidenceMap | 审核 | 可查看部分 | 主责生成 | 辅助评分 |
| SpecPatch | 审核 | 主责 | 检查影响 | 管理演化 |
| AICollaborationLog | 抽查 | 主责 | 辅助生成摘要 | AI 协作证据 |

---

## 10. 与开发流程的对应关系

### 10.1 Design 阶段

学生提交：

```text
student-specs/architecture/seed.yaml
student-specs/architecture/slices/*.yaml
student-specs/architecture/decisions/*.yaml
student-specs/architecture/composition.yaml
student-specs/architecture/final-synthesis.yaml
```

平台 Agent 生成：

```text
agent-generated-specs/normalized-design.yaml
agent-generated-specs/risk-model.yaml
agent-generated-specs/stage-review-report.yaml
```

阶段目标：确认学生设计不是标签化设计，而是随着课程阶段持续形成、具有明确机制、边界、状态和验证意图。

### 10.2 Development 阶段

学生提交：

```text
student-specs/modules/**/*.yaml
student-specs/goals/*.yaml
src/
```

平台检查：

```text
spec_lint
arch_lint
interface_lint
concurrency_lint
```

阶段目标：确保代码变更有对应规格依据。

### 10.3 Test 阶段

学生提供：

```text
validation_intent
自测用例
公开测试期望
```

平台 Agent 生成：

```text
agent-generated-specs/derived-test-matrix.yaml
agent-generated-specs/fuzz-plan.yaml
agent-generated-specs/hidden-test-plan.yaml
```

阶段目标：让测试既覆盖学生自定义架构，又不被学生完全控制。

### 10.4 Verification 阶段

平台运行：

```text
public tests
generated tests
hidden tests
fuzz tests
trace oracle
invariant checker
benchmark
mutation tests
```

平台 Agent 输出：

```text
reports/agent-verification-report.md
agent-generated-specs/grading-evidence-map.yaml
```

阶段目标：形成可追溯、可评分、可复现的验证证据。

### 10.5 Evolution 阶段

学生提交：

```text
student-specs/evolution/patch-*.yaml
```

平台 Agent 执行：

```text
影响分析
回归测试派生
风险模型更新
验证计划更新
```

阶段目标：训练学生用 SpecPatch 演化系统，而不是直接随意修改代码。

---

## 11. 最小可行版本

第一版课程不必一次要求所有 Spec 完整，可以采用分级启用。

### 11.1 基础必填

```text
ArchitectureSeed
ArchitectureSlice for boot/memory/trap/syscall-or-ipc
ArchitectureCompositionSpec
ModuleSpec for boot/memory/trap/syscall-or-ipc
AICollaborationLog
FinalReport
```

### 11.2 平台 Agent 必生成

```text
NormalizedDesignSpec
RiskModelSpec
DerivedVerificationPlan
DerivedTestMatrixSpec
HiddenTestPlanSpec
GradingEvidenceMap
```

### 11.3 按目标启用

```text
InterfaceSpec / ABISpec
ConcurrencySpec
GoalValidationContract
FuzzPlanSpec
OracleBindingSpec
MutationTestPlanSpec
HardwarePortSpec
BenchmarkSpec
SpecPatch
```

---

## 12. 典型个性化路线与 Spec 组合

### 12.1 Linux ABI 兼容路线

学生重点编写：

```text
ArchitectureSeed
ArchitectureSlice for syscall / resource stages
SyscallABISpec
ELFLoader ModuleSpec
VFS / FD ModuleSpec
GoalValidationContract: linux-static-elf-compat
```

平台 Agent 重点生成：

```text
syscall trace oracle
bad user pointer tests
invalid fd tests
static ELF execution tests
busybox subset tests
```

### 12.2 Microkernel / Capability 路线

学生重点编写：

```text
ArchitectureCompositionSpec
IPC ModuleSpec
Capability ModuleSpec
Object Manager ModuleSpec
ConcurrencySpec
```

平台 Agent 重点生成：

```text
capability lifetime tests
endpoint close race tests
invalid send right tests
IPC fuzz tests
message integrity oracle
```

### 12.3 Plan9-like Namespace 路线

学生重点编写：

```text
Namespace ModuleSpec
VFS ModuleSpec
Device-as-file InterfaceSpec
ArchitectureCompositionSpec
```

平台 Agent 重点生成：

```text
namespace escape tests
bind mount consistency tests
path traversal fuzz tests
per-process namespace isolation tests
```

### 12.4 硬件移植路线

学生重点编写：

```text
HardwarePortSpec
Boot ModuleSpec
Driver ModuleSpec
MemoryMap Spec
Interrupt Controller Spec
```

平台 Agent 重点生成：

```text
reserved memory tests
MMIO mapping checks
serial boot log checks
interrupt acknowledgement checks
hardware evidence checklist
```

---

## 13. 关键约束

### 13.1 Spec-first

核心模块开发必须先有 ModuleSpec。

```text
无 ModuleSpec → Agent 不应生成核心模块代码
无当前阶段 ArchitectureSlice → 不允许进入对应核心实现
无可追溯的 ArchitectureSeed / Slice / ADR 链条 → 不允许声称完整架构已定义
无 ConcurrencySpec → 不允许生成复杂并发代码
无 GoalValidationContract → 不允许声明高级目标得分
```

### 13.2 Test-derived-by-Agent

学生可以写测试意图和自测，但最终测试矩阵由平台 Agent 派生。

```text
学生不能完全控制 hidden tests
学生不能完全控制 fuzz input space
学生不能完全控制 oracle 细节
学生不能通过缩小验证计划规避错误
```

### 13.3 Verification evidence required

最终报告必须引用验证证据。

```text
每个核心不变量至少绑定一种证据：
  - unit test
  - integration test
  - runtime assertion
  - invariant checker
  - fuzz result
  - trace compare
  - formal proof
  - benchmark result
```

### 13.4 Evolution through SpecPatch

系统演化必须先修改 Spec，再修改实现。

```text
功能新增 → SpecPatch
接口变化 → InterfaceSpec 更新
阶段架构变化 → 当前 ArchitectureSlice 更新
跨阶段架构变化 → ArchitectureDecisionRecord + SpecPatch
跨模块规则变化 → ArchitectureCompositionSpec 更新
并发规则变化 → ConcurrencySpec 更新
验证变化 → Agent 重新派生验证计划
```

---

## 14. 核心表述

课程中的协作模式：

```text
学生写 spec → 学生写代码 → 学生跑测试
```

规范模式：

```text
教师定义边界
学生定义系统
平台 Agent 派生验证
CI/Judge 执行真实测试
教师依据证据评分
学生在反馈中演化系统
```

也可以概括为：

```text
以学生规格表达设计，
以平台 Agent 派生验证，
以教师策略保证公平，
以动态测试提高真实性，
以 SpecPatch 支撑系统演化。
```

---

## 15. 预期收益

```text
1. 验证更真实：学生不能完全通过自定义验证范围规避错误。
2. 架构更自由：平台 Agent 可根据不同架构动态派生测试。
3. 评分更公平：教师控制评分规则，Agent 生成证据映射。
4. AI 更受约束：AI 不只是生成代码，也负责提出风险、派生测试和解释失败。
5. 工程能力更完整：学生需要同时完成设计、实现、验证、调试、演化和报告。
6. 课程可扩展：同一 Spec 体系可迁移到数据库、编译器、网络协议栈、运行时等 SpecLab 项目。
```

