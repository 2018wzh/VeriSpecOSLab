# Agent Runtime 文档集

本目录定义 SpecLab / VeriSpecOSLab 的 Agent Runtime 内部设计。

回答的问题：

- runtime 内部有哪些角色，它们如何协作
- `vos-agent` 如何消费 `ContextBundle`、`PlanDraft`、验证结果和参考材料
- prompt 如何从“描述性文档”收敛为可直接实现的 contract
- 如何吸收 SYSSPEC / SPECFS 的方法而不把项目收窄成文件系统生成器

不重复定义的内容：

- 本地 Spec 结构与字段真相：[`../spec/`](../spec/README.md)
- `vos` 命令、执行 DAG、evidence 与数据模型：[`../toolchain/`](../toolchain/README.md)
- 平台权限、治理和会话审计：[`../platform/`](../platform/README.md)

建议阅读顺序：

1. [00-overview.md](./00-overview.md)
2. [01-runtime-roles.md](./01-runtime-roles.md)
3. [02-context-and-retrieval.md](./02-context-and-retrieval.md)
4. [03-prompt-contract.md](./03-prompt-contract.md)
5. [04-specfs-inspired-generation-loop.md](./04-specfs-inspired-generation-loop.md)
6. [05-verification-and-repair-loop.md](./05-verification-and-repair-loop.md)
7. [06-knowledgebase-and-reference-policy.md](./06-knowledgebase-and-reference-policy.md)
8. [07-os-specialization.md](./07-os-specialization.md)
9. [08-audit-and-safety.md](./08-audit-and-safety.md)
10. [09-roadmap-and-acceptance.md](./09-roadmap-and-acceptance.md)

核心原则：

- Agent 必须以本地 `spec/` 为第一真相。
- Agent 只通过受控 `vos` 工具工作。
- 核心改动默认绑定 `OperationContract`，而不是自由生成。
- 生成、验证、修复、引用都必须进入 evidence 与审计闭环。
