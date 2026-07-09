# 第 1 章：操作系统初步 — 定义你要构建什么

> 本章 §1.1–§1.8 是课程概述，帮你理解这门课要做什么、OS 是什么。§1.9–§1.15 聚焦 lab1 的核心决策：为什么先设计、你的 OS 回答哪四个问题、选什么语言和平台、怎么写 ArchitectureSeed。更深入的设计原理——内核架构对比、资源模型范式、参考系统剖析——已分布到后续各章（第 5 章和第 7 章），在你需要做具体决策时出现。

> **对应实验**：[Lab 1: 准备——理解操作系统与选择技术路线](../labs/lab1-seed.md)

## 1.1 你在做什么

这门课的任务很明确：**从零构建一个你自己的操作系统**。

"从零"意味着不基于 Linux 内核修改，不基于任何现有教学内核补代码。你会经历一个操作系统从无到有的完整过程——从 CPU 上电后的第一条指令开始，到最终能跑用户程序、有文件系统、有 Shell。

"你自己的"意味着这个 OS 的设计决策是你做的。它参考了哪些已有系统、拒绝了哪些概念、选择了什么资源模型、追求什么目标——这些都不是教学团队替你做好的选择题。你的 ArchitectureSeed 是你全部后续设计的锚点。

最后你会得到一个能在 QEMU（或真实 RISC-V 硬件）上运行的完整操作系统，以及一套描述它的设计规格、验证证据和演化记录。

## 1.2 操作系统是什么——一个简短的历史视角

理解操作系统最好的方式不是背定义，是看它怎么一步一步变成今天这样的。

**1940s-1950s：没有操作系统的时代。** 程序员直接操作硬件——插拔电缆、设置开关。一台计算机一次只跑一个程序。程序崩溃？整台机器停摆，程序员自己排查。资源利用率这个词还没出现——机器大部分时间在等人。

**1950s：批处理的诞生。** 把多个程序攒成一批，一个接一个地跑，中间不用人插拔电缆。这叫"批处理监控程序"——操作系统的雏形。但它解决的是效率问题，不是易用性问题。程序员提交一叠卡片，几小时后取回结果，中间完全看不到程序在跑。

**1960s：多道程序与分时系统。** IBM 的 OS/360 首次让多个程序"同时"驻留在内存中——一个程序在等 I/O 的时候，CPU 去跑另一个程序。这是操作系统史上的分水岭：CPU 不再等人了。几乎同时，MIT 的 CTSS（兼容分时系统）让多个用户通过终端"同时"使用一台计算机。每个人以为自己独占整台机器，实际上 CPU 在几十个用户之间快速切换。**分时系统的出现，让"隔离"和"保护"成为操作系统的核心命题**——一个用户的程序不能偷看另一个用户的数据，一个崩溃的进程不能拖垮整台机器。

**1970s：Unix 的时代。** Ken Thompson 和 Dennis Ritchie 在贝尔实验室写了 Unix——最初是为了在 PDP-7 上玩一个叫 Space Travel 的游戏。Unix 带来了几个影响深远的设计决定：一切皆文件（用统一的文件描述符操作文件、设备和管道）、层级文件系统、Shell 作为普通用户程序、管道（`|`）作为 IPC 原语。这些决定不是"显然正确"的——它们是在无数替代方案中被证明简洁而强大的。Unix 的哲学凝结成一句话：**"Do one thing and do it well."**

**1980s-1990s：微内核之争。** 1986 年，Andrew Tanenbaum 发布了 Minix——一个微内核教学 OS。1991 年，Linus Torvalds 发布了 Linux——一个宏内核。Tanenbaum 在 1992 年写了一篇著名帖子，声称"Linux is obsolete"，因为微内核才是未来。Linus 反驳说微内核的理论优势在实践中被 IPC 开销抵消。这场论战没有绝对的赢家——Linux 的宏内核在桌面和服务器市场取得了压倒性的成功，但 seL4（一个微内核）实现了完整的形式化验证，在安全和关键任务系统中找到了自己的位置。**这场论战的核心启示是：没有"最好"的内核架构，只有最适合你目标的架构。**

**2000s-至今：虚拟化、容器、Unikernel。** 操作系统设计的边界在持续扩展。虚拟机把整个 OS 打包成可迁移的镜像。容器把应用和它们的依赖打包在一起，共享同一个内核。Unikernel 把应用和内核编译成单一镜像，取消了"用户态 vs 内核态"这条边界。这些新范式说明：**操作系统的设计取决于你对"什么算是一个系统"的定义。**

**2020s-至今：内存安全、硬件 capability、可验证系统和延迟控制。** OS 的新问题不再只是"能不能跑更多程序"。Rust for Linux、Tock 和 Theseus 把语言安全引入内核边界；CHERI 和 CheriBSD 让指针带上边界和权限；Verus、Atmosphere 等工作把验证拉近到系统代码；Linux 的 EEVDF 调度器则把公平性和延迟控制放在同一个模型里讨论。这些案例不会替你选择架构，但会提醒你：每个设计都多了一组约束，也多了一组可以验证的证据。

### 这段历史对你这门课的意义

在 Lab 1，你只需要理解"操作系统是什么"并选择语言和 ISA。具体的架构决策——宏内核还是微内核、fd-based 还是 capability-based、参考什么系统——会在后续 Lab 中逐渐做出，并通过逐 Lab 更新 ArchitectureSeed 来记录设计的演化。你选择宏内核，你站在 Linux 和 xv6 的肩膀上。你选择微内核，你站在 Minix 和 seL4 的肩膀上。**你不知道历史，你的选择就是随机的。你知道历史，你的选择就是有理由的设计判断。**

## 1.3 什么是操作系统——从裸机编程到操作系统的认知跃迁

在讨论内核架构、Unix 哲学和微内核论战之前，有一个更基本的问题需要回答：**操作系统到底是什么？它解决了什么问题？**

如果你只有单片机裸机编程的经验（比如 STM32、Arduino），这个问题可能不太直观——你的程序直接操作硬件，跑得很好，为什么还需要一个叫"操作系统"的东西插在你和硬件之间？

本节用两个具体的编程场景——LED 闪烁与串口输出、多任务交替运行——对比裸机和 OS 环境下的做法。不需要你事先理解任何 OS 概念。你只需要看懂 C 代码。

### 1.3.1 裸机编程体验：一切都要自己来

假设你要在一块 STM32F103 开发板上让 LED 每秒闪烁一次，同时在串口输出 `"Hello"`。

在裸机上，你需要做这些事情：

**第一步：查数据手册。** 打开 STM32F103 参考手册，找到这些信息：

- GPIO 端口的基地址：`0x40010800`（GPIOA）、`0x40010C00`（GPIOC）
- 时钟控制寄存器（RCC）的基地址：`0x40021000`，以及 GPIOA/GPIOC 的时钟使能位
- UART 的基地址：`0x40013800`（USART1），以及波特率寄存器的计算公式

**第二步：手动初始化硬件。** 这些硬件上电后是关闭的——你必须逐个打开：

```c
// ===== 时钟配置（[硬件绑定] 特定芯片的 RCC 寄存器地址）=====
volatile uint32_t *RCC_APB2ENR = (volatile uint32_t *)0x40021018;
*RCC_APB2ENR |= (1 << 2);   // 使能 GPIOA 时钟
*RCC_APB2ENR |= (1 << 4);   // 使能 GPIOC 时钟
*RCC_APB2ENR |= (1 << 14);  // 使能 USART1 时钟

// ===== GPIO 配置（[硬件绑定] 特定芯片的 GPIO 寄存器地址）=====
// 将 GPIOC 的第 13 号引脚（板载 LED）设为推挽输出
volatile uint32_t *GPIOC_CRH = (volatile uint32_t *)0x40011004;
*GPIOC_CRH &= ~(0xF << 20);   // 清除 PC13 的配置位
*GPIOC_CRH |=  (0x2 << 20);   // 设置为 2 MHz 推挽输出

// ===== UART 初始化（[硬件绑定] 特定芯片的 UART 地址和波特率公式）=====
volatile uint32_t *USART1_BRR = (volatile uint32_t *)0x40013808;
*USART1_BRR = 8000000 / 115200;  // 假设 8 MHz 外设时钟 → 115200 波特
volatile uint32_t *USART1_CR1 = (volatile uint32_t *)0x4001380C;
*USART1_CR1 |= (1 << 3) | (1 << 2);  // 使能发送器和接收器
*USART1_CR1 |= (1 << 13);            // 使能 USART
```

**第三步：写最基础的外设操作函数：**

```c
// 串口发送一个字符（[硬件绑定] UART 状态寄存器地址）
void uart_putc(char c) {
    volatile uint32_t *USART1_SR  = (volatile uint32_t *)0x40013800;
    volatile uint32_t *USART1_DR  = (volatile uint32_t *)0x40013804;
    while (!(*USART1_SR & (1 << 7)));  // 等待发送缓冲区空
    *USART1_DR = c;
}

void uart_puts(const char *s) {
    while (*s) uart_putc(*s++);
}
```

**第四步：写出主循环——终于到了"业务逻辑"：**

```c
int main(void) {
    // 所有硬件初始化（[OS 职责] 在 OS 上由内核和驱动完成）
    clock_init();
    gpio_init();
    uart_init();

    volatile uint32_t *GPIOC_ODR = (volatile uint32_t *)0x4001100C;

    while (1) {
        // [应用逻辑] 这部分是真正想做的事
        *GPIOC_ODR ^= (1 << 13);    // 翻转 LED
        uart_puts("Hello\n");

        // [OS 职责] 裸机上只能用忙等循环做延时
        for (volatile int i = 0; i < 500000; i++);
    }
}
```

这个程序大约 50 行。其中有 **40 行是在做硬件初始化和寄存器操作**——这些工作在任何一个稍有规模的裸机项目里都要重复写。而且，这些代码换一块芯片（哪怕是 STM32 同系列的 F407）就要改——寄存器地址变了，时钟树变了，引脚映射变了。

### 1.3.2 同一件事，在操作系统上怎么做

在 Linux（或任何提供标准 C 运行时的 OS）上，LED 闪烁和串口输出的等价程序：

```c
#include <stdio.h>
#include <unistd.h>

int main(void) {
    while (1) {
        // LED 闪烁：通过 sysfs 接口写文件
        FILE *led = fopen("/sys/class/leds/user-led/brightness", "w");
        fputc('1', led);  // 亮
        fclose(led);
        sleep(1);

        led = fopen("/sys/class/leds/user-led/brightness", "w");
        fputc('0', led);  // 灭
        fclose(led);

        // 串口输出：就是普通的 printf
        printf("Hello\n");
    }
}
```

不到 20 行。没有出现任何寄存器地址。没有时钟树配置。没有波特率计算。你甚至不需要知道"LED 连在哪个 GPIO 引脚上"——驱动已经替你的程序处理了这些细节。

一个更惊人的对比：**这份代码可以在 x86 PC、ARM 树莓派、RISC-V 开发板上编译运行**，只要目标平台的 Linux 内核提供了对应的 LED 驱动和终端驱动。而在裸机上，换一块开发板 = 重写 80% 的代码。

### 1.3.3 裸机 vs OS 编程的核心差异

| 维度               | STM32 裸机                                         | Linux/OS 环境                                        |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------- |
| **硬件访问** | 直接读/写物理寄存器地址（查数据手册）              | 通过驱动 + syscall，不直接碰寄存器                   |
| **可移植性** | 代码绑定特定芯片型号                               | 同一份源码可在不同硬件上编译运行                     |
| **多任务**   | 不存在——你的`while(1)` 独占 CPU                | 调度器自动分配时间片，多个程序"同时"跑               |
| **内存安全** | 全靠程序员不越界——写飞一个指针直接覆盖外设寄存器 | MMU 隔离——你的程序崩溃不影响其他程序，也不影响内核 |
| **并发模型** | 中断服务函数 + 全局标志位                          | 多进程/多线程 + 同步原语（锁、信号量）               |
| **调试方式** | JTAG/SWD 硬件调试器，依赖芯片厂商工具              | `gdb` + 日志 + core dump，工具链更通用             |
| **开发效率** | 40 行硬件初始化 / 10 行业务逻辑                    | 10 行代码完成全部任务                                |

这些差异的根源只有一个：**裸机程序是整块芯片的唯一居民；OS 环境下的程序是硬件资源的租户。** 作为租户，你不需要（也不能）直接管理硬件——那是房东（内核）的事。

### 1.3.4 多任务：裸机手动切换 vs OS 进程抽象

LED 闪烁和串口输出的对比展示了硬件抽象的差异。但操作系统的核心价值远不止"帮你封装寄存器"——**更重要的是，它改变了你组织程序结构的方式。**

考虑这个场景：让两个任务"同时"运行——任务 A 每秒在串口输出 `"Tick"`，任务 B 每三秒翻转 LED。

**在裸机上，你必须手动实现任务切换：**

```c
// [OS 职责] 为两个任务各分配一个独立的栈
#define STACK_SIZE 256
uint8_t stack_a[STACK_SIZE];
uint8_t stack_b[STACK_SIZE];

// [OS 职责] 保存/恢复 CPU 上下文的结构体
typedef struct {
    uint32_t r4, r5, r6, r7, r8, r9, r10, r11;
    uint32_t sp;   // 栈指针
    uint32_t lr;   // 返回地址（即任务被中断时的 PC）
} context_t;

context_t ctx_a, ctx_b;

// [OS 职责] 上下文切换——这是最核心也是最脆弱的代码
__attribute__((naked))
void context_switch(context_t *from, context_t *to) {
    __asm__ volatile(
        "push {r4-r11, lr}      \n"  // 保存当前任务的寄存器
        "str   sp, [r0, #32]    \n"  // 保存栈指针到 from->sp
        "ldr   sp, [r1, #32]    \n"  // 从 to->sp 恢复栈指针
        "pop  {r4-r11, pc}      \n"  // 恢复目标任务的寄存器并跳转
    );
}

// [OS 职责] SysTick 定时器中断——调度器的"心跳"
void SysTick_Handler(void) {
    static int tick = 0;
    tick++;
    if (tick % 100 == 0)           // 每 100 次 SysTick 切换一次
        context_switch(&ctx_a, &ctx_b);
    else if (tick % 100 == 50)
        context_switch(&ctx_b, &ctx_a);
}

// [应用逻辑] 任务 A：每秒输出 Tick
void task_a(void) {
    while (1) {
        uart_puts("Tick\n");
        for (volatile int i = 0; i < 1000000; i++);  // 忙等延时
    }
}

// [应用逻辑] 任务 B：每三秒翻转 LED
void task_b(void) {
    while (1) {
        *GPIOC_ODR ^= (1 << 13);
        for (volatile int i = 0; i < 3000000; i++);
    }
}
```

这份代码超过 60 行，其中 45 行是在做"基础设施"——栈管理、上下文切换、定时器中断。而且它极其脆弱：栈溢出会静默 corrupt 另一个任务的上下文；忘记保存任何一个寄存器就会导致任务恢复时随机崩溃；忙等延时浪费了 100% 的 CPU 周期。

**在 OS 上，两个进程各写各的，完全不需要知道对方存在：**

```c
// 进程 A：每秒输出 Tick
int main(void) {
    while (1) {
        printf("Tick\n");
        sleep(1);
    }
}

// 进程 B：每三秒翻转 LED（另一个独立的 .c 文件）
int main(void) {
    while (1) {
        system("echo 1 > /sys/class/leds/user-led/brightness");
        sleep(3);
        system("echo 0 > /sys/class/leds/user-led/brightness");
        sleep(3);
    }
}
```

然后编译成两个独立可执行文件，在 shell 中先后台运行：

```sh
$ ./task_a &
$ ./task_b &
```

不到 10 行代码。内核替你管理了：进程创建、时间片调度、栈管理、上下文切换、阻塞睡眠。更关键的是——如果进程 A 崩溃（比如写入了一个空指针），进程 B 不受任何影响。在裸机上，任务 A 的一个越界写入可能直接覆盖任务 B 的栈，导致整个系统不可预测地崩溃。

### 1.3.5 操作系统到底解决了什么问题

回到本节开头的问题：操作系统到底是什么？

**操作系统是一组在你和硬件之间运行的系统软件。它解决四个问题：**

1. **资源复用（Multiplexing）** — 一个 CPU 跑出"多个程序同时运行"的假象。通过调度器快速切换进程，通过虚拟内存让每个程序以为独占全部内存。
2. **隔离保护（Isolation）** — 程序 A 的 bug 不波及程序 B。通过 MMU 做地址空间隔离，通过特权级（user/supervisor/machine）阻止用户程序直接操作硬件。
3. **硬件抽象（Abstraction）** — `printf("hello")` 不关心输出目标是串口、屏幕还是网络终端。驱动 + 文件系统 + syscall 接口构成了一个"硬件无关"的编程环境。
4. **服务接口（Interface）** — 程序通过 syscall 请求内核服务（读文件、创建进程、分配内存），内核在更高特权级执行这些操作后返回结果。这个接口定义了 OS 的"性格"——POSIX 是 Unix 系 OS 的通用接口，Win32 是 Windows 的接口。

> **对零基础自学者的启示：** 如果你有 STM32 裸机经验，以上四个概念你已经在无意中实践了一部分——只不过是你自己在做 OS 的工作。你写的 `uart_putc()` 是硬件抽象层；你手动分配的 `stack_a[]` 和 `stack_b[]` 是资源复用；你写的 `SysTick_Handler` 是最原始的调度器。本课程的目标，就是让你把这些"人肉 OS"变成真正的、结构化的、可验证的系统软件。
>
> 接下来的 10 个阶段，你会从"写一个程序"切换到"写一个能让其他程序运行的程序"。这个视角的转变，是操作系统学习中最关键的一步。读完本章、做完 Lab 1 后，你将决定你的 OS 解决这四个问题的具体方式——选哪种内核架构、定义什么 syscall 接口、承诺什么隔离强度。后续每一章的"从裸机看 XXX"段落，会逐一展示这四个抽象在启动、内存、中断、文件系统中的具体体现。

## 1.4 这门课不教什么

说清楚，免得你误判。

不教 Linux 内核源码阅读。你的 OS 和 Linux 没什么关系，除了你可能在 ArchitectureSeed 中声明借鉴了它的某些概念。

不教你从零写汇编。你会在启动阶段写几十行汇编入口代码，但不需要先成为汇编专家。

不教你成为 C 语言高手。清晰的、能正确表达设计意图的 C 代码，胜过技巧性的、让人看不懂的 C 代码。

但有一件事你必须愿意做：在想不清楚的时候停下来，画张图，写段 Spec。闷头写代码碰运气，在 OS 开发中不好使——因为 OS 的 bug 往往在你写代码几个小时后才炸，你几乎不可能单靠"让代码跑起来"来定位根因。

## 1.5 课程怎么组织的

十个阶段，大致对应一个 OS 从无到有的自然生长顺序。

阶段 1 定义你要构建什么。阶段 2 让内核启动，输出第一行字。阶段 3 管理内存。阶段 4 响应中断。阶段 5 让用户程序跑起来——这是最长的阶段，涉及 trap、进程、syscall、调度。阶段 6 让数据持久化。阶段 7 决定你的 OS 以什么方式把系统能力暴露给用户程序——这也是你架构中最核心的分叉路口。阶段 8 注入个性——通过方向组合定义你的 OS 的多维剖面。阶段 9 移植到真实硬件（选做）。阶段 10 建立验证体系——不变量检查器、证据管理、验证密度。Final Lab 综合验收与答辩。

每个阶段有一章 Book（你现在正在读的东西）和一张 Lab 卡片。Book 告诉你这个阶段的设计空间、历史背景和原理——帮你理解"为什么"和"有什么选择"。Lab 卡片告诉你要产什么规格文件、跑什么命令、通过什么门禁。

> **⚡ 挑战路线提示：** 本课程的设计对零基础和有经验的学生都适用。如果你有 OS 开发经验，可以在某些阶段跳过基础实现直接挑战更高难度的版本（具体见各章的"挑战路线"标注）。阶段 8 的方向组合机制让你通过多方向交织构建更独特的内核，而不是把它变成"附加项目"。

## 1.6 和传统 OS 实验最大的不同

传统的 OS 实验基本上是：教师给你一个半成品的框架，你把空缺的函数填上，跑通预设的测试，结束。

VeriSpecOSLab 的做法是反过来的。

**先写规格。** 这个模块管理什么状态？这个操作的前提条件是什么？后置条件是什么？什么不变量必须始终成立？

**再按规格实现。** AI 可以在受控边界内辅助——审查你的规格是否完整、根据规格生成候选实现、诊断崩溃原因——但不能替你写规格，也不能在没有规格的情况下替你写核心代码。

**最后验证你的实现是否满足规格。** 验证不止是跑测试。你还写不变量检查器——在系统运行时持续检查关键性质是否保持。你写跨模块的组合不变量——"当进程 A 试图读取进程 B 的内存时，一定会被拒绝"。

这套做法的核心信条是：**以规格约束 AI，以验证保障正确，以架构设计训练系统掌控能力。**

## 1.7 本指导书怎么用

四本手册，各司其职。

**Book（你在读的）** 在每个阶段之前读。它告诉你这个阶段在 OS 构建中处于什么位置、要解决什么问题、设计空间长什么样、有什么历史渊源。不要跳着读——阶段 3 的内存管理假设你已经理解了阶段 2 的启动过程。

**Labs** 在你理解了设计空间之后打开。它列出你这个阶段要写的 Spec 文件、要实现的代码、要跑的命令。Lab 不解释"为什么"——那是 Book 的活。Lab 只解释"做什么"和"怎么验证"。

**Specs 手册** 在你写规格时随时查阅。教你 ArchitectureSeed / ModuleSpec / OperationContract / GoalValidationContract 分别怎么写。

**Appendices** 是工具参考。vos 命令怎么用、QEMU 怎么调、GDB 怎么设断点、RISC-V 的 CSR 寄存器速查表。

日常节奏大概是：打开 Book 理解设计空间（30-60 分钟），打开 Lab 写 Spec 文件（1-3 小时），跑 vos spec lint 检查格式，按 Spec 写代码（2-4 小时），跑验证命令（30-60 分钟），更新 AI 协作日志（10 分钟）。

### AI Agent 的角色

除了四本手册，这门课还有一个独特的工具：项目级 AI Agent（基于 `vos-agent`）。它不是通用聊天 AI——它受三层约束：

1. **身份（Identity）** — 决定 Agent 扮演什么角色。Lab 1 阶段主要用到 `knowledgebase.v1`（设计问答）。
2. **能力包（Capability Pack）** — 限制 Agent 能调用哪些工具、能读写哪些路径。
3. **阶段门禁（Stage Gate）** — 根据你当前所处的实验阶段，动态开放或关闭 Agent 的能力。阶段 1 只开放知识库查询，不允许生成代码或规格；阶段 2 起逐渐开放代码生成和规格审查；到阶段 5 之后，Agent 可以在你写好规格的前提下生成候选实现。

这三层约束的核心目的：**让 AI 帮你思考，但不替你思考。** Agent 可以解释不同 ISA 的差异、对比语言的优劣、审查你的规格格式——但它不会替你决定架构、不会在没有规格的情况下替你写代码、不会跳过你的独立思考过程。

Agent 依赖你导入的知识库（KB）来回答问题。KB 是你的 Agent 的"记忆"——只有你导入的资料，Agent 才能在设计问答中引用。每个阶段开始前导入该阶段需要的参考资料，不要一次性导入所有，避免检索质量下降。

> **详细操作**：Agent 的 Provider 配置、验证和 Lab 1 阶段的使用边界见 [Lab 1 实验卡片](../labs/lab1-seed.md) 的"步骤 3：配置 Agent"。

## 1.8 开始之前

确认你的环境：

对 RISC-V 不熟的话，花半小时浏览 [RISC-V 参考](../appendices/riscv-reference.md)，不需要背，混个脸熟就行。

准备好了？继续往下读——下一节进入设计空间，开始定义你的操作系统。

---

## 1.9 为什么先设计再写代码

"我还没写一行代码，先花一整天写文档？"

是的。这一天是你整个课程中投资回报率最高的一天。

理由不在于"文档很重要"这个老生常谈。真正的原因更具体：操作系统的各个子系统是深度耦合的。你在阶段 3 选择的分页模型会影响阶段 5 的 trap 路径设计。你在阶段 1 写的资源模型路线会影响阶段 7 的 syscall ABI 和用户库。一个月后你发现阶段 5 和阶段 3 的设计打架，回头改——成本是现在的十倍。

ArchitectureSeed 不是"交作业"。它是你的设计锚点，从 Lab 1 的身份信息开始，随每个 Lab 逐步长出完整的设计图景。每次你发现自己在两个可行方案之间纠结的时候，回到 ArchitectureSeed 看你的 goals 和 constraints，答案通常就在那里。

**Seed 是逐步生长的，不是一次填满的。** 在 Lab 1 就要求你决定内核架构、参考系统和设计目标有三个问题：没有上下文的选择只能是猜（你连分页机制都没见过就要判断"参考 Sv39 还是 5-level paging"）；早期决策推翻时没有记录机制（代码改了但 seed 没人更新）；一次性填满像填表（学生倾向于把 seed 当成作业模板而不是设计工具）。正确的做法是：Lab 1 只填身份信息（项目名、平台、语言），后续每个 Lab 在真正面对设计问题时才填写对应的 seed 字段——你写下的每个决策都绑着一个你亲手撞过的墙。

## 1.10 你要回答的四个核心问题

### 1.10.1 问题一：你的 OS 的职责边界在哪？

每个 OS 都在三个维度上做文章。

**资源抽象与复用。** CPU 只有一个（或几个），跑的程序有几十个。你怎么让每个程序都"觉得"自己独占 CPU？基本思路是快速切换——一个程序跑几毫秒，然后切换到下一个。切换太快了，人类感知不到。内存也是——物理内存是一块连续的 RAM，但每个程序有自己的"虚拟地址空间"，看到的是连续的、私有的内存。

**隔离与保护。** 资源复用产生了新问题：程序 A 怎么保证程序 B 不会偷看它的内存？答案是硬件机制——MMU（内存管理单元）把每个程序的"虚拟地址"翻译成"物理地址"的过程中，检查权限。程序 A 的虚拟地址 X 映射到物理地址 Y，程序 B 的虚拟地址 X 映射到物理地址 Z——各自以为自己在同一个地址，实际上被硬件强制分离。

**服务与接口。** 用户程序怎么请求内核做事？它不能直接操作硬件——那会绕过所有保护机制。所以有一个 syscall 接口——用户程序通过一条特殊指令（RISC-V 的 `ecall`）"叫"内核，内核在更高特权级执行请求，然后返回结果。这个接口的设计决定了你的 OS 的"性格"——它暴露了什么抽象？隐藏了什么细节？

你的 ArchitectureSeed 不需要在"资源复用"上标新立异——快速切换这个思路是共享的。你的设计选择主要落在"隔离的强度"和"接口的形态"上。

### 1.10.2 问题二：你的 OS 为什么而存在？

**教学目的。** 你的 OS 存在是为了让你学会系统设计的原理。这意味着"代码清晰"比"跑得快"优先级高。你可能会做一个效率不高的分配器、一个简单的调度器——只要它们的设计理由在你的 ADR 中说清楚了，这就够了。

**兼容目的。** 你的 OS 运行已有程序。这意味着你被锁入了那个已有系统的 ABI——它的 syscall 编号、它的可执行格式、它的错误码语义。有好处：你的 OS 一诞生就有一个软件生态。也有代价：你继承了那个 ABI 的历史包袱。

**安全目的。** 你的 OS 提供可论证的隔离或安全保证。你可能需要 capability 系统、形式化验证的子集、信息流控制。这条路需要的理论基础最多，但产出也最具说服力。

**性能目的。** 在某个指标上做到接近或超过参考系统。你需要细致的 benchmark、系统性优化、可能牺牲代码清晰度。

这些目标可以共存但要排优先级。阶段 5 你发现一个"教学清晰"和"兼容 POSIX"冲突的设计选择——怎么办？如果你在 ArchitectureSeed 中写了"教学目标优先于兼容目标"，答案就已经在那里了。

### 1.10.3 问题三：你的 OS 跑在什么上？

RISC-V 64 + QEMU `virt` 是本课程的技术默认。但这不意味着你被绑死在 RISC-V 上。你的 ArchitectureSeed 中的 `target_platform` 字段可以声明任何 ISA——你只需要理解不同 ISA 之间的关键差异。

**三大 ISA 的关键差异，对你的 OS 设计的影响：**

| 维度       | RISC-V 64                | AArch64 (ARMv8)           | x86-64                               |
| ---------- | ------------------------ | ------------------------- | ------------------------------------ |
| 特权级     | M/S/U 三级，清晰分层     | EL3/EL2/EL1/EL0 四级      | Ring 0/1/2/3，历史包袱重             |
| 页表       | Sv39 (3级)，规范约100页  | VMSAv8-64 (4级)，规范复杂 | 4-level PML4，历史兼容多             |
| 中断控制器 | PLIC（平台级），简单清晰 | GICv3/v4，功能丰富但复杂  | APIC/x2APIC，最复杂                  |
| syscall    | `ecall` 指令，统一入口 | `svc` 指令，统一入口    | `syscall`/`sysenter`，历史遗留多 |

#### 1.10.3a 同一操作在三 ISA 上的汇编对比

表格告诉你"有什么不同"，但没有告诉你"不同意味着什么"。下面用三个 OS 核心操作，并列展示 RISC-V 64、x86-64、AArch64 的汇编写法——每个例子刻意挑了能暴露 ISA **设计哲学差异**的场景。你不需要现在就完全理解每条指令，只需要感受三种 ISA 在"如何跟硬件对话"这个问题上的不同态度。

**操作 1：原子自旋锁获取（compare-and-swap 模式）**

自旋锁是内核中最基础的同步原语——用一条原子指令同时完成"读旧值、比相等、写新值"。三种 ISA 的实现方式暴露了它们对"原子性"的根本分歧。

```asm
# === RISC-V 64: LR/SC（Load-Reserved / Store-Conditional）===
# 哲学：RISC。分成两条指令——先"预订"地址，再"有条件"写入。
# 如果两次指令之间该地址被其他核碰过，SC 失败，重试。
    li    t0, 1                # 锁的"已持有"值
try:
    lr.w  t1, (a0)            # LR：读锁的当前值，并"预订"该地址
    bne   t1, zero, try       # 非零 = 已被持，自旋等待
    sc.w  t2, t0, (a0)        # SC：尝试写入 1。成功→t2=0，失败→t2≠0
    bnez  t2, try             # SC 失败（被其他核打断），重试
    # 关键：LR/SC 之间只能放寄存器指令——不能有 load/store，否则必失败
    # 这个约束是 RISC 哲学：硬件不替你管理复杂事务

# === x86-64: lock cmpxchg（单指令原子比较交换）===
# 哲学：CISC。一条指令完成全部——硬件锁住总线或缓存行，保证原子。
    mov   eax, 0              # eax = 期望值（锁空闲）
    mov   edx, 1              # edx = 新值（锁持有）
lock cmpxchg [rdi], edx       # 原子：if [rdi]==eax then [rdi]←edx; 否则 eax←[rdi]
    jnz   spin                # ZF=0 说明 [rdi]≠eax，即锁已被他人持，自旋
    # 关键：lock 前缀是 CISC 精华——单条指令，硬件替你处理一切原子性细节
    # 代价：lock 前缀隐含着完整的内存屏障（比 RISC-V LR/SC 更重）

# === AArch64: LDAXR/STLXR（Load-Acquire Exclusive / Store-Release Exclusive）===
# 哲学：显式内存顺序。LR/SC 的基础上，把 acquire/release 语义嵌入指令名。
    mov   w0, #1               # 锁的"已持有"值
try:
    ldaxr w1, [x2]            # Load-Acquire Exclusive：读 + 获取语义（后续读写不能前移）
    cbnz  w1, try             # 非零 = 已被持，自旋
    stlxr w3, w0, [x2]        # Store-Release Exclusive：写 + 释放语义（之前读写不能后移）
    cbnz  w3, try             # STLXR 失败，重试
    # 关键：ldaxr/stlxr 内置内存屏障——acquire 防止临界区内操作被重排到锁之前，
    # release 防止临界区内操作被重排到解锁之后。RISC-V 需要额外的 fence 指令。
```

**为什么这个例子暴露了 ISA 哲学差异？**

|                   | RISC-V                                  | x86-64                                 | AArch64                                  |
| ----------------- | --------------------------------------- | -------------------------------------- | ---------------------------------------- |
| 原子模型          | LR/SC：乐观、分割、硬件简单             | `lock cmpxchg`：悲观、一体、硬件复杂 | LDAXR/STLXR：分割但带内存顺序语义        |
| 内存屏障          | 显式`fence rw,rw`（程序员决定顺序）   | `lock` 隐含全屏障（硬件替你做）      | 指令名内嵌 acquire/release（语义最清晰） |
| 对后续 Lab 的影响 | Lab 4 写自旋锁时，你需要手动加`fence` | 不需要额外屏障                         | 需要理解 acquire/release 语义            |

**操作 2：设置内核页表并刷新 TLB**

启用分页后，修改页表必须通知 CPU "你缓存的地址翻译过期了"——即 TLB 刷新。三种 ISA 的 TLB 维护机制差异是 Lab 3（内存管理）的核心知识点。

```asm
# === RISC-V 64：satp + sfence.vma ===
# Sv39 分页：物理页号右移 12 位后填入 PTE。satp 存根页表物理地址。
    li    t0, 0x80000000      # 根页表物理地址（假设在 0x8000_0000）
    srli  t0, t0, 12          # satp.PPN = 物理地址 >> 12（Sv39 格式）
    li    t1, (8 << 60)       # MODE=Sv39（8），ASID=0
    or    t0, t0, t1
    csrw  satp, t0            # 写 satp：此后所有地址走页表翻译
    sfence.vma zero, zero     # 刷新全部 TLB（所有 ASID，所有虚拟地址）
    # 关键：sfence.vma 一条指令刷全部 TLB。简洁，但无"只刷单页"的硬件保证
    # （规范允许实现刷全 TLB。想刷单页需 sfence.vma addr, asid——但硬件可能忽略）

# === x86-64：CR3 + invlpg ===
# 4-level paging：PML4 基地址写入 CR3。invlpg 刷单个地址，写 CR3 刷全部。
    mov   rax, cr3            # 读当前 CR3（保留低 12 位标志）
    mov   rax, 0x80000000     # PML4 基物理地址（不需移位——x86 用完整物理地址）
    mov   cr3, rax            # 写 CR3 = 刷新全部 TLB（除 global 页）
    # 或：invlpg [0xFFFF8000]  # 只刷新虚拟地址 0xFFFF8000 的 TLB 条目
    # 关键：x86 给你两个粒度——全刷（写 CR3）和单地址刷（invlpg）。
    # 这是 x86 的"历史包袱"变优点：几十年的兼容需求催生了精细控制。

# === AArch64：TTBR0_EL1 + TLBI ===
# VMSAv8-64：两个页表基址寄存器——TTBR0（用户）和 TTBR1（内核），各管一半地址空间。
    msr   TTBR0_EL1, x0       # x0 = 用户态根页表物理地址（含 ASID）
    msr   TTBR1_EL1, x1       # x1 = 内核态根页表物理地址
    tlbi  vmalle1             # 刷新当前 EL 的所有 TLB（所有 ASID、所有 VA）
    # 或：tlbi vae1, x2        # 只刷新 VA=x2 的条目（按地址）
    # 或：tlbi aside1, x3      # 只刷新 ASID=x3 的条目（按进程）
    # 关键：TLBI 指令族极其丰富——全刷/按地址/按 ASID/按 VMID（虚拟机），
    # 反映了 ARM 的设计场景：从嵌入式到服务器，TLB 维护需求差异巨大。
```

**为什么这个例子暴露了 ISA 哲学差异？**

|                | RISC-V                                               | x86-64                                                   | AArch64                                                    |
| -------------- | ---------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| 页表根         | `satp`：一个寄存器，MODE+ASID+PPN 打包             | `CR3`：PCID+物理地址，不打包                           | `TTBR0_EL1` + `TTBR1_EL1`：用户/内核各有自己的根       |
| TLB 刷新的粒度 | `sfence.vma`：简洁，但粒度由实现定义               | `invlpg`（单地址）+ `mov cr3`（全刷）                | `TLBI` 指令族：全刷/按地址/按ASID/按VMID                 |
| 设计哲学       | "规范尽量短"——给你最少必要指令，硬件实现可自由优化 | "给你两个旋钮"——几十年的兼容压力催生了精细但杂乱的接口 | "覆盖所有场景"——TLB 管理是为从 IoT 到 HPC 的全谱系设计的 |

**操作 3：完整 syscall 调用约定——传 3 个参数给内核**

前两个操作聚焦硬件机制，这个聚焦接口契约：用户程序如何把参数安全地传给内核？syscall 指令除了切换特权级，还偷偷做了什么？

```asm
# 场景：调用 write(1, "Hello", 5) —— 向 fd=1 写 5 字节
# 三个参数：fd=1 → 第一个参数寄存器
#           buf 地址 → 第二个参数寄存器
#           len=5 → 第三个参数寄存器
# syscall 编号（write=64）→ 编号寄存器

# === RISC-V 64 ===
    li    a0, 1               # 参数 1: fd=1 (stdout)
    la    a1, hello_str       # 参数 2: buf = "Hello" 的地址
    li    a2, 5               # 参数 3: len=5
    li    a7, 64              # syscall 编号: write=64 (Linux RISC-V)
    ecall                      # trap 到 S-mode
    # ecall 不修改任何寄存器——返回后 a0=返回值，a7 不变
    # 优雅：ecall 是纯"切换特权级"操作，无副作用

# === x86-64 ===
    mov   rdi, 1              # 参数 1: fd=1
    lea   rsi, [rip+hello_str]# 参数 2: buf 地址 (RIP-relative)
    mov   rdx, 5               # 参数 3: len=5
    mov   eax, 1               # syscall 编号: write=1 (Linux x86-64)
    syscall                     # trap 到 Ring 0
    # ⚠ syscall 的隐藏副作用：
    #  - RCX ← 下一条用户指令地址 (RIP 被保存)
    #  - R11 ← RFLAGS（标志寄存器被保存）
    #  如果你在 syscall 前把重要值放在 rcx 或 r11——它们被覆盖了
    #  这是 x86-64 的历史包袱：syscall 用 RCX/R11 做内部中转

# === AArch64 ===
    mov   x0, #1               # 参数 1: fd=1
    adr   x1, hello_str        # 参数 2: buf 地址 (PC-relative)
    mov   x2, #5               # 参数 3: len=5
    mov   x8, #64              # syscall 编号: write=64 (Linux AArch64)
    svc   #0                   # 异常级别切换到 EL1
    # svc 本身不修改通用寄存器——返回后 x0=返回值
    # SVC 的立即数 #0（0~65535）可用于区分 syscall 类型，但 Linux 只用 #0
    # 然后用 x8 区分具体调用
```

**为什么这个例子暴露了 ISA 哲学差异？**

|                | RISC-V                                   | x86-64                                     | AArch64                            |
| -------------- | ---------------------------------------- | ------------------------------------------ | ---------------------------------- |
| 参数寄存器     | `a0`-`a5`（6 个），多余走栈          | `rdi/rsi/rdx/r10/r8/r9`（6 个）          | `x0`-`x5`（6 个），多余走栈    |
| 编号寄存器     | `a7`（独立于参数）                     | `rax`（第一个参数也用 rax 的场合需小心） | `x8`（独立于参数）               |
| syscall 副作用 | **无**——ecall 不碰任何通用寄存器 | **有隐式 clobber**——RCX/R11 被覆盖 | **无**——svc 不碰通用寄存器 |
| 设计哲学       | "syscall 指令只做一件事"                 | "syscall 指令是历史演化的产物"             | "干净的分界——svc 只切换异常级别" |

> **对后续 Lab 的影响**：Lab 2（启动）你需要写对应 ISA 的汇编入口；Lab 4（中断）你需要写自旋锁并根据 ISA 决定是否需要 `fence`；Lab 3（内存管理）你需要理解 TLB 刷新指令并正确使用。届时回到这里查阅你用的 ISA 的指令模式和哲学约束。

### 1.10.4 问题四：用什么语言写你的内核？

内核可以用多种系统编程语言编写。没有一种在所有维度上最优——你的选择取决于你最看重什么。本节先把 C、C++、Rust (no_std)、Zig 放在同一张表里对比，再用同一个真实 OS 任务（物理页分配器）展示四种语言的写法差异，最后说明从"普通开发"切换到"OS 开发"时每种语言丢了什么、保留了什么。

#### 1.10.4a 四种语言宏观对比

| 维度                | C                                        | C++                                                                      | Rust (no_std)                                               | Zig                                                             |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------- |
| 内存安全            | 完全依赖程序员纪律                       | 同 C；智能指针需自己实现（或无 STL 不可用）                              | 编译期所有权+借用检查杜绝 use-after-free 等整类 bug         | 编译期无所有权检查；`defer`、`@setRuntimeSafety` 等防御工具 |
| OS 开发需禁用的特性 | 无（语言本身极简）                       | 异常（`-fno-exceptions`）、RTTI（`-fno-rtti`）、STL 容器             | `std` 全部不可用，仅 `core`；需自定义 `panic_handler` | `std.os`/`std.fs` 不可用；`std.heap` 需自备分配器         |
| OS 开发可用的特性   | 全部语法 + 指针 + 预处理器               | 类 + 模板（头文件） +`constexpr` + placement `new` + `static_cast` | 所有权模型 + trait + 模式匹配 +`core::fmt`                | `comptime` + `defer`/`errdefer` + 内建交叉编译            |
| 代表项目            | Linux、xv6、FreeBSD、seL4                | SerenityOS、Haiku、Fuchsia（部分）、ChromiumOS 固件                      | Redox（微内核）、Tock（RTOS）、rCore、Theseus               | Bun（JS 运行时）、TigerBeetle（金融 DB）                        |
| 构建系统            | Make/CMake/Meson                         | CMake/Meson（C++20 modules 尚不成熟于交叉编译）                          | Cargo +`rustup target add`                                | `build.zig` 可编程构建；`zig cc` 可编译 C                   |
| 交叉编译            | 手动安装目标工具链                       | 同 C（如`riscv64-elf-g++`）                                            | `rustup target add` 一行                                  | `zig build -Dtarget=riscv64-freestanding` 零配置              |
| 学习曲线            | 语法简单（~32 关键字），UB 陷阱多        | 语法庞杂，OS 环境下需"减法思维"                                          | 所有权+借用+生命周期需数周适应                              | 语法中等，`comptime` 是独特优势                               |
| 适合你的场景        | 想把精力全花在 OS 设计上；参考资料最丰富 | 已有 C++ 基础，想用 RAII/模板减少重复代码                                | 想用编译器消灭内存 bug；愿投入时间学所有权                  | 想要一流交叉编译体验；对前沿工具链感兴趣                        |

选择什么语言，在 ArchitectureSeed 的 `constraints` 字段中声明。无论选什么，内核都需要与硬件直接交互——这是所有语言的共同挑战。

#### 1.10.4b 同一内核任务在四种语言中的写法

下面用一个真实的 OS 任务做对比：**物理页分配器的 freelist 实现**。这个任务涉及链表操作、裸指针、类型转换、空值处理和内存清零——正是内核编程的日常。

每个实现暴露了该语言在内核环境中的核心设计模式。

```c
// ========== C ==========
// 语言不介入。freelist 节点直接复用空闲页本身——零开销但零检查。
struct page { struct page *next; };
static struct page *freelist;

void *kalloc(void) {
    if (!freelist) return NULL;
    struct page *p = freelist;
    freelist = p->next;
    // [危险] 隐式整数→指针转换；编译器不校验 4096 是否合法长度
    for (int i = 0; i < 4096 / sizeof(int); i++)
        ((int *)p)[i] = 0;
    return p;
}

void kfree(void *pa) {
    // [危险] void * → struct page * 无条件强制转换
    struct page *p = (struct page *)pa;
    p->next = freelist;
    freelist = p;
}
```

```cpp
// ========== C++ ==========
// 有 RAII 和模板，但 freestanding 下 STL 不可用；静态转换提供类型安全的强制转换。
struct Page { Page *next; };
static Page *freelist = nullptr;    // nullptr 替代 NULL，类型安全

void *kalloc() {
    if (!freelist) return nullptr;
    Page *p = freelist;
    freelist = p->next;
    // static_cast 在编译期检查合理性（void * → int * 会警告）
    for (size_t i = 0; i < 4096 / sizeof(size_t); i++)
        reinterpret_cast<size_t *>(p)[i] = 0;
    return static_cast<void *>(p);
}

void kfree(void *pa) {
    Page *p = static_cast<Page *>(pa);  // 优于 C 风格强制转换：只做一种转换
    p->next = freelist;
    freelist = p;
}
// 注：freestanding 下 operator new/delete 未定义，不能 new Page
```

```rust
// ========== Rust (no_std) ==========
// unsafe 必须显式标注；Option 强制处理空值；write_bytes 是 safe 替代 memset。
struct Page { next: Option<*mut Page> }
static mut FREELIST: Option<*mut Page> = None;

unsafe fn kalloc() -> Option<*mut u8> {
    let p = FREELIST?;                     // Option 自动处理 None 返回
    FREELIST = unsafe { (*p).next };        // 解引用裸指针必须 unsafe
    unsafe { core::ptr::write_bytes(p as *mut u8, 0, 4096) };
    Some(p as *mut u8)
}

unsafe fn kfree(pa: *mut u8) {
    let p = pa as *mut Page;
    unsafe { (*p).next = FREELIST; }
    FREELIST = Some(p);
}
// 注：unsafe 块可精确到单行——其余 safe Rust 代码编译器保证无 UB
```

```zig
// ========== Zig ==========
// 类型转换显式且分场景（@ptrCast/@alignCast/@as）；orelse 处理空值；@memset 内建。
const Page = struct { next: ?*Page };
var freelist: ?*Page = null;

fn kalloc() ?[*]u8 {
    const p = freelist orelse return null;  // orelse：空值短路返回
    freelist = p.next;
    @memset(@as([*]u8, @ptrCast(p))[0..4096], 0);
    return @ptrCast(p);
}

fn kfree(pa: [*]u8) void {
    const p: *Page = @ptrCast(@alignCast(pa));  // @alignCast：对齐断言
    p.next = freelist;
    freelist = p;
}
// 注：所有强制转换编译期验证——@ptrCast 不允许去除 const，@alignCast 不允许未对齐
```

**四种实现的关键差异：**

| 关注点   | C                                      | C++                                                             | Rust (no_std)                                         | Zig                                                       |
| -------- | -------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| 空值处理 | `NULL`（宏），易与整数 0 混淆        | `nullptr`（关键字），类型安全                                 | `Option<T>`，强制处理 `None`                      | `?*T`（可选类型），`orelse` 短路                      |
| 类型转换 | `(T *)ptr` 无条件强制转换            | `static_cast`（编译期限制）/ `reinterpret_cast`（位重解释） | `as`（简单转换）/ 裸指针转换仅限 `unsafe`         | `@ptrCast`/`@alignCast`/`@as` 分场景，编译期验证    |
| 安全标注 | 无——所有代码都"不安全"               | 无——但`static_cast` 比 C 强转安全                           | `unsafe { }` 精确到行，其余代码受编译器保证         | 无——但`defer` 和 `@setRuntimeSafety` 提供运行时防御 |
| 链表表达 | `struct page *next`（指针可为 NULL） | `Page *next`（`nullptr` 比 NULL 清晰）                      | `Option<*mut Page>`（类型系统强制检查空指针）       | `?*Page`（可选指针，`orelse` 简洁表达"空则退出"）     |
| 内存清零 | `for` 循环手动写零                   | 同 C（`memset` 需要自己提供或链接 libc）                      | `core::ptr::write_bytes`（safe 替代 memset）        | `@memset`（内建，编译期校验长度和类型）                 |
| 入口函数 | `void kernel_main()`，零仪式感       | `extern "C" void kernel_main()`，需处理全局构造函数           | `#[no_mangle] pub extern "C" fn kernel_main() -> !` | `export fn kernel_main() callconv(.C) noreturn`         |

#### 1.10.4c 从普通开发到 OS 开发：四种语言的关键差异

如果你已经用 C/C++/Rust/Zig 写过用户态程序，本节告诉你切换到内核开发时什么东西不能用了、什么东西还能用。以下用"✗ 丢失"标记不可用特性，用"✓ 保留"标记仍然可用的特性。

**C**

| ✗ 丢失                                                               | ✓ 保留                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `#include <stdio.h>` / `<stdlib.h>` / `<string.h>` —— 无 libc | 全部语法：`struct`、指针、`union`、`enum`、`volatile`、`inline` |
| `malloc()` / `free()` —— 你就是分配器                           | 预处理器：`#define`、`#ifdef`、`#include`（仅头文件）               |
| `printf()` —— 需要自己写 UART 输出                                | `__attribute__`（`packed`、`aligned`、`naked`、`section`）      |
| 线程（`pthread`）—— 你就是调度器                                  | 内联汇编：`__asm__ volatile(...)`                                       |

编译标志：`-ffreestanding -nostdlib`。这两个标志告诉编译器"没有宿主 OS，没有标准库"，禁止它自动链接 `libc` 或生成依赖 OS 的代码。

**C++**

| ✗ 丢失                                                                          | ✓ 保留                                                         |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `#include <iostream>` / `<vector>` / `<string>` / `<memory>` —— 无 STL | 类、继承、虚函数（vtable 需自己管理）                           |
| `new` / `delete` —— 需自己提供 `operator new`                            | 模板（头文件）：`template<typename T>` 全部可用               |
| 异常（`try`/`catch`/`throw`）—— `-fno-exceptions`                      | `constexpr` / `consteval` / `static_assert`（编译期计算） |
| RTTI（`typeid`/`dynamic_cast`）—— `-fno-rtti`                            | `static_cast` / `reinterpret_cast`（优于 C 风格强制转换）   |
| 全局构造函数自动调用 —— 需手动遍历`.init_array` 段                           | RAII 模式（手动管理：构造时获取资源，析构时释放）               |
| `std::thread` / `std::mutex` —— 无宿主线程                                 | placement`new`：在已分配内存上构造对象                        |

编译标志：`-ffreestanding -nostdlib -fno-exceptions -fno-rtti`。如果你用虚函数，需要确保链接脚本包含 `.rodata`（vtable 存放处）。全局对象的构造函数存放在 `.init_array` 段——你需要在 `kernel_main` 早期遍历并调用它们。

**Rust**

| ✗ 丢失                                                                             | ✓ 保留                                                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `std::Vec` / `std::Box` / `std::String` / `std::println!` —— 全部 `std` | `core`（永远可用）：`Option`、`Result`、`Iterator`、`core::fmt::Write`       |
| `std::thread` / `std::sync` —— 无宿主线程                                     | 所有权 + 借用检查（编译器保证内存安全）                                                |
| `std::fs` / `std::net` —— 无宿主文件系统和网络栈                              | 模式匹配、trait、泛型、`unsafe` 精确边界                                             |
| 默认`panic_handler` —— 需自定义（通常写 `"PANIC"` 到 UART 然后 `loop {}`）  | `#![no_std]` + 可选 `extern crate alloc`（需提供全局分配器后可用 `Box`/`Vec`） |
| `fn main()` —— 入口改为 `#[no_mangle] pub extern "C" fn kernel_main()`        | 内联汇编：`core::arch::asm!` 宏                                                      |

`Cargo.toml` 中设置 `panic = "abort"`。`#![no_std]` 放在 `main.rs` 第一行。如需堆分配，引入 `extern crate alloc` 并实现 `#[global_allocator]`。

**Zig**

| ✗ 丢失                                                             | ✓ 保留                                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------- |
| `std.os` / `std.fs` / `std.Thread` —— 无宿主 OS 抽象        | `comptime`（编译期代码执行——链接脚本、常量计算）     |
| `std.debug.print()` —— 需自己写 UART 调试输出                   | `defer` / `errdefer`（资源清理不遗漏）               |
| `std.heap.GeneralPurposeAllocator` —— 需自己提供底层页分配      | `@memset` / `@memcpy`（内建内存操作）                |
| `std.ArrayList` / `std.StringHashMap` —— 需 `std.heap` 支持 | `@ptrCast` / `@intFromPtr` / `@as`（显式类型转换） |
| 链接 libc（自动）—— freestanding 目标不链接                       | `@setRuntimeSafety(true)`（调试构建开启边界/溢出检查） |
|                                                                     | 内联汇编 + 交叉编译零配置                                |

构建命令：`zig build -Dtarget=riscv64-freestanding -Doptimize=ReleaseSmall`。`freestanding` 目标自动禁用 OS 依赖。链接脚本可在 `build.zig` 中用 `exe.setLinkerScriptPath()` 指定。

> **四语言共同点**：无论你选哪种语言，内核入口都是 `extern "C"` 调用约定，都需要自己管理物理内存和页表，都需要直接操作 MMIO 寄存器，都需要理解链接脚本和内存布局。语言决定了你用什么工具应对这些挑战——是被编译器拦住（Rust）、被显式转换提示（Zig）、还是全凭自己（C/C++）。

#### 1.10.4d 构建系统对比

同一个 RISC-V 64 内核的交叉编译，四种语言的最小构建配置：

```makefile
# === C/C++: Makefile（~15 行）===
CC       = riscv64-unknown-elf-gcc
CXX      = riscv64-unknown-elf-g++
CFLAGS   = -march=rv64gc -mabi=lp64d -mcmodel=medany -nostdlib -ffreestanding -O2
CXXFLAGS = $(CFLAGS) -fno-exceptions -fno-rtti
LDFLAGS  = -T kernel/link.ld

kernel.elf: kernel/src/entry.o kernel/src/main.o
	$(CXX) $(LDFLAGS) -o $@ $^
# C++ 注：-fno-exceptions -fno-rtti 必加；链接用 g++ 以支持 C++ 符号
# C/C++ 共用工具链：riscv64-unknown-elf-gcc/g++ (需手动安装)
```

```toml
# === Rust: Cargo.toml（~10 行配置）===
[package]
name = "my-os"
edition = "2021"

[profile.dev]
panic = "abort"

[profile.release]
panic = "abort"
opt-level = "s"
# 编译：cargo build --target riscv64gc-unknown-none-elf
# 交叉编译：rustup target add riscv64gc-unknown-none-elf（仅需一行）
```

```zig
// === Zig: build.zig（~20 行）===
const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .riscv64,
        .os_tag = .freestanding,
    });
    const exe = b.addExecutable(.{
        .name = "kernel",
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = .ReleaseSmall,
    });
    exe.setLinkerScriptPath(b.path("kernel/link.ld"));
    b.installArtifact(exe);
}
// 编译：zig build -Dtarget=riscv64-freestanding
// 交叉编译：零配置——Zig 自带所有目标平台的编译器
```

关键差异：

| 关注点         | Make (C/C++)                            | Cargo (Rust)                  | build.zig (Zig)                    |
| -------------- | --------------------------------------- | ----------------------------- | ---------------------------------- |
| 交叉编译       | 手动安装`riscv64-unknown-elf-gcc/g++` | `rustup target add` 一行    | 零配置，Zig 自带所有目标           |
| C++ 额外 flags | `-fno-exceptions -fno-rtti`           | 不适用                        | 不适用                             |
| 链接脚本       | 外部`.ld` + `-T` 参数               | 外部`.ld` + `build.rs`    | 可在`build.zig` 中动态生成或引用 |
| 学习成本       | 低（Makefile 语法有坑：tab vs space）   | 低（TOML 直观，Cargo 封装好） | 中（需理解 Zig 构建模型）          |

> 无论你选哪种语言，以上每种构建方式都能产出可启动的 `kernel.elf`。选择让你最舒服的工具链——你最不想在 Lab 2 调试启动时才发现构建系统有问题。

#### 1.10.4e 多语言混合开发：边界与权衡

以上四节都假设你只用一种语言写整个内核。但越来越多的真实 OS 项目采用多语言混合策略——不同模块用不同语言，各取所长。本节展示三种典型混合模式作为对比参考。

> **课程定位**：Lab 1 鼓励你选择一种主力语言走完全程——先理解 OS 开发的本质。阶段 8（个性化剖面）是引入第二种语言的自然时机——届时你已经有完整的内核可以评估"哪个模块最适合用另一种语言重写"。如果从 Lab 1 就开始混合开发，构建系统和 FFI 调试会占据你大量时间，而你不是来学 FFI 的。

**模式 1：C 核心 + Rust 安全封装（Linux 内核路线）**

Linux 6.1+ 在 `rust/` 目录下引入了 Rust 支持，标志着工业级内核开始接纳内存安全语言。核心思路：C 驱动通过 `bindings.rs`（由 `bindgen` 从 C 头文件自动生成）暴露给 Rust；Rust 模块通过 `extern "C"` 导出符号给 C。

```
┌──────────────────────────────────┐
│  Rust 驱动 / 安全模块             │  ← 新代码：编译器保证内存安全
│  （unsafe 块仅限 FFI 边界）       │
├──────────────────────────────────┤
│  C 核心（调度器 / MM / VFS）      │  ← 现有代码：继续用 C
│  通过 bindings.rs 暴露 API        │
└──────────────────────────────────┘
```

最小 FFI 示例——Rust 调用 C 的 `kalloc`：

```c
// kernel/kalloc.c —— C 侧
void *kalloc(void) { /* ... */ }
```

```rust
// kernel/rust/my_driver.rs —— Rust 侧
extern "C" { fn kalloc() -> *mut core::ffi::c_void; }

fn allocate_buffer() -> Option<&'static mut [u8]> {
    let ptr = unsafe { kalloc() };  // unsafe：仅 FFI 边界（编译器不验证 C 侧的语义）
    if ptr.is_null() { return None; }
    // 数据进入 Rust 侧后，所有权和借用规则接管——以下代码全是 safe Rust
    Some(unsafe { core::slice::from_raw_parts_mut(ptr as *mut u8, 4096) })
}
```

关键原则：**unsafe 只出现在 FFI 边界**——Rust 调用 C 函数的地方。一旦数据进入 Rust 侧，所有权和借用规则接管，其余代码全是 safe Rust。Rust 侧要额外声明 `unsafe` 使用策略：每个 FFI 调用上方的注释解释 C 侧的安全契约（如"kalloc 返回的内存至少 4096 字节且对齐到页边界"）。

**模式 2：C/C++ 核心 + Zig 构建系统**

Zig 的 `zig cc` 可以作为 C 编译器的替代品——它内部是 clang，但自带所有交叉编译目标，不需要手动安装 `riscv64-unknown-elf-gcc/g++`。`build.zig` 同时编译 C 和 Zig 源码，统一管理依赖和链接。

```zig
// build.zig —— 同时编译 C 和 Zig，一个命令产出 kernel.elf
exe.addCSourceFiles(&.{
    "kernel/src/entry.S",
    "kernel/src/main.c",
    "kernel/src/kalloc.c",
}, &.{"-ffreestanding", "-nostdlib", "-O2"});
exe.addZigSourceFile("kernel/src/uart.zig");       // 也可以用 Zig 写驱动
```

构建一行命令：`zig build -Dtarget=riscv64-freestanding`。优势：零配置交叉编译 + `comptime` 可在编译期生成链接脚本，替代脆弱的 Makefile。

**模式 3：汇编入口 + 内核语言 + 用户态自由选择**

不管内核选什么语言，`_start` 入口几乎总是汇编。启动后各层可以独立选语言：

| 层            | 典型选择             | 理由                                                                         |
| ------------- | -------------------- | ---------------------------------------------------------------------------- |
| 启动入口      | 汇编（目标 ISA）     | 设置栈指针、保存固件参数——这些操作用高级语言无法表达                       |
| 内核核心      | C / C++ / Rust / Zig | 控制硬件、管理内存——需要裸指针和 MMIO                                      |
| 用户库 (libc) | C / Zig              | 封装 syscall。内核暴露的是 C ABI，C 最直接                                   |
| 用户程序      | 任意语言→静态 ELF   | 只要能生成 RISC-V ELF，Python/C#/Go 都行（前提是语言有 bare-metal 编译后端） |

**混合策略的权衡：**

| 考虑维度   | 单一语言                 | 混合开发                                                                           |
| ---------- | ------------------------ | ---------------------------------------------------------------------------------- |
| 构建复杂度 | 低——一套工具链         | 中到高——需 FFI 绑定生成（`bindgen`/`cbindgen`）或统一构建系统                |
| 安全隔离   | 依赖语言本身的能力       | 可在安全语言和不安全语言间建立**显式边界**——比单语言的 `unsafe` 块更清晰 |
| 调试难度   | 一种调试器、一种调用约定 | 跨语言栈回溯、ABI 对齐——调试成本显著增加                                         |
| 参考资料   | 单一语言社区             | 需理解两种语言的 FFI 约定和 ABI 细节                                               |
| 适合场景   | 学习目的、小规模 OS      | 已有 C 代码库想增量引入 Rust；或想用 Zig 构建但保留 C 核心                         |

## 1.11 ⚡ 挑战：语言选择的深层影响

以下内容面向有 OS 开发经验或追求更深设计理解的学生。

### C++ 内核中，哪些 C++ 特性是"安全的"？

`constexpr` 和 `static_assert` 是零成本抽象——编译器在编译期求值，不产生运行时开销。模板（头文件形式）可以替代很多 C 宏的场景——类型安全的链表、编译期大小的环形缓冲区——但模板实例化会增加代码体积。RAII 的析构函数需要你手动管理调用时机（freestanding 下没有自动栈展开）。虚函数需要确保 vtable 放在 `.rodata` 段且在分页启用后仍可读。**选择 C++ 写内核的核心原则：只用编译期特性和零成本抽象，不用任何依赖运行时支持的特性。**

### Rust 内核中，`unsafe` 的边界在哪里？

所有 MMIO 操作、页表操作、上下文切换都是 `unsafe`。但如果你的 `unsafe` 块太大（一个 `unsafe` 包裹了整个 `syscall` 函数），你实际上放弃了 Rust 的安全保证。如果你用 Rust 写内核，你的 ArchitectureSeed 应该声明 `unsafe` 的使用策略——每个 `unsafe` 块应最小化，并在文档注释中解释为什么编译器不能证明这段代码的安全性。

### Zig 内核中，`comptime` 如何改变构建系统？

Zig 允许你在编译期执行代码。你可以在编译期生成链接脚本、计算对齐、配置内存布局，而不是写脆弱的 Makefile 魔法。

## 1.13 预览：ArchitectureSeed 会变成什么样
**在 Lab 1，你只填写身份信息**：项目名、目标平台、编程语言、一句话摘要。goals、non_goals、reference_systems 等深层次字段在后续 Lab 中逐步填充——你一定在真正面对那些设计问题的时候才写，而不是在还没理解分页机制的时候"猜"。

> 📋 **具体操作**：打开 [Lab 1 实验卡片](../labs/lab1-seed.md)，按"步骤 4：创建 Seed 骨架"逐字段填写身份信息，然后运行 `vos spec lint` 和 `vos stage save`。

写完 Seed 身份信息后，可以自问：

- 你的 `architecture_summary` 是空话还是有大致的方向感？（"一个教学用宏内核"好过"一个高效的操作系统"）
- 你选的语言和 ISA 有理由吗？（"因为教程多"是一个好理由；"因为大家都在用"不一定是——你了解过这些人为什么选这个吗？）

## 1.14 常见陷阱

**目标过大。**"我要做一个比 Linux 更好的 OS"——这句话在 ArchitectureSeed 里不能出现。不是因为不对，是因为不可操作。把目标缩小到你能在一学期内验证的程度。

**参考系统写成标签。**"参考 Linux"这句话提供了零信息。Linux 有调度器、VFS、网络栈、内存管理、几百个 syscall——你具体借鉴了哪个子系统、哪个机制？精确到机制层面的借鉴才有设计指导价值。

**拒绝理由空洞。**"拒绝 xv6 的 XXX 因为太复杂"——为什么复杂？是数据结构复杂？是并发控制复杂？还是接口复杂？说清楚复杂度在哪，你的拒绝才有说服力。

**忘了写 non-goals。**只写"我要做 X"不写"我不做 Y"，会在阶段 5 的时候让你在"要不要实现网络栈"这个问题上纠结两天。现在花十分钟写清楚 non-goals。

**验证判据像广告语。**"高度安全"不可测。"任意用户程序无法访问内核物理页"可测。把抽象判断落回具体、可观测的指标。

## 1.15 本章小结

读完这章，你手里应该有：

1. **对"操作系统是什么"的直观理解** — 不只是定义，而是历史脉络（§1.2）和裸机 vs OS 的具体对比（§1.3），包括四个核心职责：资源复用、隔离保护、硬件抽象、服务接口。
2. **对不同 ISA 的差异的感性认识** — 通过表格（§1.10.3）看到特权级、页表、中断模型的宏观差异，通过汇编对比（§1.10.3a）感受同一操作在三种 ISA 上的具体写法差异（MMIO 写、syscall 触发、中断启用）。
3. **对四种语言差异的具体感受** — 通过表格（§1.10.4a）看到 C/C++/Rust/Zig 的宏观差异，通过 freelist 页分配器代码对比（§1.10.4b）看到同一内核任务在四种语言中的数据结构和安全模型差异，通过 OS 开发 vs 普通开发对比（§1.10.4c）看到每种语言切换到内核环境时丢了什么、保留了什么，通过构建系统对比（§1.10.4d）看到四种交叉编译配置。
4. **对 ArchitectureSeed 的预期** — 它不是一次填满的表格，而是随 10 个 Lab 逐步生长的设计锚点（§1.9）。完整的 Seed 示例（§1.12）是你未来的样子；Lab 1 你只填身份信息。
5. **对 AI Agent 角色的认识** — 它受三层约束（Identity / Capability Pack / Stage Gate），帮你思考但不替你思考（§1.7）。

进入 Lab 1 之前，你能回答这几个问题吗：你选的 ISA 的 syscall 指令叫什么？你选的语言在 OS 开发中需要禁用哪些特性（如 C++ 的异常和 RTTI、Rust 的 std）？ArchitectureSeed 的哪些字段在 Lab 1 填、哪些在 Lab 5 填？

能回答，说明本章已经帮你建立了足够的设计视角。打开 [Lab 1 实验卡片](../labs/lab1-seed.md)，开始动手。

下一章：[第 2 章：最小内核启动](ch02-boot.md)
