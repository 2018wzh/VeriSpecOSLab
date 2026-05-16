# VeriSpecOSLab Spec 体系设计

> 面向 AI 辅助、规格驱动、可验证、可审计的系统类课程实验。  
> 本版将学生仓库中的 Spec 收敛为单一项目目录 `spec/`，同时把课程策略、隐藏验证规则和平台派生 Spec 迁移到云端 Spec Service，并通过权限投影按角色暴露。

---

## 1. 设计目标

VeriSpecOSLab 的 Spec 体系服务于如下闭环：

```text
Design → Spec → Patch → Build → Test → Verify → Feedback → Evolution
```

核心目标：

```text
1. 学生仓库中只保留与项目设计直接相关的 Spec。
2. 课程规则、隐藏测试和平台派生验证不进入学生仓库。
3. Agent 可以获得比学生更丰富的受控上下文，但不能突破审计。
4. 学生始终知道自己需要满足的公开性质，但看不到隐藏测试细节。
5. 教师可以独立升级课程规则、验证策略和评分证据映射，而不必批量修改学生仓库。
```

本设计不再强调“本地三层目录并存”，而强调：

```text
本地单层项目 Spec
+ 云端多类 Spec 服务
+ 按权限投影给学生、Agent 和教师
```

---

## 2. 核心原则

### 2.1 本地单层，逻辑分层

学生仓库中只保留一个 `spec/` 目录，作为学生项目设计的唯一可编辑本地真相。

但逻辑上，平台仍然区分三类信息：

```text
1. Project Spec
   学生项目设计、模块规格、目标、演化记录。

2. Course / Hidden Spec
   课程边界、StageGate、Judge Policy、隐藏测试、反作弊约束。

3. Derived Runtime Spec
   平台 Agent 根据项目设计和课程策略生成的风险模型、验证计划、证据映射。
```

区别在于：

```text
Project Spec 存在本地 repo 中；
Course / Hidden / Derived Spec 存在云端；
不同角色只看到各自允许的投影视图。
```

### 2.2 学生可见公开性质，不可见隐藏细节

学生不能查看隐藏测试源码、变异点、反作弊规则和完整 oracle 细节。  
但学生必须能看到：

```text
- 当前阶段要求
- 当前模块需要满足的公开性质
- 公开测试类别
- 失败摘要
- 已声明但尚未满足的设计约束
```

### 2.3 Agent 上下文更强，但必须可审计

Agent 可以读取云端受控 Spec，但必须记录：

```text
- 读取了哪些 Spec 类型
- 使用了哪些版本
- 哪些结论来自 agent-only 规则
- 向学生暴露了哪些公开摘要
```

### 2.4 云端 Spec 不进入学生仓库

以下内容不应出现在学生仓库：

```text
- 完整课程规则目录
- hidden test plans
- fuzz seeds
- mutation plans
- anti-gaming rules
- 完整 grading evidence map
- 平台内部风险权重
```

---

## 3. 总体模型

### 3.1 学生仓库视图

学生仓库只保留：

```text
repo/
  spec/
    architecture/
    modules/
    goals/
    evolution/
    reports/

  src/
  tests/
  tools/
  reports/
```

其中 `spec/` 是学生项目设计目录，不再使用旧的本地多层 Spec 目录命名。

### 3.2 云端 Spec Service 视图

云端维护三类服务化 Spec：

```text
Cloud Spec Service
  course/
    experiment
    problem
    design-space
    stage-gates
    verification-policy
    evaluation-rubric
    ai-policy
    judge-policy
    interface-contracts

  hidden/
    hidden-test-plan
    fuzz-plan
    mutation-plan
    oracle-details
    anti-gaming-rules

  derived/
    normalized-design
    risk-model
    derived-verification-plan
    derived-test-matrix
    review-questions
    grading-evidence-map
```

### 3.3 角色可见性

```text
学生:
  - 可读可写 repo/spec/**
  - 可读课程公开投影
  - 可读公开验证计划与失败摘要
  - 不可读 hidden/* 和 derived/* 的私有部分

Agent:
  - 可读写 repo/spec/**（受策略和审计约束）
  - 可读 course/* 的受控投影
  - 可读 hidden/* 和 derived/* 的 agent-only 部分
  - 不可绕过 Gateway 直接访问未授权云端内容

教师 / 助教:
  - 可查看全部本地与云端 Spec
  - 可配置课程策略与评分策略
```

---

## 4. 本地 `spec/` 目录设计

推荐目录结构：

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
      ADR-001-*.yaml
      ADR-002-*.yaml
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
    knowledge-base-reference-log.md
    student-verification-report.md
```

该目录中的所有内容都直接服务于项目设计、实现、验证和报告，不存放课程规则和平台内部控制面信息。

---

## 5. 本地 Project Spec 类型

### 5.1 ArchitectureSeed

文件：

```text
spec/architecture/seed.yaml
```

作用：

```text
- 定义项目起点
- 说明目标平台、参考系统、non-goals
- 为后续切片设计建立初始方向
```

### 5.2 ArchitectureSlice

文件：

```text
spec/architecture/slices/*.yaml
```

作用：

```text
- 描述课程每个阶段的局部设计
- 把阶段设计绑定到模块规格、实现和验证意图
- 作为 Agent 推导上下文的核心输入
```

### 5.3 ArchitectureDecisionRecord

文件：

```text
spec/architecture/decisions/ADR-*.yaml
```

作用：

```text
- 记录关键设计取舍
- 解释为什么选择某种机制而不是另一种
- 便于教师答辩和演化审计
```

### 5.4 ArchitectureCompositionSpec

文件：

```text
spec/architecture/composition.yaml
```

作用：

```text
- 描述跨模块组合不变量
- 防止只是把 Linux / L4 / Plan9 等概念拼接在一起
- 为组合测试和隐藏验证提供依据
```

### 5.5 ModuleSpec / InterfaceSpec / ConcurrencySpec

目录：

```text
spec/modules/**
```

作用：

```text
- 描述模块状态、接口、前后置条件、不变量、错误语义
- 对并发模块补充锁规则、原子性和 rely / guarantee
- 作为 patch 生成和验证的直接依据
```

### 5.6 GoalValidationContract

目录：

```text
spec/goals/**
```

作用：

```text
- 描述个性化目标，如兼容、优化、硬件移植、形式化增强
- 说明目标指标、正确性护栏和验证方式
```

### 5.7 SpecPatch

目录：

```text
spec/evolution/**
```

作用：

```text
- 管理架构和功能演化
- 在修改实现前先记录规格变化
- 触发平台重新生成验证计划
```

### 5.8 Project Reports

目录：

```text
spec/reports/**
```

作用：

```text
- 记录 AI 协作过程
- 记录知识库引用
- 汇总学生侧验证说明
```

---

## 6. 云端 Spec Service

### 6.1 Course Spec

Course Spec 由教师和平台维护，不进入学生仓库。

主要内容：

```text
- 实验说明
- 设计空间约束
- 阶段门禁
- 验证策略
- 评分规则
- AI 使用规则
- Judge Policy
- 接口合同
```

学生只应看到与当前阶段和当前任务相关的公开投影，而不是完整原始文件。

### 6.2 Hidden Verification Spec

Hidden Verification Spec 用于保证评测真实性和抗迎合测试能力。

主要内容：

```text
- hidden test plan
- fuzz plan 和 seed policy
- mutation plan
- hidden oracle details
- anti-gaming rules
```

这些内容只对平台、教师和受控 Agent 可见。

### 6.3 Derived Runtime Spec

Derived Runtime Spec 由平台 Agent 根据本地 `spec/` 和云端 Course Spec 动态生成。

主要内容：

```text
- normalized-design
- risk-model
- derived-verification-plan
- derived-test-matrix
- review-questions
- grading-evidence-map
```

学生只应看到这些产物的公开摘要：

```text
- 当前阶段需要满足哪些性质
- 当前公开测试矩阵
- 当前已识别的公开风险类别
- 当前需要补充的设计和验证证据
```

---

## 7. 投影与权限模型

建议定义四级可见性。

### 7.1 `student_editable`

```text
范围:
  repo/spec/**

权限:
  学生可读可写
  Agent 可读可提 patch
```

### 7.2 `student_readonly_summary`

```text
范围:
  当前 StageGate 公开摘要
  公开验证计划
  公开测试类别
  失败摘要

权限:
  学生可读不可改
  Agent 可读
```

### 7.3 `agent_only`

```text
范围:
  hidden-test-plan
  fuzz-plan private details
  mutation-plan
  anti-gaming rules
  private oracle bindings

权限:
  学生不可见
  Agent 受控可读
```

### 7.4 `staff_only`

```text
范围:
  完整评分细则
  相似度规则
  引用审计规则
  课程私有对照库

权限:
  仅教师和助教可见
```

---

## 8. Agent 上下文构造

Gateway 不应把整个仓库直接塞给模型，而应构造最小上下文包：

```text
AgentContext =
  本地 spec/**
  + 当前文件与选区
  + 当前阶段公开约束投影
  + 当前任务相关的 cloud hidden constraints
  + 最近验证日志与证据
  + 最近一次 SpecPatch 或 ADR
```

示例：当学生修改 `src/kernel/mm/page_allocator.c` 时，Agent 可见：

```text
spec/architecture/slices/02-memory.yaml
spec/architecture/decisions/ADR-001-memory-layout.yaml
spec/modules/memory/page_allocator.yaml
spec/modules/memory/memory_map.yaml
当前 memory 阶段的公开 StageGate 摘要
最近一次 vos verify stage memory-management 的公开证据
与 page allocator 相关的 hidden negative property 标签
```

学生自己界面只应看到：

```text
- memory 阶段公开要求
- 当前失败摘要
- 需要补充的公开不变量或测试义务
```

---

## 9. 运行时派生产物

平台 Agent 应将本地 `spec/` 转换为运行时产物，但这些产物默认不落在学生仓库中。

### 9.1 NormalizedDesign

作用：

```text
- 将 ArchitectureSeed / Slice / ADR / Composition 统一为机器可消费的设计摘要
- 为验证派生、风险建模和上下文检索提供统一入口
```

### 9.2 RiskModel

作用：

```text
- 根据学生设计识别高风险性质
- 决定验证重点和隐藏测试重点
```

### 9.3 DerivedVerificationPlan

作用：

```text
- 合并课程规则、项目设计和个性化目标
- 形成公开验证集和私有验证集
```

### 9.4 DerivedTestMatrix

作用：

```text
- 组织 public / generated / hidden / fuzz / benchmark / mutation 测试
- 形成统一测试矩阵
```

### 9.5 GradingEvidenceMap

作用：

```text
- 将评分项映射到设计、验证、日志和答辩证据
- 支持教师人工复核
```

---

## 10. 工作流

### 10.1 设计阶段

```text
学生维护 spec/architecture/**
    ↓
Gateway 读取当前阶段公开约束投影
    ↓
DesignAgent / SpecAgent 检查完整性和冲突
    ↓
平台生成 normalized-design 和 risk-model
```

### 10.2 实现阶段

```text
学生维护 spec/modules/** 与 src/**
    ↓
ImplementationAgent 根据 spec 生成局部 patch
    ↓
Gateway 记录其使用的云端规则和版本
    ↓
VerificationAgent 运行公开测试与私有验证
```

### 10.3 演化阶段

```text
学生先修改 spec/evolution/** 或相关 Slice / ADR
    ↓
平台更新 normalized-design
    ↓
平台重新生成验证计划和测试矩阵
    ↓
再允许核心实现 patch 进入验证
```

### 10.4 答辩与评分阶段

```text
教师查看本地 spec/**
    ↓
查看云端 derived evidence
    ↓
查看 hidden verification 摘要与风险提示
    ↓
结合答辩解释做最终判断
```

---

## 11. 审计要求

采用云端 Spec Service 后，日志必须补充以下字段。

### 11.1 Agent Cloud Access Log

```text
- spec_class: course | hidden | derived
- spec_name
- spec_version
- reason
- exposed_summary_to_student
- whether_used_for_patch
- whether_used_for_verification_feedback
```

### 11.2 AI Collaboration Log

```text
- 时间
- 任务
- 相关本地 spec
- 使用了哪些云端 Spec 类别
- 生成了什么 patch / 计划 / 解释
- 跑了哪些公开验证
- 是否触发了隐藏反馈摘要
- 学生是否确认并采纳
```

### 11.3 Knowledge / Reference Log

```text
- 使用了哪些知识库条目
- 是否包含代码片段
- 来源和许可证
- 学生如何改写
- 是否触发相似度风险
```

---

## 12. `vos` 接口约束

在该模型下，`vos` 也应改成“本地 `spec/` + 云端投影”的接口。

推荐保留：

```bash
vos spec lint spec/modules/memory/page_allocator.yaml
vos arch lint spec/architecture/seed.yaml
vos spec patch lint spec/evolution/patch-003.yaml
vos verify public
vos verify patch spec/evolution/patch-003.yaml
vos report generate
```

建议新增：

```bash
vos stage show
vos verify full
vos agent context
vos agent derive-summary
```

语义约束：

```text
vos stage show:
  只显示学生可见的公开阶段约束。

vos verify public:
  只运行学生可见验证。

vos verify full:
  仅平台 / CI / 教师使用，包含 hidden verification。

vos agent context:
  由 Gateway 组装，不直接暴露完整 hidden spec 内容。
```

---

## 13. 最小可落地版本

第一阶段建议只实现：

### 13.1 本地仓库

```text
spec/
  architecture/
  modules/
  goals/
  evolution/
  reports/
```

### 13.2 云端 Spec Service

```text
course:
  stage-gates
  verification-policy
  ai-policy

hidden:
  hidden-test-plan
  fuzz-plan

derived:
  normalized-design
  derived-verification-plan
  review-questions
```

### 13.3 Gateway 能力

```text
- 按角色投影公开摘要
- 向 Agent 注入 agent-only 约束
- 记录云端 Spec 访问日志
- 将隐藏验证结果摘要化返回给学生
```

---

## 14. 关键边界

```text
学生只维护项目设计，不维护课程策略。

课程规则、隐藏测试和派生验证不进入学生仓库。

Agent 可以看到更多上下文，但必须受 Gateway 策略约束并留下审计记录。

学生必须知道自己被要求满足哪些公开性质，但不应知道隐藏测试细节。

架构与模块演化必须先修改本地 spec，再进入 patch、build、test、verify。
```

---

## 15. 总结

本方案不再把旧的本地多层 Spec 目录同时放进学生仓库。新的组织方式是：

```text
本地仓库:
  单一项目 Spec 目录 spec/

云端平台:
  Course Spec
  Hidden Verification Spec
  Derived Runtime Spec

权限模型:
  按角色投影，而不是按文件平铺
```

这样可以同时满足四个目标：

```text
1. 学生仓库保持简洁，只保留项目设计真相。
2. 平台继续保有隐藏验证和评分控制能力。
3. Agent 能在受控范围内获得更强上下文。
4. 教学过程保持可验证、可解释、可审计。
```
