# 07 Agent Gateway

回答的问题：

- `agent` 子系统如何在不暴露自由 shell 的前提下工作
- Agent 可以看到什么、提交什么、被如何校验
- `agent context / plan / generate / apply-patch / serve / log` 各自负责什么

上游依赖文档：

- [01-boundaries-and-roles.md](./01-boundaries-and-roles.md)
- [04-data-model.md](./04-data-model.md)
- [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)

下游消费者：

- `vos-agent`
- IDE 集成
- 本地 Agent Gateway

## 1. 基本原则

- Agent 写入和验证永远经由 `vos` 确定性 gate 工作
- 不开放任意 shell
- LLM 不是 runtime 的强依赖
- 所有 Agent 行为都必须进入 evidence 与协作日志
- Agent 会话由 `AgentIdentity` 选择唯一 `role_prompt_id` 和唯一 `capability_pack_id`；policy、stage gate、验证 DAG 和 evidence 由确定性 runtime 裁决

## 1.5 身份与能力包

Agent Gateway 只启动一种强项目 Agent runner。每次会话必须先解析：

- `agent_identity_id`
- `role_prompt_id`
- `capability_pack_id`
- user persona / visibility scope
- policy snapshot

任务身份绑定固定能力包。persona、stage 和 project policy 只能收窄能力包，不能扩权。

Gateway 必须记录身份、能力包、上下文引用、输出引用、risk flags 和 evidence refs。

Gateway 不得：

- 通过提示词授予工具或路径
- 为身份临时拼接未绑定的工具集
- 降低 policy、stage gate 或验证要求
- 把 hidden tests、staff-only rubric 或其他学生代码放入 agent session context

## 2. `vos agent serve`

职责：

- 启动本地 OpenAI-compatible façade
- 暴露受控工具集，而不是完整系统权限

输入：

- host / port
- project root
- course id

输出：

- 服务启动状态
- 当前 policy 摘要

## 3. Agent Session Context

职责：

- 构造 agent session context

输入：

- spec path
- log path
- stage
- visibility scope

输出：

- 解析后的 spec 摘要
- 最近证据引用
- 允许修改路径
- 推荐命令

约束：

- 只能返回公开与 agent-only 可见信息
- 不返回 hidden tests 源码

## 4. Agent Task Preview

职责：

- 生成非执行性 task preview
- 不改文件，不执行 patch

输入：

- 任务描述
- 可选日志 / spec / stage

输出：

- 相关 spec
- 怀疑受影响文件
- 必需验证集

## 5. `vos agent apply-patch`

输入：

- patch 文件或 stdin diff
- `--require-spec`
- `--run-validation`

校验顺序：

```text
1. policy 检查
2. patch 是否绑定本地 spec
3. 修改路径是否在允许范围内
4. patch impact analysis
5. 应用 patch
6. 运行最小验证 DAG
7. 写入 AICollaborationLog 与 evidence
```

最小验证 DAG 至少包括：

- `spec lint`
- 受影响 `arch lint`
- `build`
- 相关公开测试
- 必需 invariant check

## 5.5 Stage-Bounded Generation

职责：

- `implementer.v2` 基于当前 spec 生成 skeleton 与模块实现
- 生成目标可以是当前 stage 的完整系统、某个 stage，或某个模块依赖闭包

输入：

- 可选 `target`
- `--build`
- `--run`

契约：

- 省略 target 时，默认解析为当前 `current_stage`，并生成该 stage 对应的全部 `enabled_modules`
- 传入 module 时，生成该模块及其依赖闭包
- 传入 stage 时，生成该 stage 对应的完整系统

约束：

- 默认“整个系统”不是单独 schema 字段，而是由当前 stage 的架构组合结果导出
- `--run` 依赖 `--build`
- 不得生成未来阶段模块或绕过必需 commit-backed SpecPatch gate

## 6. `vos agent log`

职责：

- 记录或查询 AI 协作日志

日志字段建议包括：

- `session_id`
- `kind`
- `task`
- `related_specs`
- `patch_ref`
- `evidence_ref`
- `result`

## 相关文档

- [08-evidence-reporting-and-ci.md](./08-evidence-reporting-and-ci.md)
- [09-roadmap-and-acceptance.md](./09-roadmap-and-acceptance.md)
- [../agent/README.md](../agent/README.md)
