# Lab 9：真实硬件移植——走出模拟器

> **对应教材**：[第 9 章：硬件移植](../book/ch09-hardware-port.md)

> **本 Lab 概览**
>
> - **学完能做什么**：把 QEMU 上验证过的内核搬到 canonical board，独立完成启动链、串口、定时器/中断和至少一个存储外设的板级验收，并保持 QEMU 回归；能在没有串口输出时用 LED、调试器或最小探针定位启动阶段。
> - **预计耗时**：20–40 小时，建议安排 1–2 周，视板卡难度浮动。板卡调研与启动链约占三分之一，外设 bring-up 约占三分之一，回归、证据与报告约占三分之一。
> - **前置依赖**：已完成 Lab 8（系统功能完整），使用 Lab 1 已确定的 canonical board，阅读第 9 章与板卡手册。
> - **产出物**：与实现一致的 DesignSpec/平台说明、必要的 ModuleSpec/InterfaceSpec/SpecPatch、板卡运行日志、QEMU 回归证据和移植报告。可以由任意 Coding Agent 协助或直接维护这些文件。
> - **评分构成**：质量门禁 70% + 设计理据 20% + 挑战/加分 10%（可选）。实际分值以教师公布为准；硬件验收需人工复核。
> - **实际耗时**：在提交物里记录本次 Lab 实际投入小时数（硬件阶段的弹性最大，这个数字对课程计划校准很重要）。

## 1. 设计问题

- canonical board 的 SoC、ISA、启动介质和固件链是什么？
- 镜像由 ROM、SPL、U-Boot/UEFI 还是调试器加载？入口状态是什么？
- RAM、Flash、UART、中断控制器和定时器地址来自哪里？
- QEMU 与板卡共享哪些代码，平台差异放在哪一层？
- 没有串口输出时，如何借助 LED、调试器或最小探针定位阶段？

本 Lab 的目标不是只运行一次 `vos run hardware`，而是完整走一遍板卡调研、启动链、内存图、串口、中断和 QEMU 回归。

> **参考实现**：本课程参考实现固定使用 StarFive VisionFive 2，由固定 BSP DTB、OpenSBI、U-Boot FIT、原生 SDIO 和按 GPT type GUID/`xv6fs` 名称发现的文件系统分区组成。未知 compatible、缺失 DT 节点或 SBI TIME/IPI/HSM/RFENCE/SRST 扩展必须直接失败；四个 U74 hart 通过 SBI HSM 有序启动。选择其它板卡时，同样要把板卡身份、启动链和验收边界固定下来。

### QEMU 对照基线：先证明“差异”，再开始移植

在第一次改板级代码前，冻结一份 QEMU 基线：机器型号、CPU/RAM 参数、内核镜像格式、启动参数、设备树、串口参数、构建身份、预期阶段标记和完整日志。随后在 `hardware_port` 中逐项填写下表；“QEMU 通过”与“板卡已验证”必须是两列独立状态。

| 边界 | QEMU 基线要记录什么 | 板卡移植要补什么证据 |
| --- | --- | --- |
| 启动 | `-kernel`/固件参数、入口和 hart | Boot ROM → SPL/TPL → OpenSBI/UEFI → U-Boot → 内核的阶段、镜像格式、加载/入口地址 |
| 内存 | RAM 起始/大小、DTB 或固定机器参数 | DDR training、保留区、DTB RAM 节点、cache/MMU 初始状态 |
| 控制台 | UART 模型、地址、时钟、波特率 | pinmux、时钟/复位、电平、USB-UART、冷/暖复位后的完整日志 |
| 中断/定时器 | PLIC/虚拟 timer、频率和 IRQ 编号 | SoC IRQ domain、timer 源、IPI、清除/确认和实际 tick 周期 |
| 存储 | virtio-blk 队列、host 镜像和分区 | SDIO/eMMC/SPI-NOR/SPI-SD 的供电、协议初始化、DMA/cache、卡检测和错误 |
| 复位/调试 | QEMU monitor/GDB 可随时附加 | watchdog、LED 阶段码、JTAG/OpenOCD 停止位置和寄存器快照 |

如果一项只在 QEMU 有值，标记为 `qemu_only`；如果 U-Boot 能加载但内核驱动没有读写证据，标记为 `bootloader_only`，两者都不能写入实板通过项。

### VOS QEMU 板级移植：先预检，再批准，再执行

本节是可选的 QEMU 源码移植路径；它不能替代本 Lab 的真实板卡验收。`vos run qemu` 仍用于运行你的内核回归，`vos agent qemu` 则用于把 canonical board 的机器/SoC 行为实现到固定版本的 QEMU 中。

#### 1. 准备 request 和材料

request 与材料按 [Lab 1 步骤 2a](../labs/lab1-seed.md) 的准备清单维护（本 Lab 不重复定义形状规则）：

```text
spec/qemu/<request-id>.yaml
references/qemu/<request-id>/
```

request 保持最小形状：`version: vos.qemu-port.v1`、唯一 `id`、`revision: 0`、`status: request`、`target.board`，以及 `qemu.version` 和 `qemu.source_path`。QEMU 源码路径必须是仓库相对路径、指向带 `VERSION` 文件的 Git worktree。材料目录放板卡/SoC 手册、原理图、设备树、已知固件/镜像和已验证启动日志；不要把 CTF、凭据或隐私报告复制进材料目录。

预检只信任这些学生材料中的硬件事实，不会从网络补齐缺失寄存器或板级连线。官方 TF-A/U-Boot 等软件依赖可以在后续执行阶段固定版本。目录为空时预检在调用 Agent 前失败；材料不足时返回缺口并保持 `candidate_created: false`。

#### 2. 运行只读预检

```sh
vos agent qemu preflight <QemuSpec ID|path>
```

预检会检查 request 是否和当前 clean HEAD 一致，盘点并哈希材料，核对 QEMU `VERSION`/commit，并要求只读 Agent 给出：真实 boot path、每个设备的复用分类、findings/blocker、分阶段实现计划、依赖和允许写入的 `owns` 路径。复用分类不能只看设备名、地址或 DT `compatible`；必须比较复位状态、寄存器行为、IRQ/DMA/clock wiring、guest-visible ID 和固件路径。成功后工具才写入 `spec/qemu/<request-id>.rN.yaml` candidate；失败只保留缺口和可恢复的 run。

#### 3. 审查 candidate 并批准

逐项审查 candidate 的 `boot_path`、bypass、`reuse_matrix`、findings、phases、dependencies 和 `implementation.owns`。任何跳过 BootROM/SPL、预加载 kernel/DTB 或简化固件服务，都要在 boot path 中写出原因和影响。确认 blocker 已有证据支持的 resolution 后，手工把 `status: candidate` 改为 `status: approved` 并提交：

```sh
vos spec lint spec/qemu/<request-id>.rN.yaml
git add spec/qemu/<request-id>.rN.yaml
git commit -m "[spec][qemu] Approve <request-id> revision"
```

candidate 是唯一允许 Agent 生成的 Spec 例外；没有学生批准和当前 HEAD 的普通 Git 提交，不能进入执行。

#### 4. 执行 QEMU 模型移植

```sh
vos agent qemu execute <approved QemuSpec ID|path>
```

执行重新核对 approved Spec、QEMU commit 和材料哈希，在 detached worktree 中按批准的 `owns` 路径构建、启动到 shell、运行邻居 QEMU 机器回归并提交变更。它不拥有 `spec/`、`vos.yaml`、`.vos/` 或 `references/qemu/`，也不会 push；成功后只落本地实现提交。若 Agent 被外部条件阻塞，先保存 blocker 和 `resume_steps`，不要修改日志冒充通过；在命令、HEAD、Spec hash 和 worktree 未漂移时才可执行：

```sh
vos agent qemu execute <approved QemuSpec ID|path> --resume <run-id>
```

QEMU port 的接受条件是 QEMU 构建、最小固件路径 boot-to-shell、邻居回归和结构化阶段证据全部可复现。它仍只产生 `qemu_only` 的模型证据，不能把真实板卡的电源、pinmux、UART 电平、U-Boot、SDIO/SPI、DMA/cache 或人工复核状态写成通过。

## 2. 移植顺序

1. 收集 SoC/板卡手册、启动日志、设备树和已知可启动镜像，记录版本与哈希。
2. 先运行供应商或开源最小样例，确认烧录、复位和串口链路。
3. 适配链接地址、入口状态和 UART，只输出单字符里程碑。
4. 适配内存发现、定时器和中断控制器。
5. 移植 allocator、trap、用户态和文件系统，逐层运行回归。
6. 保持 QEMU 配置可运行，平台公共逻辑不得复制成两套失控实现。

**自检点（每步）**：移植每层前，先确认上一层在板卡上仍正常；每完成一个里程碑，就在 QEMU 上重跑一遍对应回归。

调研记录至少回答：复位向量、镜像格式、加载地址、入口特权级、缓存/MMU 初始状态、核心启动方式、设备树位置、RAM 范围、UART 时钟、中断号和定时器频率。每个值标注来源页码、设备树节点或实测方法。

移植时使用分阶段里程碑：

```text
ENTRY → STACK → BSS → UART → MEMORY → TIMER → IRQ
→ USER → STORAGE → WORKLOAD
```

每次只推进一个里程碑，并保持前一阶段日志。这样 UART 失效后仍可用调试器判断是否到达入口，而不是把所有失败都归因于串口。

### 2.1 U-Boot 交接与板级移植

先确认课程板卡使用的 U-Boot 版本、`defconfig`、DTB 和 SPL/TPL 组成；不要把另一块板卡的 `bootcmd` 或固定地址直接复制过来。按以下顺序建立可回退的 bring-up 基线：

1. 用上游或课程指定配置构建 U-Boot，记录版本、交叉编译器、配置差异和产物身份；先让 U-Boot 输出版本、DRAM 大小和设备树地址。
2. 单独验证 U-Boot 的时钟/复位/pinmux、UART、DRAM、MMC/SDIO 或 SPI-NOR。设备探测不稳定时，停在 U-Boot，不要同时改内核。
3. 在命令行手动完成设备选择、重新扫描、分区/文件列举和镜像加载。以下是命令形状，设备号、分区号、文件名和地址必须以板卡资料为准：

   ```text
   => mmc list
   => mmc dev <dev> <part>
   => mmc rescan
   => fatls mmc <dev>:<part>
   => fatload mmc <dev>:<part> <kernel_addr_r> <kernel-file>
   => fatload mmc <dev>:<part> <fdt_addr_r> <dtb-file>
   => booti <kernel_addr_r> - <fdt_addr_r>
   ```

4. 记录 U-Boot 交给内核的入口特权级、hart、`a0/a1` 或等价寄存器、DTB 地址、`bootargs`、RAM 范围和固件服务。内核第一段代码把这些值打印成可比对的标记。
5. 将已验证的手动流程收敛为环境脚本或 FIT 配置，并保留一份不依赖环境变量的手动命令，方便环境损坏时恢复。任何签名/校验失败都应停止，不要自动回退到未知镜像。

U-Boot 成功执行 `fatload` 只证明启动介质的 bootloader 路径。Lab 9 还要运行内核自己的存储探针；若内核暂时不实现 SDIO/SPI，报告必须写明只完成 `bootloader_only`，不得把 U-Boot 结果当作文件系统或块设备验收。

### 2.2 真实外设 bring-up 顺序

按“依赖先于协议”的顺序推进，任何一步失败都保留原始日志和停机原因：

1. **时钟、复位、电源、pinmux**：为 UART、timer/IRQ、SDIO/SPI 分别确认 provider、门控、reset、regulator、电平和引脚复用。
2. **UART 与 GPIO/LED**：先用轮询发送单字符，再验证接收和错误位；没有串口时用 LED 阶段码标记 `ENTRY/STACK/BSS/UART`。
3. **timer、IRQ、IPI**：读取真实频率，验证比较器、claim/complete、屏蔽、每核 tick 和 IPI；不要用 QEMU 频率推导板卡超时。
4. **SDIO/eMMC 或 SPI 存储**：先 PIO 单块读写，再启用 DMA；记录卡检测/忙状态、分区发现、地址对齐和 cache clean/invalidate。
5. **watchdog、网络或 USB（只有项目 workload 需要时）**：验证复位原因、PHY/枚举、DMA 和拔插/链路错误；范围外设备在 Spec 中明确列出。

#### SDIO/SD host 最小验收

明确“SDIO”是原生 SD host（CMD/CLK/DAT0–3）还是多功能 SDIO 设备。原生 SD host 至少覆盖 3.3 V/1.8 V、上拉、卡检测、低速初始化（`CMD0`、`CMD8`、`ACMD41` 等）、RCA/总线宽度、高速切换、CRC、busy、timeout 和拔卡行为。多功能 SDIO 还要记录 CCCR/FBR、function enable、块大小和 IRQ。

PIO 通过后再接 DMA：提交前记录物理地址、对齐和 ownership，完成后执行平台要求的 cache invalidate/clean 与内存屏障。错误必须向块设备层返回，不能用全零或旧 buffer 继续运行。U-Boot 从 SD 读出内核不替代这张表。

#### SPI 控制器与从设备最小验收

先确认 `SCLK/MOSI/MISO/CS` 电平、CS 的控制者、CPOL/CPHA、最大频率、FIFO 阈值和半/全双工切换；再用 JEDEC ID/WHO_AM_I 做固定探针。SPI-NOR 至少测试 `READ ID`、状态寄存器、写使能、页写、扇区擦除和 busy 轮询；SPI-SD 至少测试低速初始化、命令帧、数据 token、单块读写、CRC/timeout。

CS 提前释放、频率过高或 FIFO 未清空会造成偶发的全 `0xff`/首字节丢失。用逻辑分析仪同时记录 CS/SCLK/MOSI/MISO；PIO 回环通过后才启用 DMA，并保留一次失败事务的字节流和根因。

## 3. 当前契约映射

DesignSpec 的 `hardware_port` 固定 canonical board、启动、串口和中断约定。板级实现归相应平台说明；驱动边界使用 InterfaceSpec 或项目已有的稳定 ABI。Lab 9 起可以使用任意 Coding Agent 直接维护这些文件，重点是最终内容与实现一致、实验结果可复核。

平台模块先从无答案骨架开始：

```yaml
id: TODO_PLATFORM_MODULE_ID
module: TODO_PLATFORM_MODULE_ID
level: 3
purpose: TODO
owns: [TODO_PLATFORM_PATH, TODO_PLATFORM_TEST_PATH]
interface: [TODO_PLATFORM_OPERATION]
properties: [TODO]
errors: [TODO]
state: { TODO_STATE: TODO }
preconditions: [TODO]
postconditions: [TODO]
invariants: [TODO]
dependencies: [TODO]
concurrency: { TODO_CONCURRENCY_FIELD: TODO }
rely: [TODO]
guarantee: [TODO]
algorithm_intent: TODO
```

```text
让 Coding Agent 读取当前实现、板卡手册和 Lab 1 的连接记录
→ 更新平台说明、必要的 Spec/SpecPatch 和实现
→ 审查 diff，运行项目已有的 build/test/QEMU 命令
→ 分阶段运行真实板卡并保留完整串口日志
→ 由学生整理 QEMU 回归、实板结果、失败分析和 HAL 影响
```

如果仍使用 VOS，可以运行 `vos build`、`vos run qemu`、`vos run hardware` 或 `vos spec lint` 作为辅助检查；这些命令从 Lab 9 起不再是课程流程门禁。

硬件运行继承当前用户和网络，不是安全沙箱。每次报告仍要记录 commit 或其他可定位的构建身份、板卡、串口日志和 workload；工具不能把串口出现 banner 自动写成已通过人工验收。运行结果保持 `pending_human_review`，由教师完成最终人工复核。

> **参考标签**：当前参考标签是 `course/lab9-candidate`。QEMU、FDT/GPT/SD 单元测试、FIT/镜像检查或模拟串口都不能替代实板门禁；只有在 VisionFive 2 上完成四核完整 `usertests` 并经人工复核后，才允许发布 complete 标签。

## 4. 质量门禁

- [ ] 板卡身份、SoC revision、固件版本和连接方式已记录。
- [ ] U-Boot/SPL 版本、配置、DTB、手动加载命令、镜像格式和内核入口交接可复现。
- [ ] 内核从定义的启动介质进入，并输出分阶段串口标记。
- [ ] RAM 范围、定时器频率和中断控制器与手册/设备树一致。
- [ ] 串口收发、时钟中断和至少一个 workload 在板卡运行。
- [ ] 项目声明的 SDIO/eMMC/SPI-NOR/SPI-SD 等真实存储路径完成 PIO 回环、DMA/cache、超时、分区发现和错误传播验证；只由 U-Boot 读取时明确标记为 `bootloader_only`。
- [ ] GPIO/LED 或 JTAG 至少提供一种无串口阶段信号；watchdog、网络、USB 等范围外外设已在 Spec 中说明。
- [ ] QEMU 的全部既有公开门禁继续通过。
- [ ] hardware evidence 绑定 commit、Spec/配置版本或其他可定位的构建身份和完整串口日志。
- [ ] 人工验收状态仍为 `pending_human_review`，等待教师确认。

## 5. 设计理据

解释板卡选择、平台抽象边界、启动方案和已接受限制。每个选择都要能回答：如果换一块板卡，哪些代码必须重写、哪些可以复用？

## 6. Coding Agent 与 HAL

可以直接使用任意 Coding Agent 解释板卡手册、生成设备树对比、修改平台实现和整理测试。学生必须亲自完成烧录、接线、复位与硬件验收判断，审查 Agent 的 diff，并在报告中披露使用的工具和任务范围。不能让 Agent 把 QEMU 运行结果改写成板卡证据，也不能让串口 banner 自动通过人工验收。

本 Lab 的核心 HAL 检查是“替换平台实现而不复制核心逻辑”：UART、定时器、IRQ、设备发现、DMA 和缓存约束应有清晰来源与边界；如果仍保留硬编码，说明它属于哪个平台、为什么暂时合理、未来替换点在哪里。

## 7. 提交物

- [ ] 与实现一致的 DesignSpec 更新；
- [ ] 平台 ModuleSpec/InterfaceSpec 或等价的平台契约；
- [ ] 必要 SpecPatch；
- [ ] 板卡运行日志和失败分析；
- [ ] U-Boot/SPL → 固件 → 内核的启动交接记录，以及 QEMU/板卡差异矩阵；
- [ ] SDIO/SPI 等真实外设的探针、读写回环、DMA/cache 和故障证据；
- [ ] QEMU 回归证据；
- [ ] 移植报告（含调研记录表）；
- [ ] 实际耗时（一个整数小时数）；
- [ ] Coding Agent 使用披露和学生 diff/测试复核说明。

## 7a. 最小成功输出样例

板卡串口日志应展示完整的启动交接链。示例（阶段标记以你的固件链为准）：

```text
BootROM: load SPL from eMMC ... OK
U-Boot SPL: DDR training ok, jump to U-Boot
U-Boot 2023.04: booti 0x40200000 - 0x40800000
[0] kernel boot: entry=0x40200000
[0] boot banner: XV6_BOOT_OK
[0] timer irq ok (sbi timer)
[0] mmc read ok: 1 block @ 0x1000
```

对照门禁：

- 从 BootROM/SPL 到内核入口的每个阶段都有日志或可观察标记（对应"启动交接记录"）；
- `XV6_BOOT_OK` 与 QEMU 基线一致（对应"QEMU/板卡差异矩阵"中的共享部分）；
- 定时器与存储外设各有独立成功输出（对应"真实外设探针/读写回环"）；
- 同一份日志不能既当 QEMU 证据又当板卡证据；板卡证据保持 `pending_human_review`。

## 8. 常见问题与排查

### UART 完全无输出

先用启动固件日志确认镜像已加载，再用调试器/LED 标记区分"未到入口、链接地址错、栈不可用、UART 配置错"。不要同时修改入口、链接脚本和 UART。

### QEMU 正常，板卡定时器不触发

核对时钟源频率、分频、目标核心、中断控制器路由和固件占用。记录计数器实际增长率，不要照抄 QEMU 频率。

### 运行一次后无法再次启动

检查缓存、外设复位、持久化状态和烧录区域。硬件 reset 不一定等价于断电冷启动。

### U-Boot 能 `fatload`，内核却读不到存储

分别记录 U-Boot 和内核的设备枚举、pinmux/clock/reset、卡初始化、DMA 描述符和 cache 维护。`fatload` 只证明 U-Boot 的 host 驱动和分区路径，不能替代内核的 SDIO/SPI 块设备验证。

### SDIO 初始化卡在 busy 或 `ACMD41`

先回到低速、PIO 和 3.3 V 初始化，核对 CMD/DAT 上拉、电源稳定时间、response 类型、CRC 和 timeout。若使用多功能 SDIO，另查 CCCR/FBR、function enable、块大小和 IRQ；不要用固定延时吞掉 busy。

### SPI 读回全 `0xff` 或首字节错位

用逻辑分析仪同时观察 CS、SCLK、MOSI、MISO，逐项确认 CPOL/CPHA、最大频率、CS 保持和 FIFO 清空。先用 JEDEC ID/WHO_AM_I 和 PIO 回环建立基线，再启用 DMA；失败事务要记录原始字节流。

## 9. 参考卡

- [Book 第 9 章：硬件移植](../book/ch09-hardware-port.md)：移植流程与常见硬件陷阱。

按“入口、栈、BSS、UART、内存、定时器、IRQ、用户态、存储、workload”的顺序推进。QEMU 只证明模拟机器上的行为，不能替代板卡证据；设备树、固件传参、SD/eMMC 分区、UART 时钟和中断路由都要以当前板卡的手册、设备树或实测结果为来源。

U-Boot 负责加载并不等于内核驱动完成。真实存储至少分开记录原生 SDIO/SD host 或多功能 SDIO、SPI-NOR/SPI-SD 的协议初始化、PIO 回环、DMA/cache 一致性、超时/拔卡和分区发现；这些差异应由平台 HAL 和块设备边界承接，而不是散落在文件系统核心。

没有串口时，先用板载 LED、调试器断点、寄存器快照或最小探针区分“未到入口、链接地址错误、栈不可用、UART 配置错误”。GDB/OpenOCD 的命令只是手段，报告要保留停止位置、寄存器类别和下一步判断，不要只贴一张截图。

平台契约、InterfaceSpec 和 SpecPatch 的内容已经在本 Lab 的设计问题和提交物中展开。Coding Agent 可以直接维护它们，但仍需由学生审查平台边界和 HAL 影响。
