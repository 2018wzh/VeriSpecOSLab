# Lab 3：内存管理

把页分配器写成 L2 ModuleSpec：`state`、pre/postconditions、invariants 和 dependencies 必须和分配、释放接口放在同一文件。需要锁或中断交互时升级到 L3，并填写 concurrency、rely、guarantee 和 algorithm intent。

```sh
vos agent spec memory
vos agent implement memory
vos verify
```

公开测试至少覆盖对齐、所有权转移和耗尽错误；contract target 必须绑定 `kernel/memory` 的稳定 ID。
