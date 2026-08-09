# Lab 8：个性化目标——从兴趣方向到可验证结果

> **对应教材**：[第 8 章：个性化目标](../book/ch08-personal-goal.md)

> **本 Lab 概览**
>
> - **学完能做什么**：选定一个主方向（性能、兼容性、可靠性、安全性、形式化或实时性），用 GoalSpec 写下基线、目标、护栏和停止条件，完成一次可复现的实验并如实报告结果。
> - **预计耗时**：15–20 小时，建议安排 2 周。选题与基线测量约占四分之一，实现与实验各占约三分之一，报告与证据整理占其余。
> - **前置依赖**：已完成 Lab 7（系统能力基本齐备），阅读第 8 章。
> - **产出物**：GoalSpec、受影响 ModuleSpec/SpecPatch、实现、基线与候选数据、可复现实验命令、正确性证据和结果分析。

## 1. 可选方向

- 性能：调度延迟、系统调用成本、文件系统吞吐或内存分配开销；
- 兼容性：扩展 syscall/ABI、运行更多用户程序或支持标准文件格式；
- 可靠性：崩溃一致性、故障隔离、资源上限或 watchdog；
- 安全性：capability、地址空间强化、最小权限或内核攻击面缩减；
- 形式化：对状态机、分配器或并发算法建立可机检模型；
- 实时性：有界中断延迟、优先级调度或资源预算。

可以组合副方向，但只有主方向承担完整验收。组合目标不能互相抵消，例如只报告吞吐提升而忽略延迟、内存和正确性退化。

本 Lab 不再把高级方向压缩成一句"可选 GoalSpec"。你需要选择一个主方向，明确基线、目标、正确性护栏、测量方法和停止条件，再把实现落到对应模块。

## 2. 选题工作表

选题时先填写这张表，答案直接决定 GoalSpec 内容：

| 项目 | 问题 |
| --- | --- |
| 动机 | 这个方向解决当前系统的哪个具体限制？ |
| 基线 | 当前 HEAD 在固定 workload 上表现如何？ |
| 机制 | 你准备改变哪个模块、算法或边界？ |
| 主指标 | 什么数值决定目标是否达成？ |
| 护栏 | 正确性、尾延迟、内存或复杂度不能退化到什么程度？ |
| 反例 | 什么结果会推翻你的假设？ |
| 停止条件 | 何时停止继续调参或扩大范围？ |

### 方向示例

- 调度延迟：对比 round-robin 与优先级队列，报告 median/p99，并保持无饥饿护栏。
- 分配器：对比 freelist 与 buddy，报告分配成本和碎片，保持唯一所有权不变量。
- 文件系统：改进 cache 或日志批处理，报告吞吐与崩溃恢复时间，保持崩溃矩阵全通过。
- 兼容性：增加一组用户 ABI，按真实程序通过率计量，不以 syscall 数量代替兼容性。
- 形式化：模型必须与代码状态机建立字段映射，并保留模型反例到实现测试的转化记录。

## 3. GoalSpec 与实现边界

GoalSpec 使用严格字段：稳定 `id`、`objective`、`metric`、`oracle` 和 `correctness`。详细的 baseline、target、实验变量和结果表保存在实验报告或测试数据中，不伪装成 schema 字段。

```yaml
id: TODO_STABLE_GOAL_ID
objective: TODO
metric: TODO
oracle: TODO
correctness:
  - TODO
```

GoalSpec 不授予代码所有权。实际修改仍由 ModuleSpec 的 `owns` 控制；跨模块优化先提交 SpecPatch。

## 4. 实验设计

1. 固定机器、构建模式、workload、预热次数、样本数和统计方法。
2. 在改动前记录 baseline，并保存 commit/spec/config hashes。
3. 明确主要指标、护栏指标和失败阈值。
4. 一次只改变一个可解释因素；复杂组合需要消融或对照。
5. 运行公开正确性门禁，再比较指标。
6. 记录负结果，不筛掉不利样本。

结果表至少包含 commit、配置 hash、样本数、聚合值、离散程度和正确性门禁。若环境噪声大，先增加重复或改进测量方法，不要只把阈值调宽。

`vos verify` 保持确定性，运行 public、contract、固定种子 fuzz 和有界 trace targets，但不自动运行本地 hidden tests 或未来 Judge oracle。目标所需的 target 加入 `vos.yaml` 并绑定 GoalSpec/ModuleSpec ID；探索性数据另存于报告输入，不冒充公共门禁。

## 5. 工作流与门禁

```sh
vos agent ask "这个目标的主指标、护栏、oracle 与停止条件是否能在看到结果前确定？"
# 学生手写 GoalSpec，并按需修改 ModuleSpec 或手写 SpecPatch
vos spec lint <goal-id>
vos agent review <goal-id> -i
# 学生修改后再次 lint，并手动提交
vos spec lint <goal-id>
git add spec/goals spec/modules spec/patches
git commit -m "[spec][goal] Define Lab 8 personal goal"
vos agent implement <module>
vos build
vos run qemu
vos verify
vos report
```

- [ ] GoalSpec 的目标、指标、oracle 和正确性护栏可执行。
- [ ] baseline 与候选结果绑定各自 commit 和配置。
- [ ] 所有既有公开测试继续通过。
- [ ] 主要指标达到事先声明的判据，护栏未越界。
- [ ] 结果包含方差、异常值处理和至少一次重复运行。
- [ ] 未达到目标时如实报告，不修改判据追认成功。

## 6. 设计理据

说明为何选择这个方向、它与系统目标的关系、替代方案和负面取舍。每个取舍都要能回答：如果换一个方向，成本收益比如何变化？

## 7. AI 使用边界

Agent 可以帮助设计实验、审查统计方法和解释异常。学生必须在看到结果前确定指标与阈值。不能让 Agent 挑选"最好的一次"运行、删除失败样本或把相关性写成因果结论。

## 8. 提交物

- [ ] GoalSpec；
- [ ] 受影响 ModuleSpec/SpecPatch；
- [ ] 实现；
- [ ] 基线与候选数据；
- [ ] 可复现实验命令；
- [ ] 正确性证据；
- [ ] 结果分析（含负结果）。

## 9. 常见问题与排查

### baseline 测量与正式实验差异很大

环境变量、构建模式或 QEMU 配置在两次运行间发生了变化。固定机器、构建模式、预热次数和样本数，并把 commit/spec/config hashes 与每次结果一起保存。

### 指标看起来达标，但护栏越界

只测了主指标，没跑护栏。每次实验都要同时运行正确性门禁和护栏指标，越界时先回到改动前基线确认原因，再决定是否继续。

### 结果噪声大，阈值无法判断

先检查测量方法而不是调宽阈值。增加重复次数、固定 CPU 亲和性、关闭无关负载，必要时换更稳的指标。

### Agent 选出了"最好的一次"运行

实验判据必须在看到结果前确定。所有运行样本都进结果表，异常值标注原因但不得删除；只有测量方法出错才能重新采集。

## 10. 背景阅读

- [Book 第 8 章：个性化目标](../book/ch08-personal-goal.md)：各方向的设计空间与示例。
- [ModuleSpec](../specs/module-spec.md) 与 [GoalSpec 相关说明](../specs/overview.md)：GoalSpec 字段写法。
- [SpecPatch](../specs/spec-patch.md)：跨模块语义变化的手写契约。
- [验证方法论](../book/ch10-verification.md)：证据组织与可复现实验。
