# 00 Overview

## 1. 目标

本目录将 Agent 设计从“大而全的单文档”重构为可实现的 runtime 文档集。

目标：

- 保留 SpecLab 的通用抽象，不把 runtime 绑死在单一 OS 实验。
- 吸收 SYSSPEC / SPECFS 的方法优势，尤其是 spec-bound generation、two-phase prompting、validator retry loop、spec patch 驱动演化。
- 把 prompt 设计写到接近实现级，足以指导后续 `agent/prompts/` 或 prompt builder 的编码。

## 2. 为什么从大 Prompt 转向 Spec-Bound Generation

单一长 prompt 的主要问题：

- 同时承载功能、模块依赖、并发约束和验证要求，语义负担过重。
- 容易丢失跨模块接口约束，导致“局部看似合理、整体不可组合”。
- 不便于绑定审计证据，无法清晰回答“这段 patch 依据哪条 Spec”。

本项目改用受规格约束的生成方式：

```text
Task -> ContextBundle -> Spec binding -> PromptEnvelope
     -> SpecCompiler / SpecAssistant
     -> SpecValidator
     -> Retry or Patch Proposal
```

核心要求：

- 每个核心生成任务默认绑定至少一个 `OperationContract`。
- 并发语义与顺序逻辑分阶段注入。
- validator 反馈必须结构化，不允许自由长文回灌污染下一轮生成。

## 3. 与 SYSSPEC / SPECFS 的关系

本项目借鉴的不是“生成 FUSE 文件系统”这个结论，而是四个方法论：

1. 用结构化规格替代模糊自然语言。
2. 用 rely / guarantee 管理模块组合。
3. 用两阶段生成降低并发逻辑对 codegen 的干扰。
4. 用 validator 驱动 retry-with-feedback，而不是 generate-and-pray。

本项目不直接照搬的部分：

- SPECFS 面向 FUSE 文件系统；VeriSpecOSLab 面向更广的 OS 核心模块。
- SPECFS 的模块与测试组织可作为参考，但最终执行入口仍是 `vos`。
- 教学审计、可见性分级、知识库引用限制是本项目额外需求。

## 4. 文档边界

- `spec/`：定义可 lint、可 normalize、可 derive-test 的真相字段。
- `toolchain/`：定义命令模型、执行 DAG、evidence、日志和 adapter。
- `platform/`：定义会话、策略、越权防护和组织级审计。
- `agent/`：定义 runtime 内部角色、消息 contract、路由和局部策略。

## 5. 最小闭环

Agent runtime 的最小闭环如下：

```text
student task
  -> vos agent context
  -> spec binding and routing
  -> prompt assembly
  -> candidate generation
  -> spec-first validation
  -> retry or patch proposal
  -> audit log + evidence
```
