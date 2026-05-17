# 08 FAQ Failure Modes And Acceptance

回答的问题：

- workflow 文档集最容易出现哪些理解偏差
- 如何判断文档拆分后仍然一致、可读、可执行
- 课程实施时有哪些常见失败模式

上游依赖文档：

- [README.md](./README.md)
- [02-stage-model-and-lifecycle.md](./02-stage-model-and-lifecycle.md)
- [07-end-to-end-teaching-simulation.md](./07-end-to-end-teaching-simulation.md)

下游消费者：

- 文档维护者
- 课程实施团队
- 平台验收与走查

## 1. FAQ

### 1.1 为什么 `workflow` 要单独拆成目录

因为单文件难以同时承载：

- 课程总闭环
- 三类角色主线
- Agent 边界
- 全流程教学模拟

目录化后可以把“总览、角色、阶段、模拟、验收”分层表达，并与 `platform/`、`toolchain/` 保持一致风格。

### 1.2 `workflow/` 和 `platform/` 的区别是什么

- `workflow/` 负责课程过程与角色协作。
- `platform/` 负责平台实现、状态机、接口和服务职责。

### 1.3 `workflow/` 和 `toolchain/` 的区别是什么

- `workflow/` 说明课程里何时验证、谁看结果、如何进入下一阶段。
- `toolchain/` 说明 `vos` 如何执行验证并采集证据。

### 1.4 助教为什么要独立成文

因为助教在真实教学里承担审核队列、补跑、异常归因和申诉处理，不能只散落在教师或平台文档中。

## 2. 常见失败模式

- 角色边界写乱：把教师裁决、助教补跑、学生执行混写成同一动作。
- 文档边界写乱：在 `workflow/` 中重复定义平台 API 或 `vos` 内部行为。
- 可见性写乱：把 hidden 细节错误地暴露给学生或学生 Agent。
- 阶段模板不统一：某些阶段缺失输入、证据或失败分支。
- 模拟只写学生流水账：没有体现教师、助教、平台、Agent 的交接。

## 3. 一致性约束

维护 `workflow/` 时必须保持：

1. 角色集合固定为教师、助教、学生、平台、Agent。
2. 阶段模板固定包含目标、输入、检查、角色动作、证据、失败分支、解锁条件。
3. `workflow/` 中的角色、证据、权限表述必须与 `platform/08`、`platform/09`、`platform/10` 一致。
4. 旧入口 [../workflow.md](../workflow.md) 只做索引，不再写正文。

## 4. 验收标准

文档重构完成后，至少满足：

- 目录结构与 `platform/`、`toolchain/` 的编号风格一致。
- 从 `README -> overview -> 角色文档 -> 模拟文档` 能连续读通。
- 教师、助教、学生三类角色都拥有独立主线文档。
- 全流程模拟覆盖从建课到复盘的完整闭环。
- 任一阶段都能回答谁做决定、谁执行检查、谁看到结果、谁处理异常。
- 所有旧链接要么被更新，要么保留兼容入口。
