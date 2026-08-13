# Student Runtime v2 Overview

VOS Runtime 把五类 Spec、`vos.yaml` 和 Git HEAD 连接成一条可回放的学生主链。它不为学生选择架构，不把模型回答当作测试，也不把 linked worktree 描述成安全沙箱。

```text
手写 Spec → deterministic lint → advisory review → Agent implementation
         → structured argv Runner → build/public/contract/fuzz/trace evidence
         → explicit hidden verification → report → submit archive
```

Runner 只有 `build`、`run`、`collectEvidence` 三个操作，提供 Host、QEMU 和 Hardware 实现。QEMU 采集非图形串口；Hardware 结果固定为 `pending_human_review`。脏树开发运行允许但不可提交，verify/submit/Agent commit 要求 clean HEAD。

学生 CLI 只暴露 init、doctor、spec lint、agent config/ask/review/implement/debug/verify、命令式 KB 管理、build、QEMU、hardware、verify、report 和 submit；在线教学命令统一位于 `vos portal`，包括 login、whoami、logout、bind、run、status、evidence 和 submit。Portal/Demo 不是离线命令的隐式依赖，Portal 的 connected 测评由显式命令触发，Demo 不产生权威证据。
