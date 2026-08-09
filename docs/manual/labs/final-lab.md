# Final Lab：综合验收与答辩

> **对应教材**：[第 11 章：综合验收](../book/ch11-comprehensive-assessment.md)

> **本 Lab 概览**
>
> - **学完能做什么**：把十个 Lab 的成果整合为一份可追溯的最终交付：报告、Spec 与实现、验证证据、答辩材料，并通过课程公布的自动门禁与人工审查。
> - **预计耗时**：8–12 小时，建议安排 1 周。报告与证据整理约占一半，长时间运行、演示准备与答辩演练占另一半。
> - **前置依赖**：已完成 Lab 1–10，`vos verify` 在 clean HEAD 上通过。
> - **产出物**：最终报告、全部 Spec 与源码、验证证据包、可复现归档、答辩材料。

Final Lab 不是重复执行一遍命令。它审查从设计、实现、验证到演示的完整追溯链，并要求学生解释失败与取舍。

## 1. 最终学生主链

```text
空目录初始化 → DesignSpec → ModuleSpec/InterfaceSpec → Agent 实现
→ build/public/contract gates → QEMU/硬件 → report → submit
```

这条链的每一环都要能在答辩时讲清楚：为什么这么设计、证据在哪、失败如何定位。

## 2. 提交物

### 2.1 最终报告

报告至少包含：系统目标与 non-goals、架构图、各模块职责、关键 ABI、1～3 条组合不变量、个性化目标结果、硬件状态、已知限制和复现步骤。报告必须区分自动验证、QEMU 运行、真实硬件运行与人工验收。

推荐正文结构：

1. 系统目标、范围与可运行演示；
2. 从启动到用户空间的架构与数据流；
3. 内存、中断、进程、文件系统和资源模型；
4. 关键 ABI 与跨模块不变量；
5. 个性化目标的基线、方法、结果和负面取舍；
6. QEMU 与硬件证据边界；
7. 失败案例、已知限制和下一步。

### 2.2 Spec 与实现

- 唯一 DesignSpec；
- 每个实现模块的 L1/L2/L3 ModuleSpec；
- syscall、IPC、驱动或用户/内核 ABI 的 InterfaceSpec；
- 可选 GoalSpec；
- 所有真实跨模块语义变化对应的手写 SpecPatch；
- 与当前 HEAD 一致的源码、测试和结构化 `vos.yaml`。

### 2.3 验证证据

提交 Lab 10 的覆盖表、不变量/故障注入矩阵、clean HEAD verify、QEMU 串口日志、可复现归档和硬件 `pending_human_review` 记录。原始协作日志不进入 Git，但经遮蔽和路径别名化后进入 submit 包。

### 2.4 答辩材料

准备一张架构图、一次可重复演示和两个失败案例。每个案例说明现象、证据、根因、修复以及为何回归足以覆盖该根因。

答辩时应能现场回答：某个用户指针如何经过 ABI、页表和资源检查；一次中断如何保存/恢复进程；一次文件写入如何在崩溃后保持一致；一个模块越界变更为何需要 SpecPatch。

## 3. 自动门禁

```sh
vos doctor
vos spec check
vos verify
vos report
vos submit
```

- [ ] 工作树 clean，HEAD 与 evidence ledger 一致。
- [ ] 所有 Spec 通过严格 schema，稳定 ID 无重复或悬空引用。
- [ ] 每个 public/contract target 声明准确的 `verifies`。
- [ ] Agent 提交未越过目标模块与已提交 SpecPatch 的 `owns` 并集。
- [ ] QEMU 使用可采集的非图形串口配置。
- [ ] submit 归档绑定 commit/spec/config hashes，可重放 manifest。
- [ ] 凭据、本机绝对路径和私密 flag 未出现在导出物中。

## 4. 人工审查

- [ ] 能解释系统最重要的三个取舍及被拒绝方案。
- [ ] 能从一个 Spec ID 追溯到实现、测试、日志和提交。
- [ ] 能说明 linked worktree 为什么不是进程或凭据安全边界。
- [ ] 能区分"本地启动""公开测试通过"和"硬件人工验收通过"。
- [ ] 能现场解释一个不变量检查器如何发现真实或注入故障。
- [ ] 能说明个性化目标的 baseline、统计方法和负面结果。

## 5. 长时间运行与演示

课程可以要求固定时长的 QEMU soak 或 workload，但时长、负载、资源上限和成功条件必须在提交前公布。只说"运行十分钟没有崩溃"不能证明没有泄漏；应同时采集页、对象、进程或 buffer 计数。

硬件演示由教师确认板卡、镜像身份、串口和 workload。VOS 只记录候选 evidence，不自动替代人工签字。

## 6. AI 使用边界

Agent 可以审查材料、指出追溯缺口和帮助复现失败。学生必须亲自完成答辩、取舍说明和失败反思。不得用模型生成未发生的实验、篡改日志或把只读 review 当成权威 verify。

## 7. 最终自检

- [ ] DesignSpec 的目标和 non-goals 与最终系统一致。
- [ ] 至少五个核心模块有可运行不变量检查。
- [ ] 至少一条组合不变量有跨模块证据。
- [ ] 至少两个失败案例保留了根因与回归链。
- [ ] 所有文档中的命令、路径和 Spec 类型都属于当前学生契约。
- [ ] 最终报告明确列出未完成项，不以 Fixture 或计划代替证据。

## 8. 背景阅读

- [Book 第 11 章：综合验收](../book/ch11-comprehensive-assessment.md)：报告结构与验收标准。
- [Book 第 10 章：验证](../book/ch10-verification.md)：验证密度要求与证据组织。
- [vos 命令参考](../appendices/vos-commands.md)：`doctor`、`verify`、`report`、`submit` 的公开用法。
