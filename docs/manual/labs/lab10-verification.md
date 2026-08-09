# Lab 10：验证方法论——从测试结果到可追溯证据

> 对应教材：[第 10 章：验证](../book/ch10-verification.md)

本 Lab 恢复不变量清单、跨模块检查、故障注入、失败分析和证据组织。`vos verify` 是确定性执行器，不替学生完成验证设计。

## 1. 建立覆盖清单

从所有 DesignSpec、ModuleSpec、InterfaceSpec 和 GoalSpec 的稳定 ID 出发，列出对应 public/contract targets。每个 target 在 `vos.yaml` 中声明 `verifies`；反向检查每个必须验证的 Spec ID 至少有一条有效证据。

覆盖不是简单计数。同一条启动 smoke test 不能同时证明内存唯一所有权、syscall 指针安全和文件系统崩溃恢复。

建议维护以下审计列：

| Spec ID | 性质/错误 | target | 证据类型 | clean HEAD | 最近结果 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| `kernel/memory` | unique ownership | allocator_contract | contract | yes | pass | none |

一条 target 可以验证多个紧密相关 ID，但必须解释共同输入与 oracle；一个 ID 也可以由多条证据共同覆盖。

## 2. 不变量与故障注入

每个核心模块至少选择一条关键不变量，优先使用前面 Lab 已实现的检查器：

- memory：唯一所有权、保留区、计数一致；
- interrupt：trap frame 对称、IRQ 生命周期；
- process：状态转换、单 CPU 运行；
- filesystem：块/inode 分配、事务恢复；
- resource：引用计数、退出回收；
- composition：用户指针验证后才能访问内核资源。

对每条检查器至少注入一次它应发现的故障。记录注入点、预期失败、实际错误、修复和回归，证明检查器不是永远返回成功的装饰。

检查器触发时机分三类：操作内快速断言、测试阶段完整扫描、跨模块验收检查。三者成本不同，不能用低频完整扫描代替关键状态转换上的 fail-fast 检查。

失败分析统一记录：

```text
现象 → 首次证据 → 被排除的假设 → 根因
→ 修复的契约/代码 → 定向回归 → 全部公开门禁
```

保留原始失败日志及其 hash；分析可以补充，不能覆盖原记录。

## 3. 确定性验证工作流

```sh
git status --short
vos verify
vos report
vos submit
```

`vos verify` 在 clean HEAD 上依次执行 spec check、build、全部 public tests 和 contract checks；不调用模型，也不运行 fuzz、trace 或 hidden tests。`vos report` 从 commits、Spec IDs、测试、日志和 evidence 生成 `.vos` 内报告。`vos submit` 刷新报告并创建绑定 commit/spec/config hashes 的归档。

## 4. 证据质量

一份可提交 evidence 至少包含：运行 ID、commit、Spec/config hash、target、结构化 argv、退出状态、开始/结束时间、产物 hash 和受限日志。脏树 build/QEMU/hardware 证据必须标为不可提交。

导出时遮蔽凭据，把绝对路径替换为稳定别名。原始 `.vos/audit` 不进 Git；submit 包含经过出口扫描的明文日志。硬件证据保持 `pending_human_review`。

证据包按运行而不是按截图组织。截图只能作为辅助展示，不能替代结构化退出码、完整串口日志和产物 hash。超时、panic 和主动中止必须是不同终态。

## 5. 验证门禁

- [ ] `vos spec check`、build、全部 public/contract targets 通过。
- [ ] 必须验证的稳定 Spec ID 没有覆盖缺口。
- [ ] 每个核心模块至少有一条可运行不变量检查。
- [ ] 至少一条组合不变量跨越三个模块或边界。
- [ ] 每个检查器至少有一次有效故障注入证据。
- [ ] 至少记录一个完整失败案例：现象、证据、根因、修复、回归。
- [ ] report/submit 可在同一 commit 上重放并得到相同 manifest hashes。
- [ ] 出口扫描没有凭据、本机绝对路径或未遮蔽 flag。

## 6. AI 使用边界

`vos agent verify` 和 `vos agent review` 只读，可以指出覆盖缺口或证据矛盾；权威 `vos verify/report/submit` 不调用模型。不能让 Agent 改写失败日志、补造硬件验收或用 Fixture 代替真实运行。

## 7. 提交物

- Spec ID—target 覆盖表；
- 不变量与故障注入矩阵；
- clean HEAD 的 verify evidence；
- 一份失败分析；
- 确定性报告与可复现提交归档；
- 硬件人工审查待办（如适用）。

## 8. 常见错误

- target 通过但没有 `verifies`：执行成功，追溯链仍不完整。
- 日志含本机路径或 token：原始审计可本地保留，导出必须失败并指出字段。
- 修改测试后沿用旧 evidence：配置或 Spec hash 已变，必须重新验证。
