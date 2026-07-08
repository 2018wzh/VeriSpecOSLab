# Lab 2: 最小内核启动 — 从硬件到第一条指令

## 1. 设计问题

从硬件上电到你的内核输出第一条消息，这条路径上发生了什么？你的内核如何从固件手中接管控制权？最小的可运行内核需要建立什么执行环境？

## 2. 设计空间

| 决策 | 你需要回答的问题 |
|------|----------------|
| 启动序列 | 固件给你的内核了什么状态？从 `_start` 到 `kernel_main` 之间需要哪些步骤？ |
| 启动方式 | 固件直启（如 OpenSBI → kernel）还是通过 bootloader（GRUB/Limine/U-Boot）？还是 UEFI 直启？每种方式把 CPU 留在什么状态、给你什么信息？ |
| 多核策略 | 多个 HART 同时启动还是主从模式？非启动 HART 如何等待？ |
| 内存布局 | 栈放哪里？代码和数据段的加载地址？BSS 在哪里？ |
| 构建链路 | 用什么编译器？什么链接脚本？产生什么格式的镜像？ |
| 验证手段 | 如何确认内核成功启动了？banner 输出、超时检测还是其他？ |

## 2a. 设计决策引导

以下每个问题不是你需要在 ArchitectureSeed 中回答的选择题，而是你需要**想清楚**的设计判断。没有标准答案——你的选择取决于阶段 1 的 goals。

### 决策 1：启动方式

你面前有三条路。每条路的"起步成本"和"长期收益"不同：

| 路径 | 起步成本 | 长期收益 | 适合谁 |
|------|:------:|:------:|------|
| **RISC-V + OpenSBI 直启** | 最低。固件已把 CPU 留在 S-mode，入口状态干净。 | 只能跑 RISC-V（QEMU 或真实硬件） | 跟着课程默认路线走的学生；第一次写 OS 的人 |
| **x86-64 + GRUB/Multiboot2** | 中等。需要理解 Multiboot2 header 格式和协议。 | 可以跑 x86-64（QEMU 和几乎所有 PC） | 想在真实 PC 上启动的；已有 x86 汇编基础的 |
| **x86-64 UEFI 直启** | 最高。需要理解 PE/COFF 格式、UEFI 协议、GOP/ACPI。 | 可以在 2020 年后任何 PC 上启动，无需外部 bootloader | 想把 OS 装到真实硬件上长期维护的 |

**设计自检**：你的 ArchitectureSeed 选了什么 target_platform？这个选择自然导向哪条启动路径？如果你选了 RISC-V 但想用 GRUB——GRUB 的 RISC-V 支持尚不成熟，你可能需要改用 Limine 或固件直启。

### 决策 2：汇编入口的最小集合

你可以在 `_start` 里写大量汇编代码——或者只写最必要的 5 条指令，剩余的全部交给 C。你需要想清楚的只有一件事：**哪些操作绝对不可能用 C 完成？**

答案只有三个：
1. **设置栈指针**（`la sp, _stack_top`）——C 语言没有设置寄存器的语法
2. **跳转到 C 入口**（`j kernel_main` 或 `tail kernel_main`）——这是控制流转移
3. **（RISC-V 特定）保存 `a0`/`a1`**——它们包含固件传递的 hartid 和 DTB 地址，在调用 C 函数之前需要暂存

其他所有操作——BSS 清零、UART 初始化、banner 输出——理论上都可以用 C 完成。但实践中 BSS 清零通常也在汇编中做，因为它在设置栈之后、调用 C 之前，是一个"反正已经在这了"的自然位置。

**设计自检**：你的 `_start` 里有哪些指令？是否有多余的指令可以移到 C 中？是否有必要的指令遗漏了？

### 决策 3：栈的大小和位置

教学 OS 的栈通常设为 4-8 KiB。你可以先设 8 KiB（`0x2000`），后面需要时再调整。

栈的位置有两个约束：
- 不能在代码段或数据段内部（会互相覆盖）
- 最好离其他关键数据结构有一定距离（留出空间）

一种常见布局（RISC-V virt, RAM 从 0x80000000 开始）：

```
0x80000000 ┌──────────────┐
           │   .text      │  代码段
           ├──────────────┤
           │   .rodata    │  只读数据
           ├──────────────┤
           │   .data      │  已初始化数据
           ├──────────────┤
           │   .bss       │  未初始化数据（由 _start 清零）
           ├──────────────┤
           │              │
           │   (空闲)     │  ← 将来用于堆/页分配器
           │              │
           ├──────────────┤
           │   栈区       │  ← sp 指向这里的高地址，向下增长
0x80010000 └──────────────┘
```

**设计自检**：你的栈放在什么位置？如果栈溢出（向低地址方向），它会覆盖什么？是你的 BSS 段还是空闲区域？

### 决策 4：BSS 清零的方式

两种常见实现：

**方案 A：手动循环**
```asm
la   t0, _bss_start
la   t1, _bss_end
bss_loop:
    bge  t0, t1, bss_done
    sd   zero, 0(t0)      # 写 8 字节零
    addi t0, t0, 8
    j    bss_loop
bss_done:
```

**方案 B：调用 `memset`**
```asm
la   a0, _bss_start
li   a1, 0
la   a2, _bss_end
sub  a2, a2, a0           # 长度 = bss_end - bss_start
call memset
```

方案 B 更简洁，但前提是你已经实现了 `memset`——如果在阶段 2 你还没有 C 库，方案 A 只需 6 条指令，是更务实的选择。

**设计自检**：如果你的 BSS 段大小不是 8 字节的整数倍怎么办？（提示：`sd` 写 8 字节，如果 BSS 大小是 10 字节，最后 2 字节不会被清零。解决方案：用 `sb` 逐字节清零，或确保链接脚本中 BSS 对齐到 8 字节。）

## 2b. 逐步操作指引

以下是阶段 2 的推荐执行步骤。每一步后面标注了"自检点"——如果你在这一步卡住了，说明哪个前置步骤可能没做对。

### 步骤 1：搭建最小构建系统（预计 20 分钟）

```sh
# 1. 创建源码目录结构
mkdir -p kernel/src kernel/include

# 2. 编写链接脚本 kernel/link.ld
# 至少定义 .text, .rodata, .data, .bss 四个段
# 起始地址：RISC-V virt 用 0x80000000

# 3. 编写最小 Makefile
# 关键变量：
#   CC = riscv64-unknown-elf-gcc
#   CFLAGS = -march=rv64gc -mabi=lp64d -mcmodel=medany -nostdlib -ffreestanding
#   LDFLAGS = -T kernel/link.ld
```

**预期产物**：`make` 能成功编译并链接出一个 `build/kernel.elf`。

**自检点**：
- `riscv64-unknown-elf-readelf -h build/kernel.elf | grep "Entry point"` 显示正确的入口地址

**如果卡住**：
- 检查交叉编译器是否正确安装：`which riscv64-unknown-elf-gcc`
- 检查 `-march` 和 `-mabi` 是否匹配：`rv64gc` 对应 `lp64d`（64 位浮点 ABI）
- `-ffreestanding` 告诉编译器"没有标准库"，不要自动链接 `libc`

### 步骤 2：写汇编入口 `_start`（预计 30 分钟）

创建 `kernel/src/entry.S`：

```asm
# 最小汇编入口（RISC-V 64 + OpenSBI 直启）
    .section .text.entry
    .globl _start
_start:
    # 固件通过 a0, a1 传递信息，先暂存
    csrw mscratch, a0        # (仅作示例；实际 mscratch 在 S-mode 不可写)
    # 更实际的做法：暂存到 s0, s1 中
    mv   s0, a0              # s0 = hartid
    mv   s1, a1              # s1 = DTB 地址

    # 设置栈指针
    la   sp, _stack_top

    # 清零 BSS
    la   t0, _bss_start
    la   t1, _bss_end
1:
    bge  t0, t1, 2f
    sd   zero, 0(t0)
    addi t0, t0, 8
    j    1b
2:
    # 跳转到 C 入口
    mv   a0, s0              # 恢复 hartid 作为参数
    mv   a1, s1              # 恢复 DTB 地址作为参数
    j    kernel_main         # 或 call kernel_main
```

**重点解释**：
- `.section .text.entry` 确保这段代码放在 `.text` 段的最开头（链接脚本中需配合 `*(.text.entry)` 放在 `*(.text)` 之前）
- `csrw mscratch, a0` 在 S-mode 会触发非法指令异常——这里仅作演示，实际应暂存到 s0/s1
- `j kernel_main` 是尾调用，不占用栈；`call kernel_main` 会使用栈（保存返回地址）

**预期产物**：汇编文件可以编译通过。

**自检点**：
- 链接后的 ELF 文件，`_start` 是否在入口地址处：`riscv64-unknown-elf-objdump -d build/kernel.elf | head -20`

### 步骤 3：写 C 入口和最小 UART 驱动（预计 45 分钟）

创建 `kernel/src/main.c`：

```c
// UART0 MMIO 基地址（RISC-V virt 机器）
#define UART0_BASE 0x10000000L

// 16550 UART 寄存器偏移
#define UART_THR 0x00   // Transmitter Holding Register (写)
#define UART_LSR 0x14   // Line Status Register (读)
#define UART_LSR_THRE (1 << 5)  // Transmitter Holding Register Empty

// 向串口写一个字节
void uart_putc(char c) {
    volatile uint8_t *thr = (volatile uint8_t *)(UART0_BASE + UART_THR);
    volatile uint8_t *lsr = (volatile uint8_t *)(UART0_BASE + UART_LSR);
    
    // 等待发送缓冲区为空
    while (!(*lsr & UART_LSR_THRE))
        ;
    
    *thr = c;
}

// 向串口写一个字符串
void uart_puts(const char *s) {
    while (*s) {
        uart_putc(*s++);
    }
}

// 内核主入口
void kernel_main(int hartid, void *dtb_addr) {
    // 只有 HART 0 应该执行初始化
    if (hartid != 0) {
        // 非启动 HART：在此自旋等待
        while (1) {
            __asm volatile("wfi");  // 等待中断（省电）
        }
    }
    
    // 输出 kernel banner
    uart_puts("\n");
    uart_puts("==========================\n");
    uart_puts("  MyOS Kernel v0.1\n");
    uart_puts("  Hello, World!\n");
    uart_puts("==========================\n");
    uart_puts("\n");
    
    // 内核空闲循环
    while (1) {
        __asm volatile("wfi");
    }
}
```

**预期产物**：`make` 后生成 `build/kernel.elf`，QEMU 启动后能看到 banner 输出。

**自检点**：
- `qemu-system-riscv64 -machine virt -kernel build/kernel.elf -nographic` 能看到你的 banner

**如果卡住（没有输出）**：回到 [Book 2.6a 自学调试指南](../book/ch02-boot.md) 按四阶段流程排查。

### 步骤 4：验证 BSS 清零和多核行为（预计 20 分钟）

```c
// 在 kernel_main 的开头增加这段检查代码
extern char _bss_start[];
extern char _bss_end[];

static void verify_bss_zero(void) {
    for (char *p = _bss_start; p < _bss_end; p++) {
        if (*p != 0) {
            // 在串口还没初始化好的情况下，可以死循环并让 QEMU 超时退出
            // 后续阶段可以用 panic() 代替
            while (1) { __asm volatile("nop"); }
        }
    }
    uart_puts("[PASS] BSS is zeroed\n");
}

static void verify_hart_count(void) {
    // 这个检查很简单：只要 HART 0 顺利走到这里就说明没有多 HART 同时初始化
    uart_puts("[PASS] Only HART 0 is initializing\n");
}
```

**预期产物**：banner 之后能看到 `[PASS]` 信息。

### 步骤 5：编写 Spec 制品（预计 30 分钟） |

## 3. 背景阅读

- [附录：开发环境搭建](../appendices/dev-environment.md)
- [附录：QEMU 使用指南](../appendices/qemu-guide.md)
- [附录：链接脚本指南](../appendices/linker-script.md)
- [附录：RISC-V 参考](../appendices/riscv-reference.md)（启动和特权级部分）
- 你目标平台的技术文档（QEMU `virt` 机器手册）

## 4. 规格要求

### 4.1 ArchitectureSlice(boot)（必做）

创建 `spec/architecture/slices/01-boot.yaml`，定义本阶段引入了什么机制、依赖什么前序决策。

### 4.2 ModuleSpec（必做）

为你的启动模块编写 ModuleSpec：
- `spec/modules/boot/module.yaml`：描述启动模块的状态、接口和不变量

至少为以下操作编写 OperationContract：
- 汇编入口：从固件跳转到 `_start` 的契约
- BSS 清零操作
- 启动主函数（如 `kernel_main`）

### 4.3 ToolchainSpec（必做）

创建 `spec/toolchain/toolchain.yaml`，至少定义：
- 目标架构和编译器
- 链接布局（入口地址、段布局）
- 运行参数（QEMU 机器型号、内存大小）

可使用 `vos build generate` 生成初始骨架，再手动调整。

## 5. 质量门禁

### 构建门禁

```bash
vos build          # 编译并链接内核
```

确认 `build/kernel.elf` 或等价产物存在。

### 运行门禁

```bash
vos run qemu       # 启动 QEMU
```

确认：
- [ ] 串口有输出
- [ ] 输出中包含你的 kernel banner
- [ ] QEMU 在超时时间内正常运行（无 panic）

### BSS 清零验证

在你的 `kernel_main` 开头添加检查代码，验证 BSS 区域全为零。或者，在 BSS 清零前后分别检查 BSS 内容。

### 多核验证

确认只有 HART 0 执行初始化代码。其他 HART 在确定的位置等待。

## 6. 设计理据要求

1. 你的启动序列为什么是这个顺序？有没有步骤可以调换或省略？
2. 你的链接脚本中内核加载地址的由来是什么？
3. 你如何处理非启动 HART？如果非启动 HART 意外进入了初始化代码，会发生什么？

## 7. AI 使用边界

**允许**：
- 让 AI 审查你的链接脚本
- 让 AI 解释 QEMU 启动日志或崩溃原因
- 让 AI 生成汇编入口的框架（你需理解每一条指令）

**禁止**：
- 让 AI 一次性生成完整的启动代码而不写对应的 ModuleSpec

## 8. 提交物

- `spec/architecture/slices/01-boot.yaml`
- `spec/modules/boot/module.yaml` 及相关 OperationContract
- `spec/toolchain/toolchain.yaml`
- 内核源码（入口汇编、启动 C 代码、链接脚本）
- QEMU 启动日志（含 banner）

（进阶方向：从固件或设备树获取物理内存布局为阶段 3 做准备；测量从 `_start` 到 `kernel_main` 的时钟周期数以建立启动性能基线。）

## 9. 常见错误与排查

### 错误 1：`make` 报 "riscv64-unknown-elf-gcc: command not found"

**原因**：交叉编译器不在 PATH 中。

**解决**：
```sh
# 检查是否已安装
ls /opt/riscv/bin/riscv64-unknown-elf-gcc    # 常见安装路径
ls ~/.local/bin/riscv64-unknown-elf-gcc     # 另一种常见路径

# 如果未安装（Ubuntu/Debian）
sudo apt install gcc-riscv64-unknown-elf

# 如果未安装（macOS Homebrew）
brew install riscv-gnu-toolchain

# 如果未安装（Windows）
# 推荐使用 WSL2 + Ubuntu，然后按上述 Linux 步骤
# 或者下载预编译工具链：https://github.com/riscv-collab/riscv-gnu-toolchain/releases

# 临时加入 PATH
export PATH="/opt/riscv/bin:$PATH"
# 永久加入：把这行加到 ~/.bashrc 或 ~/.zshrc
```

### 错误 2：链接时报 "undefined reference to `__libc_start_main`"

**原因**：编译器认为你的程序需要一个 `main` 函数和 C 运行时初始化代码，但你在写 freestanding 内核。

**解决**：确保 Makefile 中有 `-nostdlib -ffreestanding`：
```makefile
CFLAGS += -nostdlib -ffreestanding -nostartfiles
LDFLAGS += -nostdlib
```

### 错误 3：QEMU 报 "qemu-system-riscv64: -kernel: image must be specified"

**原因**：你没告诉 QEMU 内核文件在哪，或文件路径错误。

**解决**：
```sh
qemu-system-riscv64 -machine virt -kernel build/kernel.elf -nographic
#                                           ^^^^^^^^^^^^^^^ 确保路径正确
```

### 错误 4：QEMU 启动了但没有输出，也没有任何错误信息

这是最高频的 bug。按 [Book 2.6a](../book/ch02-boot.md) 的四阶段排查流程逐条检查。最常见的具体原因（按概率排序）：
1. 链接脚本中入口地址与 QEMU 加载地址不一致（概率最高）
2. `_start` 不是 ELF 的入口符号（`readelf -h` 检查）
3. UART 基地址写错了（RISC-V virt 是 `0x10000000`）
4. BSS 清零覆盖了 UART 寄存器区域（如果 BSS 段误包含了 0x10000000 附近）
5. 编译器优化掉了 UART 写入代码（没用 `volatile`）

### 错误 5：banner 输出了一部分就停了，或者输出乱码

**原因**：栈溢出或 BSS 清零不完整。

**排查**：
```sh
# 检查栈是否溢出到了 BSS 区域
riscv64-unknown-elf-objdump -t build/kernel.elf | grep _stack
riscv64-unknown-elf-objdump -t build/kernel.elf | grep _bss
# 检查栈地址是否合理：_stack_top 应该在 _bss_end 之上至少 8 KiB
```

### 错误 6：在所有文件都没问题的情况下，`make` 总是重新编译所有文件

**原因**：Makefile 的依赖规则写得不精确，或者你修改了一个被所有 `.c` 文件 `#include` 的头文件。

**解决**：这不是 bug——修改头文件后重新编译所有依赖它的源文件是正确的行为。但如果每次 `make` 都触发完整重编译，检查你的依赖声明：确保 `.d` 依赖文件能被正确生成和 `-include`。
