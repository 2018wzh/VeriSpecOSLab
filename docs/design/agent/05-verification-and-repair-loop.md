# 05 Verification And Repair Loop

## 1. 目标

本文件定义 `SpecValidator` 如何把生成结果拉回规格闭环。

原则：

- validator 是审查器，不是第二个 codegen。
- retry 只能消费结构化反馈。
- 最小验证 DAG 由 `toolchain/` 负责执行，由 runtime 负责消费结果与路由下一步。

## 2. 最小验证 DAG

对于核心 patch，至少执行：

- `vos spec lint`
- 受影响的 `vos arch lint`
- `vos build`
- 相关公开测试
- 必需 invariant check

如任务类型涉及运行时行为，可附加：

- `vos verify patch`
- `vos debug explain-log`
- `vos trace syscall`

## 3. `ValidatorFeedback`

```yaml
ValidatorFeedback:
  status: pass | fail
  violated_clauses: [string]
  repair_hints: [string]
  retryable: boolean
```

约束：

- `violated_clauses` 必须引用具体 spec 条款
- `repair_hints` 只给最小修正方向
- `retryable=false` 时，必须回退到 `SpecAssistant` 或人工修 spec

## 4. 失败分类

推荐分类：

- `spec_missing_field`
- `spec_inconsistency`
- `logic_mismatch`
- `concurrency_mismatch`
- `toolchain_contract_mismatch`
- `test_oracle_failure`

这些分类应写入 `DiagnosticReport.kind` 或 runtime 扩展字段。

## 5. Retry 规则

仅在以下条件满足时允许 retry：

- 失败条款可定位到单个 operation 或小型切片
- 当前 patch 不需要新的 `SpecPatch`
- 失败不是权限、路径越权或工具链契约缺失导致

retry 输入只允许包含：

- 原始 `PromptEnvelope`
- 上轮 `ValidatorFeedback`
- 相关 evidence 摘要

不允许把整段自由分析文本直接拼回 codegen prompt。

## 6. `RetryLoopRecord`

```yaml
RetryLoopRecord:
  attempt: integer
  input_refs: [string]
  validator_feedback_ref: string
  exit_reason: passed | non_retryable | max_attempts | spec_patch_required
```

## 7. 与 DebugAgent 的分工

- `SpecValidator` 回答“是否满足绑定 spec”
- `DebugAgent` 回答“下一步最值得做什么”

当 validator 多轮失败时：

1. 生成 `DiagnosticReport`
2. 路由到 `DebugAgent`
3. 由 `DebugAgent` 判断是继续实现修复，还是先修 spec / toolchain

## 8. 示例

### 场景 A

- `sys_write` 生成后测试发现 bad user pointer 返回码错误
- `ValidatorFeedback` 标记 `failure_semantics:-EFAULT`
- `retryable=true`
- `SpecCompiler` 用最小反馈重试

### 场景 B

- `vfs_lookup` 修改影响 capability 与 namespace 组合规则
- `ValidatorFeedback` 指出跨模块 invariant 失效
- `retryable=false`
- 路由到 `SpecAssistant` 先产出 `SpecPatch`
