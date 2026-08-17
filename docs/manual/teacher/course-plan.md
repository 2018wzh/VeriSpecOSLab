# 课程计划

课程按 `DesignSpec → ModuleSpec → InterfaceSpec → implement → verify → submit` 递进。每次实验都使用同一套 `vos` 命令与 evidence 结构；细节见 `docs/manual/labs/`。

## 总览

| 阶段 | 实验 | 建议周期 | 说明 |
| --- | --- | --- | --- |
| 1 | Lab 1：CTF 热身与项目初始化 | 1 周 | 环境、Git、DesignSpec、实板连接 |
| 2 | Lab 2：最小内核启动 | 1 周 | 首个 ModuleSpec + QEMU runner |
| 3 | Lab 3：内存管理 | 1–2 周 | 分配器 + 分页 + 不变量检查器 |
| 4 | Lab 4：中断与设备 | 1 周 | trap 路径、定时器、UART |
| 5 | Lab 5：用户空间 | 2–3 周 | 三个子阶段，工作量最大 |
| 6 | Lab 6：文件系统 | 2 周 | 五模块 + 崩溃一致性 |
| 7 | Lab 7：资源模型与 ABI | 1–2 周 | resource + pipe + shell |
| 8 | Lab 8：个性化目标 | 2 周 | GoalSpec + 可复现实验 |
| 9 | Lab 9：真实硬件移植 | 1–2 周（视板卡） | 硬件验收，需人工复核 |
| 10 | Lab 10：验证方法论 | 1 周 | 覆盖表、故障注入、报告 |
| Final | Final Lab：综合验收 | 1 周 | 报告、演示、答辩 |

合计约 130–170 小时。预计耗时会随学生提交物中的"实际耗时"字段持续校准，请教师在每轮课程结束后更新本表。

## 依赖关系

- Lab 2–4 是串行链（启动 → 内存 → 中断），不建议并行；
- Lab 5 依赖 Lab 4 的定时器；Lab 6 依赖 Lab 5 的 syscall 读写；
- Lab 7 依赖 Lab 6；Lab 8 可选方向的前置阶段见教材第 8 章速查表；
- Lab 9 依赖 Lab 8 完成系统；Lab 10 与 Final 依赖全部前置；
- 发布节奏：每阶段发布"教材 + 实验卡片"一对 PDF，共 22 个。
