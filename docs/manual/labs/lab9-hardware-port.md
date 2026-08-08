# Lab 9：硬件移植

在 DesignSpec 的 `hardware_port` 固定 canonical board、启动、串口和中断约定；在 `vos.yaml` hardware runner 填 board、serial、workload、build target 和环境 allowlist。

```sh
vos build
vos run qemu
vos run hardware
```

Hardware evidence 记录 board 标识、commit、串口日志和 workload，但状态永远是 `pending_human_review`。本地启动记录不能写成已通过人工验收。
