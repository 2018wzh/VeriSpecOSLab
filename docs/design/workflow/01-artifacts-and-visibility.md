# 01 Artifacts And Visibility

回答的问题：

- 课程工作流依赖哪些学生本地、云端课程、hidden 和 derived 产物
- 教师、助教、学生、平台、Agent 分别能看到什么
- 证据如何在角色之间流动

上游依赖文档：

- [00-overview.md](./00-overview.md)
- [../spec/README.md](../spec/README.md)
- [../platform/03-domain-model.md](../platform/03-domain-model.md)
- [../platform/10-scoring-evidence-and-teaching-analytics.md](../platform/10-scoring-evidence-and-teaching-analytics.md)

下游消费者：

- Portal 可见性设计
- Agent 上下文投影设计
- 课程实施与审计流程

## 1. 学生本地产物

学生仓库中的核心产物包括：

```text
spec/
  architecture/
    seed.yaml
    timeline.yaml
    slices/
    decisions/
    composition.yaml
    final-synthesis.yaml
  modules/
  goals/
  evolution/
  reports/
source/
tests/
.vos/
```

这些产物是学生项目的本地真相，用于：

- 驱动阶段设计审核
- 驱动 `vos` 构建、验证和报告
- 形成最终提交与过程证据

## 2. 云端课程产物

课程团队在云端维护：

```text
course spec
  -> experiment
  -> design-space
  -> base-requirements
  -> stage-gates
  -> verification-policy
  -> evaluation-rubric
  -> ai-policy
  -> judge-policy
  -> interface-contracts
```

这些规则通过可见性投影暴露给不同角色，而不是直接写入学生仓库。

## 3. Hidden 与 Derived 产物

平台在课程运行中维护：

```text
hidden
  -> hidden-test-plan
  -> fuzz-plan
  -> mutation-plan
  -> oracle-details
  -> anti-gaming-rules

derived
  -> normalized-design
  -> architecture-evolution-summary
  -> stage-review-report
  -> risk-model
  -> derived-verification-plan
  -> derived-test-matrix
  -> grading-evidence-map
```

`hidden` 产物仅供 staff 与受控服务使用。`derived` 产物根据角色拆分为公开摘要和 staff-only 细节。

## 4. 可见性矩阵

| 产物或信息 | 教师 | 助教 | 学生 | 平台服务 | Agent |
|---|---|---|---|---|---|
| 本项目本地 `spec/` | 允许 | 允许 | 允许 | 允许 | 受控允许 |
| 本项目源码与公开测试 | 允许 | 允许 | 允许 | 允许 | 受控允许 |
| 当前阶段公开门禁 | 允许 | 允许 | 允许 | 允许 | 允许 |
| `student-public` 反馈摘要 | 允许 | 允许 | 允许 | 允许 | 允许 |
| `agent-public` 风险标签 | 受控允许 | 受控允许 | 禁止 | 允许 | 允许 |
| hidden tests 全文 | 受控允许 | 受控允许 | 禁止 | 允许 | 禁止 |
| staff-only rubric 细节 | 允许 | 受控允许 | 禁止 | 允许 | 禁止 |
| 其他学生项目代码 | 课程内受控 | 课程内受控 | 禁止 | 禁止默认访问 | 禁止 |

## 5. 证据流转

证据在课程中的典型流向为：

```text
学生提交 spec / code / report
  -> 平台执行自动检查与验证
  -> 生成 public summary 与 staff evidence
  -> 助教先看公开失败与 staff 诊断
  -> 教师在关键阶段查看完整证据并裁决
  -> 学生只接收允许公开的反馈
```

## 6. 角色关注点

- 教师关注课程边界、阶段成熟度、评分证据映射、AI 风险和最终裁决。
- 助教关注失败归因、补跑条件、异常聚类、审核队列和升级路径。
- 学生关注当前阶段公开要求、本地设计一致性、公开验证反馈和下一阶段入口。
- Agent 只消费角色允许的上下文投影，并把每次辅助行为写入审计记录。
