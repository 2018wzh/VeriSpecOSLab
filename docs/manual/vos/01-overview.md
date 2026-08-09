# VOS 命令总览

学生公开命令收敛为：

```text
vos init
vos doctor
vos agent ask
vos spec lint design
vos agent review design
vos kb add|list|search|remove|clear|export-manifest|import-manifest
vos agent implement <module>
vos agent debug
vos agent verify
vos agent ask [question]
vos agent review [module]
vos build
vos run qemu
vos run hardware
vos verify
vos report
vos submit
```

所有命令都接受 `--project-root`、`--json`、`--verbose` 和 `--progress`。学生 CLI 不再暴露登录、pipeline、stage、toolchain、arch、trace、ledger 或旧 Agent 生成入口；知识库改由 `vos kb` 命令管理。Portal 内部 HTTP 能力继续保留，但不是学生主链。

`vos init` 只建立空契约和初始 Git 提交。`vos build` 使用 `vos.yaml` 的结构化 argv。`vos verify` 是无模型的确定性门禁。`vos report` 不提交 Git，`vos submit` 要求 clean HEAD 并创建绑定 commit/spec/config hashes 的归档。
