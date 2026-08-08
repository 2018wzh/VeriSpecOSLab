# Book 5：用户态与 ABI

模块负责实现，syscall、IPC、驱动和用户/内核 ABI 只写在 `spec/interfaces/*.yaml`。每个接口操作声明 input/output、pre/post、errors 和 properties，测试 target 用 `verifies` 绑定稳定 ID。
