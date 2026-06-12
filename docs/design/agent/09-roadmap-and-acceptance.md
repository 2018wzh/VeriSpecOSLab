# 09 Roadmap And Acceptance

## 1. MVP 顺序

建议按以下顺序实现：

1. `ContextBundle` / `PlanDraft` 扩展字段
2. `PromptEnvelope` 与 `SpecBoundTask`
3. TypeScript `vos agent` wrapper 与 fixed prompt versioning
4. `SpecAssistant` 与 `SpecCompiler` 的 prompt builder
5. `SpecValidator` 与 `ValidatorFeedback`
6. retry-with-feedback loop
7. `KnowledgeBaseAgent` 的 `ReferencePayload` 与引用审计
8. OS specialization 规则和模板示例

## 2. MVP 验收

必须满足：

- `agent.md` 已迁移为目录入口
- 新 `docs/design/agent/` 文档集可独立阅读
- 关键 runtime 类型均有明确字段定义
- `vos agent` wrapper 能说明哪些步骤调用 `vos-agent`，哪些步骤必须确定性执行
- 至少定义以下角色的完整 contract：
  - `SpecAssistant`
  - `SpecCompiler`
  - `SpecValidator`
  - `DebugAgent`
  - `KnowledgeBaseAgent`

## 3. Prompt 设计验收

必须满足：

- 明确消息拼装顺序
- 明确 `logic` 与 `concurrency_refine` 两阶段差异
- 明确 validator 只输出结构化反馈
- 明确 knowledge base 的 visibility 与 usage limit
- 明确 fixed prompt 必须版本化，并将 prompt id 写入 evidence 与审计
- 明确 prompt 不负责 policy、patch gate、stage gate 或验证裁决

## 4. SpecFS 参考映射验收

必须明确写出以下继承点：

- rely / guarantee 组合
- two-phase prompting
- validator retry loop
- spec patch 驱动演化

必须明确写出以下差异点：

- SPECFS 是 FUSE 文件系统生成案例
- VeriSpecOSLab 面向更广的 OS 核心模块
- 执行入口是 `vos`，不是任意脚本
- 教学审计与引用限制是额外约束

## 5. 实现就绪判据

如果实现者只看本目录文档，应该能够直接开始：

- 实现 `vos-agent` 的 prompt assembler
- 实现 `vos agent` 的 TypeScript wrapper 与 `PromptEnvelope` 构造
- 实现 validator loop
- 实现 knowledge base 引用策略
- 实现 OS 场景下的 operation-bound routing

若还需要临时补关键决策，说明本目录仍不完整。

## 6. TypeScript Wrapper 验收

必须满足：

- `agent context` 与 `agent log` 可确定性实现，不依赖 LLM。
- `agent plan`、`agent generate`、`agent debug` 通过 fixed prompt 调用 `vos-agent`。
- `agent generate` 只产出结构化 patch proposal，不默认落盘。
- `agent apply-patch` 由 runtime 校验 spec binding、allowed paths、impact analysis 与最小验证 DAG。
- 课程模式下不向模型暴露自由 `Bash`、`Write`、`Edit`。

相关设计见 [10-typescript-cli-wrapper.md](./10-typescript-cli-wrapper.md)。
