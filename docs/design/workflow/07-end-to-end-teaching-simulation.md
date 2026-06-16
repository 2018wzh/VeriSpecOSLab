# 07 End To End Teaching Simulation

回答的问题：

- 一门 VeriSpecOSLab 课程如何从建课跑到复盘
- 教师、助教、学生、平台、Agent 在每个阶段如何交接
- 哪些证据在不同阶段被生产、消费和发布

上游依赖文档：

- [03-teacher-workflow.md](./03-teacher-workflow.md)
- [04-ta-workflow.md](./04-ta-workflow.md)
- [05-student-workflow.md](./05-student-workflow.md)
- [06-agent-and-ai-boundaries.md](./06-agent-and-ai-boundaries.md)

下游消费者：

- 课程讲授演示
- 教学实施排练
- 平台流程验收

## 1. 课程开场：建课与发布

- 触发条件：新学期开课，教师需要发布一轮 VeriSpecOSLab 实验。
- 教师动作：创建课程，绑定模板仓库，配置 `stage-gates`、公开/隐藏验证、评分规则和 AI Policy。
- 助教动作：检查模板仓库是否可用，确认审核队列、补跑权限和 FAQ 口径。
- 学生动作：无。
- 平台/Agent 自动动作：生成规则版本，生成 `student-public` / `agent-public` / `staff-full` 投影。
- 可见证据：课程版本快照、实验配置摘要、初始阶段公开规则。
- 下一阶段入口：实验发布，允许学生入组。

## 2. Week 1: 入组与 ArchitectureSeed

- 触发条件：学生加入课程实验。
- 教师动作：说明课程边界，强调先设计后实现的要求。
- 助教动作：确认仓库、工作区、Agent Workspace 创建成功，收集初始化异常。
- 学生动作：拉取仓库，阅读公开规则，编写 `spec/architecture/seed.yaml`。
- 平台/Agent 自动动作：平台供应仓库与 `spec/` 骨架；DesignAgent 审查 `ArchitectureSeed` 草稿。
- 可见证据：`seed.yaml`、公开门禁摘要、DesignAgent 报告、初始化日志。
- 下一阶段入口：`architecture-seed` 通过人工审核后解锁 `boot-minimum`。

## 3. Week 2: Boot Minimum

- 触发条件：`architecture-seed` 已通过。
- 教师动作：只在目标过大或 boot 路线不清时介入。
- 助教动作：审核 boot slice 是否齐全，解释公开失败如 `serial_banner_check` 未通过。
- 学生动作：提交 `01-boot.yaml`、boot `ModuleSpec`、最小启动实现并运行公开验证。
- 平台/Agent 自动动作：执行 `qemu_boot_smoke`、采集串口日志、生成 public summary。
- 可见证据：boot slice、QEMU log、串口 banner、public summary。
- 下一阶段入口：boot 公开验证与必要人工审核通过后解锁 `memory-management`。

## 4. Week 3: Memory Management 与一次自动检查失败

- 触发条件：boot 阶段通过。
- 教师动作：仅在设计不变量自相矛盾时介入。
- 助教动作：处理 `page_allocator_tests_passed` 失败，判断为学生实现错误而非 infra 问题，并返回公开修复方向。
- 学生动作：补充 `02-memory.yaml`、`page_allocator.yaml`，修复 `double_free` 或越界问题，再次提交。
- 平台/Agent 自动动作：SpecAgent 检查内存不变量；VerificationAgent 运行 allocator tests。
- 可见证据：memory slice、ModuleSpec、allocator tests、public diagnostics、AI 协作记录。
- 下一阶段入口：memory 阶段通过后解锁 `trap-privilege`。

## 5. Week 4: Trap / Privilege

- 触发条件：memory 阶段通过。
- 教师动作：重点看用户指针策略、trap frame 和权限边界。
- 助教动作：核对 invalid pointer 相关公开用例是否与 Slice 叙述一致。
- 学生动作：提交 `03-trap-privilege.yaml`，明确 `copy_from_user` 等策略并实现 trap 路径。
- 平台/Agent 自动动作：DesignAgent 比较历史设计变化；DebugAgent 解释 trap 日志。
- 可见证据：trap slice、invalid pointer tests、trap logs、设计审查摘要。
- 下一阶段入口：trap 阶段通过后解锁 `execution`。

## 6. Week 5: Execution 与一次基础设施异常补跑

- 触发条件：trap 阶段通过。
- 教师动作：无日常介入。
- 助教动作：发现调度测试失败伴随 runner artifact 丢失，判断为 infra failure，触发补跑并保留原始 run。
- 学生动作：提交调度 Slice 和实现，等待补跑结果；若补跑后仍失败再修代码。
- 平台/Agent 自动动作：记录补跑原因，生成新的 run 与证据链接。
- 可见证据：scheduler spec、原始失败 run、补跑 run、助教处理记录。
- 下一阶段入口：execution 通过后解锁 `syscall-ipc`。

## 7. Week 6-7: Syscall / Resource

- 触发条件：execution 阶段通过。
- 教师动作：关注 ABI、错误语义、资源生命周期是否具体。
- 助教动作：批量审核 `write/exit`、fd table、refcount 相关公开失败。
- 学生动作：先完成 `syscall-basic`，再完成 `resource` 相关 Slice、ModuleSpec、实现和测试。
- 平台/Agent 自动动作：VerificationAgent 运行 syscall trace、composition tests；ReviewAgent 检查是否存在删除测试风险。
- 可见证据：syscall trace、resource tests、composition 报告、风险标签。
- 下一阶段入口：资源模型稳定后解锁个性化机制或 namespace 阶段。

## 8. Week 8: Personalized Goal 与 commit-backed SpecPatch 引入新机制

- 触发条件：学生希望引入 `capability IPC` 或其他个性化机制。
- 教师动作：审核 `SpecPatch` 是否说明引入原因、设计变化、非目标和绑定 commit。
- 助教动作：检查 patch 历史和 commit SHA，确认学生先改 Spec 再改代码。
- 学生动作：更新 `spec/evolution/patch-*.yaml`、ADR、CompositionSpec，形成可引用 spec commit 后实现新机制。
- 平台/Agent 自动动作：平台重派生验证矩阵；Agent 提醒新增资源生命周期或权限边界风险。
- 可见证据：SpecPatch、绑定 commit、ADR、派生测试矩阵摘要、goal contract、benchmark 或新测试结果。
- 下一阶段入口：个性化目标通过后解锁 `resource-and-namespace` 或 `final-synthesis`。

## 9. Week 9: Namespace / Service

- 触发条件：资源或个性化阶段通过。
- 教师动作：关注 namespace、VFS 或 service 模型是否和资源模型一致。
- 助教动作：排查公开 `namespace tests`、service 初始化失败和错误传播问题。
- 学生动作：提交 namespace/service Slice、实现命名空间或服务抽象、补充报告。
- 平台/Agent 自动动作：执行 namespace tests、service tests 和组合验证。
- 可见证据：namespace slice、service tests、组合验证摘要。
- 下一阶段入口：所有阶段性机制完成后进入 `final-synthesis`。

## 10. Week 10: Final Synthesis、冻结与评分

- 触发条件：学生完成阶段性机制并提交最终综合材料。
- 教师动作：在高风险项目上做人工审核或 override；冻结最终提交；确认成绩发布。
- 助教动作：整理申诉前置材料，检查 evidence map 是否完整。
- 学生动作：提交 `final-synthesis.yaml`、verification report、AI collaboration log、final report。
- 平台/Agent 自动动作：运行公开、隐藏、组合和个性化目标验证；汇总 grading evidence map；ReportAgent 辅助整理最终报告。
- 可见证据：final-synthesis、timeline、report、score summary、staff evidence map。
- 下一阶段入口：成绩发布并进入申诉窗口。

## 11. Week 11: 申诉与课程复盘

- 触发条件：成绩已发布，申诉窗口开启。
- 教师动作：裁决申诉，复盘阶段门禁与评分策略。
- 助教动作：收集 run、日志、审核记录和学生补充说明。
- 学生动作：如有需要提交申诉说明。
- 平台/Agent 自动动作：聚合 analytics，生成高风险项目和失败模式摘要。
- 可见证据：申诉材料、override 记录、课程 analytics、失败热区统计。
- 下一阶段入口：关闭申诉窗口，输出课程复盘结论。
