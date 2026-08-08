# Lab 6：文件系统

把 buffer cache、日志和 inode 视为独立 ModuleSpec，只有共享 ABI 或 syscall 才放到 InterfaceSpec。L3 模块要明确并发状态机和 rely/guarantee；跨模块语义变化先写 `spec/patches/fs-*.yaml`。

```sh
vos agent spec filesystem
vos agent implement filesystem
vos build
vos verify
```

公开测试覆盖崩溃恢复、引用计数和并发访问；每个 target 的 `verifies` 必须引用稳定模块或接口 ID。
