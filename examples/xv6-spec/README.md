# xv6-spec: 规格驱动的 xv6 内核实现

本项目是 xv6 内核的一个“规格优先”（Spec-First）重实现示例。它展示了如何通过结构化的 YAML 规格定义操作系统行为，并利用 `vos` 工具链和 AI Agent 自动生成验证通过的代码实现。

## 1. 核心流程：从规格到运行

复现该项目的完整生命周期如下：

### A. 规格定义 (Spec Authoring)
项目核心位于 `spec/` 目录：
- **架构** (`spec/architecture/`)：定义了 xv6 的模块组成和组合逻辑。
- **模块与操作** (`spec/modules/`)：详细定义了如 `memory`、`process` 等模块的状态、接口及操作合约（Operation Contract）。
  - 例如 `spec/modules/memory/ops/kalloc.yaml` 定义了物理内存分配的 `RELY` (前置条件) 和 `GUARANTEE` (后置语义)。

### B. 受控生成 (Controlled Generation)
使用 `vos` 驱动 AI Agent 进行代码生成：
```bash
# 进入 xv6-spec 目录
cd examples/xv6-spec

# 启动生成循环（以 memory 模块为例）
vos agent generate memory
```
`vos` 会根据 `spec/modules/memory/` 中的操作合约，引导 Agent 按照 **Logic (逻辑)** -> **Concurrency (并发)** 两阶段生成 C 代码补丁。

### C. 构建与验证 (Build & Verify)
生成代码后，必须通过规格定义的验证门禁：
```bash
# 执行 lint 检查规格一致性
vos spec lint

# 执行语义构建（根据 spec/toolchain/build.yaml）
vos build

# 运行公开验证集
vos verify public
```

### D. 运行与调试 (Run & Debug)
在 QEMU 模拟器中启动生成的内核：
```bash
# 启动 QEMU（根据 spec/toolchain/run.yaml）
vos run qemu

# 跟踪系统调用
vos trace syscall
```

## 2. 目录结构

```text
.
├── spec/                  # 规格定义真相源
│   ├── architecture/      # 拓扑、组合与决策
│   ├── modules/           # 模块化定义 (memory, proc, trap, syscall, boot)
│   ├── toolchain/         # 构建、运行、链接等工具链绑定
│   ├── evolution/         # 规格演化补丁
│   └── verification/      # 验证契约与证据 Schema
├── .vos/                  # VOS 运行时的执行上下文与证据记录
└── README.md              # 本说明文件
```

## 3. 关键组件：Operation Contract

在 `spec/modules/memory/ops/kalloc.yaml` 中，你可以看到典型的规格定义：

```yaml
id: kalloc
purpose: Allocate one 4096-byte page of physical memory.
rely:
  state_assumptions:
    - "kmem.freelist points to the head of a linked list of free pages"
guarantee:
  returns:
    - "a pointer to the allocated page on success"
    - "0 (NULL) if no memory is available"
  state_updates:
    - "kmem.freelist updated to the next page in the list"
concurrency:
  atomicity: "protected by kmem.lock"
```

这种结构化的表达是 AI Agent 能够生成高质量、可验证代码的基础。

---
*注意：执行上述流程需要安装 `vos-cli` 并配置有效的 AI Agent 后端。*
