# 02 Stage Model And Lifecycle

回答的问题：

- 阶段如何定义、解锁、冻结和补交
- 课程工作流中的状态转换约束是什么
- 一个阶段完成时必须具备哪些输入、检查和证据

上游依赖文档：

- [00-overview.md](./00-overview.md)
- [01-artifacts-and-visibility.md](./01-artifacts-and-visibility.md)
- [../platform/09-roles-workflow-and-stage-gates.md](../platform/09-roles-workflow-and-stage-gates.md)

下游消费者：

- 教师建课与审核流程
- 助教补跑与异常处理流程
- 学生阶段执行流程

## 1. 典型阶段

VeriSpecOSLab 的典型阶段包括：

- `architecture-seed`
- `boot-minimum`
- `memory-management`
- `trap-privilege`
- `execution`
- `syscall-ipc`
- `resource-and-namespace`
- `personalized-goal`
- `final-synthesis`

课程可以裁剪或重命名阶段，但不能改变统一门禁语义。

## 2. StageGate 最小结构

每个 `StageGate` 至少包含：

- `stage`
- `prerequisites`
- `required_artifacts`
- `automatic_checks`
- `manual_review_policy`
- `public_feedback_policy`
- `unlock_condition`
- `timeout_or_resubmission_policy`

## 3. 阶段模板

每个阶段都按以下结构执行：

- 目标：本阶段想证明什么设计与实现能力。
- 输入：学生必须提交的 Slice、ModuleSpec、实现、测试或报告。
- 检查：自动检查、公开验证、私有验证、人工审核。
- 角色动作：教师、助教、学生、平台、Agent 各自执行的动作。
- 证据：日志、报告、测试、审查记录、AI 审计、评分映射。
- 失败分支：失败后由谁归因、是否允许补跑、是否要求回退 Spec。
- 解锁条件：当前阶段通过后，如何生成下一阶段公开投影。

## 4. 关键状态

项目和阶段的常见状态包括：

```text
not_started
  -> active
  -> needs_fix
  -> under_review
  -> passed
  -> stage_locked
  -> frozen
```

约束：

1. 未通过前置阶段不得进入下一阶段。
2. 设计审核通过不等于代码验证通过。
3. 失败后可停留在当前阶段反复修正，但证据链不得被覆盖。
4. `frozen` 之后普通 push 不改变正式评分输入。

## 5. 解锁与补交

下一阶段解锁至少要求：

- 当前阶段必需产物齐全
- 当前阶段 required checks 通过
- 必要人工审核完成
- 当前阶段 public summary 已发布

补交流程至少支持：

- 学生修复后重新提交
- 助教因基础设施异常触发补跑
- 教师因 override 或规则调整要求重审

## 6. 异常分支

阶段中常见异常包括：

- 自动检查失败
- 基础设施失败
- hidden suite 风险升高
- AI 审计异常
- 人工审核冲突

处理原则：

1. 先区分学生实现错误与基础设施错误。
2. 补跑不能覆盖原有失败证据，只能追加新 run。
3. 人工 override 必须记录原因、审批者和影响范围。
4. 出现越权、绕过测试或相似度高风险时，必须升级给教师。
