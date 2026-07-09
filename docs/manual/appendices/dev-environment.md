# 开发环境搭建

VeriSpecOSLab 不要求所有学生使用同一种机器形态。你可以使用课程提供的容器化运行环境，也可以在本机安装工具链。无论选择哪条路径，最终都要让 `vos doctor`、RISC-V 工具链、QEMU、GDB 和 Git 可用。

## 方式一：课程运行环境

如果课程发放了容器镜像或 `compose.yaml`，优先使用它。课程运行环境通常会预装 RISC-V 交叉编译器、QEMU、GDB、Bun 和 `vos` 所需依赖。

常见流程如下，具体服务名以课程模板为准：

```sh
git clone <your-repo-url> student-project
cd student-project

docker compose up -d
docker compose ps
docker compose exec <service> sh
```

进入环境后验证工具：

```sh
riscv64-unknown-elf-gcc --version
qemu-system-riscv64 --version
gdb-multiarch --version
bun --version
git --version
```

如果课程模板没有预装 `vos`，在环境内安装：

```sh
npm install -g github:2018wzh/VeriSpecOSLab#v1.0.0
vos --help
```

## 方式二：本地安装

本地安装适合已经熟悉系统工具链的同学。不同系统的包名可能不同，下面只列常见命令；如果课程给了更具体的镜像或脚本，以课程说明为准。

### RISC-V 交叉编译工具链

Ubuntu / Debian：

```sh
sudo apt install gcc-riscv64-unknown-elf
```

Arch Linux：

```sh
sudo pacman -S riscv64-elf-gcc
```

macOS：

```sh
brew install riscv64-elf-gcc
```

验证：

```sh
riscv64-unknown-elf-gcc --version
```

### QEMU

Ubuntu / Debian：

```sh
sudo apt install qemu-system-misc
```

Arch Linux：

```sh
sudo pacman -S qemu-system-riscv
```

macOS：

```sh
brew install qemu
```

验证：

```sh
qemu-system-riscv64 --version
```

### GDB

Ubuntu / Debian：

```sh
sudo apt install gdb-multiarch
```

macOS 可使用 Homebrew 提供的 GDB，或使用课程运行环境中的 `gdb-multiarch`。

验证：

```sh
gdb-multiarch --version
```

### vos

从 GitHub 安装 `vos`：

```sh
npm install -g github:2018wzh/VeriSpecOSLab#v1.0.0
```

把 `v1.0.0` 替换为课程指定的 release tag。这只安装对应平台的预构建 CLI，不要求 clone VeriSpecOSLab 工具仓库。之后可以在学生项目中用 `--project-root` 指向项目根目录。

验证：

```sh
vos --help
```

## 环境验证清单

在学生项目根目录运行：

```sh
vos init
vos doctor
```

再确认基础工具：

```sh
riscv64-unknown-elf-gcc --version
qemu-system-riscv64 --version
gdb-multiarch --version
git --version
```

这些检查通过后，开始 [Lab 1](../labs/lab1-seed.md)。
