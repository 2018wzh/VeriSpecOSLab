# VeriSpecOSLab 决赛报告视频与 PPT 演示蓝图

> 适用场景：2026 年全国大学生计算机系统能力大赛操作系统设计赛，功能挑战教学型赛道全国总决赛 8 分钟答辩视频。  
> 目标成片：7 分 45 秒至 7 分 55 秒。  
> 参赛队：Glenda（T2026102699911097）  
> 队员：汪子昊、徐泽逸、罗豪荣；指导教师：陈渝、石亮。  
> 材料许可：CC BY-SA 4.0。

本文档是决赛演示的唯一蓝图，统一管理 17 页主讲 PPT、近逐字稿、演示分镜、素材来源、引用和 8 页答辩附录。历史文件 `docs/comp/ppt.md` 描述的是已经退役的 v1 方案，只用于回顾初赛叙事，不得从中恢复 ArchitectureSeed、ADR、StageGate、七角色 Agent 或旧在线命令。

---

## 1. 汇报定位

### 1.1 核心论断

封面、案例和结尾都要回答同一个问题：生成式 AI 已经能够编写大量代码，操作系统实验还应该训练什么？

本项目给出的回答是：

> 让学生从实现既定答案转向设计自己的 OS，让教师从评审代码转向评审设计，让 Agent 成为受规格约束、由真实验证负责的工程协作者。

代码训练仍然重要，学生依然需要构建、运行、调试并解释代码。改变的是评价对象：实现正确性成为基础门槛，学生对目标、边界、接口、不变量和取舍的理解进入课程评价中心。

### 1.2 时间与内容配比

| 部分 | 页码 | 时间 | 比例 | 任务 |
|---|---:|---:|---:|---|
| 问题与愿景 | 1–3 | 1:05 | 14% | 让评委记住教学范式转型 |
| 方法与系统 | 4–11 | 3:55 | 50% | 解释 Spec、Agent、验证和 VOS 的四类关键能力 |
| 教材、案例与试讲 | 12–14 | 1:35 | 20% | 用真实课程、仿真、实板和学生反馈支撑论断 |
| 合规、展望与总结 | 15–17 | 1:15 | 16% | 交代来源、增量、AI 使用、正式教学与未来案例 |
| **合计** | **17 页** | **7:50** | **100%** | 留出约 10 秒剪辑余量 |

### 1.3 视觉系统

- 画布使用 16:9、浅色论文报告风。背景为白色或极浅灰，标题和关键结构使用深蓝/靛青。
- 正文每页只保留一个中心判断。标题写结论，不写“项目介绍”“技术方案”一类目录词。
- 证据状态统一：绿色“已闭合”，蓝色“已实现/已验证”，黄色“候选/待实板”，灰色“未来计划”。禁止用同一种“完成”颜色覆盖不同证据等级。
- 中文标题建议 28–32 pt，正文 18–22 pt，脚注 10–12 pt。终端画面只保留关键命令、关键状态和最后结果。
- 比较、历史、论文和赛事要求在页脚给出短引用，如 `[R1][R3]`；完整信息放在附录 8 和本文末尾。
- 页面转场使用简单淡入或状态推进，不使用旋转、弹跳、粒子等装饰动画。演示录像由 PPT 内嵌 MP4 播放，不依赖现场网络。

---

## 2. 17 页主讲 PPT 与近逐字稿

### P1　VeriSpecOSLab

**时间：0:00–0:15（15 秒）**

**页面结论**

> 规格驱动的个性化 OS 设计与 Agent Coding 实验平台

**画面**

- 中央为项目名和副标题。
- 下方只放两条角色变化：`学生：实现既定答案 → 设计自己的 OS`；`教师：评审代码 → 评审设计`。
- 页脚给出赛队、学校、成员和指导教师，不展示功能列表。

**讲稿**

大家好，我们是华东师范大学 Glenda 队。当 AI 已能编写大量内核代码，OS 实验还该训练什么？我们的答案是：让学生设计自己的 OS，让教师评审设计。

**转场**

“传统实验和生成式 AI 的引入，各自暴露出一组新的矛盾。”

**页脚引用**：`[R1][R2]`

---

### P2　代码能通过，不等于学生完成了设计

**时间：0:15–0:40（25 秒）**

**页面结论**

> 给定框架适合训练机制实现，却很难观察学生如何作出系统设计。

**画面**

左右强对比：

| 传统实验主链 | 裸 Coding Agent 带来的新问题 |
|---|---|
| 给定内核与修改位置 | 自然语言任务直接变成大段补丁 |
| 补全代码并运行固定测试 | 可能越界修改、跳过设计 |
| 教师主要看到最终代码和通过率 | 模型可以“自报测试通过” |
| 差异集中在实现细节 | 学生责任与 AI 贡献难区分 |

页面底部保留一句限定：“xv6、rCore 等课程在机制教学上已经成熟；VeriSpecOSLab 补的是个性化设计与 Agent 工程训练。”

**讲稿**

xv6、rCore 等课程很适合讲清操作系统机制，但学生通常在给定架构中实现，教师主要看到代码和测试。即使两人都通过测试，也很难据此判断他们是否理解方案取舍。裸 Coding Agent 还可能跳过设计、越界修改，甚至只用文字声称测试通过。程序能运行，仍然说明不了学生为什么这样设计。

**转场**

“为此，我们重新划分了学生、Agent 和教师的责任。”

**页脚引用**：`[R2][R3][R10]`

---

### P3　教学目标发生两次转向

**时间：0:40–1:05（25 秒）**

**页面结论**

> 学生学习定义系统，教师评价设计理由，代码与测试成为可复查的工程证据。

**画面**

用两条水平箭头表达转型：

1. 学生：`代码实现能力` → `个性化 OS 设计能力 + Agent Coding 工程能力`
2. 教师：`代码审阅者 / 高级调试员` → `设计评审者 / 课程规则制定者`

中间放三类教师问题：

- 为什么选择这种内核组织和资源模型？
- Spec 是否说明了边界、不变量和失败语义？
- Agent 的修改是否经过学生理解和真实验证？

**讲稿**

构建、调试和代码解释仍是基本训练。在此之上，学生还要定义系统目标、模块边界和验收方法，约束 Agent、阅读差异并判断结果是否可信。教师则从反复排查环境和代码错误，转向审查设计理由、演化过程与证据。正确性仍是门槛，但不再是唯一评价对象。

**转场**

“这两次转向，需要一条可以落实到课程中的流程。”

**页脚引用**：`[R2][R4][R6]`

---

### P4　一个可执行的教学闭环

**时间：1:05–1:30（25 秒）**

**页面结论**

> 从理解问题到教师复核，每一步都留下下一步可以消费的结果。

**画面**

环形流程图：

```text
理解问题 → 学生手写 Spec → Agent 受控实现 → 确定性验证
   ↑                                           ↓
设计迭代 ← 教师评审设计与证据 ← 报告和提交归档
```

环外标责任：

- 学生：选择、书写、解释、验收；
- Agent：问答、只读评审、限定范围实现、诊断；
- VOS：schema、Git diff、Runner、证据和提交；
- 教师：阶段规则、设计评审、实板复核和最终评价。

**讲稿**

VeriSpecOSLab 把课程组织成可执行闭环。学生理解问题并亲手写 Spec，Agent 只在明确范围内实现。VOS 独立检查修改，运行构建和测试，再把版本、规格与日志写入报告。成功和失败都有结构化记录，教师可以回到设计与证据，提出意见后进入下一轮。

**转场**

“闭环从一组精简、可由程序检查的规格开始。”

**页脚引用**：`[R3][R4][R13]`

---

### P5　Spec 把学生的设计变成可检查输入

**时间：1:30–2:00（30 秒）**

**页面结论**

> 同一份 Spec 同时服务学生思考、Agent 实现、验证和教师评审。

**画面**

中央放五类文件，右侧只展开 ModuleSpec 的三个关键点：

| 文件 | 记录什么 |
|---|---|
| DesignSpec | 系统目标、语言、ISA、内核组织、硬件与组合不变量 |
| ModuleSpec | 模块职责、操作、性质、错误、状态与并发契约 |
| InterfaceSpec | syscall、IPC、驱动和用户/内核 ABI |
| GoalSpec（可选） | 可度量的性能、兼容性或研究目标 |
| SpecPatch | 跨模块变化的原因、影响范围与回归要求 |

右侧强调：

- `owns`：本次 Agent 可以修改哪些路径；
- properties/checks：什么行为必须被验证；
- L1/L2/L3：从基本边界逐步增加状态与并发精度。

**讲稿**

学生维护五类规格：DesignSpec 记录系统方向，ModuleSpec 描述模块职责、性质和错误，InterfaceSpec 固定跨边界语义，GoalSpec 表达可度量的扩展目标，SpecPatch 说明跨模块修改。ModuleSpec 中的 owns 限定改动范围，properties 和 checks 则进入验证。这样，教师可以据此审查设计，Agent 和 Runner 也能获得一致的任务定义。规格从 L1 到 L3 随课程逐步加深，不要求学生在第一周就写出完整的内核设计。

**转场**

“当规格提交以后，Agent 才进入实现阶段。”

**页脚引用**：`[R3][R5][R12]`

---

### P6　模型提交结果，平台决定是否通过

**时间：2:00–2:30（30 秒）**

**页面结论**

> Agent 的文字结论没有验收权；Git 差异、结构化结果和真实 Runner 才决定任务状态。

**画面**

使用 `agent-transaction.svg` 改成六步事务图：

```text
已提交 Spec
   ↓
detached linked worktree
   ↓
限定 owns / SpecPatch 修改范围
   ↓
结构化结果提交与 schema 检查
   ↓
build + public + contract + fuzz + trace
   ↓
HEAD 未漂移后原子应用并提交
```

右下角用红框写明失败行为：越界、编译失败、测试失败、结构化结果不完整，均返回同一模型线程继续修正；原工作树不被半成品覆盖。

**讲稿**

实现任务从已提交的 Spec 开始。VOS 创建独立的 Git 工作区，并把可修改范围交给 Agent。Agent 必须提交机器可检查的结构化结果；平台随后读取真实 diff，运行 build、public、contract、固定种子 fuzz 和有界 trace。模型声称“已经完成”不会改变任务状态，测试遗漏或越界修改仍会被拒绝，并回到同一会话修正。全部检查通过且原项目没有漂移后，补丁才会形成独立提交。

**转场**

“下面用四十秒看这条链怎样落到真实项目。”

**页脚引用**：`[R3][R4][R14]`

---

### P7　核心链演示：从学生设计到真实运行

**时间：2:30–3:10（40 秒）**

**页面结论**

> 每一段演示都回答一个责任问题，而不是展示命令数量。

**画面与分镜**

| 时间 | 画面 | 屏幕标注 | 旁白重点 |
|---:|---|---|---|
| 0–10 秒 | 学生修改精简的 ModuleSpec，运行 `vos spec lint` | “设计由学生提交” | Spec 是学生理解的外化结果 |
| 10–22 秒 | `vos agent implement <module>`，显示隔离工作区、修改范围和重试状态 | “Agent 在边界内实现” | 未完成补丁不覆盖原项目 |
| 22–32 秒 | `vos verify` 和 `vos report`，依次出现测试类型与 evidence | “验证不调用模型” | 通过来自 Runner，不来自模型文字 |
| 32–40 秒 | QEMU 串口切到 VF2 四 hart 与 `ALL TESTS PASSED` | “仿真与实板分层记录” | 最终结果可追到真实硬件日志 |

**讲稿**

学生先写下模块边界和验收性质，lint 只检查结构，不替学生作技术选择。实现助手随后在独立工作区修改代码，VOS 根据真实 diff 检查范围。verify 不调用模型，而是实际执行构建和多类测试；report 再把提交、规格与日志绑定起来。四段画面依次交代设计、修改、验收和硬件结论由谁负责。证据链也由 QEMU 一直延伸到 VisionFive 2 四核实板。

**剪辑要求**

- 四段均预录，不等待模型和构建。
- 终端放大到只显示 8–12 行关键输出。
- VF2 日志必须同时出现 `hart 1/2/3 starting` 与 `ALL TESTS PASSED`，避免只截最后一行。

**页脚引用**：`[R3][R9][R14]`

---

### P8　让 AI 回答回到可核对的知识来源

**时间：3:10–3:35（25 秒）**

**页面结论**

> Agent 可以帮助补充背景，但每个事实都要能回到教材、代码或固定版本的资料。

**画面**

左侧为问题与知识来源，右侧为结构化回答：

```text
教材 / 代码 / 固定 revision
          ↓  vos kb add / search
设计问题 → agent ask → 回答 + citation + 下一步核对项
```

页面下方用两种状态区分：绿色“引用可定位”，黄色“回答仍需学生判断”。明确无来源时 citation 必须为空，不能由模型虚构文献。

**视频演示（15 秒，预录静音）**

1. `vos kb search "Sv39 page table"` 返回来源与内容片段；
2. `vos agent ask "页表遍历失败时应先检查哪些不变量？"`；
3. 展开回答中的 citation，回到对应教材段落；
4. 画面定格在“引用提供核对入口，不等于答案自动正确”。

当前素材读取 Glenda Lab 10 中一次由真实 provider 生成、并通过结构化结果校验的 `agent ask` 记录。画面展示问题、回答摘要、citation 数量与四个可定位来源，不再使用本地夹具。录制时仍要保留边界提示：引用让结论可以核对，却不会让结论自动成立。

**讲稿**

学生缺少背景时，裸模型容易把似是而非的解释写得很确定。VOS 让 ask 从课程知识库取材，并用结构化 citation 指回教材、代码或固定版本资料。引用解决的是“根据什么回答”，正确性仍由学生核对；找不到来源时，也必须如实留空。

**证据边界**

- `agent ask` 和 `agent review` 不修改项目文件；
- citation 证明回答使用了哪份材料，不证明结论天然正确；
- 不把网络检索结果或模型记忆自动写入学生 Spec。

**页脚引用**：`[R3][R4][R14]`

---

### P9　把“内核卡住了”还原为可定位的故障链

**时间：3:35–4:05（30 秒）**

**页面结论**

> Debug Agent 先绑定失败运行，再用 trace、GDB 与 QEMU 观测缩小故障范围。

**画面**

```text
失败 run ID
   ↓
串口症状 / 超时点
   ↓
trace 事件 → GDB 寄存器与调用栈 → QMP/HMP 机器状态
   ↓
根因候选 + 证据链 + 下一条诊断命令
```

右侧明确角色边界：Debug Agent 只读诊断；修复仍要回到 Spec、实现和 verify 主链。

**视频演示（20 秒，预录静音）**

1. 回放一次带 run ID 的 QEMU 超时或 trap 失败；
2. 执行 `vos agent debug --run <run-id>`；
3. 展开同一故障位置的 trace 事件、GDB 寄存器/调用栈和诊断结论；
4. 定格在 `evidence_chain` 与 `next_diagnostic_commands`，不展示未经验证的“已修复”。

当前素材来自一次真实失败构建及其 Agent 诊断。画面从 `build_error` 出发，依次展开编译器主错误、次生错误、构建中止和源码快照差异，最后停在下一条诊断命令。它展示的是证据链如何缩小范围，不把诊断说成已经修复。

**讲稿**

内核故障常只表现为黑屏、超时或一行 trap。Debug Agent 先读取失败 run 的真实日志，再按 trace、GDB、QMP 的顺序补充观测，把外部症状连到寄存器、调用栈和内部路径。它只报告证据、根因候选与下一步命令，不修改源码，也不能把诊断写成修复通过。

**证据边界**

- 诊断必须绑定具体 run ID 和可读取的 artifact；
- Debug Agent 结果不能覆盖 `vos verify` 的确定性状态；
- GDB/QEMU 观测失败时保留失败证据，不用推测补齐。

**页脚引用**：`[R3][R14]`

---

### P10　自动生成 QEMU 板级模型，提前暴露板卡差异

**时间：4:05–4:35（30 秒）**

**页面结论**

> QEMU 板级模型让启动链和设备语义可重复验证，但始终只形成 `qemu_only` 证据。

**画面**

```text
学生提交 request + 板卡材料
              ↓  preflight
boot path / bypass / reuse matrix / blocker
              ↓
Agent 生成 candidate → 学生审查、approved、Git commit
              ↓  execute
QEMU 阶段提交 → boot-to-shell → 邻居机器回归
              ↓
qemu_only；转入真实板卡验证
```

**视频演示（20 秒，预录静音）**

1. `vos agent qemu preflight qemu.orange-pi-prime` 盘点材料并生成 candidate；
2. 快速展开 `boot_path`、显式 bypass 与设备 `reuse_matrix`；
3. 切到已由学生批准并提交的 revision，运行 `vos agent qemu execute qemu.orange-pi-prime.r1`；
4. 显示 QEMU commit、boot-to-shell、邻居回归和黄色 `qemu_only` 状态。

当前素材同时读取真实 H5 QEMU 报告和 Orange Pi Prime 串口日志。前半段显示固件链、MMU、UART、定时器、SMP/IPI、MMC 与 Lab 1–8 回归；后半段切到实体板的四核上线、GICv2 IPI、定时器中断、MMC 数据往返、EL0 工作负载和 `GLENDA_H5_BOOT_OK`。画面明确保留两层状态：QEMU 只能形成 `qemu_only`，实板结论必须来自独立串口证据。

**讲稿**

物理板卡移植往往同时受启动链、设备模型和固件差异影响。VOS 先根据学生提供的材料生成 QEMU candidate，学生审查并提交后，Agent 才在隔离工作区完成模型移植、启动到 shell 和邻居回归。它能提前暴露软件与设备语义问题，但 QEMU 通过绝不替代真实时钟、引脚和外设证据。

**证据边界**

- 硬件事实只来自 `references/qemu/<request-id>/`，材料不足不生成 candidate；
- candidate 是唯一允许 Agent 生成的 Spec 例外，必须由学生改为 `approved` 并提交；
- 执行不改写 `vos.yaml`、不 push，QEMU 结果不能升级实板状态。

**页脚引用**：`[R3][R6][R14]`

---

### P11　用 commit 精确记录，并在同一版本上复原

**时间：4:35–5:00（25 秒）**

**页面结论**

> commit 是开发记录的坐标；报告与提交归档再把 Spec、运行和证据绑定到这个坐标。

**画面**

```text
Git commit
  ├─ 源码 / Spec / vos.yaml
  ├─ Run-ID / Spec-Hash trailer
  └─ report：checks / evidence / config hash
                     ↓
submit archive：脱敏日志与可复现材料
                     ↓
detached worktree 回到该 commit，重新执行验证
```

**视频演示（15 秒，预录静音）**

1. 查询两个项目已通过教师复核的 Lab 10 权威 run；
2. 高亮 run 绑定的 commit、检查计数和最终状态；
3. 用 Git 从 Portal 仓库检出这两个精确 commit，核对恢复后的 HEAD 和受版本控制文件数；
4. 提示 Portal 仍保留公开运行、权威运行、评审材料与失败历史。

当前素材由采集脚本登录真实 Portal，分别读取 xv6-spec 与 glenda-spec 的 Lab 10 记录。画面显示提交短 SHA、权威 run ID、检查计数和终态，并说明 Portal 同时保留公开运行、权威运行、评审材料与失败历史。Git 负责复原受版本控制的状态，Portal 负责复原与该版本相连的证据时间线。

**讲稿**

每次实现都落到独立 commit，并写入 Run-ID 与 Spec-Hash。report 再绑定测试、配置和证据，submit 保存脱敏归档。复查时可以在 detached worktree 精确回到该 commit，重新执行验证；原始运行日志不进 Git，只能从对应归档取回。这样既能复原代码状态，也不会把 commit 夸大成全部证据。

**证据边界**

- Git 可复原已提交的源码、Spec 和配置，不能单独复原被忽略的 `.vos/` 原始日志；
- 只有与 commit/spec/config hash 匹配的报告和归档才能用于该版本；
- 审计链记录事件连续性，不能替代构建、QEMU 或实板结果。

**页脚引用**：`[R3][R4][R14]`

---

### P12　指导书不先给答案，先给设计所需的背景

**时间：5:00–5:20（20 秒）**

**页面结论**

> Book 解释问题为什么出现，Lab 引导学生把自己的选择做出来并验证。

**画面**

左侧展示 Book/Lab 双线缩略图，右侧给三个内容样例：

- 从批处理、分时、Unix 到微内核之争，解释设计产生的历史条件；
- 在进程、资源模型、文件系统和硬件章节比较多种方案，不设唯一答案；
- Lab 1 用 Linux 与裸机读取同一 flag 的 CTF 热身，建立“OS 替程序做了什么”的直觉。

页脚状态：“学生公开出版物固定为 Lab 1–10 + Final Lab 的 11 组 Book/Lab，共 22 份 PDF。”

**讲稿**

课程材料分为 Book 和 Lab。Book 用历史与设计争论解释问题，Lab 给出任务、预期现象和自检点。例如 Lab 1 让学生在 Linux 和裸机中读取同一份 flag，观察 OS 承担的文件与设备访问，再带着这一直觉逐步选择内核组织和资源模型。

**页脚引用**：`[R6][R12]`

---

### P13　两个内核、两种架构、严格区分两类证据

**时间：5:20–6:05（45 秒）**

**页面结论**

> 两个案例都闭合了真实板卡门禁，并证明同一方法可以跨内核、跨架构复用。

**画面**

左右两张案例卡：

#### 左卡：xv6 + VisionFive 2　`已闭合实板证据`

- StarFive JH7110，四个 SiFive U74 hart；
- SPI U-Boot 2021.10 → TFTP legacy uImage + DTB；
- SD 卡 `xv6fs`，真实读写；
- 四 hart 启动并完成完整 `usertests`；
- 结果：`ALL TESTS PASSED`；证据提交：`6b1c624`。

#### 右卡：Glenda + Orange Pi Prime　`QEMU + 四核实板已闭合`

- 从 RISC-V 教学内核迁移到 AArch64/Allwinner H5；
- TF-A BL31 → U-Boot → Glenda；QEMU 明确绕过 BROM/SPL；
- MMU、UART、GICv2、timer、PSCI SMP/IPI、MMC 和 Lab 1–8 累计负载；
- 七项 H5 trace 与聚合 goal 通过；
- Orange Pi Prime 经 BROM、SPL、BL31、U-Boot 启动，四个 Cortex-A53 核心、GICv2、定时器、MMC 与 EL0 Lab 1–8 工作负载通过；Portal 教师复核闭合。

**讲稿**

xv6 在 VisionFive 2 上启动四个 U74 hart，经 SPI U-Boot、TFTP 与 SD 文件系统跑完完整 usertests，日志给出 `ALL TESTS PASSED`。Glenda 把同一方法迁移到 AArch64/H5：七项 QEMU trace 先验证软件与设备语义，再由 Orange Pi Prime 串口独立确认四核、GICv2、定时器、MMC 和 EL0 Lab 1–8 工作负载。两个案例都经过 Portal 权威运行、材料上传和教师复核，但 QEMU 与实板证据仍分栏记录。

**演示与证据要求**

- 左卡播放 VF2 串口关键行，右卡播放 H5 七项 trace 汇总。
- 两张实板卡都用绿色“已闭合”；Glenda 的 QEMU 结果仍单列为蓝色 `qemu_only`，不与实板状态合并。
- Glenda 实板结论只使用与当前内核、DTB、SD 镜像和课程提交绑定的串口与硬件报告。

**页脚引用**：`[R7][R8][R9]`

---

### P14　15 名学生的试讲，直接改变了课程入口

**时间：6:05–6:35（30 秒）**

**页面结论**

> 试讲没有证明教学成效，却清楚暴露了学生在哪些地方无法开始。

**画面**

标题下标注：“华东师范大学 2025 级计算机拔尖班，15 名学生，两节暑期试讲；定性课堂观察。”

| 课堂观察 | 诊断 | 已完成改进 |
|---|---|---|
| 初版 Spec 格式过于复杂 | 学生在理解机制前先承担了规格工程负担 | 收敛为五类文件，L1–L3，按 Lab 渐进补充 |
| 学生缺少 OS 背景 | 无法判断架构选项会怎样影响实现 | 重写 Book/Lab，补历史、机制、比较与自检 |
| 入门缺乏抓手，工程工具太多 | 环境和大型项目操作挤占概念学习 | CTF 热身、统一 CLI、`doctor`、分步验收 |

右下角写明限制：“没有对照组、问卷统计或学习增益显著性结论。”

**讲稿**

暑期试讲面向华东师大 2025 级计算机拔尖班的 15 名学生，共两节课。这不是一项教学效果实验，但课堂观察暴露了三个具体问题：Spec 太复杂，学生缺少 OS 背景，大型项目涉及的工具又太多。这些反馈不能证明学习效果提升，却解释了学生为什么难以开始。为此，我们把规格收敛为五类，将设计决定分散到对应 Lab，重写 Book 与 Lab，并用 CTF、统一 CLI 和 doctor 降低起步门槛。

**转场**

“这些改进属于本队贡献，但它们建立在已有研究和开源项目之上。”

**页脚引用**：`[R11][R12]`

---

### P15　借鉴、增量贡献与 AI 使用

**时间：6:35–6:55（20 秒）**

**页面结论**

> 来源、AI 生成范围和人工责任必须与技术贡献一起公开。

**画面**

独立合规页，使用三栏：

| 借鉴与来源 | 本队创新与增量 | AI 使用与验证 |
|---|---|---|
| SYSSPEC/SPECFS：规格分解、规格补丁与生成式系统思想 | 面向 OS 教学的 v2 Spec、渐进课程和教师设计评审 | Codex（GPT-5.5）：部分文档、代码与测试生成 |
| MIT xv6-riscv：教学内核思想与参考源码 | VOS Agent/Runner、修改范围、结构化交付和证据链 | DeepSeek V4 Pro：xv6-spec Demo 中的 Agent 运行 |
| Glenda：第二套教学内核与课程案例基础 | VF2 实板移植、Glenda H5 跨架构案例、Portal 与教材 | 人工负责设计、审查和修改；真实 build/QEMU/实板验证结论 |

页面底部：

- 非本队代码和文档按原许可证标注；
- 答辩 PPT、PDF 和视频采用 CC BY-SA 4.0；
- 最终提交前以 Git 记录、AI 使用报告和审计材料复核模型名称与生成范围。

**讲稿**

我们借鉴 SYSSPEC、SPECFS 的规格驱动思想，并以 MIT xv6 和 Glenda 为案例。本队把规格、受控 Agent、真实 Runner、教材、教师复核与硬件路径连成教学流程。研发使用 Codex 和 DeepSeek V4 Pro；生成内容均经人工修改，并由构建、QEMU 或实板结果验收。

**页脚引用**：`[R1][R2][R10][R15]`

---

### P16　下一学年：用 Glenda-Chimera 检验个性化设计

**时间：6:55–7:25（30 秒）**

**页面结论**

> 2026–2027 学年进入正式教学，下一案例不再沿用 xv6 的架构答案。

**画面**

左侧为课程落地时间轴：

```text
暑期两节试讲 → 当前课程与工具链改造 → 2026–2027 学年正式教学
```

右侧为 Glenda-Chimera 概念图：

```text
Rust seL4 风格微内核
  ├─ 地址空间 / 线程 / 调度
  ├─ capability / IPC / 最小可信核心
  └─ 稳定 RPC/IPC ABI
          ↓
Go RPC 风格内核服务
  ├─ 文件系统
  ├─ 设备与系统服务
  └─ 同一服务代码可在内核态或用户态切换
```

底部状态：`课程与研究目标，尚未宣称实现完成`。

**讲稿**

下一学年，这套方案将进入正式课程。我们还计划用它实现和验证 Glenda-Chimera：用 Rust 编写 seL4 风格微内核，用 Go 开发 RPC 风格的系统服务，并通过稳定的 IPC 边界，让同一份服务代码可以在内核态与用户态之间切换。迁移前后，接口、错误和资源语义必须保持一致，正好可以用 Spec 和跨边界测试表达。这个案例将检验平台能否承载跨语言、微内核与学生自主选择的系统设计。

**页脚引用**：`[R6][R11]`；Chimera 架构为团队后续设计目标。

---

### P17　重新定义 OS 实验的评价对象

**时间：7:25–7:50（25 秒）**

**页面结论**

> 代码证明系统能够运行，Spec 与证据说明学生为什么这样设计、又如何证明它可信。

**画面**

三行收束：

1. 学生设计自己的 OS；
2. Agent 在 Spec 和验证约束下参与工程；
3. 教师依据设计、演化过程和证据评价。

页面下方保留最终句：

> 我们不是减少学生思考，而是把学生的思考从重复编码提升到系统设计。

右下角放项目仓库二维码和“谢谢”。二维码只指向赛事允许公开的最终仓库，不指向临时 Demo 或本机服务。

**讲稿**

VeriSpecOSLab 改变的是 OS 实验的评价对象。代码和测试证明系统能够运行，Spec、提交与证据则说明学生为什么这样设计，又如何确认 Agent 的实现可信。教师由此获得了可以追问、比较和复核的设计材料。我们不是减少学生思考，而是把学生的思考从重复编码提升到系统设计。谢谢各位老师。

**页脚引用**：`[R2][R3]`

---

## 3. 演示录像分镜与素材清单

### 3.1 统一录制规范

- 所有片段使用 1920×1080、30 fps、H.264 MP4，字号保证投影观看可读。
- 录制前清空 API key、用户名、绝对路径、串口设备名和私人服务地址。路径统一裁剪为项目相对路径。
- 命令完成后停留 1–2 秒，再切下一段。加速只用于中间等待，不能删掉失败重试或把多次运行拼成一次“通过”。
- 画面左上角固定显示阶段，如“学生写 Spec”“Agent 隔离实现”“Runner 验证”“实体板证据”。
- 旁白覆盖所有片段。终端原声关闭，实板片段可保留低音量环境声，但不依赖声音传递结论。
- 每个通过画面同时显示输入身份和结果，例如 commit、Spec ID、run ID 或板卡身份。单独出现绿色对勾不算证据。

### 3.2 主链四段录像

| 编号 | 时长 | 操作 | 必须进入画面的内容 | 禁止出现 |
|---|---:|---|---|---|
| D1 | 10 秒 | 编辑一个当前 ModuleSpec 并运行 `vos spec lint` | `owns`、一条 property/check、lint 结果 | 旧 kind、ArchitectureSeed、`arch lint` |
| D2 | 12 秒 | 运行 `vos agent implement <module>` | detached worktree、目标模块、结构化结果或重试、最终 diff 范围 | 模型 prose 直接作为成功结论 |
| D3 | 10 秒 | 运行/回放 `vos verify` 与 `vos report` | public/contract/fuzz/trace、明确状态、报告与 commit/Spec 绑定 | 只展示 `agent verify` 的自然语言判断 |
| D4 | 8 秒 | QEMU 串口转 VF2 实板摘要 | QEMU 状态、四 hart 行、`ALL TESTS PASSED` | 用 QEMU 截图冒充开发板 |

### 3.3 P8–P11 四段功能演示

每页只嵌入一段短片，进入页面后自动播放一次，结束帧停在该页的证据结论。建议按下列名称导出，便于 PPT、PDF 关键帧和最终压缩包逐项核对。

| 页面 / 文件名 | 成片时长 | 镜头顺序 | 结束帧必须保留 | 不得暗示 |
|---|---:|---|---|---|
| P8 / `videos/p08-kb-citation.mp4` | 约 15 秒 | 真实问题 → 结构化回答 → citation 来源 → 核对边界 | `REAL ACCEPTED AGENT ASK`、citation 数量和来源 ID | 有引用就一定正确，或模型可以代替学生判断 |
| P9 / `videos/p09-kernel-debug.mp4` | 约 20 秒 | 真实失败 run → 四段 evidence chain → 下一条诊断命令 | `REAL FAILED RUN + REAL AGENT DIAGNOSIS`、`build_error` | Debug Agent 修改了源码、完成了修复或改写了 verify 状态 |
| P10 / `videos/p10-qemu-port.mp4` | 约 20 秒 | H5 七项 QEMU trace → `qemu_only` → Orange Pi Prime 四核串口 | `REAL H5 QEMU + REAL ORANGE PI PRIME` | QEMU 结果等于实板，或只看到启动标记就算完整负载通过 |
| P11 / `videos/p11-commit-replay.mp4` | 约 15 秒 | Portal 权威 run → 两项目提交坐标 → 检查计数 → 时间线边界 | `REAL CONNECTED XV6 + GLENDA CLOSURE`、commit/run/status | 单个 commit 包含 `.vos/` 原始日志，或 Portal 记录可以脱离提交使用 |

四段视频合计 70 秒，其中等待、构建和模型响应均可等比加速；命令输入、身份字段、失败状态和最终证据不得删帧。PDF 使用各视频的结束帧，并在右下角标注“视频见答辩 MP4”。

### 3.4 案例证据素材

#### VisionFive 2

素材真源为 xv6 实板分支 `codex/vf2-port` 的提交 `6b1c624`：

- `hardware/visionfive2/evidence/README.md`；
- `vf2-four-hart-usertests-summary.txt`；
- 两段原始串口日志；
- 启动链、板卡照片和接线照片如需使用，应与日志中的板卡和运行日期对应。

优先截取：

```text
xv6 kernel is booting
hart 2 starting
hart 1 starting
hart 3 starting
...
ALL TESTS PASSED
```

PPT 不展示本机串口名、TFTP 服务器地址或完整日志绝对路径。

#### Glenda H5

素材真源为 Glenda H5 的 QEMU 报告、Orange Pi Prime 硬件报告与完整串口日志：

```text
h5-firmware-chain-trace       OK
h5-mmu-trace                  OK
h5-uart-clock-trace           OK
h5-timer-irq-trace            OK
h5-smp-ipi-trace              OK
h5-mmc-data-trace             OK
h5-lab1-8-regression-trace    OK
H5_PLATFORM_GOAL_OK reports=7 ... brom_spl_bypassed=true
```

画面先显示 QEMU 七项 trace 与 `qemu_only`，再切到同一提交身份下的实体板四核、IPI、定时器、MMC 与 EL0 负载标记。两类证据必须分屏呈现，不能用 QEMU 画面替代实板结论。

### 3.5 建议复用的现有图

- `docs/comp/final-report/figures/system-architecture.svg`：P4 或附录 A4；
- `docs/comp/final-report/figures/spec-model.svg`：P5；
- `docs/comp/final-report/figures/agent-transaction.svg`：P6；
- `docs/comp/final-report/figures/evidence-chain.svg`：P9、P11 或附录 A5；
- `docs/comp/final-report/figures/course-history.svg`：P12 或附录 A2。

使用前应删去与当前 v2 不一致的标签，并把长段说明改为结论式短语。不可为了画面完整虚构 UI、日志或测试结果。

---

## 4. 八页答辩附录

附录不进入 8 分钟自动播放，保留在同一份 PPT/PDF 中供最长 30 分钟专家提问。每页顶部显示 `BACKUP`，避免与主讲页混淆。

### A1　相关课程与工具的完整比较

| 维度 | xv6/6.S081 类课程 | rCore 类课程 | 裸 Coding Agent | VeriSpecOSLab |
|---|---|---|---|---|
| 起点 | 已有小型教学内核 | 分阶段 Rust 教学内核 | 任意仓库与自然语言任务 | 空项目或课程起点 + 学生手写 Spec |
| 主要训练 | 机制理解与代码实现 | Rust 系统编程与机制实现 | 任务完成效率 | 个性化设计 + Agent Coding 工程 |
| 架构空间 | 课程预设 | 课程预设 | 无课程约束 | DesignSpec 与逐 Lab 决策 |
| AI 边界 | 通常不内建 | 通常不内建 | 依赖提示词 | 角色、只读约束、owns、SpecPatch、Runner |
| 验证 | 课程测试 | 课程测试 | 模型或外部工具各自处理 | Spec ID 绑定的多类测试与证据 |
| 教师评价 | 代码、测试、报告 | 代码、测试、报告 | 很难区分学生与模型贡献 | 设计、提交、Agent 修改、运行证据、实板复核 |

答辩口径：不要声称传统课程“不训练设计”。准确表述是，它们的公开作业和自动评价主要围绕预设架构中的机制实现，VeriSpecOSLab 将个性化设计及其过程证据显式化。

### A2　Lab 1–10 与 Book/Lab 双线

- Lab 1：CTF 热身、项目初始化、DesignSpec 与实板连接；
- Lab 2：启动；
- Lab 3：内存；
- Lab 4：中断与 trap；
- Lab 5：用户态、进程与内核组织选择；
- Lab 6：文件系统；
- Lab 7：资源与 ABI；
- Lab 8：个性化目标；
- Lab 9：QEMU 板卡移植与真实硬件；
- Lab 10：验证闭合；
- Final Lab：报告、复现与综合评价。

说明 Book 提供历史、机制与方案比较，Lab 提供任务、操作、预期现象和自检。学生公开 PDF 固定为 11 组 Book/Lab，共 22 份。

### A3　五类 Spec、L1–L3 与 SpecPatch

给出一个不超过 20 行的 ModuleSpec 真实片段，标注：

- `purpose`：当前模块为什么存在；
- `owns`：Agent 修改范围；
- `operations`：可观察操作；
- `properties/checks`：验证目标；
- `errors`：失败必须如何暴露；
- L2 的 state/pre/post/invariants；
- L3 的 concurrency/rely/guarantee/algorithm intent。

答辩重点：等级不足产生教学警告，不替学生选择技术方案；schema、引用、路径、稳定 ID 和 `verifies` 则确定性拒绝错误。

### A4　Agent 隔离事务、角色和安全边界

列出当前五个角色：implement、debug、verify、ask、review。说明：

- ask/review/debug/verify 保持只读或报告型；
- implement 在 detached linked worktree 中修改；
- 结构化结果错误会返回同一模型线程；
- `failed`、`partial`、`blocked` 不能伪装成完成；
- linked worktree 只是 Git 回滚边界，不是进程、网络、凭据或宿主文件沙箱。
- Portal 只负责课程状态、阶段门禁、证据索引和教师复核；Agent、QEMU 与工作区命令仍由 CLI/Runner 执行。

准备回答：“为什么不用容器当安全沙箱？”当前设计目标是课程工程事务与可恢复性，不把宿主权限隔离作虚假承诺。课程部署中的 Runner 隔离是另一层边界。

### A5　验证与证据分层

| 层级 | 能证明什么 | 不能证明什么 |
|---|---|---|
| unit/fixture | parser、schema、控制逻辑 | 真实内核运行 |
| public/contract | 功能与接口约束 | 未覆盖输入下的完全正确性 |
| fixed-seed fuzz/trace | 有界随机与关键路径 | 无界并发、形式化正确性 |
| QEMU | 目标 ISA/机器模型中的动态行为 | 真实板卡固件、时钟、外设和电气行为 |
| connected replay | Portal、Runner、提交和证据闭环 | 实体板通过 |
| physical board | 指定板卡、镜像和工作负载的真实运行 | 其它板卡或全部硬件状态 |
| human review | 板卡身份、材料与设计解释获得确认 | 自动证明或普遍正确性 |

同时解释 `vos verify` 与 `vos agent verify` 的区别：前者执行确定性门禁，后者只读复核证据覆盖和矛盾，不能改写 Runner 状态。

### A6　VisionFive 2 四核证据

完整呈现：

- 板卡、SoC、四 U74 hart；
- SPI U-Boot → TFTP uImage/DTB → xv6；
- SD `xv6fs` 的单块、双块读写；
- hart 1/2/3 启动；
- quick 与 slow usertests；
- 最终 `ALL TESTS PASSED`；
- 两段串口采集为何属于同一 live session；
- 为避免交互依赖临时让 init 启动 usertests，提交源中已恢复原入口。

准备回答：“这是否改变了测试语义？”测试程序和内核行为未改，变化只是首个用户进程入口，目的是让实板运行不依赖人工键盘输入；原始日志和提交保留这一事实。

### A7　Glenda H5、Orange Pi Prime 与 Chimera

上半页说明 QEMU-only 内容：BL31/U-Boot、EL1 MMU、UART 时钟复位与 pinmux、GICv2/timer、PSCI 四核与 IPI、MMC 读写、EL0 syscall 以及 Lab 1–8 累计负载。

下半页展示独立的实体板闭环：真实 BROM/SPL 启动链、四核身份、UART、timer/IRQ/IPI、MMC 数据往返、EL0 完整负载、材料上传和教师审批。冷启动次数与本次采集范围按硬件报告原样说明，不从单次串口记录外推可靠性统计。

右侧放 Chimera 的 Rust 微内核 + Go RPC 服务图。明确“零代码改动切换”依赖稳定 RPC/IPC ABI、运行时适配层和相同服务语义，目前属于待实现目标。

### A8　来源、AI、许可、复现与完整文献

至少包含：

- SYSSPEC/SPECFS 的方法来源；
- MIT xv6-riscv 与 Glenda 的代码和设计来源；
- seL4 作为微内核与最小可信核心参考；
- Git worktree、QEMU、RISC-V 特权规范、Bun；
- Codex（GPT-5.5）和 DeepSeek V4 Pro 的使用场景、人工修改与验证；
- 源码许可证清单入口；
- PPT、PDF、视频的 CC BY-SA 4.0；
- 最终代码 commit、xv6 VF2 evidence commit、Glenda H5/Orange Pi Prime evidence identity；
- 复现命令仅使用仓库相对路径和跨平台命令，不写本机目录。

---

## 5. 论断—证据—页面映射

| 论断 | 证据真源 | 使用页 | 表述边界 |
|---|---|---:|---|
| 学生主链为手写 Spec → Agent 实现 → 确定性验证 | `README.md`、学生 workflow v2 | P4–P7 | 不恢复 v1 自动架构生成 |
| 五类 Spec 与 L1–L3 已实现 | spec v2 文档、schema、最终技术报告 | P5、A3 | GoalSpec 可选；等级警告不替代技术评审 |
| Agent 使用隔离 worktree 与真实 diff | Agent/runtime 文档和源代码映射 | P6、A4 | worktree 不是宿主安全沙箱 |
| verify 不调用模型 | README、workflow、最终技术报告 | P6–P7、A5 | `agent verify` 是额外只读复核 |
| 知识问答提供可定位 citation | KB/Agent 文档和结构化结果 schema | P8 | 引用提供核对入口，不自动证明回答正确 |
| Debug Agent 绑定失败运行并保持只读 | Agent/runtime 文档和 debug evidence | P9、A4 | 诊断不能改写 verify 状态或冒充修复 |
| QEMU 板级移植生成 candidate 并要求人工批准 | QemuSpec、Lab 9 与 QEMU Agent 文档 | P10、A7 | 只形成 `qemu_only` 证据，不替代实板 |
| commit、report 与 submit 支持版本复查 | workflow、toolchain 和 report 文档 | P11、A5 | Git 不包含 `.vos/` 原始日志；日志来自匹配归档 |
| Portal 是课程控制面 | Portal architecture 与根指南 | A4 | Portal 不直接执行 QEMU 或 workspace Agent |
| 指导书重视历史与设计 | Book ch01/ch05/ch07、各 Lab | P12、A2 | 不宣称没有操作步骤；Lab 仍提供可执行指导 |
| VF2 四核完整 usertests 通过 | VF2 evidence commit `6b1c624` | P7、P13、A6 | 实板结论只绑定该板卡、构建和工作负载 |
| Glenda H5 七项 QEMU trace 与 Orange Pi Prime 四核负载通过 | H5 simulation report、硬件报告、完整串口日志 | P10、P13、A7 | QEMU 与实体板证据分层；实板结论仍需教师复核 |
| Glenda Lab 1–10 Portal 闭环 | connected acceptance record、权威 run、评审记录 | P11、P13、A7 | 当前真实凭据被上游拒绝的调用保留为 approved skip；不把该次调用称为模型复核通过 |
| 15 名学生、两节暑期试讲 | 决赛技术报告试讲章节、团队记录 | P14 | 定性观察，不报告统计增益 |
| 2026–2027 学年正式教学 | 团队已确认课程安排 | P16 | 不扩写为多校规模化结果 |
| Chimera 是下一验证案例 | 团队设计目标 | P16、A7 | 不宣称代码、性能或形式化证明已经完成 |

---

## 6. 引用与素材索引

### 6.1 短引用编号

- **[R1]** 2026 年操作系统设计赛全国赛技术方案与决赛答辩通知：功能赛道 8 分钟视频；PPT/PDF；独立借鉴与增量说明；AI 使用披露；材料 CC BY-SA 4.0；压缩包不超过 250 MB。
- **[R2]** `output/pdf/VeriSpecOSLab-final-technical-report.pdf`：当前决赛技术报告。
- **[R3]** `README.md`：当前学生主链、公开命令、证据与硬件边界。
- **[R4]** `docs/design/workflow/05-student-workflow.md`：学生 Spec、Agent 实现、验证和提交主链。
- **[R5]** `docs/design/spec/00-overview.md`：五类 Spec 与确定性消费。
- **[R6]** `docs/manual/book/`、`docs/manual/labs/`：Book/Lab 双线、历史与设计内容、CTF 和硬件实验。
- **[R7]** Portal 中 xv6-spec 与 glenda-spec 的 Lab 10 权威 run、submission、评审材料和时间线：两套课程的 connected 闭环。
- **[R8]** Glenda 的 `verification/orangepi-prime-qemu-simulation-report.md`、硬件报告与完整串口日志：七项 QEMU trace、四核实体板工作负载及两类证据边界。
- **[R9]** xv6 VF2 分支提交 `6b1c624` 及 `hardware/visionfive2/evidence/`：四 hart 完整 usertests 实板证据。
- **[R10]** `docs/fast26-liu-qingyuan.pdf` 与最终报告参考文献：SYSSPEC。
- **[R11]** `docs/comp/final-report/chapters/12-innovation-limitations.tex`：相关工作、创新和发展方向。
- **[R12]** `docs/comp/final-report/chapters/09-evolution-acceptance.tex`：暑期试讲与平台改进。
- **[R13]** `docs/portal/architecture.md`、`docs/portal/teaching-closed-loop.md`：Portal/Runner 边界与教学闭环。
- **[R14]** `docs/comp/final-report/chapters/05-agent.tex`、`06-runtime-evidence.tex`：Agent 事务、调试、验证和证据链。
- **[R15]** `docs/comp/report.md` 第十五章及最终 AI 使用记录：Codex、DeepSeek V4 Pro 的生成范围与人工责任。

### 6.2 完整参考文献建议

1. Qingyuan Liu, Mo Zou, Hengbin Zhang, Dong Du, Yubin Xia, and Haibo Chen. *Sharpen the Spec, Cut the Code: A Case for Generative File System with SYSSPEC*. 24th USENIX Conference on File and Storage Technologies（FAST '26）, 2026, pp. 291–311. 论文中的 SYSSPEC 是工具框架，SPECFS 是由该框架生成和演化的并发文件系统，并非另一篇独立论文。
2. Russ Cox, Frans Kaashoek, and Robert Morris. *xv6: a simple, Unix-like teaching operating system*, RISC-V edition, MIT PDOS, 2024 revision.
3. MIT PDOS. *xv6-riscv source repository*.
4. seL4 Foundation. *seL4 Reference Manual* and published verification literature.
5. The Git Project. *git-worktree: Manage multiple working trees*.
6. QEMU Project. *System Emulation User's Guide*.
7. RISC-V International. *The RISC-V Instruction Set Manual, Volume II: Privileged Architecture*.
8. 全国大学生计算机系统能力大赛操作系统设计赛组委会：《2026 年全国大学生计算机系统能力大赛操作系统设计赛全国赛技术方案》及决赛答辩通知。
9. Creative Commons. *Attribution-ShareAlike 4.0 International*.

SYSSPEC/SPECFS 统一引用上述 FAST '26 论文和 USENIX 官方页面。PPT 不把 SPECFS 写成独立论文，也不沿用旧初赛材料中错误的作者、会议或年份。

---

## 7. 录制、PPT 与提交验收

### 7.1 讲稿与时间

- 按正常学术报告语速完整录制一次，目标 7:45–7:55。
- 每页实际时长允许比表中上下浮动 3 秒，总时长不得超过 8:00。
- 若超时，依次删去重复解释、功能枚举和转场语，不删除 VF2/Glenda 证据边界、试讲限制或 AI 披露。
- 不逐字念表格。讲稿负责解释页面的中心判断，表格留给评委阅读和问答。

### 7.2 事实检查

- PPT 导出前重新核对主仓库 commit、VF2 evidence commit 和 Glenda H5 candidate identity。
- VF2 页面必须能从原始串口日志回到四 hart 和完整 usertests；Glenda 页面必须同时给出 QEMU-only 状态和独立的 Orange Pi Prime 四核实板标记。
- 试讲人数固定为 15 名 2025 级计算机拔尖班学生、两节课；没有新的调查材料前，不添加百分比和显著性结论。
- AI 使用页对照 Git 提交、开发文档与审计材料复核模型名称、用途和人工修改。若最终记录与旧报告不同，按真实记录更新 PPT、PDF 和视频旁白。
- 所有命令、角色和界面以当前 `vos --help` 与 v2 文档为准。

### 7.3 视觉与媒体检查

- 用 1080p 全屏播放一次，确认脚注、终端和黄色状态在普通投影上可读。
- 所有视频设置为单击或自动播放后从头开始，禁用外链媒体。
- PDF 中用演示关键帧替代视频黑框，并保留相同标题和证据状态。
- 检查二维码指向最终允许公开的仓库，断网扫描也能显示正确文本。
- 压缩视频时优先降低码率，不降低到无法读取终端文本。

### 7.4 官方合规检查

- [ ] 视频不超过 8 分钟；
- [ ] 同时提交可编辑 PPT 和 PDF；
- [ ] 主讲 P15 是独立的借鉴、创新/增量与 AI 使用页；
- [ ] 第三方代码和文档来源、用途、许可证已说明；
- [ ] PPT、PDF、视频标注 CC BY-SA 4.0；
- [ ] AI 工具、模型、场景、生成范围、人工修改和验证方法已披露；
- [ ] 文件夹按“队伍编号+赛队名称”命名；
- [ ] 视频、PPT、PDF 和必要字体/媒体打包后不超过 250 MB；
- [ ] 所有素材已去除凭据、本机绝对路径和私人服务地址；
- [ ] 现场笔记本保存离线 PPT、PDF、视频、VF2 摘要、H5 报告和 8 页附录。

### 7.5 最终朗读检查

全文保持中性、克制的学术报告口吻。强对比只用于说明评价对象变化，不把成熟课程贬低为“只会填空”，也不把尚未闭合的候选写成完成。开头提出“AI 时代 OS 实验训练什么”，结尾仍回答这个问题，不临时扩展成泛化的教育技术宣言。
