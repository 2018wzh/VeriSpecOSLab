# VOS 工具链生成与执行契约

## 概述

本文档定义 VOS Runtime 如何从语义构建 spec 物化构建系统、执行并采集证据。

核心流程：
```
spec/toolchain/toolchain.yaml
    ↓ [vos-spec 解析与验证]
语义构建阶段 (BuildPhaseSemantics)
    ↓ [本地 Agent 生成构建系统草案]
ToolchainGenerationDraft
    ↓ [vos deterministic gate]
项目根构建系统文件 + .vos/toolchain.json + ledger
    ↓ [vos-runtime 执行]
构建输出 + 工件
    ↓ [证据采集与映射]
证据束 (Evidence Bundle)
```

---

## 1. vos build 调用流程

### 1.1 标准流程

```bash
$ vos build --stage 2
```

执行步骤：

1. **解析 spec**
   ```
   vos-spec reads spec/toolchain/toolchain.yaml
   validates against semantic-build-schema
   → BuildSpec 结构化实例
   ```

2. **读取当前构建系统 manifest**
   ```
   read .vos/toolchain.json
   validate spec hash
   validate files exist
   validate files are allowed by build.allowed_output_path
   ```

3. **执行当前构建系统**
   ```
   if artifact is Makefile:
     $ make build
   elif artifact is xtask:
     $ cargo xtask build
   elif artifact is cmake:
     $ cmake . && cmake --build .
   ```

5. **采集证据**
   ```
   capture:
     - stdout, stderr
     - exit code
     - built artifacts
     - timestamps
   
   map to spec:
     - build stdout → phase logs
     - artifacts → output_pattern validation
     - errors → trace back to spec clauses
   ```

6. **返回结果**
   ```
   {
     status: success|failure,
     evidence: {
       phases: [
         {name: "kernel_compile", status: "pass", log: "..."},
         {name: "link_kernel", status: "pass", log: "..."}
       ],
       artifacts: [...],
       timestamps: {...}
     }
   }
   ```

### 1.2 完整命令示例

**先由 VOS 物化，再由 build 执行（推荐）**
```bash
$ vos build generate
$ vos build
# build generate 根据 ToolchainSpec 生成 Makefile/xtask/CMakeLists.txt 等
# build 读取 .vos/toolchain.json 并执行
```

**仅执行 dry-run**
```bash
$ vos build --dry-run
# 不生成新构建系统
# 仅展示当前 manifest 将执行的 phase 命令
```

**显式加载一份 manifest**
```bash
$ vos build --toolchain=/path/to/toolchain.json
# 跳过默认 .vos/toolchain.json
# 直接执行该 manifest 指向的构建系统
```

---

## 2. Agent-assisted 生成契约

`vos build generate` v1 不内置纯确定性 Makefile/CMake/xtask 生成器。
它调用本地 `vos-agent` 生成草案，但最终 authority 属于 `vos-cli`：

- Agent 只能提出构建文件、manifest 和构建说明草案。
- VOS 必须校验 `allowed_output_path`、`.vos/toolchain.json`、spec hash、clean tree、commit ledger 和 evidence。
- Agent 草案未通过 gate 时不得落盘。
- 无本地 Agent/provider 时命令明确失败，不使用模板兜底。

### 2.1 输入接口

```
Input:
  spec: BuildSpec
    - phases: [BuildPhaseSemantics, ...]
    - toolchain metadata (target arch, triple, etc)
    - project structure hints
    - build.allowed_output_path
  
  context: GenerationContext
    - project_root: Path
    - stage: int
    - working_dir: Path
    - generator_options: Map<string, string>
```

### 2.2 输出接口

```
Output:
  files:
    - path: Path       # must be listed in build.allowed_output_path
      content: string  # Makefile, CMakeLists.txt, Rust code, etc
  manifest: object     # candidate .vos/toolchain.json, manifest_version: 2
  build_instructions: string
  spec_refs: [string]
  changed_targets: [Path]
```

### 2.3 必需元数据

生成的构建配置必须包含 spec 来源信息（用于溯源），并产出 v2 manifest：

```json
{
  "manifest_version": 2,
  "files": ["Makefile"],
  "build": { "variants": [{ "id": "baseline", "commands": ["make all"], "artifacts": ["build/kernel.bin"] }] },
  "run": { "profiles": [{ "id": "default", "command": "qemu-system-riscv64", "args": [] }], "cases": [{ "id": "boot-smoke", "profile": "default", "success_regex": "XV6_BOOT_OK" }] },
  "test": { "suites": [{ "name": "boot-smoke", "kind": "qemu-case", "build_variant": "baseline", "run_case": "boot-smoke" }] }
}
```

不得生成旧式 `build.commands`、顶层 `tests`、字符串 suite、或旧式
`run.command/successSignal/artifact`。VOS 不做旧 manifest fallback，也不隐式扫描
Makefile、QEMU 参数或测试脚本。

生成的构建配置必须包含 spec 来源信息（用于溯源）：

**Makefile 中：**
```makefile
# ========================================
# Auto-generated from spec/toolchain/toolchain.yaml
# Spec ID: xv6-riscv64
# Spec Stage: 2
# Phases: kernel_compile link_kernel test_boot
# Generator: makefile-generator v1.0
# Generated: 2024-05-15T10:30:45Z
# ========================================
```

**Rust 中：**
```rust
//! Auto-generated from spec/toolchain/toolchain.yaml
//! Spec ID: xv6-riscv64
//! Spec Stage: 2
//! Phases: kernel_compile link_kernel test_boot
//! Generator: xtask-generator v1.0
//! Generated: 2024-05-15T10:30:45Z

// ... rest of code
```

**CMake 中：**
```cmake
# ========================================
# Auto-generated from spec/toolchain/toolchain.yaml
# Spec ID: xv6-riscv64
# Spec Stage: 2
# Phases: kernel_compile link_kernel test_boot
# Generator: cmake-generator v1.0
# Generated: 2024-05-15T10:30:45Z
# ========================================
```

### 2.4 幂等性约束

Agent 输出不要求字节级确定性；VOS gate 和最终 manifest 必须确定性裁决同一类草案：

```
spec A @ stage N + draft O
  -> same path/spec/manifest/ledger checks
  -> same accept/reject semantics
```

此约束用于保证灵活生成不会绕过 VOS 的执行和审计边界。

### 2.5 编译/链接语义完整性

生成器必须确保：

1. **编译命令**包含所有 spec 中的标志、定义、包含目录
2. **链接命令**包含所有输入工件、库、链接脚本、标志
3. **依赖顺序**遵守 spec 中的 `dependencies` 声明
4. **输出位置**匹配 spec 中的 `output_dir`、`output_file`

违反这些约束会导致生成失败。

---

## 3. 执行与证据采集

### 3.1 执行环境准备

vos 在执行生成的构建工具前，准备环境：

```
set CWD to project_root
set PATH to include required tools (gcc, ld, etc)
set env vars from spec/toolchain/toolchain.yaml
  if environment.required_tools defined:
    check tool versions match spec constraints
```

### 3.2 执行与超时

```
for each phase in spec.phases:
  if phase.dependencies not met:
    fail with error message
  
  if phase.parallel == false and phase != first:
    wait for previous phase
  
  run phase with timeout:
    actual_timeout = phase.timeout_secs or default_timeout
    if runtime > actual_timeout:
      terminate and report timeout
  
  capture stdout, stderr, exit code
  
  if phase failed:
    if phase.retry_on_failure > 0:
      retry up to N times
    else:
      stop or continue based on spec
```

### 3.3 工件验证

构建完成后，vos 验证输出工件：

```
for each phase:
  if phase.output_pattern:
    actual_artifacts = glob(output_dir, output_pattern)
    expected ≈ actual?
    
    if mismatch:
      warn or fail based on strictness
  
  if phase.expected_outputs (for custom):
    check all expected files exist
```

### 3.4 证据映射

构建日志与 spec 的映射关系：

```yaml
evidence:
  build:
    phases:
      - id: kernel_compile
        spec_source: spec/toolchain/toolchain.yaml#build.phases[0]
        status: pass|fail
        duration_secs: 5.3
        stdout_excerpt: "gcc -c kernel/main.c ..."
        stderr: ""
        exit_code: 0
        artifacts_produced:
          - build/kernel.o (size: 12345)
          - build/trap.o (size: 6789)
      
      - id: link_kernel
        spec_source: spec/toolchain/toolchain.yaml#build.phases[1]
        status: pass|fail
        duration_secs: 2.1
        stdout: "ld -T kernel/link.ld -o kernel ..."
        stderr: ""
        exit_code: 0
        artifacts_produced:
          - kernel (size: 98765, format: elf64)
```

---

## 4. 错误处理与诊断

### 4.1 Agent draft 或 VOS gate 失败

```
if local agent/provider is unavailable:
  error: "toolchain generation requires a configured local vos-agent provider"
  status: failed

if agent draft fails VOS gate:
  error: "toolchain draft rejected"
  reason: "path outside build.allowed_output_path"
  remediation: |
    - Check build.allowed_output_path
    - Check draft manifest files and changed_targets
    - Re-run vos build generate after fixing spec or Agent configuration
```

### 4.2 执行失败

```
if build fails at phase P:
  error: "Phase 'kernel_compile' failed"
  spec_clause: "spec/toolchain/toolchain.yaml#build.phases[0]"
  
  diagnosis:
    - Last 10 lines of stderr: "..."
    - Check if required source files exist
    - Verify compiler version matches spec
    - Check include directories
  
  evidence:
    compile_command: "gcc -Wall -O2 -DKERNEL ..."
    exit_code: 1
```

### 4.3 超时失败

```
if phase exceeds timeout:
  error: "Phase 'link_kernel' exceeded timeout"
  spec_timeout: 60 seconds
  actual_runtime: 125 seconds
  remediation: |
    - Increase phase.semantic.timeout_secs in spec
    - Check if link is taking longer than expected
    - May indicate circular dependencies or large binary
```

---

## 5. Agent draft 偏好与选择策略

`vos build generate` v1 不暴露 `--generator`。工具选择是 Agent draft 的一部分，
但必须受 `build.allowed_output_path` 约束。例如 spec 只允许写 `Makefile` 时，
Agent 不能改写 `CMakeLists.txt` 或 `xtask/`。

未来如果需要显式偏好，可以在 ToolchainSpec 或 Agent profile 中表达为 hint，
但 CLI 仍不把 hint 当成绕过 VOS gate 的 authority。

---

## 6. 与现有 Makefile/CMakeLists.txt 的集成

### 6.1 登记现有配置

如果项目已有手写的 Makefile：

```bash
# 方式 1：手工创建或审阅 .vos/toolchain.json，使 files 指向 Makefile
$ vos ledger record --actor human --intent "register existing Makefile" \
  --spec-ref spec/toolchain/toolchain.yaml \
  --changed-target Makefile \
  --changed-target .vos/toolchain.json

# 方式 2：让 Agent 起草 manifest 和必要的构建文件变更
$ vos build generate
```

`vos build --toolchain` 只接受 manifest 文件；不得把裸 Makefile、
`CMakeLists.txt` 或 xtask 入口当作 ToolchainSpec manifest。

### 6.2 迁移策略

```
1. 将现有 Makefile 转换为 spec/toolchain/toolchain.yaml
   （逆向工程：从 Makefile 提取语义）

2. 创建或生成 .vos/toolchain.json，使 manifest 显式登记 Makefile、命令和 artifacts

3. 运行 vos init 或 vos ledger record 为当前 HEAD 建立 ledger entry

4. 运行 vos build --dry-run 和 vos build，确认 manifest 执行路径可审计

5. 后续修改通过 vos build generate 或人工 commit + vos ledger record 进入审计链
```

---

## 7. 多工具链对比（未来扩展）

目标态允许同一 ToolchainSpec 物化为 Makefile、xtask、CMake 等不同构建系统，
但 v1 不实现多生成器 CLI。任何对比都必须以多个受控 manifest/run 的 evidence
为依据，而不是让 Portal、Agent 或 shell 绕过 `vos build generate` / `vos build`
链路。

---

## 8. 完整例子：xv6 在 RISC-V 上的构建

```bash
# 初始化
$ vos init --template xv6
$ cat spec/toolchain/toolchain.yaml

# 物化构建系统
$ vos build generate
# 执行:
#   - 调用本地 vos-agent 生成 ToolchainGenerationDraft
#   - VOS 校验 allowed_output_path、manifest、spec hash、ledger
#   - 写 Makefile/.vos/toolchain.json/instructions artifact
#   - 写 ledger 并创建 [vos][toolchain] Generate build system commit

# 实际构建
$ vos build --stage 2
# 执行:
#   - 读取 .vos/toolchain.json
#   - 验证 manifest files 和 clean HEAD ledger
#   - 运行 manifest 中登记的 build command
#   - 采集日志与工件
#   - 返回证据束

# 查看证据
$ vos report build --stage 2
# 输出构建日志、工件列表、每个阶段的耗时
```

---

## 相关文档

- [`05a-semantic-build-schema.md`](05a-semantic-build-schema.md) - 语义构建字段定义
- [`05c-generator-reference.md`](05c-generator-reference.md) - 生成器示例与模式
- [`../toolchain/01-boundaries-and-roles.md`](../toolchain/01-boundaries-and-roles.md) - VOS 运行时角色定位
