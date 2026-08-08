# 工具概览

```text
vos init / doctor / spec check
vos agent design / spec / implement / debug / verify / kb / review
vos build / run qemu / run hardware / verify / report / submit
```

命令通过 Bun argv 子进程执行 `vos.yaml` target。QEMU 使用 `-nographic`，Hardware Runner 保存 board、commit、serial 和 workload，并固定等待人工验收。
