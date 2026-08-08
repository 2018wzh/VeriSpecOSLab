# Book 2：启动

启动路径是第一个 ModuleSpec。把接口、错误、测试性质和 owns 写在 `spec/modules/boot.yaml`，由 `vos agent implement boot` 在 worktree 中生成候选实现，再用 QEMU 非图形串口 evidence 验证。
