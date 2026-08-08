# ARM 启动参考

ARM 的 ISA、QEMU 参数和 canonical board 写入 `spec/design.yaml`；编译、刷写、串口和 workload 写入 `vos.yaml` 的结构化 target。ModuleSpec owns 只包含实现与测试路径，硬件结果由 Runner 记录并保持 `pending_human_review`。
