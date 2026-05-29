# 03 Prompt Contract

## 1. 目标

本文件定义 runtime 内部 prompt 的固定 contract，而不是仅给出“提示工程建议”。

实现目标：

- prompt builder 可直接按字段拼装消息
- 每个 agent 的输入输出可序列化
- retry loop 只传播结构化反馈

## 2. 通用消息拼装顺序

所有 agent 消息按以下顺序组装：

1. 注入 `policy_flags` 与 `task_kind`
2. 注入 `ContextBundle` 摘要
3. 注入绑定 spec 的结构化摘录
4. 如为 codegen，注入 `RELY / GUARANTEE / SPECIFICATION / refine`
5. 注入输出 schema
6. 注入禁止项

不允许在第 6 步之后再追加新的自由指令。

## 3. 通用 `PromptEnvelope`

建议消息骨架：

```yaml
prompt_envelope:
  agent_role:
  task_kind:
  requested_scope:
  spec_bindings:
  context_bundle_ref:
  evidence_refs:
  allowed_paths:
  required_validations:
  policy_flags:
```

## 4. `SpecCompiler` contract

### 输入

```yaml
spec_compiler_input:
  phase: logic | concurrency_refine
  input_spec_summary:
  rely_block:
  guarantee_block:
  operation_contract:
  llm_codegen_constraints:
  expected_output: unified_diff | function_draft
  forbidden_output:
```

`forbidden_output` 至少包含：

- 无 spec 绑定的大块重写
- 额外 helper 漂移到未授权文件
- 删除测试、关闭检查器或绕过权限

### 输出

```yaml
spec_compiler_output:
  status: ok | blocked
  bound_clauses: [string]
  changed_paths: [string]
  output_kind: unified_diff | function_draft
  patch_or_code: string
  self_reported_risks: [string]
```

## 5. `SpecValidator` contract

### 输入

```yaml
spec_validator_input:
  spec_summary:
  candidate_output:
  lint_results:
  build_results:
  test_results:
  trace_results:
  invariant_results:
```

### 输出

```yaml
ValidatorFeedback:
  status: pass | fail
  violated_clauses: [string]
  repair_hints: [string]
  retryable: boolean
```

规则：

- 只能报告违反的 spec 条款和最小修复方向。
- 不直接返回新的实现代码。

## 6. `KnowledgeBaseAgent` contract

### 输入

```yaml
knowledgebase_input:
  stage:
  module:
  operation:
  student_question:
  related_specs:
```

### 输出

```yaml
ReferencePayload:
  source_type: design_doc | spec_example | code_snippet | anti_pattern | debug_case
  visibility: public | agent-only
  excerpt: string
  usage_limit: explanation_only | snippet_only
  how_design_differs: [string]
```

必须附带：

- “为何相关”
- “与当前设计的差异”
- “不可直接提交”的提醒

## 7. `DebugAgent` contract

### 输入

```yaml
debug_input:
  diagnostic_report:
  related_specs:
  recent_patch:
```

### 输出

```yaml
debug_output:
  failure_class: spec_gap | impl_gap | toolchain_issue | flaky_assumption
  suspected_clauses: [string]
  suggested_next_command: string
  suggested_next_agent_task: string
```

## 8. `SpecAssistant` contract

### 输入

- 设计意图
- 当前 spec 摘要
- 缺失字段清单
- 相关 `CompositionSpec` / `SpecPatch`

### 输出

- 建议新增或修改的字段
- 缺口说明
- `spec_patch_required: true | false`

## 9. 示例

### 单操作 codegen

```text
task_kind=codegen
module=kernel/syscall
operation=sys_write
phase=logic
spec_bindings=[kernel/syscall.sys_write]
expected_output=function_draft
```

### 验证失败后的 retry

```text
task_kind=validate
violated_clauses=[
  "postconditions:no unchecked user pointer is dereferenced",
  "failure_semantics:-EFAULT on invalid_user_buffer"
]
retryable=true
```
