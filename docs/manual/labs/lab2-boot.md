# Lab 2：启动模块

为启动路径创建 `spec/modules/boot.yaml`，从 L1 开始，逐步补齐实现。模块文件同时包含接口操作、properties、错误语义和测试性质；不再拆出操作或并发文件。

```sh
vos agent spec boot
vos agent implement boot
vos build
vos verify
```

`owns` 只列启动代码、启动测试和必要的工具文件。每个 public/contract target 都在 `vos.yaml` 写 `verifies: [boot]` 或更细的稳定 Spec ID。QEMU target 使用 `-nographic`，串口输出进入 evidence。
