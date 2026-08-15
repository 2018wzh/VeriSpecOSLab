# Lab 9：真实硬件移植——走出模拟器

> **对应教材**：[第 9 章：硬件移植](../book/ch09-hardware-port.md)

> **本 Lab 概览**
>
> - **前置依赖**：已完成 Lab 8（系统功能完整），使用 Lab 1 已确定的 canonical board，阅读第 9 章与板卡手册。
> - **产出物**：与实现一致的 DesignSpec/平台说明、必要的 ModuleSpec/InterfaceSpec/SpecPatch、板卡运行日志、QEMU 回归证据和移植报告。可以由任意 Coding Agent 协助或直接维护这些文件。

## 1. 设计问题

- canonical board 的 SoC、ISA、启动介质和固件链是什么？
- 镜像由 ROM、SPL、U-Boot/UEFI 还是调试器加载？入口状态是什么？
- RAM、Flash、UART、中断控制器和定时器地址来自哪里？
- QEMU 与板卡共享哪些代码，平台差异放在哪一层？
- 没有串口输出时，如何借助 LED、调试器或最小探针定位阶段？

本 Lab 的目标不是只运行一次 `vos run hardware`，而是完整走一遍板卡调研、启动链、内存图、串口、中断和 QEMU 回归。

> **参考实现**：本课程参考实现固定使用 StarFive VisionFive 2，由固定 BSP DTB、OpenSBI、U-Boot FIT、原生 SDIO 和按 GPT type GUID/`xv6fs` 名称发现的文件系统分区组成。未知 compatible、缺失 DT 节点或 SBI TIME/IPI/HSM/RFENCE/SRST 扩展必须直接失败；四个 U74 hart 通过 SBI HSM 有序启动。选择其它板卡时，同样要把板卡身份、启动链和验收边界固定下来。

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
- [ ] 内核从定义的启动介质进入，并输出分阶段串口标记。
- [ ] RAM 范围、定时器频率和中断控制器与手册/设备树一致。
- [ ] 串口收发、时钟中断和至少一个 workload 在板卡运行。
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
- [ ] QEMU 回归证据；
- [ ] 移植报告（含调研记录表）；
- [ ] Coding Agent 使用披露和学生 diff/测试复核说明。

## 8. 常见问题与排查

### UART 完全无输出

先用启动固件日志确认镜像已加载，再用调试器/LED 标记区分"未到入口、链接地址错、栈不可用、UART 配置错"。不要同时修改入口、链接脚本和 UART。

### QEMU 正常，板卡定时器不触发

核对时钟源频率、分频、目标核心、中断控制器路由和固件占用。记录计数器实际增长率，不要照抄 QEMU 频率。

### 运行一次后无法再次启动

检查缓存、外设复位、持久化状态和烧录区域。硬件 reset 不一定等价于断电冷启动。

## 9. 参考卡

- [Book 第 9 章：硬件移植](../book/ch09-hardware-port.md)：移植流程与常见硬件陷阱。

按“入口、栈、BSS、UART、内存、定时器、IRQ、用户态、存储、workload”的顺序推进。QEMU 只证明模拟机器上的行为，不能替代板卡证据；设备树、固件传参、SD/eMMC 分区、UART 时钟和中断路由都要以当前板卡的手册、设备树或实测结果为来源。

没有串口时，先用板载 LED、调试器断点、寄存器快照或最小探针区分“未到入口、链接地址错误、栈不可用、UART 配置错误”。GDB/OpenOCD 的命令只是手段，报告要保留停止位置、寄存器类别和下一步判断，不要只贴一张截图。

平台契约、InterfaceSpec 和 SpecPatch 的内容已经在本 Lab 的设计问题和提交物中展开。Coding Agent 可以直接维护它们，但仍需由学生审查平台边界和 HAL 影响。
