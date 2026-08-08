# Final Lab：完整学生主链

从一个干净的学生项目完成：

```text
init → design → ModuleSpec → implement → build → verify
     → QEMU/Hardware → report → submit
```

最终检查：

- DesignSpec、每个 ModuleSpec、跨边界 InterfaceSpec、可选 GoalSpec 和 SpecPatch 都通过严格 schema。
- 每个 public/contract target 都有 `verifies` Spec ID，owns 没有路径穿越或越界。
- Agent 读角色没有修改源码；实现提交包含 Run-ID 和 Spec-Hash，失败只留下诊断、diff 和 evidence。
- QEMU 是非图形串口运行，硬件结果为 `pending_human_review`。
- 提交包可用 manifest 中的 commit/spec/config hashes 重放，原始日志不进入 Git。
