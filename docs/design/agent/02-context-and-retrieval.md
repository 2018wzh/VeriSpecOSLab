# 02 Context And Retrieval

## 1. 目标

Agent 不直接消费整个仓库快照，而是消费受控 `ContextBundle`。

这保证：

- 上下文规模稳定
- 可见性边界明确
- prompt 组装可重现
- evidence 与 spec 绑定可追溯

## 2. `ContextBundle` 扩展

在 [`../toolchain/04-data-model.md`](../toolchain/04-data-model.md) 已有字段基础上，补充 runtime 可选字段：

```yaml
ContextBundle:
  requested_scope: string
  resolved_specs: [SpecRef]
  recent_evidence: [EvidenceRef]
  allowed_paths: [string]
  recommended_commands: [string]
  visibility_scope: public | agent-only
  spec_snippets: [SpecSnippet]
  operation_bindings: [OperationBinding]
  prompt_hints: [string]
```

新增字段说明：

- `spec_snippets`：供 prompt 直接注入的结构化节选，不回退到整份 spec 原文。
- `operation_bindings`：当前任务绑定的操作级 spec 及其依赖图。
- `prompt_hints`：来自路由器的轻量提示，例如“本轮禁止跨文件 helper 抽取”。

## 3. `PlanDraft` 扩展

在现有字段上补充：

```yaml
PlanDraft:
  task: string
  related_specs: [SpecRef]
  suspected_files: [string]
  required_validations: [string]
  notes: [string]
  generation_mode: spec_assist | logic_codegen | concurrency_refine | debug
  spec_patch_required: boolean
```

## 4. 新增内部类型

### `PromptEnvelope`

```yaml
PromptEnvelope:
  agent_role: GatewayAgent | SpecAssistant | SpecCompiler | SpecValidator | DebugAgent | KnowledgeBaseAgent
  task_kind: design_review | spec_refine | codegen | validate | debug | reference_lookup
  requested_scope: string
  spec_bindings: [SpecRef]
  context_bundle_ref: string
  evidence_refs: [EvidenceRef]
  allowed_paths: [string]
  required_validations: [string]
  policy_flags: [string]
```

### `SpecBoundTask`

```yaml
SpecBoundTask:
  task_kind: string
  module: string
  operation: string
  phase: logic | concurrency_refine | validate | debug
  bound_specs: [SpecRef]
  allowed_outputs: patch | function_draft | review_feedback | reference_payload
```

## 5. 上下文来源

`ContextBundle` 推荐来自以下数据源：

- `NormalizedSpecBundle`
- `DiagnosticReport`
- 最近一次 `RunManifest`
- 最近一次 `ValidatorFeedback`
- `PatchImpactReport`
- knowledge base 索引结果

禁止直接注入的来源：

- hidden tests 全文
- staff-only 评分规则
- 未经裁剪的他人项目代码

## 6. 检索与裁剪规则

检索器至少执行以下裁剪：

1. 先定 module / operation，再检索。
2. 优先返回结构化 spec 片段，不优先返回 prose。
3. 参考代码片段必须绑定 `visibility` 与 `usage_limit`。
4. debug 场景优先返回 `DiagnosticReport` 和 related specs，而不是大段日志原文。
