# Student Agent Runtime

学生只面对一个 Agent Runtime。角色由 `taskKind` 和请求范围自动路由到已有 provider/profile；学生不需要选择 smart、deep 或 rush。

`vos agent config` 是独立的设置入口，不是 Agent 角色。交互向导只收集 provider、模型、base URL 和凭据环境变量名；凭据值保存在项目 `.env`。KB 有来源时才要求 `[kb.embedding]`。`--check`、`vos doctor`、Agent Runtime 与 KB Runtime 共用严格配置解析，格式错误、未知字段和缺失凭据不得静默降级。

| 角色 | 权限 | 输出 |
| --- | --- | --- |
| `implement <module>` | 只写 owns 并集 | worktree patch、普通与 hidden tests、结构化 target 提案、成功提交 |
| `debug` | 只读 | 根因、证据和修复方向 |
| `verify` | 只读 | 公开测试、契约和 Spec ID 覆盖报告 |
| `ask` | 问答 | 锁定来源、revision、hash、片段和策略结论 |
| `review [target]` | 只读 | 先执行 lint，再评审目标 Spec、相关 Spec 和 `verifies` 映射 |

学生在 `ask → 手写 Spec → spec lint → review → 修改 → 再次 lint → 手动提交` 的循环中完成设计。公开 CLI 不提供 `agent design`、`agent spec` 或 proposal/confirm 别名。`debug`、`verify`、`review` 和 `ask` 不得写项目文件。`implement` 必须从 clean HEAD 和已提交 Spec 开始，跨模块修改还必须有已提交的 `spec/patches/<patch>.yaml`。Agent 最终 patch 由 VOS 再次执行 owns、HEAD、schema 和验证门禁。

所有 Agent profile 都可以调用宿主 Bash。只读角色的 prompt、运行前后 Git 检查和审计记录用于发现越界，但不构成宿主安全边界。Doctor 使用 Debug Agent 阅读全部 Spec 和 `vos.yaml`，推导 required/optional 工具并运行版本、target、编译或运行探针；每条结论必须引用实际 Bash 调用和结果。它只能提出安装建议，不能调用包管理器或修改系统配置。

需要结构化结果的角色必须通过声明的提交工具返回数据。工具会验证 schema 和语义；如果提交缺少字段、路径越界、引用无效，或 `implement` 返回 `failed`、`partial`、`blocked`，运行时把错误原样返回同一模型线程，并恢复完整工具集供其继续检查和修正。只有通过工具验证的 `passed` 结果会交给 VOS 执行权威 build/test 门禁。

临时 worktree 只隔离 Git 变更；宿主命令默认直接使用当前用户权限、网络和凭据。它不是安全边界，文档、日志和 UI 都必须明确这一点。模型输出采用 best effort 的提示约束，不承诺确定性过滤或保密。

所有对话、工具调用、diff 和结果写入 gitignored 的 `.vos/audit`，通过连续哈希账本发现缺口。提交导出时遮蔽凭据，绝对路径改成稳定别名；未展示的检索上下文不复制进学生日志。KB 本机完整参考资料仍可能被学生读取，这是策略性约束，不是保密保证。
