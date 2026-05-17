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

---

## 2. 通用平台抽象

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

也就是说，以下部分是通用的：

```text
- Agent Gateway
- OpenAI-compatible IDE 接入
- DevBox / Sandbox
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

# 4. SpecDBLab：Spec 驱动数据库实验

## 4.1 适用性

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

## 4.2 数据库模块规格示例

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

## 4.3 数据库验证矩阵

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

## 4.4 数据库个性化目标合约

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

## 4.5 数据库 Agent

```text
SpecDBAgent:
  - SchemaSpecAssistant
  - StorageEngineCodeGenAgent
  - TransactionValidatorAgent
  - QueryPlanExplainAgent
  - CrashFuzzAgent
  - BenchmarkAgent
```

---

# 5. SpecCompilerLab：Spec 驱动编译器实验

## 5.1 适用性

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
SpecCompilerLab:
  - Tiger / SysY / MiniC 编译器
  - LLVM IR backend 路线
  - 自定义 IR + 自定义 backend
  - JIT 编译器路线
  - 优化编译器路线
  - 形式化语义小语言路线
```

## 5.2 类型检查模块规格示例

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

## 5.3 优化 Pass 规格示例

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

## 5.4 编译器验证矩阵

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

## 5.5 编译器个性化目标合约

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

## 5.6 编译器 Agent

```text
SpecCompilerAgent:
  - GrammarSpecAssistant
  - TypeSystemAgent
  - IRPassCodeGenAgent
  - IRValidatorAgent
  - DifferentialTestAgent
  - BackendDebugAgent
```

---

## 6. 其他可扩展领域

## 6.1 SpecNetLab：网络协议实验

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

## 6.2 SpecRuntimeLab：运行时与虚拟机实验

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

## 6.3 SpecHWLab：体系结构与硬件实验

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
- 完成 OS DevBox
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

### 阶段四：实现 SpecCompilerLab 插件

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
SpecCompilerLab 是编译器插件实例。
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
