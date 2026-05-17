# 01 Runtime Roles

## 1. 角色收敛

Agent Runtime 对外可以表现为统一模型，对内收敛为以下角色：

- `GatewayAgent`
- `SpecAssistant`
- `SpecCompiler`
- `SpecValidator`
- `DebugAgent`
- `KnowledgeBaseAgent`

如需 OS 领域增强，由 `07-os-specialization.md` 描述的 specialization 规则附加，而不是再复制一套角色体系。

## 2. 角色职责

### `GatewayAgent`

负责：

- 接收任务并识别 `task_kind`
- 调用 `vos agent context` 构造上下文
- 绑定 policy、allowed paths、required validations
- 选择下游 agent 与 generation mode

不负责：

- 直接生成核心 patch
- 绕过 `vos` 直接访问隐藏数据

### `SpecAssistant`

负责：

- 从自然语言设计意图生成或修订结构化 spec 草案
- 指出缺失字段、跨 spec 不一致和需要的 `SpecPatch`
- 将 prose 问题映射到 `ModuleSpec` / `OperationContract` / `CompositionSpec`

输出：

- spec 修订建议
- 结构化缺口清单
- 是否需要 `spec patch`

### `SpecCompiler`

负责：

- 基于绑定 spec 生成局部候选实现
- 采用 `logic` 与 `concurrency_refine` 两阶段生成
- 保证输出范围受 `allowed_paths`、`editable_region` 和 `allowed_outputs` 限制

输出：

- 单函数实现草案
- 小粒度 unified diff
- 绑定的 spec 条款列表

### `SpecValidator`

负责：

- 审查生成结果是否满足绑定 spec
- 消费 lint、build、test、trace、invariant evidence
- 产出结构化 `ValidatorFeedback`

不负责：

- 直接修改代码
- 越权降低验证要求

### `DebugAgent`

负责：

- 从 `DiagnosticReport`、recent evidence、最近 patch 中定位失败原因
- 判断是 spec 缺口、实现缺口、工具链配置问题，还是测试假设不满足
- 推荐下一条 `vos` 命令或下一轮 agent 任务

### `KnowledgeBaseAgent`

负责：

- 检索教学材料、参考规格、调试案例、反例和受限代码片段
- 解释“参考设计与当前设计的差异”
- 按引用规则输出可审计参考，而不是可直接提交答案

## 3. 路由规则

默认路由：

- 设计澄清、字段补全 -> `SpecAssistant`
- 已有 operation spec 的局部实现 -> `SpecCompiler`
- 生成后审核 -> `SpecValidator`
- 失败诊断 -> `DebugAgent`
- 参考学习、案例检索 -> `KnowledgeBaseAgent`

强制门禁：

- 缺少核心 `OperationContract` 时，`SpecCompiler` 不直接生成完整实现。
- 涉及跨模块语义变化时，优先路由到 `SpecAssistant` 生成 `SpecPatch` 草案。

## 4. 角色输入输出契约

所有角色统一消费 `PromptEnvelope`。

只有以下角色可以产出核心结构：

- `SpecAssistant` -> spec revision draft / `spec_patch_required`
- `SpecCompiler` -> patch proposal
- `SpecValidator` -> `ValidatorFeedback`
- `DebugAgent` -> `DiagnosticReport` enhancement
- `KnowledgeBaseAgent` -> `ReferencePayload`
