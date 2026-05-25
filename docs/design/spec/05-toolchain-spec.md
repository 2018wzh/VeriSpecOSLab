# ToolchainSpec 标准

## 0. 核心理念：工具无关的语义规范

`ToolchainSpec` 是学生项目的**工具无关的语义构建规范**，定义「做什么」而非「怎样做」。这允许多个生成器（Makefile、xtask、CMake、Bazel 等）从同一份 spec 生成各自的构建配置。

`VOS Runtime` 则是 `vos` 的规范消费、生成器调用、执行编排与证据采集体系。

- `ToolchainSpec` 文档位于 `spec/toolchain/` 与本文件中。
- `VOS Runtime` 文档位于 [`../toolchain/README.md`](../toolchain/README.md)。

核心流程：

```text
ToolchainSpec (语义规范)
  ↓ [生成器选择]
生成器 (Makefile生成器 | Xtask生成器 | CMake生成器 | ...)
  ↓ [代码生成]
工具特定配置 (Makefile | task.rs | CMakeLists.txt | ...)
  ↓ [VOS执行]
构建输出 + 证据
```

## 1. 角色定位：语义规范 → 多工具生成

VeriSpecOSLab 引入 `ToolchainSpec` 作为**单一的语义规范源**，而非绑定具体工具。

`ToolchainSpec` 的定位是：

```text
工具无关的构建 / 链接 / 镜像 / 运行 / 调试语义规范
```

关键概念：

1. **学生编写语义 spec**（描述源文件、编译标志、依赖关系）
2. **VOS 选择和调用生成器**（Makefile、xtask、CMake 等）
3. **生成器生成工具特定配置**（Makefile、task.rs、CMakeLists.txt 等）
4. **VOS 执行生成的配置**并采集证据

它负责约束：

- **编译时**：源文件、编译标志、预处理器定义、包含目录
- **链接时**：输入工件、链接脚本、库依赖、输出格式
- **工件**：预期的输出文件和位置
- **执行**：环境、超时、依赖顺序
- **环境**：target triple、ABI、必需工具版本

## 2. 为什么需要 ToolchainSpec

很多 OS 错误不在代码逻辑，而在构建层：

- entry symbol 错误
- linker script 错误
- host / target 工具混用
- ABI flag 不一致
- OpenSBI / bootloader / kernel image 不匹配
- QEMU profile 与架构声明不一致

如果这些约束不进 Spec，Agent 会误把构建层问题当成代码 bug。

## 2.1 工具无关规范的优势

**单一 Spec，多生成器：**
- 学生只需维护一份 spec，无需同步多个 Makefile、CMakeLists.txt、task.rs
- 不同生成器可用于不同场景（学习、优化、对比）
- 易于添加新工具支持（无需修改 spec，只需新增生成器）

**语义 vs 语法：**
- Spec 描述语义（源文件模式、编译标志语义、依赖关系）
- 生成器负责语法翻译（映射到 Makefile 规则、CMake 命令等）
- 学生无需学习多种工具的语法

## 3. 推荐目录

```text
spec/toolchain/
  profile.yaml
  build.yaml
  link.yaml
  image.yaml
  run.yaml
  debug.yaml
```

也可以压缩为：

```text
spec/toolchain/toolchain.yaml
```

## 4. ToolchainProfile 最小字段

```yaml
toolchain:
  target_arch:
  target_triple:
  c_compiler:
  asm_compiler:
  linker:
  archiver:

environment:
  required_tools:
  allowed_versions:
  disallowed_tools:
```

## 5. BuildContract 最小字段

```yaml
build:
  allowed_output_path:
  sources:
  include_paths:
  cflags:
  asmflags:
  ldflags:
  features:
  forbidden_flags:
  generated_artifacts:
```

## 6. LinkContract 最小字段

```yaml
link:
  linker_script:
  entry_symbol:
  section_rules:
  relocation_model:
  abi_constraints:
```

## 7. Image / Run / Debug 最小字段

```yaml
image:
  output_kind:
  objcopy_rules:
  boot_chain:
  required_artifacts:

run:
  emulator:
  machine:
  cpu:
  memory:
  bios:
  kernel_arg:
  success_signal:

debug:
  symbols_required:
  gdb_script:
  trace_points:
```

## 8. Validation 绑定

每份 ToolchainSpec 都应绑定最低验证：

```yaml
validation:
  must_pass:
    - build_kernel
    - verify_entry_symbol
    - verify_section_layout
    - qemu_boot_smoke
```

## 9. 与多种构建工具的关系

ToolchainSpec 作为语义规范，与具体工具无关：

```text
ToolchainSpec (语义规范，设计真相)
  ↓ [生成器]
Makefile / CMakeLists.txt / task.rs / BUILD / ...
  ↓ [执行]
vos build (工具无关的执行和证据采集)
```

关键原则：

- **Spec 是设计真相**，Makefile/CMake/etc 是实现细节
- **多生成器**：从同一 spec 可生成多种工具链配置
- **输出路径受 spec 约束**：`build.allowed_output_path` 声明 agent 允许写入哪些本地构建系统文件
- **当前实现中生成在 agent 侧完成**：`vos agent generate --apply` 生成并写入本地构建系统，`vos build` 只执行 `.vos/toolchain.json` 中登记的当前构建系统

### 9.1 `allowed_output_path`

`build.allowed_output_path` 用于声明“本地 agent 可以生成哪些构建系统文件”。  
它既约束 prompt 输出，也约束落盘前和执行前的本地白名单校验。

```yaml
build:
  allowed_output_path:
    - Makefile
    - CMakeLists.txt
    - xtask/src/tasks.rs
    - xtask/Cargo.toml
```

当前实现中：

- agent 只能写入这份列表中的路径
- `.vos/toolchain.json` 里的 `files` 也必须属于这份列表
- 若列表为空，agent 会拒绝生成构建系统，`vos build` 也会拒绝执行

### 9.2 当前使用模式

**模式 A：agent 生成后执行（推荐）**
```bash
$ vos agent generate --apply
$ vos build
# agent 根据 spec 生成并写入本地构建系统
# build 读取 .vos/toolchain.json 并执行
```

**模式 B：只看 dry-run**
```bash
$ vos build --dry-run
# 不生成新构建系统
# 只展示当前 manifest 将执行的命令
```

**模式 C：显式加载某份 manifest**
```bash
$ vos build --toolchain=/path/to/toolchain.json
# 显式加载一份已生成 manifest
# vos 仍负责执行和证据采集
```

## 10. 课程边界

默认课程不要求学生自己构建交叉编译器、binutils 或 libc 工具链。

只有在以下场景下才建议把”自建工具链”纳入目标：

1. 课程明确覆盖编译器 / ABI / 移植链路。
2. 个性化目标本身就是硬件移植或工具链研究。

---

## 11. 相关文档

工具无关的语义 ToolchainSpec 由三层设计组成：

1. **[05a-semantic-build-schema.md](05a-semantic-build-schema.md)** (语义构建模式)
   - 完整的语义字段定义
   - 编译、链接、存档、测试、自定义阶段
   - 字段映射指南（如何映射到 Makefile、Xtask、CMake）

2. **[05b-vos-toolchain-generation-contract.md](05b-vos-toolchain-generation-contract.md)** (VOS 生成与执行)
   - vos build 调用流程
   - 生成器契约与接口
   - 执行、超时、证据采集
   - 错误处理与诊断

3. **[05c-generator-reference.md](05c-generator-reference.md)** (生成器参考)
   - 完整示例：同一 spec 生成 Makefile、Xtask、CMake
   - 生成器实现框架
   - 字段到工具语法的映射表

**VOS Runtime 角色更新见：** [`../toolchain/01-boundaries-and-roles.md`](../toolchain/01-boundaries-and-roles.md)
