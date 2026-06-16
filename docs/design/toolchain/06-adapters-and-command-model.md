# 06 Adapters And Command Model

回答的问题：

- 每条核心 `vos` 命令如何映射到内部 adapter
- 一次命令的前置解析、执行链、输出 JSON 与 evidence 产物分别是什么
- 哪些命令只消费本地数据，哪些命令需要云端约束投影

上游依赖文档：

- [03-runtime-modules.md](./03-runtime-modules.md)
- [04-data-model.md](./04-data-model.md)
- [05-runtime-and-concurrency.md](./05-runtime-and-concurrency.md)

下游消费者：

- `vos-cli`
- `vos-runtime`
- `vos-adapter`
- `vos-agent`

## 1. 通用命令约定

所有命令都应支持：

```bash
--project-root <dir>
--json
--report <path>
--evidence-dir <dir>
--agent-session <id>
```

所有命令都至少输出：

- `ok`
- `run_id`
- `command`
- `status`
- `artifacts`

## 2. Spec 命令

### `vos spec lint`

输入：

- spec 路径

前置解析：

- 加载目标 spec 与相关依赖

内部执行链：

```text
parse -> schema validate -> semantic validate -> diagnostics
```

输出 JSON：

- lint errors
- warning 列表
- spec hash

evidence：

- lint report
- normalized preview

### `vos spec normalize`

内部执行链：

```text
load spec set -> normalize -> write cache/normalized
```

主要输出：

- `NormalizedSpecBundle`

### `vos spec check-consistency`

内部执行链：

```text
load normalized bundle -> cross-spec consistency -> emit report
```

### `vos spec patch lint`

内部执行链：

```text
load SpecPatch YAML or commit-ish
  -> parse SpecPatch metadata and commit trailers
  -> read git diff when a commit ref is supplied
  -> validate schema, DAG, spec binding, and impact scope
  -> summarize required regressions
```

`commit-ish` 可以是 commit SHA、branch ref 或 tag。SpecPatch YAML 仍保存在
`spec/evolution/*.yaml`，但推荐绑定 `commit_sha` / `parent_sha` 作为不可变审计锚点。

### `vos spec patch apply`

内部执行链：

```text
load SpecPatch YAML or commit-ish
  -> resolve commit-backed SpecPatch metadata
  -> read git diff
  -> validate DAG, spec binding, allowed paths, and impact scope
  -> update normalized cache
  -> refresh projection
  -> mark affected tests and regressions
```

Agent 的 unified diff gate 仍可作为局部写入入口存在；commit-backed
SpecPatch 是设计演化、复现和提交审计的首选路径。

## 3. Architecture 命令

### `vos arch lint`

内部执行链：

```text
load architecture spec -> validate slices -> emit diagnostics
```

### `vos arch compose`

内部执行链：

```text
load design + composition -> compose -> detect conflicts -> emit composition report
```

### `vos arch derive-tests`

内部执行链：

```text
load normalized specs -> expand stage obligations -> emit public test matrix -> optionally request cloud supplement
```

## 4. Build / Run / Test 命令

### `vos build`

输入：

- target
- profile

前置解析：

- 读取 `ToolchainSpec`
- 解析 build adapter

内部执行链：

```text
resolve toolchain profile -> build plan -> spawn build process -> collect outputs
```

输出 JSON：

- build profile
- generated artifacts
- compiler summary

evidence：

- build logs
- artifact manifest

### `vos run qemu`

内部执行链：

```text
resolve run profile -> acquire qemu lock -> spawn qemu -> stream serial -> detect success/failure signal
```

输出 JSON：

- run status
- boot duration
- success signal match

evidence：

- serial log
- qemu stderr

### `vos test`

内部执行链：

```text
resolve suite -> select test adapter -> execute harness -> collect verdicts
```

输出 JSON：

- suites run
- passed / failed / skipped

evidence：

- per-suite logs
- junit or structured summary

## 5. Verify 命令

### `vos verify public`

内部执行链：

```text
compose lint/build/run/test/invariant DAG -> execute -> summarize verdict
```

### `vos verify patch`

内部执行链：

```text
load commit-backed SpecPatch -> impact analysis -> select minimum required checks -> execute verification DAG
```

### `vos verify full`

内部执行链：

```text
run public checks -> request platform-private checks -> merge summary verdict
```

### `vos verify invariant`

内部执行链：

```text
resolve module invariant obligations -> run checker -> emit invariant report
```

### `vos verify fuzz`

内部执行链：

```text
resolve fuzz target -> seed runtime -> run fuzz adapter -> archive crashes
```

## 6. Trace / Debug 命令

### `vos trace syscall`

内部执行链：

```text
resolve trace profile -> acquire resource lock -> run traced program -> serialize syscall trace
```

### `vos debug explain-log`

内部执行链：

```text
load evidence/log -> classify failure -> map related specs -> emit DiagnosticReport
```

输出 JSON 结构至少包含：

- `kind`
- `phase`
- `related_specs`
- `suggested_next_commands`

## 相关文档

- [07-agent-gateway.md](./07-agent-gateway.md)
- [08-evidence-reporting-and-ci.md](./08-evidence-reporting-and-ci.md)
- [../spec/06-verification-and-evidence.md](../spec/06-verification-and-evidence.md)
