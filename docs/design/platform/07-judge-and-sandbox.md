# 07 Judge And Sandbox

回答的问题：

- Judge 与 Pipeline 的职责边界是什么
- 标准评分型评测如何建模
- Runner 隔离、安全限制和 VeriSpecOSLab 评测流程是什么

上游依赖文档：

- [06-pipeline-and-verification-orchestration.md](./06-pipeline-and-verification-orchestration.md)
- [11-deployment-security-and-operations.md](./11-deployment-security-and-operations.md)

下游消费者：

- Judge Controller
- Runner Pool
- Security / DevOps
- 评分看板

## 1. Pipeline 与 Judge 的边界

Pipeline 偏向开发反馈：

- 高频触发
- 面向当前分支或当前阶段
- 生成公开失败摘要

Judge 偏向标准评分：

- 面向冻结提交
- 使用稳定规则快照
- 输出可发布或可复核的成绩结果

## 2. JudgeTask 模型

标准任务类型：

```text
BuildJudge
BootJudge
FunctionalJudge
ABIJudge
FuzzJudge
FormalJudge
PerformanceJudge
SecurityJudge
DocumentationJudge
```

每个任务输入必须包含：

- `judge_submission_id`
- `project_id`
- `frozen_commit_sha`，作为 Judge 唯一复现输入
- 实验类型
- 规则快照
- 可见性级别

Judge 不接受未提交文件、未跟踪文件、本地工作区快照或本地 `.vos/runs/`
作为评分输入。

每个任务输出必须包含：

- `status`
- `score_delta`
- `evidence_refs`
- `public_message`
- `staff_notes`

## 3. 关键接口

```http
POST /api/projects/{projectId}/judge/submit
GET  /api/judge/submissions/{judgeSubmissionId}
GET  /api/judge/results/{judgeResultId}
POST /api/judge/submissions/{judgeSubmissionId}/invalidate
POST /api/judge/results/{judgeResultId}/publish
```

权限要求：

- 学生只能发起被允许的阶段性提交
- 教师/助教可发起最终评测和结果发布

## 4. 沙箱模型

推荐隔离层级：

```text
Judge Controller
  -> isolated worker
  -> VM / MicroVM
  -> container
  -> tool runtime
  -> student program / student OS
```

安全控制至少包括：

- CPU / memory / disk / time quota
- 只读输入挂载
- 网络默认禁用
- seccomp / namespace / cgroup
- 每次任务使用干净镜像

## 5. VeriSpecOSLab 评测流程

```text
fetch frozen repo
  -> checkout frozen_commit_sha
  -> verify commit ledger
  -> run vos build generate
  -> run vos build
  -> build kernel / userland / image from manifest
  -> launch QEMU
  -> capture serial markers
  -> run functional suites
  -> run selected hidden suites
  -> collect image/log/trace evidence
  -> compute score
```

### 5.1 串口标记协议

至少要求支持：

```text
[SPECLAB] kernel_init
[SPECLAB] memory_ready
[SPECLAB] scheduler_ready
[SPECLAB] userland_start
[SPECLAB] test_pass:<case>
```

Judge 使用这些标记来辅助识别执行阶段，但不能只依赖标记判断正确性。

### 5.2 镜像与运行输入

Judge 输入至少需要：

- `frozen_commit_sha`
- `.vos/commit-ledger.jsonl` 中对应记录
- generated toolchain manifest
- kernel image
- rootfs / initramfs
- machine / ISA profile
- boot chain profile
- timeout 与 success oracle

## 6. 成绩计算

JudgeController 将 `suite_results` 映射到 `EvaluationRubric`：

```text
suite result
  -> score contribution
  -> penalty / bonus
  -> publication policy
```

没有完成全部 suite 也可发布 `provisional` 结果，但不能发布 `final`。

## 7. 失败模式与约束

- 评测失败必须区分学生实现错误和基础设施错误。
- 最终成绩不能依赖丢失的 artifact。
- 评测环境版本必须写入证据。
- staff-only 说明不得进入学生可见结果。
- 如果 commit 缺少 ledger 记录，或 ledger 与 commit diff 不匹配，结果必须
  标记为 `reproducibility_error`。
- 如果提交策略被绕过，例如提交包不是当前 `HEAD` 或工作树 dirty，则标记为
  `policy_blocked`。

## 8. 后续扩展点

- 实物板卡评测
- 分布式 Judge 池
- 可插拔实验类型任务模板
