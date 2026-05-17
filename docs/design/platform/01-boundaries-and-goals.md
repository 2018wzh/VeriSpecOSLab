# 01 Boundaries And Goals

回答的问题：

- 平台和现有文档、仓库、服务之间如何划边界
- 哪些是平台公共能力，哪些是 VeriSpecOSLab 特化能力
- 平台的职责与非职责是什么

上游依赖文档：

- [00-overview.md](./00-overview.md)
- [../spec/README.md](../spec/README.md)
- [../toolchain/README.md](../toolchain/README.md)
- [../arch.md](../arch.md)
- [../workflow/README.md](../workflow/README.md)

下游消费者：

- 平台后端设计
- 实验类型适配器设计
- Agent 接入与权限治理
- DevOps 与部署设计

## 1. 平台边界

平台只定义以下真相：

- 课程、实验、项目、阶段、提交流转
- 仓库和工作区的供应流程
- 验证与评测的编排与证据归档
- Agent 的平台级权限、上下文投影和审计
- 教师/助教/学生/管理员的协作流程

平台不定义以下真相：

- 学生仓库中的本地 `spec/` 字段结构
- `vos` 的命令内部执行模型
- Agent Runtime 在单个 workspace 内部如何索引源码和运行工具
- 某类实验的全部私有测试细节

## 2. 与现有文档的边界

### 2.1 `spec/`

`spec/` 负责定义学生项目本地设计真相。平台只能：

- 读取
- 投影
- 派生验证计划
- 绑定评分证据

平台不能重新定义 `ArchitectureSpec`、`ModuleSpec` 或 `GoalValidationContract` 的语义。

### 2.2 `toolchain/`

`toolchain/` 负责定义 `vos` 的消费、执行编排和证据采集真相。平台只能：

- 调用 `vos`
- 提供课程和项目级输入
- 接收结构化输出
- 存储和展示结果

平台不能重新定义 `vos build`、`vos verify` 或 runtime adapter 的内部行为。

### 2.3 `arch.md`

`arch.md` 负责定义 Agent Runtime、DevBox 和 OpenAI-compatible 接入。平台文档只保留：

- Agent Gateway 的平台接口
- 权限矩阵
- 上下文投影规则
- 审计要求

具体 prompt、索引器、workspace tool adapter 仍由 `arch.md` 负责。

### 2.4 `workflow/`

`workflow/` 负责定义课程递进式工作流本身。平台文档只负责回答：

- 平台如何支撑这些工作流
- 工作流涉及哪些状态机和系统事件
- 哪些步骤自动化，哪些步骤人工审核

## 3. 平台公共能力

以下能力应对所有 `SpecLab` 实验通用：

1. 课程与实验管理
2. 学生项目创建与仓库供应
3. 阶段门禁与公开/私有规则投影
4. Pipeline 编排、Evidence 归档与 Result 发布
5. Agent 审计与权限治理
6. 评分、反馈、教学分析

## 4. VeriSpecOSLab 特化能力

以下能力通过实验类型适配器实现：

1. `QEMU` / `KVM` 启动与串口日志采集
2. `ToolchainSpec` 与镜像、boot chain、ISA、machine profile 的绑定
3. OS 特有的 trace、panic、page table、syscall ABI 与 benchmark 采集
4. 硬件移植和兼容性目标的特化验证

## 5. 平台目标

完整平台应同时满足：

```text
课程可运行
  + 平台可扩展
  + 评测可审计
  + Agent 可控
```

更具体地说：

1. 同一平台能承载多个课程、多轮实验、多种实验类型。
2. 同一项目在开发期和评分期使用一致的对象模型与证据模型。
3. 平台可以把公开验证、私有验证、教师人工审核串成统一成绩流。
4. 平台对 AI 使用保留可查询、可复盘、可处罚的审计链路。

## 6. 非目标

平台明确禁止以下设计偏差：

1. 通过 Agent 直接代写完整系统。
2. 让学生通过平台接口直接读取 hidden tests。
3. 允许 Agent 绕过 `spec`、测试、阶段门禁和审计要求。
4. 把实验特化逻辑写死在公共核心模型中。
5. 把课程规则写死到学生仓库。

## 7. 失败模式与约束

需要在平台设计中避免：

- 边界重复定义导致文档冲突
- 平台公共模型被 OS 细节污染
- 平台只能支持单课程单实验
- Pipeline 成功但证据不可复现
- Agent 可以调用未授权工具或读取越权上下文

## 8. 后续扩展点

- 实验类型插件机制
- 教师自定义评分插件
- 外部 LMS / SSO / 代码托管系统集成
