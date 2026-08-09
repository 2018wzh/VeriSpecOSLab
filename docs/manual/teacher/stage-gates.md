# 门禁

1. 学生手写的 DesignSpec 通过 `vos spec lint design`，并有只读 Agent review 记录。
2. ModuleSpec 已提交且 Agent implement 前工作树 clean。
3. `vos verify` 通过全部 public/contract targets。
4. QEMU evidence 为串口模式；硬件 evidence 为 `pending_human_review`。
5. `vos report` 和 `vos submit` 绑定当前 commit、Spec hash 和 manifest hash。
