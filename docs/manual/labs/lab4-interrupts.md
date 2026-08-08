# Lab 4：中断与陷阱

创建 L3 `kernel/interrupt` 或 `kernel/trap` ModuleSpec，把中断上下文、锁顺序、可重入边界和恢复性质写在同一文件。跨用户/内核边界的 trap frame 另建 `spec/interfaces/trap-frame.yaml`。

```sh
vos agent review interrupt
vos agent implement interrupt
vos verify
```

Agent 只允许修改 owns 集合；调试角色只报告 panic、串口证据和修复方向。
