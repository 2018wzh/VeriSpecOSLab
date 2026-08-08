# Student Runtime v2

学生主链由一个进程内 Agent Runtime 和一个薄 Runner 契约组成。Portal/Demo 仍保留供现有构建和单测使用，但在本阶段冻结；HTTP/OpenAI-compatible 服务只作为 Portal 内部能力，学生 CLI 不提供 `agent serve`。

## Runner

```ts
interface Runner {
  build(target: string): Promise<BuildEvidence>;
  run(target: string): Promise<RunEvidence>;
  collectEvidence(): Promise<EvidenceBundle>;
}
```

实现包括 Host、QEMU 和 Hardware Runner。QEMU 目标使用非图形串口输出（通常在 manifest 参数中包含 `-nographic`）；超时、panic、非零退出和 stderr 都进入 evidence。Hardware Runner 记录 board id、构建身份、串口日志和 workload 结果，但状态固定为 `pending_human_review`，本地启动不能变成人工验收。

脏树允许 `build` 与开发态运行，结果的 `submittable` 为 false。`verify`、Agent 自动提交、权威硬件 evidence 和 `submit` 必须从 clean HEAD 开始，并绑定当前 commit、Spec hash、配置 hash 和 ledger entry。`vos verify` 固定执行 spec check、build、全部 public tests 与 contract checks，不调用模型，不运行 fuzz、trace 或 hidden tests。

## Agent worktree

`design` 和 `spec` 在 detached linked worktree 中生成结构化 diff；学生确认后才原子应用并创建单独提交。`implement` 要求 clean HEAD、已提交 ModuleSpec，以及跨模块修改时已提交的 SpecPatch。它在临时 worktree 中修改、build、运行公开和契约测试，循环直到门禁通过、模型主动中止或已有 `maxIterations` 到达。原工作树 HEAD 未漂移、所有改动都在 owns 并集内且验证通过时，运行时应用 patch 并创建 `[vos][agent] Implement <module>` 提交；任何失败、越界、漂移或上限命中都只留下诊断、diff 和 evidence。

worktree 是 Git 变更回滚机制，不是安全沙箱。Agent 执行宿主命令时继承当前用户的进程、网络、凭据和文件权限；这是本阶段明确接受的本地信任风险。

## 证据和日志

每次运行把 manifest、事件、stdout/stderr 和产物写入 gitignored 的 `.vos/runs/<run-id>/`，事件同时追加到 `.vos/audit/chain.jsonl` 连续哈希账本。KB 来源按 `vos.yaml` 锁定到 `.vos/kb-sources`。`vos report` 从 commit、Spec ID、测试、日志和 evidence 确定性生成 `.vos/report.json`，不调用模型、不创建 Git 提交。`vos submit` 重新生成报告、校验 clean HEAD 和审计链，再创建绑定 commit/spec/config hash 的归档；导出日志时遮蔽凭据并把本机绝对路径替换成稳定别名。

## 命令

```text
vos init / doctor / spec check
vos agent design / spec <module> / implement <module>
vos agent debug / verify / kb / review
vos build / run qemu / run hardware / verify / report / submit
```

命令实现只接受结构化 argv。CLI 保留 `--project-root`、`--json`、`--verbose` 和 `--progress`，旧 pipeline、stage、toolchain、arch、trace、ledger、旧 Agent 生成入口和直接 KB 管理不属于学生主链。
