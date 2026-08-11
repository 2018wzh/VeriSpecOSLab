# 附录 A：学生命令速查

| 命令 | 用途 |
| --- | --- |
| `vos init` | 创建空 v2 项目并提交初始文件 |
| `vos doctor` | 检查 Bun、Git、manifest、Spec、Agent 和 KB 配置 |
| `vos spec lint [target]` | 确定性 schema、引用、路径、等级、owns 和 manifest 校验 |
| `vos agent config` | 配置并检查 provider、模型和凭据引用 |
| `vos kb add/list/search/remove/clear` | 管理当前项目的本地知识库 |
| `vos agent ask` | 写 Spec 前讨论概念和取舍，不修改文件 |
| `vos agent review [target] [-i]` | 评审学生手写 Spec，不修改文件 |
| `vos agent implement <module>` | 在临时 linked worktree 中实现并验证 |
| `vos agent debug` | 只读根因和证据摘要 |
| `vos agent verify` | 确定性公开验证后的只读 Agent 复核 |
| `vos agent ask "<question>"` | 只问答，使用命令建立的项目 KB |
| `vos agent review [module]` | 只读审查 Spec、代码、测试和 diff |
| `vos build` | 执行 manifest build（脏树允许但不可提交） |
| `vos run qemu` | 执行非图形串口 QEMU runner |
| `vos run hardware` | 执行硬件 runner，状态为 `pending_human_review` |
| `vos verify` | clean HEAD 上执行 spec/build/public/contract 门禁 |
| `vos report` | 确定性生成 `.vos/report.json` |
| `vos submit` | 刷新报告并创建可复现归档 |

全局参数：`--project-root <dir>`、`--json`、`--verbose`、`--progress auto|always|never`。
