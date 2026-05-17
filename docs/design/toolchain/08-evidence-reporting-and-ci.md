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
- `git commit`
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

## 3. `vos report generate`

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

## 4. `vos submit pack`

提交包至少包含：

- `spec/`
- source code
- `tests/public` + `tests/generated`
- `reports/`
- `AICollaborationLog`
- `Spec Patch History`
- final image
- evidence manifest

提交包生成过程必须：

- 校验内容完整性
- 引用 run manifest
- 避免打入平台私有内容

## 5. 平台 CI 的调用方式

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
    - vos verify public
    - vos verify full
```

## 6. 可见性边界

平台可以执行 `verify full`，但回传给学生的只应是：

- pass / fail / score 摘要
- 允许公开的 diagnostics
- 指向本地 spec 的修复建议

## 相关文档

- [09-roadmap-and-acceptance.md](./09-roadmap-and-acceptance.md)
- [../platform.md](../platform.md)
- [../workflow.md](../workflow.md)
