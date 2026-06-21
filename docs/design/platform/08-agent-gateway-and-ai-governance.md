# 08 Agent Governance And AI Audit

回答的问题：

- 平台视角下本地 Agent 要提供什么治理和审计接口
- 学生 Agent、教师 Agent、Review Agent 的权限边界是什么
- AI 使用审计如何进入平台主流程

上游依赖文档：

- [01-boundaries-and-goals.md](./01-boundaries-and-goals.md)
- [03-domain-model.md](./03-domain-model.md)
- [../arch.md](../arch.md)

下游消费者：

- `vos-agent`
- `vos-cli`
- Portal AI 面板
- 审计与纪律处理流程
- Analytics

## 1. 边界

本文件只定义平台视角下的 Agent 治理、权限上限与审计，不重复定义：

- Agent identity 与 capability pack 目录
- 代码索引实现
- workspace 内工具实现细节

这些由 [`../agent/`](../agent/README.md) 和 [`../arch.md`](../arch.md) 负责。
Agent Runtime 永久本地-only：`vos-agent` 在学生本地 workspace 或 sandbox
runner 内执行模型、工具和 patch gate；云端平台不承载 Agent tool execution，
也不提供 workspace Agent Gateway 执行层。

## 2. 平台治理接口

平台提供身份、policy、审计和状态接口，而不是云端模型执行接口。最小接口：

```http
GET  /api/agent/sessions/{id}
POST /api/agent/sessions/{id}/close
GET  /api/projects/{projectId}/agent-audit
POST /api/projects/{projectId}/agent-policy/recompute
GET  /api/projects/{projectId}/vos-policy
POST /api/projects/{projectId}/agent-audit
```

OpenAI-compatible `/v1/*` 接口属于本地 `vos-agent` façade，而不是平台目标态
必需接口。Portal 可以展示 Agent 审计、触发 runner、下发 policy snapshot，
但不直接执行 Agent turn。

## 3. 上下文投影

每次本地 Agent 会话或 `vos` run 上报审计时必须绑定：

- `user_id`
- `project_id`
- user persona
- `agent_identity_id`
- `capability_pack_id`
- 当前阶段
- 可见性投影
- 工具策略快照
- `vos` policy snapshot ref
- evidence refs

上下文来源可包括：

- 本地 `vos-agent` 当前打开文件与选区摘要
- 当前阶段公开规则
- 本地 `spec/` 摘要
- 最近公开验证摘要
- 角色允许访问的审查结果

禁止来源：

- 其他学生项目代码
- hidden test 全文
- 未授权 staff-only 评分细节

## 4. 权限矩阵

| 能力 | Student persona | Teacher persona | Review persona |
|---|---:|---:|---:|
| 读本项目公开 spec | 允许 | 允许 | 允许 |
| 读本项目 repo | 允许 | 允许 | 允许 |
| 读公开 pipeline 摘要 | 允许 | 允许 | 允许 |
| 读 hidden rules | 禁止 | 受控允许 | 受控允许 |
| 选择实现身份 | 允许 | 可选 | 可选 |
| 直接执行 workspace 工具 | 仅本地 `vos-agent` + authenticated `vos` | 仅本地 `vos-agent` + authenticated `vos` | 仅本地 `vos-agent` + authenticated `vos` |
| 修改评分 | 禁止 | 禁止 | 禁止 |
| 读他人项目 | 禁止 | 课程内受控 | 课程内受控 |

## 5. 工具执行策略

平台必须对 Agent 工具调用提供以下治理输入；实际工具执行由本地 `vos-agent`
和 authenticated `vos-cli` 完成：

- 身份绑定能力包
- policy snapshot 与可见性上限
- project / stage binding
- 触发者身份校验结果
- 审计字段补齐

至少记录：

- 会话 id
- 模型 id
- Agent identity 与 capability pack
- 读取的上下文摘要
- 本地上报的工具调用摘要与参数摘要
- 是否产生写入或报告
- 学生是否接受
- 关联的 `vos` run_id 和 evidence refs

## 6. 审计要求

每次 Agent 会话都必须持久化：

- 请求时间
- 用户与项目
- Agent identity 与 capability pack
- 上下文投影摘要
- 工具调用列表
- 输出摘要
- `vos` policy snapshot ref
- `vos` evidence refs
- 风险标记

风险标记示例：

- 大规模代码生成
- 未运行测试即建议核心 patch
- 尝试访问未授权项目
- 引导删除测试或关闭检查器

## 7. 关键流程

### 7.1 学生 IDE 访问本地 Agent

```text
vos login / token validation
  -> local vos-agent resolves project and stage
  -> authenticated vos-cli checks Portal policy snapshot
  -> local tools / patch / verification run
  -> upload audit summary and evidence refs
  -> Portal displays governance record
```

完成判据：

- 本地 Agent 返回响应
- 会话与工具记录完整
- 未发生越权上下文泄露

### 7.2 ReviewAgent 审计

```text
load project audit trail
  -> inspect suspicious sessions
  -> attach findings to project
  -> notify teacher if required
```

## 8. 失败模式与约束

- 未能确定 `project_id` 时不得回退到无项目上下文。
- 工具调用失败也必须由本地 `vos-agent` / `vos-cli` 写审计并上报摘要。
- 权限降级或规则切换必须生成新策略快照。
- 平台不得把 hidden context 下发到本地学生 Agent。
- 平台不得直接执行 workspace tools，也不得把本地 Agent 输出当作验证结果。

## 9. VeriSpecOSLab 特化说明

VeriSpecOSLab 额外需要：

- 公开 `vos` 基础命令能力
- 绑定 QEMU / trace / log 的公开摘要
- 限制 Agent 不得读取 hidden verification 细节
- 通过 authenticated `vos` run 关联 Agent 行为和 build/run/verify evidence

## 10. 后续扩展点

- 组织级模型路由
- AI 使用异常检测
- 与教学诚信系统联动
