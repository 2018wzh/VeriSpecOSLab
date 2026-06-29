# VeriSpecOSLab 用户手册

本手册是 VOS 工具链与 Spec Schema 的技术参考文档，供学生在实验中查阅命令用法和 Spec 字段含义。

## 目录

### 命令参考

- [01 概述与项目结构](./01-overview.md) — `spec/` 与 `.vos/` 目录布局、环境依赖、命令运行方式
- [02 CLI 命令参考（上）：项目、Spec 与架构](./02-commands-spec-arch.md) — `doctor`、`stage show`、`spec lint`、`spec check-consistency`、`spec patch`、`arch lint`、`arch compose`、`arch derive-tests`
- [03 CLI 命令参考（中）：构建、运行与测试](./03-commands-build-run-test.md) — `toolchain lint`、`build generate`、`build`、`run qemu`、`test`
- [04 CLI 命令参考（下）：验证、Agent、报告与知识库](./04-commands-verify-agent-report.md) — `verify`、`agent`、`report generate`、`submit pack`、`kb`

### Spec Schema 参考

- [05 Spec Schema 参考（上）：架构、模块、操作](./05-spec-schema-arch-module-op.md) — ArchitectureSeed、ArchitectureSlice、ADR、ModuleSpec、ConcurrencySpec、OperationContract
- [06 Spec Schema 参考（下）：工具链、验证、演化、目标](./06-spec-schema-toolchain-verify-evolution.md) — ToolchainSpec（profile/build/link/image/run/debug）、CompositionSpec、GoalValidationContract、SpecPatch、Verification/Evidence、Report Contract

### 附录

- [A 命令速查表](./appendix-a-cheatsheet.md)
- [B 术语表](./appendix-b-glossary.md)
- [C Spec YAML 字段快速索引](./appendix-c-spec-fields.md)
- [D xv6-spec 项目参考](./appendix-d-xv6-reference.md)

## 快速入口

- 想了解项目结构 → [01 概述与项目结构](./01-overview.md)
- 想查某条命令怎么用 → [附录 A 命令速查表](./appendix-a-cheatsheet.md)，再跳到对应章节
- 想写 Spec 但不知道字段含义 → [05](./05-spec-schema-arch-module-op.md) / [06](./06-spec-schema-toolchain-verify-evolution.md) Spec Schema 参考
- 想看 xv6 示例的 spec 怎么组织的 → [附录 D xv6-spec 项目参考](./appendix-d-xv6-reference.md)

## 延伸阅读

- [VeriSpecOSLab 设计文档](../../design/) — 平台架构与设计决策
- [xv6-spec 示例项目](../../examples/xv6-spec/) — 完整参考实现
- [根 README](../../README.md) — 开发环境与构建命令
