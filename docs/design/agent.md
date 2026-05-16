# SpecLab / VeriSpecOSLab Agent 设计文档

> 面向规格驱动、AI 辅助、可验证、可审计的系统类课程实验。  
> 本文档定义课程实验依赖的通用 Agent 架构、职责边界、知识库辅助教学机制，以及防止代码抄袭的策略。

---

## 1. 设计目标

SpecLab 的 Agent 体系不以“让 AI 替学生完成实验”为目标，而是将 AI 放入一个受规格、测试、验证、知识库和审计约束的教学闭环中。

核心闭环为：

```text
Design → Spec → Agent Assistance → Patch → Build → Test → Validate → Feedback → Report
```

本文档在 VeriSpecOSLab 原有 Agent 设计基础上进行通用化改造，使其可以扩展到操作系统、数据库、编译器、网络协议、运行时、硬件体系结构等系统类实验。

修订目标包括：

```text
1. Agent 职责通用化，避免与 OS 单一领域强绑定。
2. 通过 Domain Plugin 支持 OS / DB / Compiler / Network / Runtime / Hardware 等领域。
3. 增加 KnowledgeBaseAgent，作为辅助教学和参考学习入口。
4. 知识库按学生设计推荐设计文档、规格样例、参考代码片段、测试案例和反例。
5. 明确人与 AI 的边界，避免 AI 代写与代码抄袭。
6. 对知识库引用、AI 生成内容、代码相似度和学生改写说明进行审计。
```

核心原则：

```text
学生掌握设计；
AI 辅助理解、规格、实现、调试和报告；
规格约束生成；
测试发现错误；
验证提供证据；
知识库提供参考而非答案；
日志保障可审计；
教师保留最终评价权。
```

---

## 2. 设计依据

本 Agent 设计继承三个基本思想。

### 2.1 规格驱动

复杂系统不能只依赖自然语言提示开发。学生必须通过结构化规格描述：

```text
- 系统设计目标
- 模块边界
- 接口语义
- 前置条件 / 后置条件
- 不变量
- rely / guarantee
- 并发规则
- 错误语义
- 测试义务
- 个性化目标验证合约
```

Agent 的实现、测试、调试和审查都应围绕这些规格展开。

### 2.2 人机协作

AI 的角色不是替代学生，而是辅助学生完成以下工作：

```text
- 理解课程要求
- 学习参考设计
- 检查规格缺陷
- 生成局部候选 patch
- 生成测试建议
- 分析日志和失败原因
- 整理验证证据
- 辅助报告写作
```

学生仍必须对最终设计、代码、测试、报告和答辩负责。

### 2.3 可验证与可审计

每个核心修改都应能回答：

```text
1. 这段代码依据哪条规格？
2. AI 是否参与？如何参与？
3. 是否使用了知识库参考材料？
4. 是否直接复制了参考代码？
5. 运行了哪些测试？
6. 是否通过了验证？
7. 学生是否理解并能解释？
```

---

## 3. 总体架构

Agent 系统分为五层：

```text
Agent Gateway
  ├── Policy & Audit Layer
  ├── Context & Retrieval Layer
  ├── Universal SpecLab Agents
  ├── Domain Plugin Agents
  └── Knowledge Base Teaching Agents
```

整体调用链：

```text
IDE / Web / CLI
    ↓
Agent Gateway
    ↓
Policy Engine
    ↓
Context Builder
    ↓
Task Router
    ├── DesignAgent
    ├── SpecAgent
    ├── ImplementationAgent
    ├── VerificationAgent
    ├── DebugAgent
    ├── ReviewAgent
    ├── ReportAgent
    └── KnowledgeBaseAgent
            ↓
        Course Knowledge Base
        Reference Design Library
        Reference Spec Library
        Reference Code Library
        Debug Case Library
        Anti-pattern Library
```

对外接口建议采用 OpenAI-compatible API：

```http
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses
```

对内连接：

```text
- 本地项目 Spec
- 云端课程约束投影
- 云端隐藏验证约束
- 平台派生运行时 Spec
- Git 仓库
- CI 日志
- Judge 结果
- DevBox / Sandbox
- QEMU / Emulator
- 测试框架
- Benchmark
- 知识库
- 审计系统
```

---

## 5. SpecLab Agents

### 5.1 GatewayAgent

#### 定位

GatewayAgent 是 IDE、Web、CLI 与内部 Agent Runtime 之间的统一入口。

#### 职责

```text
- 接收 OpenAI-compatible 请求。
- 识别学生、课程、实验、项目、阶段、当前文件和任务类型。
- 调用 Policy Engine 执行权限控制。
- 构造上下文，包括当前文件、相关 Spec、测试、CI 日志、知识库材料。
- 将请求路由到具体 Agent。
- 标准化工具调用。
- 记录 AICollaborationLog。
- 记录 KnowledgeBaseReferenceLog。
- 对核心模块执行 spec-first / validation-first 策略。
```

#### 禁止事项

```text
- 不直接生成核心实现。
- 不绕过 Policy Engine 调用工具。
- 不暴露隐藏测试源码。
- 不修改评分。
- 不允许 Agent 读取其他学生私有仓库。
```

#### 人与 AI 边界

```text
学生负责提出任务和设计意图；
GatewayAgent 负责路由、上下文、权限和审计；
教师负责策略配置和最终评价。
```

---

### 5.2 DesignAgent

#### 定位

DesignAgent 是通用设计审查 Agent，用于审查学生的高层系统设计。

它不再只处理 OS 架构，而是支持不同系统类实验：

```text
OS：内核组织、地址空间、syscall / IPC、调度、文件系统。
DB：存储模型、索引、事务、恢复、并发控制。
Compiler：前端、IR、优化 pass、后端、运行时 ABI。
Network：协议状态机、包格式、重传、超时、安全属性。
Runtime：对象模型、GC、字节码、JIT、栈帧。
Hardware：ISA、流水线、cache、MMU、内存模型。
```

#### 输入

```text
- 学生设计草案
- ArchitectureSeed / ProjectSeed
- 当前 ArchitectureSlice / StageDesignSlice
- 已批准的历史 Slice / ArchitectureEvolutionTimeline
- ArchitectureDecisionRecord
- ArchitectureCompositionSpec / CompositionSpec
- TechStackSpec
- GoalValidationContract
- Course DesignSpaceSpec
- 相关知识库设计文档
```

#### 职责

```text
- 检查设计是否完整。
- 判断当前课程阶段需要哪些设计切片。
- 检查是否只是贴标签而缺少机制说明。
- 检查参考系统 borrowed / modified / rejected concepts 是否清晰。
- 检查 non-goals 是否明确。
- 检查模块边界是否合理。
- 检查机制组合是否冲突。
- 对比当前 Slice 与历史 Slice，发现设计漂移。
- 判断设计变化是否需要 SpecPatch。
- 检查阶段设计是否绑定测试和验证证据。
- 检查设计是否绑定验证目标、测试、benchmark 或 oracle。
- 根据学生设计向 KnowledgeBaseAgent 请求相关教学材料。
- 生成设计审查问题和修改建议。
```

#### 输出

```text
- DesignReviewReport
- 设计缺失项列表
- 机制冲突列表
- 可验证性绑定建议
- 需要学生确认的问题
- 推荐知识库阅读路径
```

#### 禁止事项

```text
- 不替学生决定最终设计。
- 不把学生设计强行改成标准答案。
- 不以固定 profile 代替学生个性化设计。
- 不直接生成完整实现。
```

#### 人与 AI 边界

```text
学生负责设计目标、机制选择和取舍理由；
AI 负责发现不完整、不一致、不可验证或冲突之处；
教师负责确认设计是否达到课程要求。
```

---

### 5.3 SpecAgent

#### 定位

SpecAgent 是通用规格 Agent，用于处理 ModuleSpec、InterfaceSpec、ConcurrencySpec、GoalValidationContract 和 SpecPatch。

#### 输入

```text
- ModuleSpec 草案
- InterfaceSpec / ABISpec
- ConcurrencySpec
- GoalValidationContract
- DesignSpec / CompositionSpec
- 相关接口代码
- 相关测试
- 知识库规格样例
```

#### 职责

```text
- 将自然语言设计整理为结构化规格。
- 检查 precondition / postcondition / invariant。
- 检查 rely / guarantee 是否匹配。
- 检查错误语义是否完整。
- 检查并发规则是否明确。
- 检查测试义务是否可执行。
- 检查规格是否与设计一致。
- 调用 KnowledgeBaseAgent 提供相似设计的规格样例。
- 生成 spec_lint 反馈。
```

#### 输出

```text
- 规格补全建议
- spec_lint 问题说明
- 可测试性建议
- rely / guarantee 依赖图
- 与参考规格的差异提示
```

#### 禁止事项

```text
- 不凭空决定模块语义。
- 不将模糊自然语言直接视为可执行规格。
- 不允许核心模块跳过规格进入实现。
- 不直接复制知识库规格作为学生规格。
```

#### 人与 AI 边界

```text
学生负责模块语义、接口语义、不变量选择；
AI 负责规格格式化、缺陷检查和可测试性提醒；
平台负责 spec_lint 和依赖一致性检查。
```

---

### 5.4 ImplementationAgent

#### 定位

ImplementationAgent 是通用实现 Agent。它不被定义为“代码代写 Agent”，而是“受规格约束的候选实现补丁生成 Agent”。

#### 输入

```text
- 已批准 ModuleSpec
- InterfaceSpec
- ConcurrencySpec
- SpecPatch
- 当前代码
- 相关测试
- 验证失败日志
- 允许级别的知识库片段
```

#### 职责

```text
- 根据已批准规格生成局部 patch。
- 对每个 patch 标注对应规格条款。
- 说明可能影响的不变量。
- 说明需要运行的测试。
- 对并发模块采用两阶段生成：
  1. 生成顺序逻辑。
  2. 根据 ConcurrencySpec 添加锁、原子操作、中断控制或引用计数。
- 根据 VerificationAgent 反馈进行 retry-with-feedback。
- 记录 AI 生成内容到 AICollaborationLog。
```

#### 输出

```text
- 候选 patch / diff
- 修改摘要
- 规格条款映射
- 风险说明
- 测试建议
- 未覆盖风险
```

#### 允许事项

```text
- 生成小范围函数实现。
- 生成局部模块补丁。
- 根据失败日志修复具体问题。
- 重构小范围代码。
- 生成测试代码草案。
```

#### 禁止事项

```text
- 不允许一次性生成完整项目。
- 不允许没有规格时生成核心模块。
- 不允许根据知识库参考代码直接改写成学生代码。
- 不允许删除测试。
- 不允许关闭 invariant checker。
- 不允许绕过权限检查或安全检查。
- 不允许直接提交未经验证的核心 patch。
```

#### 人与 AI 边界

```text
学生负责阅读、理解、修改和决定是否采纳 patch；
AI 负责生成候选 patch 和解释；
平台负责编译、测试、验证和审计；
最终代码责任属于学生。
```

---

### 5.5 VerificationAgent

#### 定位

VerificationAgent 是通用验证 Agent，负责将学生设计、规格和实现转化为验证证据。

#### 输入

```text
- Course VerificationPolicy
- Student DesignSpec
- ModuleSpec
- GoalValidationContract
- 源码仓库
- 测试矩阵
- CI 配置
- Judge 配置
```

#### 职责

```text
- 运行 design_lint / spec_lint / interface_lint。
- 运行 build。
- 运行 unit test / integration test。
- 运行 fuzz / benchmark / trace compare。
- 根据领域选择 oracle。
- 生成 VerificationReport。
- 将失败反馈给 DebugAgent 或 ImplementationAgent。
- 记录验证证据。
```

#### 领域化验证示例

```text
OS:
  QEMU、trap trace、syscall test、invariant checker。

DB:
  oracle replay、crash fuzz、transaction isolation test。

Compiler:
  differential testing、IR verifier、interpreter equivalence。

Network:
  packet trace、model checking、loss / reorder fuzz。

Runtime:
  bytecode verifier、GC stress、interpreter / JIT differential。

Hardware:
  trace compare、waveform assertion、ISA test。
```

#### 输出

```text
- VerificationReport
- 失败分类
- 日志摘要
- 相关规格条款
- 建议修正方向
- 可作为评分证据的 artifact 列表
```

#### 禁止事项

```text
- 不把“能编译”视为“满足规格”。
- 不因测试失败自动修改评分。
- 不删除失败测试。
- 不泄露隐藏测试实现。
- 不允许没有验证记录的核心 patch 进入最终提交。
```

#### 人与 AI 边界

```text
学生负责解释失败原因并决定修复方案；
AI 负责定位可能原因和提出候选修复方向；
平台负责真实执行验证并保存证据；
教师负责对争议性结果做最终判断。
```

---

### 5.6 DebugAgent

#### 定位

DebugAgent 是通用调试 Agent，负责解释构建、运行、测试、Judge 和验证失败日志。

#### 输入

```text
- build log
- runtime log
- QEMU / emulator log
- crash dump
- backtrace
- trace
- test failure
- benchmark result
- Judge summary
```

#### 领域化调试示例

```text
OS:
  QEMU log、trap frame、page fault、panic。

DB:
  crash recovery log、deadlock log、incorrect query result。

Compiler:
  parser error、IR verifier failure、wrong-code case。

Network:
  packet loss、state machine stuck、timeout failure。

Runtime:
  GC crash、bytecode verification failure、JIT mismatch。

Hardware:
  waveform mismatch、ISA trace mismatch、pipeline hazard。
```

#### 职责

```text
- 解释失败日志。
- 定位可能根因。
- 映射到相关 Spec 和代码位置。
- 给出最小修复建议。
- 建议补充测试。
- 调用 KnowledgeBaseAgent 检索相似 DebugCase。
```

#### 输出

```text
- 问题分类
- 高概率根因
- 相关代码位置
- 建议检查命令
- 最小修复建议
- 相关知识库案例
- 需要补充的测试或规格
```

#### 禁止事项

```text
- 不凭不足日志给出确定结论。
- 不直接重写大段代码。
- 不建议关闭异常检查、assert、panic 或 invariant checker。
- 不将参考修复代码直接作为学生提交代码。
```

#### 人与 AI 边界

```text
学生负责复现问题、阅读日志、执行修复；
AI 负责日志解释和候选根因排序；
平台负责保留原始日志和复现实验环境。
```

---

### 5.7 ReviewAgent

#### 定位

ReviewAgent 是通用审查 Agent，负责教学审查、AI 使用合规性、知识库引用合规性和抄袭风险提示。

#### 职责

```text
- 检查实现是否有规格依据。
- 检查是否直接复制知识库代码。
- 检查是否删除测试或绕过 checker。
- 检查是否提交无法解释的大段代码。
- 检查 AICollaborationLog 是否完整。
- 检查 KnowledgeBaseReferenceLog 是否完整。
- 检查提交代码与 ReferenceCodeKB 的相似度。
- 生成答辩问题。
- 标记需要人工复核的提交。
```

#### 输出

```text
- ReviewReport
- AI 使用合规性摘要
- 知识库引用摘要
- 相似度风险标记
- 需要人工复核的问题
- 答辩问题
```

#### 禁止事项

```text
- 不自动给最终分数。
- 不仅凭风格相似性判定作弊。
- 不读取其他学生私有代码作为相似度对比来源。
- 不向学生泄露隐藏测试。
```

#### 人与 AI 边界

```text
AI 负责初筛和证据整理；
教师 / 助教负责最终判断；
学生有权解释自己的设计、实现和参考材料使用方式。
```

---

### 5.8 ReportAgent

#### 定位

ReportAgent 是通用报告整理 Agent，负责帮助学生组织最终报告和阶段报告。

#### 职责

```text
- 根据设计、规格、测试、CI、Judge、日志生成报告结构。
- 汇总验证结果。
- 汇总 benchmark 结果。
- 汇总 AI 协作过程。
- 汇总知识库使用情况。
- 检查报告是否覆盖课程要求。
```

#### 报告必须包含

```text
1. Project Overview
2. Design Overview
3. Specification Summary
4. Implementation Summary
5. Verification Evidence
6. Knowledge Base Usage
7. AI Collaboration Log
8. Limitations
9. Future Work
```

#### Knowledge Base Usage 必须说明

```text
- 使用了哪些参考设计。
- 使用了哪些参考规格。
- 使用了哪些参考代码片段。
- 哪些内容只用于理解。
- 哪些内容影响了自己的设计。
- 自己与参考实现的关键差异。
- 是否存在直接复用代码。
- 运行了哪些测试证明自己的实现。
```

#### 禁止事项

```text
- 不编造实验结果。
- 不替学生写虚假的 AI 协作反思。
- 不隐藏失败案例。
- 不夸大系统能力。
```

#### 人与 AI 边界

```text
学生负责最终叙述、反思、设计解释和失败分析；
AI 负责整理材料、生成结构、检查遗漏；
平台负责提供真实日志和验证证据。
```

---

## 6. KnowledgeBaseAgent 设计

### 6.1 定位

KnowledgeBaseAgent 是教学知识库 Agent，负责根据学生设计、阶段和问题检索课程知识库，为学生提供对应的设计文档、参考规格、教学代码片段、测试案例、调试案例和反例。

它是教学辅助 Agent，不是代码代写 Agent。

一句话边界：

```text
KnowledgeBaseAgent 提供“可解释参考”，不提供“可提交答案”。
```

---

### 6.2 目标

```text
- 帮助学生理解设计空间。
- 按学生个性化设计推荐参考材料。
- 提供与设计相关的机制讲解。
- 提供规格样例，帮助学生编写自己的规格。
- 提供小型代码片段或伪代码，帮助理解实现路径。
- 提供反例和常见 bug，帮助学生避免错误。
- 提供测试思路，帮助学生验证自己的实现。
- 记录引用和使用情况，防止参考变成抄袭。
```

---

### 6.3 知识库内容组织

知识库分为六类。

#### 6.3.1 CourseConceptKB

用于保存基础概念和课程讲义。

```text
- 操作系统 / 数据库 / 编译器等基础概念
- 课程讲义
- 术语解释
- 常见设计模式
- 常见实现路径对比
```

#### 6.3.2 ReferenceDesignKB

用于保存参考设计文档。

```text
OS:
  - Linux-like syscall design
  - L4-style capability IPC
  - Plan9 namespace
  - microkernel service design
  - VFS design

DB:
  - B+Tree index design
  - WAL recovery design
  - MVCC design
  - buffer pool design

Compiler:
  - SSA IR design
  - type checker design
  - register allocation design
  - ABI lowering design

Network:
  - TCP-like state machine
  - reliable transport protocol
  - retransmission design

Runtime:
  - mark-sweep GC design
  - bytecode verifier design
  - stack frame layout

Hardware:
  - RISC-V ISA simulator design
  - pipeline hazard handling
  - cache coherence example
```

#### 6.3.3 ReferenceSpecKB

用于保存规格样例。

```text
- ModuleSpec 示例
- InterfaceSpec 示例
- ConcurrencySpec 示例
- GoalValidationContract 示例
- HardwarePortSpec 示例
- SpecPatch 示例
```

#### 6.3.4 ReferenceCodeKB

用于保存经过教学处理的代码材料。

```text
- 教学型最小代码片段
- 框架接口代码
- 伪代码
- 错误示例代码
- 公开授权的开源代码片段
- 教师编写的参考片段
```

完整参考实现默认不向学生开放，只供教师、助教和 ReviewAgent 使用。

#### 6.3.5 DebugCaseKB

用于保存调试案例。

```text
- QEMU page fault 案例
- lost wakeup 案例
- double free 案例
- invalid user pointer 案例
- WAL recovery bug 案例
- B+Tree split bug 案例
- compiler wrong-code 案例
- network timeout 案例
- GC root missing 案例
```

#### 6.3.6 AntiPatternKB

用于保存反例和常见错误。

```text
OS:
  - 直接解引用 user pointer
  - 持锁睡眠
  - fd / capability 权限混淆
  - endpoint close 后仍然唤醒失效对象

DB:
  - crash 前未写 WAL
  - B+Tree split 半完成状态暴露
  - buffer page 未 pin 就被淘汰

Compiler:
  - IR pass 删除有副作用指令
  - use before def
  - phi operand 与 predecessor 不匹配

Network:
  - 重传 timer 未取消
  - 状态机非法跳转

Runtime:
  - GC 未扫描某类 root
  - write barrier 缺失

Hardware:
  - load-use hazard 未 stall
  - cache line 状态转换错误
```

---

### 6.4 知识库条目格式

知识库条目应结构化，不能只是存放完整代码。

```yaml
KnowledgeItem:
  id: os-ipc-capability-endpoint-001
  domain: os
  topic: capability_ipc
  type: design_doc | spec_example | code_snippet | pseudocode | anti_pattern | debug_case
  difficulty: intermediate

  applies_to:
    architecture_features:
      - capability
      - ipc
      - endpoint
    modules:
      - ipc
      - capability
      - scheduler

  learning_goal:
    - understand endpoint send/recv rights
    - understand capability transfer boundary

  content_policy:
    visibility: student_visible
    code_reuse: explanation_only
    max_code_lines_per_response: 30
    require_attribution: true
    require_student_adaptation_note: true

  source:
    title:
    license:
    url_or_internal_ref:

  similarity_guard:
    fingerprint_enabled: true
    direct_copy_threshold: 0.35
    require_review_if_exceeded: true
```

---

### 6.5 KnowledgeBaseAgent 工作流

```text
学生提交或修改设计
    ↓
DesignAgent 归一化学生设计
    ↓
KnowledgeBaseAgent 根据设计检索相关材料
    ↓
返回：
  - 推荐阅读顺序
  - 对应设计文档
  - 参考规格
  - 关键伪代码
  - 反例和常见 bug
  - 可运行测试案例
    ↓
学生阅读、理解和改写
    ↓
ReviewAgent 审计参考使用情况
    ↓
AICollaborationLog / KnowledgeBaseReferenceLog 记录引用
```

示例：

```text
学生设计：
  Linux static ELF subset + capability IPC + per-process namespace

KnowledgeBaseAgent 返回：
  1. Linux static ELF loader 教学文档
  2. syscall ABI 参数传递说明
  3. capability endpoint IPC 设计说明
  4. fd 与 capability 边界对比文档
  5. namespace path resolution 反例
  6. copy_from_user 安全检查代码片段
  7. invalid_user_pointer 测试案例
```

---

### 6.6 KnowledgeBaseAgent 输出规范

#### 允许输出

```text
- 概念解释
- 设计对比
- 机制图
- 规格模板
- 小段伪代码
- 小段示例代码
- 测试思路
- 反例分析
- 阅读路线
- 与学生当前设计的差异提醒
```

#### 限制输出

```text
- 单次最多返回一个小函数或一个核心片段。
- 代码片段必须带教学说明。
- 必须说明不能直接提交。
- 必须标注来源。
- 必须提示学生写出自己的设计差异。
- 必须建议对应测试。
```

#### 禁止输出

```text
- 完整模块实现。
- 完整实验答案。
- 可直接复制进仓库的大段代码。
- 隐藏测试细节。
- 其他学生代码。
- 未授权闭源代码。
- 去除版权或来源说明的代码。
```

---

### 6.7 示例输出格式

当学生问：

```text
我想做一个 Linux syscall + capability IPC 的混合设计，fd 和 capability 应该怎么区分？
```

KnowledgeBaseAgent 应返回教学参考，而不是完整实现：

```text
推荐理解路径：

1. 先阅读 “fd as compatibility handle” 设计文档。
   重点理解：fd 是进程局部整数索引，适合 POSIX 兼容接口。

2. 再阅读 “capability as authority token” 设计文档。
   重点理解：capability 表示权限来源，适合 IPC endpoint、object access。

3. 对你的设计，建议采用：
   fd table: 面向 Linux syscall 兼容层
   capability table: 面向内部权限控制
   object manager: 统一生命周期和 refcount

4. 需要在 ArchitectureCompositionSpec 中声明：
   - every fd maps to one live object handle
   - fd close decrements object refcount
   - IPC send requires endpoint send capability
   - fd cannot bypass capability permission

5. 参考伪代码只展示权限检查结构，不能直接提交：

   lookup_fd(fd)
     -> object_handle

   check_cap(task, endpoint, SEND)
     -> allow / deny

   ipc_send(endpoint, msg)
     requires SEND capability
     does not accept fd as authority

6. 建议测试：
   - invalid_fd_permission
   - invalid_capability_send
   - fd_close_refcount
   - endpoint_close_wakeup
```

---

## 7. Domain Plugin Agents

通用 Agent 不直接内置所有领域知识，而是通过 Domain Plugin 扩展。

### 7.1 OSPluginAgent

```text
- 检查 boot、trap、memory、scheduler、syscall、IPC、VFS 等规格。
- 检查 user pointer safety、capability invariant、fd lifetime。
- 绑定 QEMU、trap trace、syscall test、invariant checker。
- 处理 page fault、panic、linker script、ELF loader 等调试。
```

### 7.2 DBPluginAgent

```text
- 检查 page、buffer pool、index、transaction、WAL、recovery 规格。
- 检查 crash consistency、transaction isolation、durability。
- 绑定 oracle replay、crash fuzz、isolation test。
- 处理 recovery failure、deadlock、index corruption 等调试。
```

### 7.3 CompilerPluginAgent

```text
- 检查 grammar、type system、IR、optimization pass、backend 规格。
- 检查 semantic preservation、IR validity、ABI convention。
- 绑定 IR verifier、source/IR interpreter differential testing。
- 处理 parser error、wrong-code、ABI mismatch 等调试。
```

### 7.4 NetworkPluginAgent

```text
- 检查 packet format、state machine、timeout、retry、安全属性。
- 绑定 packet trace、model checking、loss/reorder fuzz。
- 处理协议状态卡死、重传错误、超时错误等调试。
```

### 7.5 RuntimePluginAgent

```text
- 检查 object model、bytecode、stack frame、GC、JIT 规格。
- 绑定 bytecode verifier、GC stress、interpreter/JIT differential。
- 处理 GC crash、root missing、JIT guard mismatch 等调试。
```

### 7.6 HardwarePluginAgent

```text
- 检查 ISA semantics、pipeline invariant、cache、MMU、memory model。
- 绑定 trace compare、waveform assertion、ISA tests。
- 处理 hazard、coherence、translation、interrupt 等调试。
```

---

## 8. 人与 AI 的边界

### 8.1 学生必须负责

```text
1. 选择系统设计目标和技术栈。
2. 说明参考系统、借鉴机制、修改机制和拒绝机制。
3. 编写并维护 DesignSpec / ArchitectureSeed / ArchitectureSlice。
4. 编写并维护 CompositionSpec。
5. 确定核心模块语义和不变量。
6. 阅读并理解 AI 生成的代码。
7. 区分知识库参考内容和自己的实现。
8. 运行测试并解释失败。
9. 对最终代码、报告和答辩负责。
10. 记录 AICollaborationLog。
11. 记录 KnowledgeBaseReferenceLog。
12. 至少分析一个 AI 或参考实现导致的错误案例。
```

### 8.2 AI 可以负责

```text
1. 解释课程 Spec。
2. 推荐知识库材料。
3. 检查设计草案。
4. 发现设计组合冲突。
5. 补全规格模板。
6. 生成局部候选 patch。
7. 生成测试草案。
8. 分析构建、运行、CI、Judge 日志。
9. 提出 spec patch 建议。
10. 生成验证计划草案。
11. 整理报告结构。
```

### 8.3 AI 不得负责

```text
1. 一次性生成完整系统。
2. 跳过规格直接生成核心模块。
3. 替学生决定最终设计。
4. 提供完整实验答案。
5. 提供可直接提交的大段参考代码。
6. 删除测试以通过实验。
7. 绕过 invariant checker。
8. 伪造 benchmark、日志或硬件 bring-up 结果。
9. 隐藏 AI 参与过程。
10. 替教师给最终成绩。
11. 泄露隐藏测试。
12. 读取或利用其他学生私有实现。
```

---

## 9. 防止代码抄袭的边界设计

### 9.1 参考代码分级

| 等级 | 类型 | 学生可见 | 可直接复制 | 要求 |
|---|---|---:|---:|---|
| L0 | 概念说明 | 是 | 不涉及 | 可自由阅读 |
| L1 | 伪代码 | 是 | 否 | 必须自行实现 |
| L2 | 小型教学片段 | 是 | 部分允许 | 必须注明来源和改写点 |
| L3 | 框架接口代码 | 是 | 允许 | 作为课程模板使用 |
| L4 | 完整参考实现 | 默认不可见 | 否 | 仅教师 / 助教可见 |
| L5 | 其他学生代码 | 禁止 | 禁止 | 不进入学生知识库 |

---

### 9.2 按阶段控制输出粒度

```text
设计阶段：
  输出设计文档、机制对比、规格模板，不输出实现代码。

规格阶段：
  输出 ModuleSpec / InterfaceSpec / ConcurrencySpec 示例，不输出完整实现。

实现阶段：
  输出伪代码、小片段、接口使用示例，不输出完整模块。

调试阶段：
  输出错误原因、定位方法、相关反例，不直接替换整段代码。

报告阶段：
  输出报告结构和引用说明，不编造贡献。
```

---

### 9.3 ReferenceUseAudit

平台应实现 ReferenceUseAudit，用于追踪参考材料使用情况和相似度风险。

```yaml
ReferenceUseAudit:
  enabled: true

  track:
    - viewed_knowledge_items
    - returned_code_snippets
    - copied_snippet_hash
    - student_commit_diff
    - ai_generated_patch

  similarity_check:
    compare_against:
      - ReferenceCodeKB
      - CourseTemplateCode
      - PublicExampleCode
    ignore:
      - required_interfaces
      - constant_definitions
      - boilerplate
    flag_if:
      continuous_match_lines: ">= 12"
      token_similarity: ">= 0.35"
      structure_similarity: ">= 0.50"

  required_student_explanation:
    - why_reference_used
    - what_was_changed
    - how_design_differs
    - what_tests_validate_it
```

被标记不等于作弊，但必须进入 ReviewAgent 和教师复核。

---

### 9.4 AICollaborationLog 新增字段

```markdown
## Knowledge Base Reference

- Knowledge item id:
- Type: design_doc / spec_example / code_snippet / anti_pattern / debug_case
- Why I used it:
- What I learned:
- What I copied directly:
- What I changed:
- How my design differs:
- Tests I ran:
- Risk of over-reuse:
```

---

### 9.5 ReviewAgent 抄袭风险判断原则

ReviewAgent 只能进行风险提示，不能单独判定作弊。

风险提示依据包括：

```text
- 是否有大段连续代码与 ReferenceCodeKB 相同。
- 是否缺少引用说明。
- 是否缺少设计差异说明。
- 是否无法解释代码。
- 是否与知识库示例相似但未运行对应测试。
- 是否在短时间内提交大规模完整模块。
```

人工复核时应考虑：

```text
- 是否属于课程框架代码。
- 是否属于接口、常量、样板代码。
- 是否有合理引用。
- 是否有学生改写、扩展和测试证据。
- 学生是否能在答辩中解释。
```

---

## 10. Agent 权责矩阵

| Agent | 通用职责 | 领域插件职责 | 知识库访问 | 是否可生成代码 | 抄袭风险控制 |
|---|---|---|---|---:|---|
| GatewayAgent | 路由、权限、审计 | 选择领域插件 | 记录访问 | 否 | 强制日志 |
| DesignAgent | 设计审查 | OS / DB / Compiler 等设计检查 | 可检索设计文档 | 否 | 不输出完整实现 |
| SpecAgent | 规格检查 | 领域规格 lint | 可检索规格示例 | 否 | 示例需改写 |
| ImplementationAgent | 生成局部 patch | 调用领域工具链 | 只能看允许级别代码 | 是，受限 | patch 相似度检查 |
| VerificationAgent | 运行验证 | 领域 oracle / fuzz | 可读取测试案例 | 否 | 不泄露隐藏测试 |
| DebugAgent | 日志诊断 | 领域错误分类 | 可读取 DebugCaseKB | 小片段 | 禁止整段替换 |
| KnowledgeBaseAgent | 教学检索与解释 | 按领域推荐材料 | 主责 | 只输出片段 / 伪代码 | 引用与相似度审计 |
| ReviewAgent | 合规审查 | 领域审查问题 | 读取引用记录 | 否 | 主责 |
| ReportAgent | 报告整理 | 领域报告模板 | 读取引用记录 | 否 | 要求说明参考使用 |

---

## 11. 典型工作流

### 11.1 递进式设计工作流

```text
学生提交 ArchitectureSeed
    ↓
DesignAgent 检查初始方向与 non-goals
    ↓
平台发布当前 StageGate 的公开投影
    ↓
学生提交当前阶段 ArchitectureSlice
    ↓
KnowledgeBaseAgent 推荐对应参考设计文档
    ↓
学生阅读并修改自己的阶段设计
    ↓
DesignAgent 检查阶段冲突与组合冲突
    ↓
VerificationAgent 派生当前阶段验证计划
    ↓
ReviewAgent 记录知识库引用
    ↓
教师 / 助教阶段审核
```

---

### 11.2 规格阶段工作流

```text
学生编写 ModuleSpec / InterfaceSpec
    ↓
SpecAgent 检查规格完整性
    ↓
KnowledgeBaseAgent 提供参考规格样例
    ↓
学生改写为自己的规格
    ↓
VerificationAgent 运行 spec_lint
    ↓
TestGen 逻辑由 VerificationAgent 或 Domain Plugin 派生测试义务
    ↓
ReviewAgent 检查是否直接复制参考规格
```

---

### 11.3 实现阶段工作流

```text
学生选择已批准规格
    ↓
ImplementationAgent 生成局部候选 patch
    ↓
VerificationAgent 编译和测试
    ↓
DebugAgent 分析失败
    ↓
学生修改规格或代码
    ↓
ReferenceUseAudit 检查 patch 与知识库代码相似度
    ↓
AICollaborationLog 记录 AI 参与
    ↓
提交阶段性结果
```

---

### 11.4 调试阶段工作流

```text
测试或 Judge 失败
    ↓
DebugAgent 读取日志
    ↓
KnowledgeBaseAgent 检索相似 DebugCase
    ↓
DebugAgent 输出根因候选和检查路径
    ↓
学生修复
    ↓
VerificationAgent 重新验证
    ↓
ReviewAgent 检查是否直接复制参考修复代码
```

---

### 11.5 个性化目标工作流

```text
学生提交 GoalValidationContract
    ↓
DesignAgent 检查目标与设计是否一致
    ↓
KnowledgeBaseAgent 推荐相关设计和 benchmark 案例
    ↓
VerificationAgent 绑定 oracle / benchmark / trace compare
    ↓
学生实现目标
    ↓
VerificationAgent 验证 correctness guard 与目标指标
    ↓
ReportAgent 整理结果和 tradeoff 分析
```

---

## 12. 日志与审计要求

所有 Agent 会话必须写入 AICollaborationLog。

### 12.1 AICollaborationLog 基本字段

```text
- 时间
- Agent 类型
- 相关规格文件
- 学生输入摘要
- AI 输出摘要
- 学生采纳内容
- 学生修改内容
- 运行的测试
- 失败与修复过程
- 是否影响最终提交
```

### 12.2 KnowledgeBaseReferenceLog 字段

```text
- Knowledge item id
- 知识库条目类型
- 返回内容摘要
- 是否包含代码片段
- 代码片段行数
- 来源和许可证
- 学生是否引用到报告
- 学生是否说明改写点
- 是否触发相似度风险
```

### 12.3 核心模块必须可追溯

对核心模块，每个提交应能追溯：

```text
- 对应设计规格
- 对应模块规格
- 是否使用知识库参考
- 是否使用 AI patch
- 运行了哪些测试
- 是否通过验证
- 是否有未解决风险
```

---

## 13. 权限策略

| 操作 | 学生侧 Agent | 教师侧 Agent | 平台自动执行 |
|---|---:|---:|---:|
| 读取课程公开 Spec | 允许 | 允许 | 允许 |
| 读取本人仓库 | 允许 | 允许 | 允许 |
| 读取其他学生仓库 | 禁止 | 受控允许 | 禁止 |
| 读取隐藏测试源码 | 禁止 | 允许 | 允许 |
| 读取知识库设计文档 | 允许 | 允许 | 允许 |
| 读取知识库完整参考实现 | 禁止 | 允许 | 受控允许 |
| 生成规格草案 | 允许 | 允许 | 允许 |
| 生成代码 patch | 允许，受限 | 不建议 | 允许但需审计 |
| 直接提交代码 | 禁止，默认只生成 diff | 禁止 | 禁止 |
| 运行构建 / 测试 | 允许 | 允许 | 允许 |
| 提交 Judge | 允许 | 允许 | 允许 |
| 修改测试结果 | 禁止 | 禁止 | 禁止 |
| 修改评分 | 禁止 | 人工操作 | 禁止 |
| 生成最终报告草案 | 允许 | 允许 | 允许 |
| 伪造日志 / benchmark | 禁止 | 禁止 | 禁止 |

---

## 14. 最小可落地版本

### 14.1 MVP Agent

建议第一阶段实现：

```text
1. GatewayAgent
2. DesignAgent
3. SpecAgent
4. KnowledgeBaseAgent
5. ImplementationAgent
6. VerificationAgent
7. ReviewAgent
```

### 14.2 MVP 知识库

第一阶段知识库包含：

```text
1. CourseConceptKB
2. ReferenceDesignKB
3. ReferenceSpecKB
4. AntiPatternKB
5. DebugCaseKB
```

ReferenceCodeKB 初期只开放：

```text
- 伪代码
- 小函数片段
- 框架接口
- 错误示例
```

完整参考实现只给教师和助教使用，不向学生开放。

### 14.3 MVP 审计

必须实现：

```text
- AICollaborationLog
- KnowledgeBaseReferenceLog
- 代码片段输出记录
- 基础相似度检查
- ReviewAgent 风险报告
```

---

## 15. 课程 AI Policy 建议文本

建议写入课程规则：

```text
学生可以使用 Agent 和知识库理解设计、学习规格写法、参考小型代码片段、生成测试思路和调试问题。

学生必须对最终设计、代码、测试、报告和答辩负责。

学生使用知识库中的设计、规格或代码片段时，必须记录来源、说明学习目的、说明自己的改写点和设计差异，并提供对应测试证据。

学生不得直接复制完整参考实现，不得提交无法解释的 AI 生成代码，不得删除测试或绕过验证工具。

Agent 不得向学生提供完整实验答案，不得暴露隐藏测试，不得读取其他学生私有代码，不得伪造日志、benchmark 或验证结果。

平台将记录 Agent 使用和知识库引用，并对提交内容进行参考代码相似度审计。相似度风险标记不自动等同于作弊，但需要学生解释，并由教师或助教人工复核。
```

---

## 16. 总结

修订后的 Agent 体系从 OS 专用设计升级为 SpecLab 通用设计：

```text
DesignAgent：审查系统设计。
SpecAgent：审查和完善结构化规格。
ImplementationAgent：生成受规格约束的局部候选 patch。
VerificationAgent：执行验证并生成证据。
DebugAgent：分析失败日志和调试案例。
ReviewAgent：审查 AI 使用、知识库引用和抄袭风险。
ReportAgent：整理报告和验证证据。
KnowledgeBaseAgent：按学生设计提供教学参考材料。
Domain Plugin Agents：为 OS / DB / Compiler / Network / Runtime / Hardware 提供领域能力。
```

其中，KnowledgeBaseAgent 是新增的教学核心组件。它按照学生的个性化设计，提供对应设计文档、参考规格、教学代码片段、测试思路和反例案例，帮助学生理解和开发；同时通过片段化输出、权限分级、引用记录、相似度审计和人工复核，避免参考代码演变为代码抄袭。

最终目标不是让 AI 替学生完成实验，而是让学生在 AI 和知识库辅助下，完成一个可解释、可验证、可审计、具有个人设计特色的系统类课程项目。

