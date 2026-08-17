# 第 9 章：移植到实际硬件 — 走出模拟器

> **对应实验**：[Lab 9：真实硬件移植——走出模拟器](../labs/lab9-hardware-port.md)

> **学完本章你能：**
>
> 1. 说清 QEMU 与真实板卡在启动链、内存、时钟、外设与调试手段上的系统差异；
> 2. 冻结 QEMU 对照基线，用"QEMU 通过"与"板卡已验证"两列独立证据管理移植进度；
> 3. 完成 Boot ROM → SPL → OpenSBI/UEFI → U-Boot → 内核的启动链分析与 U-Boot 交接验证；
> 4. 独立完成 UART、定时器/中断与至少一个存储外设（SDIO/eMMC/SPI）的板级 bring-up；
> 5. 在没有串口输出时用 LED、调试器或最小探针定位启动阶段，并解释 `fatload` 为何不是内核驱动证据。

## 9.1 为什么模拟器跑得好、真实硬件可能炸

QEMU 是一个出色的教学工具，但它也撒了很多"善意的谎言"。

**QEMU 替你初始化了设备。** 真实硬件上，UART 可能根本没被固件初始化，波特率、数据位、停止位都得你自己配。QEMU 里这些已经预设好了。

**QEMU 的内存是确定性的。** 每次启动，RAM 的内容都从同样的初始状态开始。真实硬件上，RAM 可能留着上一次启动的残留数据，BSS 段清零的假设不一定成立，因为 RAM 的初始值不是零。

**QEMU 的设备是"理想化"的。** 真实硬件的 UART 可能有未文档化的行为、有 errata（硬件 bug），连温度漂移都会影响波特率。QEMU 的 UART 是严格贴合规范文档的理想模型。

### 可移植性的起点：Unix 被用 C 重写（1973）

移植问题不是新问题。操作系统历史上大部分时间里，整个 OS 用**汇编语言**写成，每一行代码都和特定 CPU 指令集绑定。IBM OS/360 只能在 System/360 上运行。DEC 的 TOPS-10 只能在 PDP-10 上运行。Multics 只能在 GE 645 上运行。操作系统移植等于重写，没有例外。

1973 年，Dennis Ritchie 做了一件改变此后 50 年操作系统行业的事：他和 Ken Thompson 把 Unix 内核从 PDP-7 汇编改写成了 C 语言。历史上第一次，操作系统内核的核心代码不再绑死在一块特定硬件上，它绑定的是**编译器**。只要某台机器上有能编译 C 语言的编译器，Unix 就能移植过去。

这个决定的冲击力远超当时任何人的预期。1970 年代末到 1980 年代初，Unix 被移植到 PDP-11、VAX、Interdata 8/32、Motorola 68000 等几十种完全不同的硬件平台，内核的核心代码（文件系统、进程管理、内存管理）却几乎原样不动。这就是你的 HAL 层的终极形态：**把平台差异隔离在最小范围的代码里，让其余 90% 的内核与硬件无关。**

> **原始文献：** D. M. Ritchie, "The Development of the C Language," *Proceedings of the Second History of Programming Languages Conference*, pp. 201-208, ACM, 1993.（注意：C 语言的影响在 1978 年的 *The C Programming Language* 出版后才大规模扩散，但 Unix 内核本身从 1973 年开始就是用 C 写的。）关于 Unix 可移植性的最早系统性讨论，见 John Lions, *A Commentary on the Sixth Edition UNIX Operating System*, University of New South Wales, 1977。这本著名的"狮子书"（Lions' Commentary）逐行注释了 Unix V6 内核源码，其中反复出现对"这段代码移植到新硬件时需要改哪里"的讨论。

**对你这门课的意义：** 你现在在 QEMU 上写的 RISC-V 内核，将来要移植到 ARM 或 x86 时，需要重写的代码量直接取决于你的 HAL 设计质量。参考 Lions' Commentary 的做法：把 MMIO 地址、中断控制器配置、页表格式集中到一个"平台"目录里，剩下的文件系统、进程管理、syscall 分发层完全不用动。

**QEMU 的中断模型更宽容。** 真实硬件上可能出现中断丢失、中断乱序、中断控制器竞争这些 QEMU 不会模拟的边界情况。

### 历史上著名的"QEMU 能跑、真硬件不能跑"案例

Linux 内核的早期版本移植到新 SoC 时，经常遇到"在 QEMU 上一切正常，烧到板子上启动到一半就死掉"的情况。根因通常是某段代码假设内存延迟为零（QEMU 把内存理想化了），真实硬件上内存访问有延迟，时序敏感的代码就会失效。或者代码假设设备的 MMIO 读会立刻返回，真实硬件上可能要等好几个时钟周期。

移植的教训是：**你对硬件的每一个隐式假设，在真实硬件上都会被挑战。** 好的 HAL 设计让这些假设显式化、集中化：UART 基地址变了，只改一个地方。坏的 HAL 设计让它们散落在几百处代码里，每一处都得你找到并改掉。

### 9.1.1 QEMU 与真实板卡的差异矩阵

移植前先建立一张“QEMU 已经替你做了什么、板卡上谁负责”的对照表。QEMU 的通过只说明模拟机器满足了当前命令和设备模型；它不是对真实电源、引脚、时钟、缓存或存储协议的证明。

| 边界 | QEMU `virt` 常见情况 | 真实板卡必须核对 | 可提交的最小证据 |
| --- | --- | --- | --- |
| 复位与加载 | `-kernel` 或固定固件直接把镜像放入 RAM | Boot ROM、SPL/TPL、OpenSBI、U-Boot/UEFI 的顺序、镜像格式和加载地址 | 上电到内核入口的串口阶段标记、U-Boot 命令记录 |
| RAM 与缓存 | RAM 大小和地址由机器模型给定，访问通常近似同步 | DDR training、保留区、内存属性、cache 层级、DMA 一致性 | 设备树/手册来源、内存探针、cache/DMA 回归 |
| UART | 设备模型和时钟通常已准备好，串口可直接使用 | pinmux、门控时钟、复位、电平、外接 USB-UART 和实际波特率 | 示波器或串口工具参数、完整启动日志 |
| 设备发现 | `virtio`/MMIO/PCI 拓扑由 QEMU 参数固定 | DTB、固件传参、pinmux、时钟和 IRQ domain 的真实节点 | 保存的 DTB 摘要、发现结果和来源页码 |
| 中断与定时器 | PLIC/虚拟定时器行为稳定、延迟低 | SoC IRQ 控制器、timer clock、IPI、优先级、清除/确认顺序 | 首次和连续 tick、IRQ 路由及异常记录 |
| 存储 | virtio-blk 队列和 host 文件替你完成介质时序 | SDIO/eMMC/SPI-NOR/SPI-SD 的供电、命令、忙状态、DMA、卡检测和掉卡 | 设备枚举、读写回环、超时/拔卡错误和分区发现 |
| 电源与复位 | 设备创建和复位近似瞬时完成 | regulator、reset controller、时钟树、watchdog 和冷/暖复位差异 | 每个外设的 enable/reset 顺序与复位后日志 |
| 调试 | QEMU monitor、GDB stub 可随时附加 | UART、LED、JTAG/OpenOCD，且可能只能用硬件断点 | 断点寄存器快照、LED 阶段码和串口互证 |

把表中“真实板卡必须核对”逐项映射到 `hardware_port` 和平台 HAL。未验证的项应标为待办或 `pending_human_review`，不能用 QEMU 日志填空。

### 9.1.2 VOS 的 QEMU 板级移植工作流

如果课程要求把 Lab 1 的 canonical board 先带入 QEMU，VOS 提供了一条证据门控的 QEMU 源码移植链。它和 `vos run qemu` 的区别必须先说清楚：`run qemu` 运行你的内核；下面的 `agent qemu` 负责修改固定版本的 QEMU 机器/SoC 模型，并按真实板卡的启动链验证模型。它不替代真实硬件，也不自动更新项目的 `vos.yaml`。

#### 申请与材料边界

在项目初始化后，学生手写 `spec/qemu/<request-id>.yaml`。request 只包含目标板、QEMU 版本和仓库相对的 QEMU 源码路径，保持 `revision: 0`、`status: request`；不要把 Agent 生成的寄存器猜测直接写入 request。对应的学生材料放在 `references/qemu/<request-id>/`，例如：

| 材料 | 用来证明什么 |
| --- | --- |
| 板卡/SoC 手册、勘误 | 寄存器复位值、时钟/复位、IRQ、DMA 和设备语义 |
| 原理图、pinmux/电源表 | UART、SDIO/eMMC、SPI、调试器和启动介质的真实连线 |
| DTB/DTS、已知启动固件或镜像 | 设备发现、内存范围、固件交接和镜像格式 |
| 已验证的启动日志、版本记录 | BootROM/SPL/OpenSBI/U-Boot/内核阶段和实际约束 |

预检会为这些文件建立路径、角色、大小和 SHA-256 清单。材料目录缺失或为空时，在调用 Agent 前直接失败；材料不足时只返回具体缺口，不生成 candidate。硬件事实只能来自这些材料，不能用网络搜索或“相似板卡”填空。执行阶段可以从官方仓库固定 TF-A、U-Boot 等软件依赖，但必须记录不可变版本和来源。

#### 预检、批准与执行

```sh
vos agent qemu preflight <QemuSpec ID|path>
# 审查 spec/qemu/<request-id>.rN.yaml
# 将 status: candidate 改为 status: approved 后提交
vos agent qemu execute <approved QemuSpec ID|path>
```

预检是只读的：它核对 QEMU 源码树的 `VERSION` 和当前 commit，重建真实 boot path，比较每个设备的复位状态、寄存器行为、IRQ/DMA/clock wiring、guest-visible ID 和固件路径，并把设备分为直接复用、集成复用、兼容变体、新模型或明确不支持。成功的结构化 `sufficient` 结果才会产生 candidate；其中的 `boot_path`、bypass、reuse matrix、findings、phases、dependencies 和 `implementation.owns` 是学生批准前必须逐项检查的内容。任何跳过 BootROM/SPL、预加载 kernel/DTB 或简化固件服务都要写成显式 bypass。

candidate 是唯一允许 Agent 生成的 Spec 例外。学生必须核对缺口和 blocker 的 resolution，把它改为 `approved`，并用普通 Git 提交；未提交、被 `.gitignore` 忽略或与当前 HEAD 不一致的 approved Spec 都不能执行。

执行只接受 clean HEAD、已提交的 approved revision、未变化的材料哈希和 QEMU commit。VOS 在 detached worktree 中按批准的 `owns` 路径工作，要求 QEMU 构建、Agent 定义的 boot-to-shell loop 和邻居机器回归；成功后落一个本地提交并清理 worktree。`spec/`、`vos.yaml`、`.vos/` 和材料目录是保护路径，执行不 push。中断时保留 recovery 记录，只有命令、target、HEAD、Spec hash 和 worktree 仍匹配才能用 `--resume <run-id>` 继续。

#### QEMU 模型证据不等于板卡证据

QEMU 移植的通过项应绑定 QEMU 源码 commit、QemuSpec revision、材料清单、阶段提交、构建命令、完整有界日志和邻居回归结果。它可以证明“模型按声明的最小固件路径到达 shell”，但不能填充差异矩阵中的真实电源、DDR training、pinmux、电平、U-Boot 控制台、SDIO/SPI 时序、DMA/cache 一致性或 `pending_human_review`。这些仍必须由 Lab 9 的真实板卡流程单独验证。

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

### 维度 2 续：U-Boot 移植与固件交接

U-Boot 不是“把 ELF 复制到 SD 卡”的命令集合，而是一个有自己的板级初始化、设备模型和启动协议的系统。真实板卡常见的链路是：

```text
Boot ROM → SPL/TPL（必要时初始化 DDR）→ OpenSBI/TF-A
→ U-Boot proper → 读取 DTB/环境 → 加载内核与 initramfs
→ 按约定进入内核
```

QEMU 的 `-kernel` 路径可能跳过其中大部分阶段；因此 U-Boot 能加载镜像，不等于内核已经拥有 SDIO、SPI、时钟或中断驱动。要把“U-Boot 负责加载”和“内核负责运行”分开验收。

#### U-Boot 板级移植的职责边界

| 层次 | 需要完成的内容 | 交接时必须记录 |
| --- | --- | --- |
| 构建配置 | `defconfig`、Kconfig 选项、交叉编译器和 `CONFIG_DEFAULT_DEVICE_TREE` | 配置文件、U-Boot 版本、构建身份 |
| SPL/TPL | 片上 SRAM 运行、时钟/复位、DDR training、加载 proper | 是否需要 SPL/TPL、DDR 初始化日志 |
| 设备树与驱动 | `compatible`、reg、clock、reset、pinctrl、interrupt、DMA 和电源节点 | 实际使用的 DTB、节点来源和未支持节点 |
| 控制台 | UART 的时钟、pinmux、FIFO、波特率和输入输出 | 控制台设备、波特率和电平 |
| 启动介质 | MMC/SDIO、SPI-NOR、USB 或网络的探测与读写 | 总线号、CS/分区、读写回环和超时 |
| 环境与启动命令 | `bootcmd`、`bootargs`、`fdt_addr_r`、`kernel_addr_r`、安全的环境保存位置 | 完整命令、变量展开后的地址和 DTB 位置 |
| 镜像交接 | `booti`、`bootm`、`bootelf` 或平台等价入口；入口特权级和寄存器约定 | 镜像类型、加载/入口地址、hart、SBI/UEFI 服务 |

建议按以下顺序移植，而不是一开始修改所有驱动：

1. 用官方或上游 `defconfig` 构建并让 U-Boot 在板卡串口输出版本和 DRAM 大小。
2. 只验证 `mmc list`/`mmc dev`/`mmc rescan` 或 SPI-NOR 探测；设备未稳定前不要接入内核。
3. 在 U-Boot 中手动列出分区和文件，再手动加载内核、DTB、initramfs，记录变量展开后的地址。
4. 让内核打印入口、hart、DTB 地址、RAM 范围和固件服务版本；确认这些值与 U-Boot 交接一致。
5. 将重复成功的命令收敛为环境脚本或 FIT 配置，并在报告中保留一次逐条手动验证作为故障基线。

不同板卡的命令和地址不能照抄。以下仅展示验收形状，`mmc`、分区号、文件名和加载地址必须替换成手册与实际探针得到的值：

```text
=> mmc list
=> mmc dev <dev> <part>
=> mmc rescan
=> fatls mmc <dev>:<part>
=> fatload mmc <dev>:<part> <kernel_addr_r> <kernel-file>
=> fatload mmc <dev>:<part> <fdt_addr_r> <dtb-file>
=> booti <kernel_addr_r> - <fdt_addr_r>
```

如果使用 FIT、`ext4load`、SPI-NOR 或网络启动，应记录对应的签名/校验、分区、地址和失败行为。不要把 U-Boot 的 `fatload` 成功当作文件系统、DMA 或内核块设备已经通过；内核仍需在自己的驱动层完成设备初始化和读写错误传播。

### 维度 3：外设驱动适配

真实硬件的外设可能与 QEMU 不同：

- **UART**：可能是 16550A、SiFive UART 或其他型号。MMIO 地址和寄存器布局可能不同。
- **中断控制器**：可能是 PLIC 的变体，也可能是 AIA（Advanced Interrupt Architecture）。
- **定时器**：`mtime`/`mtimecmp` 的地址通过设备树获取。
- **磁盘**：可能是 NVMe、SD 卡控制器或其他。

你需要回答的问题：
- 你的 HAL 层抽象得够不够？移植时是不是只需更换底层驱动？
- 哪些外设在你的目标硬件上与 QEMU 相同，哪些不同？不同的部分打算怎么适配？

### 维度 3 续：真实运行所需的外设基线

“能从 U-Boot 跳进内核”只证明加载链路，不证明操作系统能运行。按项目声明的启动和 workload，至少把以下外设纳入平台移植清单：

| 外设边界 | QEMU 中容易被掩盖的假设 | 真实板卡的最小实现/验证 |
| --- | --- | --- |
| 时钟、复位、电源、pinmux | 设备创建时已处于可用状态 | 为 UART、timer、IRQ、SDIO/SPI 分别确认时钟源、门控、reset deassert、regulator 和引脚复用 |
| UART/控制台 | 固定 MMIO 和预设波特率 | 轮询发送一个字符，再验证接收、FIFO、错误位和冷/暖复位；电平必须匹配 |
| timer/IRQ/IPI | 虚拟计数器和 PLIC 路由稳定 | 读取实际频率，配置比较器，验证 claim/complete、屏蔽、每核 tick 和 IPI |
| GPIO/LED/按键 | 通常不是启动必需，QEMU 也不呈现引脚复用 | 用 GPIO 作为无串口时的阶段码；记录 bank、pin、极性、pull 和 debounce |
| SD host/SDIO/eMMC | virtio 队列不需要卡初始化或 pinmux | 供电、卡检测、1/4/8 bit、CRC、busy、分区和 DMA/缓存所有权 |
| SPI 控制器与从设备 | `ssi`/虚拟 flash 不体现真实 CS 和时序 | CPOL/CPHA、频率、CS 保持、半/全双工、FIFO/DMA、从设备 ID 与忙状态 |
| watchdog/热复位 | QEMU 通常不在超时后切断系统 | 明确禁用/喂狗策略，并验证 watchdog 复位后的启动原因 |
| 网络/USB（若 workload 需要） | QEMU 设备枚举和时序较理想 | PHY reset/link、DMA、缓存同步、枚举重试和拔插错误 |

#### SDIO/SD host：不要把 virtio-blk 当作存储移植证据

“SDIO”在不同手册里可能指原生 SD host（CMD/CLK/DAT0–3，用于 SD 卡/eMMC），也可能指多功能 SDIO 设备（例如 Wi-Fi 模块）。在 Spec 中写清是哪一种；两者都不能直接套用 virtio 的队列语义。

原生 SD host 的最小 bring-up 顺序是：

1. 根据原理图确认 3.3 V/1.8 V 电源、上拉、电平转换、卡检测和 `CLK/CMD/DAT0..3` 的 pinmux；上电前检查反接和最大电流。
2. 解除 reset、配置时钟，先以初始化允许的低频率发送 `CMD0`、`CMD8`、`ACMD41`，读取 OCR/CID/RCA，再切换总线宽度和高速模式。
3. 对每条命令验证 response 类型、CRC、timeout、busy 和卡拔出；不要用“读到全 0 或全 `0xff`”代替错误返回。
4. 先用 PIO 做单块读写回环，再接入 DMA。DMA 前后明确 buffer 的物理地址、对齐、ownership、cache clean/invalidate 和内存屏障。
5. 识别 MBR/GPT 和文件系统分区；分区发现由平台/块设备层完成，文件系统只接受稳定的块号和持久化语义。

如果 U-Boot 已能从 `mmc` 加载内核，仍要单独验证内核的 SD host：U-Boot 成功可能只是另一份驱动或另一种总线宽度在工作。SDIO 多功能设备还要增加 function 数量、CCCR/FBR、IRQ、块大小和 function enable 的证据。

#### SPI：先验证时序，再验证协议和存储

SPI 没有 ACK/NACK，CS、模式和忙状态错误时经常只得到“看似合法”的字节。真实板卡至少完成：

- 确认 `SCLK/MOSI/MISO/CS` 电平、极性、片选是否由控制器或 GPIO 管理，以及 CS 在一条命令和数据阶段之间是否必须保持有效；
- 用从设备 JEDEC ID/WHO_AM_I 做固定探针，逐一验证 Mode 0–3、最大频率、FIFO 阈值和片选切换；
- 对 SPI-NOR 实现 `READ ID`、`READ STATUS`、`WRITE ENABLE`、页写、扇区擦除和 busy 轮询；对 SPI-SD 实现低速初始化、命令帧、数据 token、块读写和 CRC/超时；
- DMA 只在 PIO 回环通过后启用，并记录 TX/RX 缓冲区、cache 维护和半双工切换；失败必须返回错误，不能把旧 FIFO 内容交给文件系统；
- 将 SPI 控制器、片选和从设备协议分开：通用块设备只看 `read/write/flush`，协议驱动管理命令，平台 HAL 管理时钟、pinmux、DMA 和 reset。

SDIO/SPI 的验收至少包括：冷启动、暖复位、连续块读写、边界块、设备忙、CRC/超时、拔卡或断开（若可操作）以及 QEMU 回归。每项都保留原始串口记录和失败原因。

### 维度 4：调试真实硬件

调试真实硬件比 QEMU 困难得多：

- **串口**：最可靠的调试手段。确保内核在移植的最早阶段就能往串口输出。
- **JTAG/OpenOCD**：要做硬件级调试，就得有 JTAG 调试器和 OpenOCD 配置。
- **LED**：如果有可编程 LED，用 LED 闪烁当最基本的"心跳"信号。

### 维度 5：多架构移植路线图

移植不该是"从 QEMU 一下跳到真实芯片"，中间有多个过渡站。下面三条路线覆盖三大主流 ISA：

#### 路线 A：RISC-V 64 真实硬件

**第一站：QEMU `sifive_u`（SiFive Unleashed 模拟）**
这是从 QEMU `virt` 到真实 RISC-V 硬件的中间站。`sifive_u` 模拟了一台带 SiFive UART、PLIC 和 PRCI（电源/时钟管理）的机器。这些外设在真实 SiFive 芯片上存在，但与 `virt` 的 16550A UART 完全不同。

关键差异：
- UART 从 16550A (MMIO `0x10000000`) 变为 SiFive UART (`0x10010000`，不同的寄存器布局)
- 中断控制器仍是 PLIC，但基地址和 IRQ 编号不同
- 需要 PRCI 来配置时钟，`virt` 上这一步由 OpenSBI 代劳了

**第二站：SiFive HiFive Unmatched（真实板卡）**
- CPU: SiFive FU740 (4×U74 + 1×S7)
- RAM: 16 GB DDR4，起始地址 `0x80000000`（与 QEMU `virt` 一致，是个好消息）
- 启动: ZSBL → FSBL (OpenSBI) → U-Boot → 你的内核
- 关键外设：SiFive UART、PLIC、CLINT、SD 卡控制器
- 你需要做的事：把内核镜像放到 SD 卡上、配置 U-Boot 自动加载

**第三站：StarFive VisionFive 2（课程默认参考板卡；具体以 Lab 1 选定的 canonical board 为准）**
- CPU: JH7110 (4×SiFive U74)
- RAM: 2/4/8 GB LPDDR4
- 启动: 比 HiFive 复杂，得先搞懂专有的 boot ROM 流程
- 文档：不如 SiFive 完善，社区驱动为主

#### 路线 B：x86-64 真实 PC

**第一站：QEMU `q35` + UEFI（模拟现代 PC）**
从 `-machine virt` 换到 `-machine q35` 并加上 OVMF（UEFI 固件），模拟一台现代 PC。这一步检验你的内核能不能在 UEFI 环境下启动。

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
- 独特挑战：Pi 的 UART 是 PL011（不是 16550A）；中断控制器是 BCM 专有的 GIC 实现；物理地址空间从 `0x0` 起始，与 QEMU `virt` 的 `0x80000000` 完全不同（低地址通常还被 VPU 固件占用）

### 维度 6：移植时的 HAL 重构策略

如果你的 HAL 一开始就设计成"一层薄薄的宏定义"（如 `#define UART0_BASE 0x10000000`），移植时改动就能最小化：

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

如果你已经不幸走了"坏的做法"那条路（教学 OS 里很常见），阶段 9 就是你的重构机会：把所有硬编码地址收敛到 `platform.h` 集中管理。

## 9.3 规格要求

### GoalSpec（必做）

硬件移植的 GoalSpec 需要写明：

- `objective`：真实硬件上的目标，例如启动、输出 banner、运行用户程序；
- `metric`：可度量的完成条件；
- `oracle`：真实硬件串口日志或 workload 结果；
- `correctness`：QEMU 回归仍通过、移植不破坏已有功能等底线。

同时在 `hardware_port` 中写明 U-Boot/SPL/固件交接、镜像格式与加载地址、DTB 来源、实际使用的存储总线（SDIO/eMMC/SPI-NOR/SPI-SD）以及尚未实现的外设。若 U-Boot 负责加载而内核尚未实现同一存储设备，必须明确标注“仅启动介质验证”，不能把它写成内核块设备已通过。

Hardware Runner 只记录板卡、构建身份、串口和 workload evidence，本地结果始终保持 `pending_human_review`。

### 设计理由（建议）

记录硬件适配的关键决策：设备树解析策略、驱动替换方式、HAL 层修改。

### 移植报告（建议）

记录移植过程中的关键发现：
- 真实硬件与 QEMU 的差异清单
- 遇到的调试困难和解决方法
- 哪些设计假设被真实硬件打破

## 9.4 质量门禁

- [ ] 真实硬件上内核启动并输出 banner
- [ ] 至少串口可正常工作（中断驱动或轮询）
- [ ] U-Boot/SPL 的版本、配置、DTB、加载命令和内核入口交接可复现
- [ ] 时钟/复位/pinmux、timer/IRQ 及项目所需的 SDIO/eMMC/SPI/网络外设均有独立验证；若不在范围内写明原因
- [ ] 内核自己的存储驱动完成读写、超时、DMA/cache 和错误传播验证，不能只引用 U-Boot 的 `mmc`/`fatload`
- [ ] QEMU 版本继续正常运行（移植未破坏已有功能）
- [ ] GoalSpec 通过

## 9.5 常见陷阱

1. **硬编码地址**：在 QEMU 中硬编码 `0x10000000` 作为 UART 地址，但真实硬件的 UART 在其他地址。
2. **启动链假设**：假设固件已经初始化了所有设备。在真实硬件上，固件可能只做了最小初始化。
3. **时钟频率差异**：真实硬件的时钟频率可能与 QEMU 不同，影响定时器和 UART 波特率。
4. **UART 没有输出（STM32 开发者最常见的盲区）**：如果你习惯了 STM32 上"配好 GPIO 时钟、设置波特率、写 DR 寄存器就有输出"的流程，真实板卡的 UART 调试会很快让人挫败。在 RISC-V 和 ARM 开发板上，UART 可能通过 FTDI 芯片连到 USB，波特率也不一定是 115200（有时是 921600 甚至 3 Mbps），还可能要把 TTL-USB 转换器接到特定 GPIO 引脚。**排查步骤：先用逻辑分析仪或示波器看 TX 引脚有没有信号。有信号，就是波特率或电压的问题；没信号，说明 UART 驱动根本没在发数据。**
5. **SD 卡启动（Fat32 分区和文件名大小写）**：U-Boot 加载内核镜像时对文件名大小写敏感（和 Windows 不同），`kernel8.img` 和 `KERNEL8.IMG` 是两个不同的文件。SD 卡分区表必须是 MBR（不能是 GPT），第一个分区必须是 FAT32 且标记为 active/bootable。**排查：在 U-Boot 命令行里手动 `fatls mmc 0:1` 确认文件可见，且名称精确匹配。**
6. **Raspberry Pi 的 config.txt 黑魔法**：Pi 的 GPU 先于 ARM CPU 启动，读取 `config.txt`。如果内核要用 UART 输出调试，必须在 `config.txt` 里显式设置 `enable_uart=1` 和 `uart_2ndstage=1`，否则 GPU 固件可能禁用 UART，或者把 UART 配置给蓝牙用。这是 Pi 平台上"串口为什么没输出"最常见的原因。
7. **JTAG 连接不稳定（调试器比内核还难搞）**：OpenOCD 的配置文件对开发板型号、调试器型号、JTAG 接口速度都很敏感。`adapter speed 1000` 可能太高（连接不稳定），也可能太低（调试响应慢）。**建议：先在已知良好的配置上验证 JTAG 链（让 OpenOCD 输出 "Examined RISC-V core"），再加载你的内核。**
8. **U-Boot 能启动、内核不能读盘**：U-Boot 的 `mmc`/`fatload` 只证明 U-Boot 自己的 host 驱动和分区读取路径。内核可能仍缺少 pinmux、卡初始化、DMA/cache 维护或 IRQ 完成路径。分别记录 U-Boot 和内核的设备枚举、块读写及错误证据。
9. **SDIO/SPI 读到旧数据**：DMA buffer 未按设备要求对齐，或者只做了 CPU cache clean 没有 invalidate（或反之）。先关闭 DMA 用 PIO 建立回环，再按 SoC 手册补齐 ownership、屏障和 cache 操作；禁止用固定延时替代 busy/完成位。
10. **SPI 偶发全 `0xff` 或首字节丢失**：常见根因是 CS 提前释放、CPHA 不匹配、频率超过从设备上限或 FIFO 清理顺序错误。用逻辑分析仪同时记录 CS/SCLK/MOSI/MISO，并把一次失败事务的原始字节流留在报告中。
11. **设备树看起来正确但外设不动**：`compatible` 节点存在不代表 clock、reset、pinctrl、regulator、DMA 和 IRQ 都已启用。逐项核对 provider 节点和实际寄存器读写，缺失依赖时直接失败并报告来源。

## 9.6 移植检查清单（自学者版）

在宣称"移植完成"之前，按以下清单逐项确认：

- [ ] 内核在真实硬件上成功输出 banner
- [ ] UART 可以正常收发（中断驱动模式）
- [ ] 时钟中断正常触发（验证 tick 计数递增）
- [ ] 一个最小用户程序（hello）可以运行并输出
- [ ] U-Boot/SPL → 固件 → 内核的加载地址、DTB 和入口寄存器已记录
- [ ] 项目声明的真实存储路径（SDIO/eMMC/SPI-NOR/SPI-SD）完成 PIO 回环、DMA/cache、超时和分区发现验证
- [ ] GPIO/LED 或 JTAG 至少提供一种无串口阶段信号；watchdog/网络等范围外外设已在 Spec 中说明
- [ ] QEMU 版本继续正常运行（移植未退化）
- [ ] 所有硬编码地址已收敛到 platform 头文件
- [ ] 真实硬件上运行 1 小时不加 watchdog 不崩溃

## 9.7 ⚡ 挑战：JTAG 调试、真实硬件性能测量

### 挑战 A：通过 JTAG/OpenOCD 调试真实硬件

当你的 OS 在真实硬件上崩溃时，串口输出可能靠不住（UART 缓冲区可能还没来得及刷新）。JTAG 是"最后的手段"：它在 CPU 级别暂停执行，让你检查寄存器、内存和断点。

**基本 JTAG 调试流程**：
1. 连接 JTAG 调试器（如 FT2232H 或 CMSIS-DAP）到开发板的 JTAG 接口
2. 启动 OpenOCD，连接到目标芯片
3. 用 GDB 通过 OpenOCD 连接到目标：`target remote localhost:3333`
4. 设硬件断点（`hbreak`），别用软件断点。软件断点要改写内存里的指令，在 ROM/flash 里做不到
5. 在崩溃 handler 中放置无限循环，用 JTAG 附加后检查寄存器和栈回溯

**教学价值**：经历一次"串口输出只有半行然后系统静默挂死，最后靠 JTAG 定位到根因"的调试过程，你会对"什么是可调试性"有完全不同的理解。

### 挑战 B：真实硬件上的中断延迟测量

QEMU 里的中断延迟是理想化的，真实硬件上则要算上这几项：
- 中断控制器的传播延迟
- CPU 流水线排空
- 缓存未命中的影响

**测量方法**：
1. 配置一个 GPIO 输出引脚在进入 ISR 的第一条指令时翻转电平
2. 用逻辑分析仪或示波器测量"GPIO 触发中断"到"GPIO 响应翻转"的时间差
3. 在不同的 CPU 负载下重复测量（空闲 vs 满负荷 vs cache thrashing）

**与阶段 8 的关联**：如果你选了 O1（实时性），这是你的 benchmark 的最终验证。最终的数字要在真实硬件上用示波器探头测出来，光在 QEMU 上跑基准还不够。

### 挑战 C：在真实硬件上验证阶段 8 的 USB/PCI 驱动

真实硬件上的 USB 控制器可能与 QEMU 的模拟版本不同：
- QEMU 模拟的是 xHCI 1.0 的理想化子集；真实 xHCI 控制器可能有未文档化的 quirks
- USB 设备的枚举时序在真实硬件上更严格：SET_ADDRESS 之后必须等设备完成复位
- 真实 USB 键盘的 HID 报告描述符可能比 QEMU 模拟的更复杂

如果你在阶段 8 选了 USB 或 PCI 方向，阶段 9 就把驱动移植到真实硬件试试。这是对你 HAL 设计质量的最终考验。

## 参考卡：板卡连接、启动与移植证据

固定 canonical board 后，连接清单至少包括供电/数据 USB、串口电平与参数、调试器/JTAG、启动介质、启动模式、网络和防反接检查。先按板卡手册、SoC 手册、原理图和固件文档核对，再在 Linux 上记录设备发现、权限、启动观察、断连恢复和完整串口标记；Windows/macOS/WSL 只补充平台差异，不替代同一验证链。

硬件移植的目标是替换平台实现而不是复制整个内核。报告同时给出板卡身份、镜像/构建身份、启动控制台、U-Boot 交接、SDIO/SPI 等真实外设结果、QEMU 对照、人工复核边界和未抽象的假设；JTAG/GDB 观察应与串口和故障分析互相印证。若某个外设只在 U-Boot 中工作，报告必须把它放在“启动链已验证、内核驱动未验证”一栏。

存储驱动的块设备边界见[第 6 章的真实板卡存储卡](ch06-filesystem.md#维度-8a真实板卡的-sdiospi-存储-bring-up)和 [Lab 6 步骤 2a](../labs/lab6-filesystem.md#步骤-2a把-qemu-virtio-blk-换成真实-sdiospi)；启动交接的最小字段见[第 2 章 U-Boot 路径](ch02-boot.md#u-boot-路径加载成功不等于内核硬件已就绪)。
