# VOS 命令速查

```sh
vos init
vos doctor
vos spec check
vos agent design [--confirm]
vos agent spec <module> [--confirm]
vos agent implement <module>
vos agent debug
vos agent verify
vos agent kb [question]
vos agent review [module]
vos build
vos run qemu
vos run hardware
vos verify
vos report
vos submit
```

通用参数是 `--project-root`、`--json`、`--verbose` 和 `--progress`。旧的 stage、pipeline、toolchain、arch、test、trace、ledger、直接 KB 管理和 Agent context/plan/generate/apply-patch 不属于学生入口；Portal 内部冻结集成可继续使用自己的服务边界。
