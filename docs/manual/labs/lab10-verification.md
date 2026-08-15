# Lab 10：验证方法论——从测试结果到可追溯证据

> **对应教材**：[第 10 章：验证](../book/ch10-verification.md)

> **本 Lab 概览**
>
> - **学完能做什么**：建立 Spec ID 到测试证据的完整追溯链，会设计不变量检查、故障注入和失败分析，能产出一份可重放的确定性验证报告并提交归档。
> - **预计耗时**：8–12 小时，建议安排 1 周。覆盖清单与故障注入约占一半，证据整理与报告归档占另一半。
> - **前置依赖**：已完成 Lab 1–9（系统与实验全部完成），阅读第 10 章。
> - **产出物**：Spec ID–target 覆盖表、不变量与故障注入矩阵、可定位的构建与测试证据、一份失败分析、确定性报告与可复现提交归档。

## 1. 建立覆盖清单

从所有 DesignSpec、ModuleSpec、InterfaceSpec 和 GoalSpec 的稳定 ID 出发，列出对应测试目标。目标可以记录在 `vos.yaml` 或项目自己的测试清单中；关键是每个目标都能反向指向它验证的 Spec ID，每个必须验证的 Spec ID 至少有一条有效证据。

覆盖不是简单计数。同一条启动 smoke test 不能同时证明内存唯一所有权、syscall 指针安全和文件系统崩溃一致性。

建议维护以下审计列：

| Spec ID | 性质/错误 | target | 证据类型 | 运行身份 | 最近结果 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| `kernel/memory` | unique ownership | allocator_contract | contract | yes | pass | none |

一条 target 可以验证多个紧密相关 ID，但必须解释共同输入与 oracle；一个 ID 也可以由多条证据共同覆盖。

**自检点**：对每个 Spec ID，都能指认至少一条有效证据；对每条 target，都能说出它验证了哪个 ID 的哪个性质。

## 2. 不变量与故障注入

每个核心模块至少选择一条关键不变量，优先使用前面 Lab 已实现的检查器：

- memory：唯一所有权、保留区、计数一致；
- interrupt：trap frame 对称、IRQ 生命周期；
- process：状态转换、单 CPU 运行；
- filesystem：块/inode 分配、事务一致性；
- resource：引用计数、退出回收；
- composition：用户指针验证后才能访问内核资源。

对每条检查器至少注入一次它应发现的故障。记录注入点、预期失败、实际错误、修复和回归，证明检查器不是永远返回成功的装饰。

检查器触发时机分三类：操作内快速断言、测试阶段完整扫描、跨模块验收检查。三者成本不同，不能用低频完整扫描代替关键状态转换上的 fail-fast 检查。

失败分析统一记录：

```text
现象 → 首次证据 → 被排除的假设 → 根因
→ 修复的契约/代码 → 定向回归 → 全部公开门禁
```

保留原始失败日志及其 hash；分析可以补充，不能覆盖原记录。

**自检点**：每个核心模块至少有一条检查器，且每条检查器都有一次有效故障注入证据。

## 3. 确定性验证工作流

如果本 Lab 新增专门的验证模块，使用下面的最小骨架；若只补现有模块的测试性质，就修改对应 ModuleSpec，不要为了套流程虚构模块。

```yaml
id: TODO_VERIFICATION_MODULE_ID
module: TODO_VERIFICATION_MODULE_ID
level: TODO_LEVEL
purpose: TODO
owns: [TODO_TEST_IMPLEMENTATION_PATH, TODO_TEST_PATH]
interface: [TODO_OPERATION]
properties: [TODO_PROPERTY_WITH_ORACLE]
errors: [TODO]
```

```text
让 Coding Agent 读取 Spec、测试和已有失败记录，指出没有独立 oracle 的性质
→ 学生确认覆盖表、不变量和故障注入矩阵
→ Agent 或学生实现检查器、测试和故障注入
→ 运行项目已有的 build/test/QEMU/hardware 命令
→ 重新执行所有受影响目标，整理失败分析和可复现报告
```

`vos verify`、`vos report` 和 `vos submit` 可以作为结构化证据助手，但不再是本 Lab 的唯一流程或门禁。无论使用哪种工具，都要把证据绑定到构建/测试身份、Spec 或配置版本、target、状态、产物和有界日志；不要用一段模型总结替代可重放的命令结果。

> **参考项目**：参考项目的 VOS replay 展示了一种可追溯实现方式，但不是唯一要求。`.vos/` 只保存本地证据，不进入 Git。只要 Lab 9 的实体板 evidence 仍为 `pending_human_review`，Lab 10 也只能发布 `course/lab10-candidate`；candidate 标签不得通过代码、QEMU 或模拟串口结果升级为 complete。

## 4. 证据质量

一份可提交 evidence 至少包含：运行 ID、代码或构建身份、Spec/config 版本、target、结构化 argv、退出状态、开始/结束时间、产物标识和受限日志。若工具能提供 commit 或 content hash 就一并记录；脏树 build/QEMU/hardware 证据必须明确标为不可提交。

导出时遮蔽凭据，把绝对路径替换为稳定别名。原始 `.vos/audit` 不进 Git；submit 包含经过出口扫描的明文日志。硬件证据保持 `pending_human_review`。

证据包按运行而不是按截图组织。截图只能作为辅助展示，不能替代结构化退出码、完整串口日志和产物 hash。超时、panic 和主动中止必须是不同终态。

## 5. 质量检查清单

- [ ] 项目声明的 build、测试、QEMU/硬件 target 均通过，或对失败给出完整分析。
- [ ] 每次关键运行都有可复现的代码、Spec/config、命令和产物身份。
- [ ] 必须验证的稳定 Spec ID 没有覆盖缺口。
- [ ] 每个核心模块至少有一条可运行不变量检查。
- [ ] 至少一条组合不变量跨越三个模块或边界。
- [ ] 每个检查器至少有一次有效故障注入证据。
- [ ] 至少记录一个完整失败案例：现象、证据、根因、修复、回归。
- [ ] 报告或归档可在同一输入身份上重放，并得到一致的目标清单和结果摘要。
- [ ] 出口扫描没有凭据、本机绝对路径或未遮蔽 flag。

## 6. AI 使用边界

Lab 9 起，Coding Agent 可以直接实现检查器、测试、构建文件和 Spec；学生必须审查 diff、运行结果和失败分析。不能让 Agent 改写失败日志、补造硬件验收或用 Fixture 代替真实运行。报告只需简要披露使用的 Agent、主要任务、学生如何审查修改并验证结果，不要求完整提示词审计。

## 7. 提交物

- [ ] Spec ID–target 覆盖表；
- [ ] 不变量与故障注入矩阵；
- [ ] 可复现的构建、测试、QEMU/硬件验证 evidence；
- [ ] 一份失败分析；
- [ ] 确定性报告与可复现提交归档；
- [ ] 硬件人工审查待办（如适用）。

## 8. 常见问题与排查

### target 通过但没有 `verifies`

执行成功不代表追溯链完整。每个目标都必须在项目测试清单或 `vos.yaml` 中绑定至少一个稳定 Spec ID，并说明它实际验证的性质。

### 日志含本机路径或 token

原始审计可本地保留，但导出必须失败并指出字段。用稳定别名替换绝对路径，遮蔽凭据后再进入 submit 包。

### 修改测试后沿用旧 evidence

配置或 Spec hash 已变，旧证据不再有效。任何测试、Spec 或配置改动后都必须重新验证，不能沿用历史证据。

## 9. 参考卡

- [Book 第 10 章：验证](../book/ch10-verification.md)：不变量、故障注入、证据分层和失败分析。
- 先定义可观察状态与独立 oracle，再选择快速断言、完整扫描或跨模块验收；故障注入必须能证明检查器会失败。
- 使用项目已有的测试、QEMU、串口、GDB 或硬件工具复现结果；标准、寄存器和工具版本应查权威文档并记录实际环境。
- 检查 HAL 边界：验证性质不应只在 QEMU/virtio 的偶然实现上成立，报告应说明哪些平台假设仍未抽象。
