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

`vos` 的受控项目命令以 commit 为复现边界。

工作树干净定义为：

```text
git status --porcelain --untracked-files=all
```

输出为空。`.gitignore` 已排除的 build/cache/run artifact 不计入 dirty。

命令边界：

- 除 `login` / `logout` / `whoami` / `help` / `init` /
  `ledger record` 等入口外，所有受控项目命令执行前必须通过 clean tree
  gate 和当前 `HEAD` ledger gate。
- `vos build generate`、`vos build`、`vos verify`、`vos submit pack` 是
  最重要的受控入口；其他 spec/arch/run/test/report/agent 命令也不得绕过
  复现边界。
- `vos submit pack` 只打包当前 `HEAD` commit。
- 写入型 generate 成功后由 VOS 自动创建 commit，并写入
  `.vos/commit-ledger.jsonl`。
- generate 草案没有可提交变更时不得伪造成功 commit；命令应失败并保留
  evidence，提示重新生成或人工记录。

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

VOS 自动 commit 后必须为新 `HEAD` 写入 ledger 记录。ledger 不要求被它记录的
同一个 commit 自包含，因为这会形成 Git hash 自引用；gate 读取当前工作树中的
ledger，并忽略 ledger 文件自身造成的 dirty 状态。
human commit 允许存在，但在下一次受控 VOS 项目命令前必须补齐 ledger 记录，
否则 gate 拒绝。
`vos init` 可为当前 HEAD 初始化 ledger；`vos ledger record --actor human
--intent <text>` 可为人工提交补齐记录。

## 4. `vos report generate`

职责：

- 从 spec、verification evidence、commit ledger 与 Agent 审计链聚合课程报告
- 生成阶段报告或最终报告
- 生成 Agent narrative summary，但不允许 Agent 决定验证事实

输入：

- `spec/verification/report-contract.yaml`
- normalized spec bundle
- run manifest
- `verify public` 生成的 `artifacts/verify/public-summary.json`
- commit ledger
- `.vos/agent-log.jsonl`
- visibility policy

输出：

- `spec/reports/stage-<stage>-report.md`
- `spec/reports/final-synthesis-report.md`
- `.vos/report/stage-<stage>-summary.json`
- `.vos/report/final-summary.json`
- 当前 run manifest 中的 report artifact
- 自动创建的 report commit 与新 `HEAD` ledger 记录

命令形式：

```bash
vos report generate --stage memory
vos report generate --final
```

严格失败条件：

- 缺少 report contract
- 缺少所选 scope 的 ArchitectureSlice / ModuleSpec / OperationContract
- 缺少所选 public requirement 的 verify summary
- Agent narrative 输出不是合法结构化 JSON
- Markdown 渲染后缺少 contract section
- 自动 commit 或 ledger 写入失败

报告不应包含：

- hidden tests 源码
- staff-only rubric
- 私有规则实现细节

Agent narrative 只能消费已过滤的 report summary draft，不能补全缺失 evidence，
不能改写 pass/fail、test status 或 artifact status。

## 5. `vos submit pack`

提交包至少包含：

- `spec/`
- source code
- `tests/public`
- `reports/`
- evidence manifest
- current `HEAD` `commit_sha`
- `.vos/commit-ledger.jsonl`
- `.vos/toolchain.json` 中的可复现编译环境约束

提交包可包含但不强制要求：

- `tests/generated`
- `AICollaborationLog`
- `Spec Patch History`

提交包不得包含 final image、`build/`、`fs.img`、ELF/bin/object/disassembly 等
编译产物。平台/runner 必须使用提交包中的 `commit_sha` checkout，并按
`.vos/toolchain.json` 记录的工具版本约束重新执行 `vos build && vos verify
public` 来复现 image 与验证结果。

提交包生成过程必须：

- 确认工作树干净
- 确认当前 `HEAD` 有 ledger 记录
- 校验内容完整性
- 引用 run manifest
- 引用 validation/evidence refs
- 标记 `image_included: false` 与 `rebuild_required: true`
- 避免打入平台私有内容

`vos submit pack` 不提交未提交文件、未跟踪文件或本地 `.vos/runs/`
内容。服务端应以提交包中的 `commit_sha` 重新 checkout 并复现，不接受学生本地
image 作为裁决输入。

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
