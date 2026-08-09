# Student Agent Runtime

学生只面对一个 Agent Runtime。角色由 `taskKind` 和请求范围自动路由到已有 provider/profile；学生不需要选择 smart、deep 或 rush。

`vos agent config` 是独立的设置入口，不是 Agent 角色。交互向导只收集 provider、模型、base URL 和凭据环境变量名；凭据值保存在项目 `.env`。KB 有来源时才要求 `[kb.embedding]`。`--check`、`vos doctor`、Agent Runtime 与 KB Runtime 共用严格配置解析，格式错误、未知字段和缺失凭据不得静默降级。

| 角色 | 权限 | 输出 |
| --- | --- | --- |
| `design` | 只写 `spec/design.yaml` | 结构化提案，确认后单独提交 |
| `spec <module>` | 只写目标 ModuleSpec | 严格 schema 提案，确认后单独提交 |
| `implement <module>` | 只写 owns 并集 | worktree patch、build/public/contract evidence、成功提交 |
| `debug` | 只读 | 根因、证据和修复方向 |
| `verify` | 只读 | 公开测试、契约和 Spec ID 覆盖报告 |
| `kb` | 问答 | 锁定来源、revision、hash、片段和策略结论 |
| `review` | 只读 | Spec、代码、测试和 diff 审查 |

`debug`、`verify`、`review` 和 `kb` 不得写项目文件。`design`、`spec` 不接受未确认的写入。`implement` 必须从 clean HEAD 和已提交 Spec 开始，跨模块修改还必须有已提交的 `spec/patches/<patch>.yaml`。Agent 最终 patch 由 VOS 再次执行 owns、HEAD、schema 和验证门禁。

临时 worktree 只隔离 Git 变更；宿主命令默认直接使用当前用户权限、网络和凭据。它不是安全边界，文档、日志和 UI 都必须明确这一点。模型输出采用 best effort 的提示约束，不承诺确定性过滤或保密。

所有对话、工具调用、diff 和结果写入 gitignored 的 `.vos/audit`，通过连续哈希账本发现缺口。提交导出时遮蔽凭据，绝对路径改成稳定别名；未展示的检索上下文不复制进学生日志。KB 本机完整参考资料仍可能被学生读取，这是策略性约束，不是保密保证。
