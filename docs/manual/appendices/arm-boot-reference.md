# ARM (AArch64) 启动参考

本文档提供 ARM 64-bit (AArch64) 平台的内核启动约定参考，用于填写 Lab 2 的 ToolchainSpec 和 OperationContract 中的平台特定字段。

## 启动路径概览

AArch64 平台主要有两条启动路径：

| 路径 | 入口特权级 | 固件信息传递 |
|------|:--------:|-------------|
| **TrustedFirmware-A (TF-A) → kernel** | EL1 | 设备树 (DTB) 地址通过 `x0` 传递 |
| **U-Boot → kernel** | EL2 或 EL1 | 设备树 (DTB) 地址通过 `x0` 传递；Linux kernel image header |

## TrustedFirmware-A / U-Boot 入口约定

### 入口状态

| 项目 | 值 |
|------|-----|
| CPU 模式 | AArch64 (64-bit) |
| 当前异常级别 | EL2 或 EL1（取决于 firmware 配置） |
| `x0` | 设备树 Blob (DTB) 的物理地址 |
| `x1` | 保留（通常为 0） |
| `x2` | 保留（通常为 0） |
| `x3` | 保留（通常为 0） |
| MMU | 通常已禁用（firmware 可能启用 identity mapping 并随后禁用） |
| 缓存 | 状态不确定——启动时需显式管理 |
| 中断 | 通常已屏蔽（`PSTATE.{I,F}` = {1,1}） |
| 栈 | 未设置——入口第一件事设置栈指针 |

### 异常级别说明

ARM 定义了四个异常级别（EL0-EL3，数字越大特权越高）：

| 级别 | 典型用途 |
|------|---------|
| EL3 | Secure Monitor（TrustedFirmware-A） |
| EL2 | Hypervisor |
| EL1 | 操作系统内核 |
| EL0 | 用户程序 |

启动时，固件通常在 EL3 初始化后将 CPU 降到 EL2 或 EL1 再跳转到内核。

如果你的内核进入时在 EL2，可以：
- (A) 留在 EL2 运行（简单，但失去 EL1 的一些特性）
- (B) 降到 EL1（标准做法，通过设置 `SCR_EL3` 和 `HCR_EL2` 后执行 `eret`）

### 单核 vs 多核启动

ARM 多核启动遵循主从模式：

| 项目 | 说明 |
|------|------|
| 启动核心 | CPU0（主核心） |
| 非启动核心 | 通常处于休眠状态（由 PSCI `CPU_ON` 唤醒） |
| 核心 ID 获取 | 读 `MPIDR_EL1` 寄存器（`aff0` 字段为核心 ID） |
| 非启动核心自旋 | `wfe` (Wait For Event) 指令 |

### ToolchainSpec 对应值

```yaml
# link.yaml
link:
  entry_symbol: "_start"
  section_rules:
    - "text 段位于 0x40000000 (QEMU virt RAM 基地址) 或 Linux kernel header 后的偏移"
    - "可选：添加 Linux kernel image header（若需 U-Boot booti 兼容）"
  relocation_model: static
  abi_constraints:
    - "aarch64 lp64"

# run.yaml (QEMU)
run:
  emulator: "qemu-system-aarch64"
  machine: "virt"
  cpu: "cortex-a57"              # 或 cortex-a53, cortex-a72
  memory: "128M"
  bios: "default"                # QEMU 内置最小固件
  kernel_arg: "-kernel"
  extra_args:
    - "-nographic"
    - "-no-reboot"
    - "-serial"
    - "mon:stdio"
```

### 输出通道

| 机制 | 描述 | 复杂度 |
|------|------|:------:|
| PL011 UART (MMIO) | QEMU `virt` 机器默认 UART，基地址 `0x09000000` | 低 |
| Semihosting | 通过 `hlt` 指令与调试器通信（仅 QEMU/debug 环境） | 低 |
| SMC 调用 | 通过 Secure Monitor Call 请求 EL3 固件输出 | 中 |

### 关机机制

| 机制 | 指令/方法 |
|------|----------|
| QEMU | `-device gpio-pwr` + 写 GPIO 寄存器 |
| PSCI `SYSTEM_OFF` | SMC 调用 `PSCI_SYSTEM_OFF` (函数 ID: `0x84000008`) |
| 无限循环 | `while(1) { asm("wfe"); }`（兜底） |

## 关键系统寄存器

AArch64 使用 `MSR`/`MRS` 指令访问系统寄存器：

| 寄存器 | 用途 |
|--------|------|
| `MPIDR_EL1` | 多处理器 ID（含核心 ID） |
| `SCTLR_EL1` | 系统控制（MMU、缓存使能） |
| `TTBR0_EL1` | 用户空间页表基地址 |
| `TTBR1_EL1` | 内核空间页表基地址 |
| `TCR_EL1` | 页表配置（粒度、地址空间大小） |
| `MAIR_EL1` | 内存属性（缓存策略） |
| `VBAR_EL1` | 异常向量表基地址 |
| `ESR_EL1` | 异常综合寄存器（原因） |
| `ELR_EL1` | 异常返回地址 |
| `SPSR_EL1` | 异常发生前的 PSTATE |

## 页表格式 (AArch64)

AArch64 使用 4 级页表（4 KiB 页）+ 可选的 3 级（16 KiB）或 2 级（64 KiB）粒度。

### 虚拟地址结构 (4 KiB 页, 48-bit VA)

```
| 47..........39 | 38..........30 | 29..........21 | 20..........12 | 11..........0 |
|    L0 index    |    L1 index    |    L2 index    |    L3 index    |    offset     |
      9 bits           9 bits           9 bits           9 bits          12 bits
```

### 页表描述符格式

```
| 47..........12 | 11..........2 | 1 | 0 |
|   Output Addr  |   Attribute   |   | V |
```

- Bit 0 (V): 有效位（0 = 无效，页错误）
- Bit 1: 0 = 块/页描述符，1 = 表描述符（指向下一级页表）
- Bits 2-11: 属性（UXN、PXN、AF、SH、AP、NS、AttrIndx）

## 参考资料

- [ARM Architecture Reference Manual (Armv8-A)](https://developer.arm.com/documentation/ddi0487/latest/)
- [ARM Trusted Firmware-A Documentation](https://trustedfirmware-a.readthedocs.io/)
- [QEMU ARM virt machine documentation](https://www.qemu.org/docs/master/system/arm/virt.html)
- [PSCI Specification](https://developer.arm.com/documentation/den0022/)
