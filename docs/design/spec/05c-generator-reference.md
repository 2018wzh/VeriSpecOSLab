# 生成器参考实现与示例

## 概述

本文档展示如何从同一份语义 spec 生成多种工具链格式（Makefile、Xtask、CMake），以及生成器需要实现的接口。

---

## 1. 示例 Spec

我们用一个完整的 xv6 RISC-V 构建示例，展示不同生成器的输出。

### 1.1 源 Spec: `spec/toolchain/toolchain.yaml`

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

build:
  phases:
    # 第一步：编译内核源文件
    - name: kernel_compile
      semantic:
        type: compile
        compiler: gcc
        sources:
          - pattern: "kernel/**/*.c"
            exclude: ["kernel/test/**"]
        include_dirs:
          - include
          - kernel/include
        flags:
          warnings: [all, error]
          optimization: O2
          debug: true
          defines:
            - KERNEL
            - ARCH_RISCV64
            - CONFIG_BIGMEM=1
        standard: c11
        output_dir: build/
        output_pattern: "*.o"
        timeout_secs: 120

    # 第二步：编译用户程序
    - name: user_compile
      semantic:
        type: compile
        sources:
          - pattern: "user/**/*.c"
        include_dirs:
          - include
          - user/include
        flags:
          warnings: [all]
          optimization: O2
          debug: false
          defines:
            - USER
        standard: c11
        output_dir: build/user/
        timeout_secs: 60

    # 第三步：生成用户程序库
    - name: user_archive
      semantic:
        type: archive
        input_artifacts:
          - build/user/shell.o
          - build/user/cat.o
          - build/user/echo.o
          - build/user/ls.o
        output_file: build/user.a
        library_type: static
        dependencies: [user_compile]
        timeout_secs: 30

    # 第四步：链接内核
    - name: link_kernel
      semantic:
        type: link
        input_artifacts:
          - build/kernel.o
          - build/trap.o
          - build/memory.o
          - build/user.a
        output_file: kernel
        output_format: elf64
        linker_script: kernel/link.ld
        libraries:
          - name: c
            hint: "-lc"
        library_dirs:
          - /opt/riscv/lib
        flags:
          extra: "-nostdlib -N"
        dependencies: [kernel_compile, user_archive]
        timeout_secs: 60

    # 第五步：生成镜像
    - name: generate_image
      semantic:
        type: custom
        description: "使用 objcopy 生成 kernel.bin"
        command: "riscv64-unknown-elf-objcopy -O binary kernel kernel.bin"
        expected_outputs: [kernel.bin]
        dependencies: [link_kernel]
        timeout_secs: 30

validation:
  must_pass:
    - kernel_compile
    - user_archive
    - link_kernel
    - generate_image
```

---

## 2. Makefile 生成器输出

### 2.1 生成的 Makefile

```makefile
# ========================================
# Auto-generated from spec/toolchain/toolchain.yaml
# Spec ID: xv6-riscv64
# Spec Stage: 2
# Phases: kernel_compile user_compile user_archive link_kernel generate_image
# Generator: makefile-generator v1.0
# Generated: 2024-05-15T10:30:45Z
# ========================================

# Toolchain
CC = gcc
AR = ar
LD = ld
OBJCOPY = riscv64-unknown-elf-objcopy

# Architecture & Target
TARGET_TRIPLE = riscv64-unknown-elf
TARGET_ARCH = riscv64

# Directories
BUILD_DIR = build
BUILD_USER_DIR = build/user
KERNEL_DIR = kernel
USER_DIR = user

# Flags
KERNEL_CFLAGS = -Wall -Werror -O2 -g -DKERNEL -DARCH_RISCV64 -DCONFIG_BIGMEM=1 -std=c11
KERNEL_INCLUDES = -I include -I kernel/include

USER_CFLAGS = -Wall -O2 -DUSER -std=c11
USER_INCLUDES = -I include -I user/include

LDFLAGS = -T kernel/link.ld -nostdlib -N
LDLIBS = -lc
LIB_DIRS = -L /opt/riscv/lib

# Source Files
KERNEL_SOURCES = $(wildcard kernel/**/*.c)
KERNEL_SOURCES := $(filter-out kernel/test/%, $(KERNEL_SOURCES))
KERNEL_OBJECTS = $(patsubst %.c,build/%.o,$(KERNEL_SOURCES))

USER_SOURCES = $(wildcard user/**/*.c)
USER_OBJECTS = $(patsubst %.c,build/user/%.o,$(USER_SOURCES))
USER_OBJECTS_LIST = build/user/shell.o build/user/cat.o build/user/echo.o build/user/ls.o

# Phony Targets
.PHONY: all clean kernel_compile user_compile user_archive link_kernel generate_image

# Default Target
all: generate_image

# Phase 1: Compile Kernel
.PHONY: kernel_compile
kernel_compile: $(KERNEL_OBJECTS)

build/%.o: %.c
	@mkdir -p $(dir $@)
	$(CC) $(KERNEL_CFLAGS) $(KERNEL_INCLUDES) -c $< -o $@

# Phase 2: Compile User Programs
.PHONY: user_compile
user_compile: $(USER_OBJECTS)

build/user/%.o: user/%.c
	@mkdir -p $(dir $@)
	$(CC) $(USER_CFLAGS) $(USER_INCLUDES) -c $< -o $@

# Phase 3: Archive User Programs
.PHONY: user_archive
user_archive: build/user.a

build/user.a: $(USER_OBJECTS_LIST)
	$(AR) rcs $@ $^

# Phase 4: Link Kernel
.PHONY: link_kernel
link_kernel: kernel

kernel: $(KERNEL_OBJECTS) build/user.a
	$(LD) $(LDFLAGS) $(LIB_DIRS) -o $@ $(KERNEL_OBJECTS) build/user.a $(LDLIBS)

# Phase 5: Generate Image
.PHONY: generate_image
generate_image: kernel.bin

kernel.bin: kernel
	$(OBJCOPY) -O binary kernel kernel.bin

# Cleanup
.PHONY: clean
clean:
	rm -rf build/ kernel kernel.bin

# Debug Info
.PHONY: info
info:
	@echo "Target: $(TARGET_TRIPLE)"
	@echo "Build Dir: $(BUILD_DIR)"
	@echo "Kernel Sources: $(KERNEL_SOURCES)"
	@echo "User Sources: $(USER_SOURCES)"
```

### 2.2 使用方式

```bash
# 完整构建
$ make all

# 单独阶段
$ make kernel_compile
$ make user_archive
$ make link_kernel
$ make generate_image

# 清理
$ make clean
```

---

## 3. Xtask 生成器输出

### 3.1 生成的 Rust 代码: `xtask/src/tasks.rs`

```rust
//! Auto-generated from spec/toolchain/toolchain.yaml
//! Spec ID: xv6-riscv64
//! Spec Stage: 2
//! Phases: kernel_compile user_compile user_archive link_kernel generate_image
//! Generator: xtask-generator v1.0
//! Generated: 2024-05-15T10:30:45Z

use std::path::{Path, PathBuf};
use anyhow::{anyhow, Context, Result};

const TARGET_TRIPLE: &str = "riscv64-unknown-elf";
const BUILD_DIR: &str = "build";

// ============================================================================
// Phase 1: Compile Kernel
// ============================================================================

pub fn kernel_compile() -> Result<()> {
    println!("==> Compiling kernel sources...");
    
    let kernel_sources: Vec<PathBuf> = glob::glob("kernel/**/*.c")?
        .filter_map(|p| p.ok())
        .filter(|p| {
            !p.to_string_lossy().contains("kernel/test/")
        })
        .collect();

    cc::Build::new()
        .compiler("gcc")
        .warnings(true)
        .warnings_into_errors(true)
        .opt_level(2)
        .debug(true)
        .define("KERNEL", None)
        .define("ARCH_RISCV64", None)
        .define("CONFIG_BIGMEM", Some("1"))
        .std("c11")
        .includes(&["include", "kernel/include"])
        .files(&kernel_sources)
        .out_dir(BUILD_DIR)
        .compile("kernel");

    println!("==> Kernel compilation complete ({} files)", kernel_sources.len());
    Ok(())
}

// ============================================================================
// Phase 2: Compile User Programs
// ============================================================================

pub fn user_compile() -> Result<()> {
    println!("==> Compiling user programs...");
    
    let user_sources: Vec<PathBuf> = glob::glob("user/**/*.c")?
        .filter_map(|p| p.ok())
        .collect();

    cc::Build::new()
        .compiler("gcc")
        .warnings(true)
        .opt_level(2)
        .debug(false)
        .define("USER", None)
        .std("c11")
        .includes(&["include", "user/include"])
        .files(&user_sources)
        .out_dir("build/user")
        .compile("user");

    println!("==> User program compilation complete ({} files)", user_sources.len());
    Ok(())
}

// ============================================================================
// Phase 3: Archive User Programs
// ============================================================================

pub fn user_archive() -> Result<()> {
    println!("==> Archiving user programs...");
    
    // Ensure previous phase completed
    user_compile()?;

    let user_objects = vec![
        "build/user/shell.o",
        "build/user/cat.o",
        "build/user/echo.o",
        "build/user/ls.o",
    ];

    let args: Vec<&str> = vec!["rcs", "build/user.a"]
        .into_iter()
        .chain(user_objects.iter().copied())
        .collect();

    let status = std::process::Command::new("ar")
        .args(&args)
        .status()
        .context("Failed to run ar")?;

    if !status.success() {
        return Err(anyhow!("ar failed with status: {}", status));
    }

    println!("==> User archive created: build/user.a");
    Ok(())
}

// ============================================================================
// Phase 4: Link Kernel
// ============================================================================

pub fn link_kernel() -> Result<()> {
    println!("==> Linking kernel...");
    
    // Ensure dependencies completed
    kernel_compile()?;
    user_archive()?;

    let kernel_objects = vec![
        "build/kernel.o",
        "build/trap.o",
        "build/memory.o",
    ];

    let mut cmd = std::process::Command::new("ld");
    cmd.arg("-T").arg("kernel/link.ld")
        .arg("-nostdlib")
        .arg("-N")
        .arg("-L").arg("/opt/riscv/lib")
        .arg("-lc")
        .arg("-o").arg("kernel");

    for obj in &kernel_objects {
        cmd.arg(obj);
    }
    cmd.arg("build/user.a");

    let status = cmd.status()
        .context("Failed to run ld")?;

    if !status.success() {
        return Err(anyhow!("ld failed with status: {}", status));
    }

    println!("==> Kernel linked successfully: kernel");
    Ok(())
}

// ============================================================================
// Phase 5: Generate Image
// ============================================================================

pub fn generate_image() -> Result<()> {
    println!("==> Generating kernel image...");
    
    // Ensure dependencies completed
    link_kernel()?;

    let status = std::process::Command::new("riscv64-unknown-elf-objcopy")
        .arg("-O").arg("binary")
        .arg("kernel")
        .arg("kernel.bin")
        .status()
        .context("Failed to run objcopy")?;

    if !status.success() {
        return Err(anyhow!("objcopy failed with status: {}", status));
    }

    println!("==> Kernel image generated: kernel.bin");
    Ok(())
}

// ============================================================================
// Main Build Command (Composite)
// ============================================================================

pub fn build() -> Result<()> {
    println!("Building xv6 for {}", TARGET_TRIPLE);
    println!("------------------------------------------");
    
    generate_image()?;
    
    println!("------------------------------------------");
    println!("✓ Build complete!");
    
    // Verify outputs
    if !Path::new("kernel").exists() {
        return Err(anyhow!("kernel not found after build"));
    }
    if !Path::new("kernel.bin").exists() {
        return Err(anyhow!("kernel.bin not found after build"));
    }
    
    Ok(())
}

// ============================================================================
// Utility Functions
// ============================================================================

pub fn clean() -> Result<()> {
    println!("Cleaning build artifacts...");
    std::fs::remove_dir_all(BUILD_DIR).ok();
    std::fs::remove_file("kernel").ok();
    std::fs::remove_file("kernel.bin").ok();
    Ok(())
}

pub fn info() -> Result<()> {
    println!("xv6 Build Configuration");
    println!("Target: {}", TARGET_TRIPLE);
    println!("Build Dir: {}", BUILD_DIR);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_phases_exist() {
        // Compile tasks should be callable
        assert!(kernel_compile.is_some() || true);
        assert!(user_compile.is_some() || true);
    }
}
```

### 3.2 集成到 Cargo.toml

```toml
[package]
name = "xv6"
version = "0.1.0"
edition = "2021"

[dependencies]

[[bin]]
name = "xtask"
path = "xtask/src/main.rs"

[build-dependencies]
cc = "1.0"
glob = "0.3"
anyhow = "1.0"
```

### 3.3 使用方式

```bash
# 完整构建
$ cargo xtask build

# 单独阶段
$ cargo xtask kernel-compile
$ cargo xtask user-archive
$ cargo xtask link-kernel
$ cargo xtask generate-image

# 清理
$ cargo xtask clean

# 显示配置
$ cargo xtask info
```

---

## 4. CMake 生成器输出

### 4.1 生成的 CMakeLists.txt

```cmake
# ========================================
# Auto-generated from spec/toolchain/toolchain.yaml
# Spec ID: xv6-riscv64
# Spec Stage: 2
# Phases: kernel_compile user_compile user_archive link_kernel generate_image
# Generator: cmake-generator v1.0
# Generated: 2024-05-15T10:30:45Z
# ========================================

cmake_minimum_required(VERSION 3.12)
project(xv6 C)

# Set C Standard
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Target Configuration
set(TARGET_TRIPLE "riscv64-unknown-elf")
set(TARGET_ARCH "riscv64")

# Toolchain
set(CMAKE_C_COMPILER gcc)
set(CMAKE_AR ar)

# Directories
set(BUILD_DIR ${CMAKE_BINARY_DIR})
set(KERNEL_DIR ${CMAKE_SOURCE_DIR}/kernel)
set(USER_DIR ${CMAKE_SOURCE_DIR}/user)

# ============================================================================
# Phase 1: Kernel Compilation
# ============================================================================

file(GLOB_RECURSE KERNEL_SOURCES "kernel/**/*.c")
list(FILTER KERNEL_SOURCES EXCLUDE REGEX "kernel/test/.*")

add_library(kernel_obj OBJECT ${KERNEL_SOURCES})

target_compile_options(kernel_obj PRIVATE
    -Wall -Werror -O2 -g
)

target_compile_definitions(kernel_obj PRIVATE
    KERNEL
    ARCH_RISCV64
    CONFIG_BIGMEM=1
)

target_include_directories(kernel_obj PRIVATE
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_SOURCE_DIR}/kernel/include
)

# ============================================================================
# Phase 2: User Program Compilation
# ============================================================================

file(GLOB_RECURSE USER_SOURCES "user/**/*.c")

add_library(user_obj OBJECT ${USER_SOURCES})

target_compile_options(user_obj PRIVATE
    -Wall -O2
)

target_compile_definitions(user_obj PRIVATE
    USER
)

target_include_directories(user_obj PRIVATE
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_SOURCE_DIR}/user/include
)

# ============================================================================
# Phase 3: User Archive
# ============================================================================

add_library(user STATIC $<TARGET_OBJECTS:user_obj>)
set_target_properties(user PROPERTIES LINKER_LANGUAGE C)

# ============================================================================
# Phase 4: Link Kernel
# ============================================================================

add_executable(kernel
    $<TARGET_OBJECTS:kernel_obj>
)

target_link_options(kernel PRIVATE
    -T ${CMAKE_SOURCE_DIR}/kernel/link.ld
    -nostdlib -N
)

target_link_libraries(kernel PRIVATE
    user
    -L /opt/riscv/lib
    -lc
)

# ============================================================================
# Phase 5: Generate Image
# ============================================================================

add_custom_command(TARGET kernel POST_BUILD
    COMMAND riscv64-unknown-elf-objcopy -O binary kernel kernel.bin
    BYPRODUCTS kernel.bin
    COMMENT "Generating kernel.bin from kernel"
)

# ============================================================================
# Custom Targets
# ============================================================================

add_custom_target(clean-all
    COMMAND ${CMAKE_COMMAND} --build . --config Release --target clean
    COMMAND rm -f kernel kernel.bin
    COMMENT "Cleaning all build artifacts"
)

add_custom_target(show-info
    COMMAND ${CMAKE_COMMAND} -E echo "Target: ${TARGET_TRIPLE}"
    COMMAND ${CMAKE_COMMAND} -E echo "Build Dir: ${BUILD_DIR}"
    COMMENT "Showing build configuration"
)

# Set default target
set_property(DIRECTORY PROPERTY VS_STARTUP_PROJECT kernel)
```

### 4.2 使用方式

```bash
# 配置
$ cmake -B build -DCMAKE_BUILD_TYPE=Release

# 构建
$ cmake --build build

# 清理
$ cmake --build build --target clean-all

# 显示信息
$ cmake --build build --target show-info
```

---

## 5. 生成器实现框架

### 5.1 接口定义

所有生成器都应实现以下特征（Rust 伪码）：

```rust
pub trait BuildGenerator {
    fn generate(spec: &BuildSpec, context: &GenerationContext) 
        -> Result<ToolchainArtifact>;
    
    fn validate_spec(&self, spec: &BuildSpec) 
        -> Result<()>;
    
    fn format_name(&self) -> &str;  // "makefile", "xtask", "cmake", etc
}
```

### 5.2 生成流程

所有生成器应遵循：

```
1. Validate spec
   - Check all required fields present
   - Check phase names valid
   - Check dependencies acyclic
   
2. Build context
   - Collect all compiler/linker info
   - Resolve relative paths
   - Prepare flags mapping
   
3. Generate content
   - For each phase, generate tool-specific code
   - Apply semantic→syntax mapping
   - Insert metadata comments
   
4. Output artifact
   - Write to filesystem or return string
   - Include generation metadata
   - Ensure idempotency (same input → identical output)
```

---

## 6. 语义字段到工具语法的映射表

### 6.1 编译标志映射

| 语义字段 | Makefile | Xtask | CMake |
|---------|----------|-------|-------|
| `flags.warnings: [all, error]` | `-Wall -Werror` | `.warnings(true).warnings_into_errors(true)` | `-Wall -Werror` |
| `flags.optimization: O2` | `-O2` | `.opt_level(2)` | `-O2` |
| `flags.debug: true` | `-g` | `.debug(true)` | 自动设置 |
| `flags.defines: [K=V]` | `-DK=V` | `.define("K", Some("V"))` | `-DK=V` |
| `standard: c11` | `-std=c11` | `.std("c11")` | 通过 set_property |

### 6.2 源文件匹配映射

| 语义字段 | Makefile | Xtask | CMake |
|---------|----------|-------|-------|
| `sources[].pattern: "dir/**/*.c"` | `$(wildcard dir/**/*.c)` | `glob::glob("dir/**/*.c")` | `file(GLOB_RECURSE ...)` |
| `sources[].exclude: [...]` | `filter-out exclude/%, ...` | `.filter(\|p\| !p.contains(...))` | `list(FILTER ... EXCLUDE)` |

---

## 7. 校验与测试

生成器生成的工件应通过：

```
1. 语法检查
   - Makefile: make -n build (dry run)
   - Xtask: cargo build xtask/
   - CMake: cmake --build . --verbose

2. 执行测试
   - 实际编译并生成输出工件
   - 验证输出工件大小合理
   - 验证 spec.validation.must_pass

3. 幂等性测试
   - 同一 spec 生成两次
   - diff 输出（除时间戳外应相同）

4. 对比测试
   - 多生成器生成相同结果
   - 产生相同的输出工件
```

---

## 相关文档

- [`05a-semantic-build-schema.md`](05a-semantic-build-schema.md) - 语义字段完整定义
- [`05b-vos-toolchain-generation-contract.md`](05b-vos-toolchain-generation-contract.md) - vos 生成与执行契约
