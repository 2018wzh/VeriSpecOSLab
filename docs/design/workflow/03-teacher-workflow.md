# 03 Teacher Workflow

回答的问题：

- 教师从建课到成绩发布的完整主线是什么
- 教师在每个阶段做什么、看到什么、依赖什么、产出什么
- 哪些动作可以委托给助教，哪些必须由教师裁决

上游依赖文档：

- [02-stage-model-and-lifecycle.md](./02-stage-model-and-lifecycle.md)
- [../platform/04-experiment-and-spec-management.md](../platform/04-experiment-and-spec-management.md)
- [../platform/10-scoring-evidence-and-teaching-analytics.md](../platform/10-scoring-evidence-and-teaching-analytics.md)

下游消费者：

- 教师课程实施手册
- 审核流与成绩发布设计
- 教学分析面板

## 1. 角色职责

教师负责：

- 创建课程、实验和规则版本
- 配置模板仓库、阶段门禁、公开/隐藏验证策略
- 审核关键设计阶段与最终综合结果
- 审批 override、冻结、成绩发布和高风险处理
- 基于 analytics 做课程复盘

教师不负责：

- 日常批量补跑
- 常规公开失败归因
- 每次学生 push 的一线排障

## 2. 教师可见与不可见

教师可见：

- 本项目完整公开证据
- staff-only rubric 与 hidden suite 结果
- AI 审计摘要与高风险标签
- 助教审核记录、补跑记录、申诉材料

教师不可直接依赖的内容：

- 未经证据映射的主观印象
- Agent 未审计的临时建议

## 3. 课程准备主线

```text
创建课程
  -> 维护 ExperimentSpec
  -> 版本化 StageGate / Rubric / AIPolicy
  -> 绑定模板仓库与验证策略
  -> 配置知识库与可见性投影
  -> 发布实验
```

此阶段教师依赖的上游输入：

- 课程目标
- 实验模板仓库
- 公共验证计划
- hidden 验证计划
- 评分规则

此阶段教师产出的下游对象：

- 可发布实验版本
- 初始阶段公开投影
- 助教审核与补跑边界

## 4. 阶段审核主线

教师在关键阶段至少要回答：

- 当前设计是否在课程允许范围内
- 当前阶段是否真的具备进入下一阶段的成熟度
- 当前失败是设计问题、实现问题还是规则问题
- 是否需要人工 override 或退回重做

典型审核重点：

| 阶段 | 教师重点 | 依赖证据 | 产出 |
|---|---|---|---|
| `architecture-seed` | 目标范围、non-goals、设计方向 | `seed.yaml`、DesignAgent 报告 | 通过或缩小范围 |
| `boot-minimum` | boot chain、入口约定、启动可观察性 | boot slice、串口日志 | 解锁 memory |
| `memory-management` | 内存模型与不变量自洽 | allocator tests、ModuleSpec | 解锁 trap |
| `syscall-ipc` | ABI、错误语义、权限边界 | trace、IPC tests | 解锁资源阶段 |
| `personalized-goal` | 新机制是否通过 commit-backed SpecPatch 合法引入 | patch history、goal contract | 通过或要求补充设计 |
| `final-synthesis` | 历史是否可追溯、最终评分是否可解释 | final report、evidence map | 正式评分与发布 |

## 5. override、冻结与评分

教师可触发的关键系统动作：

- 发布新规则版本
- 审批人工 override
- 强制冻结最终提交
- 发布正式成绩
- 开启或关闭申诉窗口

这些动作必须绑定：

- 操作人
- 原因
- 影响对象
- 关联证据快照

## 6. 教学复盘

课程结束后，教师基于 analytics 做复盘，至少关注：

- 阶段通过率与卡点分布
- Boot / Memory / Syscall / Userland 的失败热区
- AI 使用强度与高风险项目
- 哪些阶段门禁过松或过紧
- 哪些教学材料需要提前补充
