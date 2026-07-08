# 附录：开发环境搭建详解

> 本附录覆盖 RISC-V 64、x86-64、ARM64 (AArch64) 三种架构的交叉编译环境搭建，涵盖 Windows、macOS、Linux 三大操作系统。选择与你目标架构和开发平台匹配的部分即可。

## 快速决策

| 你的场景 | 推荐方案 |
|---------|---------|
| 课程默认（RISC-V + QEMU） | 方案 A |
| 想在真实 PC 上跑（x86-64） | 方案 B |
| 想在树莓派上跑（ARM64） | 方案 C |
| 想所有平台都支持 | 方案 A + B + C（工具链可共存） |

---

## 方案 A：RISC-V 64 开发环境

### A.1 安装交叉编译器

#### Linux (Ubuntu/Debian)

```sh
# 方式 1：包管理器（推荐，最快）
sudo apt update
sudo apt install gcc-riscv64-unknown-elf binutils-riscv64-unknown-elf

# 验证安装
riscv64-unknown-elf-gcc --version
# 期望输出：riscv64-unknown-elf-gcc (GCC) 12.x.x 或更高

# 方式 2：从源码编译（约 30 分钟，但获得最新版本）
git clone https://github.com/riscv-collab/riscv-gnu-toolchain.git
cd riscv-gnu-toolchain
./configure --prefix=/opt/riscv --enable-multilib
make -j$(nproc)
# 加入 PATH: export PATH="/opt/riscv/bin:$PATH"
```

#### macOS (Apple Silicon / Intel)

```sh
# Homebrew（推荐）
brew install riscv64-elf-gcc

# 验证
riscv64-elf-gcc --version

# 注意：Homebrew 的 binary 名字是 riscv64-elf-gcc，
# 而非 riscv64-unknown-elf-gcc。在 Makefile 中对应调整：
# CC = riscv64-elf-gcc
```

#### Windows

```sh
# 推荐方案：WSL2 + Ubuntu
# 1. 在 Microsoft Store 安装 Ubuntu 24.04
# 2. 打开 Ubuntu 终端，按上述 Linux 步骤操作
# 3. 所有后续开发工作都在 WSL2 中进行
# 4. VS Code 安装 "WSL" 扩展即可无缝编辑 WSL2 中的文件

# 替代方案：预编译 Windows 工具链
# 下载：https://github.com/riscv-collab/riscv-gnu-toolchain/releases
# 解压到 C:\riscv，添加到 PATH：C:\riscv\bin
```

### A.2 安装 QEMU (RISC-V)

```sh
# Linux (Ubuntu/Debian)
sudo apt install qemu-system-misc
# 验证：qemu-system-riscv64 --version

# macOS
brew install qemu
# 验证：qemu-system-riscv64 --version

# Windows (WSL2)
# 在 WSL2 的 Ubuntu 终端中按上述 Linux 步骤

# 从源码编译 QEMU（如需最新版本）
git clone https://gitlab.com/qemu-project/qemu.git
cd qemu
./configure --target-list=riscv64-softmmu
make -j$(nproc)
sudo make install
```

### A.3 验证环境（一键脚本）

```sh
# 创建测试文件 test.c
cat > test.c << 'EOF'
void _start() {
    volatile char *uart = (volatile char *)0x10000000;
    *uart = 'H';
    *uart = 'i';
    *uart = '\n';
    while (1) {}
}
EOF

# 编译
riscv64-unknown-elf-gcc -nostdlib -nostartfiles -ffreestanding \
    -march=rv64gc -mabi=lp64d -Ttext=0x80000000 \
    -o test.elf test.c

# 运行
qemu-system-riscv64 -machine virt -kernel test.elf -nographic
# 期望输出：Hi（然后 QEMU 挂起，按 Ctrl-A X 退出）

# 如果看到 "Hi"：环境正常！
# 如果没有输出：回到 Book 第 2 章排查
```

---

## 方案 B：x86-64 开发环境

### B.1 交叉编译 vs 本地编译

x86-64 开发有两种路径：

| 路径 | 适用场景 | 难度 |
|------|---------|:--:|
| **本地编译** | 你正在 x86-64 机器上开发 | 低——不需要交叉编译器 |
| **交叉编译**（从 ARM Mac 编译 x86-64） | Apple Silicon Mac | 中 |

#### Linux (x86-64 本地)

```sh
# 无需安装交叉编译器——系统的 GCC 就是 x86-64 的
gcc --version  # 确认已安装

# 安装 QEMU (x86-64)
sudo apt install qemu-system-x86

# 安装 OVMF (UEFI 固件镜像 for QEMU)
sudo apt install ovmf
# 固件路径：/usr/share/OVMF/OVMF_CODE.fd
```

#### macOS (交叉编译 x86-64)

```sh
# 安装 x86-64 ELF 交叉编译器
brew install x86_64-elf-gcc
# 验证：x86_64-elf-gcc --version

# 安装 QEMU
brew install qemu
```

### B.2 验证环境

#### 使用 Multiboot2 + GRUB

```sh
# 1. 安装 GRUB 工具
sudo apt install grub2-common xorriso  # Linux
brew install grub xorriso               # macOS

# 2. 验证 GRUB 能识别你的内核
grub-file --is-x86-multiboot2 build/kernel.elf
# 无输出 = 成功；有错误 = Multiboot2 header 不对
```

#### 使用 UEFI 直启

```sh
# 将内核编译为 PE/COFF
clang -target x86_64-unknown-windows -fuse-ld=lld-link \
    -nostdlib -Wl,-entry:efi_main \
    -o BOOTX64.EFI kernel.c

# 创建 FAT32 镜像
dd if=/dev/zero of=fat.img bs=1M count=64
mkfs.fat -F32 fat.img
mmd -i fat.img ::/EFI/BOOT
mcopy -i fat.img BOOTX64.EFI ::/EFI/BOOT/

# 在 QEMU 中启动
qemu-system-x86_64 -bios /usr/share/OVMF/OVMF_CODE.fd \
    -drive file=fat.img,format=raw -nographic
```

---

## 方案 C：ARM64 (AArch64) 开发环境

### C.1 安装交叉编译器

```sh
# Linux (Ubuntu/Debian)
sudo apt install gcc-aarch64-linux-gnu

# macOS
brew install aarch64-elf-gcc

# 验证
aarch64-linux-gnu-gcc --version
```

### C.2 安装 QEMU (ARM64)

```sh
# Linux
sudo apt install qemu-system-arm

# macOS
brew install qemu

# 验证
qemu-system-aarch64 --version
```

### C.3 验证环境

```sh
# 编译一个最小 ARM64 内核
cat > test_aarch64.c << 'EOF'
void _start() {
    volatile char *uart = (volatile char *)0x09000000;  // ARM64 virt UART0
    *uart = 'A';
    *uart = 'R';
    *uart = 'M';
    *uart = '\n';
    while (1) {}
}
EOF

aarch64-linux-gnu-gcc -nostdlib -nostartfiles -ffreestanding \
    -Ttext=0x40000000 -o test_arm.elf test_aarch64.c

qemu-system-aarch64 -machine virt -cpu cortex-a72 \
    -kernel test_arm.elf -nographic
# 期望输出：ARM
```

---

## 通用工具

### GDB (GNU Debugger)

```sh
# RISC-V GDB（通常随交叉编译器一起安装）
riscv64-unknown-elf-gdb --version

# 如果单独安装
sudo apt install gdb-multiarch    # Linux——支持所有架构的 GDB
brew install riscv64-elf-gdb      # macOS
```

### Make

```sh
make --version  # 确认已安装（几乎所有开发环境都预装了）
```

### LLVM/Clang（替代 GCC）

如果你选择用 Clang 编译内核：

```sh
# Linux
sudo apt install clang lld

# macOS
# Xcode 自带 clang，通过 brew install llvm 获取最新版

# 为 RISC-V 交叉编译
clang --target=riscv64-unknown-elf -march=rv64gc -mabi=lp64d \
    -nostdlib -ffreestanding -o kernel.elf kernel.c
```

---

## 多架构共存

三种架构的工具链可以同时安装在同一台机器上——它们的 binary 名字不同，不会冲突：

```sh
riscv64-unknown-elf-gcc   # RISC-V
x86_64-elf-gcc             # x86-64 (交叉)
gcc                        # x86-64 (本地)
aarch64-linux-gnu-gcc      # ARM64

qemu-system-riscv64        # RISC-V
qemu-system-x86_64         # x86-64
qemu-system-aarch64        # ARM64
```

---

## 常见问题

### Q: macOS 上报 "cannot find -lgloss"？

A: 这是 `-nostdlib` 没加。裸机/内核编译必须禁用标准库链接。

### Q: WSL2 中 QEMU 启动很慢？

A: WSL2 默认使用虚拟化嵌套。在 Windows 的 `%USERPROFILE%\.wslconfig` 中添加：
```ini
[wsl2]
nestedVirtualization=true
```

### Q: QEMU 报 "unsupported machine type"？

A: 检查 QEMU 版本和你的目标架构是否匹配。用 `qemu-system-riscv64 -machine help` 列出支持的机器型号。

### Q: 交叉编译器链接时报 "undefined reference to `__libc_start_main`"？

A: 确保编译参数中有 `-nostdlib -nostartfiles -ffreestanding`。这三个 flag 告诉编译器"不要期望有 C 运行时支持"。
