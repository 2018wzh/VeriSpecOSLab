# SpecLab Platform 文档集

本目录描述 `SpecLab Platform` 的实现设计，涵盖以下问题：

- 课程平台如何管理课程、实验、项目、阶段门禁、评分与审计
- 平台如何消费 `vos` 产出的结构化摘要、evidence 与 report，驱动仓库创建、验证、评测与反馈
- 本地 Agent、CI、Judge、Portal 与运维系统如何围绕统一领域模型协同工作

边界说明：

- [`../spec/`](../spec/README.md) 定义学生仓库中的本地规格真相。
- [`../toolchain/`](../toolchain/README.md) 定义 `vos` 的运行时消费与执行编排真相。
- [`../arch.md`](../arch.md) 定义本地 Agent Runtime / 课程运行环境 / OpenAI-compatible 接入的实现设计。
- [`../workflow/README.md`](../workflow/README.md) 定义课程递进式工作流与教学过程。

本目录只描述“平台实现设计”，不是课程讲义，也不是学生仓库规范。
建议阅读顺序：

1. [00-overview.md](./00-overview.md)
2. [01-boundaries-and-goals.md](./01-boundaries-and-goals.md)
3. [02-system-architecture.md](./02-system-architecture.md)
4. [03-domain-model.md](./03-domain-model.md)
5. [04-experiment-and-spec-management.md](./04-experiment-and-spec-management.md)
6. [05-project-lifecycle-and-repository-provisioning.md](./05-project-lifecycle-and-repository-provisioning.md)
7. [06-pipeline-and-verification-orchestration.md](./06-pipeline-and-verification-orchestration.md)
8. [07-judge-and-sandbox.md](./07-judge-and-sandbox.md)
9. [08-agent-gateway-and-ai-governance.md](./08-agent-gateway-and-ai-governance.md)
10. [09-roles-workflow-and-stage-gates.md](./09-roles-workflow-and-stage-gates.md)
11. [10-scoring-evidence-and-teaching-analytics.md](./10-scoring-evidence-and-teaching-analytics.md)
12. [11-deployment-security-and-operations.md](./11-deployment-security-and-operations.md)
13. [12-mvp-to-full-platform-roadmap.md](./12-mvp-to-full-platform-roadmap.md)

旧的单文件式 [`../platform.md`](../platform.md) 已降级为迁移入口与兼容索引。
