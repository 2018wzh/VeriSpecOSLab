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

脏树允许 `build` 与开发态运行，结果的 `submittable` 为 false。`verify`、Agent 自动提交、权威硬件 evidence 和 `submit` 必须从 clean HEAD 开始，并绑定当前 commit、Spec hash、配置 hash 和 ledger entry。`vos verify` 固定执行 spec lint、build、全部 public、contract、固定种子 fuzz 与有界 trace targets，不调用模型；`--hidden` 显式执行本地 hidden tests。

## Agent worktree

DesignSpec 和 ModuleSpec 由学生手写。`vos spec lint` 负责确定性检查，`vos agent review` 只给建议；两者都不修改或提交 Spec。学生修改完成后，用普通 Git 命令提交。

`implement` 要求 clean HEAD、已提交 ModuleSpec，以及跨模块修改时已提交的 SpecPatch。它在临时 worktree 中修改代码和测试，运行 build、public、contract、固定种子 fuzz 与有界 trace 门禁，直到全部通过、模型主动中止或已有 `maxIterations` 到达。模型必须通过结构化工具提交实现结果和 test target 提案；schema、路径、Spec ID 或测试字段校验失败时，工具把具体错误返回同一模型线程，模型可继续使用工具修正并重新提交。只有 `status: passed` 的结构化结果可以进入权威门禁。

VOS 在每轮前后恢复模型对 `vos.yaml` 的直接修改，只接受校验通过的结构化 target 提案，再原子更新 manifest。原工作树 HEAD 未漂移、所有改动都在 owns 并集内且验证通过时，运行时应用 patch 并创建 `[vos][agent] Implement <module>` 提交；任何失败、越界、漂移或上限命中都只留下诊断、diff 和 evidence。

worktree 是 Git 变更回滚机制，不是安全沙箱。Agent 执行宿主命令时继承当前用户的进程、网络、凭据和文件权限；这是本阶段明确接受的本地信任风险。

## 证据和日志

每次运行把 manifest、事件、stdout/stderr 和产物写入 gitignored 的 `.vos/runs/<run-id>/`，事件同时追加到 `.vos/audit/chain.jsonl` 连续哈希账本。KB 来源通过 `vos kb` 命令加入，并以内容寻址对象保存在 `.vos/kb/`。`vos report` 从 commit、Spec ID、测试、日志和 evidence 确定性生成 `.vos/report.json`，不调用模型、不创建 Git 提交。`vos submit` 重新生成报告、校验 clean HEAD 和审计链，再创建绑定 commit/spec/config hash 的归档；导出日志时遮蔽凭据并把本机绝对路径替换成稳定别名。

## 命令

```text
vos init / doctor / spec lint
vos agent ask / 学生手写 Spec / vos spec lint <target>
vos agent review <target> [-i] / 学生手动提交 / implement <module>
vos agent debug / verify / ask / review
vos kb add / list / search / remove / clear / export-manifest / import-manifest
vos build / run qemu / run hardware / verify / report / submit
```

命令实现只接受结构化 argv。CLI 保留 `--project-root`、`--json`、`--verbose` 和 `--progress`，旧 pipeline、stage、toolchain、arch、trace、ledger 和旧 Agent 生成入口不属于学生主链。知识库通过公开的 `vos kb` 命令管理，不写入 `vos.yaml`。
