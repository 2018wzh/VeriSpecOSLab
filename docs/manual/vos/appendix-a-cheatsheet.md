# 附录 A：学生命令速查

| 命令 | 用途 |
| --- | --- |
| `vos init` | 创建空 v2 项目并提交初始文件 |
| `vos doctor` | 检查 Bun、Git、manifest、Spec 和 KB lock |
| `vos spec check` | 确定性 schema、引用、路径和等级校验 |
| `vos agent config` | 配置并检查 provider、模型和凭据引用 |
| `vos agent design` | 提案并确认 DesignSpec |
| `vos agent spec <module>` | 提案并确认 ModuleSpec |
| `vos agent implement <module>` | 在临时 linked worktree 中实现并验证 |
| `vos agent debug` | 只读根因和证据摘要 |
| `vos agent verify` | 只读公开验证摘要 |
| `vos agent ask "<question>"` | 只问答，使用 manifest 锁定的 KB |
| `vos agent review [module]` | 只读审查 Spec、代码、测试和 diff |
| `vos build` | 执行 manifest build（脏树允许但不可提交） |
| `vos run qemu` | 执行非图形串口 QEMU runner |
| `vos run hardware` | 执行硬件 runner，状态为 `pending_human_review` |
| `vos verify` | clean HEAD 上执行 spec/build/public/contract 门禁 |
| `vos report` | 确定性生成 `.vos/report.json` |
| `vos submit` | 刷新报告并创建可复现归档 |

全局参数：`--project-root <dir>`、`--json`、`--verbose`、`--progress auto|always|never`。
