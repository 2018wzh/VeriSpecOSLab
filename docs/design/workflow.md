# VeriSpecOSLab / SpecLab 递进式课程工作流

> 本文档说明 VeriSpecOSLab / SpecLab 在“本地单层 `spec/` + 云端 Spec Service”模型下的递进式课程工作流。学生负责真实设计与实现；教师负责课程边界与评价公平性；平台与 Agent 负责权限投影、验证派生、隐藏评测和过程审计。

---

## 1. 总体原则

课程工作流采用：

```text
Progressive Design → Spec → Implementation → Verification → Feedback → Evolution → Final Synthesis
```

教学含义：

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
平台 Agent 根据本地 spec/ 和云端规则动态派生验证
  ↓
课程末期合成 FinalArchitectureSynthesis
```

个性化设计不再是一次性交付的总文档，而是贯穿课程全过程的工程产物。

---

## 2. 核心产物

### 2.1 学生仓库产物

```text
spec/
  architecture/
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
      ADR-001-boot-chain.yaml
      ADR-002-user-pointer-policy.yaml
      ADR-003-syscall-before-ipc.yaml
    composition.yaml
    final-synthesis.yaml

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

### 2.2 云端课程产物

```text
Cloud Spec Service / course
  experiment
  problem
  design-space
  base-requirements
  stage-gates
  verification-policy
  evaluation-rubric
  ai-policy
  judge-policy
  interface-contracts
```

### 2.3 云端平台产物

```text
Cloud Spec Service / hidden
  hidden-test-plan
  fuzz-plan
  mutation-plan
  oracle-details
  anti-gaming-rules

Cloud Spec Service / derived
  normalized-design
  architecture-evolution-summary
  stage-review-report
  risk-model
  derived-verification-plan
  derived-test-matrix
  grading-evidence-map
```

学生仓库中不再保存课程规则目录或平台派生 Spec 目录。

---

## 3. 教师工作流

### 3.1 课程准备

教师定义课程边界，而不是给出唯一标准答案。

```text
创建课程
  ↓
在云端维护 course spec
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

教师维护的是云端 `stage-gates` 条目，而不是学生仓库里的本地文件。  
面向学生和 Agent 暴露的是当前阶段的公开投影。

示例：

```yaml
StageGates:
  - stage: architecture-seed
    required_artifacts:
      - spec/architecture/seed.yaml
    checks:
      - goal_scope_reasonable
      - non_goals_declared
      - no_label_only_design

  - stage: boot-minimum
    required_artifacts:
      - spec/architecture/slices/01-boot.yaml
      - spec/modules/boot/boot_entry.yaml
    checks:
      - boot_model_defined
      - qemu_boot_smoke
      - serial_banner_check

  - stage: memory-management
    required_artifacts:
      - spec/architecture/slices/02-memory.yaml
      - spec/modules/memory/page_allocator.yaml
    checks:
      - memory_invariants_declared
      - spec_lint_passed
      - page_allocator_tests_passed
```

### 3.2 阶段发布与审核

教师按课程阶段审核设计成熟度，而不是只看一次统一总设计。

| 阶段 | 教师审核重点 | 典型证据 |
|---|---|---|
| ArchitectureSeed | 方向是否合理，目标是否过大，non-goals 是否明确 | `seed.yaml`、DesignAgent 报告 |
| Boot | boot chain、入口约定、日志路径是否清楚 | boot slice、QEMU log |
| Memory | 物理页、保留区、虚拟内存计划是否自洽 | ModuleSpec、allocator tests |
| Trap / Privilege | trap frame、用户态、用户指针策略是否安全 | trap tests、invalid pointer tests |
| Execution | process/thread/task、调度、阻塞模型是否明确 | scheduler spec、runqueue invariant |
| Syscall / IPC | ABI、错误语义、权限边界是否具体 | syscall trace、IPC tests |
| Resource | fd/object/capability 生命周期是否一致 | composition tests |
| File / Service | namespace、VFS 或服务模型是否和资源模型一致 | namespace tests、service tests |
| Personalized Goal | 目标是否通过 SpecPatch 合法引入 | goal contract、benchmark |
| Final Synthesis | 最终设计能否从历史演化中追溯 | final-synthesis、timeline、report |

### 3.3 开发过程监督

每次学生提交后，平台运行：

```text
pull repository
  ↓
check stage artifacts
  ↓
load cloud stage gate
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
generate public feedback summary
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

### 3.4 最终评分

评分从“最终系统是否能运行”扩展为“设计演进是否真实、可验证、可解释”。

```yaml
EvaluationRubric:
  architecture_design: 20
  module_spec_quality: 15
  implementation_correctness: 25
  platform_derived_verification: 20
  evolution_and_debugging: 10
  documentation_and_ai_log: 10
```

---

## 4. 学生工作流

### 4.1 加入实验

```text
加入课程实验
  ↓
平台创建仓库
  ↓
平台注入项目模板、spec/ 骨架、CI 配置、.speclab.yml
  ↓
平台创建 Agent Workspace
  ↓
学生阅读课程要求摘要和 AI Policy 摘要
```

学生本地只看到项目相关 `spec/`，看不到完整云端课程规则和隐藏验证细节。

### 4.2 Stage 0：ArchitectureSeed

学生在本地维护：

```text
spec/architecture/seed.yaml
```

学生可以请求：

```bash
vos agent arch review spec/architecture/seed.yaml
```

Agent 只基于本地设计和当前公开课程约束给出审查意见，不替学生决定最终架构。

### 4.3 Stage 1 到 Stage N：递进式设计与实现

每一阶段都遵循同一模式：

```text
1. 更新当前 ArchitectureSlice
2. 更新相关 ModuleSpec / GoalSpec / CompositionSpec
3. 运行 spec lint / arch lint
4. 生成或修改实现
5. 运行公开验证
6. 接收平台返回的失败摘要
7. 根据反馈继续修正 spec 或代码
```

例如 memory 阶段：

```bash
vos spec lint spec/modules/memory/page_allocator.yaml
vos arch lint spec/architecture/slices/02-memory.yaml
vos verify public --stage memory-management
```

### 4.4 演化工作流

当学生引入新机制时，不直接改代码，而是先改本地 Spec：

```text
更新 spec/evolution/patch-*.yaml
  ↓
更新相关 ArchitectureSlice / ADR / CompositionSpec
  ↓
平台重新推导验证计划
  ↓
再允许 patch 进入 build / test / verify
```

### 4.5 Final Architecture Synthesis

课程末期，学生合成最终设计，而不是重写一份脱离历史的总设计。

最终综合依赖：

```text
spec/architecture/seed.yaml
spec/architecture/slices/**
spec/architecture/decisions/**
spec/architecture/composition.yaml
spec/architecture/final-synthesis.yaml
spec/reports/**
```

---

## 5. Agent 参与流程

Agent 的角色是阶段化辅助，而不是代替学生完成项目。

```text
GatewayAgent:
  识别课程、学生、项目、当前阶段、当前文件和任务类型；
  从云端获取公开约束投影和 agent-only 约束；
  记录云端 Spec 访问日志。

DesignAgent:
  审查当前 ArchitectureSlice，比较历史设计，提示设计冲突。

SpecAgent:
  检查当前阶段 ModuleSpec、InterfaceSpec、ConcurrencySpec。

ImplementationAgent:
  只根据已批准规格生成局部候选 patch。

VerificationAgent:
  根据当前阶段设计和云端策略派生测试、运行验证、生成证据。

DebugAgent:
  解释构建、QEMU、测试、Judge 日志。

KnowledgeBaseAgent:
  根据当前阶段和学生设计推荐教学材料，而不是完整答案。

ReviewAgent:
  审计 AI 使用、知识库引用、相似度风险和是否绕过测试。

ReportAgent:
  汇总阶段证据，帮助最终生成报告。
```

---

## 6. AI 使用边界

允许：

```text
- 解释课程要求摘要
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

## 7. 最终课程运行示例

```text
Week 1:
  学生提交 ArchitectureSeed。

Week 2:
  提交 Boot Slice，通过 qemu_boot_smoke 和 serial_banner_check。

Week 3:
  提交 Memory Slice 和 PageAllocator ModuleSpec。
  修复 double_free 失败并记录 AI 错误案例。

Week 4:
  提交 Trap / Privilege Slice，明确 copy_from_user 策略。

Week 5:
  提交 Execution Slice，实现基本调度。

Week 6:
  提交 Syscall Basic Slice，实现 write / exit。

Week 7:
  提交 Resource Slice，引入 fd table、object handle、refcount。

Week 8:
  通过 SpecPatch 引入 capability IPC。
  平台增加 invalid_capability_send、endpoint_close_wakeup 等私有验证。

Week 9:
  提交 Namespace / File Service Slice。

Week 10:
  提交 FinalArchitectureSynthesis、VerificationReport、AICollaborationLog。
  平台运行公开测试、隐藏测试、组合测试和个性化目标测试。
```

---

## 8. 总结

新的工作流可以概括为：

```text
教师在云端定义课程边界和验证策略；
学生在本地 spec/ 中递进式设计和实现；
Agent 基于本地 spec/ 和云端约束进行阶段化辅助；
平台根据设计动态派生公开验证和私有验证；
评分依据最终系统，也依据设计演化过程和证据链。
```
