# 评分要点

| 维度 | 核查 |
| --- | --- |
| DesignSpec | 目标、ISA、语言、内核组织、QEMU、board 和组合不变量完整 |
| ModuleSpec | level、purpose、interface、properties、errors、owns 以及按等级要求的状态/并发字段 |
| Boundary | InterfaceSpec 的 syscall/IPC/driver/ABI 语义清晰 |
| Evidence | target 的 `verifies` ID、build/test/run 日志和 clean HEAD 绑定 |
| 工程纪律 | Agent 不越过 owns；失败不落地；报告和提交 hash 可重放 |
