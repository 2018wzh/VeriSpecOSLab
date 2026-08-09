# Lab 9：真实硬件移植——走出模拟器

> 对应教材：[第 9 章：硬件移植](../book/ch09-hardware-port.md)

本 Lab 恢复板卡调研、启动链、内存图、串口、中断和 QEMU 回归，而不是只运行一次 `vos run hardware`。

## 1. 设计问题

- canonical board 的 SoC、ISA、启动介质和固件链是什么？
- 镜像由 ROM、SPL、U-Boot/UEFI 还是调试器加载？入口状态是什么？
- RAM、Flash、UART、中断控制器和定时器地址来自哪里？
- QEMU 与板卡共享哪些代码，平台差异放在哪一层？
- 没有串口输出时，如何借助 LED、调试器或最小探针定位阶段？

## 2. 移植顺序

1. 收集 SoC/板卡手册、启动日志、设备树和已知可启动镜像，记录版本与哈希。
2. 先运行供应商或开源最小样例，确认烧录、复位和串口链路。
3. 适配链接地址、入口状态和 UART，只输出单字符里程碑。
4. 适配内存发现、定时器和中断控制器。
5. 恢复 allocator、trap、用户态和文件系统，逐层运行回归。
6. 保持 QEMU 配置可运行，平台公共逻辑不得复制成两套失控实现。

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

硬件运行继承当前用户和网络，不是安全沙箱。开发态允许脏树，但权威硬件 evidence 必须绑定 clean HEAD。运行结果保持 `pending_human_review`，工具不能把串口出现 banner 自动写成已通过人工验收。

## 4. 验证门禁

- [ ] 板卡身份、SoC revision、固件版本和连接方式已记录。
- [ ] 内核从定义的启动介质进入，并输出分阶段串口标记。
- [ ] RAM 范围、定时器频率和中断控制器与手册/设备树一致。
- [ ] 串口收发、时钟中断和至少一个 workload 在板卡运行。
- [ ] QEMU 的全部既有公开门禁继续通过。
- [ ] hardware evidence 绑定 commit/spec/config/build hashes 和完整串口日志。
- [ ] 人工验收状态仍为 `pending_human_review`，等待教师确认。

## 5. 设计理据与提交物

解释板卡选择、平台抽象边界、启动方案和已接受限制。提交 DesignSpec 更新、平台 ModuleSpec/InterfaceSpec、必要 SpecPatch、构建与运行投影、板卡运行日志、QEMU 回归证据和移植报告。

## 6. 常见错误

### UART 完全无输出

先用启动固件日志确认镜像已加载，再用调试器/LED 标记区分“未到入口、链接地址错、栈不可用、UART 配置错”。不要同时修改入口、链接脚本和 UART。

### QEMU 正常，板卡定时器不触发

核对时钟源频率、分频、目标核心、中断控制器路由和固件占用。记录计数器实际增长率，不要照抄 QEMU 频率。

### 运行一次后无法再次启动

检查缓存、外设复位、持久化状态和烧录区域。硬件 reset 不一定等价于断电冷启动。
