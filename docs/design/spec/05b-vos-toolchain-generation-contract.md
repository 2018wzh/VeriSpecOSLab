# VOS 工具链生成与执行契约

## 概述

本文档定义 VOS Runtime 如何从语义构建 spec 物化构建系统、执行并采集证据。

核心流程：
```
spec/toolchain/toolchain.yaml
    ↓ [vos-spec 解析与验证]
语义构建阶段 (BuildPhaseSemantics)
    ↓ [vos build generate 物化本地构建系统]
项目根构建系统文件 + .vos/toolchain.json
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

## 2. 生成器契约

所有生成器（无论输出何种格式）都必须实现以下契约：

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
  artifact: ToolchainArtifact
    - content: string (Makefile, CMakeLists.txt, Rust code, etc)
    - path: Path (must be listed in build.allowed_output_path)
    - format: string (makefile, cmake, xtask, bazel, etc)
    
  metadata: GenerationMetadata {
    spec_id: string
    spec_stage: int
    phases: [string]  # all phase names
    generator: string  # "makefile-v1.0"
    generated_at: ISO8601
    source_spec: Path
  }
```

### 2.3 必需元数据

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

同一份 spec 在同一 stage 生成的工件内容必须**完全相同**（除去时间戳）：

```
spec A @ stage N → generator X → output O1
spec A @ stage N → generator X → output O2
diff(O1, O2) == metadata changes only
```

此约束用于验证生成的正确性。

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

### 4.1 生成失败

```
if generator.generate(spec) fails:
  error: "Makefile generation failed"
  reason: "Unsupported field: phase.semantic.custom_linker_option"
  remediation: |
    - Check spec for typos
    - Use phase.semantic.flags.extra for non-standard options
    - Or use phase.type=custom with explicit command
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

## 5. 生成器选择策略

### 5.1 自动检测算法

```
if project has Cargo.toml:
  prefer: xtask
elif project has significant C/C++ codebase:
  prefer: Makefile
elif project has CMakeLists.txt:
  prefer: CMake
elif project has setup.py or pyproject.toml:
  suggest: custom (Python-based build)
else:
  ask user
```

### 5.2 用户选择

```bash
$ vos build --generator=makefile     # 强制 Makefile
$ vos build --generator=xtask        # 强制 xtask
$ vos build --generator=cmake        # 强制 CMake
$ vos build --generator=bazel        # 强制 Bazel
$ vos build --generator=custom       # 使用 custom 类型 (phase 中定义 command)
```

---

## 6. 与现有 Makefile/CMakeLists.txt 的集成

### 6.1 增强现有配置

如果项目已有手写的 Makefile：

```bash
# 方式 1：使用现有 Makefile（不生成）
$ vos build --toolchain=Makefile

# 方式 2：从 spec 生成新 Makefile，对比差异
$ vos build --dry-run --generator=makefile
# 查看生成的 Makefile
# 手动合并或替换
```

### 6.2 迁移策略

```
1. 将现有 Makefile 转换为 spec/toolchain/toolchain.yaml
   （逆向工程：从 Makefile 提取语义）

2. 运行 vos build --dry-run 验证生成的 Makefile 与原始一致

3. 切换到 vos build 管理构建

4. 后续修改在 spec 中进行，由生成器自动应用到 Makefile
```

---

## 7. 多生成器验证（高级）

### 7.1 生成对比

```bash
$ vos build --stage 2 --generators=makefile,xtask,cmake
```

生成三份不同格式的构建配置，可用于：
- 验证 spec 语义一致性（三个生成器应产生等价的构建行为）
- 学习不同工具如何表达同一构建逻辑
- 调试 spec 中的歧义字段

### 7.2 证据对比

```
compare:
  makefile_artifacts vs xtask_artifacts vs cmake_artifacts
  
  all should produce:
    - 相同的目标文件
    - 相同的链接输出
    - 相同的运行行为
  
  if diverge:
    ✗ spec 有歧义或生成器有 bug
    需要修复 spec 或生成器
```

---

## 8. 完整例子：xv6 在 RISC-V 上的构建

```bash
# 初始化
$ vos init --template xv6
$ cat spec/toolchain/toolchain.yaml

# 查看会如何生成
$ vos build --stage 2 --dry-run --generator=makefile
# 输出: Generated Makefile at /tmp/vos_build_12345/Makefile

# 实际构建
$ vos build --stage 2 --generator=makefile
# 执行:
#   - Makefile 生成器解析 spec
#   - 输出 Makefile
#   - 运行: make build
#   - 采集日志与工件
#   - 返回证据束

# 查看证据
$ vos report build --stage 2
# 输出构建日志、工件列表、每个阶段的耗时

# 用 xtask 重新构建以对比
$ vos build --stage 2 --generator=xtask
$ cargo xtask build
$ vos report build --compare makefile vs xtask
```

---

## 相关文档

- [`05a-semantic-build-schema.md`](05a-semantic-build-schema.md) - 语义构建字段定义
- [`05c-generator-reference.md`](05c-generator-reference.md) - 生成器示例与模式
- [`../toolchain/01-boundaries-and-roles.md`](../toolchain/01-boundaries-and-roles.md) - VOS 运行时角色定位
