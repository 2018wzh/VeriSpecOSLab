# Lab 1: 项目初始化与操作系统初步

## 1. 本 Lab 要解决什么

本 Lab 的重点不是马上写代码，而是把项目从空目录推进到一个可检查、可追踪的 VOS 项目，并写出第一版 ArchitectureSeed。

你要先回答一个问题：这个 OS 为什么存在？目标确定后，再选择内核架构、目标平台、ABI、参考系统和验证判据。后续阶段遇到取舍时，都要回到这份 seed 看你的目标和 non-goals。

## 2. 从 0 起步

首先需要安装 Bun（[https://bun.sh/](https://bun.sh/)），然后安装工具链

```sh
bun install -g -f github:2018wzh/VeriSpecOSLab
```
这条命令需要在每次 lab 开始前运行一次，确保你用的是最新版本的 `vos` 工具链，然后准备在一个新目录中开始课程项目。

```sh
mkdir my-os
cd my-os

vos init
vos doctor
```

`vos init` 会创建 VOS 本地配置、默认策略、`.gitignore` 和 `AGENTS.md`。如果当前目录还不是 Git 仓库，它会先执行 `git init`。如果仓库还没有初始提交，它只会暂存并提交自己创建或维护的初始化入口文件，不会把你的草稿、下载资料或本地实验文件一起提交。

如果 `vos init` 提示缺少 Git 用户名或邮箱，先配置本仓库的 Git identity，再重新运行：

```sh
git config user.name "Your Name"
git config user.email "you@example.com"
vos init
```

## 2a. 配置 Agent

`vos init` 已经在项目根目录创建了 `AGENTS.md`。这份文件定义了 AI Agent 在本项目中的行为边界——它能读什么、改什么、用什么工具。在你开始写 ArchitectureSeed 之前，花五分钟把 Agent 配置好，后续九个阶段你会反复用到它。

### 2a.1 Agent 是什么

VeriSpecOSLab 内置了一个项目级 AI Agent（基于 `vos-agent`），它不是你平常用的通用聊天 AI。Agent 受三层约束：

1. **身份（Identity）** — 决定 Agent 扮演什么角色。Lab 1 阶段主要用到 `knowledgebase.v1`（设计问答）和 `spec-author.v2`（规格审查）。
2. **能力包（Capability Pack）** — 限制 Agent 能调用哪些工具、能读写哪些路径。
3. **阶段门禁（Stage Gate）** — 根据你当前所处的实验阶段，动态开放或关闭 Agent 的能力。阶段 1 只开放知识库查询和规格审查，不允许生成代码。

这三层约束的核心目的：**让 AI 帮你思考，但不替你思考。**

### 2a.2 配置 Provider

Agent 依赖 LLM provider 运行。至少配置一个 provider 的 API key。推荐同时配置两个——`smart` 模式（Anthropic）用于日常问答，`deep` 模式（OpenAI 兼容）用于复杂设计推理。

```sh
# 方案 A：只用 Anthropic（够用）
export ANTHROPIC_API_KEY="sk-ant-..."

# 方案 B：Anthropic + OpenAI（推荐）
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

如果你使用 OpenAI 兼容的第三方 provider（如 Azure、DeepSeek、本地 Ollama），额外配置 `OPENAI_BASE_URL`：

```sh
export OPENAI_BASE_URL="https://your-provider.com/v1"
export OPENAI_API_KEY="sk-..."
```

验证配置是否生效：

```sh
vos agent ask "解释 xv6 的 Sv39 分页设计中，为什么选择三级页表而不是二级或四级？"
```

如果 Agent 返回了有引用的回答，配置成功。如果报 `provider not configured`，检查环境变量是否正确 export，以及 key 是否有效。

### 2a.3 理解 AGENTS.md

打开项目根目录的 `AGENTS.md`。初始内容大致如下：

```markdown
# AGENTS.md

Guidance for agents and humans working in this VOS project.

## Project
This is a VeriSpecOSLab teaching OS project. ...

## Agent Instructions
- Inspect relevant specs and existing files before proposing patches.
- Keep changes scoped to the requested task and allowed paths.
- Do not edit generated `.vos/runs/` or `.vos/worktrees/` artifacts.
```

Lab 1 阶段你不需要修改这份文件。但理解它的作用很重要：**Agent 每次被调用时，会先读这份文件来理解你的项目约定和边界。** 后续阶段如果你引入了新的设计规则（比如"所有 syscall 编号必须从 100 开始"），你应该更新 `AGENTS.md` 让 Agent 知道。

### 2a.4 Agent 在设计阶段的使用方式

阶段 1 的核心产出是 ArchitectureSeed——一份设计文档。Agent 在这个阶段的正确用法是**设计对话**，不是**代写答案**。

**推荐的 Agent 使用模式：**

```sh
# 进入交互式设计问答模式（knowledgebase.v1 身份）
vos agent ask -i

# 然后尝试这些对话：
> xv6 的进程模型和 Linux 的进程模型在设计哲学上有什么不同？我的 OS 目标是教学清晰性优先，应该更接近哪个？
> 我选了宏内核架构。宏内核的哪些设计选择会和"安全隔离"这个 goal 冲突？
> 看我的 seed.yaml 草稿：我的 goals 和 non_goals 之间有矛盾吗？
```

**阶段 1 中 Agent 不能做的事：**

- 替你写 seed.yaml（`spec-author.v2` 可以审查你写的草稿，但不能替你起草）
- 替你决定内核架构（可以列出选项和后果，但不能说"你应该选 X"）
- 生成任何 `.c`/`.rs`/`.zig` 实现代码（阶段 1 未开放代码生成能力）

**阶段 1 中 Agent 擅长的事：**

- 解释参考系统（xv6、Linux、seL4）的具体机制
- 审查你的 ArchitectureSeed 草稿——目标是否过大、non-goals 是否太少、验证判据是否可测
- 提醒你某个设计选择会影响哪些后续阶段
- 根据你的目标从 KB 中检索相关的设计案例和参考资料

### 2a.5 知识库（KB）准备

Agent 的设计问答依赖知识库。知识库的具体导入步骤见下方 [§7 导入知识库](#7-导入知识库)——

这里先记住一点：**知识库是你的 Agent 的"记忆"。只有你导入的资料，Agent 才能在设计问答中引用。** 后续每个阶段开始前，导入该阶段需要的参考资料——不要一次性导入所有资料，避免 Agent 的检索质量下降。

---

## 3. 目标先行

在写 `seed.yaml` 之前，先写下三类内容：

- 你最想训练或证明的能力，例如教学清晰性、Linux 静态 ELF 兼容、capability 隔离、启动速度或可验证性。
- 你明确不做的事情，例如网络、多用户、动态链接、完整 POSIX、真实硬件移植。
- 你的约束，例如一学期时间、单人项目、RISC-V 64 + QEMU `virt`、C/Rust/Zig 中的一种语言。

目标要能影响设计。比如“教学清晰性优先”会推向更少的抽象层和更简单的 syscall 集；“安全隔离优先”可能推向 capability 或微内核；“兼容 Linux 静态 ELF”会让 ABI、ELF loader 和 syscall 编号更早变成硬约束。

## 4. 规格文件

创建目录：

```sh
mkdir -p spec/architecture
```

### 4.1 ArchitectureSeed

创建 `spec/architecture/seed.yaml`。至少包含这些字段：

```yaml
id: my-os-seed
project: my-os
domain: teaching-operating-system
target_platform: riscv64-qemu-virt
architecture_name: my-os
architecture_summary: >
  用一句话说明你的 OS 目标和主要取舍。

reference_systems:
  - system: xv6-riscv
    borrowed_concepts:
      - "例如：Sv39 分页和简单进程模型"
    modified_concepts:
      - "例如：缩小 syscall 集合"
    rejected_concepts:
      - "例如：暂不做多核"
    reason: "说明为什么借鉴、修改或拒绝这些机制。"

goals:
  - "至少 3 条，必须具体。"
non_goals:
  - "至少 3 条，说明本项目不优化或不实现什么。"
constraints:
  - "写清 ISA、目标平台、语言、工具链和时间约束。"
initial_validation_binding:
  - "至少 3 条可检查判据，例如 qemu_boot_smoke。"
```

详细字段见 [ArchitectureDesignSpec 编写指南](../specs/architecture-design-spec.md)。

## 5. 可选：裸机编程参考阅读

> 如果你有 STM32 或 Arduino 裸机编程经验，建议在写 ArchitectureSeed 之前阅读 [附录：裸机编程参考](../appendices/stm32-bare-metal-lab.md)。该附录以 STM32F103 为例，对比展示了同一任务在裸机和 OS 环境下的完整代码差异，帮助你明确"我的 OS 至少要抽象掉哪些裸机细节"。

读完后，在 ArchitectureSeed 的 `design_notes` 中记录你的发现：

```yaml
design_notes:
  - "基于裸机对比参考，本 OS 至少需要抽象：(1) 硬件无关的输出接口，(2) 非忙等的延时机制，(3) 多任务间的内存隔离"
```

---

## 6. 检查与保存

完成 seed、composition 和 KB 导入后，运行：

```sh
vos spec lint
vos arch lint
vos stage save --intent "complete architecture seed"
```

## 7. 导入知识库

先把项目 spec 加入本地 KB：

```sh
vos kb add spec --source-kind project --recursive
```

再按你的设计目标导入至少一份参考资料。资料可以来自课程发放的本地文件，也可以是你自己选择的公开参考资料。

```sh
vos kb add docs/reference/xv6-book.pdf --source-kind course --title "xv6 book"
vos kb list
```

如果你选择微内核、capability、Linux ELF 兼容或硬件移植，参考资料也应对应这些目标。不要只导入和自己路线无关的材料。

## 8. 质量门禁

自动检查：

- [ ] `vos spec lint` 通过。
- [ ] `vos arch lint` 通过。
- [ ] `vos kb list` 能看到项目 spec 和至少一份与你目标相关的参考资料。
- [ ] `vos stage save --intent "complete architecture seed"` 已完成阶段保存。

手动检查：

- [ ] `goals` 和 `non_goals` 都具体，能影响后续设计选择。
- [ ] 参考系统不是标签式引用，写清借鉴、修改和拒绝的具体机制。
- [ ] 至少一项拒绝理由说清了代价或边界。
- [ ] `initial_validation_binding` 都能落到可观测检查，不写“系统稳定”“体验良好”这类空泛目标。
- [ ] CompositionSpec 至少包含一条和目标相关的跨组件规则。
- [ ] （可选）完成裸机对比实验，ArchitectureSeed 中记录了至少一条"本 OS 需要抽象掉的裸机细节"。

## 9. AI 使用边界

允许：

- 让 AI 解释参考系统的机制。
- 让 AI 审查 seed 草稿是否目标过大、non-goals 太少、验证判据不可测。
- 让 AI 提醒你某个目标会影响哪些后续阶段。

不允许：

- 让 AI 替你决定目标和设计哲学。
- 直接跳过 ArchitectureSeed 进入 boot 代码。
- 把没有理解的参考系统机制写进 borrowed_concepts。

## 10. 提交物

- 代码仓库地址
- `vos kb list` 输出摘要
- `vos spec lint`、`vos spec check-consistency`、`vos arch lint` 输出摘要
- `vos stage save --intent "complete architecture seed"` 的完成摘要
