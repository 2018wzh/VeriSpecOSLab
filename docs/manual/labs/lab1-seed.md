# Lab 1：CTF 热身与项目初始化

> **对应教材**：[第 1 章：操作系统初步](../book/ch01-overview-design.md)

> **本 Lab 概览**
>
> - **学完能做什么**：在 Linux 和裸机两种环境读取同一份 flag 镜像，建立"操作系统替程序做了什么"的直觉；随后初始化 VOS 项目，完成 DesignSpec 与 Agent、知识库配置，为后续十个 Lab 打地基。
> - **预计耗时**：8–12 小时，建议安排 1 周。CTF 双环境热身约占一半，项目初始化与 DesignSpec 占另一半。
> - **前置依赖**：无需前置 Lab。第一次接触 OS 开发也没关系，Book 第 1 章会先解释操作系统、语言、ISA 与设计先行的理由。
> - **产出物**：双环境 flag 读取程序与证据、学生手写的 `spec/design.yaml`、初始化版 `toolchain.yaml` 与 `vos.yaml`、lint/review evidence、干净且可追溯的 Git HEAD。

> **参考项目**：参考项目的 `course/lab1-complete` 是独立课程历史的起点：先提交 `vos init` 生成的空项目，再单独提交当期 DesignSpec。Lab 1 只确定项目身份、RISC-V/C、启动目标和开发边界，不包含后续 Lab 的源码、测试名、占位文件或预告性规格。后续设计决策在对应 Lab 以新的 DesignSpec 提交逐步加入。

## 1. CTF 双环境热身

教师会下发一个包含 `flag1` 和 `flag2` 的文件系统镜像。你要在两种环境中读取同一份内容：

1. 在 Linux 中写普通程序，通过操作系统提供的文件接口读取并交替输出两个 flag。
2. 在裸机环境中读取镜像，自己完成必要的块读取、文件系统解析和串口输出。
3. 在 QEMU 中采集非图形串口日志；有合适板卡时，可额外完成真实硬件验证。
4. 记录 Agent 协作过程，并解释哪些代码来自建议、哪些判断由你完成。

这个热身不要求先建立完整内核，也不把轮询交替输出说成真正的多任务。它要让你在第一周看清 Linux 已经代办了哪些工作：设备访问、文件系统、地址空间和系统调用。CTF 与 flag 的背景见[附录](../appendices/ctf-flags.md)。

课程仓库提供 `tests/public/ctf-fixture.ts`，用固定 seed 生成两个非秘密文件、对应的 4096 字节只读镜像和只含长度与 SHA-256 的公开元数据。这个框架只规定镜像目录格式和可验证的遮蔽记录，不实现 Linux 文件读取、裸机镜像解析、UART、RISC-V 入口或 QEMU 启动。学生实现和 Agent 生成的具体测试可以读取它，但不得修改教师框架，也不得把生成值抄进源码。

### 1.1 Linux 路径

先确认镜像格式和教师提供的读取方式。可挂载的镜像应以只读方式挂载；不可直接挂载的教学格式，需要使用配套提取工具。程序必须从文件读取 flag，不能把期望字符串写进源码。

```c
int fd = open("flag1", O_RDONLY);
if (fd < 0) {
    perror("open flag1");
    return 1;
}
```

完整实现还要检查 `read`、短读、缓冲区边界和 `close` 的结果。两个 flag 的输出顺序必须稳定，日志中应能区分每轮读取。

### 1.2 裸机路径

裸机程序至少需要四层能力：

```text
块设备读取 → 文件系统元数据解析 → 文件内容读取 → UART 输出
```

不要把磁盘镜像误当成内存数组就宣称完成了设备读取。QEMU 启动参数、镜像连接方式和块设备驱动必须与所选机器一致。若课程为热身提供只读块访问框架，可以复用框架，但必须自己完成目录查找和文件内容验证，并在报告中说明框架边界。

### 1.3 热身验证

至少保留以下证据：

- Linux 程序的退出码和标准输出；
- 裸机镜像的构建身份；
- QEMU 完整启动命令和串口日志；
- 两个 flag 的验证结果。公开报告只记录遮蔽后的 flag 或其哈希，不公开学生唯一 flag；
- 一段对比说明：Linux 路径中哪些机制由内核提供，裸机路径中哪些机制由程序承担。

## 2. 项目设计问题

完成热身后，再为后续 Lab 建立项目。你需要回答三个问题：

1. **你的 OS 项目身份是什么？** 项目名、目标平台、编程语言。这些是后续所有 Lab 的基础，一旦选定就不轻易更改。
2. **你的技术路线选的什么？为什么？** ISA 选 RISC-V / x86-64 / ARM？语言选 C / C++ / Rust / Zig？不是随机选，你要有理由。
3. **你的开发环境和知识库如何搭建？** 工具链安装、Agent 配置、DesignSpec 骨架创建、参考资料导入。它们是你后续十个 Lab 的"基础设施"。

## 3. 设计空间

| 决策       | 你需要回答的问题                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目标 ISA   | RISC-V 64 / AArch64 / x86-64？各 ISA 的特权级、页表、中断模型有何差异？详见[Book §1.10.3](../book/ch01-overview-design.md#1103-问题三你的-os-跑在什么上)                  |
| 编程语言   | C / C++ / Rust (no_std) / Zig？四种语言的宏观对比、代码实例、OS 开发 vs 普通开发的差异详见[Book §1.10.4](../book/ch01-overview-design.md#1104-问题四用什么语言写你的内核) |
| 开发环境   | 本地工具链 vs 容器？交叉编译工具链如何安装？                                                                                                                              |
| Agent 配置 | 使用什么 LLM provider？Agent 在各阶段能做和不能做什么？详见[Book §1.7](../book/ch01-overview-design.md#ai-agent-的角色)                                                   |
| 知识库     | 需要导入哪些参考资料？导入时机和策略？                                                                                                                                    |

## 4. 设计决策引导

### 决策 1：选择目标 ISA

三种主流 ISA 的关键差异已列在 [Book §1.10.3](../book/ch01-overview-design.md#1103-问题三你的-os-跑在什么上) 的对比表中，并附有同一操作在三种 ISA 上的汇编对比，建议先看那些实例再做决定。

**默认推荐：RISC-V 64 + QEMU `virt`。** RISC-V 规范简洁（特权级规范约 100 页，x86 超过 2000 页），QEMU `virt` 是课程工具链的一等公民，xv6-riscv 参考资料最丰富。选择 x86-64 或 ARM 不会受到惩罚，你需要额外调研，并确保课程工具链对你的 ISA 支持到位。

**设计自检**：你选的 ISA 的 syscall 指令是什么？特权级有几层？页表结构的名称是什么？（不必现在就全部精确回答，这些问题会在 Lab 2-5 中逐一展开，但你至少要能说出选这个 ISA 的 2 个理由。）

### 决策 2：选择编程语言

四种语言的宏观对比、代码实例（freelist 页分配器）、OS 开发 vs 普通开发差异、构建系统对比详见 [Book §1.10.4](../book/ch01-overview-design.md#1104-问题四用什么语言写你的内核)，建议先看完再决定。

**默认推荐：C。** 参考资料最丰富（xv6、Linux、OSDev wiki），语法简单，你不会花数周学习语言特性。"内存不安全"在教学场景中反而是优势，你会亲身经历 buffer overflow，从而深刻理解 MMU 和隔离的价值。

如果你已有 C++ 基础，选 C++ 也可以，RAII 和模板能减少重复代码，但需要在 freestanding 环境下禁用异常（`-fno-exceptions`）和 RTTI（`-fno-rtti`），且 STL 容器不可用。详见 [Book §1.10.4c](../book/ch01-overview-design.md#1104c-从普通开发到-os-开发四种语言的关键差异)。

选择 Rust、Zig 或 C++ 不会受到惩罚，你需要在后续 Lab 中自行解决语言特有的问题（Rust 的 `unsafe` 边界、Zig 的交叉编译配置、C++ 的全局构造函数和 vtable 管理）。

**设计自检**：如果你选的语言不是你最熟悉的，你知道它在 OS 开发中需要禁用哪些特性吗？（如 C++ 的异常/RTTI、Rust 的 std。）在 [Book §1.10.4c](../book/ch01-overview-design.md#1104c-从普通开发到-os-开发四种语言的关键差异) 查"✗ 丢失"列。

### 决策 3：开发环境

| 方案                     | 优点                   | 缺点                                   | 适合                               |
| ------------------------ | ---------------------- | -------------------------------------- | ---------------------------------- |
| **本地工具链**     | 响应快、与编辑器集成好 | 不同 OS 安装方式不同，环境问题自己排查 | 推荐。本课程的工具链安装已尽量简化 |
| **容器（Docker）** | 环境一致，队友间可复现 | 需额外学习 Docker，文件系统多一层间接  | 对本地环境有洁癖的；团队协作       |

**默认推荐：本地安装。** 课程工具链（Bun + vos + RISC-V GCC）在 macOS/Linux/Windows WSL2 上均经过验证。如果选 C++，需要额外安装 `riscv64-unknown-elf-g++`。

### 决策 4：Agent 配置策略

Agent 的定位和约束在 [Book §1.7](../book/ch01-overview-design.md#ai-agent-的角色) 中有详细说明。核心原则：**让 AI 帮你思考，但不替你思考。**

vos-agent 支持五种 LLM provider：**Anthropic**（Claude）、**OpenAI**（GPT/o 系列）、**OpenAI-compatible**（兼容网关，如 Azure/DeepSeek API/自建代理）、**DeepSeek**（原生 DeepSeek API）、**Ollama**（本地模型）。Lab 1 阶段至少配置一个。

**API key 不要放在 shell 配置文件里。** 推荐使用项目根目录的 `.env` 文件，配合 `.vos/config.toml` 声明使用哪个 key。这套机制是 vos-agent 的原生设计，不需要手动 `export` 环境变量，也避免了 key 通过 shell history 或 `env` 命令泄露。

---

## 5. VOS 项目初始化

以下步骤在 CTF 热身之后执行。每一步都给出自检点，方便区分环境问题、配置问题和设计问题。

### 步骤 1：安装 vos 工具链（预计 10 分钟）

Lab 1 使用仓库内的 `vos/apps/vos-cli`。先安装 workspace 依赖，再通过 `bun link` 将当前 checkout 的 CLI 暴露为 `vos` 命令。

```sh
# 1. 准备 Bun 1.3 或更新版本
# 详见 https://bun.sh/docs/installation
# macOS
# brew install oven-sh/bun/bun

# Windows：安装 Bun，并重新打开终端

# Linux（Debian/Ubuntu）
# curl -fsSL https://bun.sh/install | bash

bun --version

# 2. 将仓库 clone 到本地一个合适的目录
git clone https://github.com/2018wzh/VeriSpecOSLab.git
cd VeriSpecOSLab

# 3. 安装 workspace 依赖并链接当前 vos CLI
cd vos
bun install --ignore-scripts
cd apps/vos-cli
bun link

# 4. 验证安装
vos --version
vos --help
```

仓库不提供预构建二进制、npm 发布包或升级通道；CLI 始终来自当前 checkout。

**自检点**：`bun --version` 至少为 1.3，`vos --help` 能看到命令列表。如果提示 `command not found`，确认已在 `vos/apps/vos-cli` 执行 `bun link`，并检查 Bun 的全局 bin 目录是否在 PATH 中。

未来如果需要升级 vos CLI，先 `git pull` 更新仓库，再在 `vos/apps/vos-cli` 执行 `bun install --ignore-scripts` 和 `bun link`。

### 步骤 2：初始化项目（预计 10 分钟）

```sh
mkdir my-os
cd my-os

git config user.name "Your Name"
git config user.email "you@example.com"

vos init
```

`vos init` 会创建空的 `spec/design.yaml`、`spec/modules/toolchain.yaml`、`vos.yaml` 和 `.gitignore`，并建立五类 Spec 所需的目录。`.gitignore` 已包含 `.vos/` 和 `.env`，API key 文件与 VOS 运行目录不会被 Git 跟踪。如果当前目录还不是 Git 仓库，`vos init` 会先执行 `git init`。初始提交只包含它创建或维护的入口文件，不会顺带提交你的草稿。

如果 `vos init` 提示缺少 Git 用户名或邮箱，先按上面的命令配置本仓库的 Git identity。

### 步骤 3：配置 Agent 并完成 DesignSpec（预计 45 分钟）

`vos init` 已经创建空的 `spec/design.yaml`。第一次调用 Agent 前，先在项目根目录创建 `.env`，只保存实际凭据：

```dotenv
# 示例变量名；只保留你实际使用的 provider
OPENAI_API_KEY=<你的 API key>
```

`.env` 已被 `.gitignore` 排除。不要把真实值写进命令行、`.vos/config.toml`、`vos.yaml`、聊天、截图或文档。然后运行配置向导：

```sh
vos agent config
```

向导只询问 provider、模型、base URL 和凭据的**环境变量名**，不会读取或回显 key。支持 Anthropic、OpenAI、OpenAI-compatible、DeepSeek 和 Ollama。使用 OpenAI-compatible 时必须填写完整的 API base URL；Ollama 可以不配置凭据变量。

如果准备使用 `vos kb add` 建立知识库，还要配置 OpenAI 或 OpenAI-compatible embedding provider。没有已索引的知识库来源时可以跳过，普通 Agent 配置不会强制生成 embedding 配置。

配置完成后执行：

```sh
vos agent config --show   # 只显示非秘密字段和凭据是否存在
vos agent config --check  # 严格检查字段、URL、变量名和凭据引用
vos doctor                # 连同项目、Spec、工具链和 KB 配置一起检查
```

`--show` 不显示凭据值。配置缺少凭据时，向导仍会保存非秘密设置，Agent 命令会指出应补充到 `.env` 的变量名。`vos doctor` 保留确定性检查结果，把无法调用 Debug Agent 记为 warning；provider 不可用本身不会让 doctor 失败。

现在完成 DesignSpec。先用 Ask Agent 讨论问题和取舍：

```sh
vos agent ask -i
```

Ask Agent 不生成文件。你可以围绕系统目标、语言、ISA、QEMU、canonical board、内核组织和关键取舍连续追问，然后亲手填写 `spec/design.yaml`。逐项检查以下内容：

- `system` 中的名称、语言和 ISA 是否与自己的选择一致；
- `machine.qemu` 是否写清机器型号、内存、固件和串口；
- `machine.hardware` 是否给出唯一的 canonical board；
- `kernel` 是否说明组织方式、执行模型、保护、通信和资源模型；
- `required_mechanisms` 是否只写真正需要实现的机制；
- `composition_invariants` 是否为 1～3 条跨模块不变量；
- `hardware_port` 是否说明启动、控制台和中断入口。

尚未进入本 Lab 范围的字段也必须保留，值写成 `not in current lab scope`，不要删字段或另造阶段 schema。下面只给字段骨架，不给可直接提交的答案：

```yaml
system:
  name: TODO
  language: TODO
  isa: TODO
machine:
  qemu:
    machine: TODO
    memory: TODO
    firmware: TODO
    console: TODO
  hardware:
    board: not in current lab scope
    status: not in current lab scope
kernel:
  organization: TODO
  execution: TODO
  protection: not in current lab scope
  communication: not in current lab scope
  resource_model: not in current lab scope
required_mechanisms:
  - TODO
composition_invariants:
  - TODO
non_goals:
  - TODO
hardware_port:
  board: not in current lab scope
  boot: not in current lab scope
  console: not in current lab scope
  interrupt: not in current lab scope
```

完成后先 lint，再让 Review Agent 给建议：

```sh
vos spec lint design
vos agent review design -i
vos spec lint design
git add spec/design.yaml
git commit -m "[spec][design] Record Lab 1 system choices"
```

你需要自己判断哪些建议应当采纳。Review Agent 不修改文件，Git 提交也必须由学生手动完成。严格 schema 会拒绝未知字段；不要把旧版的种子、切片、时间线或独立决策记录字段塞进 DesignSpec。需要跨模块变更时，后续单独提交 SpecPatch。

### 步骤 4：检查 Agent 的使用边界（预计 5 分钟）

模型、provider、base URL 和凭据变量名保存在 `.vos/config.toml`；真实凭据只保存在 `.env`。不要手工复制另一台机器上的整份配置：先准备对应的 `.env`，再运行 `vos agent config --check`，让 VOS 检查当前环境。

配置后先做只读问答：

```sh
vos agent ask "RISC-V 与 x86-64 的教学取舍是什么？"
```

`ask` 只回答问题，不修改项目。`review` 评审学生已经写好的 Spec，也不生成补丁或提交。`debug` 和 `verify` 同样只读。

需要特别理解：Agent 的 linked worktree 只隔离 Git 变更，不隔离进程、网络、凭据或宿主文件。Agent 默认能以当前用户权限执行宿主命令。本地保存的完整参考源码也不是保密边界。

### 步骤 5：建立项目知识库（预计 20 分钟）

知识库由命令管理，不写入 `vos.yaml`。先加入本地课程资料或参考仓库，再检查索引：

```sh
vos kb add docs/reference --recursive --source-kind course
vos kb add https://github.com/riscv/riscv-isa-manual.git --tag <不可变标签> --source-kind external
vos kb list
vos kb search "RISC-V supervisor trap entry"
```

远程来源应使用不可变 tag 或明确 branch；VOS 会记录实际 Git revision 和内容寻址对象。索引、来源快照和 object manifest 都位于 gitignored 的 `.vos/kb/`，不会进入 Git。需要迁移或复核时使用 `vos kb export-manifest` 和 `vos kb import-manifest`；不再维护 `knowledge.sources` 声明。

建立索引后可以继续使用 `vos agent ask` 提问。查询日志只保存学生实际看到的片段及其 source、hash 和 range，不复制未展示的检索上下文。

### 步骤 6：检查基线（预计 10 分钟）

把前面完成的 CTF 双环境路径也写成学生自己的 ModuleSpec。这个 Spec 不能包含 flag 答案，只描述输入、错误、性质、实现路径和测试路径：

```yaml
id: lab/ctf-warmup
module: lab/ctf-warmup
level: 2
purpose: TODO
owns: [TODO_LINUX_READER_PATH, TODO_BARE_METAL_READER_PATH, TODO_TEST_PATH]
interface: [TODO_READ_OPERATION]
properties: [TODO]
errors: [TODO]
state: { TODO_STATE: TODO }
preconditions: [TODO]
postconditions: [TODO]
invariants: [TODO]
dependencies: [toolchain]
```

按统一教学链完成评审、提交和实现验证：

```sh
vos agent ask "怎样验证 flag 确实来自镜像，而不是源码常量？"
vos spec lint lab/ctf-warmup
vos agent review lab/ctf-warmup -i
# 学生修改后再次 lint，并手动提交
vos spec lint lab/ctf-warmup
git add spec/modules/ctf-warmup.yaml
git commit -m "[spec][ctf] Define Lab 1 warm-up contract"
vos agent implement lab/ctf-warmup
vos build
vos run qemu
vos verify
vos doctor
vos spec lint design
vos agent review design
git status --short
git log -2 --oneline
```

`vos spec lint` 只检查结构、引用、路径、稳定 ID、等级字段和 manifest 映射，不评价技术选择，也不调用模型。`vos agent review` 给出设计建议，但不替你修改。Lab 1 结束时，工作树应当干净，DesignSpec 应已有独立的学生提交。

## 6. 背景阅读

- [Book 第 1 章：系统设计](../book/ch01-overview-design.md)：理解 OS 职责、ISA 与语言选择、参考系统和 Spec-first 方法。
- [RISC-V 参考](../appendices/riscv-reference.md)：选择 RISC-V 时重点查看特权级、入口寄存器和页表。
- [x86-64 启动参考](../appendices/x86-boot-reference.md)：选择 x86-64 时重点查看启动协议和长模式入口。
- [ARM 启动参考](../appendices/arm-boot-reference.md)：选择 AArch64 时重点查看异常级别和设备树。
- [vos 命令参考](../appendices/vos-commands.md)：只列学生公开 CLI。
- [CTF 与 flag](../appendices/ctf-flags.md)：热身目标、验证边界与隐私要求。

## 7. 质量门禁

自动检查：

- [ ] Linux 程序从文件读取并交替输出两个 flag，所有 I/O 错误都显式失败。
- [ ] 裸机程序在 QEMU 中从文件系统镜像读取两个 flag，串口日志可追溯到构建身份。
- [ ] 源码中没有硬编码 flag，Git 中没有提交真实 flag、`.env` 或原始私密日志。
- [ ] `vos doctor` 通过，或每个失败项都有明确的可执行修复说明。
- [ ] `vos spec lint design` 通过，并保存 Review Agent 的评审 run ID。
- [ ] `.env` 和 `.vos/` 未被 Git 跟踪。
- [ ] DesignSpec 已提交，工作树干净。
- [ ] `composition_invariants` 不超过三条，并且能够跨模块检查。

人工检查：

- [ ] 能解释 Linux 文件读取与裸机文件读取的机制差异。
- [ ] 能说明轮询交替输出为什么不等于抢占式多任务。
- [ ] 能解释所选 ISA 与语言各自的两个主要取舍。
- [ ] 能说明 canonical board、QEMU 机器和真实硬件移植目标的关系。
- [ ] 能区分 DesignSpec 中的系统约束与后续 ModuleSpec 中的实现契约。
- [ ] 能说明 linked worktree 为什么不是安全沙箱。

## 8. 提交物

- [ ] Linux flag reader、裸机 flag reader、链接与构建文件；
- [ ] 遮蔽敏感 flag 的双环境运行证据和代码解读；
- [ ] Agent 协作记录，包含采纳与拒绝理由；
- [ ] `spec/design.yaml`；
- [ ] `spec/modules/toolchain.yaml` 和 `vos.yaml` 的初始化版本；
- [ ] lint 与 review evidence；
- [ ] 一段不采用备选 ISA 或语言的理由；
- [ ] 干净且可追溯的 Git HEAD。

## 9. AI 使用边界

Agent 可以解释 ISA 差异、对比语言优劣和审查 DesignSpec 字段。学生必须亲自决定项目身份、技术路线和知识库策略，手写 Spec，并逐项判断是否采纳 Review Agent 的建议。`ask`、`review`、`debug` 和 `verify` 都不修改项目。

## 10. 常见问题

### QEMU 能启动，但读不到 flag

先核对镜像是否以正确设备和格式连接，再分别记录块号、inode、目录项和读取长度。不要用直接打印预期 flag 的方式绕过文件系统路径。

### Linux 能读，裸机不能读

这通常说明你依赖了 Linux 的挂载或文件接口，却没有实现裸机侧对应的块读取与格式解析。把路径拆成“块可读、超级块正确、inode 可定位、目录项可匹配、文件内容可读取”五个检查点。

### `vos agent review` 没有写文件

这是预期行为。Review Agent 只评审学生手写的 Spec。修改后重新运行 lint，并用普通 Git 命令提交。

### `vos spec lint` 报未知字段

学生 Spec 使用严格 schema。删除旧版种子、切片和独立操作规格等字段，按当前五类 Spec 重新表达含义，不要添加兼容包装。

### Agent 报 provider 未配置

先运行 `vos agent config --show` 和 `vos agent config --check`。未配置时运行 `vos agent config`；凭据缺失时，按提示把对应变量写入项目根目录的 `.env`。如果 `.vos/config.toml` 语法错误或包含未知字段，VOS 会直接报错，不会忽略配置继续运行。不要把 key 写进 `vos.yaml` 或提交到 Git。

### 知识库来源哈希不匹配

确认 revision 指向的内容是否发生变化。只有在明确接受新内容后才更新 revision 和 hash，并把这次变更作为普通配置修改提交。
