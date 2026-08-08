# Student Runtime v2 Overview

VOS Runtime 把五类 Spec、`vos.yaml` 和 Git HEAD 连接成一条可回放的学生主链。它不为学生选择架构，不把模型回答当作测试，也不把 linked worktree 描述成安全沙箱。

```text
Spec → Agent proposal/implementation → structured argv Runner
     → build/public/contract evidence → report → submit archive
```

Runner 只有 `build`、`run`、`collectEvidence` 三个操作，提供 Host、QEMU 和 Hardware 实现。QEMU 采集非图形串口；Hardware 结果固定为 `pending_human_review`。脏树开发运行允许但不可提交，verify/submit/Agent commit 要求 clean HEAD。

学生 CLI 只暴露 init、doctor、spec check、七个 agent role、build、QEMU、hardware、verify、report 和 submit。Portal/Demo 与暂留的 HTTP 服务属于冻结内部边界，不是学生主链。
