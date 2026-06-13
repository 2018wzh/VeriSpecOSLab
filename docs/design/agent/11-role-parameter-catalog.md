# 11 Role Parameter Catalog

## 1. 目标

本文件把前述 Agent 设计收敛为 `vos-agent` 可直接消费的角色参数目录。

它回答：

- 课程身份层角色如何映射到 runtime 执行层角色
- 每个 runtime role 使用哪个 fixed prompt、mode、tool profile、skill profile、MCP profile 和输出 schema
- 课程模式下哪些工具必须收窄，哪些能力只能通过 `vos` 的确定性 gate 执行

参考 Claude Code prompt 时只继承结构性机制：固定系统指令、任务 envelope、工具 registry、subagent/Task 分工、skills 延迟加载、MCP 工具命名与审计要求。不复制 Claude 专有 prompt 文本。

## 2. 两层角色体系

课程身份层角色面向用户和平台权限：

- `StudentAgent`：服务学生项目，只能读取 student-public 与 agent-public 投影。
- `TaAgent`：服务助教审核、补跑、失败归类和风险升级。
- `TeacherAgent`：服务教师建课、阶段审核、评分证据解释和课程复盘。
- `ReviewAgent`：服务 AI 审计、风险会话复查和诚信流程。
- `ReportAgent`：服务最终报告、证据地图和课程 analytics 摘要。

Runtime 执行层角色面向 `vos-agent` prompt 与 schema：

- `GatewayAgent`
- `SpecAssistant`
- `SpecCompiler`
- `SpecValidator`
- `DebugAgent`
- `KnowledgeBaseAgent`

工作流文档中的历史名称不新增 runtime 实现，统一映射为 preset：

| 工作流名称 | Runtime preset | 用途 |
|---|---|---|
| `DesignAgent` | `SpecAssistant` + `GatewayAgent` | 审查 `ArchitectureSeed`、`ArchitectureSlice`、ADR 和 `SpecPatch` |
| `SpecAgent` | `SpecAssistant` + `SpecValidator` | 检查 `ModuleSpec`、`OperationContract` 和组合不变量 |
| `VerificationAgent` | `SpecValidator` + `DebugAgent` | 消费验证 evidence、归因失败并建议下一步 |
| `ReviewAgent` | `SpecValidator` + `DebugAgent` | 审计 patch、工具调用和异常 AI 会话 |
| `ReportAgent` | `KnowledgeBaseAgent` + `GatewayAgent` | 整理最终报告、证据地图和课程复盘摘要 |

## 3. 通用角色配置

所有角色都由 `AgentRoleConfig` 描述，并被 `vos agent plan/generate/debug` wrapper 选择。

```yaml
AgentRoleConfig:
  role_id: string
  course_persona: StudentAgent | TaAgent | TeacherAgent | ReviewAgent | ReportAgent
  runtime_role: GatewayAgent | SpecAssistant | SpecCompiler | SpecValidator | DebugAgent | KnowledgeBaseAgent
  fixed_prompt_id: string
  mode: smart | deep | rush
  task_kinds: [string]
  tool_profile: string
  skill_profile: string
  mcp_profile: string
  output_schema: string
  visibility_scope: student-public | agent-public | staff-full
  audit_requirements: [string]
```

`fixed_prompt_id` 必须版本化，并写入 `RunManifest`、`PromptEnvelope`、`AICollaborationLog` 和审计事件。

Fixed prompt 必须作为 system/developer 层角色指令或等价的固定指令注入。用户 task 只进入 `PromptEnvelope.task` 或 wrapper prompt body，不能覆盖 role config 中的权限、工具、schema 和禁止项。

## 4. 通用工具、Skill 与 MCP Profile

### Tool profile

课程模式默认只暴露：

- `Read`：只读当前项目允许路径下的公开文件与裁剪上下文。
- `Glob` / `Grep`：只用于定位本项目允许路径内的 spec、源码、日志和 evidence。
- `Vos`：只执行 `.vos/policy.yaml` 与 role profile 共同允许的命令。
- `TodoRead`：读取线程内任务状态。
- `Task`：仅在 role profile 允许时用于独立调查、审查或摘要；不得递归调用 `vos agent` wrapper，不得直接生成 patch。

课程模式默认禁止：

- `Bash`
- `Write`
- `Edit`
- 任意不经 `Vos` policy 的 shell、文件写入或 patch apply

允许的 `Vos` 命令必须按角色与阶段收窄。基础候选集为：

- `help`
- `spec lint`
- `arch lint`
- `build`
- `verify public`
- `run qemu`

`agent ...` 命令不得进入模型可调用的 `Vos` whitelist，避免模型递归调用 wrapper。`agent context`、`agent log`、`agent apply-patch` 仍由外层确定性 CLI 直接执行。

### Skill profile

Skill 是延迟加载的任务说明包，不进入基础 prompt 全文。角色只声明可用 skill 名称：

- `os-spec-authoring`：ArchitectureSeed、Slice、ModuleSpec、OperationContract、SpecPatch 编写规则。
- `operation-codegen`：operation-bound 生成、RELY/GUARANTEE、两阶段 refine 和 allowed path 约束。
- `verification-diagnosis`：build、QEMU、trace、public tests、invariant evidence 归因。
- `reference-policy`：知识库引用、visibility、usage limit 和不可直接提交提醒。
- `report-writing`：final synthesis、verification report、AI collaboration log 与 evidence map 整理。
- `audit-review`：工具调用、风险标签、越权访问和异常 AI 会话审计。

### MCP profile

默认不启用外部 MCP。可选受控 MCP 必须通过 `.agents/plugins/*.json` plugin manifest 暴露，并受 `ToolPolicy` 过滤。

可选 MCP：

- `course-kb`：课程材料、公开 FAQ、参考案例和反例检索。
- `spec-index`：本项目 spec 索引、hash、绑定条款和 editable region 查询。
- `evidence-store`：公开或 staff 允许的 run manifest、log、trace、validator feedback 查询。
- `portal-api`：课程、阶段、审核状态、审计记录和 analytics 的受控查询。

MCP 工具对模型暴露为：

```text
mcp__<server>__<tool>
```

MCP 输出必须截断、审计并按 visibility 过滤。凭据不得进入 prompt、memory、workspace 文件或 tool output。

## 5. Runtime Role 参数

### `GatewayAgent`

```yaml
role_id: gateway.v1
runtime_role: GatewayAgent
fixed_prompt_id: gateway-agent.v1
mode: smart
task_kinds:
  - route
  - plan
  - policy_bind
tool_profile: readonly-routing
skill_profile: none
mcp_profile: none
output_schema: gateway_decision.v1
```

职责：

- 识别 `task_kind`、课程阶段、requested scope 和风险等级。
- 选择下游 runtime role 与 fixed prompt。
- 绑定 `ContextBundle`、allowed paths、required validations 和 visibility。

工具：

- `Read` / `Glob` / `Grep`
- `Vos` 仅允许 `help` 或只读诊断命令
- `TodoRead`

禁止：

- 输出 patch 或代码。
- 降低 policy、stage gate 或 required validations。
- 访问 hidden tests、staff-only rubric 或其他学生代码。

输出：

```yaml
gateway_decision:
  status: routed | blocked
  selected_runtime_role:
  selected_fixed_prompt_id:
  task_kind:
  required_context:
  required_validations:
  risk_flags: [string]
```

### `SpecAssistant`

```yaml
role_id: spec-assistant.v1
runtime_role: SpecAssistant
fixed_prompt_id: spec-assistant.v1
mode: deep
task_kinds:
  - design_review
  - spec_revision
  - spec_patch
tool_profile: readonly-spec
skill_profile: os-spec-authoring
mcp_profile: spec-index, course-kb
output_schema: spec_revision_draft.v1
```

职责：

- 审查 `ArchitectureSeed`、`ArchitectureSlice`、`ModuleSpec`、`OperationContract` 和 `SpecPatch`。
- 发现缺失字段、跨 spec 不一致、组合不变量缺口和需要教师审核的设计风险。
- 生成结构化 spec revision draft，而不是直接实现代码。

工具：

- `Read` / `Glob` / `Grep`
- `Vos`: `spec lint`、`arch lint`
- 可选 `mcp__spec-index__*`、`mcp__course-kb__*`
- 可选 `Task` 用于独立 spec 一致性调查

输出：

```yaml
spec_revision_draft:
  status: ok | blocked
  affected_specs: [string]
  proposed_fields: [object]
  missing_fields: [string]
  inconsistencies: [string]
  spec_patch_required: boolean
  teacher_review_required: boolean
  risk_flags: [string]
```

### `SpecCompiler`

```yaml
role_id: spec-compiler.v1
runtime_role: SpecCompiler
fixed_prompt_id: spec-compiler.v1
mode: deep
task_kinds:
  - codegen
  - skeleton_generation
  - concurrency_refine
tool_profile: readonly-codegen
skill_profile: operation-codegen
mcp_profile: spec-index
output_schema: spec_compiler_output.v1
```

职责：

- 基于绑定 `OperationContract` 或小型 module slice 生成局部候选实现。
- 使用 `logic` 与 `concurrency_refine` 两阶段 prompt。
- 输出 function draft 或小粒度 unified diff proposal。

工具：

- `Read` / `Glob` / `Grep`
- `Vos`: `spec lint`、`arch lint`、`build`、`verify public`
- 可选 `mcp__spec-index__*`

禁止：

- 直接写文件或应用 patch。
- 无 spec 绑定的大块重写。
- 删除测试、关闭 checker、改写 policy 或绕过 stage gate。
- 将 helper 漂移到未授权文件。

输出：

```yaml
spec_compiler_output:
  status: ok | blocked
  bound_clauses: [string]
  changed_paths: [string]
  output_kind: unified_diff | function_draft
  patch_or_code: string
  required_validations: [string]
  self_reported_risks: [string]
```

### `SpecValidator`

```yaml
role_id: spec-validator.v1
runtime_role: SpecValidator
fixed_prompt_id: spec-validator.v1
mode: deep
task_kinds:
  - validate
  - review_patch
  - audit_candidate
tool_profile: readonly-validation
skill_profile: verification-diagnosis, audit-review
mcp_profile: spec-index, evidence-store
output_schema: validator_feedback.v1
```

职责：

- 审查候选输出是否满足绑定 spec。
- 消费 lint、build、test、trace、invariant evidence。
- 产出 `ValidatorFeedback`，供 retry loop 或 `DebugAgent` 使用。

工具：

- `Read` / `Glob` / `Grep`
- `Vos`: `spec lint`、`arch lint`、`build`、`verify public`、`run qemu`
- 可选 `mcp__evidence-store__*`、`mcp__spec-index__*`
- 可选 `Task` 用于独立风险审查

禁止：

- 返回新的实现代码。
- 越权降低验证要求。
- 把 hidden 细节写入学生可见反馈。

输出：

```yaml
ValidatorFeedback:
  status: pass | fail
  violated_clauses: [string]
  repair_hints: [string]
  retryable: boolean
  risk_flags: [string]
```

### `DebugAgent`

```yaml
role_id: debug-agent.v1
runtime_role: DebugAgent
fixed_prompt_id: debug-agent.v1
mode: smart
task_kinds:
  - debug
  - explain_log
  - failure_triage
tool_profile: readonly-debug
skill_profile: verification-diagnosis
mcp_profile: evidence-store, spec-index
output_schema: debug_output.v1
```

职责：

- 解释 build、QEMU、trace、public tests 和 recent evidence。
- 判断失败属于 spec gap、impl gap、toolchain issue 还是 flaky assumption。
- 推荐下一条 `vos` 命令或下一轮 agent task。

工具：

- `Read` / `Glob` / `Grep`
- `Vos`: `build`、`verify public`、`run qemu`
- 可选 `mcp__evidence-store__*`

输出：

```yaml
debug_output:
  failure_class: spec_gap | impl_gap | toolchain_issue | flaky_assumption
  suspected_clauses: [string]
  suggested_next_command: string
  suggested_next_agent_task: string
  risk_flags: [string]
```

### `KnowledgeBaseAgent`

```yaml
role_id: knowledgebase-agent.v1
runtime_role: KnowledgeBaseAgent
fixed_prompt_id: knowledgebase-agent.v1
mode: smart
task_kinds:
  - reference_lookup
  - explain_concept
  - compare_design
tool_profile: readonly-reference
skill_profile: reference-policy
mcp_profile: course-kb, spec-index
output_schema: reference_payload.v1
```

职责：

- 检索教学材料、参考规格、调试案例、反例和受限代码片段。
- 解释参考设计与当前学生设计的差异。
- 按 visibility 和 usage limit 输出可审计参考。

工具：

- `Read` / `Glob` / `Grep`
- 可选 `mcp__course-kb__*`、`mcp__spec-index__*`

禁止：

- 向学生原样输出 `agent-only` 或 staff-only 材料。
- 直接给出可提交答案，除非材料 visibility 和 usage limit 明确允许。

输出：

```yaml
ReferencePayload:
  source_type: design_doc | spec_example | code_snippet | anti_pattern | debug_case
  visibility: public | agent-only
  excerpt: string
  usage_limit: explanation_only | snippet_only
  why_relevant: string
  how_design_differs: [string]
```

## 6. 课程 Persona Preset

| Persona | 默认 runtime roles | visibility | 主要用途 |
|---|---|---|---|
| `StudentAgent` | `GatewayAgent`, `SpecAssistant`, `SpecCompiler`, `SpecValidator`, `DebugAgent`, `KnowledgeBaseAgent` | `student-public` + `agent-public` | 学生阶段设计、局部实现、公开失败解释和报告整理 |
| `TaAgent` | `GatewayAgent`, `SpecValidator`, `DebugAgent`, `KnowledgeBaseAgent` | `staff-full` 的受控摘要 | 失败归类、补跑候选、infra/impl 区分和风险升级 |
| `TeacherAgent` | `GatewayAgent`, `SpecAssistant`, `SpecValidator`, `KnowledgeBaseAgent` | `staff-full` | 建课、阶段审核、评分证据解释和课程复盘 |
| `ReviewAgent` | `SpecValidator`, `DebugAgent` | `staff-full` | AI 审计、异常工具调用、越权尝试和诚信风险复查 |
| `ReportAgent` | `KnowledgeBaseAgent`, `GatewayAgent` | 按接收者裁剪 | final synthesis、verification report、AI collaboration log 和 analytics 摘要 |

`ReviewAgent` 与 `ReportAgent` 是课程侧 preset，不是新的 runtime role。实现时只选择对应 runtime role config 与输出 schema。

## 7. 审计默认值

所有角色必须记录：

- `role_id`
- `course_persona`
- `runtime_role`
- `fixed_prompt_id`
- `ContextBundle` ref
- `PromptEnvelope` ref
- advertised tools
- tool calls and arguments summary
- MCP server names
- loaded skills
- structured output ref
- risk flags
- user accepted / rejected 状态，如产生 patch proposal

风险标记至少包括：

- `unbound_codegen_attempt`
- `path_policy_violation`
- `hidden_context_request`
- `unsafe_tool_request`
- `test_or_checker_bypass`
- `large_patch_proposal`
- `reference_usage_limit_risk`
- `schema_parse_failure`

schema 解析失败必须返回 `AgentOutputError` 并停止后续 patch gate；不得把自由文本结果转为可应用 patch。
