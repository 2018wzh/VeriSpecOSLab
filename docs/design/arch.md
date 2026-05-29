# VeriSpecOSLab 架构设计文档

## 1. 设计目标

本架构用于为 VeriSpecOSLab 以及其他 Spec 驱动实验项目提供统一的开发环境、Agent 接入层、验证测试平台与评分证据采集机制。

核心目标包括：

1. 支持学生在 VS Code、JetBrains、Cursor、Continue、Cline、Aider、Open WebUI、CodeGPT 等支持 OpenAI-compatible API 的 IDE 或工具中接入项目专用 Agent。
2. 将 AI 使用限制在规格、测试、构建、验证反馈和审计日志约束之下，避免学生直接让 AI 代写完整系统。
3. 提供可复现、可测试、可评分的 DevBox 开发环境。
4. 支持个性化目标验证，例如二进制兼容、性能优化、硬件移植、可验证性增强、安全隔离等。
5. 自动记录 AI 协作过程，生成可用于教学评价和过程反馈的证据。

核心闭环如下：

```text
Spec → Agent → Patch → Build → Test → Validate → Feedback → Spec / Code 修正
```

---

## 2. 总体架构

整体采用五层结构：

```text
IDE / Editor / CLI
    ↓ OpenAI-compatible API
Agent Gateway
    ↓
Cloud Spec Service
    ↓
Project Agent Runtime
    ↓
DevBox / Toolchain / CI / QEMU / Test / Project Repo
```

展开如下：

```text
VS Code / JetBrains / Cursor / Continue / Cline / Aider
        |
        | OpenAI-compatible:
        |   base_url = http://localhost:8080/v1
        |   api_key  = student-token
        |   model    = verispecoslab-agent
        v
+--------------------------------+
| OpenAI-Compatible Agent Gateway|
| - /v1/models                   |
| - /v1/chat/completions         |
| - /v1/responses 可选           |
| - streaming support            |
| - tool call normalization      |
| - audit and policy enforcement |
+--------------------------------+
        |
        v
+--------------------------------+
| Cloud Spec Service             |
| - course spec store            |
| - hidden verification spec     |
| - derived runtime spec         |
| - role-based projection        |
| - versioning and audit         |
+--------------------------------+
        |
        v
+--------------------------------+
| VeriSpecOSLab Agent Runtime    |
| - ArchitectureSpecAssistant    |
| - SpecAssistant                |
| - CodeGenAgent / SpecCompiler  |
| - SpecValidatorAgent           |
| - KernelDebugAgent             |
| - TestGenAgent                 |
| - ReviewAgent                  |
+--------------------------------+
        |
        v
+--------------------------------+
| DevBox / Sandbox               |
| - clang/gcc/rust/zig           |
| - qemu-system-*                |
| - gdb/lldb                     |
| - make/cmake/cargo             |
| - spec_lint / arch_lint        |
| - tests / benchmarks           |
| - CI runner                    |
+--------------------------------+
```

对外表现为标准 OpenAI-compatible API 服务；对内则是“项目仓库 + 云端 Spec Service + 本地工具链”协同工作的 Agent 系统。IDE 只需要配置 `base_url`、`api_key` 和 `model`，不需要理解项目内部工具链、云端 Spec 访问和测试矩阵生成细节。

---

## 3. VeriSpecOSLab DevBox

DevBox 用于保证学生环境一致、可复现、可测试、可 CI 化。

### 3.1 交付形态

建议提供三种入口：

```text
1. Docker / Podman 镜像
2. VS Code DevContainer
3. GitHub Codespaces / GitLab Web IDE 可选
```

### 3.2 推荐目录结构

```text
verispecoslab/
  .devcontainer/
    devcontainer.json
    Dockerfile

  spec/
    architecture/
      seed.yaml
      slices/
      decisions/
      composition.yaml
      final-synthesis.yaml
    modules/
      kernel/
        boot/
        memory/
        trap/
        scheduler/
        syscall/
      services/
        ipc/
        capability/
        object/
        namespace/
        vfs/
        fs/
        driver/
    goals/
    evolution/
    reports/

  src/
    arch/
      riscv64/
      x86_64/
      aarch64/
    kernel/
    user/
    services/
    drivers/
    lib/

  tests/
    base/
    features/
    composition/
    goals/
    unit/
    integration/
    qemu/
    syscall/
    ipc/
    fuzz/
    model/

  tools/
    spec_lint/
    arch_lint/
    spec_to_test/
    arch_test_deriver/
    qemu_runner/
    log_parser/
    invariant_checker/
    trace_compare/
    report_generator/

  agent/
    gateway/
    runtime/
    prompts/
    policies/
    tools/

  ci/
    github-actions/
    gitlab-ci/
```

学生仓库中只保留与项目设计直接相关的 `spec/`。课程规则、隐藏验证规则和平台派生 Spec 不进入学生仓库，而是保存在云端 Spec Service 中，由 Gateway 按权限投影给学生界面、Agent 和教师界面。

### 3.3 DevBox 内置工具链

```text
通用构建：
  - clang / lld / llvm-objdump / llvm-readelf
  - gcc / binutils
  - cmake / make / ninja
  - python / node / jq / yq

OS 开发：
  - qemu-system-riscv64
  - qemu-system-x86_64
  - qemu-system-aarch64
  - gdb-multiarch
  - lldb
  - opensbi
  - u-boot-tools
  - grub / limine 可选

语言：
  - C/C++
  - Rust nightly + cargo-binutils
  - Zig 可选

验证：
  - spec_lint
  - arch_lint
  - clang-tidy
  - cppcheck
  - sanitizers for host-side components
  - CBMC / Kani / TLA+ 可选

教学脚本：
  - run-qemu
  - run-test
  - run-spec-lint
  - run-arch-lint
  - run-invariant-check
  - collect-ai-log
  - generate-report
```

### 3.4 统一命令入口

提供 `vos` 命令作为统一入口：

```bash
vos init
vos spec lint spec/modules/kernel/memory/ops/kalloc.yaml
vos arch lint spec/architecture/seed.yaml
vos arch derive-tests spec/architecture/seed.yaml
vos build
vos run qemu
vos test
vos verify base
vos verify architecture
vos verify composition
vos verify goal
vos trace
vos debug
vos agent serve
vos submit pack
```

Agent 不直接猜测项目命令，而是通过 `vos` 调用标准工具链。

---

## 4. OpenAI-Compatible Agent Gateway

Agent Gateway 是 IDE 与内部 Agent Runtime 之间的适配层。

### 4.1 对外接口

最低支持：

```http
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses   可选
```

模型列表示例：

```json
{
  "object": "list",
  "data": [
    { "id": "verispecoslab-agent", "object": "model" },
    { "id": "architecture-spec-assistant", "object": "model" },
    { "id": "spec-assistant", "object": "model" },
    { "id": "kernel-debugger", "object": "model" },
    { "id": "spec-validator", "object": "model" }
  ]
}
```

IDE 配置示例：

```text
API Base URL: http://localhost:8080/v1
API Key: vos-local-token
Model: verispecoslab-agent
```

### 4.2 Gateway 职责

Agent Gateway 不只是模型转发器，而是项目感知控制层。

职责包括：

```text
1. 接收 IDE 请求
2. 识别当前项目、文件、选区、任务类型
3. 注入课程系统提示词、项目规范和 AI 使用策略
4. 检索相关 specs / code / tests / logs
5. 调用内部 Agent Runtime
6. 根据权限调用工具
7. 记录 AICollaborationLog
8. 返回 OpenAI-compatible 响应
9. 对核心修改执行 spec-first / test-first / validation-first 约束
```

---

## 5. Agent Runtime 设计

Agent Runtime 内部由多个角色组成。对外可以统一暴露为 `verispecoslab-agent`，对内按任务路由。

### 5.1 ArchitectureSpecAssistant

用于帮助学生编写、检查和完善架构设计规格。

能力：

```text
- 引导学生从内核组织、执行模型、保护模型、通信模型、资源模型等维度描述架构
- 检查是否只是贴 Linux/L4/NT/Plan9 等标签而缺少具体语义
- 检查架构机制组合是否存在冲突
- 检查 reference_systems 是否说明 borrowed / modified / rejected concepts
- 检查是否有 non-goals
- 检查架构设计是否绑定测试、不变量和 benchmark
- 生成 ArchitectureCompositionSpec 草案
```

### 5.2 SpecAssistant

用于帮助学生编写、整理、检查模块规格。

能力：

```text
- 根据模块草案生成规格模板
- 检查 pre/postcondition 是否缺失
- 检查 invariant 是否可测试
- 检查 rely/guarantee 是否匹配
- 检查并发规则是否模糊
- 将自然语言设计转换为结构化 spec
```

### 5.3 CodeGenAgent / SpecCompiler

用于根据规格生成或修改代码。

约束：

```text
- 不允许脱离 spec 生成核心模块
- 不允许一次性生成完整 OS
- 必须指出对应的 spec 条款
- 必须生成测试建议
- 必须说明可能破坏的不变量
- 对架构层变化，必须先更新当前 ArchitectureSlice、SpecPatch 或 ArchitectureCompositionSpec
```

复杂并发模块采用两阶段生成：

```text
Phase 1: 生成顺序逻辑
Phase 2: 根据 ConcurrencySpec 添加锁、原子操作、中断关闭、引用计数等并发控制
```

### 5.4 SpecValidatorAgent

用于检查实现是否满足规格。

工具链：

```text
- spec_lint
- arch_lint
- 静态检查
- 编译检查
- 单元测试
- QEMU regression test
- invariant checker
- syscall / IPC / object trace compare
- fuzz test 可选
```

工作流：

```text
生成代码
  ↓
编译 / 测试 / 规格检查
  ↓
失败则提取错误
  ↓
反馈给 CodeGenAgent
  ↓
重新生成 patch
```

### 5.5 KernelDebugAgent

用于解释 OS 开发错误。

典型输入：

```text
serial.log
qemu.log
gdb backtrace
objdump
readelf
page table dump
trap frame dump
```

典型问题：

```text
- QEMU 启动失败
- triple fault / page fault / prefetch abort
- trap frame 分析
- linker script 错误
- ELF 加载错误
- syscall 返回值错误
- deadlock / missed wakeup
- 用户态地址访问错误
```

### 5.6 TestGenAgent

用于根据规格生成测试。

测试类别：

```text
- 正常路径测试
- 错误路径测试
- 边界条件测试
- precondition violation 测试
- postcondition 检查
- invariant preservation 测试
- concurrency stress test
- architecture composition test
```

### 5.7 ReviewAgent

用于教学评价与代码审查。

检查重点：

```text
- 是否直接 AI 代写
- 是否缺少规格依据
- 是否删除测试绕过失败
- 是否破坏 invariant checker
- 是否存在未解释的复杂代码
- 是否有 AICollaborationLog
- 是否存在架构标签化但缺少机制说明
- 是否存在架构组合但缺少 cross-component invariant
```

---

## 6. 个性化架构设计规格

### 6.1 从固定 Profile 改为递进式架构设计包

平台不再要求学生在固定的 `Linux-like`、`L4-like`、`Darwin-like`、`NT-like`、`Plan9-like`、`RTOS`、`Unikernel` profile 中选择。`*-like` 只作为参考系统标签，不作为架构模板，也不直接决定测试集。

学生提交的不是一份开课早期一次性写完的架构总说明，而是一组随课程阶段演化的架构设计包：`ArchitectureSeed`、`ArchitectureSlice[]`、`ArchitectureDecisionRecord[]`、`ArchitectureCompositionSpec`、`SpecPatch[]` 与 `FinalArchitectureSynthesis`。它们共同说明系统由哪些机制组成、参考了哪些现有系统、修改和拒绝了哪些设计、各模块如何组合，以及这些组合如何被验证。

### 6.2 架构综合视图模板

为了统一验证、评分和工具接口，平台可以把阶段性设计归一化为一个综合视图。这个视图由 Seed、Slice、ADR 和 Composition 自动汇总，而不是要求学生独立维护一份静态总设计文档。

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

### 6.3 Reference Tags

原来的 `Linux-like`、`L4-like`、`Darwin-like` 等仅作为参考来源标签使用。

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

---

## 7. ArchitectureCompositionSpec

个性化组合可能引入跨机制冲突，因此必须提供 `ArchitectureCompositionSpec`。

典型问题包括：

```text
fd table 与 capability 谁负责权限？
VFS path 与 per-process namespace 谁负责解析？
syscall 和 IPC 是两套入口还是统一 message call？
process address space 与 unikernel 单地址空间是否冲突？
user-space driver 如何访问硬件资源？
```

模板如下：

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

---

## 8. 上下文组织策略

不要把整个 OS 仓库直接塞给模型。Gateway 应统一构造“本地项目 Spec + 云端约束投影 + 最近证据”的最小上下文包。

上下文优先级：

```text
1. 当前打开文件
2. 当前选区
3. 当前阶段的公开 StageGate 摘要
4. 当前 ArchitectureSlice
5. 已批准的历史 Slice / 相关 ADR
6. 对应 ModuleSpec / InterfaceSpec / ConcurrencySpec
7. ArchitectureCompositionSpec
8. 当前测试失败日志与最近验证证据
9. 最近 SpecPatch
10. 任务相关的 agent-only hidden property 标签
11. 相关接口头文件与少量相邻实现
```

示例：当学生修改 `src/kernel/mm/page_allocator.c` 时，Agent 自动注入：

```text
云端 StageGate 中 memory 阶段的公开要求投影
spec/architecture/slices/02-memory.yaml
spec/architecture/decisions/ADR-001-memory-layout.yaml
spec/modules/kernel/memory/ops/kalloc.yaml
spec/modules/kernel/memory/ops/kvmmake.yaml
include/kernel/mm/page_allocator.h
tests/unit/test_page_allocator.c
最近一次 vos verify stage memory-management 日志
最近一次单元测试日志
与 page allocator 相关的 hidden risk 标签摘要
```

避免注入：

```text
整个 kernel/
整个 arch/
整个 user/
所有历史对话
```

---

## 9. 工具调用设计

内部工具建议包括：

```text
read_file(path)
write_patch(diff)
list_specs()
run_spec_lint(path)
run_arch_lint(path)
run_stage_check(stage)
derive_arch_tests(path)
run_build(target)
run_qemu(config)
run_test(name)
run_gdb_script(script)
read_log(name)
trace_syscall(program)
trace_ipc(program)
compare_trace(expected, actual)
generate_ai_log(entry)
generate_report(kind)
run_verify_stage(stage)
run_verify_regression()
```

典型流程：

```text
IDE 请求：
  “帮我实现 PageAllocator 的 free_page”

Gateway：
  - 找到当前阶段的公开约束投影
  - 找到当前 ArchitectureSlice 与历史 Slice
  - 找到 page allocator 的本地 spec
  - 拉取任务相关的 hidden constraint 标签
  - 找到当前代码和最近证据

Agent：
  - 先检查 spec
  - 生成 patch
  - 调用 run_spec_lint
  - 调用 run_build
  - 调用 run_test
  - 失败则修正
  - 成功后返回 diff 和解释
  - 写入 AICollaborationLog
```

返回内容应包括：

```text
1. 修改摘要
2. 对应规格条款
3. 生成的 diff
4. 已运行测试
5. 仍未覆盖的风险
6. 学生需要确认的设计点
```

---

## 10. Agent 使用策略

### 10.1 允许

```text
- 根据已有规格补全模块
- 根据测试失败修复代码
- 生成单元测试
- 解释异常日志
- 重构小模块
- 生成 spec patch 草案
- 检查 rely/guarantee
- 检查架构组合不变量
```

### 10.2 限制

```text
- 对核心模块，没有 spec 不允许直接生成实现
- 对架构层变化，必须先更新当前 ArchitectureSlice、ADR 或 ArchitectureCompositionSpec
- 对大规模修改，必须先生成 spec patch
- 对并发模块，必须有 ConcurrencySpec
- 对 syscall / IPC / VFS / VM 修改，必须运行 regression test
- 对硬件移植代码，必须绑定 HardwarePortSpec
```

### 10.3 禁止

```text
- 一次性生成完整 OS
- 删除测试来通过 CI
- 移除 invariant checker
- 绕过权限检查
- 生成无法解释的大段代码
- 直接提交未运行测试的核心修改
- 只用 “Linux-like / L4-like / NT-like” 标签替代具体架构说明
```

---

## 11. IDE 接入方式

### 11.1 VS Code + Continue

```yaml
models:
  - name: VeriSpecOSLab Agent
    provider: openai
    model: verispecoslab-agent
    apiBase: http://localhost:8080/v1
    apiKey: vos-local-token
```

推荐命令：

```text
/arch-check
/arch-generate
/spec-check
/spec-generate
/impl-from-spec
/test-from-spec
/debug-qemu
/review-patch
/explain-trap
```

### 11.2 Cursor / Cline / OpenAI-compatible 插件

```text
Provider: OpenAI Compatible
Base URL: http://localhost:8080/v1
API Key: vos-local-token
Model: verispecoslab-agent
```

Cline 等工具如果支持终端命令执行，可以调用：

```bash
vos build
vos test
vos run qemu
vos spec lint
vos arch lint
```

推荐通过 Gateway 控制工具权限，避免任意执行破坏性命令。

### 11.3 CLI Agent

```bash
vos agent ask "根据 MemorySpec 检查当前 page allocator"
vos agent fix --test tests/unit/test_page_allocator.c
vos agent debug --log build/qemu/serial.log
vos agent spec refine spec/modules/kernel/trap/module.yaml
vos agent arch review spec/architecture/seed.yaml
```

---

## 12. 部署模式

### 12.1 本地单机模式

```text
学生机器：
  DevContainer
  Agent Gateway
  Local / Remote LLM provider
  QEMU
```

优点：

```text
低延迟
方便调试
学生可离线构建
```

缺点：

```text
模型 key 管理复杂
本机资源要求高
```

### 12.2 课程服务器模式

```text
学生 IDE
  ↓
课程 Agent Gateway
  ↓
每个学生一个 workspace container
  ↓
统一 LLM provider
```

优点：

```text
统一权限
统一日志
统一评分
统一模型
方便收集 AICollaborationLog
```

缺点：

```text
服务器成本较高
需要隔离沙箱
```

### 12.3 混合模式

推荐采用混合模式：

```text
本地：
  IDE + DevContainer + QEMU

远端：
  Agent Gateway + 模型路由 + 日志系统

本地工具执行：
  由 vos agent local-runner 完成
```

---

## 13. 个性化架构与个性化目标验证

### 13.1 分层验证模型

```text
验证体系 =
  公共核心验证
+ 架构特性验证
+ 架构组合一致性验证
+ 个性化目标验证
```

公共核心验证保证所有学生的 OS 至少具备 boot、内存、trap、执行单元、用户态、syscall/IPC 入口、基础 I/O 等能力。

架构特性验证根据本地 `spec/architecture/` 中的 `ArchitectureSeed`、当前 `ArchitectureSlice`、历史切片和 `FinalArchitectureSynthesis` 自动选择测试。

架构组合一致性验证根据 `ArchitectureCompositionSpec` 检查跨机制不变量。

个性化目标验证用于验证兼容性、性能优化、安全隔离、硬件移植、可验证性强化等目标。

### 13.2 公共核心验证

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

### 13.3 Feature-Based 架构验证

平台根据学生在本地 `spec/` 中声明的 feature 自动生成测试矩阵，再结合云端 hidden verification spec 扩展私有验证，而不是根据 `*-like profile` 加载固定测试包。

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
base/boot
base/memory
base/trap
base/user_mode

feature/process_lifecycle
feature/thread_scheduling
feature/syscall_entry
feature/ipc_basic
feature/fd_lifetime
feature/capability_permission
feature/per_process_namespace
feature/linux_static_elf_loader

composition/fd_to_object_lifetime
composition/ipc_capability_permission
composition/syscall_user_pointer_safety
composition/namespace_path_resolution
```

### 13.4 个性化目标验证合约

个性化目标必须转化为可测合约：

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

个性化目标验证必须回答：

```text
1. 是否实现了目标？
2. 是否没有破坏公共正确性？
3. 是否有可复现证据？
```

### 13.5 测试矩阵

CI 根据学生声明生成测试矩阵：

```text
TestMatrix =
  BaseTestSuite
+ ArchitectureFeatureTestSuite
+ CompositionConsistencyTestSuite
+ GoalValidationContractTestSuite
+ RegressionTestSuite
```

---

## 14. 统一证据格式

每个测试输出统一 JSON：

```json
{
  "suite": "feature.ipc",
  "case": "ipc_pingpong_basic",
  "result": "pass",
  "duration_ms": 42,
  "artifacts": [
    "serial.log",
    "trace.json",
    "qemu.log"
  ],
  "invariants": {
    "endpoint_queue_valid": true,
    "capability_rights_valid": true
  },
  "metrics": {
    "latency_ns": 1830
  }
}
```

自动生成的报告包括：

```text
VerificationReport.md
ArchitectureReviewReport.md
BenchmarkReport.md
CompatibilityReport.md
HardwareBringupReport.md
AICollaborationLog.md
```

---

## 15. AI 协作日志

每次 Agent 交互写入 `.ai-log/`：

```text
.ai-log/
  2026-xx-xx/
    session-001.jsonl
```

记录字段示例：

```json
{
  "time": "...",
  "student": "...",
  "project": "...",
  "task": "implement page allocator free_page",
  "files": [
    "spec/architecture/seed.yaml",
    "spec/modules/kernel/memory/ops/kalloc.yaml",
    "src/kernel/mm/page_allocator.c"
  ],
  "agent": "CodeGenAgent",
  "model": "verispecoslab-agent",
  "spec_used": true,
  "tools": [
    "run_spec_lint",
    "run_build",
    "run_test"
  ],
  "tests_passed": true,
  "student_decision_required": true,
  "summary": "Generated a patch preserving refcount invariant."
}
```

---

## 16. 评分建议

验证分可拆成：

```text
总验证分 =
  公共核心验证 35%
+ 架构特性验证 20%
+ 架构组合一致性验证 15%
+ 个性化目标验证 20%
+ 证据质量与可复现性 10%
```

架构设计评分可拆成：

```text
架构设计评分 =
  架构抽象清晰度 25%
+ 组件边界合理性 20%
+ 架构组合一致性 20%
+ 参考系统理解深度 15%
+ 取舍与非目标说明 10%
+ 可验证性绑定 10%
```

个性化目标按类型评分：

```text
兼容性：
  ABI 覆盖率
  程序运行数量
  syscall trace 正确性
  错误语义一致性

优化：
  baseline 是否合理
  benchmark 是否可复现
  性能提升幅度
  是否保持正确性

硬件移植：
  boot chain 是否清晰
  驱动是否可用
  QEMU/硬件差异是否解释
  是否运行核心 workload

可验证性：
  不变量质量
  模型检查覆盖
  证明或检查结果
  与代码实现的一致性
```

---

## 17. MVP 实现

第一版建议控制规模：

```text
MVP 目标：
  - 一个 DevContainer
  - 一个 FastAPI / Node.js Gateway
  - 兼容 /v1/chat/completions
  - 支持 Continue / Cline / Cursor 接入
  - 支持 7 个工具：
      read_file
      write_patch
      run_build
      run_test
      run_spec_lint
      run_arch_lint
      derive_arch_tests
  - 支持 4 个 Agent：
      ArchitectureSpecAssistant
      SpecAssistant
      CodeGenAgent
      DebugAgent
  - 自动记录 AICollaborationLog
```

MVP 目录：

```text
agent/
  gateway/
    main.py
    openai_compat.py
    auth.py
    router.py

  runtime/
    agents/
      architecture_spec_assistant.py
      spec_assistant.py
      codegen.py
      debug.py
    tools/
      fs.py
      build.py
      test.py
      spec_lint.py
      arch_lint.py
      arch_test_deriver.py
    memory/
      project_index.py
      spec_index.py

  prompts/
    system.md
    architecture_spec_assistant.md
    spec_assistant.md
    codegen.md
    debug.md
```

推荐技术选型：

```text
Gateway:
  Python FastAPI
  或 Node.js Hono / Express

LLM 调用:
  LiteLLM 风格的 provider abstraction
  支持 OpenAI / Azure OpenAI / vLLM / Ollama / DeepSeek / Qwen 等

检索:
  ripgrep + tree-sitter + 简单向量库
  MVP 阶段不必过度 RAG 化

Sandbox:
  Docker / Podman
  每个项目 workspace 独立挂载

Patch:
  unified diff
  git apply --check
  git worktree 可选

日志:
  JSONL + Markdown report

IDE:
  Continue 作为推荐默认插件
  Cline / Cursor 作为可选
```

---

## 18. 总结

VeriSpecOSLab Agent Gateway 是一个 OpenAI-compatible 的项目专用 AI 接入层。它向 IDE 暴露标准 OpenAI API，向内部连接规格库、源码、测试、QEMU、CI 和验证工具，使学生可以在任意兼容 IDE 中使用统一 Agent 完成规格编写、代码生成、测试生成、错误定位、验证反馈和 AI 协作记录。

该架构的关键不是“接入大模型”，而是把大模型放入规格驱动和验证反馈闭环中：

```text
Spec
  ↓
Agent
  ↓
Patch
  ↓
Build
  ↓
Test
  ↓
Validate
  ↓
Feedback
  ↓
Spec / Code 修正
```

同时，个性化架构不再通过固定 `*-like profile` 表达，而是通过 `ArchitectureSeed`、`ArchitectureSlice`、`ArchitectureCompositionSpec` 和 `FinalArchitectureSynthesis` 精确描述。平台根据具体架构特性和组合不变量自动推导测试矩阵，从而既支持自由组合式系统设计，又能考察学生对架构的理解、掌控和验证能力。

