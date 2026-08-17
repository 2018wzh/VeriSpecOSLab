# 助教检查表

## 通用检查（每个 Lab 提交都过一遍）

- [ ] `vos doctor` 的错误给出可操作修复；
- [ ] `vos spec lint all` 报 schema、引用、owns 和 manifest 映射错误；
- [ ] 每个 target 都有 `verifies` 稳定 Spec ID；
- [ ] read-only Agent 角色没有源码或 Spec diff；
- [ ] 实现提交包含 Run-ID、Spec-Hash，且没有越过 owns；
- [ ] 报告、审计链和提交归档不含凭据或本机绝对路径；
- [ ] 提交物包含实际耗时（一个整数小时数）。

## 分 Lab 验收重点

| Lab | 自动检查 | 人工复核重点 |
| --- | --- | --- |
| Lab 1 | `vos doctor`、`vos spec lint design` | 实板报告真实性；CTF 材料未入库；DesignSpec 理由可解释 |
| Lab 2 | `vos build`、`vos run qemu`、`vos verify` | banner 证据非伪造；boot Spec 的 pre/post 完整 |
| Lab 3 | lint/build/verify | 不变量检查器真的会失败（让 TA 注入一个错误观察行为） |
| Lab 4 | lint/build/verify + 压力测试 | IRQ 统计与失败诊断记录；未知 IRQ 有可诊断路径 |
| Lab 5 | lint/build/verify | 上下文切换证据；坏指针返回错误而非 panic；调度公平性测试 |
| Lab 6 | lint/build/verify + 崩溃注入 | 崩溃注入矩阵；重启恢复证据；分配计数回归 |
| Lab 7 | lint/build/verify + shell 演示 | resource+pipe 双骨架；泄漏检查；`dup`/继承语义 |
| Lab 8 | lint/build/verify | 指标是否在结果前确定；负结果是否如实；方差/重复运行 |
| Lab 9 | 硬件证据清单 | 真实板卡人工复核；QEMU/板卡证据分离；`pending_human_review` 边界 |
| Lab 10 | `vos verify`、`vos report`、`vos submit` | 覆盖表追溯链；失败分析质量；遮蔽合规 |
| Final | 提交物完整性 | 答辩表现；报告分层；未完成项诚实性；AI 使用披露 |

## Lab 9 硬件验收专项（需要教师/TA 亲测）

- [ ] 板卡身份（SoC、DTB、固件链）与 DesignSpec 一致；
- [ ] 启动链每阶段有可观察标记（BootROM → SPL → U-Boot → 内核）；
- [ ] UART、定时器/中断、至少一个存储外设各有独立验收证据；
- [ ] QEMU 回归证据与板卡证据分开记账，无混用；
- [ ] 串口日志与镜像/固件构建身份可追溯到 commit 或哈希；
- [ ] 学生能现场复现启动并回答"QEMU 与板卡差异"问题。
