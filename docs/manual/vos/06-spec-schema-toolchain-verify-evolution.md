# 06 Spec Schema 参考（下）：工具链、验证、演化、目标

本章给出 ToolchainSpec、Verification/Evidence Spec、SpecPatch、GoalValidationContract 和 Report Contract 各 YAML 类型的字段定义，配 xv6-spec 示例片段。

---

## 6.1 ToolchainSpec

### 6.1.1 核心理念

`ToolchainSpec` 是**工具无关的语义构建规范**，定义「做什么」而非「怎样做」。学生只需维护一份 spec，Agent 可以为不同场景起草不同工具链实现（Makefile、CMakeLists.txt、xtask 等），由 VOS deterministic gate 裁决是否物化。

### 6.1.2 推荐目录

```text
spec/toolchain/
  toolchain.yaml    # 入口索引（推荐）
  profile.yaml      # 工具链 profile
  build.yaml        # 构建语义
  link.yaml         # 链接语义
  image.yaml        # 镜像生成
  run.yaml          # QEMU 运行配置
  debug.yaml        # 调试配置
```

也可以压缩为单个 `spec/toolchain/toolchain.yaml`。

---

### 6.1.3 ToolchainProfile

**用途**：声明目标架构、工具链和版本约束。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `toolchain.target_arch` | string | 是 | 目标架构，如 `riscv64` |
| `toolchain.target_triple` | string | 是 | 目标 triple，如 `riscv64-unknown-elf` |
| `toolchain.c_compiler` | string | 是 | C 编译器，如 `gcc` |
| `toolchain.asm_compiler` | string | 是 | 汇编编译器 |
| `toolchain.linker` | string | 是 | 链接器 |
| `toolchain.archiver` | string | 是 | 归档工具 |
| `environment.required_tools` | list | 是 | 必需工具及版本约束 |
| `environment.allowed_versions` | list | 否 | 允许的版本范围 |
| `environment.disallowed_tools` | list | 否 | 禁止使用的工具 |

**xv6 示例**（`spec/toolchain/profile.yaml`）：

```yaml
toolchain:
  target_arch: riscv64
  target_triple: riscv64-unknown-elf
  c_compiler: gcc
  asm_compiler: gcc
  linker: ld
  archiver: ar

environment:
  required_tools:
    - gcc: ">=9.0"
    - ld: ">=2.32"
    - riscv64-unknown-elf-objcopy: ">=2.40"
  allowed_versions:
    - gcc >= 9.0
    - ld >= 2.32
  disallowed_tools: []
```

**物化后的 `.vos/toolchain.json` v2 必须保留结构化环境约束**，`vos build` 执行前探测工具实际版本，不满足约束时命令失败。

---

### 6.1.4 BuildContract

**用途**：声明编译语义——源文件、编译标志、构建阶段。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `build.allowed_output_path` | list | 否 | 允许的构建系统文件（如 `Makefile`、`CMakeLists.txt`） |
| `build.sources` | list | 是 | 源文件 glob 模式 |
| `build.include_paths` | list | 是 | 头文件搜索路径 |
| `build.cflags` | list | 是 | C 编译标志 |
| `build.asmflags` | list | 否 | 汇编编译标志 |
| `build.ldflags` | list | 否 | 链接标志 |
| `build.features` | list | 否 | 编译期特性 |
| `build.variants` | list | 否 | 构建变体（如 `baseline`、`test`） |
| `build.forbidden_flags` | list | 否 | 禁止使用的编译标志 |
| `build.generated_artifacts` | list | 是 | 预期构建产物路径 |
| `build.phases` | list | 是 | 构建阶段（见子字段） |

**`phases` 子字段（语义构建阶段）**：

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 阶段名 |
| `semantic.type` | string | 是 | `compile` / `link` / `image` |
| `semantic.compiler` | string | 是 | 编译器类型 |
| `semantic.sources` | list | 是 | 源文件 pattern |
| `semantic.include_dirs` | list | 是 | 包含目录 |
| `semantic.flags` | object | 是 | 编译选项（warnings, optimization, debug, defines, extra） |
| `semantic.standard` | string | 否 | 语言标准，如 `c11` |
| `semantic.output_dir` | string | 是 | 输出目录 |
| `semantic.output_pattern` | string | 否 | 输出文件模式 |
| `semantic.timeout_secs` | number | 否 | 超时秒数 |

**xv6 示例**（`spec/toolchain/build.yaml` 片段）：

```yaml
build:
  allowed_output_path:
    - Makefile
    - CMakeLists.txt
  sources:
    - kernel/**/*.c
    - kernel/**/*.S
  include_paths:
    - .
  cflags:
    - -fno-common
    - -fno-omit-frame-pointer
    - -march=rv64gc
    - -mcmodel=medany
    - -ffreestanding
    - -nostdlib
  generated_artifacts:
    - build/kernel.elf
    - build/kernel.bin
    - build/kernel.asm
  phases:
    - name: kernel_compile
      semantic:
        type: compile
        compiler: gcc
        sources:
          - pattern: "kernel/*.c"
            exclude: ["kernel/test/**"]
        include_dirs:
          - .
        flags:
          warnings: [all, error]
          optimization: O2
          debug: true
          defines:
            - KERNEL
          extra: "-std=gnu99 -fno-builtin-strncpy ..."
        standard: c11
        output_dir: build/
        output_pattern: "*.o"
        timeout_secs: 180
```

**`BuildVariant` 子字段**：

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 变体标识，如 `baseline`、`test` |
| `purpose` | string | 是 | 用途说明 |
| `features` | list | 否 | 启用的特性 |
| `defines` | list | 否 | 预处理器定义 |
| `test_only` | bool | 否 | 是否仅用于测试（默认 false） |

`vos test` 只能引用 BuildVariant，不能在 suite 中临时改写编译 flag。

---

### 6.1.5 LinkContract

**用途**：声明链接语义。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `link.linker_script` | string | 是 | 链接脚本路径 |
| `link.entry_symbol` | string | 是 | 入口符号 |
| `link.section_rules` | list | 否 | 段规则 |
| `link.relocation_model` | string | 否 | 重定位模型 |
| `link.abi_constraints` | list | 否 | ABI 约束 |

---

### 6.1.6 ImageContract

**用途**：声明镜像生成方式。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `image.output_kind` | string | 是 | 输出类型（`elf`、`bin`、`img`） |
| `image.objcopy_rules` | list | 否 | objcopy 规则 |
| `image.boot_chain` | list | 否 | 启动链（如 `OpenSBI -> kernel`） |
| `image.required_artifacts` | list | 是 | 必需的镜像产物 |

---

### 6.1.7 RunContract

**用途**：声明 QEMU 运行配置。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `run.emulator` | string | 是 | 模拟器，如 `qemu-system-riscv64` |
| `run.machine` | string | 是 | 机器类型，如 `virt` |
| `run.cpu` | string | 否 | CPU 类型，如 `rv64` |
| `run.memory` | string | 否 | 内存大小，如 `128M` |
| `run.bios` | string | 否 | BIOS，如 `default` |
| `run.kernel_arg` | string | 否 | 内核参数标志，如 `-kernel` |
| `run.success_signal` | string | 是 | 成功信号（正则），如 `XV6_BOOT_OK` |
| `run.timeout_secs` | number | 否 | 默认超时 |
| `run.extra_args` | list | 否 | 额外 QEMU 参数 |
| `run.profiles` | list | 否 | 运行 profile 列表 |
| `run.cases` | list | 否 | 运行 case 列表 |

**`run.cases` 子字段**：

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | case 标识 |
| `stdin` | string | 否 | 标准输入 |
| `success_regex` | string | 否 | 成功匹配正则 |
| `failure_regex` | string | 否 | 失败匹配正则 |
| `exit_code` | number | 否 | 预期退出码 |
| `timeout_secs` | number | 否 | 超时 |
| `required_artifacts` | list | 否 | 需要的产物 |

**xv6 示例**（`spec/toolchain/run.yaml`）：

```yaml
run:
  emulator: qemu-system-riscv64
  machine: virt
  cpu: rv64
  memory: 128M
  bios: default
  kernel_arg: -kernel
  extra_args:
    - -nographic
    - -no-reboot
    - -serial
    - mon:stdio
  success_signal: 'init: starting sh\s+\$ '
  timeout_secs: 30
```

---

### 6.1.8 DebugContract

**用途**：声明调试配置。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `debug.symbols_required` | bool | 是 | 是否需要调试符号 |
| `debug.gdb_script` | string | 否 | GDB 脚本路径 |
| `debug.trace_points` | list | 否 | 追踪点 |

---

## 6.2 CompositionSpec

**用途**：描述跨模块不变量，防止多个概念拼在一起但没有定义组合语义。

**推荐目录**：`spec/composition/`

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 标识符 |
| `title` | string | 是 | 标题 |
| `related_slices` | list | 是 | 关联的 ArchitectureSlice |
| `affected_modules` | list | 是 | 受影响的模块 |
| `cross_component_rules` | list | 是 | 跨组件规则（同 §5.1.5 子字段） |

**xv6 示例**（`spec/composition/syscall-mm-trap.yaml` 中的规则）：

```yaml
cross_component_rules:
  - name: trap-dispatches-to-syscall
    description: >
      usertrap dispatches software-interrupt ecalls to the
      syscall handler.
    invariant: >
      scause == 8 always reaches syscall() with sepc advanced by 4.
    affected_modules: [kernel/trap, kernel/syscall]
    tests: [usertrap_syscall_dispatched, syscall_valid_number]
```

---

## 6.3 GoalValidationContract

**用途**：个性化目标必须通过合约表达，不接受只在报告中声明。

**推荐目录**：`spec/goals/`

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `goal_id` | string | 是 | 目标 ID |
| `category` | string | 是 | 类别：`core-functionality` / `optimization` / `compatibility` / `formal-verification` 等 |
| `summary` | string | 是 | 摘要 |
| `baseline` | string | 是 | 基线状态 |
| `target` | string | 是 | 目标状态 |
| `correctness_guard` | list | 是 | 正确性底线（防止只追求性能数字） |
| `benchmark_or_oracle` | list | 是 | 基准或 oracle |
| `negative_tradeoff_checks` | list | 否 | 负向权衡检查 |
| `evidence_required` | list | 是 | 所需证据列表 |

**xv6 示例**（`spec/goals/xv6-core.yaml` 片段）：

```yaml
goal_id: xv6-core-full
category: core-functionality
summary: >
  Achieve a complete, bootable xv6-riscv kernel that passes all
  public validation gates across all nine stages.
baseline: No kernel exists; the project starts from scratch.
target: >
  All public_requirements pass, and the kernel boots to a
  user-mode shell prompt via QEMU.
correctness_guard:
  - No kernel segfault from raw user-pointer dereference.
  - Page allocator freelist integrity under alloc-free cycles.
  - Process isolation: after fork, no shared writable pages.
benchmark_or_oracle:
  - QEMU boot smoke: XV6_BOOT_OK appears within 30 s.
  - usertests: all sub-tests pass without kernel panic.
evidence_required:
  - QEMU boot log
  - Kernel ELF build artifact
  - Page allocator test log
  - usertests output log
```

---

## 6.4 SpecPatch

### 6.4.1 概述

`SpecPatch` 是设计演化记录。要求：先改 Spec 再改代码，用 Git commit 作为不可变变更本体。

**触发条件**：以下变更应强制触发 SpecPatch：

1. 引入新的资源模型或权限模型
2. 改变 syscall / IPC / VFS / trap 等核心语义
3. 改变跨模块不变量
4. 改变 boot chain、link layout、ABI 或运行 profile
5. 引入新的个性化目标或替换既有目标

### 6.4.2 推荐目录

```text
spec/evolution/
  patch-001-initial-spec.yaml
  patch-002-full-spec.yaml
```

### 6.4.3 字段表

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 如 `patch-001-initial-spec` |
| `stage` | string | 是 | 所属阶段 |
| `title` | string | 是 | 补丁标题 |
| `reason` | string | 是 | 变更原因 |
| `kind` | string | 是 | 变更类型：`architecture_change` / `module_change` / `operation_change` / `toolchain_change` |
| `commit_sha` | string | 是 | 实现 commit SHA |
| `parent_sha` | string/null | 是 | 父 commit SHA |
| `spec_commit_sha` | string | 否 | 单独的 spec commit SHA |
| `affected_specs` | list | 是 | 受影响的 spec 文件路径列表 |
| `affected_modules` | list | 否 | 受影响的模块 |
| `affected_operations` | list | 否 | 受影响的操作 |
| `before` | string | 否 | 变更前状态 |
| `after` | string | 否 | 变更后状态 |
| `risks` | list | 否 | 风险 |
| `required_regressions` | list | 是 | 必须重跑的回归测试 |
| `approval_notes` | string | 否 | 审批备注 |

### 6.4.4 推荐两段式提交流程

```text
1. spec commit
   - 更新 spec/evolution/patch-*.yaml
   - 更新 ArchitectureSlice / ADR / CompositionSpec
   - 生成可引用的 spec_commit_sha

2. implementation commit
   - 实现代码或工具链变化
   - commit trailer 引用 SpecPatch ID 与 spec_commit_sha
```

**推荐 commit trailer 格式**：

```text
Spec-Patch-ID: patch-003-cow-fork
Spec-Stage: memory
Spec-Kind: operation_change
Affected-Specs: spec/modules/kernel/memory/ops/uvmcopy.yaml
Required-Regressions: public,memory
Spec-Commit-SHA: <sha>
```

### 6.4.5 xv6 示例

（`spec/evolution/patch-001-initial-spec.yaml` 片段）：

```yaml
id: patch-001-initial-spec
stage: syscall
title: Initial Core Spec Snapshot
reason: |
  Captures the baseline specification state for the xv6-riscv
  kernel after the core stages have been defined.
kind: architecture_change
commit_sha: 0fcf0981f6efe4175e5cdac62d77ecb7541b6d96
parent_sha: null
affected_specs:
  - spec/architecture/seed.yaml
  - spec/architecture/slices/01-boot.yaml
  - spec/architecture/slices/02-memory.yaml
  - spec/modules/kernel/memory/module.yaml
  - spec/modules/kernel/memory/ops/kalloc.yaml
  # ... (完整列表含所有受影响的 spec 文件)
risks: []
required_regressions:
  - public
  - boot
  - memory
```

---

## 6.5 Verification / Evidence Spec

### 6.5.1 推荐目录

```text
spec/verification/
  public-matrix.yaml
  evidence-schema.yaml
  report-contract.yaml
```

### 6.5.2 Public Verification Matrix

**用途**：声明每个阶段的公开验证项。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `stage` | string | 是 | 阶段名 |
| `public_requirements` | list | 是 | 公开验证项列表（见子字段） |

**`public_requirements` 子字段**：

| 子字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 如 `verify-boot-banner` |
| `description` | string | 是 | 验证描述 |
| `related_specs` | list | 是 | 关联的 spec（`module` + `operation`） |
| `required_tests` | list | 是 | 必须通过的测试 |
| `required_artifacts` | list | 是 | 需要的产物 |

**xv6 示例**（`spec/verification/public-matrix.yaml` 片段）：

```yaml
stage: xv6-core
public_requirements:
  - id: verify-boot-banner
    description: Kernel prints boot banner before XV6_BOOT_OK
    related_specs:
      - module: kernel/boot
        operation: boot_banner
    required_tests:
      - bootstrap_banner_not_null
      - bootstrap_banner_length_positive
    required_artifacts:
      - build/qemu_boot.log

  - id: verify-page-allocator
    description: Physical page allocator passes alloc-free cycle
    related_specs:
      - module: kernel/memory
        operation: kalloc
      - module: kernel/memory
        operation: kfree
    required_tests:
      - kalloc_exhaustion
      - kalloc_alignment
      - kalloc_kfree_cycle
    required_artifacts:
      - build/kernel.elf
```

### 6.5.3 EvidenceSchema

**用途**：定义证据项的标准格式。

**字段表**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `evidence_item.id` | string | 是 | 证据项 ID |
| `evidence_item.kind` | string | 是 | 类型：`build_log` / `test_log` / `qemu_log` / `trace` / `benchmark` / `review_note` |
| `evidence_item.producer` | string | 是 | 产生者（命令或 Agent） |
| `evidence_item.related_specs` | list | 是 | 关联的 spec |
| `evidence_item.pass_condition` | string | 是 | 通过条件 |
| `evidence_item.artifact_paths` | list | 是 | 产物路径 |

---

## 6.6 Report Contract

**用途**：定义阶段报告和最终报告的必需内容。

**报告至少应引用**：
- 相关 ArchitectureSlice
- 相关 ModuleSpec / OperationContract
- 对应验证证据
- 是否触发过 SpecPatch（含 `spec_patch_id`）
- 复现锚点 `commit_sha`（必要时含 `parent_sha`）
- AI 参与和参考材料使用声明

---

## 6.7 相关文档

- [05 Spec Schema 参考（上）：架构、模块、操作](./05-spec-schema-arch-module-op.md)
- [03 CLI 命令参考（中）：构建、运行与测试](./03-commands-build-run-test.md)
- [04 CLI 命令参考（下）：验证、Agent、报告与知识库](./04-commands-verify-agent-report.md)
