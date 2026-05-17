# 09 Roadmap And Acceptance

## 1. MVP 顺序

建议按以下顺序实现：

1. `ContextBundle` / `PlanDraft` 扩展字段
2. `PromptEnvelope` 与 `SpecBoundTask`
3. `SpecAssistant` 与 `SpecCompiler` 的 prompt builder
4. `SpecValidator` 与 `ValidatorFeedback`
5. retry-with-feedback loop
6. `KnowledgeBaseAgent` 的 `ReferencePayload` 与引用审计
7. OS specialization 规则和模板示例

## 2. MVP 验收

必须满足：

- `agent.md` 已迁移为目录入口
- 新 `docs/design/agent/` 文档集可独立阅读
- 关键 runtime 类型均有明确字段定义
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
- 实现 validator loop
- 实现 knowledge base 引用策略
- 实现 OS 场景下的 operation-bound routing

若还需要临时补关键决策，说明本目录仍不完整。
