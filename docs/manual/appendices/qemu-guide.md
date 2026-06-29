# QEMU 使用指南

QEMU 是 VeriSpecOSLab 默认的系统模拟器。学生内核在 QEMU 的 `virt` 机器上运行。

## 基本调用

通过 vos 调用（推荐）：

```bash
vos run qemu
```

等效于直接调用 QEMU：

```bash
qemu-system-riscv64 \
  -machine virt \
  -bios default \
  -kernel build/kernel.elf \
  -m 128M \
  -nographic \
  -serial mon:stdio
```

## 常用参数

| 参数 | 含义 |
|------|------|
| `-machine virt` | 使用 QEMU 的通用 RISC-V 虚拟平台 |
| `-bios default` | 使用默认固件（通常是 OpenSBI） |
| `-kernel <file>` | 指定内核 ELF 文件 |
| `-m <size>` | 指定内存大小 |
| `-nographic` | 无图形输出，串口重定向到终端 |
| `-serial mon:stdio` | 串口输出到标准输入输出 |
| `-s` | 在 1234 端口开启 GDB 服务器（等价于 `-gdb tcp::1234`）|
| `-S` | 启动时暂停 CPU，等待 GDB 连接 |

## 调试模式

启动 QEMU 并等待 GDB 连接：

```bash
qemu-system-riscv64 -machine virt -kernel build/kernel.elf -nographic -s -S
```

然后在另一个终端连接 GDB：

```bash
gdb-multiarch build/kernel.elf \
  -ex "target remote :1234"
```

详见 [GDB 调试指南](gdb-guide.md)。

## QEMU virt 平台设备布局

`virt` 机器的标准设备地址：

| 设备 | 基地址 | 中断号 |
|------|--------|--------|
| UART 16550A | 0x10000000 | 10 |
| PLIC | 0x0C000000 | — |
| virtio-blk | 0x10001000 | 1 |
| CLINT (mtime) | 0x02000000 | — |

注意：具体地址可能因 QEMU 版本而异。推荐通过设备树（DTB）动态获取，而非硬编码。

## 设备树（DTB）

QEMU 在启动时会生成设备树并传递给内核。你可以通过以下方式查看：

```bash
qemu-system-riscv64 -machine virt,dumpdtb=qemu.dtb ...
dtc -I dtb -O dts qemu.dtb -o qemu.dts
```

## 常见问题

### Q: 串口没有输出

- 检查 `-serial mon:stdio` 是否指定
- 检查内核是否正确初始化了 UART
- 检查 `_start` 入口是否正确设置

### Q: QEMU 找不到

- 确认安装正确：`which qemu-system-riscv64`
- Ubuntu 上包名可能是 `qemu-system-misc` 而非 `qemu-system-riscv64`

### Q: 内核启动后立即崩溃

- 检查链接脚本：入口地址是否正确？
- 检查 `-kernel` 参数：是否传递了正确的 ELF 文件？
- 使用 GDB 单步调试定位崩溃位置
