# 08 Evidence Reporting And CI

回答的问题：

- `vos` 每次运行要归档什么 evidence
- `report generate` 和 `submit pack` 依赖哪些数据
- 平台 CI 如何只通过 `vos` 工作，而不维护旁路脚本

上游依赖文档：

- [04-data-model.md](./04-data-model.md)
- [06-adapters-and-command-model.md](./06-adapters-and-command-model.md)
- [07-agent-gateway.md](./07-agent-gateway.md)

下游消费者：

- `vos-evidence`
- `report generate`
- `submit pack`
- 平台 CI / OJ

## 1. Evidence 基本要求

每次命令执行都应记录：

- `command`
- `arguments`
- `commit_sha`
- `parent_sha`
- clean tree gate status
- `.vos/commit-ledger.jsonl` entry ref
- `spec hash`
- `input files`
- `output files`
- `tests run`
- `pass/fail`
- `logs`
- `artifacts`
- `agent session id`
- `cloud projection version`

## 2. Artifact 归档规则

推荐目录：

```text
.vos/runs/<run-id>/
  manifest.json
  events.jsonl
  artifacts/
    build/
    run/
    tests/
    verify/
    traces/
    agent/
```

归档原则：

- 每个 run 独立目录
- `manifest.json` 是唯一总索引
- 文本日志与二进制产物分目录存放
- debug / trace 输出必须能回链到原始命令与 spec hash
- `.vos/runs/` 可以作为本地 ignored artifact，不作为服务端复现输入
- 复现所需 metadata 必须进入 tracked commit ledger 或 commit trailer

## 3. Commit-Bound Reproducibility

`vos` 的生成、构建和提交命令以 commit 为复现边界。

工作树干净定义为：

```text
git status --porcelain --untracked-files=all
```

输出为空。`.gitignore` 已排除的 build/cache/run artifact 不计入 dirty。

命令边界：

- `vos build generate` 执行前必须通过 clean tree gate。
- `vos build` 执行前必须通过 clean tree gate，确保构建结果可由当前
  `HEAD` 复现。
- `vos submit pack` 执行前必须通过 clean tree gate，并且只打包当前
  `HEAD` commit。
- 写入型 generate 成功后由 VOS 自动创建 commit。
- generate 无变更时不创建 commit，但必须记录 no-op run。

推荐 tracked ledger：

```text
.vos/commit-ledger.jsonl
```

每条记录至少包含：

```yaml
commit_sha:
parent_sha:
actor: agent | human
agent_identity_id:
capability_pack_id:
run_id:
spec_refs:
changed_targets:
evidence_refs:
created_at:
collaboration_intent:
based_on_agent_output:
```

VOS 自动 commit 时必须先写入 ledger，再将 ledger 变更纳入同一 commit。
human commit 允许存在，但在下一次 `vos build generate`、`vos build` 或
`vos submit pack` 前必须补齐 ledger 记录，否则 gate 拒绝。

## 4. `vos report generate`

职责：

- 从 evidence 聚合学生可见报告

输入：

- run manifest
- verify 结果
- test summary
- diagnostics

输出：

- Markdown 报告
- 可选 JSON 摘要

报告不应包含：

- hidden tests 源码
- staff-only rubric
- 私有规则实现细节

## 5. `vos submit pack`

提交包至少包含：

- `spec/`
- source code
- `tests/public` + `tests/generated`
- `reports/`
- `AICollaborationLog`
- `Spec Patch History`
- final image
- evidence manifest
- current `HEAD` `commit_sha`
- `.vos/commit-ledger.jsonl`

提交包生成过程必须：

- 确认工作树干净
- 确认当前 `HEAD` 有 ledger 记录
- 校验内容完整性
- 引用 run manifest
- 引用 validation/evidence refs
- 避免打入平台私有内容

`vos submit pack` 不提交未提交文件、未跟踪文件或本地 `.vos/runs/`
内容。服务端应以提交包中的 `commit_sha` 重新 checkout 并复现。

## 6. 平台 CI 的调用方式

平台 CI/CD 直接调用 `vos`，而不是维护另一套脚本。

```yaml
stages:
  - static-check
  - build
  - unit-test
  - boot-test
  - verification
  - report
```

示例：

```yaml
static-check:
  script:
    - vos spec lint spec/modules --recursive
    - vos arch lint spec/architecture/seed.yaml

verification:
  script:
    - vos build generate
    - vos build
    - vos verify public
    - vos verify full
```

CI 入口必须从提交的 `commit_sha` checkout，并在运行 `vos build
generate`、`vos build`、`vos verify` 前验证 ledger 与 commit diff 一致。
缺少 ledger 或 ledger/diff 不匹配时标记为 `policy_blocked` 或
`reproducibility_error`。

## 7. 可见性边界

平台可以执行 `verify full`，但回传给学生的只应是：

- pass / fail / score 摘要
- 允许公开的 diagnostics
- 指向本地 spec 的修复建议

## 相关文档

- [09-roadmap-and-acceptance.md](./09-roadmap-and-acceptance.md)
- [../platform/README.md](../platform/README.md)
- [../workflow/README.md](../workflow/README.md)
