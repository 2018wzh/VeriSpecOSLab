# 10 Scoring Evidence And Teaching Analytics

回答的问题：

- 评分输入和证据如何绑定
- 哪些反馈公开给学生，哪些只给教师
- 平台如何做教学分析和风险聚合

上游依赖文档：

- [03-domain-model.md](./03-domain-model.md)
- [06-pipeline-and-verification-orchestration.md](./06-pipeline-and-verification-orchestration.md)
- [07-judge-and-sandbox.md](./07-judge-and-sandbox.md)

下游消费者：

- 成绩看板
- 教师分析面板
- Analytics 服务

## 1. 评分输入

评分输入来自三类来源：

```text
自动验证结果
人工审核结果
AI 审计与过程证据
```

`EvaluationRubric` 必须显式说明每一项评分来自哪些证据对象。

## 2. 证据映射

每个评分项都应绑定：

- `evidence_type`
- `source_entity`
- `computation_rule`
- `publication_scope`
- `manual_override_rule`

示例：

```text
architecture_design
  -> DesignSubmission review + stage artifacts

implementation_correctness
  -> Judge functional suites + pipeline regression suites

verification_coverage
  -> derived test matrix + executed suite coverage

ai_audit
  -> AgentSession + AICollaborationLog summary
```

## 3. 公开反馈与 staff-only 反馈

学生可见：

- 总分和子项摘要
- 可公开失败分类
- 公开建议与已达成里程碑

教师/助教可见：

- hidden suite 细节
- 风险标签
- 评分依据原始映射
- 人工 override 记录

## 4. 教学分析输出

Analytics 至少输出：

- 阶段通过率
- 常见失败类型排行
- 设计审核中高频问题
- 目标选择分布
- AI 使用强度分布
- 高风险项目列表

高风险信号示例：

- 大量 AI 生成但解释不足
- 长期卡在同一阶段
- 反复 infra failure 之外的同类验证失败
- 设计与实现长期不一致

## 5. 关键接口

```http
GET /api/projects/{projectId}/scores
GET /api/projects/{projectId}/evidence-map
GET /api/courses/{courseId}/analytics/progress
GET /api/courses/{courseId}/analytics/failure-patterns
GET /api/courses/{courseId}/analytics/ai-risk
```

## 6. 关键流程

### 6.1 成绩生成

```text
collect pipeline/judge/manual evidence
  -> map to rubric
  -> compute provisional score
  -> teacher review if needed
  -> publish score
```

### 6.2 教学分析聚合

```text
consume events and evidence
  -> aggregate by course / experiment / stage
  -> compute risk indicators
  -> refresh dashboards
```

## 7. 失败模式与约束

- 分数发布时必须带证据映射快照。
- Analytics 不能反向修改正式成绩。
- 隐藏评测细节不能进入学生可见分析页面。

## 8. VeriSpecOSLab 特化说明

VeriSpecOSLab 的教师分析至少需要覆盖：

- boot / memory / syscall / userland / benchmark 失败热区
- architecture slice 演化问题
- QEMU 启动失败与设计不一致问题
- AI 对核心 OS 模块的参与强度

## 9. 后续扩展点

- 班级对比分析
- 课程多轮对比
- 风险预测和早期干预建议
