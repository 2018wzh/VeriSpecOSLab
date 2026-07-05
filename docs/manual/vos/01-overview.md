# 01 概述与项目结构

## 1.1 什么是 VOS

`vos` 是 VeriSpecOSLab 的统一命令入口。它负责读取项目中的 `spec/`（规格目录）和 `.vos/`（配置与运行时目录），执行 lint、构建、运行、测试、验证、报告、提交和 Agent 协作命令。

`vos` 本身不替学生写 OS，也不定义项目该如何构建。它把本地的 `spec/`、ToolchainSpec、阶段约束和受控命令执行编排成一个可审计、可复现的开发与验证闭环。

## 1.2 项目目录结构

一个典型的 VeriSpecOSLab 项目包含：

```text
<project-root>/
├── spec/                  # 设计真相源（必需）
│   ├── architecture/       #   ArchitectureSeed / Slice / ADR / Composition / Synthesis
│   ├── modules/            #   ModuleSpec / ConcurrencySpec / OperationContract / tests
│   ├── composition/        #   跨模块不变量
│   ├── goals/              #   个性化目标
│   ├── evolution/          #   SpecPatch（设计演化记录）
│   ├── toolchain/          #   ToolchainSpec（构建/链接/镜像/运行/调试语义）
│   ├── verification/       #   Public Matrix / Evidence Schema / Report Contract
│   └── reports/            #   学生提交的报告
├── .vos/                   # VOS 配置与运行时产物（自动生成/维护）
│   ├── config.toml         #   Agent provider、KB embedding 配置
│   ├── project.yaml        #   项目 ID、spec 根目录、当前阶段
│   ├── policy.yaml         #   允许的命令、路径、可见性范围
│   ├── toolchain.json      #   物化后的工具链配置
│   ├── toolchain.meta.json #   工具链元信息
│   ├── runs/               #   运行证据（按 run-id 分目录）
│   ├── cache/              #   缓存（补丁影响报告、索引等）
│   ├── index/              #   本地 spec 索引
│   ├── kb/                 #   本地知识库
│   ├── submit/             #   提交包
│   ├── worktrees/          #   Agent 工作区
│   ├── agent-context.json  #   Agent 上下文快照
│   ├── agent-generate.json #   Agent 生成记录
│   ├── agent-log.jsonl     #   Agent 审计日志
│   ├── commit-ledger.jsonl #   提交意图记录
│   └── apply.patch         #   最近应用的补丁
├── kernel/                 # 内核源码（可能由 Agent 生成或学生维护）
├── user/                   # 用户态程序
├── tests/                  # 项目测试
└── build/                  # 构建产物（自动生成）
```

### 1.2.1 `spec/` 目录

`spec/` 是项目的设计真相源，采用七层模型组织：

| 层 | 目录 | 回答的问题 |
|---|---|---|
| Architecture | `spec/architecture/` | 系统目标、参考系统、阶段机制、non-goals |
| Module | `spec/modules/` | 模块状态空间、接口族、模块级不变量 |
| Operation | `spec/modules/*/ops/` | 操作的前置/后置条件、锁规则、失败语义、测试义务 |
| Composition | `spec/composition/` | 跨模块不变量 |
| Evolution | `spec/evolution/` | 设计为什么变化、影响范围、回归测试 |
| Toolchain | `spec/toolchain/` | 构建语义、QEMU/linker/ABI 假设 |
| Verification | `spec/verification/` | 公开验证、证据收集、评分映射 |

### 1.2.2 `.vos/` 目录

`.vos/` 由 VOS 自动生成和维护，不应手工编辑其中的运行时文件。

- **`config.toml`**：Agent provider 配置（provider 类型、模型名、base URL、API key 环境变量、超时）、KB embedding 配置
- **`project.yaml`**：`project_id`、`spec_root`（通常为 `spec`）、`current_stage`（当前实验阶段）
- **`policy.yaml`**：`allowed_commands`（允许的命令列表）、`allowed_paths`（允许读写的路径）、`visibility_scope`
- **`toolchain.json`**：由 `toolchain lint` / `build generate` 物化后的工具链配置，`vos build` 执行时读取
- **`runs/<run-id>/`**：每次命令执行的证据目录，含 `manifest.json`、`events.jsonl`、`artifacts/`

## 1.3 环境依赖

### 1.3.1 运行时

- **Bun** ≥ 1.3：VOS CLI 的运行环境
- 使用 GitHub 仓库安装 VOS CLI：

```bash
bun install -g github:2018wzh/VeriSpecOSLab
vos --help
```

### 1.3.2 项目工具链

具体依赖由项目的 `spec/toolchain/profile.yaml` 和 `.vos/toolchain.json` 声明。xv6-spec 示例项目需要：

- RISC-V 交叉编译工具链：`riscv64-unknown-elf-gcc`、`riscv64-unknown-elf-ld`、`riscv64-unknown-elf-objcopy`、`riscv64-unknown-elf-objdump`
- QEMU 模拟器：`qemu-system-riscv64`
- `make`

### 1.3.3 Agent Provider

如果要使用 `vos agent` 命令（生成代码、审查、问答等），需要在 `.vos/config.toml` 的 `[agent]` 段配置 LLM provider：

```toml
[agent]
provider = "openai-compatible"
model = "your-model-name"
base_url = "https://your-api-endpoint"
timeout_secs = 600

[agent.auth]
env = "YOUR_API_KEY_ENV_VAR"
```

## 1.4 命令运行方式

所有命令通过 `--project-root` 指定项目路径：

```bash
vos --project-root <project-root> <command> [options]
```

例如，对仓库内的 xv6-spec 示例：

```bash
vos --project-root examples/xv6-spec doctor
```

### 1.4.1 全局参数

| 参数 | 说明 |
|------|------|
| `--project-root <path>` | 项目根目录（必需） |
| `--json` | 输出机器可读 JSON |
| `--progress auto\|always\|never` | 控制进度显示 |
| `--agent-session <id>` | 绑定到指定 Agent 会话 |
| `--report <path>` | 指定报告输出路径 |
| `--evidence-dir <path>` | 指定 evidence 写入目录 |

## 1.5 相关文档

- [02 CLI 命令参考（上）：项目、Spec 与架构](./02-commands-spec-arch.md)
- [03 CLI 命令参考（中）：构建、运行与测试](./03-commands-build-run-test.md)
- [04 CLI 命令参考（下）：验证、Agent、报告与知识库](./04-commands-verify-agent-report.md)
- [05 Spec Schema 参考（上）：架构、模块、操作](./05-spec-schema-arch-module-op.md)
- [06 Spec Schema 参考（下）：工具链、验证、演化、目标](./06-spec-schema-toolchain-verify-evolution.md)
