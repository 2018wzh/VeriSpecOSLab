# 工具链总览

VeriSpecOSLab 的工具链以 `vos` 命令为核心入口，配合 QEMU 模拟器和 RISC-V 交叉编译工具链，提供从规格编写到系统验证的完整闭环。

## 工具链组成

| 工具 | 用途 | 来源 |
|------|------|------|
| `vos` | 规格检查、构建编排、测试运行、验证报告、Agent 交互 | 本课程提供 |
| `riscv64-unknown-elf-gcc` | RISC-V 交叉编译器 | 系统包管理器或预编译工具链 |
| `qemu-system-riscv64` | RISC-V 系统模拟器 | 系统包管理器 |
| `gdb-multiarch` | 多架构调试器 | 系统包管理器 |
| `git` | 版本控制 | 系统包管理器 |
| `bun` | vos 运行时 | 本课程提供 |

## vos 命令体系

详见 [vos 命令参考](vos-commands.md)。核心命令流程：

```text
vos spec lint        # 检查规格文件格式和完整性
vos arch lint        # 检查架构设计一致性
vos build            # 构建内核镜像
vos run qemu         # 在 QEMU 中运行
vos test --suite <suite> # 运行测试套件
vos verify public        # 运行基础验证
vos verify full --target goal # 运行个性化目标验证
vos report generate  # 生成验证报告
```

## 开发环境

推荐使用预配置的 DevBox 容器环境，详见 [开发环境搭建](dev-environment.md)。DevBox 已包含所有必需工具，无需手动安装。

如果你偏好本地安装，各工具的安装说明分别见：
- [QEMU 使用指南](qemu-guide.md)
- [GDB 调试指南](gdb-guide.md)
- [RISC-V 参考](riscv-reference.md)

## 工具链在实验流程中的位置

```text
写 Spec ──→ vos spec lint ──→ 实现 ──→ vos build ──→ vos run qemu
                                           │
                                           └──→ vos test ──→ vos verify ──→ vos report
```
