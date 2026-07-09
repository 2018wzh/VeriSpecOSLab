# 第 9 章：移植到实际硬件 — 走出模拟器

> **对应实验**：[Lab 9: 移植到实际硬件](../labs/lab9-hardware-port.md)

## 9.1 为什么模拟器跑得好、真实硬件可能炸

QEMU 是一个出色的教学工具——但它也撒了很多"善意的谎言"。

**QEMU 替你初始化了设备。** 在真实硬件上，UART 可能没有被固件初始化——你需要自己配置波特率、数据位、停止位。在 QEMU 中，这些已经被预设好了。

**QEMU 的内存是确定性的。** 每次启动，RAM 的内容都是从同样的初始状态开始的。真实硬件上，RAM 可能保留了上一次启动的残留数据——BSS 段清零的假设可能不成立，因为 RAM 的初始值不是零。

**QEMU 的设备是"理想化"的。** 真实硬件的 UART 可能有未文档化的行为、有 errata（硬件 bug）、有温度漂移影响波特率。QEMU 的 UART 是完美符合规范文档的理想模型。

### 可移植性的起点：Unix 被用 C 重写（1973）

移植问题不是新问题。在操作系统历史上的大部分时间里，整个 OS 是用**汇编语言**写的——每一行代码和特定的 CPU 指令集绑定。IBM OS/360 只能在 System/360 上运行。DEC 的 TOPS-10 只能在 PDP-10 上运行。Multics 只能在 GE 645 上运行。操作系统移植 = 重写，没有例外。

1973 年，Dennis Ritchie 做了一件改变了此后 50 年操作系统行业的事情：他和 Ken Thompson 把 Unix 内核从 PDP-7 汇编改写成了 C 语言。这是历史上第一次，一个操作系统的核心代码不是绑定在特定硬件上的——它绑定在**编译器**上。只要有一台机器上有能编译 C 语言的编译器，你就能把 Unix 移植过去。

这个决定的冲击力远超当时任何人的预期。1970 年代末到 1980 年代初，Unix 被移植到了 PDP-11、VAX、Interdata 8/32、Motorola 68000 等几十种完全不同的硬件平台——而内核的核心代码（文件系统、进程管理、内存管理）几乎不变。这就是你的 HAL 层的终极形态：**把平台差异隔离在最小范围的代码中，让其余 90% 的内核与硬件无关。**

> **原始文献：** D. M. Ritchie, "The Development of the C Language," *Proceedings of the Second History of Programming Languages Conference*, pp. 201-208, ACM, 1993.（注意：C 语言的影响在 1978 年的 *The C Programming Language* 出版后才大规模扩散，但 Unix 内核本身从 1973 年开始就是用 C 写的。）关于 Unix 可移植性的最早系统性讨论，见 John Lions, *A Commentary on the Sixth Edition UNIX Operating System*, University of New South Wales, 1977——这本著名的"狮子书"（Lions' Commentary）逐行注释了 Unix V6 内核源码，其中反复出现对"这段代码移植到新硬件时需要改哪里"的讨论。

**对你这门课的意义：** 你现在在 QEMU 上写的 RISC-V 内核，如果将来要移植到 ARM 或 x86，需要重写的代码量直接取决于你的 HAL 设计质量。参考 Lions' Commentary 中的做法——把 MMIO 地址、中断控制器配置、页表格式集中在一个"平台"目录中，剩下的文件系统、进程管理、syscall 分发层完全不变。

**QEMU 的中断模型更宽容。** 真实硬件可能存在中断丢失、中断乱序、中断控制器竞争等 QEMU 不会模拟的边界情况。

### 历史上著名的"QEMU 能跑、真硬件不能跑"案例

Linux 内核的早期版本在移植到新 SoC 时经常遇到"在 QEMU 上一切正常，烧到板子上启动到一半死掉"的情况。根因通常是：某段代码假设了内存延迟为零（QEMU 是理想化的），真实硬件上内存访问有延迟，时序依赖的代码失效。或是代码假设了设备的 MMIO 读立刻返回——真实硬件上可能需要多个时钟周期的延迟。

移植的教训是：**你对硬件的每一个隐式假设，在真实硬件上都会被挑战。** 好的 HAL 设计让这些假设显式化、集中化——如果 UART 的基地址变了，你只需要改一个地方。坏的 HAL 设计让这些假设散落在几百处代码中——每一处都需要你找到并修改。

## 9.2 设计维度

### 维度 1：选择目标硬件

不同的 RISC-V 开发板有不同的外设配置、内存布局和启动方式：

- **SiFive HiFive Unmatched**：成熟的 RISC-V 开发板，外设丰富
- **StarFive VisionFive 2**：价格更亲民，但文档可能不够完善
- **QEMU 其他机器型号**：作为中间步骤，可以先移植到 QEMU 的 `sifive_u` 或 `microchip-icicle` 型号

你需要回答的问题：
- 你的目标硬件的 RAM 起始地址与 QEMU `virt` 相同吗？如果不同，你的链接脚本需要修改。
- 你的目标硬件的 UART 是 16550A 吗？如果不是，你的串口驱动需要修改或重写。

### 维度 2：启动链适配

QEMU 使用 `-kernel` 参数直接加载 ELF 镜像。真实硬件的启动链通常不同：

- **Bootloader**：U-Boot 是最常见的 RISC-V bootloader。它可以从 SD 卡、网络或串口加载内核。
- **固件**：不同开发板使用不同的固件（OpenSBI、U-Boot SPL 等）
- **设备树**：真实硬件的设备树与 QEMU 生成的不同。你需要解析真实的设备树来获取内存布局和外设信息。

你需要回答的问题：
- 你的内核镜像以什么格式存放在什么介质上？（SD 卡上的 ELF 文件？raw binary 烧录到特定地址？）
- 固件将 CPU 留在什么状态？是否与 QEMU 一致？

### 维度 3：外设驱动适配

真实硬件的外设可能与 QEMU 不同：

- **UART**：可能是 16550A、SiFive UART 或其他型号。MMIO 地址和寄存器布局可能不同。
- **中断控制器**：可能是 PLIC 的变体，也可能是 AIA（Advanced Interrupt Architecture）。
- **定时器**：`mtime`/`mtimecmp` 的地址通过设备树获取。
- **磁盘**：可能是 NVMe、SD 卡控制器或其他。

你需要回答的问题：
- 你的 HAL 层是否足够抽象，使得移植只需要更换底层驱动？
- 哪些外设在你的目标硬件上与 QEMU 相同？哪些不同？不同的部分你打算如何适配？

### 维度 4：调试真实硬件

调试真实硬件比 QEMU 困难很多：

- **串口**：最可靠的调试手段。确保你的内核能在移植的最早阶段就输出到串口。
- **JTAG/OpenOCD**：如果需要硬件级调试，需要 JTAG 调试器和 OpenOCD 配置。
- **LED**：如果有可编程 LED，用 LED 闪烁作为最基本的"心跳"信号。

### 维度 5：多架构移植路线图

移植不是"从 QEMU 一下跳到真实芯片"——中间有多个过渡站。以下是三条完整路线，覆盖三大主流 ISA：

#### 路线 A：RISC-V 64 真实硬件

**第一站：QEMU `sifive_u`（SiFive Unleashed 模拟）**
这是从 QEMU `virt` 到真实 RISC-V 硬件的中间站。`sifive_u` 模拟了一台拥有 SiFive UART、PLIC 和 PRCI（电源/时钟管理）的机器——这些外设在真实 SiFive 芯片上存在，但与 `virt` 的 16550A UART 完全不同。

关键差异：
- UART 从 16550A (MMIO `0x10000000`) 变为 SiFive UART (`0x10010000`，不同的寄存器布局)
- 中断控制器仍是 PLIC，但基地址和 IRQ 编号不同
- 需要 PRCI 来配置时钟——在 `virt` 上 OpenSBI 替你做了

**第二站：SiFive HiFive Unmatched（真实板卡）**
- CPU: SiFive FU740 (4×U74 + 1×S7)
- RAM: 16 GB DDR4，起始地址 `0x80000000`（与 QEMU `virt` 一致——好消息）
- 启动: ZSBL → FSBL (OpenSBI) → U-Boot → 你的内核
- 关键外设：SiFive UART、PLIC、CLINT、SD 卡控制器
- 你需要做的事：将内核镜像放到 SD 卡上、配置 U-Boot 自动加载

**第三站（可选）：StarFive VisionFive 2**
- CPU: JH7110 (4×SiFive U74)
- RAM: 2/4/8 GB LPDDR4
- 启动: 比 HiFive 复杂——需要理解专有的 boot ROM 流程
- 文档：不如 SiFive 完善，社区驱动为主

#### 路线 B：x86-64 真实 PC

**第一站：QEMU `q35` + UEFI（模拟现代 PC）**
从 `-machine virt` 到 `-machine q35` 加上 OVMF（UEFI 固件），模拟一台现代 PC。这一步测试你的内核是否能在 UEFI 环境下启动。

关键差异：
- 启动方式从固件直启变为 UEFI 加载 PE/COFF 内核
- 中断控制器从 PLIC 变为 APIC
- 串口从 16550A MMIO 变为 I/O 端口 `0x3F8`

**第二站：任意 x86-64 PC 或笔记本（USB 启动）**
- 将内核编译为 PE/COFF 格式
- 放到 FAT32 格式的 U 盘上：`/EFI/BOOT/BOOTX64.EFI`
- 从 UEFI 启动菜单选择 U 盘
- 关键挑战：帧缓冲（GOP）的实际分辨率可能与 QEMU 不同；内存映射由固件动态生成

#### 路线 C：ARM64 (AArch64) 真实硬件

**第一站：QEMU `virt` (aarch64) + UEFI**
QEMU 的 aarch64 `virt` 机器 + 固件模拟。ARM64 的启动路径比 RISC-V 更接近 UEFI 世界。

**第二站：Raspberry Pi 4/5**
- CPU: Broadcom BCM2711/2712 (Cortex-A72/A76)
- RAM: 2/4/8 GB
- 启动: GPU 先启动，加载 `config.txt` → 加载固件 → 加载 `kernel8.img`
- 关键文档：[RPi Firmware 仓库](https://github.com/raspberrypi/firmware) 和 BCM2711 外设手册
- 独特挑战：Pi 的 UART 是 PL011（不是 16550A）；中断控制器是 BCM 专有的 GIC 实现；物理地址空间起始不是 `0x80000000` 而是 `0x0`（但低地址通常被 VPU 固件占用）

### 维度 6：移植时的 HAL 重构策略

如果你的 HAL 从一开始就设计为"一层薄薄的宏定义"（如 `#define UART0_BASE 0x10000000`），移植时的改动能最小化：

**好的做法**：
```c
// platform/qemu_virt.h
#define UART0_BASE 0x10000000L

// platform/sifive_u.h  
#define UART0_BASE 0x10010000L

// 编译时选择：-DPLATFORM=qemu_virt
#include "platform/$(PLATFORM).h"
```

**坏的做法**：
```c
// 散落在 20 个文件中
*(volatile uint8_t *)0x10000000 = 'H';  // 5 个文件
uart_init(0x10000000);                   // 8 个文件  
plic_claim(0x0C000000);                  // 7 个文件
// → 移植时需要找出每一个硬编码地址
```

如果你已经不幸走了"坏的做法"的路线（在教学 OS 中这很常见），阶段 9 就是你的重构机会：把所有硬编码地址收敛到 `platform.h` 中集中管理。

## 9.3 规格要求

### GoalValidationContract（必做）

硬件移植的 contract 需要关注：
- `correctness_guard`：移植不能破坏已有功能（QEMU 上仍然能运行）
- `target`：在真实硬件上达成的基本目标（启动、输出 banner、运行用户程序）
- `benchmark_or_oracle`：真实硬件的启动日志
- `negative_tradeoff_checks`：移植后 QEMU 版本的性能不应退化

### ADR（建议）

记录硬件适配的关键决策：设备树解析策略、驱动替换方式、HAL 层修改。

### 移植报告（建议）

记录移植过程中的关键发现：
- 真实硬件与 QEMU 的差异清单
- 遇到的调试困难和解决方法
- 哪些设计假设被真实硬件打破

## 9.4 质量门禁

- [ ] 真实硬件上内核启动并输出 banner
- [ ] 至少串口可正常工作（中断驱动或轮询）
- [ ] QEMU 版本继续正常运行（移植未破坏已有功能）
- [ ] GoalValidationContract 通过

## 9.5 常见陷阱

1. **硬编码地址**：在 QEMU 中硬编码 `0x10000000` 作为 UART 地址，但真实硬件的 UART 在其他地址。
2. **启动链假设**：假设固件已经初始化了所有设备。在真实硬件上，固件可能只做了最小初始化。
3. **时钟频率差异**：真实硬件的时钟频率可能与 QEMU 不同，影响定时器和 UART 波特率。
4. **UART 没有输出——STM32 开发者最常见的盲区**：如果你习惯了 STM32 上"配好 GPIO 时钟、设置波特率、写 DR 寄存器就有输出"的流程，真实板卡的 UART 调试会让你挫败。在 RISC-V 和 ARM 开发板上，UART 可能通过 FTDI 芯片连接到 USB，而波特率不是 115200（有时候是 921600 甚至 3 Mbps），或者需要外接 TTL-USB 转换器到特定的 GPIO 引脚。**排查步骤：先用逻辑分析仪或示波器看 TX 引脚是否有信号。有信号 → 波特率/电压不对。没信号 → 你的 UART 驱动根本没在发数据。**
5. **SD 卡启动——Fat32 分区和文件名大小写**：U-Boot 在加载内核镜像时对文件名大小写敏感（与 Windows 不同）。`kernel8.img` 和 `KERNEL8.IMG` 是不同的文件。SD 卡的分区表必须是 MBR（不能是 GPT），第一个分区必须是 FAT32 且标记为 active/bootable。**排查：在 U-Boot 命令行中手动 `fatls mmc 0:1` 确认文件可见，且名称精确匹配。**
6. **Raspberry Pi 的 config.txt 黑魔法**：Pi 的 GPU 先于 ARM CPU 启动，读取 `config.txt`。如果你的内核需要 UART 输出用于调试，必须在 `config.txt` 中显式设置 `enable_uart=1` 和 `uart_2ndstage=1`——否则 GPU 固件可能禁用 UART 或者把 UART 配置为蓝牙使用。这是 Pi 平台上最常见的"为什么串口没输出"的原因。
7. **JTAG 连接不稳定——调试器比内核还难搞**：OpenOCD 的配置文件对开发板型号、调试器型号、JTAG 接口速度都敏感。`adapter speed 1000` 可能太高（导致连接不稳定），太低（调试响应慢）。**建议：先在已知良好的配置上验证 JTAG 链（让 OpenOCD 输出 "Examined RISC-V core"），再加载你的内核。**

## 9.6 移植检查清单（自学者版）

在宣称"移植完成"之前，按以下清单逐项确认：

- [ ] 内核在真实硬件上成功输出 banner
- [ ] UART 可以正常收发（中断驱动模式）
- [ ] 时钟中断正常触发（验证 tick 计数递增）
- [ ] 一个最小用户程序（hello）可以运行并输出
- [ ] QEMU 版本继续正常运行（移植未退化）
- [ ] 所有硬编码地址已收敛到 platform 头文件
- [ ] 真实硬件上运行 1 小时不加 watchdog 不崩溃

## 9.7 ⚡ 挑战：JTAG 调试、真实硬件性能测量

### 挑战 A：通过 JTAG/OpenOCD 调试真实硬件

当你的 OS 在真实硬件上崩溃时，串口输出可能不可靠（崩溃时 UART 缓冲区可能未刷新）。JTAG 是"最后的手段"——它在 CPU 级别暂停执行，允许你检查寄存器、内存和断点。

**基本 JTAG 调试流程**：
1. 连接 JTAG 调试器（如 FT2232H 或 CMSIS-DAP）到开发板的 JTAG 接口
2. 启动 OpenOCD，连接到目标芯片
3. 用 GDB 通过 OpenOCD 连接到目标：`target remote localhost:3333`
4. 设置硬件断点（`hbreak`）而非软件断点——软件断点需要修改内存中的指令，在 ROM/flash 中不可行
5. 在崩溃 handler 中放置无限循环，用 JTAG 附加后检查寄存器和栈回溯

**教学价值**：经历一次"串口输出只有半行然后系统静默挂死，最后靠 JTAG 定位到根因"的调试过程，你会对"什么是可调试性"有完全不同的理解。

### 挑战 B：真实硬件上的中断延迟测量

在 QEMU 中，中断延迟是理想化的。在真实硬件上，中断延迟包含：
- 中断控制器的传播延迟
- CPU 流水线排空
- 缓存未命中的影响

**测量方法**：
1. 配置一个 GPIO 输出引脚在进入 ISR 的第一条指令时翻转电平
2. 用逻辑分析仪或示波器测量"GPIO 触发中断"到"GPIO 响应翻转"的时间差
3. 在不同的 CPU 负载下重复测量（空闲 vs 满负荷 vs cache thrashing）

**与阶段 8 的关联**：如果你选了 O1（实时性），这是你的 benchmark 的最终验证——不是在 QEMU 上跑基准，是在真实硬件上用示波器探头测出来的数字。

### 挑战 C：在真实硬件上验证阶段 8 的 USB/PCI 驱动

真实硬件上的 USB 控制器可能与 QEMU 的模拟版本不同：
- QEMU 模拟的是 xHCI 1.0 的理想化子集；真实 xHCI 控制器可能有未文档化的 quirks
- USB 设备的枚举时序在真实硬件上更严格——SET_ADDRESS 后需要等待设备完成复位
- 真实 USB 键盘的 HID 报告描述符可能比 QEMU 模拟的更复杂

如果你在阶段 8 选了 USB 或 PCI 方向，在阶段 9 尝试将驱动移植到真实硬件——这是对你 HAL 设计质量的最终考验。
