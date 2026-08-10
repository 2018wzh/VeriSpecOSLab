# Agent 使用边界

Agent 由 VOS 按角色路由，学生不选择 smart/deep/rush。学生用 `ask` 讨论设计，亲手编写 Spec，再用 `spec lint` 和只读 `review` 检查；公开 CLI 不提供生成式 `design`/`spec`。`implement` 只在 detached linked worktree 触及 owns，`debug`/`verify`/`review`/`ask` 均为只读角色。知识来源由 `vos kb` 命令管理。

结构化 Agent 结果必须通过声明的工具提交。工具校验失败会把具体错误返回同一模型线程，允许 Agent 继续修正；未经工具接受的结果不能进入权威门禁。

worktree 只是 Git 变更回滚机制，不是安全沙箱。宿主命令继承当前用户的进程、网络、凭据和文件权限；本机参考资料可被学生读取也是已接受的策略风险。
