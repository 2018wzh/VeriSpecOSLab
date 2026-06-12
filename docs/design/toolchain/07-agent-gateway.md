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

- Agent 永远经由 `vos` 子命令工作
- 不开放任意 shell
- LLM 不是 runtime 的强依赖
- 所有 Agent 行为都必须进入 evidence 与协作日志
- 在全 TypeScript 路线下，`vos agent` 子命令作为 `vos-agent` 的受控 wrapper；fixed prompt 负责角色行为与输出 schema，policy、patch gate、stage gate 和验证 DAG 由确定性 runtime 裁决

## 1.5 Wrapper 分工

`vos agent` 子命令分为两类：

- 确定性命令：`agent context`、`agent apply-patch`、`agent log`
- LLM wrapper 命令：`agent plan`、`agent generate`、`agent debug`

LLM wrapper 命令必须：

- 先构造 `ContextBundle` 与 `PromptEnvelope`
- 选择版本化 fixed prompt
- 调用 `vos-agent` headless runner 或共享 runner API
- 校验结构化输出
- 将 prompt version、context ref、输出 ref、risk flags 写入 evidence 与 `AICollaborationLog`

LLM wrapper 命令不得：

- 直接应用 patch
- 降低 policy 或验证要求
- 把 hidden tests、staff-only rubric 或其他学生代码放入 `ContextBundle`

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

## 3. `vos agent context`

职责：

- 构造 `ContextBundle`

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

## 4. `vos agent plan`

职责：

- 生成 `PlanDraft`
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

## 5.5 `vos agent generate`

职责：

- 基于当前 spec 生成 skeleton 与模块实现
- 生成目标可以是整个当前系统、某个 stage，或某个模块

输入：

- 可选 `target`
- `--apply`
- `--build`
- `--run`

契约：

- `vos agent generate`：省略 target，默认解析为当前 `current_stage`，并生成该 stage 对应的全部 `enabled_modules`
- `vos agent generate <module>`：生成该模块及其依赖闭包
- `vos agent generate <stage>`：生成该 stage 对应的完整系统

约束：

- 默认“整个系统”不是单独 schema 字段，而是由当前 stage 的架构组合结果导出
- `--build` 依赖 `--apply`
- `--run` 依赖 `--build`

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
- [../agent.md](../agent.md)
