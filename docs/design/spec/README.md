# VeriSpecOSLab Spec 文档标准

本目录定义 VeriSpecOSLab 的完整 Spec 标准，用于约束：

- 学生在本地仓库中维护哪些 Spec
- Agent 在生成 patch 前后必须读取和更新哪些 Spec
- `vos` 在 lint、build、verify、report 时依赖哪些结构化字段
- 平台如何把本地 Spec、云端课程约束和验证证据拼成可审计闭环

Spec 标准的消费与执行编排见 [`../toolchain/README.md`](../toolchain/README.md)。

建议阅读顺序：

1. [00-overview.md](./00-overview.md)
2. [01-layer-model.md](./01-layer-model.md)
3. [02-architecture-spec.md](./02-architecture-spec.md)
4. [03-module-and-operation-spec.md](./03-module-and-operation-spec.md)
5. [04-composition-evolution-goals.md](./04-composition-evolution-goals.md)
6. [05-toolchain-spec.md](./05-toolchain-spec.md)
7. [06-verification-and-evidence.md](./06-verification-and-evidence.md)
8. [07-authoring-rules.md](./07-authoring-rules.md)

这些文档共同替代“单一总文档式 Spec 说明”，将标准拆成若干可独立演化、可被工具消费的部分。
