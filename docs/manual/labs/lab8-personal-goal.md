# Lab 8：可选高级目标

性能、兼容性或形式化方向使用 `spec/goals/<goal>.yaml`。GoalSpec 只写 objective、metric/oracle 和 correctness；实现范围仍由 ModuleSpec owns 控制。

```sh
vos agent review
vos spec check
vos verify
```

目标不能改变 `verify` 的确定性边界；fuzz、trace、oracle 和 hidden tests 属于未来 Judge，不在学生 CLI 中出现。
