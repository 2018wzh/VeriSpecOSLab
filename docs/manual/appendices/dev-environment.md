# 开发环境搭建

## 方式一：使用 DevBox（推荐）

DevBox 是一个预配置的容器化开发环境，包含所有必需工具。

### 前置条件

- Docker 或 Podman
- VS Code 及 Dev Containers 扩展（可选，但推荐）

### 搭建步骤

1. 克隆项目仓库：

```bash
git clone <your-repo-url> student-project
cd student-project
```

2. 启动 DevBox：

```bash
docker compose up -d
```

3. 进入容器：

```bash
docker compose exec devbox fish
```

4. 验证环境：

```bash
riscv64-unknown-elf-gcc --version
qemu-system-riscv64 --version
vos --help
```

### 使用 VS Code Dev Container

如果你使用 VS Code，打开项目后会自动提示"Reopen in Container"，点击即可。

## 方式二：本地安装

如果你偏好本地环境，需要手动安装以下工具。

### RISC-V 交叉编译工具链

Ubuntu / Debian：

```bash
sudo apt install gcc-riscv64-unknown-elf
```

Arch Linux：

```bash
sudo pacman -S riscv64-elf-gcc
```

macOS：

```bash
brew install riscv64-elf-gcc
```

验证：

```bash
riscv64-unknown-elf-gcc --version
```

### QEMU

Ubuntu / Debian：

```bash
sudo apt install qemu-system-misc
```

Arch Linux：

```bash
sudo pacman -S qemu-system-riscv
```

macOS：

```bash
brew install qemu
```

验证：

```bash
qemu-system-riscv64 --version
```

### GDB（多架构）

```bash
sudo apt install gdb-multiarch
```

验证：

```bash
gdb-multiarch --version
```

### vos

从 GitHub 仓库安装 `vos`：

```bash
bun install -g github:2018wzh/VeriSpecOSLab
```

这只安装 CLI，不要求 clone VeriSpecOSLab 工具仓库。之后可以直接通过 `vos` 调用，并用 `--project-root` 指向你的学生项目。

验证：

```bash
vos --help
```

## 环境验证清单

运行以下命令确认所有工具可用：

```bash
# 编译器
riscv64-unknown-elf-gcc --version

# 模拟器
qemu-system-riscv64 --version

# 调试器
gdb-multiarch --version

# vos
vos --help

# Git
git --version
```

全部通过后，你的开发环境即准备就绪。可以开始 [Lab 0](../labs/lab0-environment.md)。
