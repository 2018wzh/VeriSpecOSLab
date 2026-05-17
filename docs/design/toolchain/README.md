# VeriSpecOSLab VOS Runtime 文档集

本目录定义 VeriSpecOSLab 的 `VOS Runtime` / `VOS CLI` / `VOS Orchestrator` 设计，用于约束：

- `vos` 如何读取本地 `spec/`、消费云端约束投影并编排验证流程
- Rust + Tokio 实现中各模块、数据模型、adapter 和执行模型如何划分
- Agent、CI 和课程平台如何通过统一入口获得可审计、可复现的运行结果

边界说明：

- `spec/toolchain/` 描述学生项目的构建 / 链接 / 镜像 / 运行契约。
- `docs/design/toolchain/` 描述 `vos` 如何消费这些契约并编排验证、证据采集与 Agent 协作流程。

建议阅读顺序：

1. [00-overview.md](./00-overview.md)
2. [01-boundaries-and-roles.md](./01-boundaries-and-roles.md)
3. [02-architecture.md](./02-architecture.md)
4. [03-runtime-modules.md](./03-runtime-modules.md)
5. [04-data-model.md](./04-data-model.md)
6. [05-runtime-and-concurrency.md](./05-runtime-and-concurrency.md)
7. [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)
8. [07-agent-gateway.md](./07-agent-gateway.md)
9. [08-evidence-reporting-and-ci.md](./08-evidence-reporting-and-ci.md)
10. [09-roadmap-and-acceptance.md](./09-roadmap-and-acceptance.md)

这些文档共同替代旧的单文件式 `toolchain.md`。旧文件现在仅保留为迁移入口与兼容索引。
