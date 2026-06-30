# VeriSpecOSLab

VeriSpecOSLab 是一个面向操作系统课程与实验的 spec-first 工作区。它把本地 `spec/`、`vos` 命令入口、构建/运行/验证、evidence 记录和 Agent 协作放在同一条可复现的流程里。

如果你第一次使用这个仓库，先读 [用户手册](docs/manual/index.md)。如果你想直接看一个完整 OS 示例，从 [xv6-spec](examples/xv6-spec/README.md) 开始。

参赛文档在 [docs/comp/VeriSpecOSLab.pdf](docs/comp/VeriSpecOSLab.pdf) 和 [docs/comp/VeriSpecOSLab.pptx](docs/comp/VeriSpecOSLab.pptx) 里。

## 快速开始

```bash
cd vos
bun install
bun run vos -- --help
```

用仓库里的 xv6 示例跑一遍基础检查：

```bash
bun run vos -- --project-root ../examples/xv6-spec toolchain lint
bun run vos -- --project-root ../examples/xv6-spec spec check-consistency
bun run vos -- --project-root ../examples/xv6-spec build --dry-run
```

如果本机有 RISC-V 工具链和 QEMU，可以继续：

```bash
bun run vos -- --project-root ../examples/xv6-spec build
bun run vos -- --project-root ../examples/xv6-spec run qemu --case boot-smoke
bun run vos -- --project-root ../examples/xv6-spec verify public
```

## 仓库里有什么

```text
.
├── docs/
│   ├── manual/               # 面向使用者的中文手册（VOS 命令 + Spec Schema）
│   ├── design/              # Spec、Toolchain、Workflow、Platform、Agent 设计
│   └── portal/              # Portal 原型开发文档
├── examples/
│   └── xv6-spec/            # 规格驱动的 xv6 参考项目
└── vos/
    ├── apps/
    │   ├── vos-cli          # vos 命令入口
    │   ├── vos-agent        # Agent 后端和 OpenAI-compatible façade
    │   └── vos-web          # Portal 原型前端
    └── packages/            # core、spec、policy、evidence、runtime、server 等共享包
```

## 核心概念

`spec/` 是项目设计真相源。架构、模块、操作契约、工具链、验证矩阵和报告契约都应尽量落在结构化规格里，而不是散落在聊天记录或临时脚本中。

`vos` 是统一命令入口。它读取项目里的 `spec/` 和 `.vos/`，再执行 lint、build、run、test、verify、report、submit 和 agent 子命令。

`evidence` 是每次执行留下的证据。命令会把 manifest、事件流水和日志产物写到 `<project-root>/.vos/runs/<run-id>/`，方便学生、助教、平台和 Agent 复盘同一次运行。

Agent 是受规格和策略约束的协作者。它可以生成计划、补丁、解释和报告素材，但写入范围、阶段门禁和验证要求由 VOS runtime 决定。

## 常用命令

从 `vos/` 目录运行：

```bash
# 项目和 spec
bun run vos -- --project-root <project-root> doctor
bun run vos -- --project-root <project-root> stage show
bun run vos -- --project-root <project-root> spec lint
bun run vos -- --project-root <project-root> spec check-consistency
bun run vos -- --project-root <project-root> arch compose spec/architecture/seed.yaml

# 构建、运行和验证
bun run vos -- --project-root <project-root> toolchain lint
bun run vos -- --project-root <project-root> build --dry-run
bun run vos -- --project-root <project-root> build
bun run vos -- --project-root <project-root> run qemu --case <case-id>
bun run vos -- --project-root <project-root> test --suite <suite-name>
bun run vos -- --project-root <project-root> verify public

# Agent 和报告
bun run vos -- --project-root <project-root> agent context --scope public
bun run vos -- --project-root <project-root> agent plan --stage <stage>
bun run vos -- --project-root <project-root> agent generate <target> --apply
bun run vos -- --project-root <project-root> report generate --stage <stage>
bun run vos -- --project-root <project-root> submit pack
```

完整说明见 [用户手册](docs/manual/index.md)。

## 开发命令

所有 workspace 命令从 `vos/` 目录运行：

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run vos -- --help
```

启动后端和 Portal 原型：

```bash
bun run dev:agent
bun run dev:web
```

## 推荐阅读

- [用户手册](docs/manual/index.md)：日常使用 `vos` 的入口（命令参考 + Spec Schema）。
- [xv6-spec 示例](examples/xv6-spec/README.md)：跟着一个完整示例跑构建、QEMU 和公开验证。
- [Spec 设计文档](docs/design/spec/README.md)：`spec/` 的结构和写法。
- [VOS Runtime 设计文档](docs/design/toolchain/README.md)：`vos` 如何消费规格并编排命令。
- [Workflow 设计文档](docs/design/workflow/README.md)：课程过程、角色和证据流。
- [Platform 设计文档](docs/design/platform/README.md)：课程平台、评分和审计模型。
- [Agent 设计文档](docs/design/agent/README.md)：Agent 身份、能力和边界。

## 当前状态

当前实现以 Bun / TypeScript 为主。`vos/apps/vos-cli` 是 CLI 入口，`vos/apps/vos-agent` 提供 Agent 后端，`vos/apps/vos-web` 是 Portal 原型前端，`vos/packages/*` 承载逐步拆出的共享运行时能力。
