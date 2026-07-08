# SpecLab 平台扩展：面向其他 Spec 驱动实验项目的未来方向

## 1. 扩展动机

VeriSpecOSLab 的开发环境与 Agent 架构不仅适用于操作系统实验，也可以抽象为一个通用的 **Spec-Driven Lab Platform**。

该平台可用于所有具有以下特征的系统类实验项目：

```text
1. 系统状态复杂
2. 模块边界清晰
3. 正确性可由规格描述
4. 可以通过测试、验证器、oracle、benchmark 或 trace 评估
5. 需要 AI 辅助但不能让 AI 脱离约束直接代写
```

因此，VeriSpecOSLab 可以升级为：

```text
SpecLab Platform
  ├── SpecOSLab / VeriSpecOSLab
  ├── SpecDBLab
  ├── SpecLangLab
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

---

## 2. 通用平台抽象

平台可拆成两层：

```text
SpecLab Core
  - OpenAI-compatible Agent Gateway
  - Project Course Runtime
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

也就是说，以下部分是通用的：

```text
- Agent Gateway
- OpenAI-compatible IDE 接入
- Course Runtime / Sandbox
- 日志审计
- 测试矩阵
- 报告生成
- 评分框架
- 个性化目标合约
```

不同课程只替换领域插件。

通用项目声明：

```yaml
ProjectSpec:
  domain: database | compiler | os | runtime | network | hardware
  profile: ...
  goals: ...
  modules: ...
  verification:
    base_suite: ...
    profile_suite: ...
    goal_suite: ...
```

---

## 3. 通用规格模板

OS 中的模块规格通常包括：

```text
Module
Purpose
State
Interface
Preconditions
Postconditions
Invariants
Rely
Guarantee
Concurrency
Test Obligations
```

可以泛化为：

```yaml
ModuleSpec:
  name:
  domain:
  purpose:
  state:
  interface:
  preconditions:
  postconditions:
  invariants:
  assumptions:
  guarantees:
  dependencies:
  concurrency:
  persistence:
  error_cases:
  performance_intent:
  test_obligations:
  patch_history:
```

不同领域启用不同字段：

```text
OS:
  concurrency / isolation / hardware_state / interrupt / syscall

Database:
  persistence / transaction / recovery / isolation / index_invariant

Compiler:
  semantic_preservation / IR_invariant / type_rule / pass_precondition

Network:
  protocol_state / packet_format / timeout / retry / security_property

Runtime / VM:
  object_model / bytecode_safety / GC_invariant / stack_frame / JIT_guard

Hardware / Architecture:
  ISA_semantics / pipeline_invariant / memory_model / trace_equivalence
```

---

## 4. SpecDBLab：Spec 驱动数据库实验

### 4.1 适用性

数据库非常适合 Spec 驱动实验，因为数据库系统具有复杂状态、并发、持久化、恢复、事务隔离和性能优化需求。

可选路线：

```text
SpecDBLab:
  - KV Store 路线
  - Relational DB 路线
  - LSM-tree 路线
  - B+Tree Storage Engine 路线
  - Transactional DB 路线
  - Distributed DB 路线
  - HTAP / Column Store 路线
```

### 4.2 数据库模块规格示例

```yaml
ModuleSpec:
  name: BPlusTreeIndex

State:
  - root_page
  - internal_pages
  - leaf_pages
  - page_latches
  - free_list

Interface:
  - get(key) -> value | NOT_FOUND
  - insert(key, value) -> OK | DUPLICATE
  - delete(key) -> OK | NOT_FOUND
  - scan(start, end) -> iterator

Invariants:
  - all leaves have the same depth
  - keys in each node are sorted
  - internal separator keys correctly partition children
  - every non-root node occupancy >= min_degree
  - leaf sibling links preserve global key order

Concurrency:
  - latch coupling during traversal
  - split must not expose unreachable page
  - reader must not observe half-applied split

Persistence:
  - dirty page must be written through buffer manager
  - pageLSN <= durableLSN before eviction if WAL is enabled

TestObligations:
  - random insert/delete/get
  - range scan correctness
  - split/merge boundary case
  - crash during split
  - concurrent insert/read stress
```

### 4.3 数据库验证矩阵

```text
BaseDBTestSuite:
  - SQL parser smoke test 或 KV API smoke test
  - storage page read/write
  - buffer pool pin/unpin
  - index insert/get/delete
  - scan order correctness
  - transaction commit/abort
  - crash recovery smoke test

ProfileTestSuite:
  B+Tree:
    - split/merge
    - range scan
    - random operation oracle compare

  LSM:
    - memtable flush
    - compaction correctness
    - tombstone semantics

  Transaction:
    - lost update
    - dirty read
    - write skew optional
    - deadlock detection optional

  Distributed:
    - leader election
    - log replication
    - network partition
```

### 4.4 数据库个性化目标合约

```yaml
GoalValidationContract:
  goal_id: wal-crash-recovery
  category: correctness

  property:
    - committed transactions survive crash
    - aborted transactions do not appear after recovery
    - no torn page exposes invalid index state

  oracle:
    - reference kv-store
    - operation log replay checker

  tests:
    - crash_before_commit
    - crash_after_commit_before_checkpoint
    - crash_during_btree_split
    - random_crash_fuzz
```

### 4.5 数据库 Agent

```text
SpecDBAgent:
  - SchemaSpecAssistant
  - storage-engine implementer identity
  - TransactionValidatorAgent
  - QueryPlanExplainAgent
  - CrashFuzzAgent
  - BenchmarkAgent
```

---

## 5. SpecLangLab：Spec 驱动编译器实验

### 5.1 适用性

编译器天然具有分阶段 pipeline，每个 pass 都可以写 precondition、postcondition 和 invariant。

编译器还具有丰富的验证 oracle：

```text
- 源语言解释器
- IR 解释器
- IR verifier
- 参考编译器
- differential testing
- before/after semantic equivalence
- ABI 测试
```

可选路线：

```text
SpecLangLab:
  - Tiger / SysY / MiniC 编译器
  - LLVM IR backend 路线
  - 自定义 IR + 自定义 backend
  - JIT 编译器路线
  - 优化编译器路线
  - 形式化语义小语言路线
```

### 5.2 类型检查模块规格示例

```yaml
ModuleSpec:
  name: TypeChecker

Input:
  - AST

Output:
  - TypedAST
  - TypeError

Preconditions:
  - AST is syntactically valid
  - symbol table contains built-in types and functions

Postconditions:
  - every expression in TypedAST has a type
  - every variable reference resolves to exactly one declaration
  - invalid program returns deterministic diagnostic

Invariants:
  - no unbound variable in TypedAST
  - function call argument types match signature
  - assignment target must be assignable
  - control-flow statement must appear in valid context

TestObligations:
  - valid expression typing
  - invalid type mismatch
  - nested scope shadowing
  - recursive function declaration
```

### 5.3 优化 Pass 规格示例

```yaml
ModuleSpec:
  name: ConstantPropagationPass

Input:
  - CFG in SSA form

Preconditions:
  - IR passes SSA verifier
  - dominance tree is valid

Postconditions:
  - transformed IR passes SSA verifier
  - observable behavior is equivalent to input IR
  - constants are substituted where lattice result is CONST

Invariants:
  - no use before def
  - phi operands match predecessor blocks
  - terminators remain valid
  - side-effecting instructions are not removed unless proven dead

TestObligations:
  - before/after interpreter equivalence
  - random IR differential test
  - SSA verifier
  - optimization effectiveness metric
```

### 5.4 编译器验证矩阵

```text
BaseCompilerTestSuite:
  - lexer golden tests
  - parser golden tests
  - AST snapshot tests
  - type checker positive/negative tests
  - IR verifier
  - interpreter equivalence
  - codegen smoke test

ProfileTestSuite:
  LLVM Backend:
    - generated LLVM IR passes opt/lli
    - clang-compatible ABI smoke test

  Custom Backend:
    - assembly builds
    - calling convention tests
    - stack frame tests

  Optimization:
    - before/after semantic equivalence
    - optimization metric
    - no invalid IR

  JIT:
    - runtime code execution
    - deoptimization optional
    - memory safety checks
```

### 5.5 编译器个性化目标合约

```yaml
GoalValidationContract:
  goal_id: loop-invariant-code-motion
  category: optimization

  correctness:
    - transformed program is semantically equivalent
    - side-effecting operations are not hoisted incorrectly
    - dominance and loop invariants hold

  oracle:
    - source interpreter
    - IR interpreter
    - differential test against unoptimized backend

  metrics:
    - dynamic_instruction_count_reduction
    - benchmark_runtime_improvement

  tests:
    - simple_loop
    - nested_loop
    - loop_with_call
    - loop_with_memory_alias
```

### 5.6 编译器 Agent

```text
LanguagePipelineAgentIdentity:
  - GrammarSpecAssistant
  - TypeSystemAgent
  - ir-pass implementer identity
  - IRValidatorAgent
  - DifferentialTestAgent
  - BackendDebugAgent
```

---

## 6. 其他可扩展领域

### 6.1 SpecNetLab：网络协议实验

可用于 TCP-like 协议、可靠传输、路由协议、RPC 协议、QUIC-like 协议等。

关键规格：

```text
- packet format
- protocol state machine
- timeout / retry
- congestion control
- ordering guarantee
- security property
```

验证方式：

```text
- packet trace comparison
- protocol state model checking
- fuzzing
- simulated packet loss / reorder / duplication
- interoperability test
```

### 6.2 SpecRuntimeLab：运行时与虚拟机实验

可用于字节码 VM、GC、JIT、协程运行时、语言运行时等。

关键规格：

```text
- bytecode semantics
- object model
- stack frame layout
- type safety
- GC root invariant
- write barrier rule
- JIT guard condition
```

验证方式：

```text
- bytecode verifier
- interpreter/JIT differential testing
- GC stress test
- memory safety checker
- runtime benchmark
```

### 6.3 SpecHWLab：体系结构与硬件实验

可用于 ISA 模拟器、流水线 CPU、cache、MMU、总线协议等。

关键规格：

```text
- ISA semantics
- pipeline invariant
- hazard rule
- memory consistency
- cache coherence
- MMU translation rule
```

验证方式：

```text
- instruction trace comparison
- reference simulator differential testing
- riscv-tests / arch tests
- formal model checking
- waveform assertion
```

---

## 7. 不同领域的验证差异

| 领域 | 核心状态 | 主要风险 | 主要验证手段 |
|---|---|---|---|
| OS | 内存、执行流、硬件状态、权限 | 隔离失败、并发错误、异常路径 | QEMU、trap trace、invariant、syscall test |
| 数据库 | 页面、索引、事务、日志 | 数据丢失、并发异常、恢复错误 | oracle compare、crash fuzz、事务隔离测试 |
| 编译器 | AST、符号表、IR、CFG、机器码 | 语义不保持、错误优化、ABI 错误 | differential testing、IR verifier、解释器等价 |
| 网络协议 | 状态机、包序列、超时 | 协议状态错误、重传错误、安全问题 | model checking、packet trace、fuzz |
| 运行时/VM | 对象、栈、GC、字节码 | GC 错误、类型安全破坏、JIT 错误 | bytecode verifier、GC stress、differential test |
| 硬件/体系结构 | ISA 状态、流水线、cache、内存模型 | 状态转移错误、hazard、coherence 错误 | trace compare、形式化检查、仿真测试 |

因此，平台应采用：

```text
通用平台一致
领域规格不同
验证 oracle 不同
评分 rubric 不同
Agent policy 不同
```

---

## 8. SpecLab 工程结构

建议工程组织如下：

```text
speclab/
  core/
    gateway/
    agent_runtime/
    spec_engine/
    test_matrix/
    report_engine/
    audit_log/
    scoring/

  domains/
    os/
      spec_templates/
      agents/
      tests/
      benchmarks/
      rubrics/

    database/
      spec_templates/
      agents/
      tests/
      crash_fuzz/
      benchmarks/
      rubrics/

    compiler/
      spec_templates/
      agents/
      tests/
      ir_verifier/
      differential/
      benchmarks/
      rubrics/

    network/
      spec_templates/
      agents/
      packet_fuzz/
      model_check/
      rubrics/

    runtime/
      spec_templates/
      agents/
      bytecode_verifier/
      gc_stress/
      rubrics/

    hardware/
      spec_templates/
      agents/
      trace_compare/
      waveform_assert/
      rubrics/
```

学生项目声明示例：

```yaml
ProjectManifest:
  course: database
  domain: database
  profile: bplustree-transactional
  language: rust
  goals:
    - wal-crash-recovery
    - concurrent-btree
```

平台自动选择：

```text
database base tests
+ bplustree profile tests
+ transactional profile tests
+ wal-crash-recovery goal tests
+ concurrent-btree stress tests
```

---

## 9. 跨课程连续化教学设想

SpecLab 可以形成系统软件课程群的连续训练链：

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

这样课程成果不再是一次性作业，而可以逐步累积为系统工程 portfolio。

---

## 10. 扩展时需要注意的边界

不能把所有领域都硬套 OS 风格模板。

领域特有要求：

```text
数据库：
  必须加入 crash consistency、transaction isolation、durability、oracle replay。

编译器：
  必须加入 semantic preservation、IR validity、differential testing、ABI convention。

硬件/体系结构：
  必须加入 ISA spec、pipeline invariant、memory model、仿真 trace。

网络协议：
  必须加入 protocol state machine、timeout/retry、packet fuzz、互操作测试。

运行时/VM：
  必须加入 GC invariant、bytecode verifier、JIT/interpreter differential testing。
```

扩展原则：

```text
1. 复用平台，不复用所有规格字段。
2. 复用 Agent Gateway，不复用所有 Agent 策略。
3. 复用测试矩阵机制，不复用具体 oracle。
4. 复用日志和评分框架，但每个领域有独立 rubric。
```

---

## 11. 未来演进路线

### 阶段一：SpecOSLab 稳定化

```text
- 完成 OS 课程运行环境
- 完成 OpenAI-compatible Agent Gateway
- 完成 OS profile 测试矩阵
- 完成 AICollaborationLog
- 完成基础评分报告
```

### 阶段二：抽象 SpecLab Core

```text
- 抽离 core/gateway
- 抽离 core/spec_engine
- 抽离 core/test_matrix
- 抽离 core/report_engine
- 抽离 core/scoring
```

### 阶段三：实现 SpecDBLab 插件

```text
- B+Tree / LSM / Transaction profile
- crash fuzz
- oracle replay
- benchmark runner
- DB-specific Agent
```

### 阶段四：实现 SpecLangLab 插件

```text
- Lexer / Parser / TypeChecker / IR / Backend profile
- IR verifier
- differential testing
- optimization benchmark
- Compiler-specific Agent
```

### 阶段五：课程群集成

```text
- OS + Compiler + DB + Network + Runtime 互操作
- 学生项目跨课程延续
- 统一 portfolio 报告
- 统一教学评价平台
```

---

## 12. 总结

VeriSpecOSLab 的架构可以推广为 **SpecLab：面向系统软件课程群的规格驱动 AI 协作实验平台**。

其中：

```text
VeriSpecOSLab 是 OS 插件实例。
SpecDBLab 是数据库插件实例。
SpecLangLab 是编译器插件实例。
SpecRuntimeLab、SpecNetLab、SpecHWLab 是后续扩展方向。
```

数据库和编译器尤其适合继承该平台：

```text
数据库：
  状态复杂、并发复杂、持久化复杂，适合 spec + invariant + crash fuzz。

编译器：
  pipeline 清晰、pass 边界明确、oracle 丰富，适合 spec + verifier + differential testing。
```

最终目标是形成一个通用的系统软件实验平台，使学生在不同课程中都围绕同一套方法训练：

```text
定义规格
约束 AI
生成实现
运行验证
分析反馈
修正规格
积累系统工程能力
```

---

## 13. SpecLab 通用递进式设计范式

VeriSpecOSLab 采用递进式个性化设计，这一机制也应成为 SpecLab Platform 的通用范式。

通用流程为：

```text
ProjectSeed
  ↓
StageDesignSlice[]
  ↓
ModuleSpec / InterfaceSpec / ConcurrencySpec
  ↓
StageValidationBinding
  ↓
SpecPatch-based Evolution
  ↓
FinalDesignSynthesis
```

不同领域的递进式切片示例：

```text
OS:
  boot → memory → trap → execution → syscall/IPC → resource → file/service

Database:
  storage page → buffer pool → index → transaction → WAL/recovery → crash fuzz → benchmark

Compiler:
  lexer/parser → AST → type checker → IR → optimization pass → backend → ABI/runtime

Network:
  packet format → state machine → timeout/retry → reliability → congestion/security → trace validation

Runtime:
  bytecode → stack frame → object model → GC → verifier → JIT/runtime optimization

Hardware:
  ISA semantics → decoder → single-cycle execution → pipeline → hazard → cache/MMU → trace compare
```

因此，SpecLab 的平台抽象不应只支持“一次性 StudentDesign”，而应支持：

```text
ProgressiveDesignTimeline
StageDesignSlice
DesignDecisionRecord
StageValidationBinding
SpecPatch
FinalDesignSynthesis
```

完整教师 / 助教 / 学生操作流程见 [`workflow/README.md`](./workflow/README.md)。

# CaseLab：AI辅助下的真实案例驱动的操作系统实验设计方案

## ——基于 Agent 自动生成、QEMU 真实运行与 OJ/CTF 分阶段验证的实验体系

---

## 1. 文档定位

本文档整理一种用于替代传统操作系统实验的设计方案。该方案以真实安全案例、系统事故或 CVE 漏洞为牵引，由 Agent 根据教师给出的案例材料与课堂教学目标自动生成实验内容；学生通过编写 solver 在 QEMU 虚拟化环境中完成实验任务，并通过类似 OJ/CTF 的平台进行自动验证。

本文重点关注：

- 实验设计思路；
- 系统整体流程；
- 与传统 OS 实验相比的创新点；
- CopyFail 等真实案例如何转化为教学实验；
- 更多基础 OS 实验的可行方案；
- 平台安全边界与落地路径。

---

## 2. 设计背景

传统操作系统实验通常围绕固定知识点展开，例如：

- 编写 `fork()` / `exec()` 示例程序；
- 实现简单调度算法；
- 调用 pipe、mmap、信号、文件系统接口；
- 编写简化内存管理或文件系统模块；
- 完成实验报告并由教师人工检查。

这类实验能够帮助学生接触 OS API 或基本原理，但存在一些明显问题：

1. **知识点相对孤立**  
   学生知道某个 API 怎么调用，却不容易理解这些机制在真实系统中的作用。

2. **与真实案例关联弱**  
   课堂内容和真实世界中的漏洞、事故、系统故障之间缺少桥梁。

3. **验证方式偏静态**  
   很多实验依赖报告、截图或简单输出，难以判断学生是否真的理解了机制。

4. **环境一致性差**  
   不同学生的本地系统、内核版本、库版本不同，容易导致实验结果不可复现。

5. **实验更新慢**  
   当出现新的 CVE、生产事故或安全研究案例时，很难在短时间内转化为教学实验。

因此，本方案希望将传统 OS 实验升级为：

> **真实案例驱动、Agent 自动生成、QEMU 真实运行、solver 自动验证、分阶段引导理解的操作系统实验体系。**

---

## 3. 总体设计思路

### 3.1 核心目标

教师不再手工编写完整实验，而是提供：

```yaml
case:
  name: 真实案例名称
  type: CVE / 系统事故 / 安全研究 / 工程故障
  materials:
    - 公告
    - 补丁
    - 技术分析
    - PoC引用
    - 事故复盘

teaching_goals:
  - 希望学生理解的 OS 知识点
  - 希望学生掌握的系统行为
  - 希望学生完成的观察、诊断或修复任务

constraints:
  - 课时
  - 难度
  - 安全边界
  - 是否允许真实 PoC
  - 是否需要 QEMU 隔离
```

Agent 根据这些输入自动生成：

```yaml
lab:
  concept_graph:
    - 案例对应的 OS 概念图

  qemu_images:
    - vulnerable 环境
    - fixed 环境
    - mitigated 环境
    - simulator 环境

  challenges:
    - 分阶段题目
    - hint
    - flag 规则
    - solver 接口

  checkers:
    - 自动判题脚本
    - evidence 验证逻辑
    - 安全边界检查逻辑

  teacher_materials:
    - 教师讲解材料
    - 案例到知识点的映射
    - 风险说明
    - 参考 solver
```

学生提交的不是传统报告，而是：

```text
solver.py / solve.sh
evidence.json
trace.log
fix.patch
```

平台自动完成：

```text
启动 QEMU VM
注入随机 nonce
执行学生 solver
收集 evidence
运行 checker
验证 vuln/fixed/mitigated 环境中的行为差异
返回分数与反馈
```

---

## 4. 系统整体架构

```text
教师输入
  ├─ 真实案例：CVE / 事故复盘 / 安全研究 / patch / advisory
  ├─ 教学目标：进程、内存、文件系统、权限、虚拟化、网络、同步
  └─ 约束条件：课时、难度、安全级别、是否开放 PoC

        ↓

Agent 实验生成器
  ├─ 案例解析
  ├─ OS 概念映射
  ├─ 风险分级
  ├─ 教学抽象
  ├─ 阶段化命题
  ├─ QEMU 镜像生成
  ├─ checker 生成
  ├─ 参考 solver 生成
  └─ 教师材料生成

        ↓

实验运行平台
  ├─ QEMU/KVM
  ├─ qcow2 快照
  ├─ OJ/CTF 判题系统
  ├─ 动态 flag
  ├─ 日志采集
  └─ 结果反馈

        ↓

学生
  ├─ 阅读案例背景
  ├─ 编写 solver
  ├─ 观察系统行为
  ├─ 完成阶段任务
  ├─ 修复 toy target
  └─ 提交 evidence

        ↓

自动验证
  ├─ 正例验证：vuln 环境中问题可观察
  ├─ 反例验证：fixed 环境中问题消失
  ├─ 边界验证：不攻击真实系统组件
  ├─ 理解验证：解释命中 OS 概念
  └─ 回归验证：修复不破坏正常功能
```

---

## 5. 实验生成流程

### 5.1 真实案例解析

Agent 首先解析教师提供的真实案例材料，抽取以下信息：

- 案例类型：漏洞、事故、配置错误、性能故障、可靠性故障；
- 影响范围：本地提权、远程执行、数据丢失、服务不可用、隔离失效；
- 相关组件：内核、libc、shell、文件系统、容器运行时、网络栈；
- 触发路径：系统调用、配置、输入文件、网络包、环境变量；
- 修复方式：补丁、配置、禁用模块、限制权限、输入校验；
- 可教学化程度：是否适合直接复现，是否需要降级为 toy target。

### 5.2 OS 概念映射

将真实案例映射到 OS 课程知识点。例如：

| 真实案例类型 | 可映射的 OS 知识点 |
|---|---|
| 本地提权漏洞 | 权限模型、setuid、capability、系统调用、内核对象 |
| 文件覆盖漏洞 | 路径解析、inode、符号链接、open、fstat、TOCTOU |
| 容器逃逸 | namespace、cgroup、mount、procfs、共享内核 |
| 数据丢失事故 | 文件系统语义、fsync、rename 原子性、快照、WAL |
| CPU 故障 | 调度、cgroup、rlimit、资源隔离 |
| 内存漏洞 | 虚拟内存、mmap、COW、page fault、page cache |
| Shell 注入 | execve、argv、envp、PATH、shell 解析 |
| 网络解析漏洞 | socket、DNS、libc、缓冲区边界 |

### 5.3 教学抽象与安全降级

并非所有真实案例都适合直接复现。Agent 需要判断：

```text
是否涉及真实提权？
是否涉及 RCE？
是否已有公开武器化 PoC？
是否可能攻击宿主机？
是否可能横向移动？
是否会破坏学生机器？
是否超出当前课程难度？
```

如果风险较高，则转换为：

- 用户态模拟器；
- toy target；
- 只读 trace 分析题；
- patch diff 阅读题；
- fixed/vuln 行为对比题；
- 受控 QEMU 内部实验；
- 不提供完整 exploit 的 evidence-based 验证题。

### 5.4 QEMU 实验环境生成

每个实验通常包含多种镜像：

```text
lab-vuln.qcow2
  存在教学目标问题，用于正例验证。

lab-fixed.qcow2
  修复问题，用于反例验证。

lab-mitigated.qcow2
  添加安全策略，用于防护验证。

lab-simulator.qcow2
  用户态模拟环境，用于基础原理观察。
```

QEMU 环境的价值在于：

- 内核、文件系统、用户空间完全可控；
- 每次实验从固定快照启动；
- 学生不会破坏宿主机；
- 可以模拟真实系统行为；
- 可以同时保留 vulnerable 与 fixed 环境；
- 方便自动回滚、重放与评分。

### 5.5 阶段化命题

每个实验不只设计一个“最终 flag”，而是拆解为多个阶段：

```text
Stage 0：案例理解
Stage 1：环境识别
Stage 2：系统行为观察
Stage 3：问题定位
Stage 4：受控证明
Stage 5：修复实现
Stage 6：fixed 环境反例验证
Stage 7：mitigation 设计
Stage 8：解释与总结
```

这种设计让学生按照正确思路推进，而不是直接复制 PoC 或猜 flag。

---

## 6. 学生 solver 与 checker 机制

### 6.1 solver 接口

学生提交 solver：

```bash
python3 solver.py \
  --stage stage-id \
  --target 10.0.2.15 \
  --nonce "$NONCE" \
  --out evidence.json
```

solver 需要完成以下任务之一：

- 观察系统行为；
- 采集 `/proc`、trace、日志；
- 触发 toy target 的安全边界；
- 修复给定程序；
- 比较 vuln/fixed 行为；
- 输出 evidence；
- 解释案例与 OS 概念之间的关系。

### 6.2 evidence 示例

```json
{
  "stage_id": "toctou-basic",
  "nonce": "random-from-platform",
  "observed_syscalls": ["stat", "open"],
  "race_window_detected": true,
  "fixed_behavior": "path cannot escape lab directory",
  "os_concepts": [
    "TOCTOU",
    "symbolic link",
    "inode",
    "openat",
    "fstat"
  ],
  "explanation": "检查路径和打开路径之间存在时间窗口，攻击者可以在两者之间替换符号链接。修复应基于目录 fd 打开文件，并在打开后验证最终 inode。"
}
```

### 6.3 checker 判定逻辑

checker 不只检查 flag，还检查过程证据：

```text
1. 正例验证
   vuln 环境中 solver 能观察到预期问题。

2. 反例验证
   fixed 环境中同样行为失败或不再出现。

3. 边界验证
   solver 只能操作 /opt/lab、/tmp/lab 等允许路径。

4. 随机性验证
   平台注入 nonce，防止硬编码答案。

5. 路径验证
   trace 中必须包含关键 syscall 或关键系统行为。

6. 理解验证
   evidence 中必须解释对应 OS 概念。

7. 回归验证
   修复后正常功能仍然通过。
```

---

## 7. CopyFail 案例的实验设计思路

CopyFail 是一个适合高级 OS 实验的真实案例。它可映射到以下知识点：

- Linux 内核；
- `AF_ALG` 用户态加密接口；
- `splice()` 零拷贝 I/O；
- page cache；
- scatterlist；
- in-place / out-of-place buffer；
- setuid 权限边界；
- 本地提权；
- 容器共享内核风险；
- 补丁回归验证。

### 7.1 教学目标

CopyFail 不应被设计成“学生直接运行完整 exploit”的实验，而应设计成：

> 学生通过 solver 证明零拷贝 I/O、page cache 与内核缓冲区别名关系如何影响系统安全，并通过 fixed VM 证明补丁破坏了漏洞条件。

### 7.2 阶段设计

| 阶段 | 教学目标 | 学生任务 | checker 判定 |
|---|---|---|---|
| Stage 0 | 案例建模 | 提交概念图 | 必须包含 `AF_ALG`、`splice`、page cache、setuid |
| Stage 1 | 环境识别 | 判断当前 VM 是否 vulnerable | 不能硬编码版本，需采集真实状态 |
| Stage 2 | page cache 观察 | 证明内存视图和磁盘文件可能不同 | hash、读路径与 nonce 一致 |
| Stage 3 | 路径追踪 | 采集关键 syscall 路径 | trace 中出现预期系统调用序列 |
| Stage 4 | 受控证明 | 只攻击教学目标文件 | 不允许修改真实系统组件 |
| Stage 5 | fixed 反例 | 同一 solver 在 fixed VM 上失败 | 必须解释失败原因 |
| Stage 6 | mitigation | 设计限制策略 | 正常功能可用，风险路径不可用 |

### 7.3 安全边界

CopyFail 这类实验必须遵守：

```text
不攻击系统真实 setuid 程序；
不提供完整可外用 exploit；
不允许联网；
不挂载宿主机目录；
只允许操作 /opt/lab；
QEMU 每次实验后销毁；
必须同时运行 vuln 和 fixed 验证；
教师保留完整参考 solver，学生只获得受控题面。
```

---

## 8. 更基础的真实案例 OS 实验方案

下面的实验更适合作为本科或入门 OS 课程的主线。

### 8.1 Shellshock 简化实验：理解 `execve` 与环境变量

| 项目 | 内容 |
|---|---|
| 真实案例 | Shellshock |
| OS 概念 | `fork`、`execve`、`argv`、`envp`、环境变量继承 |
| 教学目标 | 理解父进程如何把环境传给子进程，解释器为什么会成为安全边界 |
| 实验形式 | 教学版 CGI runner |
| 学生任务 | 观察 HTTP Header 如何变成环境变量，修复环境变量白名单 |
| 创新点 | 把抽象的 `execve` 参数传递变成真实的服务边界问题 |

### 8.2 PID 1 与僵尸进程实验

| 项目 | 内容 |
|---|---|
| 真实案例 | 容器服务无法优雅退出、Pod 终止异常 |
| OS 概念 | PID、父子进程、`SIGTERM`、`SIGCHLD`、`waitpid` |
| 教学目标 | 理解进程回收和信号转发 |
| 实验形式 | bad_server + mini-init |
| 学生任务 | 找 zombie，写 mini-init，转发信号并回收子进程 |
| 创新点 | 把 `fork/wait` 变成容器生命周期管理问题 |

### 8.3 CPU 调度与资源隔离实验

| 项目 | 内容 |
|---|---|
| 真实案例 | 正则表达式导致 CPU 打满的生产事故 |
| OS 概念 | 调度、CPU 时间、`rlimit`、cgroup |
| 教学目标 | 理解单个进程如何影响整机资源 |
| 实验形式 | CPU hog / regex worker |
| 学生任务 | 采集 CPU 使用率，添加 rlimit 或 cgroup 限制 |
| 创新点 | 把调度从算法题变成服务可用性问题 |

### 8.4 文件系统恢复实验

| 项目 | 内容 |
|---|---|
| 真实案例 | GitLab 数据库事故、误删站点事故 |
| OS 概念 | inode、rename 原子性、fsync、snapshot、WAL |
| 教学目标 | 理解文件系统语义与恢复机制 |
| 实验形式 | toy ticket database |
| 学生任务 | 从 snapshot + WAL 恢复数据，改造危险 cleanup 脚本 |
| 创新点 | 把文件读写实验变成生产恢复演练 |

### 8.5 路径边界与文件覆盖实验

| 项目 | 内容 |
|---|---|
| 真实案例 | scp 路径校验漏洞 |
| OS 概念 | 路径解析、相对路径、绝对路径、符号链接、文件覆盖 |
| 教学目标 | 理解路径字符串不是安全边界 |
| 实验形式 | mini_scp_client |
| 学生任务 | 修复路径规范化和目标目录边界检查 |
| 创新点 | 把 `open()` 实验变成客户端信任边界问题 |

### 8.6 TOCTOU 与符号链接竞争实验

| 项目 | 内容 |
|---|---|
| 真实案例 | Docker `docker cp` symlink race |
| OS 概念 | `stat`、`open`、inode、symlink、TOCTOU、`openat`、`fstat` |
| 教学目标 | 理解检查与使用之间的竞态 |
| 实验形式 | backup_copy_vuln / backup_copy_fixed |
| 学生任务 | 观察 syscall 顺序，修复为目录 fd + 打开后验证 |
| 创新点 | 把竞态条件从理论概念变成可观测系统行为 |

### 8.7 setuid 与权限模型实验

| 项目 | 内容 |
|---|---|
| 真实案例 | sudo 本地提权类漏洞 |
| OS 概念 | real UID、effective UID、saved UID、setuid、capability |
| 教学目标 | 理解权限是进程执行过程中的动态状态 |
| 实验形式 | lab_sudo toy target |
| 学生任务 | 观察 UID 变化，尽早 drop privilege，限制子进程权限 |
| 创新点 | 把文件权限实验扩展为完整权限生命周期实验 |

### 8.8 mmap 与 COW 实验

| 项目 | 内容 |
|---|---|
| 真实案例 | Dirty COW |
| OS 概念 | 虚拟内存、mmap、MAP_PRIVATE、copy-on-write、page fault |
| 教学目标 | 理解文件、虚拟地址、物理页之间的关系 |
| 实验形式 | cow_lab 用户态观察器 |
| 学生任务 | 证明私有映射写入不改变底层文件，观察父子进程 COW |
| 创新点 | 把 mmap API 变成虚拟内存状态机观察实验 |

### 8.9 Pipe 与 page cache 实验

| 项目 | 内容 |
|---|---|
| 真实案例 | Dirty Pipe |
| OS 概念 | pipe buffer、page cache、flag 初始化、对象复用 |
| 教学目标 | 理解 pipe 背后的内核缓冲区语义 |
| 实验形式 | pipebuf_simulator |
| 学生任务 | 复现 stale flag，修复初始化逻辑 |
| 创新点 | 把 pipe 从 IPC 字节流提升为内核对象生命周期问题 |

### 8.10 栈保护与资源限制实验

| 项目 | 内容 |
|---|---|
| 真实案例 | Stack Clash |
| OS 概念 | 栈增长、guard page、page fault、RLIMIT_STACK |
| 教学目标 | 理解用户态地址空间布局与保护页 |
| 实验形式 | stack_lab |
| 学生任务 | 解析 `/proc/self/maps`，触发并记录 SIGSEGV，调整栈限制 |
| 创新点 | 把“栈和堆”变成可观察的虚拟内存布局实验 |

### 8.11 DNS 与 socket 实验

| 项目 | 内容 |
|---|---|
| 真实案例 | glibc DNS resolver 漏洞 |
| OS 概念 | socket、UDP、DNS、libc 与 kernel 边界 |
| 教学目标 | 理解一个库函数背后的系统调用链 |
| 实验形式 | fake_dns_server + resolver_client |
| 学生任务 | strace `getaddrinfo`，修复 DNS parser 长度检查 |
| 创新点 | 把网络系统调用与 libc 基础设施联系起来 |

### 8.12 Namespace 与容器边界实验

| 项目 | 内容 |
|---|---|
| 真实案例 | runc / 容器逃逸类案例 |
| OS 概念 | mount namespace、PID namespace、user namespace、procfs、fd 继承 |
| 教学目标 | 理解容器不是虚拟机，namespace 是资源视图隔离 |
| 实验形式 | mini_container |
| 学生任务 | 对比容器内外 `/proc` 和 mountinfo，修复 fd 泄漏 |
| 创新点 | 把 namespace 从概念介绍变成可运行隔离实验 |

---

## 9. 实验设计的核心创新点

### 9.1 从“知识点驱动”转向“真实案例驱动”

传统实验通常从知识点出发：

```text
今天学 fork，所以写 fork 示例。
今天学 mmap，所以写 mmap 示例。
今天学文件系统，所以写 open/read/write。
```

本方案从真实案例出发：

```text
为什么 Shellshock 与环境变量有关？
为什么 Docker cp 会出现 symlink race？
为什么 Dirty COW 与 COW 有关？
为什么容器 PID 1 会影响服务退出？
为什么数据误删后恢复依赖 fsync、rename 和 WAL？
```

学生先看到真实问题，再回到 OS 机制，因此更容易理解知识点的现实意义。

### 9.2 Agent 自动生成实验，而非教师手工维护题库

教师只需要提供真实案例与教学目标，Agent 自动生成：

- 概念图；
- 阶段题；
- QEMU 镜像配置；
- checker；
- solver 接口；
- hint；
- 教师讲义；
- 安全审查报告。

这使实验体系可以持续更新，不再依赖教师长期手工维护大量静态实验。

### 9.3 使用 QEMU 保留真实系统行为

相比纯模拟器或容器沙箱，QEMU 能提供更完整的 OS 运行环境：

- 可以控制内核版本；
- 可以构建 vulnerable/fixed 镜像；
- 可以运行真实系统调用；
- 可以隔离危险实验；
- 可以快照回滚；
- 可以做内核、文件系统、权限、容器等综合实验。

这让学生面对的不是“伪实验环境”，而是可控的真实系统。

### 9.4 以 solver 代替传统报告

学生通过 solver 完成实验：

```text
观察
诊断
修复
验证
解释
```

solver 输出的 evidence 可以自动检查，避免只交截图或报告带来的主观性。

### 9.5 OJ/CTF 分阶段引导正确思路

每个实验都拆分为多个阶段：

```text
环境识别 → 行为观察 → 问题定位 → 受控证明 → 修复 → 反例验证 → 解释
```

这样既保留 CTF 的即时反馈和挑战性，又避免学生只追求最终 flag。

### 9.6 vuln/fixed/mitigated 三环境验证

传统实验通常只验证“能不能跑”。本方案要求：

```text
vuln 环境：问题应该能被观察到；
fixed 环境：问题应该消失；
mitigated 环境：风险路径被限制，正常功能仍可用。
```

这能帮助学生理解：

- 漏洞为什么存在；
- 补丁为什么有效；
- 缓解策略是否影响业务功能。

### 9.7 “上午新案例，下午进课堂”的快速转化能力

当出现新的 CVE 或系统事故时，Agent 可以快速生成不同层级的实验：

```text
当日安全题：
  案例解析、影响范围判断、OS 概念映射、patch 阅读。

受控复现实验：
  QEMU vulnerable/fixed 环境，学生只接触受控 toy target。

深度研究实验：
  在安全审查后开放更复杂的路径追踪、补丁回归和防护设计。
```

这让课程内容能跟上真实世界，而不是几年不变。

### 9.8 安全前置，而不是事后提醒

本方案不是简单地把 PoC 搬进课堂，而是通过技术手段控制风险：

- 不开放完整武器化 PoC；
- 不攻击真实系统组件；
- QEMU 隔离；
- 无外网；
- 无宿主机目录挂载；
- 只允许访问 `/opt/lab`；
- 动态 flag；
- 每次运行后销毁 VM；
- 必须通过 fixed 反例验证。

### 9.9 自动化形成性评价

平台可以记录学生在每个阶段的表现：

- 是否正确识别环境；
- 是否采集到关键 syscall；
- 是否理解关键 OS 概念；
- 是否能修复 toy target；
- 是否能在 fixed 环境证明问题消失；
- 是否能设计 mitigation。

这比期末一次性考试更适合 OS 课程的过程性评价。

### 9.10 形成可复用案例库

每个真实案例都沉淀为结构化资产：

```text
case.yaml
concept_graph.json
challenge.yml
checker.py
reference_solver.py
teacher_notes.md
risk_review.md
vuln.qcow2
fixed.qcow2
```

随着课程推进，可以形成持续增长的 OS 实验案例库。

---

## 10. 推荐课程实施路径

### 10.1 基础阶段

适合 OS 课程前半段：

| 周次 | 实验 | 核心知识点 |
|---|---|---|
| 第 1 周 | Shellshock 简化实验 | `execve`、环境变量 |
| 第 2 周 | PID 1 与僵尸进程 | `fork`、`waitpid`、信号 |
| 第 3 周 | CPU 调度与资源隔离 | 调度、rlimit、cgroup |
| 第 4 周 | 路径边界实验 | open、路径解析、符号链接 |
| 第 5 周 | TOCTOU 竞态实验 | stat/open、inode、竞态 |
| 第 6 周 | mmap 与 COW 实验 | 虚拟内存、COW、page fault |

### 10.2 进阶阶段

适合 OS 课程后半段或安全方向课程：

| 实验 | 核心知识点 |
|---|---|
| Dirty Pipe 简化实验 | pipe buffer、page cache |
| setuid 权限模型实验 | UID、EUID、capability |
| Stack Clash 简化实验 | 栈增长、guard page |
| DNS resolver 实验 | socket、libc、DNS |
| Namespace 容器实验 | namespace、procfs、fd 继承 |
| 文件系统恢复实验 | fsync、rename、WAL、snapshot |

### 10.3 综合阶段

期末可以使用 CopyFail 或类似案例作为综合实验：

```text
案例解析
OS 概念建模
QEMU 环境识别
系统调用路径追踪
page cache 行为观察
受控目标验证
fixed 环境反例验证
mitigation 设计
实验复盘
```

---

## 11. 平台落地建议

### 11.1 技术组件

| 模块 | 可选技术 |
|---|---|
| 虚拟化 | QEMU / KVM |
| 镜像管理 | qcow2 overlay、cloud-init、Packer、Ansible |
| 判题平台 | CTFd、自研 OJ、Judge0 扩展 |
| 日志采集 | serial console、SSH、guest agent、ftrace、strace、auditd |
| 题目定义 | `challenge.yml` |
| 结果提交 | `evidence.json` |
| 安全控制 | host-only network、seccomp、AppArmor、VM timeout |
| 自动化生成 | Agent + 模板库 + 风险策略 |

### 11.2 题目结构

```text
lab-name/
  ├─ case.yaml
  ├─ concept_graph.json
  ├─ challenge.yml
  ├─ checker.py
  ├─ reference_solver.py
  ├─ teacher_notes.md
  ├─ risk_review.md
  ├─ build/
  │   ├─ Dockerfile or Packer template
  │   └─ cloud-init.yaml
  ├─ images/
  │   ├─ vuln.qcow2
  │   ├─ fixed.qcow2
  │   └─ mitigated.qcow2
  └─ student/
      ├─ README.md
      ├─ solver_template.py
      └─ evidence_schema.json
```

### 11.3 判题规则

```yaml
scoring:
  environment_identification: 15
  os_behavior_observation: 20
  problem_localization: 20
  fix_or_mitigation: 20
  vuln_fixed_comparison: 15
  explanation_quality: 10
```

### 11.4 安全策略

```yaml
safety_policy:
  qemu_isolation: true
  no_external_network: true
  no_host_mount: true
  dynamic_flag: true
  destroy_vm_after_run: true
  allowed_paths:
    - /opt/lab
    - /tmp/lab
  disallowed_targets:
    - /bin/su
    - /usr/bin/sudo
    - /etc/shadow
    - host filesystem
  require_fixed_negative_test: true
  require_teacher_approval_for_high_risk_case: true
```

---

## 12. 预期教学效果

该实验体系预期带来以下效果：

1. **增强真实感**  
   学生理解 OS 机制不是孤立 API，而是影响真实系统安全、可靠性和性能的基础。

2. **提高参与度**  
   OJ/CTF 分阶段反馈比传统报告更有即时性和挑战感。

3. **提升可验证性**  
   solver 与 evidence 让教师能够自动判断学生是否真的完成观察、诊断和修复。

4. **增强安全意识**  
   学生在受控环境中理解真实案例背后的机制，而不是盲目复制 exploit。

5. **降低教师维护成本**  
   Agent 将真实案例快速转化为实验，教师主要负责目标选择、风险审查和课堂讲解。

6. **支持课程持续更新**  
   新 CVE、新事故、新技术案例都可以逐步进入案例库。

7. **促进跨知识点整合**  
   一个真实案例往往同时涉及进程、内存、文件系统、权限、网络、虚拟化等多个 OS 概念。

---

## 13. 总结

本方案的核心不是“把安全漏洞搬进 OS 课堂”，而是：

> **把真实案例抽象成安全、可控、可验证的 OS 机制实验。**

传统 OS 实验强调：

```text
调用 API
理解定义
完成报告
```

本方案强调：

```text
理解真实案例
观察系统行为
编写 solver
验证漏洞条件
修复 toy target
比较 vuln/fixed
解释 OS 原理
```

其创新点可以概括为：

```text
真实案例驱动
Agent 自动生成
QEMU 真实环境
OJ/CTF 分阶段验证
solver 过程评价
vuln/fixed/mitigated 三环境对照
安全降级与非武器化设计
持续更新的 OS 实验案例库
```

最终目标是让学生不仅知道“操作系统提供了什么机制”，更能理解：

> **这些机制在真实系统中如何被使用、如何失效、如何修复，以及为什么它们是现代计算机系统安全与可靠性的基础。**
