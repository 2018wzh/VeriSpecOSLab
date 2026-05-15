# SpecLab Platform 设计文档

> 面向 VeriSpecOSLab 与 SpecLab 类实验的通用在线平台设计。
>
> 平台目标：支持 Spec 驱动实验的管理、开发、验证、评测与 Agent 辅助，使操作系统、数据库、编译器等复杂系统类实验能够在线化、自动化、可验证化与可扩展化。

---

## 1. 平台定位

平台建议命名为：**SpecLab Platform**。

其中：

- **VeriSpecOSLab** 是平台上的一个具体实验模板；
- **SpecLab** 是更通用的实验范式；
- 平台核心能力是围绕 **Spec → Design → Implementation → Verification → Evaluation → Report** 的闭环。

平台需要支持以下能力：

1. 教师发布 Spec 驱动的实验项目；
2. 学生基于 Spec 设计自己的个性化架构；
3. 平台为每个学生自动生成仓库、任务、CI/CD、验证用例；
4. Agent 辅助学生完成设计、开发、调试、测试与文档；
5. Git Server 托管代码和实验材料；
6. CI/CD 自动构建、运行和验证；
7. Online Judge 对实验结果进行自动评测；
8. 教师查看进度、评测结果、设计差异和验证覆盖率；
9. 平台泛化到操作系统、数据库、编译器、网络协议栈、运行时等不同课程实验。

---

## 2. 总体架构

平台可以分为八个核心子系统：

```text
+------------------------------------------------------------+
|                    SpecLab Web Portal                      |
|               教师端 / 学生端 / 助教端 / 管理端                |
+--------------------------+---------------------------------+
                           |
                           v
+------------------------------------------------------------+
|                  SpecLab Backend API                       |
|    实验管理 / 用户管理 / Spec 管理 / 评测管理 / Agent 编排       |
+--------------------------+---------------------------------+
                           |
        +------------------+------------------+
        |                  |                  |
        v                  v                  v
+---------------+  +----------------+  +---------------------+
| Git Server    |  | CI/CD System   |  | Online Judge System |
| Gitea/GitLab  |  | Runner Pipeline|  | Sandbox Evaluator   |
+---------------+  +----------------+  +---------------------+
        |                  |                  |
        v                  v                  v
+------------------------------------------------------------+
|                  Verification Infrastructure               |
| QEMU / KVM / Docker / Firecracker / Formal Tools / Fuzzers |
+------------------------------------------------------------+
                           |
                           v
+------------------------------------------------------------+
|                     Artifact Storage                       |
|    MinIO / S3: 构建产物、日志、磁盘镜像、测试报告、证明文件        |
+------------------------------------------------------------+

+-----------------------------------------------------------------+
|                        Agent Service Layer                      |
|  OpenAI-Compatible API / IDE Agent / Review Agent / Debug Agent |
+-----------------------------------------------------------------+
```

推荐采用模块化部署：

| 模块 | 推荐实现 |
|---|---|
| Web 前端 | Vue / React |
| 后端 | Java 21 + Spring Boot 3.x |
| Git Server | Gitea 或 GitLab |
| CI/CD | Gitea Actions / GitLab CI / Tekton / Argo Workflows |
| Online Judge | 自研 Judge Core + 沙箱 Runner |
| Artifact Storage | MinIO |
| 数据库 | PostgreSQL |
| 缓存 / 队列 | Redis + RabbitMQ / Kafka |
| Agent Gateway | OpenAI-compatible API |
| Runner 隔离 | Docker / Podman / Firecracker / KVM / gVisor |
| OS 实验虚拟化 | QEMU / KVM |
| 形式化验证 | Coq / Lean / Isabelle / TLA+ / CBMC / Kani / SeaHorn |
| 模糊测试 | AFL++ / libFuzzer / syzkaller / 自定义 workload fuzzer |

---

## 3. 核心设计理念

### 3.1 Spec 驱动

平台中的每个实验不是简单地给出固定题目，而是由一组 Spec 描述。

以 VeriSpecOSLab 为例：

```text
ExperimentSpec
 ├── ProblemSpec          问题定义
 ├── DesignSpec           架构设计约束
 ├── GoalSpec             个性化目标
 ├── InterfaceSpec        接口与 ABI 约束
 ├── VerificationSpec     验证要求
 ├── EvaluationSpec       评测指标
 ├── ReportSpec           文档与报告要求
 └── ArtifactSpec         最终提交物要求
```

平台的关键不是要求所有学生写出同一个系统，而是要求学生在可验证的约束下完成一个自洽系统。

对于 VeriSpecOSLab，学生可以选择：

- 类 Unix monolithic kernel；
- microkernel；
- exokernel；
- unikernel；
- capability-based OS；
- seL4-like 结构；
- Linux-like 结构；
- L4-like 结构；
- Darwin/XNU-like 结构；
- NT-like 结构；
- RISC-V / x86_64 / AArch64 架构；
- 专用领域优化，例如嵌入式、云原生、实时系统、教学内核等。

平台不应只提供固定 profile，而应允许学生提交更完整的 **Architecture Description**。

### 3.2 通用实验抽象

为了支持 OS、数据库、编译器等不同实验，平台应抽象出统一模型：

```text
SpecLabProject
 ├── Spec
 ├── StudentDesign
 ├── Repository
 ├── AgentWorkspace
 ├── BuildPipeline
 ├── VerificationPipeline
 ├── JudgeTasks
 ├── Artifacts
 ├── Reports
 └── EvaluationResult
```

VeriSpecOSLab 是一个具体实验类型：

```text
SpecLabProject
 └── type = "verispec-os-lab"
```

数据库实验可以是：

```text
SpecLabProject
 └── type = "spec-db-lab"
```

编译器实验可以是：

```text
SpecLabProject
 └── type = "spec-compiler-lab"
```

---

## 4. 用户角色

### 4.1 管理员

管理员负责：

- 平台配置；
- 用户管理；
- Git / CI / Judge 资源管理；
- Runner 集群管理；
- 安全策略配置。

### 4.2 教师

教师负责：

- 创建课程；
- 创建实验；
- 编写实验 Spec；
- 配置验证规则；
- 配置评测指标；
- 查看学生进度；
- 审核设计文档；
- 发布反馈。

### 4.3 助教

助教负责：

- 查看提交；
- 辅助调试；
- 审核阶段成果；
- 标注评测异常；
- 调整隐藏测试用例。

### 4.4 学生

学生负责：

- 选择实验；
- 提交个性化设计；
- 使用 Agent 辅助开发；
- 推送代码；
- 查看 CI/CD 和 Judge 结果；
- 修复问题；
- 提交最终报告。

### 4.5 Agent

Agent 是平台中的特殊参与者，可以执行：

- 阅读 Spec；
- 解释实验要求；
- 辅助生成设计；
- 审查架构自洽性；
- 生成测试计划；
- 分析 CI 日志；
- 定位 QEMU panic；
- 生成 patch 建议；
- 检查文档完整性；
- 辅助学生准备最终报告。

Agent 不应直接替代学生完成全部实验，而是作为可控、可审计的辅助工具。

---

## 5. 平台核心模块

### 5.1 Experiment Spec 管理模块

该模块负责实验定义。

教师可以创建：

```yaml
id: verispec-oslab-2026
name: VeriSpecOSLab
type: os
description: AI-assisted verifiable OS construction lab

stages:
  - spec-reading
  - architecture-design
  - boot-minimum
  - memory-management
  - process-scheduling
  - syscall-abi
  - filesystem
  - device-driver
  - verification
  - hardware-porting
  - final-report

artifacts:
  - arch.md
  - draft.md
  - design.md
  - verification.md
  - source-code
  - test-report
  - final-report.md
```

#### 5.1.1 ProblemSpec

描述实验要解决的问题。

```yaml
problem:
  title: Build a verifiable teaching operating system
  target: Students should build a complete OS with AI assistance
  expected_outcome:
    - bootable kernel
    - syscall interface
    - user program execution
    - verification report
    - final design documentation
```

#### 5.1.2 DesignSpec

描述设计空间，而不是固定模板。

```yaml
design:
  architecture_description_required: true
  allowed_architectures:
    - monolithic
    - microkernel
    - hybrid
    - exokernel
    - unikernel
    - custom
  required_sections:
    - boot model
    - address space model
    - privilege model
    - syscall model
    - memory model
    - scheduling model
    - IPC model
    - driver model
    - verification boundary
```

#### 5.1.3 GoalSpec

描述学生的个性化目标。

```yaml
goals:
  required:
    - boot_to_userspace
    - run_basic_user_program
    - pass_syscall_tests
  optional:
    - linux_binary_compatibility
    - darwin_syscall_compatibility
    - microkernel_ipc_performance
    - formal_proof_of_allocator
    - hardware_porting
```

#### 5.1.4 VerificationSpec

描述如何验证。

```yaml
verification:
  categories:
    - static_check
    - unit_test
    - integration_test
    - qemu_boot_test
    - syscall_abi_test
    - fuzz_test
    - formal_verification
    - benchmark
```

#### 5.1.5 EvaluationSpec

描述如何评分。

```yaml
evaluation:
  weights:
    design_quality: 20
    implementation: 30
    verification: 25
    documentation: 15
    originality: 10
```

---

### 5.2 学生个性化设计模块

学生在正式开发前需要提交：

```text
arch.md
draft.md
verification-plan.md
```

平台应对这些文件进行结构化解析，并生成个性化验证计划。

#### 5.2.1 arch.md 示例结构

```markdown
# Architecture Design

## 1. Target

- Experiment type: VeriSpecOSLab
- Target ISA: RISC-V 64
- Machine: QEMU virt
- Kernel style: microkernel-inspired monolithic kernel
- Userland goal: minimal POSIX-like environment

## 2. Boot Model

...

## 3. Memory Model

...

## 4. Process Model

...

## 5. Syscall ABI

...

## 6. Filesystem Model

...

## 7. Verification Boundary

...

## 8. Optional Advanced Goal

...
```

平台会将 arch.md 转换为内部模型：

```json
{
  "targetIsa": "riscv64",
  "machine": "qemu-virt",
  "kernelStyle": "microkernel-inspired",
  "syscallAbi": "posix-like",
  "advancedGoal": "binary-compatibility",
  "verificationBoundary": [
    "allocator",
    "syscall-dispatch",
    "user-kernel-memory-copy"
  ]
}
```

然后自动选择适配的 CI/CD 和 Judge 任务。

---

### 5.3 Git Server 模块

平台应内置或集成 Git Server。

推荐方案：

- 轻量部署：Gitea；
- 大型课程部署：GitLab；
- 云原生部署：Gitea + Drone / Woodpecker / Tekton；
- 教学平台深度集成：自研 Backend + Gitea API。

#### 5.3.1 仓库组织方式

```text
spec-lab/
 ├── courses/
 │   └── os-2026/
 │       ├── experiment-template/
 │       ├── testcase-repository/
 │       └── reference-docs/
 │
 ├── students/
 │   └── alice/
 │       └── verispec-oslab-2026/
 │           ├── kernel/
 │           ├── userland/
 │           ├── tests/
 │           ├── docs/
 │           ├── arch.md
 │           ├── draft.md
 │           └── .speclab.yml
 │
 └── submissions/
```

#### 5.3.2 仓库初始化流程

当学生加入实验后，平台自动：

1. 创建 Git 仓库；
2. 从实验模板 fork；
3. 注入 `.speclab.yml`；
4. 注入 CI 配置；
5. 创建默认分支；
6. 设置保护分支；
7. 绑定学生账号；
8. 创建 Agent Workspace；
9. 注册 Judge 项目。

#### 5.3.3 `.speclab.yml` 示例

```yaml
project:
  id: verispec-oslab-2026-alice
  experiment: verispec-oslab-2026
  type: os

target:
  isa: riscv64
  machine: qemu-virt
  boot_protocol: opensbi
  kernel_format: elf

build:
  toolchain: rust-nightly
  commands:
    - cargo build --release

run:
  emulator: qemu-system-riscv64
  args:
    - -machine virt
    - -nographic
    - -bios default
    - -kernel target/riscv64/release/kernel

verify:
  suites:
    - boot
    - memory
    - syscall
    - userland
    - fuzz
```

---

### 5.4 CI/CD 模块

CI/CD 是平台的执行核心。

每次学生 push 后，自动执行：

```text
代码拉取
 → 环境构建
 → 静态检查
 → 编译
 → 单元测试
 → QEMU 启动测试
 → 集成测试
 → ABI 测试
 → fuzz 测试
 → 形式化验证
 → 产物归档
 → 结果上报
 → Agent 分析
```

#### 5.4.1 Pipeline 示例

```yaml
stages:
  - prepare
  - static-check
  - build
  - unit-test
  - boot-test
  - integration-test
  - verification
  - judge
  - report

prepare:
  script:
    - speclab prepare

static-check:
  script:
    - speclab lint
    - speclab check-spec-consistency

build:
  script:
    - speclab build

boot-test:
  script:
    - speclab qemu-boot --timeout 30s

integration-test:
  script:
    - speclab run-test-suite syscall
    - speclab run-test-suite userland

verification:
  script:
    - speclab verify

judge:
  script:
    - speclab submit-judge
```

#### 5.4.2 VeriSpecOSLab CI/CD 任务

| 阶段 | 任务 |
|---|---|
| Static Check | 检查 arch.md、draft.md、代码结构 |
| Build | 构建 kernel、userland、rootfs |
| Boot Test | QEMU 启动到指定日志点 |
| Memory Test | 页表、分配器、用户态隔离 |
| Syscall Test | syscall ABI、参数传递、错误码 |
| Process Test | fork / exec / wait 或自定义进程模型 |
| Filesystem Test | initramfs、VFS、基础文件操作 |
| IPC Test | pipe / message / channel / capability |
| Fuzz Test | syscall fuzz、文件系统 fuzz |
| Formal Check | allocator、scheduler、copy_from_user 等局部验证 |
| Benchmark | boot time、syscall latency、IPC latency |
| Hardware Porting | 物理板卡或仿真板卡启动测试 |

---

### 5.5 Online Judge 模块

CI/CD 偏向持续验证，Online Judge 偏向最终评测和排名。

二者关系：

```text
CI/CD:
  每次 push 自动运行，偏向开发反馈。

Online Judge:
  对阶段性提交或最终提交进行标准化评测，偏向评分。
```

#### 5.5.1 Judge 任务类型

```text
JudgeTask
 ├── BuildJudge
 ├── BootJudge
 ├── FunctionalJudge
 ├── ABIJudge
 ├── FuzzJudge
 ├── FormalJudge
 ├── PerformanceJudge
 ├── SecurityJudge
 └── DocumentationJudge
```

#### 5.5.2 Judge 输入

```json
{
  "submissionId": "sub-001",
  "repository": "git://...",
  "commit": "abc123",
  "experiment": "verispec-oslab-2026",
  "studentDesign": {
    "isa": "riscv64",
    "kernelStyle": "microkernel-inspired",
    "syscallAbi": "posix-like"
  }
}
```

#### 5.5.3 Judge 输出

```json
{
  "score": 86,
  "status": "passed-with-warnings",
  "results": [
    {
      "suite": "boot",
      "score": 10,
      "maxScore": 10,
      "status": "passed"
    },
    {
      "suite": "syscall",
      "score": 18,
      "maxScore": 20,
      "status": "partial",
      "message": "openat error code mismatch"
    },
    {
      "suite": "verification",
      "score": 16,
      "maxScore": 25,
      "status": "partial",
      "message": "allocator proof missing"
    }
  ]
}
```

#### 5.5.4 Judge 沙箱

对于 OS 实验，普通 Docker 沙箱不够，需要多层隔离：

```text
Judge Controller
 └── Runner VM / Firecracker MicroVM
      └── Docker / Podman
           └── QEMU
                └── Student OS
```

安全建议：

| 风险 | 处理 |
|---|---|
| 死循环 | 超时限制 |
| 内存炸弹 | cgroup 限制 |
| QEMU 逃逸 | VM 外层隔离 |
| 恶意网络访问 | 禁用网络或网络命名空间 |
| 产物过大 | artifact size limit |
| 非法系统调用 | seccomp |
| 资源抢占 | runner quota |
| 恶意 CI 脚本 | 受限 runner |

---

## 6. Agent 设计

Agent 是本平台区别于传统 OJ / Git 平台的关键。

### 6.1 Agent 分层

```text
Agent Gateway
 ├── IDE Agent
 ├── Spec Assistant
 ├── Architecture Review Agent
 ├── Code Review Agent
 ├── CI Debug Agent
 ├── Verification Agent
 ├── Judge Explanation Agent
 ├── Report Agent
 └── Teacher Analytics Agent
```

---

### 6.2 Agent Gateway

Agent Gateway 提供 OpenAI-compatible API：

```http
POST /v1/chat/completions
POST /v1/responses
POST /v1/embeddings
GET  /v1/models
```

这样可以接入：

- VS Code；
- JetBrains IDE；
- Continue；
- Cursor-like IDE；
- OpenWebUI；
- 自研 Web IDE；
- CLI Agent；
- GitHub Copilot-compatible 插件；
- Cline / Roo Code 类 Agent。

#### 6.2.1 Agent Gateway 职责

```text
IDE / Web / CLI
   ↓
OpenAI-Compatible Gateway
   ↓
Policy Engine
   ↓
Context Builder
   ↓
Tool Router
   ↓
LLM Provider
   ↓
Audit Logger
```

#### 6.2.2 多模型支持

```yaml
models:
  - id: course-default
    provider: openai-compatible
    endpoint: https://api.example.com/v1
  - id: local-coder
    provider: vllm
    endpoint: http://vllm:8000/v1
  - id: review-model
    provider: openai-compatible
```

#### 6.2.3 Agent 权限控制

Agent 不应默认拥有全部权限。

```text
Agent Permission
 ├── read_spec
 ├── read_repo
 ├── read_ci_log
 ├── write_suggestion
 ├── create_patch
 ├── open_merge_request
 ├── run_test
 ├── submit_judge
 └── modify_score  禁止
```

默认权限策略建议：

| 操作 | 学生 Agent | 教师 Agent |
|---|---:|---:|
| 读取 Spec | 允许 | 允许 |
| 读取学生仓库 | 允许本人 | 允许课程内 |
| 修改代码 | 仅生成 patch | 不建议 |
| 触发 CI | 允许 | 允许 |
| 查看隐藏测试 | 禁止 | 允许 |
| 修改评分 | 禁止 | 人工审核 |
| 读取其他学生代码 | 禁止 | 受控允许 |

---

### 6.3 IDE Agent

IDE Agent 通过 OpenAI-compatible API 接入学生开发环境。

它需要能获得以下上下文：

```text
当前文件
当前选区
仓库结构
实验 Spec
arch.md
draft.md
最近 CI 日志
最近 Judge 结果
错误日志
测试用例摘要
```

示例：学生问：

```text
为什么我的 riscv64 kernel 在 QEMU virt 上启动后没有进入用户态？
```

Agent 可以自动读取：

- `.speclab.yml`；
- QEMU 启动命令；
- CI boot log；
- `arch/riscv/trap.rs`；
- `init/main.rs`；
- 最近失败的 boot test。

然后输出：

```text
问题可能在 satp 切换后没有 flush TLB，建议在写 satp 后执行 sfence.vma。
另外 user trap vector 没有正确设置 stvec。
```

---

### 6.4 Spec Assistant

Spec Assistant 负责解释实验要求。

功能包括：

- 将复杂 Spec 转换为阶段任务；
- 检查学生设计是否缺少必要章节；
- 根据学生目标生成 TODO；
- 提醒哪些要求会影响最终评分。

---

### 6.5 Architecture Review Agent

该 Agent 专门检查 `arch.md` 和 `draft.md`。

检查内容：

```text
架构自洽性
接口一致性
目标与实现路径是否匹配
验证边界是否明确
是否违反实验硬性约束
是否存在不可实现目标
是否存在过度依赖 AI 生成而缺少设计解释
```

例如学生写：

```text
我要实现一个 microkernel，同时所有驱动都运行在内核态，并且用户态直接访问设备 MMIO。
```

Agent 应提示：

```text
你的设计中 microkernel 的隔离目标和驱动内核态设计存在冲突。
如果你希望保留 microkernel 目标，应说明哪些驱动在用户态，如何通过 IPC 与内核交互。
如果只是采用微内核式 IPC 思想，可以改称 microkernel-inspired monolithic design。
```

---

### 6.6 Debug Agent

自动分析日志和测试结果，定位问题根源。

输入：

```text
commit
pipeline id
failed stage
build log
qemu log
serial output
kernel panic trace
judge testcase summary
```

输出失败原因分类：

```text
1. 编译错误
2. 链接脚本错误
3. boot protocol 错误
4. page table 错误
5. trap/exception 错误
6. syscall ABI 错误
7. timeout
8. judge output mismatch
```

对于 OS 实验尤其重要。

示例分析：

```text
QEMU 日志显示进入 S-mode 后发生 instruction page fault。
根据 ELR/SEPC，异常发生在高地址内核入口附近。
可能原因：
- 高半区映射缺失；
- entry.S 中跳转地址与 linker script 不一致；
- satp 切换后未刷新 TLB；
- kernel text 没有 executable flag。
```

---

### 6.7 Verification Agent

该 Agent 用于把学生设计转化为验证计划。

例如学生选择：

```yaml
kernelStyle: microkernel
ipcModel: synchronous message passing
memorySafetyGoal: user-kernel isolation
```

Agent 生成：

```text
建议验证项：
1. 用户态不能读写内核地址；
2. IPC endpoint capability 不可伪造；
3. syscall 参数复制必须经过 copy_from_user；
4. IPC 消息长度必须检查；
5. endpoint revoke 后旧 capability 失效；
6. scheduler 不应永久饿死 runnable task。
```

并生成测试配置：

```yaml
verify:
  generated:
    - user_kernel_isolation
    - invalid_capability
    - ipc_size_limit
    - endpoint_revoke
    - scheduler_fairness
```

---

### 6.8 Report Agent

Report Agent 帮助学生整理最终报告，但需要保留学生主体性，并按 `ArchitectureSeed → ArchitectureSlice[] → SpecPatch[] → FinalArchitectureSynthesis` 的演化线索组织材料。

报告结构：

```markdown
# Final Report

## 1. Project Overview

## 2. Architecture Design

## 3. Implementation

## 4. Verification

## 5. Evaluation

## 6. AI Assistance Log

## 7. Limitations

## 8. Future Work
```

其中 **AI Assistance Log** 很重要，用于记录：

```text
哪些部分由学生完成；
哪些部分由 Agent 辅助；
Agent 提供了哪些建议；
学生如何判断和修改；
每个阶段的设计依据与验证证据是什么。
```

这可以避免实验变成“AI 代写”，而是变成“AI 辅助下的可解释工程实践”。

---

## 7. 验证与评测体系

### 7.1 多层验证模型

平台应支持五层验证：

```text
L0: 文档验证
L1: 静态验证
L2: 构建验证
L3: 功能验证
L4: 行为验证
L5: 形式化 / 安全 / 性能验证
```

### 7.2 文档验证

检查内容：

- `arch.md` 是否完整；
- 是否描述启动流程；
- 是否描述内存模型；
- 是否描述 syscall ABI；
- 是否描述验证边界；
- 是否说明个性化目标；
- 是否说明 AI 使用过程。

### 7.3 静态验证

对代码进行：

- lint；
- forbidden API check；
- unsafe code check；
- linker script check；
- symbol check；
- syscall table check；
- manifest check；
- license check。

### 7.4 构建验证

检查：

- 是否能完整构建；
- 是否生成 kernel image；
- 是否生成 rootfs；
- 是否生成 debug symbol；
- 是否生成测试镜像；
- 是否符合 `.speclab.yml` 声明。

### 7.5 QEMU 功能验证

对于 VeriSpecOSLab，至少包括：

```text
boot_to_kernel_main
boot_to_userspace
hello_user_program
syscall_write
syscall_exit
timer_interrupt
page_fault_handling
process_switch
filesystem_read
```

### 7.6 ABI 验证

如果学生声明兼容某个 ABI，例如：

```yaml
syscallAbi: linux-like
```

则平台运行对应 ABI 测试：

```text
open/read/write/close
mmap/munmap
fork/exec/wait
brk
getpid
nanosleep
pipe
dup
stat
```

如果学生声明自定义 ABI，则要求学生提交：

```text
interface-spec.md
syscall-table.yml
abi-test.yml
```

平台根据接口描述生成或选择测试。

---

### 7.7 个性化目标验证

这是平台最重要的能力之一。

不同学生设计不同，平台不能只使用同一套测试。

应采用：

```text
Base Test Suite + Design-Driven Test Suite + Goal-Specific Test Suite
```

#### 7.7.1 Base Test Suite

所有人都必须通过：

```text
build
boot
basic memory
basic trap
basic syscall
basic user program
documentation
```

#### 7.7.2 Design-Driven Test Suite

由架构设计决定。

| 学生设计 | 自动增加测试 |
|---|---|
| microkernel | IPC、capability、user-space server |
| monolithic | syscall、driver、VFS |
| Linux-like ABI | Linux syscall ABI test |
| Darwin-like ABI | Mach-O / syscall / libSystem subset |
| capability OS | cap revoke、cap transfer、权限隔离 |
| RTOS | interrupt latency、deadline test |
| unikernel | image size、single address space safety |
| multicore | SMP boot、lock、IPI、race test |

#### 7.7.3 Goal-Specific Test Suite

由个性化目标决定。

例如：

```yaml
advancedGoals:
  - binary_compatibility
  - hardware_porting
  - formal_allocator_proof
```

平台增加：

```text
binary compatibility test
hardware boot test
allocator proof check
```

---

## 8. Online Judge 评分设计

### 8.1 基础评分

```yaml
score:
  documentation: 15
  architecture: 20
  implementation: 30
  verification: 20
  evaluation: 10
  originality: 5
```

### 8.2 阶段评分

```text
Stage 1: Spec Understanding        5
Stage 2: Architecture Design       15
Stage 3: Bootable Kernel           15
Stage 4: Memory Management         15
Stage 5: User Program Support      15
Stage 6: Verification              20
Stage 7: Final Report              15
```

### 8.3 个性化加分

```text
Advanced Goal Bonus
 ├── hardware porting
 ├── formal verification
 ├── binary compatibility
 ├── performance optimization
 ├── microkernel IPC
 ├── security isolation
 └── novel architecture
```

### 8.4 避免不公平

个性化目标不同，会导致难度不同。

平台需要给每个目标定义：

```text
difficulty coefficient
risk coefficient
verification confidence
expected workload
```

例如：

```yaml
goals:
  linux_binary_compatibility:
    difficulty: 5
    max_bonus: 15
  hardware_porting:
    difficulty: 4
    max_bonus: 10
  custom_syscall_abi:
    difficulty: 2
    max_bonus: 5
```

---

## 9. 平台数据模型

核心实体如下：

```text
User
Course
Experiment
ExperimentSpec
StudentProject
Repository
DesignSubmission
PipelineRun
JudgeSubmission
JudgeResult
Artifact
AgentSession
AgentMessage
VerificationSuite
VerificationCase
EvaluationRubric
```

### 9.1 Experiment

```json
{
  "id": "verispec-oslab-2026",
  "name": "VeriSpecOSLab",
  "type": "os",
  "courseId": "os-course-2026",
  "specVersion": "1.0.0",
  "status": "published"
}
```

### 9.2 StudentProject

```json
{
  "id": "proj-alice-verispecoslab",
  "studentId": "alice",
  "experimentId": "verispec-oslab-2026",
  "repositoryId": "repo-001",
  "designStatus": "approved",
  "currentStage": "memory-management",
  "score": 72
}
```

### 9.3 DesignSubmission

```json
{
  "id": "design-001",
  "projectId": "proj-alice-verispecoslab",
  "archDoc": "s3://artifacts/arch.md",
  "draftDoc": "s3://artifacts/draft.md",
  "parsedDesign": {
    "isa": "riscv64",
    "kernelStyle": "microkernel-inspired",
    "syscallAbi": "posix-like"
  },
  "reviewResult": {
    "status": "approved-with-suggestions",
    "warnings": [
      "IPC verification boundary is not precise enough"
    ]
  }
}
```

### 9.4 JudgeResult

```json
{
  "id": "judge-result-001",
  "submissionId": "sub-001",
  "score": 86,
  "status": "passed",
  "details": [
    {
      "case": "boot_to_userspace",
      "status": "passed",
      "score": 10
    }
  ]
}
```

---

## 10. API 设计

### 10.1 实验管理 API

```http
POST /api/experiments
GET  /api/experiments
GET  /api/experiments/{id}
PUT  /api/experiments/{id}
POST /api/experiments/{id}/publish
```

### 10.2 学生项目 API

```http
POST /api/experiments/{id}/join
GET  /api/projects/{projectId}
GET  /api/projects/{projectId}/progress
POST /api/projects/{projectId}/submit-design
POST /api/projects/{projectId}/submit-final
```

### 10.3 Git 集成 API

```http
POST /api/projects/{projectId}/repo/init
GET  /api/projects/{projectId}/repo
POST /api/projects/{projectId}/repo/sync
```

### 10.4 CI/CD API

```http
POST /api/projects/{projectId}/pipelines/run
GET  /api/projects/{projectId}/pipelines
GET  /api/pipelines/{pipelineId}
GET  /api/pipelines/{pipelineId}/logs
```

### 10.5 Judge API

```http
POST /api/projects/{projectId}/judge/submit
GET  /api/projects/{projectId}/judge/results
GET  /api/judge/results/{resultId}
```

### 10.6 Agent API

```http
POST /api/agent/sessions
POST /api/agent/sessions/{id}/messages
GET  /api/agent/sessions/{id}
POST /api/agent/analyze-ci
POST /api/agent/review-design
POST /api/agent/generate-verification-plan
```

### 10.7 OpenAI-Compatible API

```http
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses
POST /v1/embeddings
```

---

## 11. 工作流设计

### 11.1 教师创建实验

```text
教师创建课程
 → 创建实验
 → 编写 ExperimentSpec
 → 上传模板仓库
 → 配置基础测试
 → 配置隐藏测试
 → 配置评分规则
 → 发布实验
```

### 11.2 学生加入实验

```text
学生加入实验
 → 平台创建项目
 → 创建 Git 仓库
 → fork 模板
 → 生成 .speclab.yml
 → 创建 Agent Workspace
 → 创建 CI/CD Pipeline
 → 初始化 Judge 项目
```

### 11.3 学生提交阶段设计

```text
学生提交 ArchitectureSeed
 → 平台创建 ArchitectureEvolutionTimeline
 → 教师/助教审核初始方向
 → 发布 StageGate
 → 学生提交当前阶段的 ArchitectureSlice
 → Agent 检查阶段设计一致性
 → 绑定 ModuleSpec / InterfaceSpec / ConcurrencySpec
 → 生成阶段验证计划
 → 更新 CI/CD 配置
 → 解锁对应实现任务
```

### 11.4 学生开发与验证

```text
学生 push 代码与阶段规格
 → Git webhook 触发 CI
 → Runner 构建项目
 → 运行基础测试
 → 运行当前阶段测试
 → 运行累计回归测试
 → 运行设计驱动测试
 → 运行个性化目标测试
 → 存储日志和产物
 → Agent 分析失败原因
 → 学生查看反馈
```

### 11.5 最终提交

```text
学生提交 FinalArchitectureSynthesis 与 final report
 → 平台冻结 commit
 → Online Judge 标准评测
 → 生成评分报告
 → Agent 生成评测解释
 → 教师复核
 → 发布最终成绩
```

---

## 12. 对 VeriSpecOSLab 的具体适配

### 12.1 项目结构

```text
verispec-oslab/
 ├── kernel/
 ├── userland/
 ├── boot/
 ├── drivers/
 ├── fs/
 ├── tests/
 ├── formal/
 ├── docs/
 │   ├── arch.md
 │   ├── draft.md
 │   ├── verification.md
 │   └── final-report.md
 ├── scripts/
 ├── rootfs/
 ├── .speclab.yml
 └── README.md
```

### 12.2 OS 实验 Runner

```text
OS Judge Runner
 ├── Build kernel
 ├── Build userland
 ├── Build rootfs
 ├── Launch QEMU
 ├── Capture serial log
 ├── Detect boot marker
 ├── Inject test commands
 ├── Collect output
 ├── Compare expected behavior
 ├── Save disk image
 └── Generate report
```

### 12.3 Boot Marker 机制

学生内核需要输出标准标记：

```text
[SPECLAB] kernel_init
[SPECLAB] memory_ready
[SPECLAB] scheduler_ready
[SPECLAB] userland_start
[SPECLAB] test_pass: syscall_write
```

Judge 通过串口日志判断进度。

### 12.4 用户态测试协议

可以设计一个简单 test harness：

```text
/init
/bin/hello
/bin/syscall_test
/bin/mem_test
/bin/fs_test
/bin/ipc_test
```

内核启动后执行：

```text
/init --speclab-test
```

输出：

```text
[SPECLAB-TEST] write: PASS
[SPECLAB-TEST] exit: PASS
[SPECLAB-TEST] fork: PASS
[SPECLAB-TEST] fs_read: PASS
```

---

## 13. 对其他 SpecLab 实验的泛化

### 13.1 数据库实验

```text
SpecDBLab
 ├── SQL parser
 ├── storage engine
 ├── transaction
 ├── WAL
 ├── recovery
 ├── index
 ├── query optimizer
 └── benchmark
```

Judge 可测试：

```text
SQL correctness
transaction isolation
crash recovery
TPC-like workload
index performance
```

### 13.2 编译器实验

```text
SpecCompilerLab
 ├── lexer
 ├── parser
 ├── semantic analysis
 ├── IR
 ├── optimization
 ├── codegen
 └── runtime
```

Judge 可测试：

```text
语法正确性
语义错误检测
IR 合法性
优化正确性
目标代码运行结果
性能
```

### 13.3 网络协议栈实验

```text
SpecNetLab
 ├── Ethernet
 ├── ARP
 ├── IP
 ├── ICMP
 ├── UDP
 ├── TCP
 └── socket API
```

Judge 可测试：

```text
packet trace
协议状态机
异常包处理
吞吐量
延迟
```

---

## 14. 推荐部署架构

### 14.1 单机教学部署

适合小班课程。

```text
Docker Compose
 ├── frontend
 ├── backend
 ├── postgres
 ├── redis
 ├── gitea
 ├── minio
 ├── runner
 ├── judge
 └── agent-gateway
```

优点：

- 部署简单；
- 成本低；
- 适合课程原型。

缺点：

- 并发有限；
- 安全隔离较弱；
- Runner 资源紧张。

### 14.2 集群部署

适合大班课程。

```text
Kubernetes
 ├── speclab-backend
 ├── speclab-frontend
 ├── gitea/gitlab
 ├── postgres
 ├── redis
 ├── minio
 ├── ci-controller
 ├── judge-controller
 ├── runner-pool
 ├── qemu-runner-pool
 ├── firecracker-runner-pool
 └── agent-gateway
```

优点：

- 可扩展；
- 多租户；
- 安全隔离更强；
- 适合大型课程。

---

## 15. 安全与学术诚信

### 15.1 安全隔离

必须考虑：

```text
恶意代码
恶意 kernel
恶意 CI 脚本
Runner 逃逸
网络扫描
资源耗尽
隐藏测试泄露
其他学生代码泄露
```

建议：

- 每次评测使用干净镜像；
- Runner 无长期凭证；
- 禁止访问内网；
- 隐藏测试只在 Judge 内部挂载；
- 限制网络；
- 限制 CPU、内存、磁盘、时间；
- 使用 VM 包裹容器；
- 记录所有 Agent 和 CI 操作。

### 15.2 AI 使用审计

每个 Agent 会话保存：

```text
prompt
context summary
tool calls
generated patch
student accepted/rejected status
final diff
```

最终报告中要求学生说明：

```text
AI 帮助了什么；
自己理解了什么；
如何验证 AI 生成内容；
哪些代码/设计由自己修改；
哪些建议被拒绝以及原因。
```

---

## 16. 最小可行版本 MVP

建议先实现 MVP，而不是一开始做完整平台。

### 16.1 MVP 模块

```text
1. 用户与课程管理
2. 实验 Spec 管理
3. Gitea 仓库自动创建
4. 基础 CI/CD Runner
5. QEMU Boot Judge
6. Artifact 存储
7. Agent Gateway
8. CI 日志分析 Agent
9. 学生项目看板
10. 教师评测看板
```

### 16.2 MVP 工作流

```text
教师发布 VeriSpecOSLab
 → 学生加入
 → 自动创建仓库
 → 学生提交 arch.md
 → Agent 审查设计
 → 学生 push kernel
 → CI 自动构建
 → QEMU 自动启动
 → Judge 检查串口输出
 → Agent 分析失败日志
 → 教师查看结果
```

---

## 17. 推荐目录结构

平台主仓库可以设计为：

```text
speclab-platform/
 ├── backend/
 │   ├── speclab-api/
 │   ├── speclab-agent/
 │   ├── speclab-judge/
 │   ├── speclab-ci/
 │   └── speclab-common/
 │
 ├── frontend/
 │   └── speclab-web/
 │
 ├── runner/
 │   ├── docker-runner/
 │   ├── qemu-runner/
 │   ├── firecracker-runner/
 │   └── formal-runner/
 │
 ├── templates/
 │   ├── verispec-oslab/
 │   ├── spec-db-lab/
 │   └── spec-compiler-lab/
 │
 ├── specs/
 │   ├── experiment-schema.json
 │   ├── design-schema.json
 │   ├── judge-schema.json
 │   └── pipeline-schema.json
 │
 ├── deploy/
 │   ├── docker-compose.yml
 │   └── k8s/
 │
 └── docs/
     ├── architecture.md
     ├── api.md
     ├── runner.md
     ├── judge.md
     └── agent.md
```

---

## 18. 推荐最终架构抽象

可以将平台抽象为四条主线：

```text
Spec Line:
  ExperimentSpec → StudentDesign → VerificationPlan

Code Line:
  Git Repo → CI/CD → Artifacts

Judge Line:
  Submission → Sandbox → Test Suites → Score

Agent Line:
  Spec Context → Repo Context → CI Context → Feedback
```

最终形成闭环：

```text
Spec
 ↓
Design
 ↓
Implementation
 ↓
CI/CD
 ↓
Online Judge
 ↓
Agent Feedback
 ↓
Design / Code Improvement
 ↓
Final Evaluation
```

---

## 19. 总结

这套平台的核心不是简单地把 Git、CI 和 OJ 拼在一起，而是建立一个 **Spec 驱动的实验操作系统**：

```text
Spec 决定目标；
Design 决定个性化架构；
Git 管理实现；
CI/CD 持续验证；
Online Judge 标准评测；
Agent 连接 Spec、代码、日志和反馈；
教师通过平台管理实验过程；
学生通过平台完成可解释、可验证、可评估的系统构建。
```

对于 VeriSpecOSLab，它可以支撑：

- AI 辅助的一人 OS 构建；
- 个性化 OS 架构设计；
- 自动化 QEMU 验证；
- syscall ABI 测试；
- 形式化验证实验；
- 硬件移植里程碑；
- 最终设计文档与实验报告；
- AI 使用过程审计。

同时，它也可以自然扩展到：

- Spec 驱动数据库实验；
- Spec 驱动编译器实验；
- Spec 驱动网络协议栈实验；
- Spec 驱动虚拟机 / 运行时实验；
- Spec 驱动分布式系统实验。

---


```text
request
  ↓
identify student / project / current_stage
  ↓
load stage gate and stage artifacts
  ↓
load relevant slices, specs, tests, logs
  ↓
route to proper Agent
  ↓
record stage-aware audit log
```

完整教师 / 学生操作流程见 `workflow.md`。
