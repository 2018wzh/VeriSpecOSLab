# Lab 5：用户态与 syscall ABI

模块负责实现，跨边界语义写入 `spec/interfaces/*.yaml`。例如 syscall 接口声明输入、输出、bad pointer 等错误和 ABI 可观察性质；不要为每个操作再建独立 Spec。

```sh
vos agent spec syscall
vos agent implement syscall
vos spec check
vos verify
```

每个 syscall public test 在 `vos.yaml` 绑定 interface Spec ID；用户指针校验、权限恢复和返回值约束必须能从测试 evidence 追溯。
