# VeriSpecOSLab 比赛设计文档大纲

> **赛事**：2026 年全国大学生计算机系统能力大赛·操作系统设计赛（全国赛）
> **项目**：VeriSpecOSLab —— AI 辅助、规格驱动的个性化操作系统教学实验方案
> **三条主线**：学生个性化设计（🏗️） / AI Agent 受控协作（🤖） / 教师角色升维（👨‍🏫）

---

## 三条主线的核心叙事

| 主线 | 核心命题 | 一句话 | 变革 |
|------|---------|--------|------|
| 🏗️ 学生·个性化 | 50 个学生如何写出 50 个不同的 OS？ | "我设计我自己的 OS" | 从"补代码"到"做设计" |
| 🤖 Agent·受控协作 | AI 能写内核的时代，如何确保学生真学到了？ | "AI 在约束下辅助" | 从"自由代写"到"受控协作" |
| 👨‍🏫 教师·角色升维 | 教师如何从重复劳动中解放，聚焦设计指导？ | "我审视设计思维，而非检查代码" | 从"代码检查员"到"设计导师" |

**依存关系**：
- 🏗️个性化 → 👨‍🏫教师：千人千面让教师能"审视设计思维"而非"对比代码相似度"
- 🤖Agent → 👨‍🏫教师：自动验证/诊断/KB 把教师从重复劳动中解放
- 👨‍🏫教师 → 🤖Agent：StageGate/AI Policy 是教师制定的 AI 治理规则
- 👨‍🏫教师 → 🏗️个性化：阶段审核+ADR 评价引导学生在设计空间中前行
- 🤖Agent → 🏗️个性化：50 条路需要 50 种辅助，Agent 让个性化可规模化
- 🏗️个性化 → 🤖Agent：不同架构下 Agent 产出不同，教师审查的是设计思维而非 Agent 的代码质量

**三线交汇点**：`OperationContract`（操作契约）——学生在这里表达"我的设计"（个性化），Agent 在这里接受"我的边界"（受控协作），教师在这里审查"设计是否合理、Agent 是否越界"（角色升维）。

---

# 材料一：技术方案设计文档大纲

> 13 章，4 大部分。每章标注主要服务的主线，关键处设"三线交汇"小节。

---

## 第一章 项目概述：三个根本问题，三条回答 🏗️🤖👨‍🏫

### 1.1 项目名称与定位

- **VeriSpecOSLab**：AI 辅助、规格驱动的个性化操作系统教学实验方案
- 名称四要素：Veri（可验证）+ Spec（规格驱动）+ OS（操作系统）+ Lab（教学实验）
- 一句话核心主张："以规格约束 AI，以验证保障正确，以架构设计训练系统掌控能力"

### 1.2 三个根本问题与三条回答

| 谁在问 | 问题 | VeriSpecOSLab 的回答 |
|--------|------|---------------------|
| 学生 | 我能做出一个真正属于我的 OS 吗？ | **个性化架构设计**——5 维度自主设计空间，ArchitectureSeed 定义"我的 OS" |
| 时代 | AI 能写代码了，学生还需要学什么？ | **Agent 受控协作**——7 身份 + StageGate + 审计，AI 是工具而非替代品 |
| 教师 | 50 个学生 50 个 OS，我怎么教、怎么看、怎么评？ | **教师角色升维**——从重复劳动中解放，聚焦设计思维审查 |

### 1.3 方案总览图

```text
                     ┌── 学生个性化设计 ──┐
                     │  ArchitectureSeed   │
                     │  ADR / Slice        │
                     │  GoalContract       │
                     └────────┬───────────┘
                              │ 规格约束
                              ▼
┌──────────────────────────────────────────────────┐
│              vos 工具链 + Agent 运行时            │
│                                                  │
│  Spec Layer → Planning → Execution → Evidence    │
│       ↑                          ↓               │
│  Agent (7身份+能力包) ←→ 验证 (6层)              │
└──────────────────────────────────────────────────┘
                              │
                              ▼
                     ┌────────┴───────────┐
                     │   教师控制面        │
                     │   StageGate 配置    │
                     │   AI Policy 管理    │
                     │   设计审核 + 评分    │
                     │   Analytics 驾驶舱  │
                     └────────────────────┘
```

---

## 第二章 背景与问题分析 🏗️🤖👨‍🏫

### 2.1 学生端困境：OS 实验的"千人一面"

- **MIT 6.S081 (xv6)**：限定类 Unix 宏内核形态，约 9000 行源码框架供学生补全。学生关注"怎么实现教师的答案"，而非"为什么这是我的设计"。
- **清华大学 rCore**：Rust 微内核框架，教师预设架构。个性化空间限于框架内填空。
- **症结**：学生学的是"在别人框架里写代码"，没学到"为什么框架长这样"。教师看到的是千人一面的补全代码，无法判断学生的真实设计能力。

### 2.2 教师端困境：两大被忽视的痛处

**痛处一：大量时间消耗在低价值重复劳动上**

- 帮学生排查内存越界、页表配置错误、Makefile 语法问题
- 反复回答"为什么我的 QEMU 启动不了""怎么安装 RISC-V 工具链"
- 维护各平台的安装指南附录——"在我电脑上能跑"是传统 OS 实验最常见的教学障碍
- **结果**：助教变成了"高级调试员"和"IT 支持"，真正的设计指导反而没有时间

**痛处二：评分缺乏设计维度的客观依据**

- 传统实验只看到最后一次提交的代码能不能跑通测试
- 看不到学生的设计思维过程——为什么选这个数据结构？有没有考虑过替代方案？取舍的理由是什么？
- 无法区分"真懂"（理解原理后独立设计）和"刚跑通"（照搬参考实现或 AI 代写）
- **结果**：教师的专业判断力被浪费在"这份代码和其他 49 份像不像"的比较上

### 2.3 AI 时代的双重挑战

- **对学生的挑战**：AI 越强，跳过思考的诱惑越大——学生可能变成 prompt engineer 而非系统设计师
- **对教师的挑战**：AI 代写的代码从最终产物中无法识别——学术诚信面临新威胁
- 放任的后果：学生丧失学习动机，教师丧失评价依据
- 禁止的后果：学生失去最有价值的学习工具
- **我们的回答**：不禁止 AI，也不放任 AI——用治理框架让 AI 成为透明、可控、可审计的协作者

### 2.4 相关工作综合对比表

| 对比维度 | MIT 6.S081 | rCore | 裸 AI 编程 | **VeriSpecOSLab** |
|---------|-----------|-------|-----------|-------------------|
| 内核形态自由度 | 固定（宏内核） | 固定（微内核） | 不限 | **5 维度自主设计** |
| AI 使用方式 | 未涉及 | 未涉及 | 无约束 | **7 身份 + 能力包受控** |
| AI 治理机制 | 无 | 无 | 无 | **StageGate + 审计链路** |
| 验证层次 | 公开测试 | 公开测试 | 无 | **6 层（public→fuzz）** |
| 个性化目标 | 不支持 | 不支持 | 无系统支持 | **10 类 + GoalContract** |
| 过程性评价 | 无 | 无 | 无 | **commit ledger + evidence map** |
| 学术诚信保障 | 人工判断 | 人工判断 | 无 | **Agent 审计链路** |
| 教师设计审查 | 无专门支持 | 无专门支持 | 无 | **ArchitectureSlice + ADR 审核** |
| 教学分析 | 无 | 无 | 无 | **5 类 Analytics 输出** |

---

## 第三章 核心设计理念：三线如何协同 🏗️🤖👨‍🏫

### 3.1 范式转变全景图——三条线各自的转变

**学生线**：
```text
传统：教师给框架 → 学生补代码 → 跑通测试 → 期末交
现在：学生提架构 → 写规格 → Agent 受控辅助 → 持续验证 → 设计演化
```

**Agent 线**：
```text
传统：AI 作为自由代码生成器（或完全禁止）
现在：AI 作为受控协作开发者——身份绑定 + 能力包 + 阶段门禁 + 审计
```

**教师线**：
```text
传统：检查代码过没过测试 + 帮学生 debug + 期末统一评分
现在：审核设计文档 + 配置治理规则 + 差异化指导 + 基于过程证据的评价
```

### 3.2 三条线的相互依存关系（核心论述）

本节是全文最重要的理论贡献。六对依存关系构成一个不可分割的整体：

**(1) 🏗️个性化 → 👨‍🏫教师：千人千面赋予教师"审视设计思维"的可能**

如果所有学生做同一个内核、填同一套代码缺口，教师只能看"代码对不对"——这只需要一个测试脚本就能判断，教师的专业判断力没有用武之地。个性化让每个学生的设计决策各不相同：学生 A 借鉴 L4 的 Capability 但拒绝了其 IPC 模型，学生 B 保留了 L4 IPC 但选择了另一种资源抽象。教师对比的不是代码相似度，而是设计思维的深度和理由的充分性。

**(2) 🤖Agent → 👨‍🏫教师：Agent 把教师从重复劳动中解放**

自动验证扛掉重复性检查（"48 个公开测试不用教师一个个跑"），自动诊断扛掉常见 debug（"page fault 的原因不用教师帮学生查"），知识库扛掉基础问答（"怎么配 QEMU 不用教师反复回答"）。教师被解放出来的时间和精力，投向只有教师才能做的事：审视学生的设计决策、讨论架构权衡、引导设计方向。

**(3) 👨‍🏫教师 → 🤖Agent：教师是 Agent 治理规则的制定者**

教师通过 StageGate 配置 Agent 的能力释放。教师通过 AI Policy 划清 Agent 的行为边界——"这个实验我想让学生自己设计调度器，所以禁止 Agent 在 process 阶段生成调度代码"。教师不是对 AI 说"不准"，而是说"什么时候可以、可以到什么程度"。

**(4) 👨‍🏫教师 → 🏗️个性化：教师是设计思维的引路人**

教师通过阶段审核（ArchitectureSeed 方向审核 → ArchitectureSlice 设计审核 → ADR 决策审核）引导学生在设计空间中前行。教师的差异化指导——对零基础学生聚焦"理解原理"，对有经验学生深入挑战问题——让每个学生在自己的设计路径上得到最需要的帮助。

**(5) 🤖Agent → 🏗️个性化：Agent 让个性化可规模化**

50 个学生走 50 条不同的设计路线，传统教学力量（一个教师 + 几个助教）无法为每条路线提供足够的辅助。Agent 可以为每个学生的设计路径提供定制化的规格审查、代码生成、错误诊断和知识问答——让个性化不再是一对一辅导才能实现的奢侈。

**(6) 🏗️个性化 → 🤖Agent：个性化让 Agent 使用可评价**

如果所有学生做同一个内核，Agent 代写的代码千篇一律，教师无法判断谁的代码是 AI 写的。但在个性化架构下，每个学生的 ArchitectureSeed、ADR、ModuleSpec 都是独一无二的——Agent 只能在这些约束下生成代码。教师审查的是"这个学生的设计思维是否体现在这些代码中"，而非"这段代码和其他 49 份像不像"。

### 3.3 交汇点：OperationContract = 三线汇合处

```text
           学生写 OperationContract
           "我的 kalloc 必须在无可用物理页时返回 NULL，而不是 panic"
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
  🏗️ 学生          🤖 Agent        👨‍🏫 教师
  "这是我的       "这是我的       "这个设计
   设计意图"      执行边界"       是否合理？
                                 Agent 是否
                                 越界了？"
```

### 3.4 六个核心教学能力目标

| 能力 | 🏗️ 学生产出 | 🤖 Agent 角色 | 👨‍🏫 教师审查 |
|------|------------|-------------|------------|
| 定义什么是正确 | ModuleSpec + OperationContract | 格式检查与一致性审查 | 审查规格是否反映了设计意图 |
| 说明为什么这样设计 | ArchitectureSeed + ADR | 参考系统对比建议 | 追溯决策过程，判断理由充分性 |
| 约束 AI 如何实现 | codegen.targets 绑定 | **读 OperationContract 作为执行边界** | 检查 Agent 是否在边界内工作 |
| 验证实现是否满足规格 | 验证执行 + 证据收集 | 自动执行验证矩阵 | 审查证据而非代码 |
| 解释架构取舍 | ADR + FinalSynthesis | 辅助撰写报告素材 | 评价取舍是否经过深思熟虑 |
| 维护和演化复杂系统 | SpecPatch | 分析变更影响范围 | 追踪演化历程，看设计一致性 |

---

## 📐 第一部分：学生·个性化架构设计

> 第 4-5 章。每节末尾设"教师视角"标注（👨‍🏫），显式回答：这个设计给了教师什么新的可能？

---

## 第四章 个性化：让每个学生定义自己的 OS 🏗️

### 4.1 五个维度的自主设计空间

VeriSpecOSLab 不预设任何内核形态。学生通过 ArchitectureSeed 在五个维度上自主决策：

**(1) 内核组织模型**

宏内核 / 微内核 / 混合内核 / Exokernel / Library OS / Unikernel / 自定义。每个选项需说明：选择理由、经典参考系统、预期优势与代价。

**(2) 执行模型**

执行单元（进程/线程/任务/Fiber/Actor）、调度策略（抢占/协作/混合）、优先级模型、阻塞模型、生命周期管理（create/destroy/wait/signal）。

**(3) 保护模型**

特权级设计（RISC-V M/S/U vs ARM EL3-EL0 vs x86 Ring 0-3）、地址空间隔离策略、权限机制（页表/Capability/Handle/命名空间权限）、用户指针策略、内核对象访问策略。

**(4) 通信模型**

通信机制（系统调用/IPC/消息传递/共享内存/事件通道）、同步/异步语义、拷贝策略（copy/zero-copy/shared page）、安全检查、失败语义。

**(5) 资源模型**

资源抽象（FD/Handle/Capability/Port/Object/Endpoint）、生命周期管理、引用计数、所有权转移、撤销机制。

> 👨‍🏫 **教师视角**：教师不再把全班代码和"标准答案"对比。两个学生都选了微内核，但一个借鉴 L4 Capability 而拒绝了其 IPC 模型，另一个保留了 L4 IPC 但选择了不同的资源抽象——教师对比的是**设计思维深度**，而不是**代码相似度**。五个维度给了教师五个评判学生设计能力的独立视角。

### 4.2 ArchitectureSeed：每个学生 OS 的"出生证明"

```yaml
NormalizedArchitectureDesign:
  architecture_name: "MyMicroKernel"
  architecture_summary: "基于 L4 微内核思想，采用 Capability 权限模型，异步 IPC 通信"

  reference_systems:
    - system: "seL4"
      borrowed_concepts: ["Capability-based access control", "formal verification methodology"]
      modified_concepts: ["simplified IPC model for teaching purposes"]
      rejected_concepts: ["complete formal proof — too time-consuming for course scope"]
      reason: "Formal verification is ideal but the course timeline requires a more pragmatic approach"

  kernel_organization:
    type: microkernel
    explanation: "选择微内核以最小化 TCB……"
    trusted_computing_base: ["scheduler", "IPC", "capability manager"]
    in_kernel_components: ["address space management", "thread management"]
    user_space_services: ["file system", "network stack", "device drivers"]

  execution_model:
    unit: [thread]
    scheduling:
      scheduler_type: "priority-based round-robin"
      preemption: true
      priority_model: "256 priority levels"
    lifecycle:
      create: "thread_create(cap, entry, stack, priority)"
      destroy: "thread_destroy(cap)"

  protection_model:
    privilege_levels: "RISC-V M/S/U"
    isolation_boundary: "capability + MMU"
    permission_mechanism: [capability]

  communication_model:
    mechanisms: [IPC]
    synchronous_or_async: "async with kernel-buffered messages"
    copy_policy: "zero_copy for large payloads via shared pages"

  resource_model:
    resource_abstractions: [capability]
    lifetime_management: "reference counting with revocation"
```

> 👨‍🏫 **教师视角**：ArchitectureSeed 让教师**第一次**看到了学生的"设计起点"——而不仅仅是"代码终点"。传统实验中教师直到期末才看到完整代码，发现问题为时已晚。现在教师可以在 Week 1 就审核 ArchitectureSeed，发现方向性问题立即纠正，避免学生在错误路线上浪费数周。同时，ArchitectureSeed 的 reference_systems 字段是教师判断学生"是否做了功课"的直接证据——借鉴了什么、修改了什么、拒绝什么、为什么——四个问题比"代码能不能跑"更能反映学生的研究深度。

### 4.3 ADR：让设计决策可审查——教师最重要的评价窗口

**ADR 格式**：

```yaml
architecture_decision_record:
  id: "ADR-003"
  title: "选择 Sv39 分页而非 Sv48"
  context: "RISC-V 支持 Sv39（39位虚地址，三级页表）和 Sv48（48位虚地址，四级页表）……"
  decision: "采用 Sv39，39 位虚地址空间（256GB）对教学内核完全足够"
  alternatives:
    - option: "Sv48"
      reason_rejected: "增加一级页表遍历开销和实现复杂度，收益在教学场景中不显著"
  consequences:
    positive: ["简化页表管理代码", "减少 TLB 压力"]
    negative: ["未来如需超过 256GB 虚地址空间则需要迁移到 Sv48"]
    risks: ["需要确保物理内存不超过 Sv39 可映射范围"]
```

**教师判断一份 ADR 质量的标准**：
- 理由是否具体？（"因为 RISC-V 支持它"≠好理由；"因为我的内核只需要 39 位虚地址，Sv48 的额外一级页表对教学场景没有价值"=好理由）
- 替代方案是否被认真考虑？（列出 Sv48 并说明拒绝理由，比不列出替代方案更好）
- 后果是否被预见？（positive/negative/risks 都填了，比只写 positive 更好）

> 👨‍🏫 **教师视角**：ADR 是教师判断"学生是否真正理解"的**最强信号**。两个学生都选了 Sv39——一个写"因为 RISC-V 支持它"，另一个写"因为教学内核只需要 39 位虚地址，Sv48 额外一级页表遍历开销在教学场景中无收益"。同一技术选择，两份 ADR 折射的理解深度完全不同。**教师审查的不是"技术选型对不对"，而是"决策过程有没有思维"**。这是传统实验中完全缺失的评价维度。

### 4.4 递进式 ArchitectureSlice：设计随阶段生长

9 个 ArchitectureSlice，每个对应一个教学阶段：

| Slice | 阶段 | 本阶段揭示的设计问题 |
|-------|------|-------------------|
| `00-architecture-seed` | 架构种子 | 你的 OS 大致是什么样的？方向对吗？ |
| `01-boot` | 最小启动 | 启动路径怎么走？谁来设置栈？第一条指令是什么？ |
| `02-memory` | 内存管理 | 物理内存谁来管？虚拟内存怎么映射？ |
| `03-trap` | 陷阱与特权 | 异常谁来处理？系统调用怎么分发？ |
| `04-process` | 进程与调度 | 执行单元是什么？怎么调度？ |
| `05-syscall` | 系统调用 | ABI 怎么设计？错误怎么返回？ |
| `06-filesystem` | 文件系统 | 持久化怎么组织？inode 还是其他？ |
| `07-ipc` | 进程间通信 | 消息怎么传？同步还是异步？ |
| `08-device` | 设备驱动 | 设备怎么抽象？中断怎么路由？ |
| `09-final-synthesis` | 最终综合 | 整个设计自洽吗？演化历程清楚吗？ |

> 👨‍🏫 **教师视角**：递进式 Slice 让教师的审核不是"期末一次性"，而是随教学过程**分 9 个时间节点进行**。问题早发现、早纠正。教师可以配置哪些阶段必须人工审核、哪些可以自动放行——这是传统实验中完全不可能实现的教学节奏控制。

### 4.5 个性化目标与 GoalValidationContract

10 类个性化目标（学生可在阶段 8 选择 1-2 个）：

| 目标类别 | 验证方式 | 示例 GoalContract |
|---------|---------|------------------|
| 二进制兼容 | 运行标准 ABI 测试套件 | "Linux x86-64 ELF 可加载并正确执行" |
| 系统调用性能 | 延迟/吞吐量基准测试 | "syscall 延迟 < 500 cycles" |
| IPC 性能 | 跨进程通信基准 | "单次 IPC < 1000 cycles" |
| 文件系统优化 | IOPS/延迟基准 | "随机读 IOPS > 10000" |
| 实时性优化 | 中断延迟/jitter 测量 | "最大中断延迟 < 10μs" |
| 安全隔离 | 渗透测试/权限验证 | "用户态程序无法访问内核内存" |
| 可验证性增强 | 不变量检查/fuzz 覆盖率 | "fuzz 覆盖率 > 80%" |
| 镜像体积优化 | 最终二进制大小 | "内核镜像 < 1MB" |
| 启动速度优化 | 启动时间测量 | "从上电到 shell < 100ms" |
| 硬件移植 | 在真实开发板上运行 | "在 SiFive HiFive Unmatched 上启动成功" |

> 👨‍🏫 **教师视角**：个性化目标让教师的评分有了**"设计难度"维度的区分度**。两个学生代码正确性得分相同，但一个选了"系统调用性能优化"并取得了 40% 的提升（有 goal contract evidence），另一个选了"镜像体积优化"并从 2MB 缩减到 800KB——教师可以依据**目标的选择难度**和**达成程度**做差异化评分。目标选择本身也反映了学生的挑战意愿——这是传统实验无法测量的维度。

### 4.6 从零构建：不给框架的深层教学理由

- **传统实验的问题**：给学生一套约 9000 行的 xv6 源码框架——学生不理解页表原理也能靠修改已有代码把测试跑通。教师无法区分"真懂"和"刚跑通"。
- **从零构建的设计**：学生必须先写 ModuleSpec 和 OperationContract，把前置条件、后置条件、不变量和失败语义都交代清楚，才能进入代码生成（`vos agent generate`）。
- **教学论证**："从零"不是增加难度，而是降低"不理解也能跑通测试"的风险。规格是学生理解的外化证据——"能写出规格"比"能跑通代码"更能证明学习效果。

> 👨‍🏫 **教师视角**：这是教师角色转变的**基础设施**。如果不从零构建，学生没有 ArchitectureSeed 可交、没有 ADR 可审、没有 OperationContract 可供 Agent 约束——教师就只能回到"看代码对不对"的老路。从零构建不是给学生增加负担，而是给教师提供**评价设计思维的基础材料**。

---

## 第五章 指导手册与教学设计：让个性化可落地 🏗️👨‍🏫

### 5.1 "设计导航"型指导书：教师的审核框架

传统实验指导书是"操作手册"——第一步装软件、第二步改文件、第三步跑命令。VeriSpecOSLab 的指导书是"设计导航"，三条核心约束：

1. **描述设计问题，不预设实现方案**。指导书说"这个阶段必须解决资源命名和生命周期管理问题"，不说"用 file descriptor table"。
2. **定义质量门禁，不指定通过方式**。指导书说"分配器不能返回已被分配的页"，不说"用 freelist"。
3. **要求设计理据，不接受"就是这样"**。每个决策必须写入 ADR——借鉴了什么？修改了什么？拒绝了什么？为什么？

> 👨‍🏫 **教师视角**：三条约束 = 教师的审核框架。教师检查学生是否**回答了设计问题**（而非照搬参考实现）、是否**通过了质量门禁**（而非绕过检查）、是否**记录了设计理据**（而非写"就是这样"）。教师不用在大量代码里猜学生的设计意图——所有决策以结构化 YAML 存在，`vos spec lint` 和 `vos arch lint` 可自动检查格式和一致性。

### 5.2 历史驱动的教学设计：改变课堂叙事

**从历史讲原理，不从定义讲原理**：
- 例：虚拟内存——"1961 年曼彻斯特大学 Atlas 计算机首次实现虚拟内存。在此之前，程序员必须手动管理物理内存位置……Atlas 的洞见是让硬件做地址翻译。六十年后，你的 Sv39 页表是它的直系后代。"
- 例：fork()——"1971 年，PDP-7 只有 8KB 内存，Ken Thompson 和 Dennis Ritchie 做了一个简化——'复制当前进程，然后让子进程自己去替换程序'。他们以为这是临时方案，但后来发现了出乎意料的好处：fork 和 exec 之间的窗口让 Shell 能偷偷修改子进程的文件描述符……这就是 Unix 组合性的基石。"

**用历史争论揭示设计权衡**：
- fork vs spawn（Windows NT CreateProcess）——两种选择的来历、各自代价、为什么都合理

**引入安全事件作为教学锚点**：
- Meltdown（2018）→ 为什么页表隔离从"可选微内核特性"变成"所有主流 OS 标配" → KPTI
- Spectre → 为什么地址空间隔离不能只依赖权限位、也不能只依赖页表

> 👨‍🏫 **教师视角**：教师从"宣读定义的讲解员"变为"讲述工程决策故事的故事讲述者"。学生在故事中理解设计权衡，教师在故事中展示工程思维。Meltdown 的案例让"页表隔离"不再是一个枯燥的选项——它有了真实世界的代价和紧迫性。教师可以用这些故事在课堂上把操作系统的黑盒变成白盒。

### 5.3 分层挑战设计：教师的差异化教学工具

每章标注"挑战路线"提示：
- **零基础学生**：按主线走，聚焦"理解原理、完成基本实现"。完成主线即可通过阶段门禁。
- **有经验学生**：深入挑战问题——"如果选微内核，IPC 性能如何保证（零拷贝、批处理、快速路径）？""如果选 Exokernel，libOS 边界怎么划？""如果选 Rust 写内核，unsafe 的边界在哪里？"
- 阶段 8 的方向组合前瞻："你现在的设计决策如何影响未来的扩展空间？"

> 👨‍🏫 **教师视角**：一套材料覆盖不同学生——教师不需要为"吃不饱"和"跟不上"准备两套教案。挑战路线给教师提供了**差异化评分的依据**：完成挑战的学生在 ADR 中有更丰富的设计论述。挑战路线的存在本身也是一种信号——让学生知道"你现在做的不是这个阶段的全部可能性"。

### 5.4 跨 ISA 与跨语言选择

**ISA 对比**：

| 维度 | RISC-V | ARM | x86-64 |
|------|--------|-----|--------|
| 启动链 | OpenSBI → S-mode | TF-A → EL2/EL1 | UEFI/GRUB → Long Mode |
| 特权级 | M/S/U 三级 | EL3-EL0 四级 | Ring 0-3 |
| 页表 | Sv39 (三级) | VMSAv8-64 (四级) | 4-level PML4 |
| 中断控制器 | PLIC | GICv3/v4 | APIC/x2APIC |

**语言对比**：

| 维度 | C | Rust | Zig |
|------|---|------|-----|
| 内存安全 | 手动，UB 陷阱多 | 编译期消灭内存 bug | 手动但有更清晰的 allocator API |
| 代表项目 | Linux, xv6 | rCore, Redox | 暂无成熟 OS 内核 |
| 构建系统 | Make/CMake | Cargo | build.zig |
| 交叉编译 | 需手动配置 | target spec 良好 | 一流的交叉编译支持 |
| 学习曲线 | 语法简单 | 所有权模型陡峭 | 中等 |
| 适合场景 | 参考资料最丰富 | 想少写内存 bug | 想要 comptime + 现代工具链 |

> 👨‍🏫 **教师视角**：跨 ISA 和跨语言对比让实验方案不绑定特定技术栈。不同学校可以根据硬件条件和教学传统选择，而核心设计方法保持不变。同一班级内也可以允许不同选择——只要学生在 ArchitectureSeed 中声明并论证选择。

---

## 🤖 第二部分：Agent·受控协作体系

> 第 6-7 章。每节末尾设"教师视角"标注（👨‍🏫），显式回答：Agent 为教师解决了什么、要求教师做什么？

---

## 第六章 Agent 治理框架：让教师掌控 AI 的使用 🤖👨‍🏫

### 6.1 治理的核心问题——从教师视角出发

教师最大的担忧不是"学生用 AI"，而是三个"不知道"：
1. **不知道学生怎么用的**——是让 AI 审查规格？还是让 AI 代写全部代码？
2. **不知道用了多少**——90% 的代码是 AI 生成的还是 10%？
3. **不知道学到了没有**——学生是理解了设计然后让 AI 辅助实现，还是完全不理解全靠 AI？

治理框架要回答教师三个问题：
- **AI 能做什么？**（能力边界——7 身份 + 能力包）
- **什么时候能做？**（阶段门禁——StageGate 梯度释放）
- **做了什么？**（审计追溯——完整审计链路）

> 👨‍🏫 **教师视角**：治理框架让教师从"禁止 AI 但禁不了"的困境中解脱——教师变成了 **AI 使用规则的制定者和审计者**，而非无奈的禁令执行者。教师不是对学生说"不准用 AI"，而是说"这个阶段你只能用 AI 帮你审查规格格式，不能让它帮你写代码——因为你现在需要先学会自己做内存模型的设计决策"。

### 6.2 Agent 身份与能力包模型

**核心架构**：

```yaml
agent_identity:
  id: "implementer.v2"           # 身份标识
  role_prompt_id: "implementer.v2"  # 绑定的 system prompt
  capability_pack_id: "implementer-codegen.v1"  # 绑定的能力包
  output_contract: "codegen.targets"  # 输出约束
  audit_level: "full"           # 审计级别

capability_pack:
  id: "implementer-codegen.v1"
  allowed_tools: ["read", "write", "glob", "grep", "bash"]
  allowed_vos_commands: ["spec lint", "build", "verify public"]
  readable_context: ["spec/", "kernel/", "user/", ".vos/"]
  writable_targets: ["kernel/**/*.c", "kernel/**/*.h", "user/**/*.c"]
  required_gates: ["spec_bound", "minimal_verification"]
  forbidden_actions: ["delete tests", "modify .vos/policy.yaml", "bypass stage gate"]
```

**核心规则**：身份不混用（每次会话选一个身份）、Persona 只收窄不扩权（Student 不能获得 Teacher 的能力）、系统 prompt 不授予工具/路径/凭证/隐藏材料。

**7 个正式 Agent 身份详解**：

| 身份 | 学生用它做什么 | 👨‍🏫 教师在什么阶段允许它 | 👨‍🏫 教师如何审查其产出 |
|------|--------------|--------------------------|----------------------|
| `spec-author.v2` | 写 ModuleSpec 时获得格式指导和一致性检查 | Stage 0 起开放——写规格是学生的事 | 审查规格是否表达**学生的**设计意图，而非 Agent 的"标准答案" |
| `implementer.v2` | 规格审核通过后，生成代码骨架 | Stage 1+ 开放——必须先写好规格 | 审查代码是否**偏离了规格**，而非代码是否"看起来对" |
| `debugger.v2` | QEMU panic 时自动分析日志定位问题 | Stage 3+ 开放——早期阶段鼓励自己 debug | 看学生是否**理解**了 Agent 的诊断，而非盲目照改 |
| `reviewer.v2` | 提交前自查：实现是否偏离了规格 | Stage 5+ 开放 | 看审查报告中的风险标记是否**合理** |
| `reporter.v2` | 阶段末自动生成设计报告 | Stage 5+ 开放 | 审查报告是否**准确反映**学生的设计——而非 Agent 的美化 |
| `toolchain-author.v2` | 描述构建语义，Agent 生成 Makefile/CMake | Stage 1+ 开放 | 不审查——构建系统是工具，不是学习目标 |
| `knowledgebase.v1` | 问"微内核和宏内核在内存管理上的核心取舍" | Stage 0 起开放——理解设计需要知识 | 审查**引用来源**是否准确，防止被 AI 幻觉误导 |

> 👨‍🏫 **教师视角**：这个表格是教师配置 AI Policy 的操作手册。每行回答了教师最关心的三个问题——"这个身份让学生干嘛？我应该什么时候给学生用？我怎么看学生用得对不对？" 最重要的是：**知识库 Agent 从 Stage 0 就开放，但只读不写**——学生可以从第一天就让 AI 帮助理解设计问题，但 AI 绝对不能替学生写第一行代码，直到学生自己先写出了规格。

### 6.3 StageGate：教师手中的"能力释放开关"

**梯度释放设计**（7 级能力梯度，非二元开关）：

```
Stage 0 (architecture-seed)    → spec-author + knowledgebase
Stage 1 (boot-minimum)         → + implementer + toolchain-author
Stage 2 (memory-management)    → (implementer 继续开放)
Stage 3 (trap-privilege)       → + debugger
Stage 4 (process)              → (debugger 继续开放)
Stage 5 (syscall-ipc)          → + reviewer + reporter
Stage 6+ (filesystem/device)   → 全部身份开放
Stage 9 (final-synthesis)      → 全部身份开放 + final report
```

**释放节奏的教学逻辑**：

| 能力 | 为什么在这个阶段释放 | 释放过早的风险 |
|------|-------------------|--------------|
| `spec-author` 在 Stage 0 | 学生需要帮助理解规格格式 | 如果放到 Stage 2，学生在 boot 阶段写的规格就得不到格式检查 |
| `implementer` 在 Stage 1 | 学生已经写出了 ArchitectureSeed 和 boot 阶段的 ModuleSpec | 如果在 Stage 0 就开放，学生可能直接让 AI 写 ArchitectureSeed |
| `debugger` 在 Stage 3 | boot 和 memory 的 bug 相对简单，鼓励学生自己排查 | 如果在 Stage 1 就开放，学生一遇到段错误就丢给 AI |
| `reviewer` 在 Stage 5 | 到 syscall 阶段，代码量变大，人工审查规格一致性变得困难 | 如果在 Stage 2 就开放，学生可能从未学会自己检查实现与规格的一致性 |

> 👨‍🏫 **教师视角**：StageGate 是教师最核心的治理工具。教师不是对学生说"不准用 AI"，而是说**"这个阶段你只能用 AI 帮你审查规格格式，不能让它帮你写代码"**。StageGate 的梯度设计体现了教学理念——**早期阶段保护设计思维训练的空间，后期阶段释放效率工具**。教师可以根据教学需要灵活调整每个阶段的开放身份。

### 6.4 Agent 审计：教师判断学术诚信的客观基础

**完整审计链路**：
```
Agent 会话记录 → 工具调用序列 → 代码变更 diff → 验证结果 → commit ledger
```

**commit-ledger.jsonl** 每条记录包含：
```json
{
  "commit_sha": "abc123",
  "parent_sha": "def456",
  "actor": "agent",
  "agent_identity_id": "implementer.v2",
  "run_id": "run-20260630-001",
  "spec_refs": ["spec/modules/kernel/memory/ops/kalloc.yaml"],
  "evidence_refs": ["run-20260630-001/verify-public.json"],
  "timestamp": "2026-06-30T10:30:00Z"
}
```

**人类 commit 的 `collaboration_intent`**：学生需声明是否基于 Agent 输出、AI 辅助程度。

> 👨‍🏫 **教师视角**：教师不再靠"代码风格像不像 AI"做主观判断——审计链路提供了客观证据。**审计的目的是让"AI 写的是 AI 写的，我写的是我写的"成为不言自明的事实**——学术诚信不再依赖于学生的自觉，而建立在可追溯的证据之上。教师还可以从审计数据中发现教学问题：某个学生过度依赖 Agent？某个阶段全班 AI 使用率异常高？这些信号比"我感觉这届学生用 AI 多了"更有价值。

### 6.5 AI Policy 配置：教师定义 AI 的行为边界

教师可配置的白名单维度：允许的 Agent 身份、允许的 vos 命令、允许的路径、允许的知识来源。策略版本化：教师可根据教学反馈调整。

> 👨‍🏫 **教师视角**：AI Policy 是教学意图的技术表达——**"这个实验我想让学生自己设计调度器，所以禁止 Agent 在 process 阶段生成调度代码"**——这样的教学意图通过 Policy 得到强制执行，而不是靠口头提醒。"别忘了自己写调度器"→ 学生可能"忘记"；"Agent 在 process 阶段不可用 implementer 身份"→ 学生没法"忘记"。

---

## 第七章 Agent 核心能力：教师被解放的重复劳动 🤖👨‍🏫

### 7.1 知识库 (vos-kb)：教师的知识分发与质量保障工具

**多源知识体系**：
- `course` 源：课程讲义、实验手册——**教师审核过的权威知识**
- `project` 源：spec/、公开证据、代码文件——**学生自己项目的设计真相**
- `external` 源：批准的网页快照、标准文档、参考源码——**可控的外部知识**

**强制引用机制**：每次回答附带 `source_id` + `title` + `object_ref`，学生和教师可追溯信息出处。

> 👨‍🏫 **教师视角**：(1) 教师从"反复回答基础问题"中解放——学生先问 KB，KB 引用讲义回答，教师只需处理 KB 无法回答的深层问题。(2) 教师可以分析学生的搜索和引用模式——发现全班在"虚拟内存的 copy-on-write 机制"这个知识点上普遍困惑，据此调整下周的教学重点。(3) 教师通过 KB 源的质量控制确保 AI 不会给学生灌输未经审核的信息。(4) 强制引用让教师能**检查学生是否被 AI 的错误信息带偏**——如果学生 ADR 中引用了某个不存在的研究，教师可以追溯到是 KB 中哪个外部源出了问题。

### 7.2 自动插桩调试与可视化：教师不再当"高级调试员"

- **自动插桩**：Agent 读取 QEMU panic 日志 → 自动推断失败原因 → 隔离 Git worktree 中注入诊断代码 → 重建运行 → 分析输出 → 自动清理
- **QMP 可视化**：通过 QEMU Machine Protocol 获取寄存器状态、内存映射、页表遍历 → 把底层状态映射回高级设计概念
- **`vos debug explain-log`**：把"page fault at 0xdeadbeef"翻译成"你的页表在 0x1000 处缺少了 L2 条目，可能是因为 kvmalloc 没有为这个范围建立映射"

> 👨‍🏫 **教师视角**：(1) 传统实验中教师花大量时间帮学生排查内存越界、页表配置错误——Agent 扛掉这部分重复劳动。(2) 可视化让教师在课堂上**现场演示**调度策略效果、页表遍历过程，把操作系统的黑盒变白盒。(3) 教师把省下的时间用在**设计层面的指导**上——跟学生讨论"你的 IPC 设计为什么在高负载下性能退化"，而不是"你的页表第三级为什么少了一项"。

### 7.3 ToolchainSpec：消除"在我电脑上能跑"

语义构建规范（compile → link → archive → test）+ 环境自动探测 + 确定性 gate 校验。Agent 可多后端生成（Makefile/CMake/xtask/Bazel/Cargo）。

> 👨‍🏫 **教师视角**："在我电脑上能跑"是传统 OS 实验最常见的教学障碍。教师不再需要维护冗长的"各平台安装指南"附录。环境自动探测把一致性从学生手上接过来——学生专注于"我的内核需要哪些源文件、什么编译标志"。

### 7.4 KnowledgeBaseAgent：教师的助教倍增器

**教学契约**：
1. 始终命名当前阶段与规格范围
2. 指出被保护的教学目标
3. 引用 KB 来源
4. 建议下一步设计检查
5. 不绕过学习目标给完整解决方案

**成功标准**：不是回答流利度，而是帮助学生达到阶段设计目标并**保持教学效果**。

> 👨‍🏫 **教师视角**：KnowledgeBaseAgent 像一个**永不疲倦的助教**——能同时回答 50 个学生在设计阶段遇到的基础问题。但它被刻意设计为"不直接给答案"——保护了学生的思考空间。教师的答疑时间从"回答基本概念问题"升级为"讨论深层设计权衡"。

---

## 👨‍🏫 第三部分：教师·角色升维

> 第 8 章独立成章。这是整个方案对教师价值的集中论证。此前分散在各章的"教师视角"标注在此汇聚为完整叙事。

---

## 第八章 教师角色升维：从代码检查员到设计导师 👨‍🏫

### 8.1 教师的三个角色转变

**转变一：从"批改作业的人"到"设计审核者"**

| 维度 | 以前 | 现在 |
|------|------|------|
| 看到什么 | 学生期末提交的最终代码 | 从 Week 1 的 ArchitectureSeed 到 Week N 的 ArchitectureSlice，每个阶段的设计文档 |
| 做什么 | 跑测试脚本，看通过率，打分 | 审核 ArchitectureSeed 方向、ArchitectureSlice 设计、ADR 决策质量 |
| 工具 | 测试脚本 | `vos arch lint`、ADR 审查框架、设计审核工作流 |
| 价值 | 判断代码能不能跑（AI 也能做） | **判断设计思维好不好（只有教师能做）** |

**转变二：从"高级调试员"到"规则制定者"**

| 维度 | 以前 | 现在 |
|------|------|------|
| 时间花在哪 | 帮学生排查内存越界、页表错误、环境问题 | 配置 StageGate 释放节奏、AI Policy 边界、Rubric 评分权重 |
| 做什么 | 处理 50 个学生的各种技术问题 | 制定规则让 Agent 自动处理重复问题 |
| 工具 | GDB、串口日志分析 | StageGate 配置界面、AI Policy 编辑器、Analytics 面板 |
| 价值 | 调试技能（学生应该自己掌握） | **教学治理（教师的专业判断）** |

**转变三：从"终结性评价者"到"过程性指导者"**

| 维度 | 以前 | 现在 |
|------|------|------|
| 评价时机 | 期末一次性评分 | 9 个阶段持续追踪 |
| 评价对象 | 最终代码 | ArchitectureSeed + ADR + Slice + 实现 + 证据 + AI 使用模式 |
| 介入方式 | 事后宣判 | 过程中指导——早发现问题早纠正 |
| 申诉处理 | "你的测试只过了 45/48 个" | "你的 ADR-003 中 Sv39 的理由不够具体，但 ADR-005 的 IPC 设计很出色" |

### 8.2 教师在每个阶段的具体工作——六阶段审核表

| 阶段 | 👨‍🏫 教师看什么 | 依赖什么证据 | 产出什么决策 | 与传统实验的区别 |
|------|---------------|-------------|-------------|----------------|
| `architecture-seed` | 目标范围合理吗？non-goals 清晰吗？设计方向有理由吗？ | seed.yaml、reference_systems 分析 | 批准 / 缩小范围 / 退回重写 | **传统：这一步不存在。教师第一次看到学生作品就是最终代码** |
| `boot-minimum` | boot chain 设计合理吗？启动约定清晰吗？可观察性足够吗？ | boot slice、串口日志、`[SPECLAB]` 标记 | 解锁 memory 阶段 | 传统：只看能不能打出 Hello World |
| `memory-management` | 内存模型自洽吗？分配器不变量完整吗？ModuleSpec 和 OperationContract 一致吗？ | ModuleSpec、allocator tests、invariant checks | 解锁 trap 阶段 | 传统：只看 allocator 测试过没过 |
| `syscall-ipc` | ABI 设计合理吗？错误语义完整吗？权限边界清楚吗？ | trace 数据、IPC tests、OperationContract | 解锁资源阶段 | 传统：只看 syscall 测试过没过 |
| `personalized-goal` | 新机制是否通过 SpecPatch 合法引入？目标验证合约完整且可测量吗？ | patch history、goal contract、验证结果 | 批准 / 要求补充设计 / 缩小目标 | **传统：个性化目标不存在** |
| `final-synthesis` | 设计历程可追溯吗？证据完整吗？评分可解释吗？ | final report、evidence map、commit ledger | 正式评分与发布 | 传统：一次考试或最终代码提交 |

> 关键是第一个阶段。传统实验中 `architecture-seed` 根本不存在——这意味着教师在整个学期中对学生的设计思维一无所知，直到期末看到最终代码。而现在教师从第一周就开始审视学生的设计方向。

### 8.3 教师的评分工具箱

**三类评分来源**：
- **自动验证结果**（公开 + 隐藏 + fuzz + 不变量检查）——客观、即时、不可伪造
- **人工审核结果**（ADR 质量、ArchitectureSlice 审核、FinalSynthesis 评审）——主观但可结构化
- **AI 审计与过程证据**（commit ledger、Agent 使用模式、阶段迭代次数、知识库引用记录）——过程维度

**证据映射**：每个评分项绑定 `evidence_type` + `source_entity` + `computation_rule` + `publication_scope`。

> 👨‍🏫 **教师价值**：教师的评分不再是"你的代码跑过了 48 个测试中的 45 个，所以 94 分"——而是**"该生在内存管理阶段提出了有创意的分配策略（ADR-003），但在 IPC 设计中低估了同步复杂度（ADR-007），个性化目标——系统调用延迟优化——取得了 40% 的提升（goal contract evidence），Agent 使用模式合理（设计阶段高频使用 knowledgebase，实现阶段适度使用 implementer）"**。评分变成了对学生**设计能力**的综合评判，而非对代码通过率的简单换算。

### 8.4 教学 Analytics：教师的数据驾驶舱

**5 类分析输出**：

| 分析类型 | 具体内容 | 👨‍🏫 教师价值 |
|---------|---------|-------------|
| 阶段通过率 | 全班各阶段的首次通过率、重试次数分布 | 识别哪些阶段是集体瓶颈——下学期调整教学重点 |
| 失败热区 | Boot/Memory/Syscall/Userland 等模块的失败频率排行 | 识别哪些知识点是普遍薄弱环节——课堂加强 |
| AI 使用强度 | 全班 Agent 使用频率分布、各身份使用占比、高风险项目列表 | 发现过度依赖 AI 的学生（早期干预）、评估 AI Policy 的有效性 |
| 目标选择分布 | 多少学生选了性能优化、多少选了安全隔离、各目标的达成率 | 了解学生兴趣偏好、评估各类目标的难度设置是否合理 |
| 门禁松紧评估 | 哪个门禁全班都卡（太紧）、哪个门禁无人受阻（太松） | 调整 StageGate 配置——让门禁真正发挥教学引导作用 |

> 👨‍🏫 **教师价值**：(1) 课程复盘有数据支撑而非凭感觉——"这届学生在 IPC 设计上比上届强了 15%"。(2) 高风险学生早发现早干预——不是等到期末才发现"这个学生整个学期都在让 AI 代写"。(3) AI Policy 的效果可量化——"这学期 Agent 使用率和上学期比如何？是更合理了还是更依赖了？"

### 8.5 override、冻结与成绩发布流程

教师可触发的关键动作：发布新规则版本 / 审批人工 override / 强制冻结最终提交 / 发布正式成绩 / 开启或关闭申诉窗口。每个动作绑定：操作人 + 原因 + 影响对象 + 关联证据快照。

> 👨‍🏫 **教师价值**：所有关键决策可追溯可解释。面对学生申诉时，教师能精确回答"这个分数是怎么来的"——不是靠记忆，而是靠证据映射。

### 8.6 差异化教学：同一个实验，不同的深度

- 教师对比不同学生的 ArchitectureSeed → 发现模式：哪些设计方向更受欢迎？哪些更容易成功？
- 教师发现优秀学生 → 推荐挑战路线、深入讨论架构决策（如"你考虑过 L4 的 IPC 批处理优化吗？"）
- 教师识别困难学生 → 在早期 ADR 中找到问题、针对性指导（如"你的内存模型中分配器和回收器之间的不变量不完整"）

> 👨‍🏫 **教师价值**：这是角色升维的最终体现——**教师不再对全班说同样的话，而是对每个学生说最需要的话**。在传统实验中这只能是理想——一个教师面对 50 个学生不可能做到。但 Agent 扛掉了基础问答和重复劳动，证据体系提供了每个学生的精准画像，教师终于可以把专业判断力用到最需要的地方。

---

## 🔧 第四部分：平台与工具链

> 第 9-10 章。

---

## 第九章 VOS 工具链：三条线的执行引擎

### 9.1 五层执行模型

```
Spec Layer (解析校验)
  → Planning Layer (影响分析 + 计划生成)
  → Execution Layer (命令编排)
  → Evidence Layer (证据采集)
  → Report Layer (报告生成)
```

### 9.2 统一命令入口

40+ 固定子命令，不允许任意 shell 转发。策略白名单控制 Agent 可执行的命令。分类：
- **项目与 Spec**：`doctor`, `stage show`, `spec lint`, `spec check-consistency`, `arch compose`, `arch derive-tests`
- **构建与运行**：`toolchain lint`, `build`, `build generate`, `run qemu`, `test`
- **验证**：`verify public/patch/generated/invariant/fuzz/full`
- **Agent**：`agent serve/context/plan/generate/ask/validate-generated/debug/review-spec/apply-patch/log`
- **报告与提交**：`report generate`, `submit pack`
- **知识库**：`kb add/search/list/remove/clear/export-manifest/import-manifest`

### 9.3 TypeScript Workspace 划分

| 包/应用 | 职责 |
|---------|------|
| `vos-core` | 共享核心：CLI 解析、命令分发、策略执行、证据跟踪、Agent 运行器 |
| `vos-runtime` | 执行原语：ExecutionEngine 接口、Adapter 注册 |
| `vos-spec` | 规范解析：YAML 解析、架构组合、测试矩阵派生 |
| `vos-kb` | 知识库：文档摄取、sqlite-vec 向量索引、MCP 服务 |
| `vos-server` | HTTP REST API：OpenAPI 自动生成、Portal 集成 |
| `vos-cli` | CLI 入口（编译为 `vos` 二进制文件） |
| `vos-agent` | AI Agent 后端（TUI + 无头 + HTTP 服务器模式） |
| `vos-web` | Portal 前端原型（React + Vite + Tailwind） |
| `vos-demo` | 演示 HTTP 服务 |

### 9.4 ToolchainSpec：工具无关的语义构建

语义构建阶段（compile → link → archive → test）+ Agent 多后端生成（Makefile/CMake/xtask/Bazel/Cargo）+ 确定性 gate 校验（路径/spec hash/manifest/ledger/dry-run 五重校验）+ 环境自动探测（工具版本/target triple/ABI）。

---

## 第十章 平台架构：三条线的基础设施

### 10.1 清晰边界

Portal 是 **control plane**（签发身份、project/stage binding、policy snapshot、调度 runner、归档 evidence、审计记录），vos-cli/vos-agent 是 **repo runtime**（不承载 workspace Agent 工具执行）。

### 10.2 八子系统架构

```
Portal → Backend API → Spec Service / Repo Provisioner / Agent Governance
                     → Pipeline Orchestrator → Runner (vos serve) / Judge Controller
                     → Artifact Store + Analytics
```

### 10.3 核心领域模型

User → Course → Experiment → ExperimentSpec → StageGate → StudentProject → DesignSubmission → PipelineRun → JudgeSubmission → Artifact → AgentSession

### 10.4 三种部署模式

- **单机模式**：本地 vos + DevBox（适用于个人学习和小班试点）
- **课程服务器模式**：Portal + Backend + 共享 Runner（适用于正式课程）
- **集群模式**：多租户、高隔离、硬件评测（适用于大规模部署）

### 10.5 MVP 到完整平台路线图

| 阶段 | 能力 |
|------|------|
| **MVP** | 单课程单实验、仓库自动创建、基础公开验证、`vos` 本地全流程、Agent 审计 |
| **Phase 2** | 完整阶段门禁与设计审核、标准 Judge 流程、评分证据映射、教师/助教审核工作流 |
| **Phase 3** | 多租户、跨课程 Analytics、硬件评测、自定义实验适配器、高级安全 |

### 10.6 教师专属功能

实验定义与版本管理、StageGate 配置界面、AI Policy 编辑器、设计审核工作流、Analytics 面板、成绩发布与申诉管理。

---

## 📊 第五部分：参考实现与创新总结

> 第 11-13 章。

---

## 第十一章 参考实现：xv6-spec——三线交汇的完整实例

### 11.1 项目全景

- **67 个 OperationContract**（内核 53 + 用户 14）
- **21 个内核子模块** + 4 个用户模块
- **48 个公开测试**、9 个架构切片
- 完整 spec/ 目录结构

### 11.2 个性化维度的体现

- ArchitectureSeed：参考 MIT xv6，借鉴 Sv39 分页、文件系统组织，拒绝复杂设备驱动模型
- 3 个 ADR：ADR-001 (Sv39 选择) / ADR-002 (文件系统模型) / ADR-003 (设备驱动模型)
- 9 个 ArchitectureSlice 的递进展开

### 11.3 Agent 使用维度的体现

- `vos agent plan --stage boot` → 生成 boot 阶段实现计划
- `vos agent generate --apply` → 从 OperationContract 生成代码骨架
- `vos kb add spec --source-kind project` → 将规格加入知识库
- `vos debug explain-log` → 自动诊断 QEMU panic

### 11.4 教师审查维度的体现

如果教师审查这个 xv6-spec 项目：
- Stage 0：ArchitectureSeed——"目标清晰，non-goals 合理，但 reference_systems 中'拒绝复杂设备驱动'的理由可以更具体"
- Stage 2：ADR-001 (Sv39)——"理由充分：教学内容只需要 39 位虚地址。但 risks 中未提到如果未来想支持超过 256GB 物理内存的后果"
- Stage 8：个性化目标——"选择文件系统优化，goal contract 中的 IOPS 基准定义清晰，可测量"

### 11.5 学生全流程验证数据

9 阶段学生复刻验证记录（来自 `docs/student-replication-plan.md`）：每阶段执行 Spec 审查 → Toolchain 验证 → 架构检查 → Agent 生成 → 构建 → 运行 → 验证 → 调试(条件) → 错误注入 → 知识库。

---

## 第十二章 创新点总结

### 12.1 个性化维度的创新（6 项）

1. **5 维度自主设计空间**：不预设内核形态，学生在组织/执行/保护/通信/资源五个维度自主决策
2. **ArchitectureSeed + ADR**：设计思维的结构化外化，从第一周就让设计可审查
3. **从零构建**：不提供预制框架——"不会也能交"变为"不理解就交不了"
4. **设计导航型指导书**：描述问题不预设方案——培养系统设计师而非代码工人
5. **历史驱动教学**：Atlas 1961→Sv39 的完整叙事——让机制有来历，让取舍有故事
6. **分层挑战设计**：同一份指导书覆盖零基础到有经验学生

### 12.2 Agent 维度的创新（6 项）

1. **7 身份 + 能力包模型**：精细的 AI 治理，非简单二元开关
2. **StageGate 梯度释放**：能力随学习进度解锁——不禁止 AI，教学生什么时候该用
3. **知识库强制引用**：对抗 AI 幻觉的可审计机制
4. **ToolchainSpec 多后端生成**：Agent 是生成器而非唯一答案
5. **自动插桩调试 + QMP 可视化**：黑盒变白盒
6. **完整审计链路**：学术诚信有据可查——不是不信任，而是可追溯

### 12.3 教师角色维度的创新（5 项）

1. **设计审核变教学环节**：教师在代码生成前审核 ArchitectureSlice——在设计层面纠正问题
2. **从终结性到过程性评价**：9 阶段全程追踪，评价基于过程而非最终产物
3. **差异化教学可落地**：Agent 扛重复劳动 + 证据体系精准画像 → 教师对每个学生说最需要的话
4. **AI Policy 可配置可版本化**：教学意图的技术表达——"这个实验让学生自己设计调度器"
5. **数据驱动的课程复盘**：5 类 Analytics 让教学调整有客观依据

### 12.4 综合对比表

| 对比维度 | MIT 6.S081 | rCore | 裸 AI 编程 | **VeriSpecOSLab** |
|---------|-----------|-------|-----------|-------------------|
| 🏗️ 内核形态自由度 | 固定（宏内核） | 固定（微内核） | 不限 | **5 维度自主设计** |
| 🏗️ 架构设计文档 | 无 | 无 | 无系统支持 | **ArchitectureSeed + ADR + Slice** |
| 🏗️ 从零构建 | 否（9000 行框架） | 否（完整框架） | 不限 | **是（从 ArchitectureSeed 开始）** |
| 🏗️ 个性化目标 | 不支持 | 不支持 | 无系统支持 | **10 类 + GoalContract** |
| 🤖 AI 治理 | 无 | 无 | 无 | **7 身份 + 能力包** |
| 🤖 AI 阶段控制 | 无 | 无 | 无 | **StageGate 梯度释放** |
| 🤖 AI 幻觉对抗 | 无 | 无 | 无 | **知识库强制引用** |
| 🤖 AI 审计 | 无 | 无 | 无 | **完整审计链路** |
| 👨‍🏫 设计审核工具 | 无专门支持 | 无专门支持 | 无 | **spec lint / ADR 审查框架** |
| 👨‍🏫 过程性评价 | 无 | 无 | 无 | **commit ledger + evidence map** |
| 👨‍🏫 教学分析 | 无 | 无 | 无 | **5 类 Analytics 输出** |
| 👨‍🏫 差异化教学 | 教师自行解决 | 教师自行解决 | 无支持 | **分层挑战 + 针对性指导** |

---

## 第十三章 总结与展望

### 13.1 项目价值

- **学生收获**：系统设计能力、AI 协作能力、可验证系统构建能力、设计理据表达能力
- **教师收获**：可审查的设计文档、可追溯的过程数据、差异化的教学可能、AI 时代的学术诚信工具

### 13.2 当前状态

- vos 工具链已实现，支持本地全流程操作
- xv6-spec 参考项目已完成全流程验证
- Portal 原型 (vos-web) 已搭建

### 13.3 未来方向

- **SpecLab 通用平台**：SpecDBLab / SpecLangLab / SpecNetLab / SpecRuntimeLab / SpecHWLab
- **物理硬件移植**：QEMU → 真实 RISC-V/ARM 开发板
- **形式化验证深度集成**：模型检查 / 局部形式化证明
- **跨课程 Learning Analytics**

---

# 材料二：实验指导书大纲

## 总体结构："一站四册" + 三线标注

| 分册 | 🏗️ 学生读它做什么 | 🤖 Agent 的角色 | 👨‍🏫 教师用它做什么 |
|------|------------------|----------------|------------------|
| **Book/** (13 章) | 理解设计空间与背景知识 | 每章标注可用 Agent 身份 | 教学素材与课堂叙事 |
| **Labs/** (12 个) | 明确当前阶段的设计任务 | 每个 Lab 标明 Agent 辅助边界 | 审核清单与评分依据 |
| **Specs/** (9 个指南) | 学会写 ArchitectureSeed/ADR | Agent 格式检查 | 设计文档审查标准 |
| **Appendices/** (6 个) | 查工具用法和语言对比 | Agent 配置参考 | 环境问题速查 |
| **Teacher/** (6 个指南) | — | — | 课程配置/设计审核/AI Policy/评分/Analytics |

## Book/ 章节大纲（13 章，历史驱动 + 设计空间展示）

1. **ch00-overview**：课程概览——为什么你要设计自己的 OS，AI 在这个过程中的角色
2. **ch01-spec-driven-os**：规格驱动的 OS 开发方法论——写规格不是多一道工序，而是少走弯路
3. **ch02-boot-console**：从裸机到 Hello World——Atlas 1961 的分时系统 vs 你的启动路径选择
4. **ch03-memory-management**：谁管理物理内存——freelist vs buddy vs slab 的历史与权衡
5. **ch04-virtual-memory**：从 Atlas 1961 到 Sv39——虚拟内存的"为什么"而非"是什么"；Meltdown/Spectre 如何改写教科书
6. **ch05-trap-interrupt-syscall**：CPU 如何知道该听谁的——陷阱/中断/系统调用的设计谱系
7. **ch06-scheduler-user-mode**：fork() 的来历——PDP-7 8KB 内存的临时方案如何成为 Unix 基石；fork vs spawn 的世纪争论
8. **ch07-abi-loader**：程序如何开始运行——ELF 加载的"为什么这样设计"
9. **ch08-resource-model**：FD vs Handle vs Capability——三种资源抽象的历史路径与设计取舍
10. **ch09-ipc-vfs-namespace**：微内核的 IPC 性能困局——L4 的零拷贝方案告诉你什么
11. **ch10-verification**：验证——你的 OS 正确吗？不只是跑通测试
12. **ch11-ai-collaboration**：与 AI 协作——什么时候该用 Agent，什么时候不该用
13. **ch12-final-report**：期末综合——你的 ArchitectureSeed → ADR → FinalSynthesis 完整故事线

## Labs/ 实验卡片大纲（12 个，设计问题驱动）

每个 Lab 统一模板：

```text
# Lab N: 标题

## 设计问题
[描述本阶段必须解决的设计问题，不预设实现方案]

## 规格要求
[必须产出的规格文档：ArchitectureSlice / ModuleSpec / OperationContract / ADR]

## 质量门禁
[必须通过的质量检查：spec lint / arch lint / verify public / ...]

## 🤖 Agent 辅助边界
- 你可以让 Agent 做什么：[可用身份与功能]
- 你不可以让 Agent 做什么：[禁止的 Agent 使用方式]

## 👨‍🏫 教师审查重点
教师在本阶段会重点看你的：[设计决策、ADR 质量、规格一致性……]

## 提交物
[本阶段需要提交的所有产物]

## 评分标准
[本阶段的评分权重与依据]
```

**12 个 Lab 列表**：

| Lab | 阶段 | 设计问题（示例） |
|-----|------|----------------|
| Lab 0 | 环境搭建 | 你的第一份 ArchitectureSeed——你的 OS 大概是什么样？ |
| Lab 1 | 启动与串口 | 你的启动路径选择及理由（写入 ADR-001） |
| Lab 2 | 物理页分配器 | freelist/buddy/slab 你选哪个？为什么？ |
| Lab 3 | 虚拟内存 | 你的页表设计——Meltdown 给了你什么教训？ |
| Lab 4 | 陷阱与系统调用 | syscall vs IPC 你倾向哪个？fork 还是 spawn？ |
| Lab 5 | 调度器与用户态 | 你的调度策略——用什么优先级模型？ |
| Lab 6 | ABI 与程序加载 | FD 还是 Handle？你的资源抽象设计 |
| Lab 7 | 资源表设计 | 命名空间如何组织？ |
| Lab 8 | IPC 与 VFS | 微内核 IPC 性能优化策略 |
| Lab 9 | 验证与证据 | 你的系统对了吗？怎么证明？ |
| Lab 10 | 个性化目标 | 二进制兼容/性能/安全/体积/启动速度——你选哪个？ |
| Final Lab | 综合提交 | ArchitectureSeed → ADR → Slice → FinalSynthesis 完整故事线 |

## Specs/ 规格写作手册（9 个指南）

每个指南含：为什么需要这个文档 / 完整字段说明 / 正例与反例 / 🤖 Agent 辅助边界 / 👨‍🏫 教师审查要点

核心指南：ArchitectureSeed 写法（含完整 YAML Schema）、ADR 写法（含 3 个完整示例）、ModuleSpec 写法、OperationContract 写法（含 kalloc 示例）

## Appendices/ 附录（6 个）

vos 命令速查表 / QEMU 使用指南 / GDB 调试指南 / RISC-V/ARM/x86-64 ISA 对比 / C/Rust/Zig 语言对比 / Agent 协作策略

## Teacher/ 教师专用（6 个指南）

课程配置指南 / 如何审查个性化设计（ADR 评判框架） / AI Policy 配置指南 / Agent 使用审计指南 / 隐藏测试设计原则 / 评分规则 (Rubric) 配置指南

---

# 材料三：用户手册大纲（精简版）

1. **快速开始**：环境要求 (Bun ≥1.3, RISC-V 工具链, QEMU) → 安装初始化 → 第一个实验项目 → 第一份 ArchitectureSeed
2. **VOS 命令参考**：按类别组织（项目管理/Spec/构建运行/验证/Agent/报告提交/知识库）
3. **Spec 编写指南**：目录结构规范 → ArchitectureSeed + ADR 完整写法 → YAML 格式 → 校验与 lint
4. **Agent 使用指南**：配置 (`.vos/config.toml`) → 7 个身份的使用场景与边界 → 对话式交互 → 代码生成 → 调试辅助 → 知识库问答
5. **👨‍🏫 教师专属章节**：课程配置 → 设计审核流程 → AI Policy 配置 → 评分规则 → Analytics 解读
6. **常见问题**

---

# 材料四：汇报 PPT 要点（三线叙事）

## 叙事结构

| 部分 | 页数 | 核心叙事 |
|------|------|---------|
| **困境** | 3-4 页 | 学生困境（千人一面）→ 教师困境（重复劳动 + 无设计评价）→ AI 困境（代写无约束） |
| **回答一：学生** | 4-5 页 | 🏗️ 个性化架构——5 维度设计空间一页图 + ArchitectureSeed→ADR→Slice 生长过程 + 指导书"设计导航"理念 |
| **回答二：Agent** | 4-5 页 | 🤖 受控协作——7 身份 + StageGate 一页图 + 审计链路 + 知识库 + 自动诊断 |
| **回答三：教师** | 4-5 页 | 👨‍🏫 角色升维——三个转变 + 六阶段审核表 + 评分工具箱 + Analytics 驾驶舱 |
| **三线交汇** | 2-3 页 | OperationContract 交汇点一页图 + 三条线的依存关系全景图 + "Agent 让个性化可规模化，个性化让 Agent 使用可评价" |
| **证据** | 2-3 页 | xv6-spec 参考实现数据 + 学生全流程验证 + 教师审查示例 |
| **总结** | 2 页 | 三线全维度对比表 + SpecLab 通用平台未来方向 |

## 关键 PPT 页面清单

1. **困境页**：三个困境并列，各一句话
2. **方案总览页**：三条线交织的全景图（参考第一章 1.3 的 ASCII 图）
3. **学生线一页图**：ArchitectureSeed → 9 个 Slice → ADR → 代码 → 验证的完整流程
4. **Agent 线一页图**：7 身份 + StageGate 梯度释放时间线 + 审计链路
5. **教师线一页图**：三个转变（批改→审核、调试→治理、终结→过程）+ 六阶段审核表
6. **三线交汇页**：OperationContract 的三线标注图
7. **依存关系页**：六对依存关系的可视化（参考第三章 3.2）
8. **对比表页**：综合对比表（MIT 6.S081 / rCore / 裸 AI / VeriSpecOSLab）
9. **数据页**：xv6-spec 关键指标 + 学生全流程验证数据
10. **未来页**：SpecLab 通用平台愿景

---

# 附录

## 引用来源索引

| 来源文件 | 关键内容 | 用于章节 |
|---------|---------|---------|
| `docs/design/draft.md` | 总体方案、个性化 YAML 模板、教学目标 | 第1,3,4章 |
| `docs/design/innovation.md` | 创新点、教师/学生视角分析、"设计导航"理念 | 第2,4,5,12章 |
| `docs/design/arch.md` | 总体架构、三层架构图、local-first 结构 | 第1,10章 |
| `docs/design/spec/00-07` | 三层规格体系、操作级 Spec 设计原则、SpecPatch | 第4章 |
| `docs/design/agent/README.md` | 7 Agent 身份+能力包模型、Session Envelope | 第6章 |
| `docs/design/agent/knowledgebase-agent-v1.md` | KB Agent 教学契约、Answer Schema、CLI 表面 | 第7.4节 |
| `docs/design/adr/ADR-001` | Agent 架构决策——多角色→统一 Agent runner | 第6章 |
| `docs/design/toolchain/00-09` | VOS Runtime 五层模型、ToolchainSpec、Agent 工具链物化 | 第9章 |
| `docs/design/platform/00-12` | 平台架构、领域模型、评分/Analytics、MVP 路线图 | 第8,10章 |
| `docs/design/platform/09-roles-workflow-and-stage-gates.md` | 角色协作、状态转换、审核流程 | 第8.5节 |
| `docs/design/platform/10-scoring-evidence-and-teaching-analytics.md` | 评分输入、证据映射、Analytics | 第8.3-8.4节 |
| `docs/design/workflow/00-08` | 五角色协作、教师/学生工作流、阶段模型 | 第8章 |
| `docs/design/workflow/03-teacher-workflow.md` | 教师完整主线（建课→审核→评分→复盘） | 第8.1-8.5节 |
| `docs/design/workflow/05-student-workflow.md` | 学生阶段闭环、SpecPatch 流程 | 第4章 |
| `docs/design/manual.md` | "一站四册"结构、"设计导航"三条约束、历史驱动教学 | 第5章 |
| `docs/design/portal-spec.md` | Portal 数据库 Schema、API 设计 | 第10章 |
| `docs/design/future.md` | SpecLab 通用平台扩展方向 | 第13.3节 |
| `docs/thoughts.md` | OS 教学反思：历史驱动、设计优先 | 第5.2节 |
| `examples/xv6-spec/` | 完整参考实现（spec/ + kernel/ + user/ + .vos/） | 第11章 |
| `docs/student-replication-plan.md` | 学生 9 阶段全流程验证记录 | 第11.5节 |
| `vos/` workspace | 实现代码：5 个共享包 + 4 个应用 | 第9.3节 |
| `REASONIX.md` | 技术栈与约定 | 附录 |

## 全文 9 个关键论点（三线各 3 条）

### 🏗️ 学生线
1. **ArchitectureSeed = "这是我的设计"**——个性化从第一份文档开始
2. **"设计导航"型指导书**——描述问题不预设方案，培养设计师而非代码工人
3. **从 Atlas 1961 到 Sv39**——每个机制有来历，每个取舍有故事，历史是最好的设计老师

### 🤖 Agent 线
4. **AI 不禁止也不放任**——7 身份 + StageGate = 梯度释放的治理
5. **OperationContract = Agent 的执行边界**——规格是约束 AI 的唯一语言
6. **审计不是不信任，是可追溯**——完整链路让学术诚信有据可查

### 👨‍🏫 教师线
7. **教师从"代码检查员"升维为"设计导师"**——Agent 扛重复劳动，教师聚焦设计指导
8. **ADR 是判断"学生是否真正理解"的最强信号**——审查设计理据，而非代码相似度
9. **从"终结性评价者"变为"过程性指导者"**——全阶段追踪，而非期末一次性宣判
