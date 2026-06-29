# 链接脚本指南

链接脚本（linker script）决定了内核在内存中的布局：代码段、数据段、BSS 段的起始地址和排列方式。它是连接"编译产物"和"硬件内存布局"的关键文件。

## 链接脚本在实验中的角色

在 VeriSpecOSLab 中，链接脚本属于 ToolchainSpec 的一部分。你需要通过 `spec/toolchain/link.yaml` 描述你的链接需求，然后 `vos build generate` 会生成实际可用的链接脚本。

但这不代表你不需要理解链接脚本——你需要知道自己在描述什么。

## 基本结构

一个典型的 RISC-V 内核链接脚本包含以下段：

```ld
OUTPUT_ARCH(riscv)
ENTRY(_start)

SECTIONS
{
    /* 内核加载地址 */
    . = 0x80000000;

    /* 代码段 */
    .text : {
        *(.text .text.*)
    }

    /* 只读数据段 */
    .rodata : {
        *(.rodata .rodata.*)
    }

    /* 数据段 */
    .data : {
        *(.data .data.*)
    }

    /* BSS 段（未初始化数据） */
    .bss : {
        *(.bss .bss.*)
    }
}
```

## 关键概念

### 加载地址 vs 链接地址

- **链接地址（VMA）**：代码"认为"自己所在的地址。符号引用以此解析。
- **加载地址（LMA）**：代码实际被加载到的物理地址。

对于直接启动的内核（无 bootloader 重定位），VMA = LMA。

### ENTRY 符号

指定入口点。QEMU 的 `-kernel` 参数会从 ELF 的 entry point 开始执行。

### BSS 段处理

BSS 段在 ELF 中不占实际空间，但需要在启动时清零：

```c
extern char _bss_start[], _bss_end[];
memset(_bss_start, 0, _bss_end - _bss_start);
```

链接脚本中需要导出 `_bss_start` 和 `_bss_end` 符号。

## 典型决策

### 内核加载地址

RISC-V `virt` 机器上，RAM 通常从 `0x80000000` 开始。内核通常加载在此处。

### 栈的放置

栈通常在 BSS 段之后，或单独分配。栈顶地址需要在启动代码中设置到 `sp` 寄存器。

### 对齐要求

RISC-V 要求页对齐（4 KiB 边界）用于页表映射。确保 `.text`、`.data` 等段适当对齐。

## 常见错误

1. **入口符号未定义**：确保 `ENTRY(_start)` 引用的符号在你的汇编文件中存在且为全局符号。
2. **BSS 忘记清零**：C 语言的全局未初始化变量依赖 BSS 清零，忘记会导致未定义行为。
3. **栈溢出**：栈太小或放置位置不当，与数据段重叠。
4. **链接地址与实际加载地址不一致**：如果内核被重定位到非预期位置，所有绝对地址引用会出错。

## 参考资料

- GNU LD 手册：`info ld`
- RISC-V ELF psABI：https://github.com/riscv-non-isa/riscv-elf-psabi-doc
