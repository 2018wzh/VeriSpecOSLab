# Lab 9：真实硬件移植——走出模拟器

> **对应教材**：[第 9 章：硬件移植](../book/ch09-hardware-port.md)

> **本 Lab 概览**
>
> - **学完能做什么**：把内核从 QEMU 移植到 canonical board，能独立完成板卡调研、启动链适配、串口与定时器移植，并保持 QEMU 回归全部通过。
> - **预计耗时**：10–16 小时，建议安排 1–2 周（不含等待硬件的时间）。板卡调研与最小样例约占一半，逐层移植与回归占另一半。
> - **前置依赖**：已完成 Lab 8（系统功能完整），阅读第 9 章与板卡手册。若没有板卡，本 Lab 可只做调研与移植计划。
> - **产出物**：DesignSpec 更新、平台 ModuleSpec/InterfaceSpec、必要 SpecPatch、构建与运行投影、板卡运行日志、QEMU 回归证据和移植报告。

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

DesignSpec 的 `hardware_port` 固定 canonical board、启动、串口和中断约定。板级实现归相应平台 ModuleSpec；公开的驱动边界使用 InterfaceSpec。`vos.yaml` hardware runner 使用结构化 `program + args + cwd + env + timeout`，记录 board、serial、workload、build target 和 artifacts。

```sh
vos build
vos run qemu
vos run hardware
```

硬件运行继承当前用户和网络，不是安全沙箱。开发态允许脏树，但权威硬件 evidence 必须绑定 clean HEAD。运行结果保持 `pending_human_review`，工具不能把串口出现 banner 自动写成已通过人工验收。Hardware evidence 记录 board 标识、commit、串口日志和 workload，本地启动记录不能写成已通过人工验收。

> **参考标签**：当前参考标签是 `course/lab9-candidate`。QEMU、FDT/GPT/SD 单元测试、FIT/镜像检查或模拟串口都不能替代实板门禁；只有在 VisionFive 2 上完成四核完整 `usertests` 并经人工复核后，才允许发布 complete 标签。

## 4. 质量门禁

- [ ] 板卡身份、SoC revision、固件版本和连接方式已记录。
- [ ] 内核从定义的启动介质进入，并输出分阶段串口标记。
- [ ] RAM 范围、定时器频率和中断控制器与手册/设备树一致。
- [ ] 串口收发、时钟中断和至少一个 workload 在板卡运行。
- [ ] QEMU 的全部既有公开门禁继续通过。
- [ ] hardware evidence 绑定 commit/spec/config/build hashes 和完整串口日志。
- [ ] 人工验收状态仍为 `pending_human_review`，等待教师确认。

## 5. 设计理据

解释板卡选择、平台抽象边界、启动方案和已接受限制。每个选择都要能回答：如果换一块板卡，哪些代码必须重写、哪些可以复用？

## 6. AI 使用边界

Agent 可以解释板卡手册、生成设备树对比和整理串口日志。学生必须亲自完成烧录、接线与硬件验收判断。不能让 Agent 把 QEMU 运行结果改写成板卡证据，也不能让 `vos run hardware` 的输出自动通过人工验收。

## 7. 提交物

- [ ] DesignSpec 更新；
- [ ] 平台 ModuleSpec/InterfaceSpec；
- [ ] 必要 SpecPatch；
- [ ] 构建与运行投影（`vos.yaml`）；
- [ ] 板卡运行日志；
- [ ] QEMU 回归证据；
- [ ] 移植报告（含调研记录表）。

## 8. 常见问题与排查

### UART 完全无输出

先用启动固件日志确认镜像已加载，再用调试器/LED 标记区分"未到入口、链接地址错、栈不可用、UART 配置错"。不要同时修改入口、链接脚本和 UART。

### QEMU 正常，板卡定时器不触发

核对时钟源频率、分频、目标核心、中断控制器路由和固件占用。记录计数器实际增长率，不要照抄 QEMU 频率。

### 运行一次后无法再次启动

检查缓存、外设复位、持久化状态和烧录区域。硬件 reset 不一定等价于断电冷启动。

## 9. 背景阅读

- [Book 第 9 章：硬件移植](../book/ch09-hardware-port.md)：移植流程与常见硬件陷阱。
- [RISC-V 参考](../appendices/riscv-reference.md)、[x86-64 启动参考](../appendices/x86-boot-reference.md)、[ARM 启动参考](../appendices/arm-boot-reference.md)：按所选板卡阅读。
- [QEMU 指南](../appendices/qemu-guide.md)：QEMU 与板卡的行为差异。
- [调试方法论](../appendices/debugging-methodology.md)：无串口时的定位手段。
- [ModuleSpec](../specs/module-spec.md) 与 [InterfaceSpec](../specs/overview.md)：模块与接口契约写法。
