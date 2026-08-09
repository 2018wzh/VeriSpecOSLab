# VeriSpecOSLab

VeriSpecOSLab 是一个面向操作系统课程的 spec-first 实验工具链。学生只需维护设计、模块契约和实现代码，`vos` 负责把它们连接到构建、QEMU、硬件运行、公开验证和提交归档。

## 学生主链

```text
空目录 → vos init → vos agent config → vos agent design --interactive → vos agent spec <module>
       → vos agent implement <module> → vos build → vos verify
       → vos run qemu / vos run hardware → vos report → vos submit
```

初始化不会询问问题，也不会生成内核骨架。它只创建空的 DesignSpec、工具链 ModuleSpec、`vos.yaml`、`.gitignore` 和初始 Git 提交。语言、ISA、板卡和内核组织由学生随后通过 `vos agent design --interactive` 的设计访谈决定。

```sh
cd vos
bun install --ignore-scripts
cd apps/vos-cli
bun link

mkdir my-os && cd my-os
vos init
vos agent config
vos doctor
vos spec check
```

`vos` 使用 Bun 的 argv 子进程接口执行 `vos.yaml` 中的结构化命令，不拼接 shell 字符串。`build` 和开发态运行可以在脏树上执行，但 evidence 会标记为不可提交；`verify`、Agent 自动提交、权威硬件 evidence 和 `submit` 要求 clean HEAD。

## 学生文件契约

- `spec/design.yaml`：唯一 DesignSpec，记录系统目标、语言、ISA、内核组织、QEMU、canonical board、硬件移植和最多三个组合不变量。
- `spec/modules/<module>.yaml`：ModuleSpec。操作、接口、性质、错误、状态、并发、rely/guarantee 和算法意图集中在同一文件。
- `spec/interfaces/<interface>.yaml`：syscall、IPC、驱动和用户/内核 ABI 等跨边界接口。
- `spec/goals/<goal>.yaml`：可选的性能、兼容性和形式化目标。
- `spec/patches/<patch>.yaml`：架构或跨模块语义变化的手写影响声明。
- `vos.yaml`：工具链 ModuleSpec 的执行投影，只允许结构化 `program + args + cwd + env allowlist + timeout`、runner、测试 target、产物和稳定 Spec ID。知识库来源由 `vos kb` 命令管理。

ModuleSpec 的 `level` 为 L1/L2/L3。缺少高等级字段只产生警告；`vos spec check` 只做确定性的 schema、引用、路径和等级检查。`owns` 必须是仓库相对路径，Agent 实现只能触及目标模块与已提交 SpecPatch 影响模块的 owns 并集。

## 公开命令

```text
vos init                         vos doctor
vos spec check                  vos agent config
vos agent design [--interactive|--confirm]
vos agent spec <module> [--interactive|--confirm]
vos agent implement <module>    vos agent debug
vos agent verify                vos agent ask [question]
vos agent review [module]       vos build
vos run qemu                    vos run hardware
vos verify                      vos report
vos submit                      vos kb add|list|search|remove|clear
vos kb export-manifest         vos kb import-manifest <path>
```

`--project-root`、`--json`、`--verbose` 和 `--progress` 是通用参数。`agent debug`、`agent verify`、`agent review` 和 `agent ask` 是只读或问答角色；`design`/`spec` 先保存并展示确定的 diff，`--confirm` 应用同一份提案，不会重新调用模型；`implement` 在 detached linked worktree 中修改、构建和验证，成功后才把 patch 应用回原工作树并创建带 Run-ID 和 Spec-Hash trailer 的提交。

宿主命令默认直接继承当前用户权限、网络和凭据。linked worktree 只提供 Git 变更回滚和隔离，不是进程、网络、凭据或宿主文件安全边界。学生必须把本机参考资料可读性和 Agent 任意宿主命令风险视为已知的策略约束。

## 证据、报告和隐私

运行记录位于被 `.gitignore` 忽略的 `.vos/`。事件同时写入连续哈希审计链；`vos kb add` 把来源和内容寻址对象记录到 `.vos/kb/`。`vos report` 不调用模型、不提交 Git，只从 commits、Spec ID、测试、日志和 evidence 确定性生成 `.vos/report.json`。`vos submit` 只归档 clean HEAD，并在导出时遮蔽凭据、把绝对路径替换为稳定别名；原始日志不进 Git。

硬件 Runner 的结果始终是 `pending_human_review`，本地串口启动不能替代人工验收。

## 仓库结构与开发

`vos/apps/vos-cli` 是薄 CLI 入口，`vos/apps/vos-agent` 是进程内 headless/TUI/暂留 HTTP 后端，`vos/apps/vos-portal` 和 Demo 保留但冻结，`vos/packages/vos-core`、`vos-spec`、`vos-runtime`、`vos-kb`、`vos-server` 提供共享能力。Portal/Demo 不承诺旧 connected teaching loop。

```sh
cd vos
bun run typecheck
bun run test
bun run build
```

完整学生说明见 [`docs/manual/README.md`](docs/manual/README.md)，契约定义见 [`docs/design/spec/README.md`](docs/design/spec/README.md)，Runner 和证据边界见 [`docs/design/toolchain/README.md`](docs/design/toolchain/README.md)。参考 xv6 源码仍保留在 [`examples/xv6-spec`](examples/xv6-spec) 子模块中；它是完整源码参考，不是安全边界。
