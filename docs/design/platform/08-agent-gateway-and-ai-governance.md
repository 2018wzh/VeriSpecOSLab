# 08 Agent Gateway And AI Governance

回答的问题：

- 平台视角下 Agent Gateway 要提供什么接口和控制
- 学生 Agent、教师 Agent、Review Agent 的权限边界是什么
- AI 使用审计如何进入平台主流程

上游依赖文档：

- [01-boundaries-and-goals.md](./01-boundaries-and-goals.md)
- [03-domain-model.md](./03-domain-model.md)
- [../arch.md](../arch.md)

下游消费者：

- Agent Gateway
- Portal AI 面板
- 审计与纪律处理流程
- Analytics

## 1. 边界

本文件只定义平台视角下的 Agent 接口、权限与审计，不重复定义：

- Agent Runtime 内部 prompt
- 代码索引实现
- workspace 内工具实现细节

这些由 [`../arch.md`](../arch.md) 负责。

## 2. 对外接口

最小接口：

```http
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses
```

平台侧补充管理接口：

```http
GET  /api/agent/sessions/{id}
POST /api/agent/sessions/{id}/close
GET  /api/projects/{projectId}/agent-audit
POST /api/projects/{projectId}/agent-policy/recompute
```

## 3. 上下文投影

每次 Agent 请求必须绑定：

- `user_id`
- `project_id`
- `role`
- 当前阶段
- 可见性投影
- 工具策略快照

上下文来源可包括：

- 当前打开文件与选区
- 当前阶段公开规则
- 本地 `spec/` 摘要
- 最近公开验证摘要
- 角色允许访问的审查结果

禁止来源：

- 其他学生项目代码
- hidden test 全文
- 未授权 staff-only 评分细节

## 4. 权限矩阵

| 能力 | 学生 Agent | 教师 Agent | Review Agent |
|---|---:|---:|---:|
| 读本项目公开 spec | 允许 | 允许 | 允许 |
| 读本项目 repo | 允许 | 允许 | 允许 |
| 读公开 pipeline 摘要 | 允许 | 允许 | 允许 |
| 读 hidden rules | 禁止 | 受控允许 | 受控允许 |
| 生成 patch 建议 | 允许 | 可选 | 可选 |
| 直接执行 workspace 工具 | 受控允许 | 受控允许 | 受控允许 |
| 修改评分 | 禁止 | 禁止 | 禁止 |
| 读他人项目 | 禁止 | 课程内受控 | 课程内受控 |

## 5. 工具执行策略

平台必须对 Agent 工具调用执行以下控制：

- 工具白名单
- 参数校验
- 项目路径隔离
- 触发者身份校验
- 审计字段补齐

至少记录：

- 会话 id
- 模型 id
- 读取的上下文摘要
- 调用的工具与参数
- 是否产生 patch
- 学生是否接受

## 6. 审计要求

每次 Agent 会话都必须持久化：

- 请求时间
- 用户与项目
- 上下文投影摘要
- 工具调用列表
- 输出摘要
- 风险标记

风险标记示例：

- 大规模代码生成
- 未运行测试即建议核心 patch
- 尝试访问未授权项目
- 引导删除测试或关闭检查器

## 7. 关键流程

### 7.1 学生 IDE 访问 Agent

```text
authenticate
  -> resolve project and stage
  -> build allowed context projection
  -> authorize tool policy
  -> call runtime
  -> persist audit
```

完成判据：

- 返回响应
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
- 工具调用失败也必须写审计。
- 权限降级或规则切换必须生成新策略快照。

## 9. VeriSpecOSLab 特化说明

VeriSpecOSLab 额外需要：

- 公开 `vos` 基础命令能力
- 绑定 QEMU / trace / log 的公开摘要
- 限制 Agent 不得读取 hidden verification 细节

## 10. 后续扩展点

- 组织级模型路由
- AI 使用异常检测
- 与教学诚信系统联动
