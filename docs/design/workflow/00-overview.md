# Student workflow

课程入口只保留一条本地循环：

```text
vos init → design/spec → implement → build → verify
        → qemu/hardware → report → submit
```

## State transitions

1. `vos init` 在空目录写入空 DesignSpec、工具链 ModuleSpec、`vos.yaml`、`.gitignore` 并创建初始 Git commit。
2. `vos agent design` 和 `vos agent spec <module>` 在临时 linked worktree 生成结构化 diff；学生确认后才原子应用并单独提交。
3. `vos agent implement <module>` 要求 clean HEAD 和已提交 Spec；跨模块变化还必须引用已提交 SpecPatch。Agent 只能修改目标模块与 SpecPatch 影响模块 owns 并集。
4. `vos build`、开发态 `vos run qemu` 和 `vos run hardware` 可以在脏树执行，但 evidence 明确标记为不可提交。
5. `vos verify` 确定性执行 spec check、build、所有 public tests 和 contract checks，不调用模型，不执行 fuzz、trace 或 hidden tests。
6. `vos report` 从 commits、Spec IDs、测试、日志和 evidence 生成 `.vos/report.json`；`vos submit` 在 clean HEAD 上刷新报告并生成绑定 commit/spec/config hashes 的归档。

## Read-only roles

`agent debug`、`agent verify`、`agent review` 只报告证据、缺口、根因和修复方向；`agent kb` 只回答问题。它们可以写入 gitignored evidence 和 audit，但不能修改项目源码或 Spec。

## Trust boundary

linked worktree 只提供 Git 变更回滚，不提供进程、网络、凭据或宿主文件安全。Agent 默认可执行宿主命令并继承当前用户权限；本机参考 OS 对学生可读也是已接受的策略风险。KB、对话、工具调用、diff 和结果写入连续哈希 audit，导出时遮蔽凭据并替换绝对路径。

Portal/Demo 的控制面、内部 HTTP 和静态 Demo 在本阶段冻结，只维持 typecheck/build/unit test，不扩展到学生主链。
