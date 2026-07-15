# x86-64 启动参考

本文档提供 x86-64 平台的内核启动约定参考，用于填写 Lab 2 的 ToolchainSpec 和 OperationContract 中的平台特定字段。

## 启动路径概览

x86-64 平台有三条主流启动路径：

| 路径 | 入口特权级 | CPU 模式 | 固件信息传递 |
|------|:--------:|---------|-------------|
| **Multiboot2 (GRUB)** | 32-bit 保护模式 | Ring 0 | `ebx` 指向 Multiboot2 info structure |
| **Limine** | 64-bit 长模式 | Ring 0 | 通过 Limine boot protocol 请求结构体 |
| **UEFI 直启** | 32/64-bit 保护模式 | Ring 0 | UEFI System Table 指针 |

## Multiboot2 入口约定（推荐教学路径）

Multiboot2 是 GRUB 使用的 bootloader 协议。

### 入口状态

| 项目 | 值 |
|------|-----|
| CPU 模式 | 32-bit 保护模式（需自行切换到 64-bit 长模式） |
| 特权级 | Ring 0（最高特权级） |
| `eax` | Multiboot2 magic number: `0x36d76289` |
| `ebx` | 指向 Multiboot2 info structure 的 32-bit 物理地址 |
| 栈 | GRUB 不保证栈位置——入口第一件事设置自己的栈 |
| 中断 | 由 GRUB 配置（通常禁用） |
| 分页 | 未启用（需自行设置页表并启用长模式） |
| GDT | BIOS 默认 GDT——需自行设置 64-bit GDT |

### 切换到 64-bit 长模式的最小步骤

1. 检查 CPUID 是否支持长模式
2. 设置 4 级页表（PML4 → PDPT → PD → PT），identity map 内核
3. 禁用分页（如果启用），设置 PAE 和长模式使能位（EFER.LME）
4. 加载 64-bit GDT
5. 远跳转（far jump）进入 64-bit 代码段
6. 重新加载段选择子

### ToolchainSpec 对应值

```yaml
# link.yaml
link:
  entry_symbol: "_start"        # Multiboot2 header 在 _start 之前
  section_rules:
    - "Multiboot2 header 必须在 .text 段的前 8 KiB 内"
    - "text 段位于 0x100000 (1 MiB) 或更高"
  relocation_model: static
  abi_constraints:
    - "x86-64 System V ABI"

# run.yaml (QEMU)
run:
  emulator: "qemu-system-x86_64"
  machine: "q35"                 # 或 "pc"（更兼容）
  cpu: "qemu64"                  # 或 "host"
  memory: "128M"
  bios: "default"                # SeaBIOS
  kernel_arg: "-kernel"          # Multiboot2 格式
  extra_args:
    - "-nographic"
    - "-no-reboot"
```

### 多核信息

| 项目 | 说明 |
|------|------|
| 启动核心 | BSP (Bootstrap Processor)，由硬件选择 |
| 核心 ID 获取 | APIC ID（通过 CPUID 或 Local APIC 寄存器） |
| 非启动核心自旋 | `hlt` 指令（等待中断唤醒） |

### 输出通道

| 机制 | 描述 | 复杂度 |
|------|------|:------:|
| VGA 文本模式 | 0xB8000 处的 MMIO，直接写字符+属性字节 | 低 |
| 串口 (COM1) | I/O 端口 0x3F8，16550 UART | 中 |
| BIOS INT 10h | 实模式/保护模式 BIOS 调用 | 低（仅实模式） |
| EFI Simple Text Output | UEFI 协议 | 中 |

### 关机机制

| 机制 | 指令/方法 |
|------|----------|
| QEMU | `outw(0x604, 0x2000)` (isa-debug-exit) |
| ACPI 关机 | 通过 ACPI PM1a_CNT 寄存器 |
| 三重故障 | 故意触发 triple fault（教学用） |
| 无限循环 | `while(1) { asm("hlt"); }`（兜底） |

## UEFI 入口约定

| 项目 | 值 |
|------|-----|
| 入口函数 | `efi_main(EFI_HANDLE, EFI_SYSTEM_TABLE*)` |
| CPU 模式 | 64-bit 长模式（UEFI 固件已设置） |
| 特权级 | Ring 0 |
| 调用约定 | Microsoft x64 calling convention (Windows) 或 System V（取决于固件） |
| 镜像格式 | PE/COFF（非 ELF） |
| entry_symbol | `efi_main`（非 `_start`） |
| 分页 | 已启用（UEFI 固件管理的 identity mapping） |
| Boot Services | 入口时可用，`ExitBootServices()` 后不可用 |

## 参考资料

- [Multiboot2 Specification](https://www.gnu.org/software/grub/manual/multiboot2/multiboot.html)
- [OSDev Wiki: Creating a 64-bit kernel](https://wiki.osdev.org/Creating_a_64-bit_kernel)
- [Intel 64 and IA-32 Architectures Software Developer's Manual](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
- [Limine Boot Protocol](https://github.com/limine-bootloader/limine/blob/trunk/PROTOCOL.md)
