# Agent 使用边界

Agent 由 VOS 按角色路由，学生不选择 smart/deep/rush。`design`/`spec` 只生成待确认 diff，`implement` 只在 detached linked worktree 触及 owns，`debug`/`verify`/`review` 只读，`kb` 只问答。

worktree 只是 Git 变更回滚机制，不是安全沙箱。宿主命令继承当前用户的进程、网络、凭据和文件权限；本机参考资料可被学生读取也是已接受的策略风险。
