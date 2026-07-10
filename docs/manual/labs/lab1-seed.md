# Lab 1: 准备——项目初始化与技术路线选择

> **对应 Book 章节**：[第 1 章：操作系统初步](../book/ch01-overview-design.md)
>
> Book 第 1 章告诉你"操作系统是什么、各语言和 ISA 有什么特点、为什么要先设计"。本 Lab 卡片告诉你"做什么"和"怎么验证"——请先读完 Book 第 1 章再回来执行本 Lab。

## 1. 设计问题

本 Lab 不写代码。你需要回答三个问题：

1. **你的 OS 项目身份是什么？** — 项目名、目标平台、编程语言。这些是后续所有 Lab 的基础，一旦选定就不轻易更改。
2. **你的技术路线选的什么？为什么？** — ISA 选 RISC-V / x86-64 / ARM？语言选 C / C++ / Rust / Zig？不是随机选——你要有理由。
3. **你的开发环境和知识库如何搭建？** — 工具链安装、Agent 配置、Seed 骨架创建、参考资料导入。它们是你后续九个阶段的"基础设施"。

## 2. 设计空间

| 决策 | 你需要回答的问题 |
|------|----------------|
| 目标 ISA | RISC-V 64 / AArch64 / x86-64？各 ISA 的特权级、页表、中断模型有何差异？详见 [Book §1.10.3](../book/ch01-overview-design.md#1103-问题三你的-os-跑在什么上) |
| 编程语言 | C / C++ / Rust (no_std) / Zig？四种语言的宏观对比、代码实例、OS 开发 vs 普通开发的差异详见 [Book §1.10.4](../book/ch01-overview-design.md#1104-问题四用什么语言写你的内核) |
| 开发环境 | 本地工具链 vs 容器？交叉编译工具链如何安装？ |
| Agent 配置 | 使用什么 LLM provider？Agent 在各阶段能做和不能做什么？详见 [Book §1.7](../book/ch01-overview-design.md#ai-agent-的角色) |
| 知识库 | 需要导入哪些参考资料？导入时机和策略？ |

## 2a. 设计决策引导

### 决策 1：选择目标 ISA

三种主流 ISA 的关键差异已列在 [Book §1.10.3](../book/ch01-overview-design.md#1103-问题三你的-os-跑在什么上) 的对比表中，并附有同一操作在三种 ISA 上的汇编对比——建议先看那些实例再做决定。

**默认推荐：RISC-V 64 + QEMU `virt`。** RISC-V 规范简洁（特权级规范约 100 页，x86 超过 2000 页），QEMU `virt` 是课程工具链的一等公民，xv6-riscv 参考资料最丰富。选择 x86-64 或 ARM 不会受到惩罚——你需要额外调研，并确保课程工具链对你的 ISA 支持到位。

**设计自检**：你选的 ISA 的 syscall 指令是什么？特权级有几层？页表结构的名称是什么？（不必现在就全部精确回答——这些问题会在 Lab 2-5 中逐一展开。但你至少要能说出选这个 ISA 的 2 个理由。）

### 决策 2：选择编程语言

四种语言的宏观对比、代码实例（freelist 页分配器）、OS 开发 vs 普通开发差异、构建系统对比详见 [Book §1.10.4](../book/ch01-overview-design.md#1104-问题四用什么语言写你的内核)——建议先看完再决定。

**默认推荐：C。** 参考资料最丰富（xv6、Linux、OSDev wiki），语法简单，你不会花数周学习语言特性。"内存不安全"在教学场景中反而是优势——你会亲身经历 buffer overflow，从而深刻理解 MMU 和隔离的价值。

如果你已有 C++ 基础，选 C++ 也可以——RAII 和模板能减少重复代码，但需要在 freestanding 环境下禁用异常（`-fno-exceptions`）和 RTTI（`-fno-rtti`），且 STL 容器不可用。详见 [Book §1.10.4c](../book/ch01-overview-design.md#1104c-从普通开发到-os-开发四种语言的关键差异)。

选择 Rust、Zig 或 C++ 不会受到惩罚，你需要在后续 Lab 中自行解决语言特有的问题（Rust 的 `unsafe` 边界、Zig 的交叉编译配置、C++ 的全局构造函数和 vtable 管理）。

**设计自检**：如果你选的语言不是你最熟悉的——你知道它在 OS 开发中需要禁用哪些特性吗？（如 C++ 的异常/RTTI、Rust 的 std。）在 [Book §1.10.4c](../book/ch01-overview-design.md#1104c-从普通开发到-os-开发四种语言的关键差异) 查"✗ 丢失"列。

### 决策 3：开发环境

| 方案 | 优点 | 缺点 | 适合 |
|------|------|------|------|
| **本地工具链** | 响应快、与编辑器集成好 | 不同 OS 安装方式不同，环境问题自己排查 | 推荐。本课程的工具链安装已尽量简化 |
| **容器（Docker）** | 环境一致，队友间可复现 | 需额外学习 Docker，文件系统多一层间接 | 对本地环境有洁癖的；团队协作 |

**默认推荐：本地安装。** 课程工具链（Bun + vos + RISC-V GCC）在 macOS/Linux/Windows WSL2 上均经过验证。如果选 C++，需要额外安装 `riscv64-unknown-elf-g++`。

### 决策 4：Agent 配置策略

Agent 的定位和约束在 [Book §1.7](../book/ch01-overview-design.md#ai-agent-的角色) 中有详细说明。核心原则：**让 AI 帮你思考，但不替你思考。**

vos-agent 支持五种 LLM provider：**Anthropic**（Claude）、**OpenAI**（GPT/o 系列）、**OpenAI-compatible**（兼容网关，如 Azure/DeepSeek API/自建代理）、**DeepSeek**（原生 DeepSeek API）、**Ollama**（本地模型）。Lab 1 阶段至少配置一个。

**API key 不要放在 shell 配置文件里。** 推荐使用项目根目录的 `.env` 文件，配合 `.vos/config.toml` 声明使用哪个 key。这套机制是 vos-agent 的原生设计——不需要手动 `export` 环境变量，也避免了 key 通过 shell history 或 `env` 命令泄露。

---

## 2b. 逐步操作指引

以下是阶段 1 的推荐执行步骤。每一步后面标注了"自检点"——如果卡住了，说明哪个前置步骤可能没做对。

### 步骤 1：安装 vos 工具链（预计 10 分钟）

```sh
# 1. 安装 bun
# 详见 https://bun.com/docs/installation

# 2. 安装 vos 工具链
bun install -g vos@latest
```

**自检点**：运行 `vos --help` 能看到命令列表。如果提示 `command not found`，检查 Bun 的全局 bin 目录是否在 PATH 中。

### 步骤 2：初始化项目（预计 10 分钟）

```sh
mkdir my-os
cd my-os

git config user.name "Your Name"
git config user.email "you@example.com"

vos init
```

`vos init` 会创建 VOS 本地配置、默认策略、`.gitignore` 和 `AGENTS.md`。`.gitignore` 中已包含 `.vos/` 和 `.env` 两条规则——你的 API key 文件和 VOS 运行时目录都不会被 Git 追踪。如果当前目录还不是 Git 仓库，`vos init` 会先执行 `git init`。如果仓库还没有初始提交，它只会暂存并提交自己创建或维护的初始化入口文件，不会把你的草稿一起提交。

如果 `vos init` 提示缺少 Git 用户名或邮箱，先按上面的命令配置本仓库的 Git identity.


### 步骤 3：配置 Agent（预计 15 分钟）

Agent 受三层约束（详见 [Book §1.7](../book/ch01-overview-design.md#ai-agent-的角色)）。Lab 1 阶段只开放知识库查询，不允许代码生成。

**3a. 创建 `.env` 文件**

在项目根目录创建 `.env`，写入 API key。`vos init` 已自动将 `.env` 加入 `.gitignore`，不会被 Git 追踪。

```sh
# .env — 放在项目根目录，不要提交到 Git
# vos-agent 自动读取此文件中的变量

# === Anthropic（Claude 系列）===
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

# === OpenAI 兼容网关（最灵活）===
# 适用于 DeepSeek API、Azure OpenAI、ECNU 网关、自建代理等
OPENAI_COMPATIBLE_API_KEY=your-key-here

# === DeepSeek 原生 API ===
# DEEPSEEK_API_KEY=sk-your-deepseek-key
```

> **安全提醒**：`.env` 文件包含明文 API key。`vos init` 已自动将 `.env` 加入 `.gitignore`。永远不要通过聊天工具、截图、或粘贴到共享文档的方式泄露其中的内容。

**3b. 创建 `.vos/config.toml`**

`.env` 存 key，`.vos/config.toml` 声明用哪个 provider、哪个 key。创建 `.vos/config.toml`：

**示例 A：OpenAI-compatible 网关**


```toml
[agent]
provider = "openai-compatible"
model = "compat:your-model-name"
base_url = "https://your-gateway.example.com/v1"
timeout_secs = 600

[agent.auth]
env = "OPENAI_COMPATIBLE_API_KEY"   # 指向 .env 中的变量名
```

**示例 B：Ollama 本地模型（离线可用）**

```toml
[agent]
provider = "ollama"
model = "ollama:qwen3:14b"
```

Ollama 模式不需要 API key——`ollama serve` 默认监听 `localhost:11434`。

**3b. 配置 `kb.embedding`**

`agent ask` 与 `kb` 命令会分别复用：

- `[agent]`：模型推理与对话
- `[kb.embedding]`：知识库向量检索

```toml
[kb.embedding]
provider = "openai-compatible"
model = "text-embedding-3-small"
base_url = "https://api.openai.com/v1"

[kb.embedding.auth]
env = "OPENAI_API_KEY"
```

**3c. 验证 Agent**

```sh
vos agent ask -i
```

Agent 进入交互模式，且询问问题有回答 = 配置成功。报 `provider not configured` = 检查 `.vos/config.toml` 中 `provider` 字段是否正确、`.env` 中的 key 变量名是否与 `auth.env` 一致。

**3d. 理解 AGENTS.md**

`vos init` 已在项目根目录创建了 `AGENTS.md`。打开看一眼——Agent 每次被调用时，会先读这份文件理解你的项目约定和边界。Lab 1 阶段你不需要修改它。后续阶段如果你引入新的设计规则（如"所有 syscall 编号从 100 开始"），更新 `AGENTS.md` 让 Agent 知道。

**3e. Agent 在 Lab 1 的正确用法**

Lab 1 的 Agent 用于**问答和解释**——不是替你决策：

```sh
# 推荐用法
vos agent ask -i
> RISC-V 和 x86-64 在教学场景下各有什么优劣？
> 用 Rust 写内核，no_std 环境下哪些标准库功能不可用？
> OS 的"职责边界"具体指什么？
```

| Agent 能做的 | Agent 不能做的 |
|-------------|---------------|
| 解释不同 ISA 的启动流程差异 | 替你决定语言和 ISA |
| 对比编程语言在 OS 开发中的生态和工具链 | 生成任何 `.c`/`.cpp`/`.rs`/`.zig` 实现代码 |
| 回答 OS 基本概念（MMU、特权级等） | 替你写 `seed.yaml` |
| 审查 seed 骨架格式是否正确 | 跳过 Lab 1 直接进入 Lab 2 |

**自检点**：`vos agent ask` 返回有效回答。你对 Agent 的"能做什么/不能做什么"边界有自己的理解。

### 步骤 4：创建 Seed 骨架（预计 20 分钟）

Seed（`spec/architecture/seed.yaml`）是你 OS 设计文档的核心。**在 Lab 1，你只填写身份信息**——goals、non_goals、reference_systems 等在后续 Lab 中逐步填充。Seed 是逐步生长的设计锚点，不是一次填满的表格（详见 [Book §1.9](../book/ch01-overview-design.md#19-为什么先设计再写代码)）。

> 📖 **预览**：完整的 ArchitectureSeed 长什么样？[Book §1.12](../book/ch01-overview-design.md#112-architectureseed-参考示例) 展示了三种不同设计立场的完整示例（教学优先 / 兼容 Linux / capability 微内核）。先看一眼知道"未来会长成这样"，然后回来只填身份信息。

```sh
mkdir -p spec/architecture
```

创建 `spec/architecture/seed.yaml`，填入身份字段（标记 `TODO` 的字段在对应 Lab 中补充）：

```yaml
# ============================================================
# Lab 1 填写：身份信息
# ============================================================
id: my-os-seed
project: my-os
domain: teaching-operating-system
target_platform: riscv64-qemu-virt    # 或 x86-64 / arm64
language: c                            # 或 cpp / rust / zig
architecture_name: my-os
architecture_summary: >
  用一句话说明你的 OS 目标和主要取舍。
  （此时可以模糊——后续 Lab 中逐步细化。）

# ============================================================
# Lab 2 填写：启动策略
# ============================================================
constraints:
  - "TODO: Lab 2 填入启动方式、bootloader 选择、内存布局约束"

# ============================================================
# Lab 3 填写：内存模型
# ============================================================
# constraints 追加：分页模型、物理内存范围
# TODO: Lab 3

# ============================================================
# Lab 4 填写：设备与中断模型
# ============================================================
# TODO: Lab 4

# ============================================================
# Lab 5 填写：内核架构 + 进程模型 + syscall 策略
#   这是种子最重要的更新节点。
#   goals, non_goals, reference_systems 在此阶段首次填写。
# ============================================================
goals:
  - "TODO: Lab 5 填入至少 3 条具体目标"
non_goals:
  - "TODO: Lab 5 填入至少 3 条明确排除的内容"
reference_systems:
  # TODO: Lab 5 填入参考系统及 borrow/modify/reject 分析

# ============================================================
# Lab 6 填写：文件系统策略
# ============================================================
# TODO: Lab 6

# ============================================================
# Lab 7 填写：资源模型
# ============================================================
# TODO: Lab 7

# ============================================================
# Lab 8 填写：个性化目标
# ============================================================
# TODO: Lab 8

# ============================================================
# Lab 9 填写：硬件移植约束
# ============================================================
# TODO: Lab 9

# ============================================================
# Final Lab 汇总：validation_binding 汇总
# ============================================================
initial_validation_binding:
  - "TODO: 各 Lab 的验证判据在对应阶段收集，Final Lab 汇总"
```

> **为什么 Seed 是逐步填充的？** 在 Lab 1 就要求你决定内核架构和系统目标有三个问题：没有上下文的选择只能是猜；早期决策推翻时没有记录机制；一次性填满像填表。逐步填充让你在真正面对设计问题时才做选择——每个决策都绑着一个你亲手撞过的墙。详见 [Book §1.9](../book/ch01-overview-design.md#19-为什么先设计再写代码)。

**后续 Lab 如何使用 Seed**：每个 Lab 结束时，根据该 Lab 的设计问题填写对应的 `TODO` 字段、有冲突决策写 ADR、运行 `vos seed status` 检查进度、运行 `vos stage save` 保存状态。

**自检点**：`seed.yaml` 的身份字段全部填写完毕（非 TODO），`architecture_summary` 不是空话。

### 步骤 5：导入知识库（预计 15 分钟）

Agent 的问答依赖知识库——只有你导入的资料，Agent 才能在设计问答中引用。每个阶段开始前导入该阶段需要的资料，不要一次性导入所有。

`vos kb add` 支持三种来源，全部接受 URL 或本地路径：

| 来源类型 | 示例 | 下载进度条 | 说明 |
|----------|------|:------:|------|
| **HTML 网页** | `https://wiki.osdev.org/...` | ✅ | 自动去除标签，保留纯文本 |
| **PDF 文件** | `https://example.com/spec.pdf` | ✅ | 自动提取文本（基于 unpdf） |
| **Markdown / 纯文本** | `https://example.com/readme.md` | ✅ | 直接索引原文 |
| **Git 仓库** | `https://github.com/...git` | ✅ (clone 进度) | 按分支克隆后索引文本文件 |
| **本地文件/目录** | `./riscv-privileged.pdf` | — | 支持 PDF、Markdown、Office 文档等 |

```sh
# 1. 导入项目 spec（所有路线通用）
vos kb add spec --source-kind project --recursive
```

**如果你选择了默认推荐路径（C + RISC-V）：**

```sh
# RISC-V 特权级规范（官方 GitHub Release，PDF，自动下载并提取文本）
vos kb add https://github.com/riscv/riscv-isa-manual/releases/download/riscv-isa-release-8c2e6a6-2025-05-22/riscv-privileged.pdf \
    --source-kind course --title "RISC-V Privileged Specification"

# xv6 教材（MIT 6.828 官方 PDF）
vos kb add https://pdos.csail.mit.edu/6.828/2024/xv6/book-riscv-rev4.pdf \
    --source-kind course --title "xv6: A Simple, Unix-like Teaching Operating System"

# OSDev Wiki 入门指南（HTML）
vos kb add https://wiki.osdev.org/Getting_Started --source-kind external --title "OSDev Getting Started"
vos kb add https://wiki.osdev.org/RISC-V_Bare_Bones --source-kind external --title "OSDev RISC-V Bare Bones"
```

**如果你选择了 Rust：**

```sh
# Rust Embedded Book（官方在线书籍，HTML）
vos kb add https://docs.rust-embedded.org/book/intro/index.html --source-kind external --title "The Embedded Rust Book"

# rCore-Tutorial-Book v3（清华大学 rCore 官方教程，中文，HTML）
vos kb add https://rcore-os.cn/rCore-Tutorial-Book-v3/ --source-kind external --title "rCore-Tutorial-Book v3"

# Rust 裸机编程参考
vos kb add https://docs.rust-embedded.org/embedonomicon/preface.html --source-kind external --title "The Embedonomicon"
```

**如果你选择了 C++：**

```sh
# OSDev Wiki C++ 专题（HTML）
vos kb add https://wiki.osdev.org/C%2B%2B --source-kind external --title "OSDev: C++ in OS Development"
vos kb add https://wiki.osdev.org/C%2B%2B_Bare_Bones --source-kind external --title "OSDev: C++ Bare Bones"

# SerenityOS（Git 仓库）
vos kb add https://github.com/SerenityOS/serenity --source-kind external --branch master --title "SerenityOS"
```

**如果你选择了 Zig：**

```sh
# OSDev Wiki Zig 专题（HTML）
vos kb add https://wiki.osdev.org/Zig --source-kind external --title "OSDev: Zig in OS Development"

# Zig 语言参考（官方，HTML）
vos kb add https://ziglang.org/documentation/master/ --source-kind external --title "Zig Language Reference"
```

所有路线通用（建议全部导入）：

```sh
# OSDev Wiki 核心页面
vos kb add https://wiki.osdev.org/Memory_management --source-kind external --title "OSDev: Memory Management"
vos kb add https://wiki.osdev.org/Interrupts --source-kind external --title "OSDev: Interrupts"
vos kb add https://wiki.osdev.org/Filesystems --source-kind external --title "OSDev: Filesystems"
```

> **提示**：`vos kb add` 对 HTML 页面会自动去除标签保留纯文本，对 PDF 文件会自动提取文本（基于 `unpdf`），对 Git 仓库会按分支克隆后索引文本文件。下载过程中会显示进度条——如果卡住，检查网络连接和 URL 是否可访问。

**自检点**：`vos kb list` 能看到项目 spec 和至少一份与你技术路线相关的参考资料。

### 步骤 6：检查与保存（预计 5 分钟）

```sh
vos stage save --intent "initialize project and create seed skeleton"
```


**自检点**：`vos stage save` 成功（无报错）。

---

## 3. 背景阅读

- [Book 第 1 章：操作系统初步](../book/ch01-overview-design.md) — 全部。§1.2–§1.3 讲 OS 是什么（历史、裸机对比），§1.7 讲 Agent 的角色，§1.9 讲为什么先设计，§1.10.3 讲 ISA 选择（附汇编对比），§1.10.4 讲四语言对比（宏观表、freelist 代码实例、OS 开发 vs 普通开发差异、构建系统），§1.12 展示 ArchitectureSeed 完整示例。
- [附录：开发环境搭建](../appendices/dev-environment-setup.md) — 各操作系统的工具链安装细节。
- [附录：RISC-V 参考](../appendices/riscv-reference.md) — 如选了 RISC-V，花半小时浏览，不需要背。
- [附录：vos 命令速查](../appendices/vos-commands.md) — `vos init` / `vos doctor` / `vos agent ask` / `vos kb add` / `vos stage save` 等。

---

## 4. 质量门禁

**自动检查**：

- [ ] `vos doctor` 通过。
- [ ] `.env` 已添加到 `.gitignore`（`git status` 看不到 `.env` 文件）。
- [ ] `seed.yaml` 存在，`id`/`project`/`domain`/`target_platform`/`language`/`architecture_name`/`architecture_summary` 均已填写（非 TODO）。
- [ ] `vos kb list` 能看到项目 spec 和至少一份与技术路线相关的参考资料。
- [ ] `vos stage save --intent "initialize project and create seed skeleton"` 已完成。

**手动检查**：

- [ ] 理解 OS 的四个核心职责（资源复用、隔离保护、硬件抽象、服务接口），能用自己的话解释。详见 [Book §1.3.5](../book/ch01-overview-design.md#135-操作系统到底解决了什么问题)。
- [ ] 语言和 ISA 的选择有理由（不是随机选的）。如果是默认推荐路径，至少理解"为什么推荐 RISC-V + C"。
- [ ] `seed.yaml` 的 `architecture_summary` 不是空话——虽不精确，但要反映出大致的意图方向。
- [ ] 理解 Agent 的三层约束（Identity / Capability Pack / Stage Gate），知道 Lab 1 阶段 Agent 能做什么/不能做什么。
- [ ] API key 存放在 `.env` 文件中，不在 shell 配置文件或共享文档中。

---

## 5. AI 使用边界

**允许**：

- 让 AI 解释不同 ISA 的差异（如"RISC-V PLIC 和 ARM GIC 的中断模型有什么不同？"）。
- 让 AI 对比语言在 OS 开发中的优劣。
- 让 AI 解释 OS 的基本概念（如"什么是 MMU？""什么是特权级？"）。
- 让 AI 审查 seed 骨架格式是否正确。
- 让 AI 帮助诊断 Agent 配置问题（如"为什么 vos agent ask 报 provider not configured？"）。

**不允许**：

- 让 AI 替你决定语言和 ISA。
- 让 AI 替你写 `architecture_summary`。
- 让 AI 生成实现代码（阶段 1 未开放代码生成能力）。
- 跳过 Lab 1 直接进入 Lab 2（seed 骨架是后续所有 Lab 的前提）。
- 将 `.env` 文件内容粘贴给 AI（API key 是敏感信息）。

---

## 6. 提交物

- 代码仓库地址
