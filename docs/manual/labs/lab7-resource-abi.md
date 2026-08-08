# Lab 7：资源 ABI

资源句柄、生命周期和错误码是跨模块开发 ABI，写入 `spec/interfaces/resource.yaml`；实现模块的所有权和状态仍写在对应 ModuleSpec。语义变化用手写 SpecPatch，VOS 根据 changes 推导影响模块与回归范围。

```sh
vos agent review resource
vos agent implement resource
vos verify
```

提交前检查 owns 越界、SpecPatch commit 绑定和 public/contract target 的 Spec ID 覆盖。
