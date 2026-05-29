# VeriSpecOSLab

VeriSpecOSLab 是一个面向操作系统课程与实验的 **Spec-first** 项目仓库。它把学生本地 `spec/`、受控工具链 `vos`、验证与证据采集、以及 Agent 协作治理放在同一条可审计、可复现的闭环里。

这个仓库当前主要包含两部分：

- `vos/`：Rust workspace，实现统一命令入口 `vos`
- `docs/design/`：项目设计文档，定义平台、Spec、Toolchain、Workflow、Agent 的边界与协作方式

同时提供了一个参考项目 `examples/xv6-spec/`，用于展示如何按 Spec 驱动方式组织 xv6 实验。

## 项目目标

VeriSpecOSLab 的设计目标不是“让 AI 直接代写一个完整内核”，而是把开发过程约束在结构化规格和验证反馈之下：

- 先写设计，再写实现，再用证据证明一致性
- 通过 `spec/`、`ToolchainSpec`、构建/测试/验证结果形成闭环
- 让 Agent 在受控上下文中工作，而不是绕过规格和门禁
- 让课程平台、CI、Judge、教师与学生共享同一套可追溯数据模型

## 仓库结构

```text
.
├── docs/
│   └── design/            # 平台、Spec、Toolchain、Workflow、Agent 设计文档
├── examples/
│   └── xv6-spec/          # xv6 规格驱动示例项目
└── vos/                   # Rust workspace，vos 命令及其核心组件
    ├── crates/vos-cli     # CLI 入口，生成二进制 vos
    ├── crates/vos-runtime # 运行时编排、构建/验证/执行
    ├── crates/vos-spec    # Spec 解析、归一化、组合与一致性检查
    ├── crates/vos-agent   # Agent 编排、上下文、生成、修复
    ├── crates/vos-core    # 通用数据模型与基础类型
    ├── crates/vos-prompt  # Prompt 与上下文拼装
    └── crates/vos-platform# 平台侧边界类型与适配层
```

## 核心概念

### 1. Spec

`spec/` 是项目设计真相源，不是附属说明。

设计文档中定义了几类核心规格：

- `ArchitectureSpec`：系统架构与参考系统取舍
- `ModuleSpec` / `OperationContract`：模块状态、接口与操作级语义
- `CompositionSpec`：跨模块组合不变量
- `ToolchainSpec`：构建、链接、镜像、运行和验证契约
- `Verification / Evidence Spec`：验证结果与证据格式

### 2. vos

`vos` 是 VeriSpecOSLab 的统一命令入口。它负责把本地 `spec/`、工具链契约、验证矩阵和 Agent 协作编排成一个统一流程。

### 3. Agent

Agent 不是自由执行的聊天机器人，而是受规格和验证约束的协作组件。设计里强调：

- spec-bound generation
- two-phase prompting
- validator-driven retry loop
- 审计日志与证据归档

### 4. 平台与工作流

`docs/design/platform/` 和 `docs/design/workflow/` 描述课程平台与教学流程如何围绕同一闭环运转，包括：

- 课程、实验、阶段门禁
- 仓库与工作区 provision
- 验证、评分与证据归档
- 教师、助教、学生、Agent 的职责边界

## 运行环境

本仓库是一个 Rust workspace。基础要求是：

- Rust 工具链
- `cargo`
- 若要执行 OS 相关实验，还需要对应的本地工具链、模拟器和依赖

如果你只是想先检查 CLI 是否可用，可以直接编译 workspace：

```bash
cd vos
cargo build
```

## CLI 快速开始

`vos-cli` 定义了二进制 `vos`。最直接的方式是查看帮助：

```bash
cd vos
cargo run -p vos-cli -- --help
```

在示例项目中，常见命令如下：

```bash
cd examples/xv6-spec
vos stage show
vos spec lint spec/architecture/seed.yaml
vos spec normalize spec/modules/kernel/memory/module.yaml
vos spec check-consistency spec/architecture/seed.yaml
vos arch lint spec/architecture/seed.yaml
vos arch compose spec/architecture/seed.yaml
vos arch derive-tests spec/architecture/seed.yaml
vos build
vos run qemu
vos test
vos verify public
vos trace syscall
vos debug explain-log path/to/log
vos agent generate
vos agent generate kernel/memory
vos report generate
vos submit pack
```

其中：

- `vos agent generate` 默认生成当前 stage 表示的整个当前系统
- `vos agent generate <module>` 生成单个模块及其依赖闭包
- `vos agent generate <stage>` 生成该 stage 对应的整套系统
- `vos build` 只执行已经由 `vos agent generate --apply` 生成并登记到 `.vos/toolchain.json` 的本地构建系统

如果你还没有把 `vos` 安装到 PATH，可以用 `cargo run` 直接调用：

```bash
cd vos
cargo run -p vos-cli -- --project-root ../examples/xv6-spec spec lint spec/architecture/seed.yaml
```

## 推荐阅读顺序

如果你想先理解设计，再看实现，建议按以下顺序阅读：

1. [`docs/design/spec/README.md`](docs/design/spec/README.md)
2. [`docs/design/toolchain/README.md`](docs/design/toolchain/README.md)
3. [`docs/design/workflow/README.md`](docs/design/workflow/README.md)
4. [`docs/design/platform/README.md`](docs/design/platform/README.md)
5. [`docs/design/agent/README.md`](docs/design/agent/README.md)

其中：

- `spec/` 说明学生项目中的规格体系
- `toolchain/` 说明 `vos` 如何消费规格并组织验证
- `workflow/` 说明课程过程和角色协作
- `platform/` 说明平台如何管理项目、评分和审计
- `agent/` 说明 Agent runtime 的角色、上下文和修复循环

## 示例项目

`examples/xv6-spec/` 是一个规格驱动的 xv6 内核示例，包含：

- `spec/architecture/`：架构切片、决策和组合
- `spec/modules/`：模块和操作级约束
- `spec/toolchain/`：构建、运行和调试契约
- `spec/verification/`：验证与证据格式
- `.vos/`：运行时产生的缓存、执行记录与报告

你可以把它当作一个参考模板，理解怎样把 OS 实验组织成可验证的工程流程。

## 当前状态

这个仓库的设计文档已经把目标闭环定义得比较完整，但实现仍在演进中。根目录 README 的作用是：

- 给新读者一个统一入口
- 说明仓库里各目录的职责
- 对齐当前 CLI 与设计文档中的命令和概念

如果你要继续推进实现，下一步通常是：

1. 先读 `docs/design/spec/README.md`
2. 再看 `vos/crates/vos-cli/src/args.rs` 里的命令定义
3. 然后进入 `examples/xv6-spec/` 复现一条完整的验证链路
