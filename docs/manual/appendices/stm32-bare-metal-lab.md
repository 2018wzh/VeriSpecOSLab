# 附录：裸机编程参考 — STM32 与 OS 环境对比

> 本附录为第 1 章「什么是操作系统」一节提供补充参考。以 STM32F103 为例，展示同一任务在裸机和 OS 环境下的代码差异。不需要实际硬件——所有代码均可作为思维实验阅读。

---

## A. 代码标记体系

本附录中的代码使用统一的三类注释标记：

| 标记 | 含义 | 换芯片后 |
|------|------|:------:|
| `[硬件绑定]` | 特定芯片型号的寄存器地址、时钟配置等 | 必须改 |
| `[OS 职责]` | 操作系统存在时由内核/驱动完成的代码 | OS 替你做了 |
| `[应用逻辑]` | 不论裸机还是 OS，你真正的程序意图 | 不用改 |

---

## B. 场景一：LED 闪烁 + 串口输出

让 LED 每秒闪烁一次，同时在串口输出 `"Hello"`。

### B.1 裸机实现（STM32F103）

```c
#include <stdint.h>

// ===== [硬件绑定] 寄存器地址（来自 STM32F103 参考手册 RM0008）=====
// 换 STM32F407: RCC 基址 0x40023800, GPIOC 基址 0x40020800
#define RCC_APB2ENR   (*(volatile uint32_t *)0x40021018)
#define GPIOC_CRH     (*(volatile uint32_t *)0x40011004)
#define GPIOC_ODR     (*(volatile uint32_t *)0x4001100C)
#define USART1_SR     (*(volatile uint32_t *)0x40013800)
#define USART1_DR     (*(volatile uint32_t *)0x40013804)
#define USART1_BRR    (*(volatile uint32_t *)0x40013808)
#define USART1_CR1    (*(volatile uint32_t *)0x4001380C)

// ===== [硬件绑定] 时钟和外设初始化 =====
void clock_init(void) {
    RCC_APB2ENR |= (1 << 2) | (1 << 4) | (1 << 14);  // GPIOA, GPIOC, USART1
}

void gpio_init(void) {
    GPIOC_CRH &= ~(0xF << 20);   // 清除 PC13 配置
    GPIOC_CRH |=  (0x2 << 20);   // 2 MHz 推挽输出
}

void uart_init(void) {
    USART1_BRR = 8000000 / 115200;                    // [硬件绑定] 波特率 = F_CLK / 115200
    USART1_CR1 |= (1 << 13) | (1 << 3) | (1 << 2);   // 使能 USART + TX + RX
}

// ===== [硬件绑定] 外设操作函数 =====
void uart_putc(char c) {
    while (!(USART1_SR & (1 << 7)));  // 等待发送缓冲区空
    USART1_DR = c;
}

void uart_puts(const char *s) {
    while (*s) uart_putc(*s++);
}

// ===== [OS 职责] 忙等延时——浪费 100% CPU =====
void delay(volatile uint32_t n) {
    while (n--) __asm__ volatile("nop");
}

// ===== [应用逻辑] 主函数 =====
int main(void) {
    clock_init();    // [硬件绑定]
    gpio_init();     // [硬件绑定]
    uart_init();     // [硬件绑定]

    while (1) {
        GPIOC_ODR ^= (1 << 13);  // [应用逻辑] 翻转 LED
        uart_puts("Hello\n");    // [应用逻辑] 输出
        delay(500000);           // [OS 职责] 忙等 ~500ms
    }
}
```

**代码构成**：~40 行硬件初始化 / ~10 行业务逻辑。

### B.2 OS 环境等价实现（Linux）

```c
#include <stdio.h>
#include <unistd.h>

int main(void) {
    while (1) {
        FILE *led = fopen("/sys/class/leds/user-led/brightness", "w");
        fputc('1', led); fclose(led);   // LED 亮
        sleep(1);

        led = fopen("/sys/class/leds/user-led/brightness", "w");
        fputc('0', led); fclose(led);   // LED 灭

        printf("Hello\n");              // 串口输出
    }
}
```

**代码构成**：0 行硬件初始化 / ~10 行业务逻辑。可在 x86 PC、ARM 树莓派、RISC-V 开发板上编译运行，无需修改。

### B.3 差异分析

| 维度 | STM32 裸机 | Linux/OS 环境 |
|------|-----------|--------------|
| 硬件访问 | 直接读/写物理寄存器地址 | 通过驱动 + syscall |
| 可移植性 | 绑定 STM32F103 | 同一份源码跨 ISA |
| 延时实现 | 忙等循环，100% CPU | `sleep()` 释放 CPU |
| 代码构成 | 80% 初始化 + 20% 逻辑 | 0% 初始化 + 100% 逻辑 |

---

## C. 场景二：多任务交替运行

两个任务"同时"运行——任务 A 每秒输出 `Tick`，任务 B 每三秒输出状态。

### C.1 裸机实现：手动上下文切换

```c
// ===== [OS 职责] 每个任务独立栈 =====
#define STACK_SIZE 256
uint8_t stack_a[STACK_SIZE], stack_b[STACK_SIZE];

// ===== [OS 职责] CPU 上下文快照 =====
typedef struct {
    uint32_t r4, r5, r6, r7, r8, r9, r10, r11;
    uint32_t sp;   // 每个任务独立栈的关键
} context_t;

context_t ctx_a, ctx_b;

// ===== [OS 职责] 上下文切换（汇编）=====
// 保存当前任务寄存器 → 恢复下一个任务的寄存器
__attribute__((naked))
void context_switch(context_t *from, context_t *to) {
    __asm__ volatile(
        "push  {r4-r11}      \n"
        "str   sp, [r0, #32] \n"
        "ldr   sp, [r1, #32] \n"
        "pop   {r4-r11}      \n"
        "bx    lr             \n"
    );
}

// ===== [OS 职责] SysTick 中断——调度器的"心跳" =====
void SysTick_Handler(void) {
    static int tick = 0;
    tick++;
    if (tick % 200 == 0)      context_switch(&ctx_b, &ctx_a);
    else if (tick % 200 == 100) context_switch(&ctx_a, &ctx_b);
}

// ===== [应用逻辑] 任务 A =====
void task_a(void) {
    int tick = 0;
    while (1) {
        uart_puts("Tick "); uart_putint(++tick); uart_puts("\n");
        for (volatile int i = 0; i < 1000000; i++);  // [OS 职责] 忙等 1s
    }
}

// ===== [应用逻辑] 任务 B =====
void task_b(void) {
    int count = 0;
    while (1) {
        uart_puts("Toggle #"); uart_putint(++count); uart_puts("\n");
        for (volatile int i = 0; i < 3000000; i++);  // [OS 职责] 忙等 3s
    }
}
```

**代码构成**：~55 行基础设施（栈管理 + 上下文切换 + 调度器）/ ~15 行业务逻辑。

**脆弱性分析**：
- 栈溢出 → 静默 corrupt 另一个任务的上下文
- 遗漏寄存器保存 → 任务恢复时随机崩溃
- 忙等延时 → 100% CPU 浪费
- 任务 A 越界写入 → 覆盖任务 B 的栈，整个系统不可预测

### C.2 OS 环境等价实现：两个独立进程

```c
// ========== 进程 A (task_a.c) ==========
int main(void) {
    int tick = 0;
    while (1) { printf("[A] Tick %d\n", ++tick); sleep(1); }
}

// ========== 进程 B (task_b.c) ==========
int main(void) {
    int count = 0;
    while (1) { printf("[B] Toggle #%d\n", ++count); sleep(3); }
}
```

```sh
$ gcc task_a.c -o task_a && gcc task_b.c -o task_b
$ ./task_a & ./task_b &     # 内核自动调度，隔离运行
```

**代码构成**：0 行基础设施 / ~5 行业务逻辑。进程 A 崩溃不影响进程 B——MMU 硬件隔离。

### C.3 差异分析

| 维度 | 裸机手动切换 | OS 进程模型 |
|------|------------|-----------|
| 栈管理 | 手动分配数组 | `fork()` 自动分配 |
| 调度 | 手写 SysTick handler | 内核调度器 |
| 上下文切换 | 手写汇编 | 内核自动完成 |
| 隔离 | 无——同地址空间 | MMU 硬件强制 |
| 崩溃影响 | 全部任务不可预测 | 仅当前进程 |
| 新增任务成本 | ~20 行基础设施 | 0 行——再 fork 一个 |

---

## D. 三个场景揭示的 OS 核心作用

| 裸机痛点 | OS 解决方案 | 对应 OS 子系统 |
|----------|-----------|-------------|
| 寄存器地址绑定芯片 | 驱动抽象层 | 设备驱动 |
| 忙等延时浪费 CPU | 调度器 + 睡眠 | 进程调度 |
| 手动栈分配 | `fork()` + 虚拟内存 | 内存管理 |
| 任务间无隔离 | MMU + 特权级 | 内存管理 + trap |
| 手写上下文切换 | 内核调度器 | 进程管理 |
| 外设操作不可移植 | syscall 接口 | 系统调用层 |

---

## E. 与 ArchitectureSeed 的关联

阅读本附录后，在 Lab 1 的 ArchitectureSeed 中思考以下问题（不需要交出答案，但应体现在 `design_notes` 中）：

1. 你的 OS 至少要抽象掉哪些裸机细节？（至少列 3 条）
2. 你的 OS 在多任务隔离上承诺什么强度？（单地址空间 vs MMU 隔离 vs capability）
3. 如果你的 OS 上运行的程序崩溃了，会影响其他程序吗？你的 ArchitectureSeed 中哪个 goal 或 non-goal 回答了这个？
