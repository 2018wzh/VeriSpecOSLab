# VeriSpecOSLab 用户手册

这份手册写给第一次使用 VeriSpecOSLab 的同学。它不绑定某一个实验，也不讲平台内部实现，只说明一件事：拿到一个带 `spec/` 的 OS 实验项目以后，怎样用 `vos` 检查规格、构建、运行、验证、查看证据，并在需要时调用 Agent。

文中的 `<project-root>` 代表你的实验项目目录。仓库里的 `examples/xv6-spec` 是一个可运行示例，后文会用它演示具体命令。

## 1. VeriSpecOSLab 怎么工作

VeriSpecOSLab 采用 spec-first 的工作方式。项目不是先写一堆代码，再靠 README 补解释；而是先把架构、模块、操作、工具链和验证要求写进 `spec/`，再让代码、测试、Agent 和报告都围着这些规格走。

一个典型项目会包含：

```text
<project-root>/
├── spec/              # 设计真相源
├── .vos/              # VOS 配置、策略、缓存和运行证据
├── kernel/            # 内核源码，可能由 Agent 生成，也可能由学生维护
├── user/              # 用户态程序或测试程序
├── tests/             # 项目自己的测试
└── build/             # 构建产物
```

不同实验的源码目录可以不同，但 `spec/` 和 `.vos/` 是理解项目的入口。

### `spec/`

`spec/` 描述项目应该是什么样。它通常包含：

- `architecture/`：架构切片、设计决策、阶段组合。
- `modules/`：模块状态、接口、操作契约、并发规则和测试绑定。
- `toolchain/`：构建、链接、镜像、运行、调试和验证方式。
- `verification/`：公开验证矩阵、evidence schema、报告契约。
- `evolution/`：规格变更，也就是 SpecPatch。

### `vos`

`vos` 是统一命令入口。它负责读取 `spec/` 和 `.vos/`，再执行 lint、build、run、test、verify、report、submit 和 agent 相关命令。

### ToolchainSpec

ToolchainSpec 是 `spec/toolchain/` 里的构建和运行契约。`vos build`、`vos run qemu`、`vos test` 和 `vos verify` 都会消费它，而不是靠用户临时猜命令。

### evidence

evidence 是每次命令留下的运行证据。一次构建、运行或验证会生成一个 `run-id`，默认写到：

```text
<project-root>/.vos/runs/<run-id>/
```

里面有 `manifest.json`、`events.jsonl` 和 artifacts。排查问题时，不要只看终端最后一行，先找对应 run 的 evidence。

### Agent

Agent 是受控协作者，不是自由改文件的聊天机器人。`vos agent` 会先收集 spec、策略、阶段和 evidence 上下文，再通过固定教学 profile 生成计划、补丁或解释。Agent 的结构化输出必须匹配当前任务 schema；能不能写某个文件、能不能越过阶段、要跑哪些验证，最终由确定性的 VOS runtime 裁决。

## 2. 安装和准备

先安装 Bun 1.3 或更新版本。然后在仓库根目录执行：

```bash
cd vos
bun install
bun run vos -- --help
```

如果能看到 `vos CLI` 和命令列表，说明 CLI 入口已经可用。

要运行 OS 实验，还需要对应项目声明的工具链。常见依赖包括：

- C 编译器、汇编器、链接器和 `make`。
- 目标架构工具链，例如 RISC-V 的 `riscv64-unknown-elf-*`。
- 模拟器，例如 `qemu-system-riscv64`。

具体需要什么，以项目的 `spec/toolchain/profile.yaml` 和课程说明为准。

如果要让 Agent 生成代码或解释问题，还需要配置 provider。配置通常在：

```text
<project-root>/.vos/config.toml
```

环境变量名也以该文件为准。例如 xv6 示例默认读取 `DEEPSEEK_API_KEY`。

## 3. 命令格式

建议从 `vos/` 目录运行 CLI：

```bash
cd vos
bun run vos -- --project-root <project-root> <command>
```

如果项目在仓库外，也可以传绝对路径：

```bash
bun run vos -- --project-root /path/to/project <command>
```

常用全局参数：

- `--json`：输出机器可读 JSON。
- `--progress auto|always|never`：控制进度显示。
- `--agent-session <id>`：把命令绑定到一次 Agent 会话。
- `--report <path>`：指定报告输出路径。
- `--evidence-dir <path>`：指定 evidence 写入目录。

## 4. 一条通用工作流

下面这条流程适用于大多数 VeriSpecOSLab 项目。你可以先照顺序跑一遍，再根据课程要求选择更细的命令。

### 4.1 检查项目和阶段

```bash
bun run vos -- --project-root <project-root> doctor
bun run vos -- --project-root <project-root> stage show
```

`doctor` 看环境和项目配置是否明显缺东西。`stage show` 看当前实验阶段。

### 4.2 检查 spec

```bash
bun run vos -- --project-root <project-root> spec lint
bun run vos -- --project-root <project-root> spec check-consistency
bun run vos -- --project-root <project-root> arch compose spec/architecture/seed.yaml
```

`spec lint` 适合找格式和字段问题。`spec check-consistency` 看规格之间能不能连起来。`arch compose` 适合在改架构之后确认组合视图。

### 4.3 检查工具链

```bash
bun run vos -- --project-root <project-root> toolchain lint
```

这一步检查 `spec/toolchain/` 能否被 `vos` 读取，也能尽早暴露构建入口、产物路径和运行 profile 的问题。

### 4.4 查看 Agent 计划

```bash
bun run vos -- --project-root <project-root> agent context --scope public
bun run vos -- --project-root <project-root> agent plan --stage <stage>
```

在生成代码前先看上下文和计划。这样能确认 Agent 会读哪些 spec、当前阶段允许哪些目标、它准备怎样拆任务。

### 4.5 生成或修改实现

如果项目要求从 spec 生成源码，可以运行：

```bash
bun run vos -- --project-root <project-root> agent generate --apply
```

只生成某个目标时，传 target：

```bash
bun run vos -- --project-root <project-root> agent generate <target> --apply
```

也可以在生成后继续构建和运行：

```bash
bun run vos -- --project-root <project-root> agent generate --apply --build --run
```

这里有两个硬约束：`--build` 依赖 `--apply`，`--run` 依赖 `--build`。

如果你手工改了代码，可以用 ledger 记录意图：

```bash
bun run vos -- --project-root <project-root> ledger record --actor human --intent "实现当前阶段的内存分配器" --spec-ref spec/modules/kernel/memory/module.yaml --changed-target kernel/memory.c
```

### 4.6 构建、运行和测试

先 dry-run 看命令计划：

```bash
bun run vos -- --project-root <project-root> build --dry-run
```

再真正构建：

```bash
bun run vos -- --project-root <project-root> build
```

如果项目提供 QEMU 运行配置，可以查看 profile 和 case：

```bash
bun run vos -- --project-root <project-root> run qemu --list-profiles
bun run vos -- --project-root <project-root> run qemu --list-cases
```

运行默认 case 或指定 case：

```bash
bun run vos -- --project-root <project-root> run qemu
bun run vos -- --project-root <project-root> run qemu --case <case-id>
```

运行测试 suite：

```bash
bun run vos -- --project-root <project-root> test --suite <suite-name>
```

### 4.7 验证和报告

先看公开验证会执行什么：

```bash
bun run vos -- --project-root <project-root> verify public --dry-run
```

真正执行公开验证：

```bash
bun run vos -- --project-root <project-root> verify public
```

根据课程要求，也可能会用到：

```bash
bun run vos -- --project-root <project-root> verify patch --target <patch-or-target>
bun run vos -- --project-root <project-root> verify invariant --target <target>
bun run vos -- --project-root <project-root> verify generated --target <target>
bun run vos -- --project-root <project-root> verify fuzz --target <target>
```

生成报告：

```bash
bun run vos -- --project-root <project-root> report generate --stage <stage>
bun run vos -- --project-root <project-root> report generate --final
```

打包提交：

```bash
bun run vos -- --project-root <project-root> submit pack
```

## 5. xv6-spec 示例

仓库里的 xv6 示例可以用来验证你是否理解了上面的通用流程。假设你在仓库根目录，项目路径是 `../examples/xv6-spec` 相对于 `vos/`：

```bash
cd vos
bun install
bun run vos -- --project-root ../examples/xv6-spec toolchain lint
bun run vos -- --project-root ../examples/xv6-spec spec check-consistency
bun run vos -- --project-root ../examples/xv6-spec build --dry-run
bun run vos -- --project-root ../examples/xv6-spec build
bun run vos -- --project-root ../examples/xv6-spec run qemu --case boot-smoke
bun run vos -- --project-root ../examples/xv6-spec verify public
```

如果你从只有 spec、没有源码的干净状态开始，在 `build` 前先运行：

```bash
bun run vos -- --project-root ../examples/xv6-spec agent generate --apply
```

xv6 示例的更多说明见 [examples/xv6-spec/README.md](../examples/xv6-spec/README.md)。

## 6. 常用命令速查

```bash
# 项目和环境
bun run vos -- --project-root <project-root> doctor
bun run vos -- --project-root <project-root> stage show

# spec 和架构
bun run vos -- --project-root <project-root> spec lint
bun run vos -- --project-root <project-root> spec normalize
bun run vos -- --project-root <project-root> spec check-consistency
bun run vos -- --project-root <project-root> spec patch lint <patch-yaml-or-commit>
bun run vos -- --project-root <project-root> spec patch apply <patch-yaml-or-commit>
bun run vos -- --project-root <project-root> arch lint
bun run vos -- --project-root <project-root> arch compose spec/architecture/seed.yaml
bun run vos -- --project-root <project-root> arch derive-tests spec/architecture/seed.yaml

# 构建、运行、测试和验证
bun run vos -- --project-root <project-root> toolchain lint
bun run vos -- --project-root <project-root> build --dry-run
bun run vos -- --project-root <project-root> build
bun run vos -- --project-root <project-root> run qemu --case <case-id>
bun run vos -- --project-root <project-root> test --suite <suite-name>
bun run vos -- --project-root <project-root> verify public

# Agent
bun run vos -- --project-root <project-root> agent context --scope public
bun run vos -- --project-root <project-root> agent plan --stage <stage>
bun run vos -- --project-root <project-root> agent ask --stage <stage> "这里写你的问题"
bun run vos -- --project-root <project-root> agent generate <target> --apply
bun run vos -- --project-root <project-root> agent apply-patch --patch-file <file> --run-validation
bun run vos -- --project-root <project-root> agent validate-generated --target <target>
bun run vos -- --project-root <project-root> agent review-spec --target <path-or-stage-or-patch>
bun run vos -- --project-root <project-root> agent debug --log <log-path>
bun run vos -- --project-root <project-root> agent log

# 报告、提交包和知识库
bun run vos -- --project-root <project-root> report generate --stage <stage>
bun run vos -- --project-root <project-root> report generate --final
bun run vos -- --project-root <project-root> submit pack
bun run vos -- --project-root <project-root> kb add <path-or-url> --source-kind project --recursive
bun run vos -- --project-root <project-root> kb list
bun run vos -- --project-root <project-root> kb search "<query>"
```

## 7. 证据在哪里看

默认 evidence 在项目目录下：

```text
<project-root>/.vos/runs/<run-id>/
├── manifest.json
├── events.jsonl
└── artifacts/
```

`manifest.json` 是这次运行的总摘要，包含命令、状态、时间、产物和 evidence ref。

`events.jsonl` 是事件流水，适合排查命令在哪一步失败。

`artifacts/` 放构建日志、QEMU 日志、验证摘要、生成计划、行为测试结果等文件。具体内容取决于你运行的命令。

报告命令还会写入：

```text
<project-root>/spec/reports/
<project-root>/.vos/report/
```

如果要给助教或平台复现问题，优先提供命令、`run-id`、`manifest.json` 和相关 artifact 路径。

## 8. 常见问题

### 找不到 Bun

先安装 Bun 1.3 或更新版本，再回到 `vos/` 目录执行 `bun install`。

### `toolchain lint` 或 `build` 失败

先看项目的 `spec/toolchain/profile.yaml`，确认需要的编译器、模拟器和工具都在 `PATH` 中。不同实验的依赖不同，不要直接套用 xv6 的工具链。

### `agent generate` 失败

检查 `<project-root>/.vos/config.toml` 里的 provider 配置，再确认对应环境变量存在。

### `agent generate --build` 报错

`--build` 必须和 `--apply` 一起使用。正确写法是：

```bash
bun run vos -- --project-root <project-root> agent generate --apply --build
```

### `agent generate --run` 报错

`--run` 依赖 `--build`，而 `--build` 又依赖 `--apply`。正确写法是：

```bash
bun run vos -- --project-root <project-root> agent generate --apply --build --run
```

### 命令被 policy 或 spec gate 拦住

这通常说明当前命令、路径或阶段不在允许范围内。先看 `.vos/policy.yaml`、`.vos/project.yaml` 和命令输出里的 reason，再决定是改 spec、改阶段，还是换一个更小的目标。

### QEMU 启动了但命令失败

`vos run qemu` 看的是成功信号，不是进程是否启动。打开本次 run 的 `artifacts/` 或 `qemu.log`，确认日志里是否出现 run spec 要求的 pattern。

## 9. 继续阅读

- [根 README](../README.md)：仓库入口和开发命令。
- [xv6-spec 示例](../examples/xv6-spec/README.md)：一个完整示例项目的运行说明。
- [Spec 设计文档](design/spec/README.md)：`spec/` 的结构和写法。
- [VOS Runtime 设计文档](design/toolchain/README.md)：`vos` 如何消费规格并编排命令。
- [Workflow 设计文档](design/workflow/README.md)：课程过程、角色和证据流。
