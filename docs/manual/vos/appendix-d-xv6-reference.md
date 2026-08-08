# 附录 D：xv6 参考项目

`examples/xv6-spec` 是完整的 xv6 风格 RISC-V 源码参考子模块。它保留原始源码和历史规格，方便学生理解启动、内存、陷阱、进程、syscall、文件系统、IPC 和设备驱动；它不是新学生项目的兼容层，也不是安全边界。

新项目不要复制旧的架构碎片。先运行 `vos init`，再用 `vos agent design` 将你选择的语言、ISA、QEMU 和板卡写进 `spec/design.yaml`，随后按纵向模块建立 `spec/modules/*.yaml`。如果参考 xv6 的某个接口跨越用户/内核边界，则把它重新表达为 `spec/interfaces/*.yaml`；架构或跨模块语义变化写入 `spec/patches/*.yaml`。

本仓库的 xv6 子模块可能需要本地 RISC-V 工具链和 QEMU 才能真实运行。学生提交只应包含自己的 clean HEAD、Spec、测试、确定性报告和经过遮蔽的日志，不应把本机绝对路径、凭据或完整参考资料复制进 Git。
