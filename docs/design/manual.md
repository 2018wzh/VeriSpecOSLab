# VeriSpecOSLab 实验指导书组织结构总结

> 目标：参照 xv6 / rCore 等成熟操作系统实验指导书的组织方式，将 VeriSpecOSLab 写成“可学习、可执行、可验证、可评分、可审计”的实验体系，而不是单一方案说明文档。

---

## 1. 总体定位

VeriSpecOSLab 指导书应采用：

```text
xv6 式 Lab 卡片
+ rCore 式章节教材
+ SpecLab 式规格 / 验证 / Agent / 审计机制
```

其中：

- **xv6 式 Lab 卡片**：每个实验任务独立、目标明确、命令明确、测试明确、提交明确。
- **rCore 式章节教材**：从 Boot、Memory、Trap、Scheduler、User Mode 等核心概念逐步展开，形成可阅读的教材主线。
- **SpecLab 式扩展**：每个核心模块必须先写 Spec，再实现，再验证，并记录 AI 协作过程。

一句话概括：

> 学生看到的是 Book + Labs + Specs + Tools；平台执行的是 CI + Judge + Agent；教师维护的是 Rubric + Hidden Tests + Audit。

---

## 2. 顶层文档结构

建议将指导书组织为“一站四册”：

```text
verispecoslab-guide/
├── book/                  # 教材型章节，类似 rCore Tutorial
├── labs/                  # 实验卡片，类似 xv6 labs
├── specs/                 # 规格写作手册
├── appendices/            # 工具、调试、AI 规范、评分附录
└── teacher/               # 教师、助教、Judge 与隐藏测试说明
```

### 2.1 `book/`：教材型章节

`book/` 负责讲概念、设计背景和实现路线，不直接承担完整实验任务。

```text
book/
├── ch00-overview.md
├── ch01-spec-driven-os.md
├── ch02-boot-console.md
├── ch03-memory-management.md
├── ch04-virtual-memory.md
├── ch05-trap-interrupt-syscall.md
├── ch06-scheduler-user-mode.md
├── ch07-abi-loader.md
├── ch08-resource-model.md
├── ch09-ipc-vfs-namespace.md
├── ch10-verification.md
├── ch11-ai-collaboration.md
└── ch12-final-report.md
```

每章建议统一包含：

```text
1. 本章目标
2. 背景知识
3. 关键设计问题
4. 典型实现路线
5. 与 Spec 的关系
6. 常见错误
7. 本章对应 Labs
```

---

### 2.2 `labs/`：实验卡片

`labs/` 是学生的主要执行入口，应模仿 xv6 的实验卡片风格。

```text
labs/
├── lab0-env.md
├── lab1-boot-console.md
├── lab2-page-allocator.md
├── lab3-virtual-memory.md
├── lab4-trap-syscall-ipc.md
├── lab5-scheduler-user.md
├── lab6-abi-loader.md
├── lab7-resource-table.md
├── lab8-ipc-vfs-service.md
├── lab9-verification.md
├── lab10-personal-goal.md
└── final-lab.md
```

每个 Lab 使用统一模板：

```text
# Lab N: 标题

## 1. 实验目标
## 2. 背景阅读
## 3. 起始代码
## 4. 必写规格
## 5. 实现任务
## 6. 运行命令
## 7. 测试与评分
## 8. 常见错误
## 9. AI 使用边界
## 10. 提交物
## 11. Challenge
```

示例：`Lab 2: Physical Page Allocator`

```text
# Lab 2: Physical Page Allocator

## 实验目标
实现物理页初始化、分配、释放、double-free 检查和 allocator invariant checker。

## 必写规格
- student-specs/modules/memory/page_allocator.yaml

## 实现任务
Task 1: 解析 boot memory map。
Task 2: 初始化 free page 集合。
Task 3: 实现 alloc_page。
Task 4: 实现 free_page。
Task 5: 实现 check_page_allocator_invariant。

## 运行命令
vos spec lint student-specs/modules/memory/page_allocator.yaml
vos build
vos test memory.page_allocator
vos verify base

## 期望通过
- page_alloc_free
- reserved_region_not_allocated
- double_free_rejected
- page_allocator_invariant

## AI 使用边界
允许让 AI 检查 invariant 是否完整；允许生成局部候选 patch；不允许无 ModuleSpec 直接生成 allocator；不允许删除 invariant checker。
```

---

### 2.3 `specs/`：规格手册

`specs/` 是 VeriSpecOSLab 相比 xv6 / rCore 的核心增量，负责规定学生如何表达设计、模块语义、接口语义、并发规则、目标合约和演化记录。

```text
specs/
├── overview.md
├── architecture-design-spec.md
├── architecture-composition-spec.md
├── module-spec.md
├── interface-abi-spec.md
├── concurrency-spec.md
├── goal-validation-contract.md
├── spec-patch.md
├── ai-collaboration-log.md
└── examples/
    ├── page-allocator.yaml
    ├── syscall-write.yaml
    ├── ipc-endpoint.yaml
    ├── scheduler-concurrency.yaml
    └── linux-static-elf-goal.yaml
```

关键要求：

```text
1. ArchitectureDesignSpec：说明系统架构、参考系统、借鉴/修改/拒绝的机制、技术栈和验证边界。
2. ArchitectureCompositionSpec：说明跨组件组合关系和组合不变量。
3. ModuleSpec：说明模块状态、接口、前置条件、后置条件、不变量、错误语义和测试义务。
4. InterfaceSpec / ABISpec：说明 syscall、IPC、ABI 或服务接口。
5. ConcurrencySpec：说明锁、原子操作、中断交互、wait queue、引用计数等并发规则。
6. GoalValidationContract：说明个性化目标、范围、非目标、指标、baseline 和 correctness guard。
7. SpecPatch：记录规格演化，禁止大规模功能直接改代码。
8. AICollaborationLog：记录 AI 输入、输出、采纳、修改、验证和错误案例。
```

---

### 2.4 `appendices/`：工具与规范附录

`appendices/` 负责放通用工具、调试方法和规则说明，避免每个 Lab 重复。

```text
appendices/
├── tools.md
├── vos-command.md
├── devcontainer.md
├── qemu.md
├── gdb.md
├── linker-script.md
├── trap-debug.md
├── common-bugs.md
├── invariant-checker.md
├── fuzzing.md
├── ai-policy.md
├── grading.md
└── final-report-template.md
```

`vos-command.md` 应统一列出命令入口：

```bash
vos init
vos spec lint
vos arch lint
vos build
vos run qemu
vos test public
vos verify base
vos verify architecture
vos verify composition
vos verify goal
vos report generate
```

---

### 2.5 `teacher/`：教师与 Judge 手册

`teacher/` 主要面向教师、助教和平台实现者，不一定全部开放给学生。

```text
teacher/
├── course-plan.md
├── lab-release-plan.md
├── rubric.md
├── public-tests.md
├── generated-tests.md
├── hidden-tests.md
├── fuzz-policy.md
├── judge-policy.md
├── ai-audit-policy.md
├── plagiarism-review.md
├── defense-questions.md
└── ta-checklist.md
```

重点内容：

```text
1. 哪些测试公开。
2. 哪些测试隐藏。
3. 哪些测试由 Agent 根据学生设计派生。
4. 哪些评分项可自动评分。
5. 哪些评分项需要助教人工复核。
6. AI 使用记录如何检查。
7. 相似度风险如何复核。
8. 答辩问题如何根据风险模型生成。
```

---

## 3. 学生项目仓库结构

学生仓库不应只包含 `kernel/`，还应包含规格、测试、报告和 Agent 派生验证材料。

```text
student-project/
├── .devcontainer/
├── boot/
├── kernel/
├── userland/
├── drivers/
├── fs/
├── libs/
├── tests/
│   ├── public/
│   ├── generated/
│   ├── fuzz/
│   └── regression/
├── student-specs/
│   ├── architecture/
│   │   ├── design.yaml
│   │   └── composition.yaml
│   ├── modules/
│   │   ├── boot/
│   │   ├── memory/
│   │   ├── trap/
│   │   ├── scheduler/
│   │   ├── syscall/
│   │   ├── ipc/
│   │   ├── capability/
│   │   ├── namespace/
│   │   └── vfs/
│   ├── goals/
│   │   ├── compatibility.yaml
│   │   ├── optimization.yaml
│   │   ├── hardware-port.yaml
│   │   └── formal-verification.yaml
│   └── evolution/
│       ├── patch-001.yaml
│       └── patch-002.yaml
├── agent-generated-specs/
│   ├── normalized-design.yaml
│   ├── risk-model.yaml
│   ├── derived-verification-plan.yaml
│   └── derived-test-matrix.yaml
├── reports/
│   ├── ai-collaboration-log.md
│   ├── verification-report.md
│   ├── benchmark-report.md
│   ├── architecture-review-report.md
│   └── final-report.md
├── scripts/
├── tools/
├── rootfs/
├── .speclab.yml
└── README.md
```

---

## 4. 课程网站导航结构

课程网站面向学生时，应突出“Start Here → Book → Labs → Specs → Tools → Reports”的学习路径。

```text
VeriSpecOSLab
├── 0. Start Here
│   ├── 实验介绍
│   ├── 环境安装
│   ├── Git / CI / Judge 使用
│   └── AI 使用规则
│
├── 1. Book
│   ├── Boot
│   ├── Memory
│   ├── Trap
│   ├── Scheduler
│   ├── Syscall / IPC
│   ├── ABI / Loader
│   └── Verification
│
├── 2. Labs
│   ├── Lab 0
│   ├── Lab 1
│   ├── ...
│   └── Final Lab
│
├── 3. Specs
│   ├── ArchitectureDesignSpec
│   ├── ArchitectureCompositionSpec
│   ├── ModuleSpec
│   ├── ConcurrencySpec
│   └── GoalValidationContract
│
├── 4. Tools
│   ├── vos
│   ├── QEMU
│   ├── GDB
│   ├── CI
│   └── Judge
│
├── 5. Reports
│   ├── AI Collaboration Log
│   ├── Verification Report
│   └── Final Report
│
└── 6. FAQ
```


---

## 6. 每个 Lab 的 Spec-first 检查点

VeriSpecOSLab 与传统 xv6/rCore 的最大区别是：每个核心实现前必须先有规格。

推荐流程：

```text
读设计
→ 写 Spec
→ spec_lint
→ 实现
→ build
→ test
→ verify
→ report
```

建议设置如下解锁条件：

```text
没有 ArchitectureDesignSpec → 不能进入核心实现阶段
没有 ModuleSpec → 不能实现核心模块
没有 ConcurrencySpec → 不能实现复杂并发模块
没有 GoalValidationContract → 不能声明个性化目标得分
没有 AICollaborationLog → 不能最终提交
```

---

## 7. Final Lab 组织方式

Final Lab 不应只检查“能否跑通”，而应参考 rCore 综合练习的方式，要求学生分析失败、解释设计、展示验证证据。

```text
Final Lab: Integration and Verification

基础要求：
1. 系统可启动。
2. 可运行用户程序或等价 workload。
3. 通过 BaseTestSuite。
4. 至少 5 个 invariant checker 可运行。
5. 至少 1 个 cross-component invariant。
6. 至少 1 个 SpecPatch 演化案例。
7. 至少 1 个 AI 错误修正案例。

分析要求：
1. 选择 2~4 个失败或曾失败测试。
2. 描述现象。
3. 定位原因。
4. 说明对应规格是否缺失或错误。
5. 说明如何修正规格或代码。
6. 给出修正后的验证证据。

个性化展示：
1. 兼容性：运行静态 ELF 或 syscall trace。
2. 性能：给出 baseline 与优化后 benchmark。
3. 安全：展示非法权限访问失败。
4. 硬件：展示真实硬件或仿真板卡启动日志。
5. 形式化：展示模型检查或局部证明结果。
```

---

## 8. AI / Agent 使用边界

指导书中应明确区分学生职责和 AI 职责。

### 8.1 允许

```text
- 让 AI 解释课程要求。
- 让 AI 检查 ArchitectureDesignSpec。
- 让 AI 补全 ModuleSpec 草案。
- 让 AI 根据已有 Spec 生成局部候选 patch。
- 让 AI 解释编译错误、QEMU 日志、trap frame。
- 让 AI 生成测试建议。
- 让 AI 整理验证报告结构。
```

### 8.2 限制

```text
- 核心模块必须先有 ModuleSpec。
- 并发模块必须先有 ConcurrencySpec。
- 架构变化必须先修改 ArchitectureDesignSpec 或 CompositionSpec。
- syscall / IPC / VFS / VM 修改后必须运行 regression test。
- AI 生成的 patch 必须由学生阅读、解释、修改和验证。
```

### 8.3 禁止

```text
- 一次性生成完整 OS。
- 跳过规格直接生成核心模块。
- 删除测试以通过 CI。
- 移除 invariant checker。
- 绕过权限检查。
- 提交无法解释的 AI 代码。
- 伪造日志、benchmark 或硬件 bring-up 结果。
- 泄露或利用隐藏测试。
```

---

## 9. 平台与 Judge 组织结构

除指导书外，还需要平台执行结构支持自动化。

```text
verispecoslab/
├── guide/
│   ├── book/
│   ├── labs/
│   ├── specs/
│   ├── tools/
│   ├── reports/
│   └── faq/
│
├── template/
│   ├── boot/
│   ├── kernel/
│   ├── userland/
│   ├── tests/
│   ├── student-specs/
│   ├── reports/
│   └── .speclab.yml
│
├── platform/
│   ├── ci/
│   ├── judge/
│   ├── agent/
│   ├── runner/
│   └── artifact/
│
└── teacher/
    ├── rubric/
    ├── hidden-tests/
    ├── judge-policy/
    └── audit-policy/
```

平台主线可以抽象为：

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

## 10. 最小可落地版本

第一版不建议一次性覆盖所有高级路线。MVP 版本建议包含：

```text
必做：
- QEMU 上可启动
- Boot / Memory / Trap / Syscall-or-IPC / Scheduler / User Program
- ArchitectureDesignSpec
- ArchitectureCompositionSpec
- 核心 ModuleSpec
- AICollaborationLog
- 基础测试与 invariant checker

选做：
- Linux static ELF subset
- capability IPC
- namespace / VFS
- 性能优化
- 硬件移植
- 局部形式化验证
```

MVP 文档结构：

```text
guide/
├── book/
│   ├── ch00-overview.md
│   ├── ch01-boot.md
│   ├── ch02-memory.md
│   ├── ch03-trap.md
│   ├── ch04-scheduler-user.md
│   └── ch05-verification.md
├── labs/
│   ├── lab0-env.md
│   ├── lab1-boot.md
│   ├── lab2-page-allocator.md
│   ├── lab3-trap-syscall.md
│   ├── lab4-scheduler-user.md
│   └── final-lab.md
├── specs/
│   ├── architecture-design-spec.md
│   ├── architecture-composition-spec.md
│   ├── module-spec.md
│   └── ai-collaboration-log.md
└── appendices/
    ├── vos-command.md
    ├── qemu-debug.md
    ├── ai-policy.md
    └── grading.md
```

---

## 11. 结论

VeriSpecOSLab 指导书应按照如下原则组织：

```text
一条主线：
Book → Labs → Final Lab

三类支撑：
Specs → Tools → Reports

两类后台：
Teacher → Judge
```

最终结构不是一本线性 PDF，而是一个课程工程：

```text
学生通过 Book 学概念；
学生通过 Labs 做实验；
学生通过 Specs 描述设计和正确性；
学生通过 Tools 构建、运行和调试；
学生通过 Reports 提交验证证据；
平台通过 CI/Judge/Agent 执行验证；
教师通过 Rubric/Hidden Tests/Audit 进行评价。
```

这能保留 xv6 / rCore 指导书的清晰推进方式，同时体现 VeriSpecOSLab 的核心特征：规格驱动、AI 协作、动态验证、个性化架构和可审计评价。
