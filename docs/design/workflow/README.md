# 学生主链与冻结边界

本目录记录学生从空目录到可提交 OS 的开发循环。课程平台、教师评分和 Portal 的内部流程可以继续存在，但不再扩大本阶段的学生 CLI。

```text
init → design → ModuleSpec → implement → build/test/repair
     → commit → QEMU/hardware → public verify → report → submit
```

学生仓库的 source of truth 是五类 Spec 和代码。所有公开门禁在本地确定性执行；Agent 只负责设计解释、Spec 提案、实现和问答，不能把对话结论直接当作验证通过。

Agent 的 worktree 只隔离 Git 变更。宿主命令继承当前用户权限、网络和凭据；本地参考源码也不具备保密性。Portal/Demo 在本阶段冻结并维持自身 typecheck/build/unit test，不保证旧 connected teaching loop。

详细边界见 [`../spec/README.md`](../spec/README.md)、[`../toolchain/README.md`](../toolchain/README.md) 和 [`../agent/README.md`](../agent/README.md)。
