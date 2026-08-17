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
spec/qemu/
references/qemu/README.md
vos.yaml
.gitignore
```

它还会创建 `spec/qemu/request.yaml.example` 和 `references/qemu/README.md`，供需要做 QEMU 板级移植的项目复制和填写。`spec/qemu/` 中的 request 由学生手写；`references/qemu/<request-id>/` 只放学生掌握的板卡手册、原理图、设备树、固件或镜像等材料，目录内容默认被忽略，不会因为 `vos init` 自动进入 Git。`vos init` 还会创建初始 Git 提交，请先配置 Git 的 user.name 和 user.email。`vos doctor` 的错误应当告诉你缺少哪个命令、文件或字段，以及下一步命令。

## 日常循环

```text
Lab 1–8：ask → 学生手写 Spec → lint → review → 学生提交 → VOS implement → build/verify → QEMU/硬件
Lab 9–Final：学生与 Coding Agent 共同维护 Spec/实现 → 项目 build/test/QEMU/硬件 → 报告与答辩
```

Lab 1–8 中，Spec 由学生亲手编写和提交。`spec lint` 不调用模型；`agent review` 先运行 lint，再结合相关 Spec 与 `vos.yaml` 的 `verifies` 映射给出建议，不写文件。`implement` 需要 clean HEAD 和已提交 Spec；成功后自动创建 `[vos][agent] Implement <module>` 提交。失败、越界、全量回归失败或 HEAD 漂移只保留诊断和 patch，不修改原工作树。

从 Lab 9 开始，课程允许直接使用 Codex、Claude Code、Gemini CLI、Copilot 等 Coding Agent 修改代码、测试、构建文件和 Spec。此时 VOS 的 Agent 角色和顺序不再是课程门禁；Lab 仍要求提交与实现一致的 Spec、实验报告和真实证据，并在报告中简要说明使用过的 Agent、任务范围和自己的复核方式。

QEMU 还有一条与日常 `vos run qemu` 不同的板级移植主链。它用于把固定 canonical board 的启动链和 SoC/外设行为带入 QEMU，而不是替学生运行已有内核：

```sh
vos agent qemu preflight <QemuSpec ID|path>
# 学生审查 candidate，将 status 改为 approved 并提交
vos agent qemu execute <approved QemuSpec ID|path>
```

预检只使用 `references/qemu/<request-id>/` 中的硬件材料，材料缺失或不足时不会生成 candidate，也不会用网络资料补齐硬件事实。执行要求已提交的 `approved` revision、未漂移的材料和 QEMU commit，在 detached worktree 中完成构建、启动到 shell 和邻居回归；它可以从官方仓库固定 TF-A/U-Boot 等软件依赖，但不改写 `vos.yaml`、不 push。中断后只有在命令、HEAD、Spec hash 和 worktree 仍匹配时才使用 `--resume <run-id>` 恢复。QEMU 结果仍不能替代真实板卡的串口、SDIO/SPI、DMA/cache 和人工复核证据。

## 教材与实验索引

教材保留完整的背景、设计空间、参考实现、故障分析和进阶方向。实验卡片负责把这些内容映射到当前学生契约；两者不能互相替代。

| 阶段 | 教材 | 实验 | 预计耗时 |
| --- | --- | --- | --- |
| 系统设计 | [第 1 章](book/ch01-overview-design.md) | [Lab 1](labs/lab1-seed.md) | 10–14 小时 |
| 启动 | [第 2 章](book/ch02-boot.md) | [Lab 2](labs/lab2-boot.md) | 10–14 小时 |
| 内存 | [第 3 章](book/ch03-memory.md) | [Lab 3](labs/lab3-memory.md) | 15–20 小时 |
| 中断与设备 | [第 4 章](book/ch04-interrupts.md) | [Lab 4](labs/lab4-interrupts.md) | 12–18 小时 |
| 用户空间 | [第 5 章](book/ch05-user-space.md) | [Lab 5](labs/lab5-user-space.md) | 15–20 小时 |
| 文件系统 | [第 6 章](book/ch06-filesystem.md) | [Lab 6](labs/lab6-filesystem.md) | 15–22 小时 |
| 资源与 ABI | [第 7 章](book/ch07-resource-abi.md) | [Lab 7](labs/lab7-resource-abi.md) | 12–18 小时 |
| 个性化目标 | [第 8 章](book/ch08-personal-goal.md) | [Lab 8](labs/lab8-personal-goal.md) | 15–25 小时 |
| 硬件移植 | [第 9 章](book/ch09-hardware-port.md) | [Lab 9](labs/lab9-hardware-port.md) | 20–40 小时（视板卡） |
| 验证 | [第 10 章](book/ch10-verification.md) | [Lab 10](labs/lab10-verification.md) | 8–12 小时 |
| 综合验收 | [第 11 章](book/ch11-comprehensive-assessment.md) | [Final Lab](labs/final-lab.md) | 8–12 小时 |

合计约 130–170 小时，建议按 1–2 个学期规划。这是首轮估计，各 Lab 卡片会随学生实测耗时（提交物里的"实际耗时"字段）持续修订。

命令、平台和调试要点已经放在各章与对应 Lab 的"参考卡"中。学生发布包只包含 `book/`、`labs/` 与 [术语表](glossary.md)；`specs/`、`vos/` 和 `teacher/` 是仓库内部资料，不属于学生发布内容。

术语第一次出现时不认识的词，去[术语表](glossary.md)查：它标注了每个术语首次出现的位置。想直接看一套完整可运行的参考项目，`examples/xv6-spec` 子模块里有每个 Lab 的完整 Spec 与实现（参考源码可读，不作为保密边界）；它是学生手写 Spec 的参照锚点，不是替代品。

## 五类 Spec

- `spec/design.yaml`：系统目标、语言、ISA、内核组织、QEMU、canonical board、硬件移植和最多三个组合不变量。
- `spec/modules/<module>.yaml`：稳定 ID、L1/L2/L3、purpose、owns、接口、性质、错误、状态、pre/post、invariants、dependencies、并发、rely/guarantee 和算法意图。
- `spec/interfaces/<interface>.yaml`：跨边界 syscall、IPC、驱动或 ABI。
- `spec/goals/<goal>.yaml`：性能、兼容性和形式化等可选目标。
- `spec/patches/<patch>.yaml`：跨模块语义变化和影响模块。VOS 根据 changes 推导回归范围。

`owns` 只能写仓库相对路径，不能包含 `..` 或绝对路径，并且要覆盖模块实现和模块测试。L1 缺少 L2/L3 字段只警告，`vos spec lint` 不调用模型。工具链也是 ModuleSpec；`vos.yaml` 只保存结构化 argv、环境变量白名单、超时、runner、测试验证的稳定 Spec ID 和产物。

## HAL 与可移植性

每个阶段都要区分平台相关代码和操作系统核心逻辑。UART、IRQ、定时器、页表格式、MMIO、DMA 和启动信息可以因平台而异，核心模块应尽量通过 HAL 或稳定接口访问它们。固定 canonical board 的常量并非一律禁止，但要集中管理，写明来源和适用范围，不能把同一个地址或中断号散落在多个模块里。各章的参考卡会在第一次遇到这些假设时说明如何查手册、设备树、ACPI 或固件输入。

## 运行与证据

Lab 1–8 中，build 可以在脏树上运行但 evidence 标记为不可提交，并按课程指定的 VOS lint、build、verify 和报告链记录结果；Lab 9–Final 可使用 VOS，也可使用项目自己的构建、测试、QEMU 和硬件命令。所有阶段都要记录代码/Spec 或配置身份、target、状态、产物和有界日志；硬件证据始终显示 `pending_human_review`，等待人工复核。

使用 VOS 时，命令 manifest、事件和产物在 `.vos/runs/`，审计事件在 `.vos/audit/chain.jsonl` 连续哈希保存。`.vos/` 不进 Git。`vos report` 和 `vos submit` 可确定性生成辅助报告与归档；其他 Coding Agent/项目工具也必须遮蔽凭据和本机绝对路径，保留可复现的原始运行记录。

## Agent 和本机信任边界

Lab 1–8 中，VOS Agent 角色决定读写边界：`debug`、`verify`、`review`、`ask` 是只读角色，`implement` 才能按已提交 Spec 修改临时 worktree。Lab 9 起使用外部 Coding Agent 时，不再限制角色、路径或先后顺序，但学生仍需审查 diff、运行实验并如实报告结果。无论哪种 Agent，临时 linked worktree、prompt、Git 前后检查和审计记录都不隔离进程、网络、凭据或宿主文件。

## 开发者命令

```sh
cd vos
bun install --ignore-scripts
bun run typecheck
bun run test
bun run build
```

Portal 提供显式在线教学与测评，Demo 只用于静态界面验收。离线主链不会自动联网；教师和维护者需要的设计索引不属于学生 Book/Lab 发布包。
