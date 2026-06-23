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

Portal-bound repo 中，除 `login` / `logout` / `whoami` / `help` 等认证入口外，
所有项目命令在执行前都必须在线校验 Portal token 与 policy snapshot。HTTP
server 模式和本地 CLI 复用同一 command parser、auth/policy gate、runtime
和 evidence writer。

所有命令都至少输出：

- `ok`
- `run_id`
- `command`
- `status`
- `artifacts`

Portal-bound run 的 manifest 还必须记录：

- `user_id`
- `project_id`
- `policy_snapshot_ref`
- `auth_verdict`

## 1.5 Auth 与 HTTP Server 命令

### `vos login`

输入：

- `--portal-url`
- Portal 凭据或浏览器/device flow 返回的 token

职责：

- 从 Portal 获取用户 token
- 将 token 写入用户级 VOS auth store
- 不把 token 写入项目 `.vos/` 或提交包

### `vos logout`

职责：

- 清除用户级 VOS auth store 中对应 Portal 的 token
- 可选通知 Portal revoke token

### `vos whoami`

输出：

- 当前 Portal URL
- 当前 user / role 摘要
- 当前 project binding
- policy snapshot 状态

### `vos serve`

职责：

- 启动单项目绑定的 HTTP façade，供 Portal / sandbox runner 调用
- 复用本地 CLI 的 auth/policy gate、命令执行、progress、evidence
- 不另写 build/run/verify 逻辑

启动示例：

```bash
vos serve --project-root . --portal-url https://portal.example --project-id <project-id> --host 127.0.0.1 --port 8788
```

最小 HTTP API：

```http
POST /api/v1/vos/runs
GET  /api/v1/vos/runs/{id}
GET  /api/v1/vos/runs/{id}/events
POST /api/v1/vos/runs/{id}/cancel
```

`POST /runs` 使用命令 RPC 形状，至少包含 `command`、`args`、`requested_by`
和可选 `agent_session_id` / `reason`。`GET /events` 使用 SSE，并复用
`RunEvent` / progress event 语义。`cancel` 必须写入 evidence，最终状态为
`cancelled` 或 `timed_out`。

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
  -> strict resolve commit-backed SpecPatch metadata
  -> require local commit_sha / parent_sha and read git diff
  -> validate trailers, DAG, spec binding, and exact impact scope
  -> update .vos/cache/normalized/bundle.json
  -> write patch impact, verification plan, and status cache
  -> execute verify patch
  -> refresh local student / agent / staff projections
  -> mark applied state only after verification passes
```

`apply` 不修改当前工作区，也不接受 stdin unified diff。它登记并验证已经存在于
Git DAG 中的 commit-backed SpecPatch。`affected_specs`、`affected_modules`
和 `affected_operations` 必须完整覆盖真实 diff impact；`apply` 不使用从 diff
自动补齐 metadata 的 fallback。

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

`vos build` 只执行已登记的 `.vos/toolchain.json` 或显式 `--toolchain`
manifest。缺少 manifest 时必须失败并提示先运行 `vos build generate`；
不得隐式扫描 Makefile、CMake 或 xtask 作为 legacy fallback。

### `vos build generate`

内部执行链：

```text
load ToolchainSpec -> call local Agent for ToolchainGenerationDraft
  -> VOS path/spec/manifest/ledger gate
  -> write build files + .vos/toolchain.json
  -> write ledger -> git commit -> evidence
```

Agent 只生成草案；`vos-cli` 是构建文件落盘、manifest、ledger 和 evidence 的最终裁决者。

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
load manifest v2 -> resolve explicit suite objects -> select registered test adapter
  -> execute command or qemu-case harness -> collect suite verdicts
```

输出 JSON：

- suites run
- passed / failed / skipped
- suite-level verdicts; case/oracle details stay in evidence artifacts

evidence：

- per-suite logs
- structured result JSON
- qemu serial/stderr/result artifacts for `qemu-case` suites

`.vos/toolchain.json` 必须使用 `manifest_version: 2`。`test.suites` 只接受对象：

```json
{ "name": "kalloc_static", "kind": "command", "command": ["sh", "tests/public/kalloc.sh"] }
{ "name": "usertests", "kind": "qemu-case", "build_variant": "baseline", "run_case": "usertests" }
```

`vos test` 只消费已经存在于 manifest 或临时 worktree manifest 中的 suite；
它不生成测试代码。`verify generated` / `verify fuzz` 负责在临时 worktree 中生成
行为测试并把它们作为临时 suite 执行。

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
run public checks -> run generated/invariant/fuzz suites
  -> optionally load external staff policy -> run staff-only suites
  -> merge summary verdict
```

`verify full` 的执行权在本地 authenticated `vos-cli`。平台可以触发该命令，
但不替代 `vos-cli` 解析 spec、执行 suite 或归档 evidence。staff-only 输入必须
来自 repo 外部 policy 文件或等价受控输入，学生 repo 只记录摘要和 evidence ref。

### `vos verify invariant`

内部执行链：

```text
resolve module invariant obligations -> map to registered test suites -> emit invariant report
```

### `vos verify fuzz`

内部执行链：

```text
resolve generated/fuzz target -> map to registered test suites -> archive logs/crashes
```

`verify invariant` 与 `verify fuzz` 复用 `.vos/toolchain.json` v2 中已有
`test.suites`，并通过 `verify.invariant`、`verify.generated`、`verify.fuzz`
映射 obligation 到 suite 名称；suite 执行走 VOS 注册的内置 test adapter。

`verify generated` 与 `verify fuzz` 还会生成 `verify-behavior` evidence：
先产出 TestPlan JSON，再在临时 worktree 中应用行为测试 patch 并运行自动化
stdin/stdout/exit/timeout oracle。patch 不写回学生 repo。

Trace 不作为第四类 verify suite 映射，也不作为 verify runtime 字段。
DebugAgent 消费 verify evidence，形成
`obligation -> suite -> behavior case -> oracle -> observed output -> suspected failure`
的教学解释；它不改变 verify 的 pass/fail 判定。

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
