# 报告字段

`vos report` 自动生成：

- 当前 commit、parent、Spec hash 和 `vos.yaml` config hash；
- Design/Module/Interface/Goal/SpecPatch 稳定 ID；
- public/contract target、测试结果、QEMU/硬件 evidence 和 audit 引用；
- clean HEAD、硬件 `pending_human_review` 和可提交性。

报告不调用模型，也不进入 Git。
