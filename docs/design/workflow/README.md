# VeriSpecOSLab / SpecLab Workflow 文档集

本目录定义 VeriSpecOSLab / SpecLab 的课程递进式工作流，用于约束：

- 课程如何从建课、发实验、阶段审核、验证、评分一路运行到最终复盘
- 教师、助教、学生、平台、Agent 如何围绕同一实验周期协作
- 哪些产物在学生本地维护，哪些规则在云端维护，哪些证据进入评分与审计

边界说明：

- [`../spec/`](../spec/README.md) 定义学生仓库中的本地设计真相。
- [`../toolchain/`](../toolchain/README.md) 定义 `vos` 如何消费输入并编排验证、证据采集与报告。
- [`../platform/`](../platform/README.md) 定义课程平台的实现、接口、状态机和服务职责。
- [`../arch.md`](../arch.md) 定义 Agent Runtime、DevBox 和 OpenAI-compatible 接入实现。

本目录只回答“课程过程如何运转、角色如何交接、证据如何在教学中流动”，不重复定义平台内部 API、`vos` 内部执行模型或学生本地 Spec 语义。

建议阅读顺序：

1. [00-overview.md](./00-overview.md)
2. [01-artifacts-and-visibility.md](./01-artifacts-and-visibility.md)
3. [02-stage-model-and-lifecycle.md](./02-stage-model-and-lifecycle.md)
4. [03-teacher-workflow.md](./03-teacher-workflow.md)
5. [04-ta-workflow.md](./04-ta-workflow.md)
6. [05-student-workflow.md](./05-student-workflow.md)
7. [06-agent-and-ai-boundaries.md](./06-agent-and-ai-boundaries.md)
8. [07-end-to-end-teaching-simulation.md](./07-end-to-end-teaching-simulation.md)
9. [08-faq-failure-modes-and-acceptance.md](./08-faq-failure-modes-and-acceptance.md)

旧的单文件式 [../workflow.md](../workflow.md) 已降级为迁移入口与兼容索引。
