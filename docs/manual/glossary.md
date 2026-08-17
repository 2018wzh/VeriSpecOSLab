# 术语表

学生版术语表。每个术语标注首次出现的位置，方便按需查阅。课程特有术语（Spec 家族）在 Lab 1 参考卡中也有说明。

## 课程特有术语

| 术语 | 含义 | 首次出现 |
| --- | --- | --- |
| DesignSpec | 系统级设计规格，记录目标、语言、ISA、内核组织、QEMU、canonical board 与组合不变量 | 第 1 章 §1.1 / Lab 1 |
| ModuleSpec | 模块级规格，描述稳定 ID、等级、purpose、owns、接口、性质、错误、状态与不变量 | 第 2 章 §2.6 / Lab 2 |
| InterfaceSpec | 跨边界规格，描述 syscall、IPC、驱动或 ABI | 第 2 章 / Lab 2 |
| GoalSpec | 可选目标规格，描述性能、兼容性、形式化等目标 | 第 8 章 / Lab 8 |
| SpecPatch | 跨模块语义变化的补丁规格，记录 changes 与受影响模块 | 第 2 章 §2.6 / Lab 2 |
| owns | ModuleSpec 中声明的模块实现与测试的仓库相对路径集合 | 第 2 章 / Lab 2 |
| stable Spec ID | 模块的稳定标识（如 `kernel/boot`），evidence 与 verify 用它建立追溯 | 第 2 章 / Lab 2 |
| clean HEAD | 工作树干净、当前 HEAD 无未提交改动，`vos implement`/`vos verify`/`vos submit` 的前置条件 | Lab 1 |
| pending_human_review | 硬件证据等待人工复核的状态，不能由工具自动置为通过 | 第 9 章 / Lab 9 |
| verifies | `vos.yaml` 中 check target 对稳定 Spec ID 的绑定声明 | 第 2 章 / Lab 2 |
| runner | `vos.yaml` 中描述"用哪个程序、什么参数、什么超时运行"的结构化投影 | 第 2 章 / Lab 2 |
| canonical board | 课程固定的真实硬件目标板（如 VisionFive 2） | 第 1 章 / Lab 1 |
| QEMU 板级移植 | 把 canonical board 的启动链与 SoC 行为实现到 QEMU 源码的流程，不等同于 `vos run qemu` | 第 9 章 / Lab 9 |
| combination invariant | 跨模块组合不变量，DesignSpec 中最多三条 | 第 1 章 / Lab 1 |
| HAL | 硬件抽象层，把平台相关代码与操作系统核心逻辑分开的边界 | 第 2 章 §2.3 维度 5 / Lab 2 |

## 操作系统常用术语

| 术语 | 含义 | 首次出现 |
| --- | --- | --- |
| ISA | Instruction Set Architecture，指令集体系结构（如 RISC-V、x86-64、AArch64） | 第 1 章 |
| HART | Hardware Thread，RISC-V 中对硬件执行线程的称呼（约等于核） | 第 2 章 / 第 4 章 |
| trap | 异常、中断与系统调用统一入口的处理器行为 | 第 2 章 §2.2.7 / 第 4 章 |
| MMIO | Memory-Mapped I/O，把外设寄存器映射到内存地址空间的访问方式 | 第 2 章 §2.2.7 / Lab 2 |
| UART | 通用异步收发器，串口，最常见的调试输出设备 | 第 2 章 §2.2.7 |
| PTE | Page Table Entry，页表项 | 第 3 章 |
| TLB | Translation Lookaside Buffer，地址转换旁路缓存 | 第 3 章 |
| page fault | 页错误，访问未映射或权限不足页面时产生的异常 | 第 3 章 / 第 5 章 |
| inode | 文件系统元数据对象，描述文件的类型、大小与数据块位置 | 第 6 章 |
| buffer cache | 块缓冲缓存，磁盘块与内存之间的缓存层 | 第 6 章 |
| syscall | 系统调用，用户程序请求内核服务的接口 | 第 4 章 / Lab 5 |
| PLIC | Platform-Level Interrupt Controller，平台级中断控制器（RISC-V） | 第 4 章 |
| trampoline | 跳板页，用户页表与内核页表共享的 trap 入口代码页 | 第 5 章 |
| capability | 能力，一种"持有即有权"的资源访问凭证模型 | 第 7 章 |
| fd | file descriptor，文件描述符 | 第 5 章 / 第 7 章 |
| COW | Copy-On-Write，写时复制 | 第 8 章 F3 |
| DTB | Device Tree Blob，设备树二进制，描述硬件拓扑 | 第 9 章 |
| SPL/TPL | 次级/三级程序加载器，U-Boot 前的启动阶段 | 第 9 章 |
| OpenSBI | RISC-V M 模式固件，向 S 模式提供 SBI 服务 | 第 9 章 / 第 2 章 |
| ELF | Executable and Linkable Format，可执行与可链接格式 | 第 2 章 §2.2.5 |
| BSS | 未初始化数据段，启动时清零 | 第 2 章 |
| spinlock | 自旋锁，忙等待式锁 | 第 2 章 / 第 4 章 |
| runner | 见"课程特有术语" | 第 2 章 |
| Worktree | Git 的独立工作目录机制，`vos implement` 在 detached linked worktree 中执行 | Lab 1 |
| evidence | 可追溯的运行证据，绑定 build/HEAD/Spec hash 的日志与产物 | Lab 1 / 第 10 章 |
