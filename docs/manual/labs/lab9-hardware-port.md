# Lab 9：硬件移植

参考实现固定使用 StarFive VisionFive 2：由固定 BSP DTB、OpenSBI、U-Boot FIT、原生 SDIO 和按 GPT type GUID/`xv6fs` 名称发现的文件系统分区组成。未知 compatible、缺失 DT 节点或 SBI TIME/IPI/HSM/RFENCE/SRST 扩展必须直接失败。四个 U74 hart 通过 SBI HSM 有序启动。

在 DesignSpec 的 `hardware_port` 固定 canonical board、启动、串口和中断约定；在 `vos.yaml` hardware runner 填 board、serial、workload、build target 和环境 allowlist。

```sh
vos build
vos run qemu
vos run hardware
```

Hardware evidence 记录 board 标识、commit、串口日志和 workload，但状态永远是 `pending_human_review`。本地启动记录不能写成已通过人工验收。

当前参考标签是 `course/lab9-candidate`。QEMU、FDT/GPT/SD 单元测试、FIT/镜像检查或模拟串口都不能替代实板门禁；只有在 VisionFive 2 上完成四核完整 `usertests` 并经人工复核后，才允许发布 complete 标签。
