# SpecPatch

当架构或跨模块语义发生变化时，学生手写 `spec/patches/<patch>.yaml`：

```yaml
id: patch-memory-ownership
reason: change page ownership transfer
changes:
  - kernel/memory
  - abi/page-owner
new_invariants:
  - every page has one owner
```

`changes` 引用稳定 Spec ID。VOS 会根据补丁和当前模块 owns 推导影响模块与回归范围；不要求另写一个验证矩阵，也不接受旧的架构阶段文件或隐式兼容入口。跨模块的 `vos agent implement` 必须看到已提交 SpecPatch，单模块实现无需额外补丁。

SpecPatch 是学生设计变更的说明，不是 unified diff。代码 patch 由 Agent 临时 worktree 产生，最终仍由 Git 提交和 VOS 的 owns、HEAD、build/test 门禁控制。
