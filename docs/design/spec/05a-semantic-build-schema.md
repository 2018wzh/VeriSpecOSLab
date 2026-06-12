# 语义构建模式 (Semantic Build Schema)

## 概述

`ToolchainSpec` 定义了**工具无关的语义构建模式**，允许多个生成器（Makefile、xtask、CMake、Bazel 等）从同一份 spec 生成各自的构建配置。

关键原则：
- **语义优先**：spec 描述「做什么」，不描述「怎样做」
- **生成器可选**：多个独立生成器可以解释同一份 spec
- **幂等性**：同一份 spec 生成的结果应始终一致
- **可追踪性**：生成的构建配置包含 spec 元数据，支持溯源

---

## 1. 构建阶段语义 (BuildPhaseSemantics)

### 1.1 基础结构

```yaml
build:
  allowed_output_path:
    - Makefile
    - CMakeLists.txt
    - xtask/src/tasks.rs
    - xtask/Cargo.toml

  # 通用字段（所有阶段都支持）
  phases:
    - name: phase_name          # 阶段标识，用于依赖、日志、证据映射
      semantic:
        type: enum              # compile | link | archive | test | custom
        
        # 执行提示
        dependencies: [...]     # 前置任务列表
        parallel: bool          # 是否可并行执行（与其他 parallel=true 的任务）
        timeout_secs: int       # 超时时间
        retry_on_failure: int   # 失败重试次数
```

`allowed_output_path` 用于声明 agent 允许写入的本地构建系统文件路径。  
当前实现会用它同时约束：

- toolchain codegen prompt 的允许输出路径
- agent 落盘前的本地白名单校验
- `vos build` 读取 `.vos/toolchain.json` 时的 manifest 文件校验

### 1.2 编译阶段 (compile)

```yaml
semantic:
  type: compile
  
  compiler: string              # 编译器提示：gcc | clang | icc | msvc
  
  # 源文件
  sources:
    - pattern: string           # glob 模式：src/**/*.c
      exclude: [patterns]       # 排除模式：[src/test/**, src/example/**]
  
  include_dirs:                 # 包含目录
    - include
    - sys/include
  
  # 编译标志（语义形式，非语法形式）
  flags:
    warnings:                   # [all, extra, error, pedantic, none]
      - all
      - error
    optimization: string        # O0 | O1 | O2 | O3 | Os | Oz
    debug: bool                 # 是否包含调试符号
    defines:                    # 预处理器定义
      - KERNEL
      - CONFIG_BIGMEM=1
      - MAX_PROCS=256
    extra: string               # 工具特定标志（降级方案）
  
  standard: string              # c89 | c99 | c11 | c17 | gnu99 | gnu17
  
  # 输出契约
  output_dir: path              # 对象文件输出目录
  output_pattern: string        # 预期输出模式：*.o
```

**例子**：
```yaml
phases:
  - name: kernel_compile
    semantic:
      type: compile
      compiler: gcc
      sources:
        - pattern: "kernel/**/*.c"
          exclude: ["kernel/test/**"]
      include_dirs: [include, kernel/include]
      flags:
        warnings: [all, error]
        optimization: O2
        debug: true
        defines:
          - KERNEL
          - CONFIG_DEBUG=1
      standard: c11
      output_dir: build/
      output_pattern: "*.o"
      timeout_secs: 120
```

### 1.3 链接阶段 (link)

```yaml
semantic:
  type: link
  
  linker: string                # ld | gold | lld（提示）
  
  # 输入
  input_artifacts:              # 目标文件、库、存档
    - build/kernel.o
    - build/user.a
  
  # 输出
  output_file: path             # 最终可执行文件或库
  output_format: string         # elf | elf64 | elf32 | mach-o | pe | wasm
  
  # 链接脚本与约束
  linker_script: path           # 链接脚本文件
  
  libraries:                    # 链接的库
    - name: c                   # 库名称
      hint: "-lc"               # 工具特定的标志
    - name: m
      hint: "-lm"
  
  library_dirs:                 # 库搜索路径
    - /lib
    - /usr/lib
  
  # 链接标志
  flags:
    extra: string               # 额外的链接器标志
  
  dependencies: [kernel_compile]  # 前置任务
```

**例子**：
```yaml
phases:
  - name: link_kernel
    semantic:
      type: link
      linker: ld
      input_artifacts:
        - build/kernel.o
        - build/user.a
      output_file: kernel
      output_format: elf64
      linker_script: kernel/link.ld
      libraries:
        - name: c
          hint: "-lc"
      library_dirs: [/usr/riscv64-unknown-elf/lib]
      flags:
        extra: "-nostdlib -N"
      dependencies: [kernel_compile]
      timeout_secs: 60
```

### 1.4 存档阶段 (archive)

```yaml
semantic:
  type: archive
  
  archiver: string              # ar | llvm-ar（提示）
  
  input_artifacts:              # 输入的目标文件
    - build/user1.o
    - build/user2.o
  
  output_file: path             # 输出的存档文件（如 user.a）
  library_type: string          # static | shared
  
  dependencies: [...]
```

### 1.5 测试阶段 (test)

```yaml
semantic:
  type: test
  
  framework: string             # check | criterion | ctest | custom
  test_binary: path             # 测试可执行文件路径
  test_args: [args]             # 测试参数
  
  # 验证输出
  expected_pattern: string      # 成功标志的正则/文本
  expected_output_file: path    # 期望输出文件
  
  timeout_secs: int
  dependencies: [link_kernel]
```

### 1.6 自定义阶段 (custom)

```yaml
semantic:
  type: custom
  
  description: string           # 阶段描述
  command: string               # 确切的 shell 命令（使用此字段是最后手段）
  working_dir: path             # 工作目录
  
  env_vars:                      # 环境变量
    CFLAGS: "-O2"
    DEBUG: "1"
  
  expected_outputs: [paths]     # 期望的输出文件
  
  dependencies: [...]
```

---

## 2. 字段映射与生成指南

### 2.1 Makefile 生成映射

| 语义字段 | Makefile 对应 | 例子 |
|---------|--------------|------|
| `compile.sources` | `SOURCES := $(wildcard ...)` | 变量定义 |
| `compile.include_dirs` | `CFLAGS += -I path` | 编译标志 |
| `compile.flags.warnings` | `CFLAGS += -Wall -Werror` | 警告标志 |
| `compile.flags.optimization` | `CFLAGS += -O2` | 优化标志 |
| `compile.flags.defines` | `CFLAGS += -DKERNEL` | 预处理定义 |
| `compile.output_pattern` | `%.o: %.c` | 模式规则 |
| `link.input_artifacts` | 目标依赖 | `kernel: $(OBJECTS)` |
| `link.linker_script` | `LDFLAGS += -T link.ld` | 链接标志 |

### 2.2 Xtask 生成映射

| 语义字段 | Xtask 对应 | 例子 |
|---------|-----------|------|
| `compile.sources` | `glob::glob("src/**/*.c")` | 文件列举 |
| `compile.flags` | `cc::Build::new().opt_level(2)` | 构建器模式 |
| `compile.defines` | `.define("KERNEL", None)` | 定义 |
| `phase.dependencies` | `compile()?; link()?;` | 任务链 |
| `phase.parallel` | `rayon::par_iter()` | 并行化 |

### 2.3 CMake 生成映射

| 语义字段 | CMake 对应 | 例子 |
|---------|-----------|------|
| `compile.sources` | `file(GLOB_RECURSE SOURCES ...)` | 文件搜索 |
| `compile.include_dirs` | `target_include_directories()` | 包含路径 |
| `compile.flags` | `target_compile_options()` | 编译选项 |
| `compile.defines` | `target_compile_definitions()` | 定义 |
| `link.input_artifacts` | `target_link_libraries()` | 链接库 |

---

## 3. 验证与约束

### 3.1 Schema 验证

所有 spec 必须满足：

```yaml
build:
  phases:
    - name: (required, unique)
      semantic:
        type: (required, enum)
        dependencies: (optional, list of existing phase names)
        
        # 类型特定字段（根据 type 验证）
```

### 3.2 循环依赖检测

生成器必须检测并拒绝循环依赖：
```
A depends on B
B depends on C
C depends on A  ← 错误
```

### 3.3 输出工件验证

每个 phase 的 `output_pattern` 或 `output_file` 必须与实际生成的文件匹配。

---

## 4. 降级与扩展

### 4.1 使用 custom 降级

如果无法用语义字段表达，使用 `custom` 类型：

```yaml
- name: special_build
  semantic:
    type: custom
    description: "使用 autoconf 构建 libfoo"
    command: "./configure --prefix=/opt && make"
    expected_outputs: [libfoo.a, libfoo.so]
```

### 4.2 extra 字段

各字段的 `extra` 字段用于工具特定扩展：

```yaml
flags:
  extra: "-march=native -mtune=native"  # 生成器直接传递
```

---

## 5. 完整示例

```yaml
toolchain:
  target_arch: riscv64
  target_triple: riscv64-unknown-elf

build:
  phases:
    - name: kernel_compile
      semantic:
        type: compile
        compiler: gcc
        sources:
          - pattern: "kernel/**/*.c"
            exclude: ["kernel/test/**"]
        include_dirs: [include, kernel/include]
        flags:
          warnings: [all, error]
          optimization: O2
          debug: true
          defines:
            - KERNEL
            - RISCV64
        standard: c11
        output_dir: build/
        output_pattern: "*.o"
        timeout_secs: 120
    
    - name: user_compile
      semantic:
        type: compile
        sources:
          - pattern: "user/**/*.c"
        include_dirs: [include, user/include]
        flags:
          warnings: [all]
          optimization: O2
        standard: c11
        output_dir: build/user/
        timeout_secs: 60
    
    - name: user_archive
      semantic:
        type: archive
        input_artifacts:
          - build/user/shell.o
          - build/user/cat.o
          - build/user/echo.o
        output_file: build/user.a
        library_type: static
        dependencies: [user_compile]
    
    - name: link_kernel
      semantic:
        type: link
        input_artifacts:
          - build/kernel.o
          - build/user.a
        output_file: kernel
        output_format: elf64
        linker_script: kernel/link.ld
        libraries:
          - name: c
            hint: "-lc"
        flags:
          extra: "-nostdlib"
        dependencies: [kernel_compile, user_archive]
        timeout_secs: 60
    
    - name: test_build
      semantic:
        type: test
        framework: custom
        test_binary: ./test_runner
        expected_pattern: "all tests passed"
        timeout_secs: 30
        dependencies: [link_kernel]

validation:
  must_pass:
    - kernel_compile
    - user_archive
    - link_kernel
    - test_build
```

---

## 6. 与 VOS Runtime 的关系

`ToolchainSpec` 语义层由 VOS Runtime 负责：

1. **解析**：vos-spec 将 YAML 解析为类型化的 TypeScript 结构
2. **验证**：检查循环依赖、类型约束、引用有效性
3. **生成**：调用适当的生成器（Makefile、Xtask、CMake 等）
4. **执行**：运行生成的构建工具，采集证据

详见 [`05b-vos-toolchain-generation-contract.md`](05b-vos-toolchain-generation-contract.md)。
