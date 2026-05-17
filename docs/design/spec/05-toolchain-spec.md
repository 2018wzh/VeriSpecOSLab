# ToolchainSpec 标准

## 1. 角色定位

VeriSpecOSLab 引入 `ToolchainSpec`，但其目标不是要求学生自行构建完整编译工具链。

`ToolchainSpec` 的定位是：

```text
构建 / 链接 / 镜像 / 运行 / 调试环境契约
```

它负责约束：

- target triple 和 ABI
- 编译与链接规则
- kernel / image 产物
- boot chain
- QEMU / emulator profile
- debug 符号和脚本要求

## 2. 为什么需要 ToolchainSpec

很多 OS 错误不在代码逻辑，而在构建层：

- entry symbol 错误
- linker script 错误
- host / target 工具混用
- ABI flag 不一致
- OpenSBI / bootloader / kernel image 不匹配
- QEMU profile 与架构声明不一致

如果这些约束不进 Spec，Agent 会误把构建层问题当成代码 bug。

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

## 9. 和 Makefile 的关系

不建议把“自动生成完整 Makefile”作为首要目标。

推荐关系是：

```text
ToolchainSpec
  -> normalized build plan
  -> Makefile / CMake / Ninja template
  -> vos build
```

也就是说，Makefile 是后端实现，不是设计真相。

## 10. 课程边界

默认课程不要求学生自己构建交叉编译器、binutils 或 libc 工具链。

只有在以下场景下才建议把“自建工具链”纳入目标：

1. 课程明确覆盖编译器 / ABI / 移植链路。
2. 个性化目标本身就是硬件移植或工具链研究。
