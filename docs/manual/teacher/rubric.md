# 评分要点

## 通用评分维度

| 维度 | 核查 |
| --- | --- |
| DesignSpec | 目标、ISA、语言、内核组织、QEMU、board 和组合不变量完整 |
| ModuleSpec | level、purpose、interface、properties、errors、owns 以及按等级要求的状态/并发字段 |
| Boundary | InterfaceSpec 的 syscall/IPC/driver/ABI 语义清晰 |
| Evidence | target 的 `verifies` ID、build/test/run 日志和 clean HEAD 绑定 |
| 工程纪律 | Agent 不越过 owns；失败不落地；报告和提交 hash 可重放 |

## 分 Lab 评分表模板

每个 Lab 的质量门禁清单（`docs/manual/labs/labN.md` 的"质量门禁"一节）即该 Lab 的评分依据。建议权重：

- 质量门禁（自动 + 人工）：70%
- 设计理据（设计理由/答辩问题）：20%
- 挑战/加分（⚡ 挑战、可选方向）：10%

教师可在 Lab 发布时调整权重并在课程渠道公布。评分时逐项对照 Lab 门禁打勾，不打总分印象分。

| Lab | 门禁清单位置 | 建议人工核查重点 |
| --- | --- | --- |
| Lab 1 | lab1-seed.md §7 | 实板报告真实性、DesignSpec 理由、Git 记录可追溯 |
| Lab 2 | lab2-boot.md §5 | boot Spec 契约完整、banner 证据非伪造 |
| Lab 3 | lab3-memory.md §5 | 不变量检查器有效性（注入故障后确实失败） |
| Lab 4 | lab4-interrupts.md §5 | IRQ 统计与失败诊断记录质量 |
| Lab 5 | lab5-user-space.md（质量门禁） | 上下文切换证据、坏指针测试、调度公平性 |
| Lab 6 | lab6-filesystem.md §5 | 崩溃注入矩阵完整性、重启恢复证据 |
| Lab 7 | lab7-resource-abi.md §4 | resource+pipe 双骨架、shell 演示、泄漏检查 |
| Lab 8 | lab8-personal-goal.md §5 | 指标在结果前确定、负结果如实报告 |
| Lab 9 | lab9-hardware-port.md（门禁） | 硬件人工复核、QEMU/板卡证据分离、`pending_human_review` |
| Lab 10 | lab10-verification.md §5 | 覆盖表与 `verifies` 追溯、失败分析质量 |
| Final Lab | final-lab.md §7 | 答辩表现、报告分层、未完成项诚实性 |
