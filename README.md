# VeriSpecOSLab

VeriSpecOSLab 是一个面向操作系统课程与实验的 **Spec-first**
TypeScript 项目仓库。它把学生本地 `spec/`、受控工具链 `vos`、
验证与证据采集、以及 Agent 协作治理放在同一条可审计、可复现的闭环里。

这个仓库当前主要包含三部分：

- `vos/`：Bun / TypeScript workspace，实现统一命令入口、Agent Gateway、HTTP façade (`vos serve`)、Portal 原型前端（`apps/vos-web`）与 runner 控制面。
- `docs/design/`：项目设计文档，定义平台、Spec、Toolchain、Workflow、Agent 的边界与协作方式
- `examples/xv6-spec/`：规格驱动的 xv6 参考实验项目

## 项目目标

VeriSpecOSLab 的设计目标不是“让 AI 直接代写一个完整内核”，而是把开发过程约束在结构化规格和验证反馈之下：

- 先写设计，再写实现，再用证据证明一致性
- 通过 `spec/`、`ToolchainSpec`、构建/测试/验证结果形成闭环
- 让 Agent 在受控上下文中工作，而不是绕过规格和门禁
- 让课程平台、CI、Judge、教师与学生共享同一套可追溯数据模型

## 仓库结构

目标实现按 TypeScript package 与 app 划分：

```text
.
├── docs/
│   └── design/              # 平台、Spec、Toolchain、Workflow、Agent 设计文档
├── examples/
│   └── xv6-spec/            # xv6 规格驱动示例项目
└── vos/
    ├── packages/            # VOS Runtime 与 CLI 的目标 package 边界
    │   ├── vos-core         # 共享类型：RunManifest、CommandOutcome、EvidenceRef
    │   ├── vos-spec         # Spec 解析、lint、normalize 与一致性检查
    │   ├── vos-policy       # stage、路径、可见性与工具策略
    │   ├── vos-evidence     # .vos/runs 写入、events.jsonl、manifest
    │   ├── vos-server       # vos serve HTTP façade 的 runtime 入口
    │   ├── vos-runtime      # build/run/test/verify DAG 执行
    │   ├── vos-adapter      # Makefile、QEMU、test harness adapter
    │   ├── vos-agent-session # agent session 上下文、调用与校验编排
    │   ├── vos-kb           # 知识库与向量索引复用层
    └── apps/
        ├── vos-agent        # LLM runner后端
        ├── vos-cli          # 工具链CLI
        ├── vos-web          # vos-portal prototype front-end (course portal UI)
        └── vos-portal       # 完整Portal实现
```

当前代码已经包含 `apps/vos-agent` 与 `vos-portal`（当前原型实现为
`apps/vos-web`）；`packages/*`
已开始将 CLI / runtime / evidence / policy 拆分为共享 TypeScript
包边界（`vos-agent-session`、`vos-server` 等），并持续向兼容的运行时入口收敛。

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

目标命令包括：

```bash
vos stage show
vos spec lint spec/architecture/seed.yaml
vos spec normalize spec/modules/kernel/memory/module.yaml
vos spec check-consistency spec
vos arch lint spec/architecture/seed.yaml
vos arch compose spec/architecture/seed.yaml
vos arch derive-tests spec/architecture/seed.yaml
vos build
vos run qemu --case boot-smoke
vos test usertests_all_pass
vos verify public
vos debug explain-log path/to/log
vos agent context --stage memory-management
vos agent plan --stage memory-management "check allocator design"
vos agent generate kernel/memory
vos agent apply-patch --require-spec --run-validation patch.diff
vos agent log
vos report generate --stage memory
vos report generate --final
vos submit pack
```

所有课程命令应支持 `--json`、`--project-root` 与 `--agent-session`；
所有执行类命令都应写入 `.vos/runs/<run-id>/manifest.json` 与
`.vos/runs/<run-id>/events.jsonl`。

`vos report generate` 会严格读取 `spec/verification/report-contract.yaml`、
`verify public` evidence、commit ledger 与 Agent 审计日志，生成
`spec/reports/` 下的 Markdown 报告和 `.vos/report/` 下的 JSON summary。
报告生成包含 `reporter.v2` Agent narrative；Agent 输出非法或缺少必要
evidence 时命令失败。成功后 VOS 自动提交报告产物并为新 `HEAD` 追加 ledger
记录。

### 3. Agent

Agent 不是自由执行的聊天机器人，而是受规格和验证约束的协作组件。设计里强调：

- spec-bound generation
- two-phase prompting
- validator-driven retry loop
- 审计日志与证据归档

`vos agent` 子命令作为 `vos-agent` 的受控 wrapper：CLI / runtime 先构造
`ContextBundle` 与 `PromptEnvelope`，再用版本化固定 prompt 调用 `vos-agent`
headless runner，并在返回后校验结构化输出、写入 evidence 与
`AICollaborationLog`。prompt 负责角色行为与输出契约；policy、patch gate、
stage gate 和最小验证 DAG 必须由确定性 runtime 裁决。

### 4. 平台与工作流

`docs/design/platform/` 和 `docs/design/workflow/` 描述课程平台与教学流程如何围绕同一闭环运转，包括：

- 课程、实验、阶段门禁
- 仓库与工作区 provision
- 验证、评分与证据归档
- 教师、助教、学生、Agent 的职责边界

## 运行环境

基础要求：

- [Bun](https://bun.sh) 1.3 或更新版本
- Node 兼容工具链，用于前端依赖与脚本
- 若要执行 OS 相关实验，还需要对应的本地交叉编译工具、模拟器和依赖

安装与验证当前 workspace：

```bash
cd vos
bun install
bun run typecheck
bun run test
```

启动当前 Agent / Portal 后端：

```bash
cd vos
bun run dev:agent
```

启动前端（`vos-portal`，当前原型实现仍为 `vos-web`）：

```bash
cd vos
bun run dev:web
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
- `agent/` 说明 Agent runtime 的角色、上下文、固定 prompt wrapper 与修复循环

## 示例项目

`examples/xv6-spec/` 是一个规格驱动的 xv6 内核示例，包含：

- `spec/architecture/`：架构切片、决策和组合
- `spec/modules/`：模块和操作级约束
- `spec/toolchain/`：构建、运行和调试契约
- `spec/verification/`：验证与证据格式
- `.vos/`：运行时产生的缓存、执行记录与报告

你可以把它当作一个参考模板，理解怎样把 OS 实验组织成可验证的工程流程。

## 当前状态

这个仓库的设计文档已经把目标闭环定义得比较完整，但实现仍在演进中。当前实际代码以 Bun / TypeScript 为主：

- `vos/apps/vos-agent` 已实现 LLM provider、agent loop、TUI、OpenAI-compatible façade 与 demo Portal API
- `vos/apps/vos-web` 目前是 `vos-portal` 的原型实现，已实现前端原型能力
- `vos/packages/*` 所描述的 CLI / runtime / evidence / policy package 已进入第一阶段拆分，`vos-server` 已从 `apps/vos-cli` 提供的 `serve` 路由中分离。

如果你要继续推进实现，下一步通常是：

1. 先读 `docs/design/spec/README.md`
2. 再读 `docs/design/agent/10-typescript-cli-wrapper.md`
3. 然后从 `vos/apps/vos-agent/TODO.md` 的 course runtime integration 清单开始拆任务
