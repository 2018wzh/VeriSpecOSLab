# RISC-V 参考

本文档汇总了 VeriSpecOSLab 涉及的 RISC-V 关键概念，供快速查阅。完整规范请参考 [RISC-V Privileged Specification](https://github.com/riscv/riscv-isa-manual/releases)。

## 特权级

RISC-V 定义了三个特权级（从高到低）：

| 级别 | 名称 | 典型用途 |
|------|------|---------|
| M-mode | Machine mode | 固件（OpenSBI）、最底层硬件控制 |
| S-mode | Supervisor mode | 操作系统内核 |
| U-mode | User mode | 用户程序 |

VeriSpecOSLab 中，学生内核运行在 S-mode（由 OpenSBI 从 M-mode 跳转进入），用户程序运行在 U-mode。

### 特权级切换

- **U → S**：ecall（syscall）、异常（page fault、illegal instruction）、中断
- **S → U**：sret 指令
- **M → S**：mret 指令（由固件处理，内核通常不直接操作）

## 关键 CSR（控制与状态寄存器）

###  Trap 相关

| CSR | 描述 |
|-----|------|
| `stvec` | S-mode trap 向量基地址 |
| `scause` | trap 原因（异常类型或中断号） |
| `stval` | trap 相关值（如出错的地址） |
| `sepc` | trap 发生时的 PC（返回地址） |
| `sscratch` | 内核临时寄存器（通常指向 trapframe） |
| `sstatus` | S-mode 状态（含 SPP：trap 前的特权级、SIE：中断使能） |
| `sie` | S-mode 中断使能寄存器 |
| `sip` | S-mode 中断挂起寄存器 |

### 内存管理相关

| CSR | 描述 |
|-----|------|
| `satp` | 页表基地址和地址转换模式（MODE=BARE 或 Sv39） |

### 关键 CSR 位的含义

`sstatus` 寄存器：

| 位 | 名称 | 含义 |
|----|------|------|
| 1 | SIE | S-mode 中断使能（0=禁用，1=启用） |
| 8 | SPP | trap 前的特权级（0=U-mode，1=S-mode） |
| 5 | SPIE | trap 前的 SIE 值 |

`scause` 寄存器：最高位表示中断（1）或异常（0）。

常见异常码：

| 码 | 含义 |
|----|------|
| 0 | 指令地址不对齐 |
| 2 | 非法指令 |
| 8 | 来自 U-mode 的 ecall |
| 12 | 指令页错误 |
| 13 | 加载页错误 |
| 15 | 存储/AMO 页错误 |

## Sv39 分页

Sv39 使用 3 级页表，每页 4 KiB。

### 虚拟地址结构

```
| 38..........30 | 29..........21 | 20..........12 | 11..........0 |
|      VPN[2]    |     VPN[1]     |     VPN[0]     |    offset     |
      9 bits           9 bits           9 bits          12 bits
```

### 页表项（PTE）格式

```
| 53...........10 | 9..8 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
|       PPN       | RSW  | D | A | G | U | X | W | R | V |
```

关键位：

| 位 | 名称 | 含义 |
|----|------|------|
| 0 | V | 有效位（0=无效，页错误） |
| 1 | R | 可读 |
| 2 | W | 可写 |
| 3 | X | 可执行 |
| 4 | U | 用户可访问（0=仅 S-mode） |
| 5 | G | 全局映射 |
| 6 | A | 已访问（由硬件设置，或在启用 Svade 时由页错误驱动软件更新） |
| 7 | D | 已修改（由硬件设置，或在启用 Svade 时由页错误驱动软件更新） |
| 8-9 | RSW | Supervisor 软件保留位，硬件忽略 |

### satp 寄存器格式（Sv39）

```
satp = (MODE << 60) | (ASID << 44) | PPN
MODE = 8 (Sv39)
```

### 地址转换

```
pa = walk(va)  # 3 级页表遍历
```

## 寄存器约定

### 调用约定

| 寄存器 | ABI 名称 | 用途 |
|--------|---------|------|
| x0 | zero | 恒为零 |
| x1 | ra | 返回地址 |
| x2 | sp | 栈指针 |
| x5 | t0 | 临时寄存器 |
| x10-x11 | a0-a1 | 函数参数/返回值 |
| x12-x17 | a2-a7 | 函数参数 |
| x8, x9, x18-x27 | s0-s11 | 被调用者保存 |

### Syscall 约定

- `a7`：syscall 编号
- `a0`：返回值
- `a0-a5`：syscall 参数

## 指令参考

| 指令 | 描述 |
|------|------|
| `ecall` | 触发环境调用（U→S 或 S→M） |
| `sret` | 从 S-mode trap 返回 |
| `sfence.vma` | 刷新 TLB 条目 |
| `csrrw/csrrs/csrrc` | CSR 读写操作 |
| `wfi` | 等待中断 |

## 多核（HART）

RISC-V 将每个硬件线程称为 HART（Hardware Thread）。`mhartid` CSR 包含当前 HART 的 ID。

典型启动流程中，HART 0 执行初始化，其他 HART 自旋等待，直到被唤醒。
