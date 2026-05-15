# VeriSpecOSLab：面向学生个性化构建可验证完整操作系统的 AI 辅助规格驱动教学实验方案

## 一、方案概述

**VeriSpecOSLab** 是一种面向操作系统课程、系统软件实践和科研训练的教学实验方案。该方案以“规格驱动、AI 协作、验证反馈、个性化构建”为核心，支持学生在 AI 辅助下独立完成一个可运行、可测试、可验证、可演化的完整教学操作系统，并在条件允许时将系统从模拟器迁移到真实物理硬件。

本方案借鉴 SYSSPEC 的思想：不直接使用模糊自然语言提示生成复杂系统代码，而是通过结构化规格描述系统的功能、模块关系和并发约束，再由 AI 辅助生成、验证和演化实现。SYSSPEC 的核心启发在于：将系统开发重心从低层代码编写转向高层规格设计，并通过验证反馈约束 AI 生成过程。

VeriSpecOSLab 将这一思想从文件系统扩展到完整操作系统教学实验中，使学生不再只是补全教师预设代码，而是围绕自选架构、技术栈和系统目标，从零构建具有个人设计特色的 OS。

---

## 二、方案名称

**VeriSpecOSLab：面向学生个性化构建可验证完整操作系统的 AI 辅助规格驱动教学实验方案**

名称含义：

```text
Veri  = Verification / Verifiable，可验证
Spec  = Specification，规格驱动
OS    = Operating System，操作系统
Lab   = 教学实验平台 / 实验方案
```

该名称强调四个核心要素：

```text
AI-assisted：AI 辅助
Spec-guided：规格驱动
Verifiable：可验证
Personalized OS Construction：个性化操作系统构建
```

---

## 三、总体目标

本实验方案的目标不是让所有学生实现同一种教学内核，而是在统一的规格方法和验证框架下，允许学生自由选择参考架构、技术栈、系统目标和优化方向，最终完成具有个人设计特色的完整操作系统。

总体目标包括：

1. **完整系统构建能力**  
   学生需要完成从启动、内存管理、异常处理、线程/进程、系统调用、用户态程序、I/O、文件系统或 IPC 到 shell/demo 程序的完整链路。

2. **规格化设计能力**  
   学生需要为核心模块编写结构化规格，包括前置条件、后置条件、不变量、模块依赖、并发规则和错误语义。

3. **AI 协作开发能力**  
   学生通过规格约束 AI，而不是简单让 AI 代写代码。AI 主要用于代码生成、测试生成、错误定位、规格检查和演化建议。

4. **可验证系统能力**  
   系统不仅要能运行，还要通过自动测试、运行时断言、不变量检查、模糊测试、模型检查或局部形式化证明提供正确性证据。

5. **个性化架构探索能力**  
   学生可以参考 Linux、L4/seL4、Darwin/XNU、Windows NT、Plan 9、RTOS、Unikernel 等不同架构，并在此基础上进行简化、改造或优化。

6. **物理硬件移植能力**  
   在完成 QEMU 或其他模拟环境中的基础系统后，鼓励学生将内核移植到真实开发板或通用硬件平台，理解 boot chain、设备树/ACPI、串口、定时器、中断控制器、内存布局、外设驱动和真实硬件调试方法。

7. **进阶兼容与优化能力**  
   高阶目标包括实现目标系统的二进制兼容，或在 syscall、IPC、文件系统、实时性、启动速度、镜像体积、安全性、可验证性等方向上进行专项优化。

---

## 四、核心教学理念

VeriSpecOSLab 的基本思想可以概括为：

> **以规格约束 AI，以验证保障正确，以个性化架构培养系统设计能力。**

传统 OS 实验通常是：

```text
教师给框架 → 学生补代码 → 跑通测试
```

VeriSpecOSLab 改为：

```text
学生提出 OS 设计目标
    ↓
选择参考架构与技术栈
    ↓
编写结构化系统规格
    ↓
AI 根据规格生成实现与测试
    ↓
学生验证、调试、修正规格
    ↓
通过 spec patch 演化系统
    ↓
可选移植到物理硬件
    ↓
形成完整个性化 OS
```

因此，学生学习的重点从“写出某段代码”提升为：

```text
定义什么是正确
约束 AI 如何实现
验证实现是否满足规格
解释架构设计取舍
维护和演化复杂系统
```

---

## 五、个性化架构选择

实验允许学生自由选择参考架构，不要求所有人实现相同 OS。

### 1. Linux-like 宏内核路线

适合目标：

```text
POSIX/Linux syscall
VFS
进程模型
文件描述符
ELF 加载
Linux ABI 子集兼容
```

可选进阶：

```text
运行静态 Linux ELF
支持 busybox 子集
优化 syscall latency
优化 VFS 或文件系统性能
```

### 2. L4 / seL4-like 微内核路线

适合目标：

```text
IPC
Capability
用户态服务
小内核可信计算基
高可验证性
```

可选进阶：

```text
高性能 IPC
异步 IPC
零拷贝消息传递
Linux syscall emulation server
Capability revoke 验证
```

### 3. Darwin / XNU-like 混合内核路线

适合目标：

```text
Mach-like task/thread
Port
Message
BSD syscall layer
混合内核架构
```

可选进阶：

```text
简化 Mach IPC
BSD 层模块化
Port rights 安全模型
Mach-O 子集加载
```

### 4. Windows NT-like 对象内核路线

适合目标：

```text
Object Manager
Handle Table
Process / Thread / Section
I/O Manager
NT syscall-like interface
```

可选进阶：

```text
PE/COFF 子集加载
对象命名空间
句柄权限检查
NT syscall 子集兼容
```

### 5. Plan 9-like 命名空间路线

适合目标：

```text
everything-is-a-file
per-process namespace
file server
9P-like protocol
统一资源抽象
```

可选进阶：

```text
设备、进程、IPC 文件化
namespace mount
用户态文件服务器
```

### 6. RTOS 实时路线

适合目标：

```text
优先级调度
抢占式内核
中断延迟
确定性调度
实时同步原语
```

可选进阶：

```text
cyclictest-like benchmark
EDF 调度器
优先级继承
最坏情况延迟优化
```

### 7. Unikernel / Library OS 路线

适合目标：

```text
专用化系统
单地址空间
快速启动
小镜像
应用与内核静态链接
```

可选进阶：

```text
boot time 优化
image size 优化
专用网络服务性能优化
```

---

## 六、技术栈选择

学生可根据设计目标自由选择技术栈，但必须写入 `TechStackSpec`。

示例：

```text
TechStackSpec:
  Language:
    - C
    - Rust no_std
    - Zig
    - C++
    - C/Rust hybrid

  Architecture:
    - RISC-V64
    - x86_64
    - AArch64

  Boot:
    - OpenSBI
    - UEFI
    - Limine
    - Multiboot2
    - custom bootloader

  Toolchain:
    - GCC
    - LLVM/Clang
    - Rust nightly
    - Zig cc
    - LLD

  Runtime:
    - QEMU
    - bare metal
    - virtio
    - microVM

  HardwareTarget:
    - QEMU only
    - Raspberry Pi / AArch64 board
    - RISC-V SBC / FPGA softcore
    - x86_64 PC / NUC
    - microcontroller-class board for RTOS route
```

学生需要说明：

```text
为什么选择该语言
为什么选择该硬件架构
为什么选择该启动方式
是否计划移植到物理硬件，以及目标硬件是什么
该技术栈对安全性、性能、复杂度、可验证性的影响
AI 在该技术栈下的优势与风险
```

---

## 七、统一规格框架

虽然架构和技术栈允许个性化，但所有学生必须使用统一的规格方法。

每个核心模块都需要提交规格文件：

```text
Module:
  name:

Purpose:

State:

Interface:

Preconditions:

Postconditions:

Invariants:

Rely:

Guarantee:

Concurrency:

Safety:

Error Cases:

Test Obligations:

Spec Patch History:
```

### 示例：页分配器规格

```text
Module:
  name: PhysicalPageAllocator

State:
  free_pages
  allocated_pages
  reserved_regions
  refcount[]

Interface:
  alloc_page(owner) -> Page | ENOMEM
  free_page(owner, page) -> Result

Invariants:
  - reserved pages are never allocated
  - free page has refcount == 0
  - allocated page has refcount > 0
  - no page is both free and allocated

Postconditions:
  alloc_page success:
    - returned page belongs to owner
    - returned page is removed from free_pages

  alloc_page failure:
    - allocator state remains unchanged
```

---

## 八、实验内容结构

实验分为公共核心阶段、个性化架构阶段、进阶目标阶段和评价阶段。

### 阶段一：公共核心阶段

所有学生都需要完成：

```text
Boot
UART / Console
Trap / Exception
Physical Memory
Virtual Memory
Thread or Process
Basic Scheduler
Syscall or IPC Entry
User Mode
Basic I/O
```

最低目标：

```text
系统可启动
可输出日志
可处理中断和异常
可管理内存
可创建执行单元
可进入用户态
可运行至少一个用户程序
```

### 阶段二：个性化架构阶段

学生根据所选路线实现架构特色。

例如：

```text
Linux-like:
  syscall + VFS + fd table + ELF loader

L4-like:
  capability + endpoint IPC + user-level service

NT-like:
  object manager + handle table + process/thread object

Darwin-like:
  port + message + BSD layer

Plan9-like:
  namespace + file server

RTOS:
  priority scheduler + interrupt latency measurement

Unikernel:
  app-linked kernel + fast boot
```

#### 阶段三：物理硬件移植目标

物理硬件移植是 VeriSpecOSLab 的重要教学扩展目标。它不要求所有学生必须完成，但建议作为高阶实践或课程挑战项纳入实验体系。该目标强调从“模拟器中能运行”进一步走向“真实机器上能启动、能交互、能处理中断和外设”。

可选硬件方向：

```text
AArch64 开发板：Raspberry Pi、RK 系列开发板、树莓派兼容板
RISC-V 开发板：HiFive、VisionFive、LicheeRV、QEMU 对应硬件族
x86_64 物理机：旧 PC、NUC、教学实验机
RTOS 板卡：Cortex-M / RISC-V MCU 开发板
FPGA / Softcore：自定义 RISC-V softcore 平台
```

物理移植规格 `HardwarePortSpec` 至少包括：

```text
HardwarePortSpec:
  TargetBoard:
  CPUArchitecture:
  BootChain:
    - firmware / boot ROM
    - OpenSBI / U-Boot / UEFI / custom loader
    - kernel entry convention

  MemoryMap:
    - RAM base and size
    - MMIO regions
    - reserved regions
    - kernel load address

  DeviceDiscovery:
    - Device Tree
    - ACPI
    - static board description

  RequiredDrivers:
    - UART / serial console
    - timer
    - interrupt controller
    - optional: block device / SD card / virtio / network

  PortingInvariants:
    - kernel must not allocate reserved memory
    - MMIO regions must not be mapped as normal cacheable RAM
    - interrupt handler must acknowledge device interrupt exactly once
    - timer interrupt must not starve normal scheduling
```

移植阶段建议分三步：

```text
Level 1: Bare-metal bring-up
  - 串口输出
  - 正确解析或静态声明内存布局
  - panic / log 可用

Level 2: Kernel core on hardware
  - 页分配器可用
  - trap / interrupt 可用
  - timer tick 可用
  - 至少一个内核线程或用户程序可运行

Level 3: Device and workload
  - 支持 SD 卡、块设备、网络或显示等至少一种真实外设
  - 运行 shell、测试程序或专项 benchmark
```

AI 在硬件移植中的作用包括：

```text
根据芯片手册或设备树生成 MMIO 寄存器定义草案
根据 HardwarePortSpec 生成 UART/timer/interrupt 驱动骨架
解释启动日志、异常码、trap frame 和串口输出
辅助编写 linker script、启动汇编和 board support package
生成硬件 bring-up checklist 与故障排查表
```

硬件移植不应替代 QEMU 自动测试。推荐流程是：

```text
QEMU regression test 通过
    ↓
硬件启动最小内核
    ↓
硬件运行核心测试
    ↓
对比 QEMU 与硬件行为差异
    ↓
将差异写入 HardwarePortSpec 或 BoardSpec
```

### 阶段四：进阶目标阶段

学生可在以下三类进阶目标中选择其一，或根据项目特点进行组合。

#### A. 二进制兼容目标

可选方向：

```text
Linux static ELF compatibility
POSIX source-level compatibility
PE/COFF subset compatibility
Mach-O subset compatibility
Custom ABI compatibility
```

Linux ABI 子集要求示例：

```text
ELF:
  - PT_LOAD 加载
  - 用户栈布局
  - argc / argv / envp
  - auxv 可选

Syscall:
  - read
  - write
  - exit
  - brk
  - mmap
  - munmap
  - openat
  - close
  - fstat
  - getpid
  - clock_gettime
```

验收目标：

```text
运行 hello-static
运行 syscall smoke test
运行简单 busybox applet 子集
syscall trace 与预期一致
```

#### B. 专项优化目标

可选方向：

```text
syscall latency optimization
IPC performance optimization
file system optimization
real-time latency optimization
boot time optimization
image size optimization
memory footprint optimization
verifiability optimization
security isolation optimization
```

每个优化目标必须包含：

```text
baseline
optimization spec
benchmark
before/after result
correctness check
negative tradeoff analysis
```



---

## 九、AI 协作规范

允许 AI 完成：

```text
根据规格生成代码
根据规格生成测试
检查规格缺陷
解释编译错误
辅助定位 bug
提出 spec patch 建议
生成文档和注释
```

不允许：

```text
直接要求 AI 一次性生成完整 OS
跳过规格直接生成核心模块
提交未理解的 AI 代码
删除测试以通过实验
绕过 invariant checker
用模糊自然语言替代结构化规格
```

学生必须提交 `AICollaborationLog`：

```text
输入给 AI 的规格
AI 输出摘要
学生采纳内容
学生修改内容
AI 生成错误
验证如何发现问题
规格如何修正
最终代码如何变化
```

每位学生至少需要记录一个 AI 错误案例，例如：

```text
AI 直接解引用用户指针
AI 忘记释放锁
AI 将线程重复加入 run queue
AI 忘记 fd refcount
AI 在阻塞路径持有 spinlock
AI 未处理 syscall 错误返回
```

---

## 十、可验证元素设计

VeriSpecOSLab 的“可验证”采用分层设计。

### 1. 规格可检查

通过 `spec_lint` 检查：

```text
是否有接口定义
是否有 pre/postcondition
是否有 invariant
是否有 rely/guarantee
是否有错误语义
是否有测试义务
是否存在未定义依赖
是否存在明显循环依赖
```

### 2. 测试可验证

每个模块都需要从规格导出测试：

```text
正常路径测试
错误路径测试
边界条件测试
precondition violation 测试
postcondition 测试
invariant preservation 测试
concurrency stress test
```

### 3. 运行时不变量检查

Debug kernel 中加入：

```text
check_page_allocator_invariant()
check_page_table_invariant()
check_runqueue_invariant()
check_fdtable_invariant()
check_ipc_queue_invariant()
check_object_manager_invariant()
check_vfs_invariant()
```

### 4. 模型检查

进阶学生可以对关键并发模块使用 TLA+ / PlusCal 建模：

```text
scheduler
IPC endpoint
pipe buffer
fd reference counting
capability revoke
blocking/wakeup protocol
```

### 5. 局部形式化证明

高阶选做：

```text
bitmap allocator
ring buffer
scheduler queue
capability access check
reference counting
handle table lookup
```

可选工具：

```text
Dafny
Lean
Coq
CBMC
Kani
Prusti
TLA+
```

---

## 十一、评价阶段设计

VeriSpecOSLab 的评价阶段不是只检查“能否运行”，而是评价系统的设计、规格、验证、架构个性化、AI 协作和进阶目标完成情况。

评价分为八个方面：

```text
1. 基础可运行性评价
2. 规格与可验证性评价
3. 架构个性化评价
4. 物理硬件移植评价
5. 进阶目标评价
6. AI 协作过程评价
7. 最终展示与答辩评价
```

### 1. 基础可运行性评价

所有路线必须满足：

```text
系统可启动
可输出日志
实现基本内存管理
具备内核/用户隔离
支持线程或进程
支持异常和系统调用或 IPC 入口
至少运行一个用户态程序
具备基本 I/O
```

评价方式：

```text
QEMU 自动测试
串口日志比对
syscall smoke test
异常路径测试
用户态程序执行测试
```

### 2. 规格与可验证性评价

评价内容：

```text
规格是否完整
pre/postcondition 是否清晰
invariant 是否覆盖关键安全属性
rely/guarantee 是否匹配
并发规则是否明确
错误语义是否完整
是否有 spec patch 演化记录
是否能从规格导出测试
```

最低要求：

```text
核心模块均有规格
至少 5 个关键不变量被运行时检查
至少 1 个模块有并发规格
至少 1 个功能通过 spec patch 演化
```

### 3. 架构个性化评价

学生需提交：

```text
OSDesignProposal
ArchitectureReferenceReport
TechStackSpec
DesignGoalSpec
ArchitectureImprovementSpec
```

评价重点：

```text
参考了哪个系统
参考了哪些设计
哪些地方做了简化
哪些地方做了改进
技术栈是否匹配目标
实现是否体现架构特色
```
### 4. 物理硬件移植评价

该项评价重点不是要求支持大量外设，而是检查学生是否能把模拟环境中的 OS 设计迁移到真实硬件约束下，并解释硬件差异导致的设计修改。

评价内容：

```text
目标硬件选择是否合理
Boot chain 是否清晰
linker script 与内存布局是否正确
UART / timer / interrupt controller 是否可用
Device Tree / ACPI / BoardSpec 是否被正确处理
MMIO 映射与 cache 属性是否安全
QEMU 与真实硬件行为差异是否被记录
```

可选验收等级：

```text
Bring-up 级：真实硬件串口输出 kernel banner
Core 级：真实硬件上完成 timer、trap、内存管理和调度
Workload 级：真实硬件上运行用户程序、shell、文件系统或 benchmark
```

移植报告需包含：

```text
硬件平台说明
启动链路说明
内存映射图
关键外设寄存器或驱动说明
硬件调试过程
与 QEMU 的差异分析
失败案例与修复记录
```

该项可以作为兼容或优化目标之外的独立进阶目标，也可以与 RTOS、Unikernel、Linux-like 或 L4-like 路线结合。

### 5. 进阶目标评价

#### 二进制兼容评价

适用于选择兼容目标的学生。重点在于验证兼容性实现的正确性，完成度与实际运行能力。

评价内容：

```text
loader 正确性
ABI 约定
syscall 覆盖
错误语义
实际程序运行能力
trace 对比
```

示例测试：

```text
hello-static
echo
cat
ls-lite
busybox applet subset
PE no-import demo
Mach-O simple demo
```

#### 专项优化评价

适用于选择优化目标的学生。重点在于性能表现的提升与正确性的保障，以及对优化效果的分析。

评价要求：

```text
定义 baseline
定义优化目标
提供 benchmark
提供 before/after 数据
解释性能变化原因
分析正确性风险
说明是否破坏不变量
```

可评价指标：

```text
syscall latency
IPC ping-pong latency
file system throughput
metadata operation latency
real-time max latency
boot-to-shell time
image size
memory footprint
verification coverage
```


### 6. AI 协作过程评价

评价重点：

```text
是否以规格驱动 AI
是否识别 AI 幻觉
是否通过测试反馈修正代码
是否保留人工设计决策
是否能解释关键实现
是否记录 AI 错误案例
```

### 7. 最终展示与答辩评价

必须展示：

```text
系统启动
用户态程序运行
核心 syscall / IPC / 文件操作
至少一个 invariant checker
至少一个 spec patch 演化案例
至少一个 AI 错误修正案例
```

根据路线自选展示：

```text
Linux-like:
  静态 ELF / busybox 子集

L4-like:
  IPC benchmark / capability 权限失败案例

NT-like:
  object namespace / handle 权限检查

Darwin-like:
  port message demo

Plan9-like:
  namespace / file server demo

RTOS:
  cyclictest-like 延迟结果

Unikernel:
  boot time / image size 对比

Hardware Porting:
  真实硬件串口启动日志 / timer 中断 / 用户程序运行演示
```

---

## 十二、评分结构

建议总成绩采用：

```text
总成绩 = 公共基础能力 35%
       + 规格与验证能力 25%
       + 个性化架构设计 15%
       + 兼容、优化或硬件移植目标 15%
       + AI 协作与答辩 10%
```

| 项目 | 比例 | 说明 |
|---|---:|---|
| 公共基础能力 | 35% | 启动、内存、trap、调度、用户态、基本 I/O |
| 规格与验证能力 | 25% | pre/postcondition、invariant、rely/guarantee、测试与断言 |
| 个性化架构设计 | 10% | 参考架构理解、设计取舍、技术栈匹配、改进点 |
| 硬件移植目标 | 10% | 物理硬件移植，驱动开发等 |
| 进阶方向 | 10% | 二进制兼容、POSIX 兼容、IPC/FS/syscall/RT 优化、物理硬件移植等 |
| AI 协作与答辩 | 10% | AI 使用记录、错误分析、人工理解、最终展示 |

---

## 十三、分层评价标准

### 合格

```text
系统可启动
有基本内存管理
有基本执行单元
可运行一个用户态程序
有核心模块规格
有基础测试
能说明 AI 协作过程
```

### 良好

```text
支持多个用户态程序
有基本 syscall / IPC / VFS
有运行时 invariant checker
有明确参考架构路线
有 spec patch 演化案例
有较完整测试集
```

### 优秀

```text
实现个性化架构特色
完成二进制兼容、专项优化或硬件移植目标
有可复现 benchmark 或硬件 bring-up 记录
有模型检查或局部形式化证明
能深入分析 AI 错误与规格修正
设计具有可持续演化能力
```

### 卓越

```text
运行真实目标系统程序子集或在物理硬件上稳定运行核心系统
显著优化某项系统指标或完成高质量跨平台移植
提出原创性 OS 架构改进
关键模块具备机器验证或模型检查
实验结果可复现、可比较、可扩展
```

---

## 十四、课程时间安排建议

以 12 周实验周期为例：

| 周次 | 内容 | 产出 |
|---:|---|---|
| 第 1 周 | 方法介绍、AI 规范、规格模板 | OSDesignProposal |
| 第 2 周 | 技术栈选择、参考架构分析 | TechStackSpec / ArchitectureReport |
| 第 3 周 | Boot 与最小内核 | 可启动内核 |
| 第 4 周 | 物理/虚拟内存 | MemorySpec + allocator/page table |
| 第 5 周 | Trap、syscall 或 IPC 入口 | TrapSpec / SyscallSpec / IPCSpec |
| 第 6 周 | 线程、调度、用户态 | SchedulerSpec + user program |
| 第 7 周 | 架构分流实现 | Linux/L4/NT/Darwin/Plan9/RTOS 核心功能 |
| 第 8 周 | VFS / IPC / Object / Namespace 等 | 架构特色模块 |
| 第 9 周 | 文件系统、服务或运行时 | 可运行系统雏形 |
| 第 10 周 | 硬件移植与驱动开发 | HardwarePortSpec / DriverSpec |
| 第 10 周 | 二进制兼容、专项优化或硬件移植 | CompatibilitySpec / OptimizationSpec / HardwarePortSpec |
| 第 11 周 | 验证、测试、benchmark 或硬件 bring-up | 测试报告、验证证据与移植记录 |
| 第 12 周 | 最终展示与答辩 | 完整系统、报告、演示 |

---

## 十五、最终提交物

每位学生最终提交：

```text
1. OSDesignProposal
2. TechStackSpec
3. ArchitectureReferenceReport
4. DesignGoalSpec
5. Module Specs
6. Verification Plan
7. CompatibilitySpec、OptimizationSpec 或 HardwarePortSpec
8. AICollaborationLog
9. Spec Patch History
10. Source Code
11. Test Suite
12. Benchmark Results 或 Hardware Bring-up Report
13. Final OS Image / Hardware Boot Image
14. Final Report
```

最终系统至少应支持：

```text
可启动
可输出
可管理内存
可处理中断/异常
可创建执行单元
可运行用户程序
具备基本系统调用或 IPC
具备基本 I/O 或文件/服务抽象
具备测试与不变量检查
```

---

## 十六、方案创新点

### 1. 从统一教学内核转向个性化 OS 构建

学生可自由选择 Linux、L4、Darwin、NT、Plan 9、RTOS、Unikernel 等架构路线。

### 2. 从代码补全转向规格驱动

学生首先定义系统行为和正确性，再由 AI 辅助实现。

### 3. 从 AI 代写转向 AI 协作

AI 被规格、测试和验证反馈约束，学生仍负责架构设计和正确性判断。

### 4. 从能运行转向可验证

系统需要提供测试、不变量、模型检查或局部证明等正确性证据。

### 5. 从基础 OS 转向兼容与优化

高阶学生可以挑战 Linux ABI、PE/COFF、Mach-O 子集兼容，或进行 IPC、syscall、FS、RT、boot time 等专项优化。

### 6. 从模拟器运行扩展到物理硬件移植

学生可以将系统从 QEMU 迁移到真实开发板或物理机，学习 boot chain、内存布局、设备发现、MMIO、中断控制器、定时器、串口和真实硬件调试，形成从“能在模拟器运行”到“能在真实硬件运行”的系统工程能力。

---

## 十七、总结

VeriSpecOSLab 是一种面向 AI 时代的操作系统教学实验方案。它不再要求学生实现同质化的教学内核，而是在统一的规格驱动和验证反馈框架下，鼓励学生选择不同参考架构、技术栈和系统目标，独立完成具有个人特色的完整操作系统，并在进阶阶段探索真实硬件移植。

该方案的核心不是“让 AI 替学生写 OS”，而是让学生学会：

```text
如何定义系统正确性
如何用规格约束 AI
如何验证 AI 生成代码
如何解释架构设计取舍
如何演化和优化复杂系统
如何将模拟器中的 OS 移植到物理硬件
```

最终目标是培养学生的系统软件综合能力，使其具备从架构设计、模块规格、AI 协作、底层实现、验证测试、性能优化、兼容性实现到物理硬件移植的完整训练经历。

一句话概括：

> **VeriSpecOSLab 以规格为设计语言，以 AI 为协作工具，以验证为质量保障，以个性化架构为教学入口，训练学生独立构建并移植完整操作系统的能力。**


## 目前设计下的一些细节问题

* 是否应该要为该实验构建一个完整的实验平台，用于提交规格、代码、测试、AI 协作日志等，并自动进行验证和评分？应该覆盖哪些方面？

* AI的使用是否应该统一走一个附带审计的接口，方便记录和分析AI的使用情况，并将其用于评分和反馈？AI模型的差异是否需要考虑，是否需要限制使用的AI模型？

* 该实验的设计中对学生的素养要求较高，是否需要提供一些培训材料或指导，帮助学生理解如何编写规格、如何与AI协作、如何进行验证等？例如：在操作系统课程中是否应该加入现有操作系统设计的分析和比较，帮助学生理解不同架构的设计取舍和实现细节，以便于学生在个性化架构阶段做出更有信息的选择？

* 面对在兼容性实现选题的学生，为了兼容性完全对某一操作系统整体架构进行1:1复刻的设计情况下该如何处置？如何避免最优解是直接复刻一个现有操作系统的架构，而不是在理解的基础上进行个性化设计和实现的问题？

* 评分系统设计需要进一步细化，部分权重可能要根据目标进行重新分配

* 目前大体上的设计是针对操作系统这一门课程的，是否也可以用于其他相关课程的教学中，以避免该实验的成果无法得到充分利用的问题？例如：是否可以将该实验方案应用于各种软件与硬件课程中，使得学生在自己构建的操作系统的基础上进行各种软件与硬件开发，例如：编译器、数据库、移植到自制架构等，符合各种专业课程的连续化教学需求，让学生在实践中加深对各种专业知识的理解和应用，并积累经验用于未来的科研或工作？

* 在兼容性实现选题的评测中，rootfs的构建中，如何构建非官方支持的rootfs以测试兼容性实现完善度？例如darwin-riscv64和nt-riscv64?
## 附录

* [SYSSPEC](https://arxiv.org/html/2512.13047v4#S4)