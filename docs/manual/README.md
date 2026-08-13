# VeriSpecOSLab 学生实验手册

这本手册只讲学生主链：把一个空目录变成能够设计、实现、运行和提交的操作系统项目。它不预先规定语言、ISA、算法或 syscall 细节；这些选择属于你的 DesignSpec 和 ModuleSpec。

## 第一次运行

```sh
vos init
vos agent config
vos doctor
vos agent ask "我该如何确定 DesignSpec 的语言与 ISA？"
vos spec lint design
vos agent review design
```

`vos init` 不提问、不创建内核 skeleton，只建立：

```text
spec/design.yaml
spec/modules/toolchain.yaml
spec/interfaces/
spec/goals/
spec/patches/
vos.yaml
.gitignore
```

它还会创建初始 Git 提交。请先配置 Git 的 user.name 和 user.email。`vos doctor` 的错误应当告诉你缺少哪个命令、文件或字段，以及下一步命令。

## 日常循环

```text
vos agent ask
  ↓ 讨论概念与取舍，学生按字段骨架手写 Spec
vos spec lint <target>
vos agent review <target> [-i]
  ↓ 学生按建议修改，再次 lint，并手动 git add/commit
vos agent implement kernel/memory
  ↓ Agent 在临时 linked worktree 中实现并生成 public/contract/fuzz/trace/hidden tests
vos build
vos verify
vos run qemu
vos run hardware
vos report
vos submit
```

Spec 由学生亲手编写和提交。`spec lint` 不调用模型；`agent review` 先运行 lint，再结合相关 Spec 与 `vos.yaml` 的 `verifies` 映射给出建议，不写文件。`implement` 需要 clean HEAD 和已提交 Spec；成功后自动创建 `[vos][agent] Implement <module>` 提交。失败、越界、全量回归失败或 HEAD 漂移只保留诊断和 patch，不修改原工作树。

## 教材与实验索引

教材保留完整的背景、设计空间、参考实现、故障分析和进阶方向。实验卡片负责把这些内容映射到当前学生契约；两者不能互相替代。

| 阶段 | 教材 | 实验 |
| --- | --- | --- |
| 系统设计 | [第 1 章](book/ch01-overview-design.md) | [Lab 1](labs/lab1-seed.md) |
| 启动 | [第 2 章](book/ch02-boot.md) | [Lab 2](labs/lab2-boot.md) |
| 内存 | [第 3 章](book/ch03-memory.md) | [Lab 3](labs/lab3-memory.md) |
| 中断与设备 | [第 4 章](book/ch04-interrupts.md) | [Lab 4](labs/lab4-interrupts.md) |
| 用户空间 | [第 5 章](book/ch05-user-space.md) | [Lab 5](labs/lab5-user-space.md) |
| 文件系统 | [第 6 章](book/ch06-filesystem.md) | [Lab 6](labs/lab6-filesystem.md) |
| 资源与 ABI | [第 7 章](book/ch07-resource-abi.md) | [Lab 7](labs/lab7-resource-abi.md) |
| 个性化目标 | [第 8 章](book/ch08-personal-goal.md) | [Lab 8](labs/lab8-personal-goal.md) |
| 硬件移植 | [第 9 章](book/ch09-hardware-port.md) | [Lab 9](labs/lab9-hardware-port.md) |
| 验证 | [第 10 章](book/ch10-verification.md) | [Lab 10](labs/lab10-verification.md) |
| 综合验收 | [第 11 章](book/ch11-comprehensive-assessment.md) | [Final Lab](labs/final-lab.md) |

命令和平台细节见[附录索引](appendices/tools-overview.md)、[vos 学生命令参考](appendices/vos-commands.md)、[RISC-V](appendices/riscv-reference.md)、[x86-64](appendices/x86-boot-reference.md)与[AArch64](appendices/arm-boot-reference.md)参考。

## 五类 Spec

- `spec/design.yaml`：系统目标、语言、ISA、内核组织、QEMU、canonical board、硬件移植和最多三个组合不变量。
- `spec/modules/<module>.yaml`：稳定 ID、L1/L2/L3、purpose、owns、接口、性质、错误、状态、pre/post、invariants、dependencies、并发、rely/guarantee 和算法意图。
- `spec/interfaces/<interface>.yaml`：跨边界 syscall、IPC、驱动或 ABI。
- `spec/goals/<goal>.yaml`：性能、兼容性和形式化等可选目标。
- `spec/patches/<patch>.yaml`：跨模块语义变化和影响模块。VOS 根据 changes 推导回归范围。

`owns` 只能写仓库相对路径，不能包含 `..` 或绝对路径，并且要覆盖模块实现和模块测试。L1 缺少 L2/L3 字段只警告，`vos spec lint` 不调用模型。工具链也是 ModuleSpec；`vos.yaml` 只保存结构化 argv、环境变量白名单、超时、runner、测试验证的稳定 Spec ID 和产物。

## 运行与证据

build 可以在脏树上运行，但 evidence 标记为不可提交。`vos verify` 要求 clean HEAD，并确定性执行 spec lint、build、全部 public、contract、固定种子 fuzz 和有界 trace targets；`vos verify --hidden` 还会运行绑定当前 Spec、配置、content hash、模型、seed 和生成 run 的本地 hidden tests，并把本次结果绑定当前 commit。QEMU 使用串口输出，通常配合 `-nographic`。Hardware Runner 记录板卡、构建身份、串口日志和 workload，并始终显示 `pending_human_review`。

每次命令的 manifest、事件和产物在 `.vos/runs/`，审计事件在 `.vos/audit/chain.jsonl` 连续哈希保存。`.vos/` 不进 Git。`vos report` 确定性生成 `.vos/report.json`，`vos submit` 在 clean HEAD 上重新生成报告并归档。归档会遮蔽凭据和本机绝对路径；原始日志不进 Git。

## Agent 和本机信任边界

Agent 只有一个运行时，角色决定读写边界。`debug`、`verify`、`review`、`ask` 是只读角色。Doctor 的 Debug Agent 会从 Spec 推导宿主工具并运行能力探针，但只能给出安装建议，不能调用包管理器。临时 linked worktree、prompt、Git 前后检查和审计记录都不隔离进程、网络、凭据或宿主文件；仓库外副作用也无法被 VOS 完整阻止。本机 hidden tests 与完整参考源码同样可被学生读取，不构成保密边界。

## 开发者命令

```sh
cd vos
bun install --ignore-scripts
bun run typecheck
bun run test
bun run build
```

Portal 提供显式在线教学与测评，Demo 只用于静态界面验收。离线主链不会自动联网；完整设计索引见 [`docs/design/spec/README.md`](../design/spec/README.md)、[`docs/design/toolchain/README.md`](../design/toolchain/README.md) 和 [`docs/design/agent/README.md`](../design/agent/README.md)。
