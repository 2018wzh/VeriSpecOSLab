# Lab 0: 环境搭建

## 1. 目标

搭建 VeriSpecOSLab 开发环境，确认所有工具可用。

## 2. 任务

### Task 1: 选择环境方案

- **推荐**：使用 DevBox 容器环境（最简单，所有工具预装）
- **可选**：本地安装（需要手动安装 RISC-V 工具链、QEMU 等）

详见 [附录：开发环境搭建](../appendices/dev-environment.md)。

### Task 2: 搭建环境

按你选择的方式搭建环境。

### Task 3: 验证环境

运行以下命令确认环境可用：

```bash
# 编译器
riscv64-unknown-elf-gcc --version

# 模拟器
qemu-system-riscv64 --version

# vos
vos --help

# Git
git --version
```

### Task 4: 克隆项目

```bash
git clone <your-repo-url>
cd <your-project>
```

### Task 5: 熟悉 vos 命令

运行以下命令了解 vos：

```bash
vos --help
vos spec lint --help
vos build --help
vos run qemu --help
```

详见 [附录：vos 命令参考](../appendices/vos-commands.md)。

### Task 6: 背景阅读

在开始 Lab 1 之前，建议浏览：
- [Book 第 0 章](../book/ch00-overview.md)：课程概述
- [Specs 总论](../specs/overview.md)：为什么写规格
- [Spec-first 工作流详解](../specs/spec-workflow.md)：从设计到验证的流程

## 3. 提交物

无需提交。确认所有命令正常运行即可。

## 4. 常见问题

- **Q: vos 命令找不到？** 确认你在项目根目录，且已运行 `bun install`（在 `vos/` 目录下）。
- **Q: QEMU 启动不了？** 确认 `qemu-system-riscv64` 在 PATH 中。
- **Q: 编译器找不到？** 确认交叉编译器已安装且版本匹配。
