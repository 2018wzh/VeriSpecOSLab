# 12 MVP To Full Platform Roadmap

回答的问题：

- 完整平台如何分阶段落地
- 第一阶段最小可行实现是什么
- 每阶段依赖、验收标准和可延后项是什么

上游依赖文档：

- [00-overview.md](./00-overview.md)
- [02-system-architecture.md](./02-system-architecture.md)
- [06-pipeline-and-verification-orchestration.md](./06-pipeline-and-verification-orchestration.md)

下游消费者：

- 项目管理
- 研发排期
- DevOps 资源规划

## 1. 总体原则

虽然目标是完整平台，但实施必须分阶段。每一阶段都必须形成可运行闭环，而不是只堆积基础设施。

## 2. MVP

### 2.1 目标能力

- 单课程单实验发布
- 学生项目与仓库自动创建
- `spec/` + `vos` 驱动的基础公开验证
- QEMU boot 类基础 VeriSpecOSLab 验证
- `vos` 登录、policy snapshot 与本地 Agent 审计
- 教师查看项目进度、日志和公开结果

### 2.2 依赖模块

- Backend API
- Spec Service 基础版
- Repo Provisioner
- Pipeline Orchestrator 基础版
- Artifact Store
- authenticated `vos-cli` / `vos serve` 集成
- Agent governance / audit 基础版

### 2.3 验收标准

1. 教师可以发布一个 VeriSpecOSLab 实验。
2. 学生加入后可自动获得仓库和工作区。
3. 学生 push 后平台可运行 `vos` 基础验证并展示公开摘要。
4. Portal-bound repo 的本地 CLI 和 runner 执行都通过 Portal token / policy snapshot gate。
5. 平台可保存日志、串口输出、policy snapshot ref 和 Agent 审计记录。

### 2.4 可延后项

- 多租户
- 高级 Analytics
- 硬件板卡评测
- 复杂 hidden verification 策略

## 3. Phase 2

### 3.1 目标能力

- 阶段门禁与设计审核完整流
- 标准 Judge 流程
- 评分证据映射
- 教师/助教审核与 override
- 更完整的 AI 风险分析

### 3.2 依赖模块

- 完整 StageGate 管理
- Judge Controller
- Scorebook / Evidence Map
- 审核工作流

### 3.3 验收标准

1. 课程可运行完整阶段化实验。
2. 最终冻结、评测、发布成绩和申诉留痕可用。
3. 评分可追溯到具体证据对象。

### 3.4 可延后项

- 多实验类型插件市场
- 自动风险预测

## 4. Phase 3

### 4.1 目标能力

- 多课程多实验类型
- 更强隔离与集群扩展
- 自定义实验适配器
- 高级 Analytics 与教学干预
- 硬件与性能目标的标准支持

### 4.2 依赖模块

- 实验类型适配器接口
- 扩展 Runner Pool
- 集群级观测与容量管理

### 4.3 验收标准

1. 平台能承载 VeriSpecOSLab 之外的至少一类实验原型。
2. 关键服务支持水平扩展。
3. 评分、审计和教学分析仍使用统一领域模型。

## 5. 开发顺序建议

```text
1. 领域模型与 Spec Service
2. 项目供应与 Git 集成
3. Pipeline 与 Artifact
4. `vos` 身份、HTTP façade 与 Agent 审计基础治理
5. Judge 与评分
6. Analytics 与扩展适配器
```

## 6. 失败模式与约束

- 不能为了追求完整平台而推迟第一个可运行闭环。
- 不能在没有审计的情况下先开放 Agent 自动执行。
- 不能在没有规则快照的情况下上 Judge。
- 不能让 Portal 直接实现 repo runtime 或 workspace Agent 执行。

## 7. VeriSpecOSLab 特化说明

MVP 首先以 VeriSpecOSLab 作为平台锚点，但实现应保留：

- 实验类型枚举
- 适配器入口
- 泛化的 Evidence 和 Score 模型

## 8. 后续扩展点

- 外部 LMS 集成
- 组织级报表
- 学术诚信联动
