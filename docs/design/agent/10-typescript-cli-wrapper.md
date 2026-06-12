# 10 TypeScript CLI Wrapper

## 1. 目标

本文件定义全 TypeScript 路线下，`vos cli` 的 `agent` 子命令如何作为
`vos-agent` 的受控 wrapper 工作。

核心原则：

- `vos-agent` 提供 LLM runner、provider router、TUI、OpenAI-compatible façade。
- `vos agent <subcommand>` 负责课程语义、stage gate、policy、evidence 与 audit。
- 固定 prompt 只描述 Agent 角色、任务上下文和输出 schema。
- 安全裁决、patch 应用、验证执行和审计写入必须由确定性 runtime 完成。

## 2. 总体数据流

```text
vos agent <subcommand>
  -> load project / stage / policy
  -> build ContextBundle
  -> build PromptEnvelope
  -> select fixed prompt version
  -> call vos-agent headless runner
  -> validate structured output
  -> run deterministic gate if needed
  -> write .vos/runs/<run-id>/ and AICollaborationLog
  -> return stable JSON
```

`vos-agent` 可以通过两种方式被调用：

- 当前实现：package runner，`vos-cli` 直接 import `vos-agent/headless` 并调用
  `runHeadlessAgentPrompt` / `startAgentHttpServer`。
- 后续拆分：将当前 wrapper 编排下沉到 `vos-agent-core`，但保持同一 package-level
  JSON contract。

当前 package API 与后续 `vos-agent-core` 拆分必须保持同一 JSON contract。

## 3. 子命令分工

### `vos agent context`

确定性实现，不调用 LLM。

职责：

- 构造 `ContextBundle`
- 裁剪 spec、recent evidence、allowed paths、recommended commands
- 应用 visibility 与 role policy

输出：

- `ContextBundle`
- `context_bundle_ref`
- `policy_snapshot_ref`

### `vos agent plan`

调用 `vos-agent`，使用 `GatewayAgent` / `SpecAssistant` fixed prompt。

输入：

- 用户任务描述
- `ContextBundle`
- 当前 stage 与 visibility scope

输出：

- `PlanDraft`
- `spec_patch_required`
- `required_validations`

约束：

- 不改文件
- 不执行 patch
- 不把自由分析当作 evidence

### `vos agent generate`

调用 `vos-agent`，使用 `SpecCompiler` fixed prompt。

输入：

- `PromptEnvelope`
- 绑定的 `OperationContract` 或小型 module slice
- `allowed_paths`
- `required_validations`

输出：

- 结构化 patch proposal
- `bound_clauses`
- `changed_paths`
- `self_reported_risks`

约束：

- 默认不落盘
- 不能生成无 spec 绑定的大范围重写
- 不能删除测试、关闭 checker 或改写 policy

### `vos agent apply-patch`

确定性 gate 为主，LLM 不是裁决者。

校验顺序：

1. policy 检查
2. spec binding 检查
3. 路径白名单检查
4. patch impact analysis
5. 应用 patch
6. 运行最小验证 DAG
7. 写入 evidence 与 `AICollaborationLog`

如果任何 gate 失败，命令必须拒绝 patch，并返回结构化 `PolicyError`、
`SpecError`、`PlanningError` 或验证失败摘要。

### `vos agent debug`

调用 `vos-agent`，使用 `DebugAgent` fixed prompt。

输入：

- `DiagnosticReport`
- recent evidence refs
- related specs
- recent patch refs

输出：

- failure class
- suspected clauses
- suggested next command
- suggested next agent task

约束：

- 只解释公开或 agent-only 可见信息
- 不泄露 hidden tests、staff-only rubric 或其他学生代码

### `vos agent log`

确定性实现，不调用 LLM。

职责：

- 记录或查询 `AICollaborationLog`
- 将 prompt version、context ref、tool calls、patch ref、evidence ref、risk flags 写入审计链

## 4. Fixed Prompt Contract

每个 fixed prompt 必须版本化：

```yaml
fixed_prompt:
  id: spec-compiler.v1
  agent_role: SpecCompiler
  task_kind: codegen
  output_schema: spec_compiler_output.v1
```

`PromptEnvelope` 至少包含：

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
  fixed_prompt_id:
```

fixed prompt 不允许在末尾追加新的自由指令。若需要改变行为，应创建新版本，并把 `fixed_prompt_id` 写入 run manifest 与 audit。

## 5. 输出校验

`vos-agent-core` 必须校验模型输出：

- 输出必须是声明 schema 的 JSON 或可严格解析的结构化对象。
- `changed_paths` 必须被 `allowed_paths` 覆盖。
- `bound_clauses` 必须引用本地 spec 或 `SpecPatch`。
- `output_kind=unified_diff` 时，diff 只能作为 proposal 进入 `apply-patch`。
- schema 失败必须返回 `AgentOutputError`，不能继续执行 patch。

## 6. 安全边界

课程模式下，`vos-agent` 不应直接暴露自由 `Bash`、`Write`、`Edit` 给模型。

允许的工具面应收束为：

- 受限 `Read` / `Glob` / `Grep`，只读公开工作区内容
- `Vos`，只允许 policy 白名单中的 `vos` 子命令
- 线程与 todo 类辅助工具

当前 `vos-cli` 的 `agent plan`、`agent generate` 与 `agent debug` 调用
`vos-agent/headless` 时必须启用 `courseMode: true`，并把项目
`.vos/policy.yaml` 中的 `allowed_commands` 传入 `allowedVosCommands`。
传给模型 `Vos` 工具的白名单必须过滤掉 `agent ...` 命令，避免模型
递归调用 `vos agent` wrapper；这些命令仍可由用户在 CLI 外层直接执行。

禁止进入 `ContextBundle` 的内容：

- hidden tests 全文
- staff-only rubric
- 其他学生项目代码
- 未经裁剪的 agent-only 参考材料

## 7. Evidence 与 Audit

每次 wrapper 调用必须写入：

- `RunManifest`
- `events.jsonl`
- `PromptEnvelope`
- fixed prompt id / version
- `ContextBundle` ref
- structured output ref
- tool call summary
- risk flags

如产生 patch proposal，还必须记录：

- patch ref
- related specs
- user accepted / rejected 状态
- 最小验证 DAG 结果或未运行原因

## 8. MVP 顺序

1. 实现确定性 `agent context` 与 `agent log`。
2. 用 `vos-agent/headless` package runner 接通 `agent plan`，校验 `PlanDraft`。
3. 接通 `agent generate`，只输出 patch proposal，不落盘。
4. 实现 `agent apply-patch` 的 policy / path / spec gate。
5. 将 `apply-patch` 接入最小验证 DAG 与 evidence。
6. 再将 wrapper 编排抽到 `vos-agent-core`，减少 `vos-cli` 内部耦合。
