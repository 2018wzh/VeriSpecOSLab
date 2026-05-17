# 08 Audit And Safety

## 1. 目标

本文件定义 runtime 内部的最小审计与安全约束。

平台侧会话治理见 [`../platform/08-agent-gateway-and-ai-governance.md`](../platform/08-agent-gateway-and-ai-governance.md)。
本文件只负责 runtime 内部必须产出的记录和门禁。

## 2. 必须记录的运行时对象

- `PromptEnvelope`
- `SpecBoundTask`
- `ValidatorFeedback`
- `RetryLoopRecord`
- `ReferencePayload`

这些对象应能回链到：

- `ContextBundle`
- `RunManifest`
- 相关 `spec_hash`
- 相关 patch / evidence

## 3. AICollaborationLog 最小字段

建议至少包含：

```yaml
AICollaborationLog:
  session_id:
  task_kind:
  agent_role:
  related_specs:
  allowed_paths:
  output_kind:
  patch_ref:
  evidence_ref:
  result:
```

## 4. 风险标记

runtime 应标记以下风险：

- 无 spec 绑定的代码生成尝试
- 跨允许路径的 patch 建议
- 未跑最小验证 DAG 即试图交付核心 patch
- 请求引用超出 `usage_limit` 的参考材料
- 明显试图删除测试、关闭检查器或规避 policy

## 5. Patch Gating

核心 patch 进入 apply 之前，至少满足：

1. 绑定了本地 spec
2. 未越权修改路径
3. 有最小验证 DAG 结果
4. 如涉及跨模块语义变化，已存在 `SpecPatch` 或被标记为 required

## 6. 安全默认值

- 默认拒绝无 spec 绑定的大范围重写
- 默认拒绝基于隐藏数据的解释
- 默认拒绝把 `agent-only` 参考材料原样输出给学生
- 默认限制 retry 次数，避免无效循环

## 7. 与平台边界

runtime 负责：

- 生成结构化日志
- 在 prompt 级别执行局部安全约束
- 在角色路由级别执行门禁

platform 负责：

- 用户、项目、组织级身份与可见性
- 最终会话持久化与纪律处理
- 组织级风控和策略快照
