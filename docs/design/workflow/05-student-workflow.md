# 05 Student Workflow

回答的问题：

- 学生在整个实验周期内的主线工作是什么
- 每个阶段学生要提交什么、运行什么、看到什么
- 学生如何通过 SpecPatch 演化设计并完成最终综合提交

上游依赖文档：

- [02-stage-model-and-lifecycle.md](./02-stage-model-and-lifecycle.md)
- [01-artifacts-and-visibility.md](./01-artifacts-and-visibility.md)
- [../spec/README.md](../spec/README.md)
- [../toolchain/README.md](../toolchain/README.md)

下游消费者：

- 学生课程说明
- 本地工作流与 CLI 设计
- Agent 教学辅助流程

## 1. 角色职责

学生负责：

- 维护本地 `spec/` 中的设计真相
- 按阶段提交 `ArchitectureSlice`、`ModuleSpec`、实现、测试与报告
- 根据公开反馈修正设计与代码
- 记录 AI 协作日志、错误案例和最终综合报告

学生不能做：

- 绕过阶段门禁直接跳到后续机制实现
- 删除测试或关闭检查器以通过验证
- 伪造验证结果或隐瞒 AI 参与

## 2. 入组与初始化

```text
加入课程实验
  -> 获得仓库、模板、spec/ 骨架、CI 配置、Agent Workspace
  -> 阅读课程要求摘要和 AI Policy 摘要
  -> 只看到当前阶段公开投影
```

学生在本地可见的主要输入：

- 本项目代码与 `spec/`
- 当前阶段公开门禁
- 公开验证结果摘要
- 允许公开的 Agent 建议

## 3. Stage 0: ArchitectureSeed

学生首先维护：

```text
spec/architecture/seed.yaml
```

此阶段目标是：

- 说明系统方向
- 限定目标范围
- 声明 non-goals
- 避免只贴标签式设计

学生可请求：

```bash
vos agent arch review spec/architecture/seed.yaml
```

## 4. Stage 1 到 Stage N 的统一模式

每个后续阶段都遵循同一闭环：

```text
1. 更新当前 ArchitectureSlice
2. 更新相关 ModuleSpec / GoalSpec / CompositionSpec
3. 运行 spec lint / arch lint
4. 实现或修改代码
5. 运行公开验证
6. 接收 public summary
7. 修正 spec 或代码并再次提交
```

例如 `memory-management` 阶段：

```bash
vos spec lint spec/modules/kernel/memory/ops/kalloc.yaml
vos arch lint spec/architecture/slices/02-memory.yaml
vos verify public --stage memory-management
```

## 5. 通过 SpecPatch 演化设计

当学生引入新机制或改变关键设计时，必须先更新：

```text
spec/evolution/patch-*.yaml
  -> ArchitectureSlice / ADR / CompositionSpec
  -> 再进入 build / test / verify
```

这保证：

- 新机制是被解释过的
- 平台能重新派生验证计划
- 教师与助教能追踪设计变化来源

## 6. 最终综合提交

课程末期，学生需要提交：

- `spec/architecture/seed.yaml`
- `spec/architecture/slices/**`
- `spec/architecture/decisions/**`
- `spec/architecture/composition.yaml`
- `spec/architecture/final-synthesis.yaml`
- `spec/reports/student-verification-report.md`
- `spec/reports/ai-collaboration-log.md`
- `spec/reports/final-report.md`

最终目标不是重写一份脱离历史的总设计，而是把整个设计演化过程综合成可追溯结论。
