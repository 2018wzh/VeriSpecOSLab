# 第 8 章：个性 OS 的多维剖面 — 方向组合与自主进化

> **对应实验**：[Lab 8: 个性 OS 多维剖面](../labs/lab8-personal-goal.md)

## 8.1 你的 OS 不必只有一种个性

你的 OS 已经是一个完整的系统——它能启动、管理内存、响应中断、运行用户程序、持久化数据、通过资源模型暴露系统能力。现在，它需要回答最后一个问题：**它为什么而存在？**

传统 OS 实验到这里就结束了。但 VeriSpecOSLab 的设计哲学是：**一个 OS 的价值不在于它"跑通了"，而在于它做出了什么设计判断、在什么维度上展示了独特性。**

Linux 不是单一个性的 OS。它是宏内核（架构方向），兼容 POSIX（兼容方向），有 CFS/EEVDF 调度器（性能方向），有 SELinux（安全方向），有 eBPF（可扩展方向）。这些方向不是互斥的——它们叠加在一起，定义了 Linux 的多维剖面。

你的 OS 同样可以同时在多个维度上进化。本章不提供"N 选 1"的菜单——它提供的是方向簇和探索维度，以及帮你定义自己剖面的指南。

### 从"路线"到"方向"

旧的 OS 实验会给你一条预设的路线：做网络栈，或者做文件系统优化。你沿着路线走，走到终点。

本章的哲学不同：**方向是你选择的探索维度，路线是你自己走出来的。** 我们提供方向（探索什么维度）、建议步骤（可以从哪里起步）、验证标准（怎么证明你做到了），但你决定：

- 选择哪些方向（数量不限：1 个、3 个、5 个——都可以）
- 每个方向做多深（浅尝辄止地了解？深入掌握？尝试突破已知边界？）
- 方向之间如何叠加（独立推进？深度交织？）

### 历史上的"个性 OS"——当设计者拒绝主流

这些 OS 在商业上都失败了，但它们各自在一个维度上走得比主流 OS 更远。你的个性化目标不一定要"正确"——需要的是清晰的设计判断、诚实的代价说明和可验证的证据。

**Plan 9（Bell Labs, 1992）**：Unix 创造者们重新思考分布式时代的 OS。一切资源通过网络文件共享。商业失败，但"一切皆网络文件"思想影响了后来的云计算架构。

**Singularity（Microsoft Research, 2005）**：内核和驱动全部用 C# 写。没有缓冲区溢出。商业失败，但类型安全内核的思路在 WebAssembly 时代回潮。

**Exokernel（MIT, 1998）**：内核不做抽象，只做资源隔离。应用自选文件系统库。商业失败，但思路在 AWS Nitro 中复活。

**WSL（Microsoft, 2016）**：Windows 内核旁边跑一个 Linux 兼容层。它的剖面是"NT 内核 + Linux ABI 兼容"。这不是"选一条路"——这是两个方向的深度交织。

启示：**一个 OS 的独特价值，往往来自多个方向的交叉处。**

---

## 8.2 六大方向簇

方向按探索维度分为六个簇。每个方向提供建议步骤——这不是你必须照做的清单，而是帮你判断"这个方向大概涉及什么"的参考。你可以跳过某些步骤、深入某些步骤、或在建议步骤之外增加自己的探索。

六个方向簇——功能扩展(F)、兼容实现(C)、专项优化(O)、硬件驱动(H)、前沿探索(X) 和架构设计(A)。A 簇关注"内核代码如何组织和抽象"，与其他簇正交：你可以在做 F/C/O/X 方向的任何阶段引入 A1 的设计方法论。

方向编号方便你在 ProfileSpec 中引用。

### 8.2.0 方向速查总览表

在深入阅读每个方向的详情之前，先通过这张表快速了解全貌。**难度标注**反映的是"对已完成阶段 1-7 的学生而言"的相对挑战；**前置阶段**标注的是"做这个方向之前你的内核至少应该完成到哪一步"。

| ID            | 名称                       | 簇 |       难度       |          前置阶段          | 典型工期 | 关键风险                                     |
| ------------- | -------------------------- | :-: | :--------------: | :------------------------: | :------: | -------------------------------------------- |
| **F1**  | 网络栈                     | F |  ★★☆ medium  |      7（IPC/fd 模型）      |  1-3 周  | TCP 状态机 bug、checksum 遗漏                |
| **F3**  | 图形界面 (GUI)             | F |  ★★☆ medium  |       4（trap/中断）       |  1-3 周  | framebuffer 越界、无输入焦点管理             |
| **F6**  | 写时复制 (COW) Fork        | F |  ★★☆ medium  |       5（fork/页表）       |  1-2 周  | 引用计数泄漏、TLB 一致性                     |
| **F7**  | 按需分页 (Demand Paging)   | F |   ★★★ hard   |       5（页表/exec）       |  2-4 周  | page fault 嵌套、页换出策略振荡              |
| **F8**  | 容器化 / 命名空间          | F |   ★★★ hard   |       7（完整内核）       |  2-4 周  | 隔离泄漏、资源统计偏差                       |
| **F9**  | 可加载内核模块             | F |   ★★★ hard   | 7（完整内核 + ELF loader） |  2-4 周  | 重定位错误、符号冲突、模块签名缺失           |
| **F10** | 权限系统 (ACL/Capability)  | F |   ★★★ hard   |       7（完整内核）       |  2-4 周  | TOCTOU 竞态、权限检查遗漏、SUID 提权持久化   |
| **F11** | 内核线程                   | F |   ★★★ hard   |       5（进程/调度）       |  2-3 周  | 内核栈溢出、调度死锁、与用户线程的同步语义   |
| **F12** | 硬件虚拟化 / Hypervisor    | F | ★★★★ extreme |  7（trap/页表/调度完整）  |  3-6 周  | 二阶段页表错误、虚拟中断遗漏、guest 越权访问 |
| **C1**  | Linux 静态 ELF 兼容        | C | ★★★★ extreme |     6（FS/ELF loader）     |  3-6 周  | ext2 驱动完整度、syscall 语义差异            |
| **C2**  | POSIX 源码兼容             | C |  ★★☆ medium  |     7（完整 syscall）     |  1-3 周  | `off_t` 宽度、`errno` 传递断裂           |
| **C3**  | 多 ISA 移植                | C |   ★★★ hard   |       7（完整内核）       |  2-4 周  | 页表格式差异、内存序模型不同                 |
| **C4**  | Windows NT PE 兼容         | C | ★★★★ extreme |      6（ELF loader）      |  3-6 周  | NT handle 语义、syscall 编号不稳定           |
| **C5**  | macOS Mach-O 兼容          | C | ★★★★ extreme |      6（ELF loader）      |  3-6 周  | dyld 依赖、Mach IPC 复杂性                   |
| **O1**  | 实时性与确定性             | O |   ★★★ hard   |         5（调度）         |  2-4 周  | 优先级反转、测量工具引入延迟                 |
| **O2**  | 极小足迹                   | O |   ★☆☆ easy   |       7（完整内核）       |  3-7 天  | 过度优化破坏可读性、删功能≠优化             |
| **O3**  | 高吞吐 I/O                 | O |  ★★☆ medium  |       6（FS/bio 层）       |  1-3 周  | 零拷贝生命周期管理、DMA 一致性               |
| **O4**  | 安全加固                   | O |  ★★☆ medium  |       7（完整内核）       |  1-3 周  | canary 被信息泄漏绕过、KASLR 熵不足          |
| **O5**  | 极速启动                   | O |   ★☆☆ easy   |       7（完整内核）       |  3-7 天  | 延迟初始化导致竞态、优化变成跳过             |
| **H1**  | USB 设备驱动               | H |   ★★★ hard   |    4（trap/中断/MMIO）    |  2-4 周  | 描述符解析错误、传输超时处理                 |
| **H2**  | PCI 总线枚举与设备驱动     | H |   ★★★ hard   |         4（MMIO）         |  2-4 周  | ECAM 基址平台差异、BAR 类型误判              |
| **H3**  | GPIO 驱动                  | H |  ★★☆ medium  |       4（中断/MMIO）       |  1-2 周  | pinmux 配置错误、中断边沿误判、电平冲突      |
| **H4**  | I2C 总线驱动               | H |   ★★★ hard   |       4（中断/MMIO）       |  2-3 周  | 时钟拉伸超时、多主设备仲裁、10 位地址兼容    |
| **H5**  | SPI 总线驱动               | H |  ★★☆ medium  |       4（中断/MMIO）       |  1-2 周  | CPOL/CPHA 模式错配、CS 切换竞态、全双工同步  |
| **X1**  | Unikernel 形态             | X |   ★★★ hard   |       7（完整内核）       |  2-4 周  | 混淆 unikernel 与单体内核概念                |
| **X2**  | 形式化验证子集             | X | ★★★★ extreme |       3（页分配器）       |  3-6 周  | 验证了错误的性质、模型与代码不一致           |
| **X3**  | 多内核 (Multikernel)       | X | ★★★★ extreme |        5（调度+锁）        |  3-6 周  | 消息传递退化回共享内存                       |
| **X4**  | 微内核重构                 | X | ★★★★ extreme |       7（完整内核）       |  3-6 周  | IPC 开销吞噬性能、服务依赖循环               |
| **X5**  | eBPF 类内核 VM             | X | ★★★★ extreme |       7（完整内核）       |  4-6 周  | verifier 不完整、JIT bug 无崩溃隔离          |
| **X6**  | 持久内存 (PMEM)            | X |   ★★★ hard   |       6（FS/bio 层）       |  2-4 周  | cache flush 遗漏、原子性边界误判             |
| **A1**  | 内核面向对象设计           | A |   ★★★ hard   |       7（完整内核）       |  2-4 周  | 过度设计、vtable 开销、类型系统与 C 的张力   |
| **A2**  | Plan 9 一切皆文件模型      | A | ★★★★ extreme |       7（完整内核）       |  3-5 周  | 文件化性能代价、命名空间膨胀、合成文件兼容性 |
| **A3**  | 异步运行时 (Async Runtime) | A | ★★★★ extreme |       7（完整内核）       |  3-5 周  | 状态机爆炸、取消语义、唤醒丢失               |
| **A4**  | 机制与策略分离             | A |   ★★★ hard   |       7（完整内核）       |  2-4 周  | 过度抽象导致性能退化、边界模糊导致职责混乱   |

> **使用建议：** 先按"前置阶段"筛掉你还不能做的方向；再按"难度"和"工期"评估你的时间预算；最后读你感兴趣的方向详情。**1 个方向做到 mastery 比 3 个方向全是 explore 更有教学价值。**

> **关于 USB/PCI 编号：** USB 和 PCI 设备驱动已从功能扩展簇迁移到硬件驱动簇，统一使用 H1/H2。
>
> **关于多核支持：** 多核是横切关注点，贯穿整个教程——阶段 2 启动多 HART、阶段 3 per-CPU 页分配器、阶段 4 per-HART trap handler 与 IPI、阶段 5 per-CPU 调度队列与内核锁、阶段 6 buffer cache 并发、阶段 7 fd 表与 pipe 并发访问。每个阶段的教学内容已包含对应的多核设计考量。
>
> **关于架构设计簇 (A)：** A 簇关注"你的内核代码如何组织和抽象"，与其他簇正交。A1 以 C 函数指针实现 OOP；A2 探索 Plan 9 的一切皆文件资源模型；A3 引入异步运行时模式管理并发 I/O；A4 落实"机制在内核、策略在用户态"的经典 OS 设计原则。

---

### 8.2.0.1 现代案例库：从真实系统拆出教学目标

前沿案例不是用来贴标签的。写进 ArchitectureSeed 或 ProfileSpec 之前，先把它拆成一个机制、一个代价和一个能跑的验证项。下面这些案例都可以映射到本章已有方向，不需要新增方向编号。

**Rust for Linux / Tock / Theseus：语言安全如何改变内核边界。**

问题：内核里有大量指针、生命周期和并发状态，C 代码把这些责任交给程序员，Rust 则尝试把一部分责任交给类型系统。Rust for Linux 把 Rust 引入 Linux 内核开发；Tock 面向低功耗微控制器，支持多个互不信任的应用；Theseus 用 Rust 探索更细粒度的内核组件边界。

教学目标：不要把目标写成"用 Rust 重写内核"。更合适的目标是选择一个驱动或资源对象，标出所有 `unsafe` 边界，把 MMIO、DMA、引用计数和回调生命周期分别说明白。

最小任务：用 Rust 或伪 Rust 接口包一层 UART/virtio 驱动，要求安全接口外部不能构造悬空指针。

验证证据：`unsafe` 块数量和说明、越界 MMIO 访问被拒绝、驱动卸载后回调不再访问已释放对象。

**CHERI / CheriBSD：指针也可以带权限。**

问题：CHERI 的核心问题不是"怎样让 C 自动安全"，而是把指针变成带边界、权限和不可伪造属性的 capability。CheriBSD 展示了一个 Unix-like OS 如何利用 capability 硬件做内存保护和隔离。

教学目标：把它映射到 F10 权限系统、C3 多 ISA 移植或 O4 安全加固。学生要看见的是"权限跟着引用走"，而不是额外写一个全局权限表。

最小任务：在你的内核里实现一个软件 capability 指针模型，给每个用户 buffer 记录 base、length、permissions，所有 `copyin`/`copyout` 必须通过这个模型。

验证证据：越界读写返回错误，权限降级后的 capability 不能恢复写权限，日志能显示每次失败检查对应的 capability 范围。

**Verus / Atmosphere：验证可以贴近系统代码。**

问题：TLA+、Coq 和 Lean 适合训练规格思维，但学生常常卡在"模型和代码怎么对应"。Verus 把验证放进 Rust 风格的系统代码里，Atmosphere 则探索用 Rust 做可实践的内核验证。

教学目标：把它作为 X2 的现代入口。不要验证整个页分配器，先验证一个小的页状态转换函数。

最小任务：验证 `free -> allocated`、`allocated -> free` 两个转换保持"同一页不会同时在 freelist 和 allocated set 中"。

验证证据：Verus 或等价工具通过；如果工具链不可用，则提交精确的规格、状态转移表和一组能覆盖反例的运行时断言。

**Linux EEVDF：调度不只是在谈公平。**

问题：CFS 强调虚拟运行时间，EEVDF 进一步引入 eligible 和 virtual deadline，用来处理公平性和延迟之间的张力。

教学目标：把它映射到 O1 实时性与确定性，或阶段 5 的调度挑战。学生要比较的是长期公平和短期唤醒延迟，而不是复刻 Linux。

最小任务：在 Round-Robin 之外实现一个玩具版虚拟 deadline 调度器，给交互进程更短的 slice，记录每个进程的 lag 和 deadline。

验证证据：同等权重进程长期 CPU 占比接近；短 slice 进程的唤醒延迟 P95 低于 Round-Robin；吞吐下降写入 negative_tradeoff。

**eBPF verifier：先证明不会出事，再谈快。**

问题：eBPF 的教学价值不在 JIT，而在 verifier。一段用户提交的字节码为什么能在内核态运行而不直接写坏内存，这才是核心。

教学目标：X5 的最小目标应该先做解释执行和静态检查，JIT 只作为进阶。

最小任务：实现 8-12 条指令、固定寄存器、固定栈大小、无循环的字节码解释器，并在加载前检查控制流、栈访问范围和最大指令数。

验证证据：无限循环、越界栈访问、未初始化寄存器读取都被拒绝；合法程序能统计 syscall 次数。

**MirageOS / Unikraft：library OS 不是把用户程序塞进内核。**

问题：MirageOS 和 Unikraft 都把应用和所需 OS 组件组合成专用镜像，但重点不同。MirageOS 强调类型安全和库化组件，Unikraft 强调可裁剪、快速启动和云环境部署。

教学目标：把它映射到 X1 Unikernel、O2 极小足迹和 O5 极速启动。学生要解释少掉用户态隔离后，系统用什么约束错误代码。

最小任务：把一个固定 hello 或 echo 应用和最小 UART/内存初始化链接成单一镜像，同时保留传统 syscall 版本作对照。

验证证据：镜像大小、启动时间、syscall/function-call 延迟对比，以及一段明确说明：少掉用户态隔离后的隔离代价。

**参考资料：** Rust for Linux 文档，Tock OS 文档，Theseus OSDI 2020 论文，CheriBSD 项目页，Verus 项目列表，Linux EEVDF 文档，Linux eBPF verifier 文档，MirageOS 文档，Unikraft 项目页。

---

### 8.2.1 功能扩展簇 (F)：增加新能力

这些方向为你的 OS 增加一项它现在没有的能力。

> **注意：** USB 设备驱动和 PCI 总线枚举已迁移到硬件驱动簇 (H1/H2)。原因是它们与硬件交互的深度远超"增加新能力"的范畴——理解 USB 协议栈和 PCI 枚举需要硬件级的思维方式，与网络栈 (F1) 或 COW Fork (F6) 的设计关注点本质不同。

---

#### F1：网络栈

使你的 OS 能够通过网络与外界通信。

| 属性               | 值                                                |
| ------------------ | ------------------------------------------------- |
| **难度**     | ★★☆ medium                                     |
| **前置阶段** | 阶段 7（IPC/fd 模型）—— socket 是 fd 的自然延伸 |
| **典型工期** | 1-3 周 (mastery)                                  |

**建议步骤：**

1. 实现 virtio-net 驱动（理解 virtio 描述符环、MMIO 寄存器布局）→ 验证：收发 Ethernet 帧
2. 实现 ARP 协议（请求/响应、ARP 缓存表）→ 验证：host 端 `arp -a` 能看到 guest
3. 实现 IP 层（分片重组可跳过，聚焦头部解析和校验和）→ 验证：收发 IP 包
4. 实现 ICMP echo reply → 验证：`ping` 有回复
5. 实现 UDP（socket bind/sendto/recvfrom）→ 验证：UDP echo 程序
6. 实现 TCP（简化版：仅支持单连接、无拥塞控制、无滑动窗口优化）→ 验证：HTTP 请求/响应
7. 融入你的资源模型（fd-based 则实现 socket fd；capability-based 则实现网络 capability）

**验证里程碑：**

| 里程碑 | 验证内容        | 判定标准                                                                  |
| ------ | --------------- | ------------------------------------------------------------------------- |
| M1     | virtio-net 驱动 | `tcpdump` 在 host 端 tap 接口上抓到 guest 发出的 Ethernet 帧            |
| M2     | ARP             | host 端`arp -a` 显示 guest IP 对应的 MAC 地址                           |
| M3     | IP + ICMP       | `ping <guest-ip>` 成功，RTT < 1ms（host↔guest）                        |
| M4     | UDP             | guest 端 UDP echo 服务端与 host 端客户端通信正常                          |
| M5     | TCP + HTTP      | guest 端运行简易 HTTP 服务器，host 端`curl` 获取响应                    |
| M6     | 资源模型集成    | socket fd 可被`read`/`write`/`close` 操作（或通过 capability 调用） |

**correctness_guard：**

- "网络包缓冲区溢出不破坏内核堆——所有包解析有边界检查"
- "ARP 缓存项数量有上限，不会因恶意 ARP 洪泛导致内存耗尽"
- "无效/恶意的 IP 分片不导致内核 panic"
- "TCP 连接关闭后所有资源（缓冲区、fd、端口号）被正确回收"

**benchmark_oracle：**

- `ping` RTT：host↔guest < 1ms（QEMU 虚拟网络）
- TCP 吞吐：`iperf` 或 `nc` 测试 > 10 MB/s
- 连接压力：100 个并发 TCP 连接无资源泄漏（`netstat` 确认）

**常见陷阱：**

1. **virtio 描述符环并发问题。** 设备读和生产者的指针更新之间可能存在竞态，确保使用适当的内存屏障。
2. **checksum 计算遗漏。** IP checksum 只覆盖 IP 头、TCP checksum 覆盖伪头部+载荷——两者的覆盖范围不同，容易混淆。
3. **TCP 状态机不完整。** 即使"简化版"TCP，也必须正确处理 SYN → SYN-ACK → ACK 三次握手和 FIN → FIN-ACK 四次挥手。状态遗漏会导致连接泄漏。
4. **ARP 缓存过期。** 不实现缓存过期会导致 stale 条目永久占用，实现不当的过期会导致 use-after-free。

**GoalValidationContract 骨架：**

```yaml
direction_id: "F1"
category: "feature"
depth: "mastery"
baseline:
  description: "无网络栈，内核仅能通过 UART 与外界通信"
  metrics:
    - { name: "network_stack_exists", value: false }
    - { name: "ping_reply", value: false }
target:
  description: "完整的 virtio-net → ARP → IP → ICMP → UDP → TCP 协议栈，支持 ping 和 HTTP"
  metrics:
    - { name: "network_stack_exists", value: true }
    - { name: "ping_reply", value: true }
    - { name: "tcp_http_response", value: true }
    - { name: "socket_fd_integrated", value: true }
correctness_guard:
  - "所有网络包解析有边界检查，不越界读写"
  - "ARP 表有大小上限和过期机制"
  - "TCP 连接关闭后所有资源被回收"
benchmark_oracle:
  - { name: "ping_rtt", pass_condition: "< 1ms (host↔guest)" }
  - { name: "tcp_throughput", pass_condition: "> 10 MB/s" }
  - { name: "conn_stress", pass_condition: "100 并发连接无泄漏" }
negative_tradeoff_checks:
  - { name: "kernel_image_size", max_allowed: "增长 < 30%" }
  - { name: "boot_time", max_allowed: "增长 < 5%（网络初始化在后台）" }
  - { name: "existing_tests", max_allowed: "100% 通过" }
```

**参考资料：** RFC 791 (IP), RFC 792 (ICMP), RFC 768 (UDP), RFC 793 (TCP), xv6 networking chapter, lwIP 源码, virtio 1.0 规范（网络设备章节）

---

#### F2：图形界面 (GUI)

让你的 OS 显示像素和文字。

| 属性               | 值                       |
| ------------------ | ------------------------ |
| **难度**     | ★★☆ medium            |
| **前置阶段** | 阶段 4（trap/中断/MMIO） |
| **典型工期** | 1-3 周 (mastery)         |

**建议步骤：**

1. 配置 QEMU 帧缓冲：`-device virtio-gpu` 或 `-vga virtio`，通过 MMIO 或 PCI BAR 发现 framebuffer 基址和分辨率（宽度、高度、stride、像素格式）
2. 实现基本绘制原语：像素写入（注意 RGB 通道顺序，常见为 BGR 或 RGBX）、矩形填充、水平/垂直线
3. 点阵字体渲染：嵌入一个简单的等宽位图字体（如 8×16 的 PSF 或自定义 bitmap），将 ASCII 字符转换为像素写入 framebuffer
4. 实现双缓冲避免撕裂：分配后备缓冲区，绘制完成后整帧拷贝到 framebuffer（或翻页切换）
5. 键盘输入路由：将 UART/键盘中断产生的事件路由到 GUI 进程 → 验证：按键显示在屏幕上
6. 实现简单窗口管理器：多个矩形区域独立更新、窗口 Z-order、鼠标点击焦点切换

**验证里程碑：**

| 里程碑 | 验证内容   | 判定标准                             |
| ------ | ---------- | ------------------------------------ |
| M1     | 帧缓冲可用 | 写入像素值，QEMU 窗口显示对应颜色    |
| M2     | 矩形+文字  | 屏幕显示彩色矩形和 "Hello, OS!" 文字 |
| M3     | 键盘回显   | 敲击键盘，字符实时显示在屏幕上       |
| M4     | 窗口管理器 | 两个独立区域各自更新，不互相破坏     |

**correctness_guard：**

- "framebuffer 写入绝不越界——所有像素坐标在绘制前检查边界"
- "GUI 进程崩溃不拖垮内核——绘制操作在内核态有指针验证"
- "用户输入不被非焦点窗口截获（如实现窗口管理器）"

**benchmark_oracle：**

- 帧率：单矩形区域更新 > 30 FPS（QEMU virtio-gpu）
- 视觉验证：截图或人工确认（这是少数无法完全自动化的验证——允许人工确认 + 截图证据）

**常见陷阱：**

1. **framebuffer 越界写入。** stride（行字节数）可能大于 `width × bytes_per_pixel`，直接用 `y × width + x` 计算偏移会写错行。
2. **像素格式混淆。** QEMU 默认可能是 BGR 而非 RGB，也可能是 32 位（含 alpha 通道）而非 24 位。先用已知颜色测试确认。
3. **字体文件链接问题。** 如果用外部字体文件，需要确保链接器正确嵌入二进制数据。建议用 C 数组嵌入小型 bitmap 字体。
4. **无撕裂保证。** 直接写 framebuffer 会导致绘制过程中的中间状态被显示。双缓冲是最小代价的解决方案。

**GoalValidationContract 骨架：**

```yaml
direction_id: "F2"
category: "feature"
depth: "mastery"
baseline:
  description: "仅有串口输出，无图形显示能力"
  metrics:
    - { name: "framebuffer_working", value: false }
    - { name: "text_rendering", value: false }
target:
  description: "QEMU 窗口显示彩色图形和文字，键盘输入可回显"
  metrics:
    - { name: "framebuffer_working", value: true }
    - { name: "text_rendering", value: true }
    - { name: "keyboard_echo", value: true }
    - { name: "double_buffering", value: true }
correctness_guard:
  - "所有像素写入有边界检查"
  - "GUI 崩溃不影响内核其他子系统"
benchmark_oracle:
  - { name: "framerate", pass_condition: "> 30 FPS (单矩形区域)" }
  - { name: "visual_check", pass_condition: "截图显示正确颜色和文字" }
negative_tradeoff_checks:
  - { name: "kernel_image_size", max_allowed: "增长 < 20%（含嵌入字体）" }
  - { name: "existing_tests", max_allowed: "100% 通过" }
```

**参考资料：** QEMU `-device virtio-gpu` 文档, VESA/VBE 规范, Linux fbdev 接口, PSF 字体格式文档

---

#### F3：写时复制 (COW) Fork

`fork()` 时父进程的物理页不立即复制——父子共享只读映射，直到某一方写入时才触发 page fault 进行复制。

| 属性               | 值                      |
| ------------------ | ----------------------- |
| **难度**     | ★★☆ medium           |
| **前置阶段** | 阶段 5（fork/页表操作） |
| **典型工期** | 1-2 周 (mastery)        |

**建议步骤：**

1. fork 时共享页表：子进程的页表直接指向父进程的物理页，PTE 中去掉 Write 权限（父进程的 PTE 也同时去掉 Write 权限）
2. 为每个物理页实现引用计数（`struct page::refcount`）：fork 时 +1，page fault 复制时 -1（或新页 = 1），进程退出时遍历页表 -1，count==0 时真正释放
3. page fault 处理：识别 COW 页（PTE 有效但无 Write 权限、页的 refcount > 1）→ 分配新页 → memcpy → 更新两方 PTE → 原页 refcount -1
4. TLB 一致性：修改 PTE 后立即 `sfence.vma`（或跨 CPU 的 TLB shootdown）
5. 性能对比：`fork` 延迟（COW vs eager copy）、`fork + exec` 的总延迟

**验证里程碑：**

| 里程碑 | 验证内容        | 判定标准                                                          |
| ------ | --------------- | ----------------------------------------------------------------- |
| M1     | COW fork 正确性 | fork 后父子各自写入不同值，读取自己的写入不读到对方的             |
| M2     | 引用计数正确    | 连续 100 次 fork+exit，页分配器 freelist 与初始状态一致（无泄漏） |
| M3     | 性能提升        | COW fork 延迟 < eager copy 的 30%（对于 > 1MB 的进程）            |
| M4     | 压力测试        | `forktest` 风格测试：大量 fork 不 panic                         |

**correctness_guard：**

- "COW fork 后父子进程隔离性与 eager copy 一致——任何一方的写入不泄漏到对方"
- "引用计数不泄漏：持续 fork/exit 后空闲页数与初始一致"
- "refcount 加减操作原子（或持锁），不会因竞态导致 refcount 错乱"

**常见陷阱：**

1. **refcount 竞态。** 多个 CPU 同时 fork 同一个父进程的不同子进程时，同一物理页的 refcount 变化需要原子操作或锁保护。
2. **TLB 遗漏。** COW 页变为独立页后，旧 PTE 可能仍缓存在其他 CPU 的 TLB 中。忘记 `sfence.vma` 导致读到旧内容。
3. **内核页不参与 COW。** 内核栈、页表本身等内核映射不应被 COW——只有用户空间映射参与。错误标记内核页为 COW 导致内核数据被意外修改。

**参考资料：** xv6 COW lab, Linux `copy_page_range()` / `do_wp_page()`, 《Operating Systems: Three Easy Pieces》第 22 章

---

#### F4：按需分页 (Demand Paging)

程序加载时不全部加载到内存——exec 时只映射页表，实际页面在首次访问时通过 page fault 按需加载或分配。

| 属性               | 值                                           |
| ------------------ | -------------------------------------------- |
| **难度**     | ★★★ hard                                  |
| **前置阶段** | 阶段 5（页表/exec）+ 阶段 6（FS/ELF loader） |
| **典型工期** | 2-4 周 (mastery)                             |

**建议步骤：**

1. exec 懒加载：exec 时只解析 ELF header，为每个 PT_LOAD 段创建 VMA（Virtual Memory Area）记录但不立即分配页面和读磁盘。PTE 全部标记为 invalid
2. page fault 处理分类：检查 fault 地址是否在某个 VMA 范围内 → 分配物理页 → 从 ELF 文件偏移读入数据（或 BSS 段填零）→ 更新 PTE → 返回用户态
3. 页换出：物理内存不足时，选择 victim 页写入交换区（或压缩存储），PTE 标记为 swapped out。再次访问时换入
4. 工作集估计：实现简单的 Clock 算法跟踪访问位，选择真正冷页面换出
5. 验证：运行比物理内存更大的程序（如分配 2× RAM 的数组）

**验证里程碑：**

| 里程碑 | 验证内容        | 判定标准                                               |
| ------ | --------------- | ------------------------------------------------------ |
| M1     | 懒加载正确      | 程序启动延迟降低（大程序），执行结果与 eager load 一致 |
| M2     | page fault 路径 | 通过`printk` 或计数器确认页面按需加载                |
| M3     | 内存超分        | 分配 > 物理内存的数组并正确访问（部分页面被换出）      |
| M4     | 压力测试        | 频繁换入换出无 panic、无数据损坏                       |

**correctness_guard：**

- "page fault 处理可与 `usertrap` 路径正交——不破坏已有 trap 逻辑"
- "换出页面的数据完整性：换出 → 换入后内容与原始一致"
- "VMA 查找时不能遍历已释放的 VMA 结构（use-after-free）"

**常见陷阱：**

1. **page fault 嵌套。** 处理 page fault 期间本身触发 page fault（如内核栈不在 TLB 中）。确保内核页表预映射足够覆盖 page fault handler 的代码和数据。
2. **换出策略振荡。** 换出刚换入的页（或反之），导致系统陷入换页风暴。Clock 算法 + 工作集估计是基本防御。
3. **VMA 数据结构设计。** VMA 需要高效的范围查找（fault 地址在哪个 VMA 中），红黑树或 augmented 链表是常见的工程选择。简单的线性遍历在大 VMA 数时性能极差。

**参考资料：** Linux `mm/memory.c` (`handle_pte_fault`/`do_anonymous_page`/`do_swap_page`), 《Operating Systems: Three Easy Pieces》第 21-22 章, xv6 lazy allocation lab

---

#### F5：容器化 / 命名空间隔离

在单个内核实例中创建多个隔离的执行环境，每个环境有自己独立的 PID 空间、文件系统视图和网络栈。

| 属性               | 值                                           |
| ------------------ | -------------------------------------------- |
| **难度**     | ★★★ hard                                  |
| **前置阶段** | 阶段 7（完整内核，特别是进程/FS/网络子系统） |
| **典型工期** | 2-4 周 (mastery)                             |

**建议步骤：**

1. PID namespace：每个 namespace 有独立的 PID 分配器。进程在不同 namespace 中有不同的 PID。`getpid()` 返回当前 namespace 中的 PID。父 namespace 可以看到子 namespace 中的进程（映射为不同的 PID）
2. mount namespace：每个 namespace 有独立的挂载表。`chroot` 风格的根目录切换——进程在 namespace 中看不到 namespace 外的文件
3. network namespace：每个 namespace 有独立的网络接口和路由表。通过 veth pair 连接不同 namespace
4. cgroup 风格资源限制：CPU 时间配额、内存上限、I/O 带宽限制

**验证里程碑：**

| 里程碑 | 验证内容        | 判定标准                                                                   |
| ------ | --------------- | -------------------------------------------------------------------------- |
| M1     | PID namespace   | 两个 namespace 中的进程互相不可见（`kill` 另一个 namespace 的 PID 失败） |
| M2     | mount namespace | namespace A 中`ls /` 看不到 namespace B 独有的文件                       |
| M3     | 资源限制        | CPU 时间限制生效：死循环进程被 throttle 到设定配额                         |

**correctness_guard：**

- "namespace 隔离不可被用户态进程绕过——所有 syscall 的 PID/路径解析都经过 namespace 上下文"
- "父 namespace 中的 root 进程可以管理子 namespace（不创建不可管理的孤儿环境）"
- "资源统计（内存使用、打开文件数）按 namespace 准确计数"

**常见陷阱：**

1. **隔离泄漏。** `/proc` 风格的信息接口可能暴露其他 namespace 的进程信息——确保所有信息查询 syscall 都经过 namespace 过滤。
2. **init 进程问题。** 每个 PID namespace 需要自己的 init 进程（PID 1）来收养孤儿进程。子 namespace 的 init 退出时需要向父 namespace 发送信号。
3. **资源统计偏差。** 共享内核数据结构（如 buffer cache）的统计可能无法按 namespace 精确拆分——明确规定哪些资源是共享的（不计入 namespace 配额）。

**参考资料：** Linux namespaces(7) man page, Linux cgroups(7) man page, Docker/containerd 源码（简化版）, 《Understanding the Linux Kernel》第 3 章

---

#### F6：可加载内核模块 (Loadable Kernel Modules)

让内核在运行时动态加载和卸载代码——设备驱动、文件系统、或任何内核子系统都可以编译为独立模块，按需插入内核。

| 属性               | 值                              |
| ------------------ | ------------------------------- |
| **难度**     | ★★★ hard                     |
| **前置阶段** | 阶段 7（完整内核 + ELF loader） |
| **典型工期** | 2-4 周 (mastery)                |

**建议步骤：**

1. 模块 ELF 加载器：
   - 解析模块 ELF 文件的 section headers，识别 `.text`、`.rodata`、`.data`、`.bss` 段
   - 在内核堆上分配内存存放各段（注意页对齐和权限：`.text` 为 RX，`.rodata` 为 R，`.data`/`.bss` 为 RW）
   - 将各段拷贝到分配的内存中
2. 重定位处理：
   - 解析 ELF 重定位表（`SHT_RELA`），遍历每个重定位条目
   - 对于 RISC-V：处理 `R_RISCV_HI20`/`R_RISCV_LO12_I`/`R_RISCV_LO12_S`（LUI/ADDI/STORE 类指令的地址重定位）、`R_RISCV_CALL_PLT`（函数调用）、`R_RISCV_PCREL_HI20`（PC 相对寻址）
   - 将模块中未解析的符号地址填入对应指令的立即数字段
   - 验证：加载一个只调用 `printk` 的模块，重定位后正确输出
3. 内核符号表导出：
   - 维护内核符号表（symbol → address 映射）：至少包括 `printk`、`kmalloc`/`kfree`、`memset`/`memcpy`、页分配/释放等核心函数
   - 模块加载时，对每个未定义符号查表解析 → 查不到则加载失败
   - 实现 `/proc/ksyms` 或 `lsmod` 命令列出已加载模块及其符号
4. 模块生命周期：
   - `module_init()`：模块加载后调用初始化函数，注册驱动/文件系统等
   - `module_exit()`：模块卸载前调用清理函数，注销已注册的资源
   - 模块引用计数：如果有进程正在使用模块提供的资源（如打开了一个由模块提供的设备文件），拒绝卸载
   - 验证：加载→使用→尝试卸载（应失败）→释放资源→卸载（成功）
5. 模块依赖管理：
   - 模块 A 可以依赖模块 B 提供的符号 → 加载 A 前必须已加载 B
   - 维护模块依赖图（有向无环图）→ 卸载 B 前必须已卸载所有依赖于 B 的模块
   - 检测循环依赖（加载时拒绝）
6. 模块签名验证：使用公钥密码（如 Ed25519）验证模块签名，拒绝加载未签名或签名不匹配的模块
7. 模块崩溃隔离：模块的代码运行在内核态——如果模块 panic，整个内核崩溃。进阶方向：研究如何用页表隔离（如将模块放在独立地址空间）或软件 fault isolation 限制模块崩溃的影响范围

**验证里程碑：**

| 里程碑 | 验证内容           | 判定标准                                                                                               |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------------ |
| M1     | 模块 ELF 加载      | 加载一个只调用`printk` 的模块，内核日志出现模块的输出                                                |
| M2     | 重定位             | 模块调用内核的`kmalloc`/`kfree`，分配和释放内存正常                                                |
| M3     | init/exit 生命周期 | 加载模块 → 模块注册一个`/proc/modtest` 文件 → 读取该文件 → 卸载模块 → `/proc/modtest` 不可访问 |
| M4     | 依赖管理           | 加载依赖 B 的模块 A → 尝试卸载 B（应失败）→ 卸载 A → 卸载 B（成功）                                 |
| M5     | 签名验证           | 未签名模块被拒绝加载；签名错误的模块被拒绝加载                                                         |

**correctness_guard：**

- "模块加载失败不破坏内核状态——所有已分配的内存在加载失败路径上被释放"
- "模块卸载后其所有注册的资源（设备、文件系统、syscall hook）被注销——不遗留悬空指针"
- "重定位写入不越界——每个重定位条目的目标地址在模块的各段范围内"
- "符号查找失败明确报错——不静默使用 NULL 或任意地址"

**benchmark_oracle：**

- 模块加载时间：< 100ms（100KB 模块）
- 模块调用内核函数的开销：与编译进内核的代码相同（直接函数调用，无额外 indirection）
- 符号解析：100 个未定义符号的模块加载时间 < 10ms（哈希表查找）

**常见陷阱：**

1. **重定位类型遗漏。** RISC-V ELF 有多种重定位类型，只用 `R_RISCV_CALL_PLT` 处理函数调用是不够的——全局变量访问需要 `R_RISCV_PCREL_HI20` + `R_RISCV_LO12_I` 对。遗漏某些类型导致模块静默使用错误地址。
2. **符号版本不匹配。** 内核中的 `struct task_struct` 可能在编译模块时和编译内核时的布局不同——如果模块访问了内核数据结构，ABI 兼容性检查是必需的。
3. **模块间依赖的死锁式卸载。** 如果模块 A 依赖 B、B 的 `module_exit()` 又尝试使用 A 的服务——卸载 B 时发生死锁。依赖图必须严格无环。
4. **引用计数竞态。** 检查"模块是否在使用中"和"标记模块为正在卸载"之间存在竞态窗口。需要原子 CAS 操作或锁保护卸载路径。
5. **"复制粘贴式"重定位。** 直接从 xv6 或其他教学 OS 的网络栈复制重定位代码，但不理解 RISC-V 指令编码——`LUI` 的立即数是高 20 位、`ADDI` 的低 12 位是有符号数——符号扩展错误是最常见的重定位 bug。

**GoalValidationContract 骨架：**

```yaml
direction_id: "F6"
category: "feature"
depth: "mastery"
baseline:
  description: "所有内核代码编译进单一镜像，无动态加载能力"
  metrics:
    - { name: "loadable_modules", value: false }
    - { name: "kernel_symbol_table", value: false }
target:
  description: "支持 ELF 模块加载/卸载，符号解析，模块依赖管理"
  metrics:
    - { name: "loadable_modules", value: true }
    - { name: "kernel_symbol_table", value: true }
    - { name: "module_init_exit", value: true }
    - { name: "module_dependency_graph", value: true }
correctness_guard:
  - "模块加载失败路径无内存泄漏"
  - "模块卸载后无悬空资源引用"
  - "重定位写入有边界检查"
  - "符号查找失败明确报错"
benchmark_oracle:
  - { name: "module_load_time", pass_condition: "< 100ms (100KB 模块)" }
  - { name: "symbol_resolution", pass_condition: "100 符号 < 10ms" }
negative_tradeoff_checks:
  - { name: "kernel_image_size", max_allowed: "基础镜像不因模块支持增长 > 10%（符号表除外）" }
  - { name: "boot_time", max_allowed: "增长 < 5%（符号表初始化）" }
  - { name: "existing_tests", max_allowed: "100% 通过" }
```

**参考资料：** ELF64 规范（Section Headers, Relocation），Linux `kernel/module.c`（模块加载主路径），RISC-V ELF psABI（重定位类型定义），Linux `export_symbol` 机制，Ed25519 签名（如使用 libsodium 或 tweetnacl）

---

#### F7：权限系统 (Permission System)

为你的 OS 实现一套超越"owner/group/other + rwx"的权限模型——访问控制列表(ACL)、基于角色的访问控制(RBAC)、或 capability 权限位。这是安全方向 (O4) 在"谁可以做什么"维度的补充——O4 关注内存安全（防溢出、防注入），F10 关注访问控制（防越权）。

| 属性               | 值                                                          |
| ------------------ | ----------------------------------------------------------- |
| **难度**     | ★★★ hard                                                 |
| **前置阶段** | 阶段 7（完整内核——至少需要进程、文件系统和 syscall 框架） |
| **典型工期** | 2-4 周 (mastery)                                            |

**建议步骤：**

1. 基线权限模型审计：记录你的 OS 当前的权限检查点——哪些操作需要权限？权限检查在哪里做？是否一致？
   - 常见检查点：文件 open/read/write/exec、进程 kill/ptrace、设备访问、syscall 调用
   - 验证：列出所有需要权限的操作及其当前检查逻辑
2. 选择权限模型并实现核心数据结构：
   - **ACL 模型**：每个资源（文件、管道、设备）关联一个 ACL 列表。每个 ACL 条目 = (主体类型, 主体 ID, 权限位掩码)。主体类型可以是"用户"、"组"或"角色"
   - **Capability 位图模型**：每个进程持有一个 capability 位图（如 `CAP_SYS_RAWIO`、`CAP_NET_ADMIN`），操作前检查对应位是否置位
   - **混合模型**：文件等被动资源用 ACL，特权操作（如 `kill` 任意进程、加载内核模块）用 capability 位图
   - 验证：创建两个用户 alice 和 bob，为文件设置"alice 可读写、bob 只读"，验证权限生效
3. 权限继承规则：
   - 进程 fork 时：子进程继承父进程的权限集（capability 位图或 UID/GID）
   - 进程 exec 时：是否保留权限？（SUID 位：可执行文件设置了 SUID 时，exec 后进程的有效 UID 变为文件所有者的 UID）
   - 验证：设置 SUID 程序，bob 运行它后可以访问 alice 的私有文件
4. 权限检查集成到资源模型：
   - fd-based 模型：在 `open()` 时检查权限，通过后 fd 持有打开时的权限（后续 `read`/`write` 不再检查）
   - capability-based 模型：capability 本身就编码了权限（如 cap 携带 `CAP_READ` 位）
   - 验证：`open()` 返回的 fd 权限正确——以只读方式打开的文件，通过该 fd 无法写入
5. 角色与组：实现用户组（一组用户共享权限）和角色（一个用户可以拥有多个角色，角色可动态切换）
6. 审计日志：记录所有权限检查失败的操作（谁、在什么时候、尝试做什么、被什么规则拒绝）

**验证里程碑：**

| 里程碑 | 验证内容      | 判定标准                                                 |
| ------ | ------------- | -------------------------------------------------------- |
| M1     | 用户隔离      | alice 创建的文件，bob 无法读取（除非文件权限允许）       |
| M2     | ACL 生效      | 设置 ACL 允许 alice 读写、bob 只读→ bob 写入被拒绝      |
| M3     | SUID          | bob 运行 alice 的 SUID 程序 → 程序临时获得 alice 的权限 |
| M4     | Capability 位 | 无`CAP_NET_ADMIN` 的进程无法创建 raw socket            |
| M5     | 审计          | 权限拒绝事件被记录到内核日志                             |

**correctness_guard：**

- "权限检查不能被绕过——所有资源访问路径经过同一个权限门（不可有后门 syscall）"
- "权限修改（chmod/setfacl）是原子操作——不会出现'改了一半被另一个进程看到中间状态'"
- "进程退出时其权限集被销毁——不泄漏到下个复用 PID 的进程"
- "SUID 程序的权限提升是临时的——程序退出后恢复原权限（不能永久提升）"

**benchmark_oracle：**

- 权限检查开销：`open()` 的 ACL 查找 < 1μs（10 条 ACL 条目）
- capability 位图检查 < 10ns（单个 AND 指令）

**常见陷阱：**

1. **TOCTOU（Time-of-Check-to-Time-of-Use）。** 在 `open()` 时检查了权限，但 `open()` 返回后文件可能被替换（符号链接攻击）。防御：`open()` 使用 `O_NOFOLLOW` 或在内核中原子地完成"检查+打开"。
2. **权限检查遗漏。** 新增 syscall 时忘记加权限检查——这是最常见的权限漏洞。防御：在 syscall 分发表中标记每个 syscall 所需的最小权限，在分派入口统一检查。
3. **SUID 的复杂性。** SUID 程序中调用 `exec()` 执行另一个程序——新程序的权限是什么？（应该是原用户的权限，不是 SUID 的权限）。`system()` 调用中的 shell 转义也是经典攻击面。
4. **ACL 继承混乱。** 在目录下创建新文件时，新文件的 ACL 是从目录继承还是从进程的默认 ACL 继承？两种策略都有道理——关键是选择一种并文档化。

**GoalValidationContract 骨架：**

```yaml
direction_id: "F7"
category: "feature"
depth: "mastery"
baseline:
  description: "仅有简单的 owner/group/other + rwx 或无权限模型"
  metrics:
    - { name: "acl_support", value: false }
    - { name: "capability_bitmap", value: false }
    - { name: "suid_support", value: false }
target:
  description: "ACL + capability 位图 + SUID，权限检查覆盖所有资源访问路径"
  metrics:
    - { name: "acl_support", value: true }
    - { name: "capability_bitmap", value: true }
    - { name: "suid_support", value: true }
    - { name: "permission_gate_coverage", value: "100% syscall 入口" }
correctness_guard:
  - "权限检查不可绕过"
  - "权限修改原子化"
  - "进程退出无权限泄漏"
  - "SUID 临时提升正确恢复"
benchmark_oracle:
  - { name: "acl_lookup", pass_condition: "< 1μs (10 条目)" }
  - { name: "cap_check", pass_condition: "< 10ns" }
negative_tradeoff_checks:
  - { name: "kernel_image_size", max_allowed: "增长 < 10%" }
  - { name: "syscall_latency", max_allowed: "增长 < 5%（权限检查开销）" }
  - { name: "existing_tests", max_allowed: "100% 通过（权限宽松模式下）" }
```

**参考资料：** POSIX ACL (1003.1e), Linux capabilities(7) man page, Windows NT Security Descriptor / ACL 模型, seL4 capability 权限位, 《The Craft of System Security》(Smith & Marchesini)

---

#### F8：内核线程 (Kernel Threads)

让内核自身能够创建和管理独立于用户进程的执行上下文——内核线程运行在内核态，不关联用户地址空间，用于异步任务（writeback、page reclaim）、工作队列（workqueue）、和内核服务（kworker、kswapd）。

| 属性               | 值                               |
| ------------------ | -------------------------------- |
| **难度**     | ★★★ hard                      |
| **前置阶段** | 阶段 5（进程/调度器/上下文切换） |
| **典型工期** | 2-3 周 (mastery)                 |

**建议步骤：**

1. **内核线程创建：** 实现 `kthread_create(entry_func, arg)`——分配内核栈（不同于用户进程，内核线程不需要用户栈和页表），设置陷阱帧使线程在 `entry_func` 中启动，加入调度器。验证：创建内核线程，打印 "kthread running" 并退出
2. **内核线程调度：** 内核线程不与任何用户进程绑定——它只在内核态运行。`swtch()` 可以切换到内核线程（就像切换用户进程的内核线程）。内核线程永不返回用户态（`sret` 不会出现在其路径中）。验证：内核线程可以被抢占和重新调度
3. **工作队列 (Workqueue)：** 实现一个延迟执行框架——`schedule_work(work_fn)` 将工作项加入 per-CPU 工作队列，内核工作线程（kworker）异步执行。验证：提交 3 个工作项，它们在后台按序执行完成
4. **内核线程退出：** `kthread_exit()` 正确回收内核栈和调度资源。内核线程不能调用 `exit()`（那是用户态退出路径）。验证：创建→执行→退出 100 次，无内存泄漏
5. 内核线程与用户进程的同步：内核线程通过 `wake_up`/`sleep_on` 或 `completion`（类似 semaphore）与用户进程协调——如 writeback 线程等待脏页积累到阈值后唤醒

**验证里程碑：**

| 里程碑 | 验证内容          | 判定标准                       |
| ------ | ----------------- | ------------------------------ |
| M1     | 内核线程创建/调度 | kthread 在调度器中可见并被执行 |
| M2     | workqueue         | 提交的工作项在后台异步完成     |
| M3     | 生命周期          | 100 次创建-退出无泄漏          |

**correctness_guard：** "内核线程不能意外访问用户地址空间（其页表不含用户映射）" / "内核线程退出不泄漏内核栈" / "workqueue 中的工作项不可丢失（即使 kworker 被 kill）"

**benchmark_oracle：** `kthread_create` + 首次调度 < 50μs / workqueue 提交延迟 < 10μs

**常见陷阱：**

1. **内核栈溢出。** 内核线程的栈通常只有 2-4 页（8-16 KB），注意函数调用深度和局部变量大小
2. **调度死锁。** 内核线程持有锁时被抢占，抢占它的另一个内核线程需要同一把锁→死锁。规则：内核线程持锁时不睡眠（除非使用 sleeplock 或 mutex）
3. **与用户线程的同步语义。** 内核线程调用 `copyin`/`copyout` 访问用户内存——但内核线程没有"当前用户进程"。需要显式传递目标进程的页表

**GoalValidationContract 骨架：**

```yaml
direction_id: "F8"
category: "feature"
depth: "mastery"
baseline:
  description: "无内核线程支持，所有内核工作同步执行"
  metrics:
    - { name: "kthread_support", value: false }
    - { name: "workqueue", value: false }
target:
  description: "内核线程创建/调度/退出 + workqueue + 与用户进程同步"
  metrics:
    - { name: "kthread_support", value: true }
    - { name: "workqueue", value: true }
correctness_guard:
  - "内核线程不访问用户地址空间"
  - "工作项不丢失"
  - "退出无泄漏"
benchmark_oracle:
  - { name: "kthread_create_latency", pass_condition: "< 50μs" }
negative_tradeoff_checks:
  - { name: "kernel_image_size", max_allowed: "增长 < 5%" }
  - { name: "existing_tests", max_allowed: "100% 通过" }
```

**参考资料：** Linux `kernel/kthread.c`, Linux workqueue (`kernel/workqueue.c`), xv6 `scheduler()` / `swtch()` 源码, 《Understanding the Linux Kernel》第 4 章（内核线程）

---

#### F9：硬件虚拟化 / Hypervisor

让你的 OS 能够在硬件虚拟化支持下运行一个极小 guest。这里的目标不是实现 KVM，也不是直接启动 Linux，而是理解 hypervisor 需要控制哪些边界：guest 物理地址、特权指令、虚拟中断和设备访问。

| 属性               | 值                                                              |
| ------------------ | --------------------------------------------------------------- |
| **难度**     | ★★★★ extreme                                                |
| **前置阶段** | 阶段 7（trap/页表/调度完整）+ C3（如涉及多特权级或多 ISA 细节） |
| **典型工期** | 3-6 周 (mastery)                                                |

**建议步骤：**

1. 确认可用硬件扩展：在 QEMU RISC-V 上启用 H extension，启动时检查 `misa`/设备树或等价配置。验证：内核能明确报告 hypervisor 支持是否可用
2. 建立 guest 上下文：为 guest 准备独立寄存器状态、入口地址、guest 内存区域和虚拟 CPU 结构。验证：能进入 guest 并从一个 `ecall` 返回 host
3. 二阶段地址转换：实现 guest physical address 到 host physical address 的受控映射，只映射 guest 拥有的内存。验证：guest 访问未映射地址触发 fault，由 host 拒绝
4. trap-and-emulate：拦截 guest 的 `ecall`、非法指令、页错误和计时器事件，记录退出原因。验证：每类退出都有可读日志和计数器
5. 最小虚拟设备：先实现一个虚拟 console 或虚拟 timer，不直接透传真实 UART。验证：guest 写 console 字符，host 日志收到相同输出
6. 调度集成：把 vCPU 当作普通调度实体，支持 host 抢占 guest 后再恢复。验证：guest 死循环不阻塞 host shell 或其他进程

**验证里程碑：**

| 里程碑 | 验证内容         | 判定标准                                           |
| ------ | ---------------- | -------------------------------------------------- |
| M1     | H extension 检测 | 启动日志明确显示支持或拒绝进入 F12 路径            |
| M2     | guest 进入/退出  | 极小 guest 执行`ecall` 后回到 host，退出原因正确 |
| M3     | 二阶段页表       | guest 越界访问被 host 捕获，不破坏 host 内存       |
| M4     | 虚拟 console     | guest 输出字符，host 按顺序收到                    |
| M5     | vCPU 调度        | guest 长时间运行时 host 仍可响应计时器和 shell     |

**correctness_guard：**

- "guest 不能读写未分配给它的 host 物理页"
- "所有 guest exit 都有明确原因，不把未知 trap 当作成功执行"
- "guest 关闭中断或死循环不能阻塞 host 调度器"
- "虚拟设备输入输出经过边界检查，不直接暴露 host 内核指针"

**benchmark_oracle：**

- guest exit 计数：运行固定程序时 exit 类型和次数稳定
- trap 往返延迟：记录 `ecall` exit 的平均和 P95 延迟
- 隔离测试：100 次非法 guest 访问后 host 内核无 panic、无内存泄漏

**常见陷阱：**

1. **把 guest physical 当 host physical。** 二阶段页表的意义就是隔离这两层地址。偷懒直接恒等映射会让 guest 越界写 host 内存
2. **过早做设备透传。** PCI/virtio 透传需要 IOMMU、中断重映射和 DMA 隔离。教学版先做虚拟 console，比透传真实设备更容易验证
3. **未知 trap 静默忽略。** hypervisor 最危险的 bug 是把未处理的 guest exit 当作正常返回。未知 exit 应立即停止 guest，并保留日志
4. **目标写得过大。** "启动 Linux guest"包含 boot protocol、virtio、块设备、initramfs 和大量兼容细节。F12 的最小目标是运行自写 tiny guest

**GoalValidationContract 骨架：**

```yaml
direction_id: "F9"
category: "feature"
depth: "mastery"
baseline:
  description: "内核只能运行本机用户进程，不能创建 guest 或 vCPU"
  metrics:
    - { name: "hypervisor_support", value: false }
    - { name: "guest_enter_exit", value: false }
target:
  description: "支持一个 tiny guest：进入/退出、二阶段地址转换、最小虚拟 console、vCPU 调度"
  metrics:
    - { name: "hypervisor_support", value: true }
    - { name: "guest_enter_exit", value: true }
    - { name: "stage2_translation", value: true }
    - { name: "virtual_console", value: true }
correctness_guard:
  - "guest 不能访问未映射 host 内存"
  - "未知 guest exit 会停止 guest 并记录原因"
  - "guest 死循环不阻塞 host 调度"
benchmark_oracle:
  - { name: "ecall_exit_latency_p95", pass_condition: "记录并解释，不要求固定阈值" }
  - { name: "illegal_access_stress", pass_condition: "100 次非法访问后 host 无 panic" }
negative_tradeoff_checks:
  - { name: "kernel_image_size", max_allowed: "增长 < 20%" }
  - { name: "existing_tests", max_allowed: "100% 通过" }
```

**参考资料：** RISC-V Privileged Architecture（Hypervisor extension 章节）, KVM RISC-V 文档与源码, QEMU RISC-V `virt` 机器文档, Firecracker/KVM 架构文档（只借鉴 vCPU/VM 边界，不照搬实现）

---

### 8.2.2 兼容实现簇 (C)：运行另一个软件世界

这些方向让你的 OS 能够运行为其他系统编写的程序。兼容的本质是**在 ABI 层面做翻译**——你的内核学习"说别人的语言"。

---

#### C1：Linux ELF 兼容 — 从真实磁盘镜像启动 Shell

让你的 OS 从一块真实的磁盘镜像上加载 Linux 根文件系统，并启动其中的 Shell。这是对 Linux ABI 兼容性的终极考验——你要跨越的不止是 syscall 兼容性，还要处理真实磁盘文件系统格式、块设备协议和两者之间的整合。

| 属性               | 值                             |
| ------------------ | ------------------------------ |
| **难度**     | ★★★★ extreme               |
| **前置阶段** | 阶段 6（FS/ELF loader/bio 层） |
| **典型工期** | 3-6 周 (mastery)               |

**建议步骤：**

1. 制作 ext2 磁盘镜像：
   - `dd if=/dev/zero of=rootfs.img bs=1M count=64` 创建 64 MB 空镜像
   - `mkfs.ext2 rootfs.img` 格式化为 ext2
   - mount 到 loopback 设备，安装 busybox（静态编译）、`/bin/sh`、`/etc/inittab`、`/dev/console`
   - 通过 QEMU `-drive file=rootfs.img,format=raw,if=none,id=drive0 -device virtio-blk-device,drive=drive0` 挂载为 virtio 块设备
2. 实现 virtio-blk 块设备驱动 → 验证：读取磁盘前几个扇区，识别 ext2 superblock 魔数 (0xEF53)
3. 实现 ext2 文件系统驱动（只读最小集）：
   - Superblock 解析：块大小、inode 数量、块组描述符
   - Inode 读取：解析 inode 结构（模式/大小/数据块指针），处理直接块、间接块、双重间接块
   - 目录遍历：目录项是 `(inode_no, rec_len, name_len, file_type, name)` 的变长链表
   - 路径解析：`/bin/sh` → 根目录 inode(2) → 查找 "bin" → 查找 "sh" → 获得文件 inode
4. 实现基础 Linux syscall 子集（按依赖顺序）：
   - 第一组（进程生命周期）：`exit(93)`, `exit_group(94)`, `getpid(172)`
   - 第二组（文件 I/O — ext2 路径）：`read(63)`, `write(64)`, `openat(56)`, `close(57)`, `newfstatat(79)`, `getdents64(61)`
   - 第三组（内存与进程）：`brk(214)`, `mmap(222)`, `mprotect(226)`, `clone(220)`, `wait4(260)`, `execve(221)`
   - 第四组（终端与杂项）：`ioctl(29)`, `fcntl(25)`, `getcwd(17)`, `chdir(49)`, `times(153)`, `uname(160)`
5. Linux ELF 加载器：解析 PT_LOAD、PT_INTERP、处理 aux vector (AT_PHDR/AT_ENTRY/AT_PAGESZ/AT_RANDOM/AT_UID/AT_EUID)
6. 实现 `/dev/console` 和 `/dev/null` 作为最小设备节点 → 验证：Shell 可读写终端
7. 从 ext2 rootfs 启动 `/bin/sh` → 验证：出现交互式 Shell 提示符，可执行 `ls`/`cat`/`echo`/`pwd` 等命令
8. ext2 写支持 → 验证：在 Shell 中用 `echo hello > /tmp/test.txt` 创建文件，重启后文件仍存在
9. 支持动态链接：实现 `ld-linux-riscv64.so.1` 加载逻辑
10. 实现 ext4 的 extent tree 或 journal 回放
11. 实现更多 Linux 系统调用以支持更复杂的程序

**验证里程碑：**

| 里程碑 | 验证内容               | 判定标准                                                               |
| ------ | ---------------------- | ---------------------------------------------------------------------- |
| M1     | virtio-blk + ext2 识别 | 读取磁盘扇区，识别 ext2 magic 0xEF53                                   |
| M2     | ext2 根目录遍历        | `ls /bin` 列出 busybox 命令（从真实磁盘读取的目录项）                |
| M3     | hello 程序             | 单个 Linux 静态 hello 程序从 ext2 加载并输出                           |
| M4     | `/bin/sh` 启动       | 出现交互式 Shell 提示符                                                |
| M5     | 文件系统操作           | 执行`ls /etc`（非 `/bin` 目录）和 `cat /etc/inittab`（文件内容） |
| M6     | 管道                   | 管道命令 `ls /bin                                                      |

**syscall 实现优先级矩阵：**

当调试 "busybox 为什么不工作" 时，按以下顺序排查和实现 syscall：

| 优先级     | syscall                                                                     | 原因                        |
| ---------- | --------------------------------------------------------------------------- | --------------------------- |
| P0（先做） | `read(63)`, `write(64)`, `exit(93)`, `exit_group(94)`               | 任何程序都需要              |
| P1         | `openat(56)`, `close(57)`, `newfstatat(79)`, `getdents64(61)`       | Shell 的`ls`/`cat` 需要 |
| P2         | `mmap(222)`, `brk(214)`, `mprotect(226)`                              | 动态内存分配需要            |
| P3         | `execve(221)`, `clone(220)`, `wait4(260)`                             | Shell 执行命令需要          |
| P4         | `ioctl(29)`, `fcntl(25)`, `uname(160)`, `getcwd(17)`, `chdir(49)` | 终端控制和杂项              |

**调试技巧：**

- 在 host 端用 `strace` 跟踪同一个 busybox 命令，对比你的内核缺少哪些 syscall
- 用 QEMU GDB 在 `syscall()` 入口设断点，观察第一个返回 `-ENOSYS` 的系统调用号
- 逐个 busybox 命令测试（而非直接测 Shell）：先让 `hello` 工作 → 再让 `/bin/echo hello` 工作 → 再让 `/bin/ls` 工作 → 最后让 `/bin/sh` 工作

**correctness_guard：**

- "ext2 驱动不能因恶意/畸形磁盘镜像而崩溃——所有 inode 和目录项解析有边界检查和完整性校验"
- "Linux syscall 内用户指针验证与本机 syscall 同等严格——不绕开 copyin/copyout"
- "ext2 驱动的 buffer cache 使用不泄漏 buffer——brelse() 与 bread() 一一对应"

**benchmark_oracle：**

- ext2 根目录遍历：`ls /bin` 在 1 秒内完成（64 MB 镜像）
- Shell 启动：从内核加载 /bin/sh 到显示提示符 < 2 秒
- 管道：`ls /bin | wc` 输出正确的文件数和行数

**常见陷阱：**

1. **ext2 块大小理解错误。** ext2 的块大小在 superblock 中以 `log₂(block_size / 1024)` 编码，1024 字节块对应的 `s_log_block_size` = 0。直接用 4096 硬编码读到错误数据。
2. **间接块读取。** 双重间接块的偏移计算容易出错——仔细跟踪 `block_no = offset / block_size` 和块内偏移。
3. **目录项的变长特性。** `rec_len` 是目录项的总长度（含填充），不是 name_len。跳过 `rec_len` 找下一个目录项——不要假设 name_len 决定步长。
4. **struct stat 结构布局差异。** Linux 的 `struct stat`（`newfstatat` 返回的结构）与 xv6 的可能不同——`st_dev`/`st_ino`/`st_mode`/`st_size` 的偏移和大小需要与 RISC-V Linux ABI 对齐，不是 xv6 的 stat 结构。

**参考资料：** Linux syscall 表 (`include/uapi/asm-generic/unistd.h`), ELF64 规范, ext2 数据结构文档 (`/usr/include/ext2fs/ext2_fs.h`), virtio 1.0 规范（块设备章节）, busybox 编译指南, buildroot 使用手册

---

#### C2：POSIX 源码兼容

不追求二进制兼容（不需要加载 Linux ELF），而是在源码层面提供 POSIX 接口。用你的 OS 的编译器重新编译 POSIX 程序。

| 属性               | 值                          |
| ------------------ | --------------------------- |
| **难度**     | ★★☆ medium               |
| **前置阶段** | 阶段 7（完整 syscall 接口） |
| **典型工期** | 1-3 周 (mastery)            |

**建议步骤：**

1. 定义 POSIX 头文件（`unistd.h`, `fcntl.h`, `sys/stat.h`, `sys/types.h`, `dirent.h`, `errno.h` 等），确保类型定义（`off_t`, `ssize_t`, `pid_t`, `mode_t` 等）与 POSIX 一致
2. 实现 syscall 包装函数，按依赖顺序分组：

| 优先级 | 函数                                                         | 验证             |
| ------ | ------------------------------------------------------------ | ---------------- |
| P0     | `read`, `write`, `open`, `close`, `exit`           | hello world      |
| P1     | `lseek`, `stat`, `fstat`, `isatty`                   | `cat` + `ls` |
| P2     | `getdents`/`readdir`, `chdir`, `getcwd`              | 目录遍历         |
| P3     | `fork`, `exec*`, `waitpid`, `pipe`, `dup`/`dup2` | Shell            |
| P4     | `kill`, `signal`/`sigaction`, `getpid`, `getppid`  | 信号处理         |

3. 移植验证金字塔（由易到难）：
   - 第一层：单个 POSIX 函数测试程序（如只测 `open`+`read`+`write`+`close`）
   - 第二层：简单工具（如 sbase 的 `cat`、`echo`、`wc`、`head`）
   - 第三层：dash shell（简化的 POSIX shell，比 busybox 的 `ash` 更小）
   - 第四层：Lua 解释器或 SQLite（验证更复杂的 POSIX 依赖：`mmap`、信号、浮点等）
4. 定义 `errno` 传递链路：syscall 返回值 + 全局 `errno` 的正确设置
5. 实现 `mmap`、`munmap`、信号处理、`select`/`poll`

**验证里程碑：**

| 里程碑 | 验证内容     | 判定标准                                           |
| ------ | ------------ | -------------------------------------------------- |
| M1     | 基础文件 I/O | `cat hello.txt` 输出文件内容                     |
| M2     | 目录操作     | `ls` 列出目录内容（至少支持 `-l` 选项）        |
| M3     | dash shell   | dash 编译后运行，可执行内置命令 + 外部命令         |
| M4     | Lua/SQLite   | Lua 解释器运行简单脚本或 SQLite CLI 执行`SELECT` |

**correctness_guard：**

- "POSIX 包装函数与本机 syscall 之间的参数转换不截断或溢出（特别是 `off_t` 和 `size_t`）"
- "`errno` 在多线程场景下是 per-thread 的（如你的内核支持线程）"
- "符号链接、绝对路径 vs 相对路径的处理与 POSIX 语义一致"

**常见陷阱：**

1. **`off_t` 宽度问题。** 在 32 位系统上 `off_t` 可能为 32 位（无 `_FILE_OFFSET_BITS=64`），在 64 位系统上为 64 位。你的 POSIX 头文件需要正确 typedef。
2. **`struct stat` 字段不全。** POSIX 要求 `st_dev`, `st_ino`, `st_mode`, `st_nlink`, `st_uid`, `st_gid`, `st_rdev`, `st_size`, `st_atime`, `st_mtime`, `st_ctime`。缺少任何字段可能导致程序编译失败。
3. **`errno` 传递链路断裂。** 如果你的内核 syscall 不返回 errno（只返回 -1），包装函数需要自己设置 `errno`。确保每次 syscall 失败后 `errno` 被正确更新。
4. **"select/poll" 是移植的分水岭。** 许多实际程序（包括 dash）依赖 `select` 或 `poll` 实现非阻塞 I/O 和超时。没有它们，很多程序无法正常工作。

**参考资料：** POSIX.1-2008 规范, musl-libc 源码, sbase (suckless base), dash 源码, Lua 源码

---

#### C3：多 ISA 移植

让你的 OS 在 RISC-V 之外的另一架构（ARMv8 / x86-64）上运行。

| 属性               | 值                 |
| ------------------ | ------------------ |
| **难度**     | ★★★ hard        |
| **前置阶段** | 阶段 7（完整内核） |
| **典型工期** | 2-4 周 (mastery)   |

**建议步骤：**

1. 识别 ISA 相关代码，建立 `src/arch/<isa>/` 目录结构：

| 模块                    | 涉及内容                                                                       |
| ----------------------- | ------------------------------------------------------------------------------ |
| `arch/boot`           | 入口点、BSS 清零、栈设置、跳转到`main()`                                     |
| `arch/page_table`     | 页表格式（Sv39 vs AArch64 的 4-level vs x86-64 4-level）、PTE 位定义、TLB 刷新 |
| `arch/trap`           | trap 入口/返回、trap frame 布局、寄存器保存/恢复                               |
| `arch/context_switch` | `swtch()` 的汇编实现：callee-saved 寄存器保存/恢复                           |
| `arch/memory_order`   | `fence` (RV) vs `dmb`/`dsb` (ARM) vs `mfence` (x86)                    |

2. 定义 HAL（Hardware Abstraction Layer）接口：

```c
// 每个 ISA 必须实现的 HAL 函数
void arch_boot(void);                        // ISA 特定的启动序列
void arch_page_table_create(pagetable_t*);   // 创建根页表
void arch_page_table_map(pagetable_t*, va, pa, perm);  // 映射一页
void arch_tlb_flush(va);                     // 刷新 TLB 条目
void arch_trap_entry(void);                  // trap 入口（汇编）
void arch_context_switch(struct context*, struct context*);  // 上下文切换
void arch_fence_before_atomic(void);         // 原子操作前的屏障
void arch_fence_after_store(void);           // store 后的屏障
```

3. 实现目标 ISA 版本的 HAL 层（建议先从 ARMv8 AArch64 起步——它与 RISC-V 更接近）：
   - ARMv8: `msr`/`mrs` 系统寄存器操作、`eret` 返回用户态、4-level 页表（VA 空间 48-bit）
   - x86-64: `lidt`/`lgdt` 加载 IDT/GDT、`syscall`/`sysret` 快速系统调用、4-level 页表（PML4）
4. 用 QEMU 的目标机器型号测试：`qemu-system-aarch64 -M virt` 或 `qemu-system-x86_64 -M q35`
5. 验证：同一用户程序源码在两个 ISA 上编译后运行，行为一致
6. 跨 ISA syscall 兼容——在 ARM 上运行为 RISC-V 编译的静态程序（需要 syscall 编号翻译 + 参数寄存器映射）

**验证里程碑：**

| 里程碑 | 验证内容     | 判定标准                                                  |
| ------ | ------------ | --------------------------------------------------------- |
| M1     | HAL 接口定义 | 所有 ISA 无关代码通过 HAL 调用，不再直接使用 ISA 特定指令 |
| M2     | 新 ISA 启动  | 在新 QEMU 机器上输出 boot banner                          |
| M3     | 进程运行     | `hello` 程序在两个 ISA 上输出一致                       |
| M4     | 跨 ISA 兼容  | ARM 上运行 RISC-V 编译的简单程序                          |

**correctness_guard：**

- "HAL 接口语义与原有 ISA 直接实现一致——换 ISA 后所有 correctness_guard 仍成立"
- "不同 ISA 的页表权限位映射正确——W^X 等安全属性在移植后不丢失"
- "内存序差异被正确封装在 HAL 中——移植后的代码不在 ISA 无关模块中放错 fence 位置"

**常见陷阱：**

1. **页表格式差异。** RISC-V Sv39 是 3 级、AArch64 的 4KB 粒度是 4 级。PTE 的权限位位置和语义不同（如 RISC-V 的 Dirty 位由硬件管理、ARM 的 Access Flag 需要软件设置）。
2. **trap frame 布局。** RISC-V 的 `sscratch`/`sepc`/`stval` 在 ARM 上对应 `SP_EL0`/`ELR_EL1`/`FAR_EL1`——名字和语义不完全对应。需要仔细映射。
3. **内存序模型差异。** RISC-V 的 RVWMO 比 ARM 的弱、比 x86 的弱得多。在 RISC-V 上需要显式 `fence` 的地方，移植到 x86 时可能不需要——但保留 fence 是安全的（性能略差）；省略了需要的 fence 是灾难。
4. **QEMU 机器差异。** UART 基址、PLIC 布局、设备树格式都随 QEMU 机器型号变化。不要假设新 ISA 的 QEMU 机器有相同的设备布局。

**参考资料：** ARMv8-A 体系结构参考手册, x86-64 AMD/Intel 手册（卷 3：系统编程）, QEMU `qemu-system-aarch64 -M virt` 文档, RISC-V privileged spec (交叉参考 HAL 设计)

---

#### C4：Windows NT PE 二进制兼容

让你的 OS 能够加载并运行 Windows NT 的 PE（Portable Executable）可执行文件。

| 属性               | 值                   |
| ------------------ | -------------------- |
| **难度**     | ★★★★ extreme     |
| **前置阶段** | 阶段 6（ELF loader） |
| **典型工期** | 3-6 周 (mastery)     |

**建议步骤：**

1. PE 格式解析器：
   - DOS header → PE signature → IMAGE_FILE_HEADER → IMAGE_OPTIONAL_HEADER64
   - Section Headers：`.text`、`.data`、`.rdata`、`.bss` 等段的虚拟地址、原始数据偏移、大小
   - 处理重定位表（Base Relocations）：PE 假定加载到 ImageBase，若实际地址不同需逐项修正
2. 实现 NT syscall 子集（锁定 Windows 10 21H2 的 syscall 编号）：

| syscall                     | 编号 | 作用          |
| --------------------------- | :--: | ------------- |
| `NtTerminateProcess`      | 0x2C | 退出进程      |
| `NtWriteFile`             | 0x08 | 写文件/控制台 |
| `NtReadFile`              | 0x06 | 读文件/控制台 |
| `NtOpenFile`              | 0x33 | 打开文件      |
| `NtClose`                 | 0x0F | 关闭 handle   |
| `NtAllocateVirtualMemory` | 0x18 | 分配虚拟内存  |
| `NtFreeVirtualMemory`     | 0x1E | 释放虚拟内存  |

3. 资源模型适配：NT 是 handle-based——`NtOpenFile` 返回 HANDLE，不是 fd。在你的内核中实现 handle↔内核对象的映射表
4. 用 MinGW-w64 交叉编译简单程序：`x86_64-w64-mingw32-gcc -static -nostdlib hello.c -o hello.exe`
5. 验证：`hello.exe` 在你的 OS 上启动、输出 "Hello"、退出
6. PEB/TEB 基本结构：为每个 NT 进程分配 PEB（Process Environment Block），设置 `gs:[0x60]` 指向 PEB

**验证里程碑：**

| 里程碑 | 验证内容  | 判定标准                                          |
| ------ | --------- | ------------------------------------------------- |
| M1     | PE 解析   | 正确解析 PE header，打印 section 数量和入口点     |
| M2     | hello.exe | 静态编译的`hello.exe` 输出 "Hello" 并退出       |
| M3     | 文件 I/O  | PE 程序通过`NtWriteFile` 写入文件的程序正常运行 |

**correctness_guard：**

- "PE loader 对 section 的虚拟大小和原始数据大小做边界检查——不因恶意 PE 导致越界读"
- "NT handle 表有大小上限，handle 关闭后不可重用（防止 use-after-free）"
- "PE 重定位项的数量有上限——防止无限循环处理重定位表"

**常见陷阱：**

1. **NT syscall 编号不稳定。** Microsoft 不保证跨版本兼容——Windows 10 不同 build 的 syscall 编号不同。锁定一个版本（如 21H2 build 19044）并文档化。
2. **`NtOpenFile` 的 OBJECT_ATTRIBUTES 结构。** 这个结构包含 `RootDirectory`（句柄）、`ObjectName`（UNICODE_STRING）、`Attributes` 等多个嵌套结构。解析复杂度远超 Linux 的 `openat`。
3. **PE 重定位与 RISC-V。** 如果你的目标是在 RISC-V 上运行 PE（Windows on RISC-V 仍非常规），需要处理 PE 中 x86-64 特定的重定位类型（如 `IMAGE_REL_BASED_DIR64`）→ 映射到 RISC-V 等效操作。这是本方向最深刻的技术挑战之一。

**参考资料：** PE/COFF 规范（Microsoft 官方文档）、Windows Internals 第 7 版、ReactOS 源码、j00ru 的 Windows syscall 表 (`github.com/j00ru/windows-syscalls`)

---

#### C5：macOS Mach-O 二进制兼容

让你的 OS 能够加载并运行 macOS 的 Mach-O 可执行文件。

| 属性               | 值                   |
| ------------------ | -------------------- |
| **难度**     | ★★★★ extreme     |
| **前置阶段** | 阶段 6（ELF loader） |
| **典型工期** | 3-6 周 (mastery)     |

**建议步骤：**

1. Mach-O 格式解析器：
   - Mach header（`mach_header_64`）：magic `0xFEEDFACF`(64-bit)、CPU type、file type
   - Load Commands：遍历 `ncmds` 个命令，关注 `LC_SEGMENT_64`、`LC_MAIN`、`LC_UNIXTHREAD`、`LC_DYLD_INFO`
   - `LC_SEGMENT_64`：加载 `__TEXT`（代码）、`__DATA`（数据）、`__LINKEDIT`（符号表等）
   - 处理 `__PAGEZERO` 段（Mach-O 要求虚拟地址 0 开始的区域不可访问——在你的页表中留一个 hole）
2. XNU syscall 实现（只做 Unix 子集，不碰 Mach IPC）：

| syscall      | 编号 | 注                 |
| ------------ | :--: | ------------------ |
| `exit`     |  1  | 进程退出           |
| `read`     |  3  | 等价 Unix read     |
| `write`    |  4  | 等价 Unix write    |
| `open`     |  5  | 等价 Unix open     |
| `close`    |  6  | 等价 Unix close    |
| `mmap`     | 197 | 等价 Unix mmap     |
| `mprotect` |  74  | 等价 Unix mprotect |
| `getpid`   |  20  | 等价 Unix getpid   |

> XNU 64-bit syscall 编号 = Unix syscall 编号 + 0x2000000。Syscall 通过 `syscall` 指令（x86）或 `svc #0x80`（ARM），在你的内核中统一转为 `ecall`。

3. 处理 Mach-O 入口点：`LC_MAIN` 指定 `entryoff`（相对 `__TEXT` 段的偏移），或 `LC_UNIXTHREAD` 提供完整寄存器状态
4. 用 osxcross 交叉编译：`o64-clang -static -nostdlib hello.c -o hello.macho`
5. 验证：Mach-O hello 在你的 OS 上启动、输出、退出
6. `dyld` 基本支持：解析 `LC_DYLD_INFO` 的 bind/rebase 操作码

**验证里程碑：**

| 里程碑 | 验证内容    | 判定标准                                                   |
| ------ | ----------- | ---------------------------------------------------------- |
| M1     | Mach-O 解析 | 正确解析`mach_header_64`，打印 load command 数量和段信息 |
| M2     | hello.macho | 静态`hello.macho` 输出 "Hello" 并退出                    |
| M3     | 多段程序    | 有`__TEXT` + `__DATA` 分离的程序正常运行               |

**correctness_guard：**

- "Mach-O loader 对 `LC_SEGMENT_64` 的文件偏移 + 文件大小的加和做溢出检查"
- "`__PAGEZERO` 段确保地址 0 的页不可访问——防御 NULL 指针解引用"
- "Load Command 数量有上限——防止恶意 Mach-O 的 `ncmds` 极大导致无限循环"

**常见陷阱：**

1. **fat binary（Universal Binary）。** macOS 程序常包含多个架构的代码（`FAT_CIGAM` magic）。需要先提取目标架构的 slice 再解析 Mach-O。最简单的处理：用 `lipo -extract` 预处理。
2. **`__PAGEZERO` 的处理。** 不是简单地"忽略这个段"——必须确保虚拟地址 0 开始的页面不可映射。这在你的页表中是一个特殊的 hole，不是无操作。
3. **dyld shared cache。** macOS 的系统库（`libSystem.dylib`）不在磁盘上以单独文件存在——它们在 dyld shared cache 中。静态链接是最可行的绕开方式。
4. **commpage 依赖。** macOS 用 commpage（特殊的内核映射页）提供 gettimeofday 等高频操作。你的实现可以简单跳过——大部分 syscall 不依赖它。

**参考资料：** Apple 开源 XNU 内核 (`xnu` on GitHub)、Mach-O 格式规范（Apple 开发者文档）、osxcross 交叉编译工具链、dyld 源码（Apple 开源）

---

### 8.2.3 专项优化簇 (O)：在特定场景下建立优势

这些方向不增加新功能——它们让现有功能在某个维度上做到极致。

---

#### O1：实时性与确定性

硬实时调度——中断响应延迟有上界，优先级反转被防护。

| 属性               | 值               |
| ------------------ | ---------------- |
| **难度**     | ★★★ hard      |
| **前置阶段** | 阶段 5（调度器） |
| **典型工期** | 2-4 周 (mastery) |

**建议步骤：**

1. 实现固定优先级抢占调度：每个进程有静态优先级（1-99），高优先级就绪时立即抢占低优先级。验证：创建高/低优先级进程，高优先级唤醒后 < 1 tick 获得 CPU
2. 测量中断禁用区间：在内核中标记所有 `push_off()`/`pop_off()` 或 `cli`/`sti` 的区间 → 用 `mtime` 计数器测量最大禁用时间。目标 < 10μs
3. 实现优先级继承（Priority Inheritance）：
   - 场景：高优先级进程 H 等待锁 L，锁 L 被低优先级 L_proc 持有
   - 策略：L_proc 临时继承 H 的优先级，直到释放 L
   - 验证：中优先级进程无法在 H 等待 L 期间饿死 H
4. 中断延迟测量：在 PLIC 中断处理中记录 `mtime`，或在 GPIO 触发点记录时间戳，计算 "中断信号 → ISR 第一条指令" 的延迟
5. Benchmark：端到端延迟分布（P50/P99/P999）

**验证里程碑：**

| 里程碑 | 验证内容     | 判定标准                                                  |
| ------ | ------------ | --------------------------------------------------------- |
| M1     | 优先级调度   | 高优先级进程在低优先级进程运行时被唤醒，< 1 tick 获得 CPU |
| M2     | 中断禁用上限 | 最大中断禁用区间 < 10μs                                  |
| M3     | 优先级继承   | 中优先级进程在优先级继承生效期间不能饿死高优先级          |
| M4     | 端到端延迟   | GPIO → ISR → 用户态响应，P99 < 50μs                    |

**correctness_guard：**

- "实时优化不破坏非实时进程的正确性——非实时进程不会永久饥饿"
- "优先级继承不导致死锁——继承链不会形成环"
- "中断禁用区间在代码审计中全部被显式标记——不存在隐式的长时间中断禁用"

**benchmark_oracle：**

- 中断延迟：P50 < 5μs, P99 < 50μs
- 调度延迟：P50 < 10μs, P99 < 100μs
- 最大中断禁用区间：< 10μs

**常见陷阱：**

1. **优先级反转的隐蔽形式。** 不只是显式的锁，自旋锁、延迟的中断禁用、以及某些执行时间偏长的函数都可能触发优先级反转。系统性地测量所有 `push_off` 区间，能更准确定位问题。
2. **"无锁"代码中的隐含禁用。** 有些代码为"无锁"而禁用了中断（用 `push_off`/`pop_off`）——这实际上比持锁更严重，因为中断禁用的区间可能更长。
3. **测量工具本身延迟。** 在 ISR 中插 `printk` 会严重增加测量延迟。用 `mtime` 计数器 + 内存记录（ISR 后批量打印）是更准确的测量方法。
4. **优先级继承链的复杂性。** 多个进程嵌套等锁时，优先级继承会形成一个链——如果 A 等 B 的锁、B 等 C 的锁，C 需要继承 A 的优先级。实现递归继承是优先级继承最复杂的部分。

**参考资料：** LITMUS^RT 项目论文, Linux RT_PREEMPT patch 文档, Liu & Layland "Scheduling Algorithms for Multiprogramming in a Hard-Real-Time Environment"

---

#### O2：极小足迹

内核镜像 < 64 KB，总内存占用 < 1 MB。适合嵌入式/微控制器。

| 属性               | 值                 |
| ------------------ | ------------------ |
| **难度**     | ★☆☆ easy        |
| **前置阶段** | 阶段 7（完整内核） |
| **典型工期** | 3-7 天 (mastery)   |

**建议步骤：**

1. 基线审计：`size kernel.elf` 分析各 section（`.text`/`.rodata`/`.data`/`.bss`）大小。`nm --size-sort kernel.elf | tail -20` 找 top-20 大符号。链接器 map 文件分析哪些 `.o` 文件贡献最大
2. 编译优化：
   - `-Os`（优化尺寸）+ `-flto`（链接时优化）+ `-ffunction-sections -fdata-sections` + `--gc-sections`（删除未使用函数/数据）
   - 审视 Makefile 中不必要的链接库（如 libgcc 的某些大模块）
3. 数据结构精简：
   - 进程表：`NPROC` 从 64 → 8（如果场景允许）
   - 文件表：`NFILE` 同理
   - 用 `uint8_t`/`uint16_t` 替代 `int` 存储小范围值（如 PID、fd）
4. 用 bitmap 替代 freelist：
   - 物理页位图：1 bit/page，64 MB RAM = 16384 页 → 2048 字节位图（vs freelist 链表每页 16+ 字节元数据 = 256 KB+）
   - 权衡：分配/释放从 O(1) 变 O(n) 扫描，但节省大量元数据
5. Benchmark：`size kernel.elf` 总大小、启动后 `freemem` 空闲内存、最大并发进程数

**验证里程碑：**

| 里程碑 | 验证内容     | 判定标准                                                |
| ------ | ------------ | ------------------------------------------------------- |
| M1     | 基线记录     | 记录当前`.text` 大小、top-10 函数、空闲内存           |
| M2     | 编译优化     | 镜像大小缩减 > 20%（`-Os`+`LTO`+`--gc-sections`） |
| M3     | 数据结构精简 | 总内存占用 < 1 MB                                       |
| M4     | 最终验证     | 所有已有测试通过，镜像 < 64 KB                          |

**correctness_guard：**

- "缩小不改变语义——所有已有 correctness_guard 在优化后仍成立"
- "数据结构大小缩减不导致溢出（如 `NPROC=8` 时 fork 第 9 次应正确返回 -1，而不是 index out of bound）"
- "`--gc-sections` 不误删关键函数（检查是否有函数通过函数指针调用——链接器无法追踪此类引用）"

**常见陷阱：**

1. **过度内联反而增大。** `-Os` 已经倾向于不内联，但如果手动标记了 `inline`，可能抵消尺寸优化效果。审计 `__attribute__((always_inline))` 的使用。
2. **"删功能"与"优化"界限混淆。** 把 `NPROC` 从 64 降为 8 是删容量，不是优化。如果你的目标是通用 OS，这不可接受。O2 的适用场景是嵌入式/微控制器——你需要明确声明你的 OS 的目标场景。
3. **bitmap 的扫描开销。** 物理内存大时，bitmap 扫描找空闲页的 O(n) 开销不可忽略。在"极小 RAM"的场景下（< 64 MB RAM），bitmap 也是 2048 字节以下——扫描成本可接受。

**参考资料：** GCC `-Os`/`-flto` 文档, linker `--gc-sections` 文档, Embedded Linux 内核裁剪文档 (`make tinyconfig`)

---

#### O3：高吞吐 I/O

文件读写吞吐量接近裸设备速度。适合数据库/存储场景。

| 属性               | 值                              |
| ------------------ | ------------------------------- |
| **难度**     | ★★☆ medium                   |
| **前置阶段** | 阶段 6（FS/bio 层/virtio 驱动） |
| **典型工期** | 1-3 周 (mastery)                |

**建议步骤：**

1. 零拷贝 I/O（Zero-Copy）：
   - 用户 buffer 直接映射到 virtio 描述符的物理地址 → 设备 DMA 直接读写用户页
   - 实现：`read()` 时 pin 用户页 → 映射到 bio → 设备 DMA 直接写入 → unpin
   - 前提：用户 buffer 必须页对齐 + 不跨越页边界（或处理多页）
2. 异步 I/O：提交 I/O 后立即返回给用户态，完成时通过 callback/eventfd/signal 通知
   - 最简实现：`aio_read(aio_req*)` → 内核提交 bio → 返回 `EINPROGRESS` → 设备完成中断 → bio 回调 → 唤醒等待的用户进程
3. 批量 syscall：一次 `ecall` 提交多个 I/O 操作（如 `io_submit(nr, iocb_array)`）
   - 减少用户态↔内核态切换的开销
4. I/O 请求合并与重排：
   - 电梯调度器：按扇区号排序请求，减少磁盘寻道（对 virtio-blk 也有意义——批量+顺序访问减少 MMIO 次数）
   - Deadline 调度器：为每个请求设超时，防止饿死
5. Benchmark：`dd` 风格测试吞吐量（`dd if=/largefile of=/dev/null bs=1M count=100`），对比阻塞 I/O 基线

**验证里程碑：**

| 里程碑 | 验证内容   | 判定标准                                        |
| ------ | ---------- | ----------------------------------------------- |
| M1     | 零拷贝路径 | 大文件读取吞吐量提升 > 50%（对比 bio 拷贝路径） |
| M2     | 异步 I/O   | 提交 I/O 后用户态可继续执行，完成时正确通知     |
| M3     | 请求合并   | 顺序读取的吞吐量接近大块读取（1MB I/O）的水平   |

**correctness_guard：**

- "异步 I/O 的完成通知不可丢失——任何提交但未通知的 I/O 最终被超时机制捕获"
- "零拷贝路径不能泄漏内核页映射——用户 buffer unpin 后内核不可再访问"
- "I/O 请求合并不改变语义——合并后的请求失败时，所有原始请求都应收到错误通知"

**常见陷阱：**

1. **零拷贝时用户 buffer 生命周期。** 用户 buffer 可能被 `munmap` 或 `sbrk` 回收——在内核正在 DMA 写入时。必须实现 page pinning（引用计数或锁）防止 buffer 在使用期间被释放。
2. **DMA 一致性。** virtio 设备访问的是物理地址，但 CPU 看到的是虚拟地址。确保在 DMA 开始前和结束后正确处理缓存一致性（RISC-V 上通常通过 `fence` 指令或在页表属性中标记 non-cacheable）。
3. **电梯调度饿死。** 纯电梯算法（最短寻道优先）可能使某些扇区范围的请求永远得不到服务。Deadline 调度器在电梯排序 + 超时保证之间取得平衡。
4. **异步 I/O 的错误处理。** 同步 I/O 的错误通过返回值传递——异步 I/O 的错误需要一个额外通道（event 携带 errno）。遗漏错误传递导致静默数据损坏。

**参考资料：** Linux AIO / io_uring 文档, virtio 1.0 规范（描述符链和完成通知）, Linux block layer 文档（电梯/deadline/noop 调度器）

---

#### O4：安全加固

防御栈溢出、代码注入、信息泄漏。

| 属性               | 值                 |
| ------------------ | ------------------ |
| **难度**     | ★★☆ medium      |
| **前置阶段** | 阶段 7（完整内核） |
| **典型工期** | 1-3 周 (mastery)   |

**建议步骤：**

1. W^X 内存保护：
   - 在页表级别强制：任何页不能同时有 Write 和 Execute 权限
   - 实现位置：`mprotect()` 和 `mmap()` 中检查 `PROT_WRITE | PROT_EXEC`
   - 验证：尝试分配 W+X 页被拒绝（`mmap(..., PROT_READ|PROT_WRITE|PROT_EXEC, ...)` 返回 `-EACCES`）
2. 栈 canary：
   - 编译器端：`-fstack-protector` 或 `-fstack-protector-strong` (gcc/clang)
   - 内核端：每个进程/线程在创建时生成随机 canary 值 → 放在栈帧返回地址前
   - 函数返回前检查 canary → 不匹配则 panic（不返回用户态，防止 ROP）
   - 验证：故意溢出栈缓冲区 → 内核检测到 canary 篡改并 panic
3. KASLR（Kernel Address Space Layout Randomization）：
   - 启动时随机化内核代码/数据的虚拟基址（页级粒度或 2MB 级粒度）
   - 验证：两次启动的内核符号表地址不同
4. 用户指针严格验证：
   - 所有从用户态传入的指针在解引用前验证：地址 < MAXVA、地址在用户地址空间范围内、地址 + size 不溢出
   - 验证：构造非法指针（`0xFFFFFFFFFFFFF000`）的 syscall → 返回 `-EFAULT` 而非内核 panic
5. 安全审计：
   - 用 syzkaller 或手写 syscall fuzzer → 对每个 syscall 随机生成参数 → 记录 crash → 修复
   - 至少运行 fuzzer 一小时无 crash
6. ASLR for user-space、seccomp 风格的 syscall 过滤、Shadow Stack（RISC-V Zicfiss 扩展）

**验证里程碑：**

| 里程碑 | 验证内容  | 判定标准                                     |
| ------ | --------- | -------------------------------------------- |
| M1     | W^X       | `mmap(PROT_WRITE                             |
| M2     | 栈 canary | 栈溢出被检测到 → 内核 panic（不返回用户态） |
| M3     | KASLR     | 两次启动的`printk` 输出中内核符号地址不同  |
| M4     | 指针验证  | 非法指针的 syscall 返回`-EFAULT`           |
| M5     | Fuzz 测试 | syscall fuzzer 运行 1 小时无 crash/panic     |

**correctness_guard：**

- "安全加固不引入新的侧信道——W^X 不改变合法程序的执行时间模式"
- "W^X 不阻止合法的 JIT 场景（如果你的 OS 支持 JIT，需提供受控的 W→X 转换接口，如 `mprotect` 的严格使用）"
- "KASLR 的随机化有足够的熵（至少 8 位有效随机位），不依赖可预测的种子"

**常见陷阱：**

1. **canary 被信息泄漏绕过。** 如果攻击者能读到栈上的 canary 值（通过 `read()` 溢出或 `%p` 格式字符串泄漏），就可以在溢出时写回原值——canary 形同虚设。防御：确保 canary 值的最低字节为 `0x00`（阻止字符串溢出读 canary）。
2. **KASLR 熵不足。** 2MB 对齐的随机化只提供了少量位的随机性（如 48-bit 地址空间中 2MB 对齐 = 39 个可能位置 ≈ 5 位熵）。页级对齐（4KB）提供约 20 位熵——差距巨大。
3. **"安全加固"变"安全幻觉"。** 只做栈 canary 不做 W^X，攻击者直接注入 shellcode 到 data 段再跳过去——你的 canary 白做了。安全是纵深防御——多层机制互补才有意义。

**参考资料：** PaX/Grsecurity 论文, Linux KASLR 文档, RISC-V Zicfiss (Shadow Stack) 规范, syzkaller 文档, 《The Shellcoder's Handbook》

---

#### O5：极速启动

固件跳转到 Shell 可交互 < 100ms。适合 IoT/边缘计算。

| 属性               | 值                 |
| ------------------ | ------------------ |
| **难度**     | ★☆☆ easy        |
| **前置阶段** | 阶段 7（完整内核） |
| **典型工期** | 3-7 天 (mastery)   |

**建议步骤：**

1. 测量基线：在 `start.c` 第一条指令（或固件跳转点）记录 `mtime`，在 shell 提示符出现后再次记录 `mtime`。输出完整启动时间线：

| 阶段 | 描述             | 测量点                    |
| ---- | ---------------- | ------------------------- |
| T1   | 固件→内核入口   | entry.S 第一条指令        |
| T2   | BSS 清零完成     | start.c 中`memset` 返回 |
| T3   | 内核初始化完成   | `main()` 末尾           |
| T4   | init 进程 exec   | `exec()` 返回用户态     |
| T5   | Shell 提示符就绪 | Shell 打印`$ `          |

2. 延迟初始化：非关键设备（如额外的 virtio 设备、网络栈、辅助文件系统）延后到 Shell 就绪后初始化
3. 预构建用户进程镜像：
   - 将 `/bin/init` 或 `/bin/sh` 的 ELF 文件预加载到内核镜像中（`objcopy` 嵌入二进制 blob）
   - exec 时省去磁盘读取——直接从内存镜像加载
4. 优化关键路径：
   - BSS 清零：用 `memset` 的优化实现（对齐到 word/双字，一次清零多字节）
   - 页表批量映射：一次映射多个页（如连续的 2MB 大页）而非逐个 4KB 页映射
   - 减少不必要的 `printk`（串口输出是启动耗时的隐形杀手——每个字符等待 UART TX ready）
5. Benchmark：精确到毫秒的启动时间线，对比优化前后

**验证里程碑：**

| 里程碑 | 验证内容   | 判定标准                                   |
| ------ | ---------- | ------------------------------------------ |
| M1     | 基线时间线 | 获取 T1-T5 的精确时间戳                    |
| M2     | 延迟初始化 | T3-T5 缩短 > 20%                           |
| M3     | 预构建     | Shell 提示符出现 < 100ms（从 T1 开始计时） |

**correctness_guard：**

- "延迟初始化的设备在被首次访问时必须已完成初始化——访问未初始化设备不 panic、不返回垃圾数据"
- "预构建的内存镜像不影响程序正确性——镜像内容的哈希与正常加载的 ELF 加载结果一致"
- "启动优化不跳过关键安全初始化（如页表隔离、见 O4 的 W^X）"

**常见陷阱：**

1. **延迟初始化导致竞态。** 将设备初始化延迟到 init 进程之后，但 init 进程可能立即尝试访问该设备（如 `open("/dev/ttyS1")`）。必须实现按需初始化或就绪状态查询。
2. **"优化"变"跳过"。** 为了加速启动跳过 BSS 清零——未初始化的全局变量包含随机值，导致随机 bug。这不是优化，是灾难。零成本的优化方法：链接器脚本中对齐 BSS 边界，用 `memset` 的 word-at-a-time 实现。
3. **`printk` 开销被低估。** 115200 波特率的 UART 输出每个字符约 87μs。10 行 boot log ≈ 500 字符 ≈ 43ms——在 100ms 的启动目标中占了一半。优化手段：启动阶段减少日志、用更高波特率、或将日志写入 ring buffer 后异步输出。

**参考资料：** Linux `initcall_debug` 启动分析, fastboot/instantboot 论文, QEMU `-semihosting` 输出替代 UART

---

### 8.2.4 硬件驱动簇 (H)：深入硬件交互

> **关于 USB/PCI 编号：** USB 和 PCI 方向已从功能扩展簇迁移至此。硬件驱动簇涵盖从总线枚举 (PCI)、外部设备协议 (USB) 到板上低速总线 (GPIO/I2C/SPI) 的完整硬件交互谱系。

---

#### H1：USB 设备驱动

让你的 OS 能够识别和使用 USB 设备。

| 属性               | 值                                                  |
| ------------------ | --------------------------------------------------- |
| **难度**     | ★★★ hard                                         |
| **前置阶段** | 阶段 4（trap/中断/MMIO）+ 建议先完成 H2（PCI 枚举） |
| **典型工期** | 2-4 周 (mastery)                                    |

**建议步骤：**

1. USB 主机控制器驱动（QEMU 提供 EHCI/xHCI 模拟）：通过 PCI 枚举发现 USB 控制器 (Class Code 0x0C03)，寄存器映射（USBCMD, USBSTS, PORTSC 等），理解 EHCI 的异步调度表和周期调度表
2. USB 设备枚举：Control Transfer 获取设备描述符 → SET_ADDRESS → 获取完整配置描述符
3. HID 驱动：解析 HID 报告描述符，配置 Interrupt IN 传输，注入内核输入子系统
4. USB Mass Storage：Bulk-Only Transport + SCSI READ(10)/WRITE(10)

**验证里程碑：**

| 里程碑 | 验证内容     | 判定标准                              |
| ------ | ------------ | ------------------------------------- |
| M1     | 控制器初始化 | HC Halted 位清零                      |
| M2     | 设备枚举     | Vendor/Product ID 与 QEMU 配置匹配    |
| M3     | HID 键盘     | USB 按键 → 串口回显                  |
| M4     | Mass Storage | 从 USB 磁盘读取文件，内容与 host 一致 |

**correctness_guard：** "传输超时不导致内核 hang" / "描述符解析有边界检查" / "设备断开时正确清理资源"

**benchmark_oracle：** 键盘延迟 < 50ms / Mass Storage 读取 > 1 MB/s

**常见陷阱：** 描述符字节序（小端）、传输超时处理（timer watchdog）、SETUP 包方向判断、EHCI qTD 链表原子更新

**GoalValidationContract 骨架：** `direction_id: "H1"` / baseline: 无 USB 支持 → target: EHCI + HID 键盘工作

**参考资料：** USB 2.0 规范（第 9/11 章）、EHCI 规范 (Intel)、QEMU `-device usb-ehci`、Linux `drivers/usb/`

**H1 深度检查点（用于 breakthrough 深度）：**

- 解释 EHCI 异步调度表（Async List）和周期调度表（Periodic List）的设计差异：为什么这些设计选择是必要的？
- 画出 Control Transfer 的 SETUP → DATA(IN/OUT) → STATUS 三个阶段的状态机，标注每个状态下的控制器寄存器操作
- 描述 HID 报告描述符的解析算法：如何从字节流构建出 "按键位置 3 的 bit 2 对应左 Shift 键" 的映射？
- 分析"如果 USB 键盘在按下按键的同时被拔出，你的驱动如何响应？"

---

#### H2：PCI 总线枚举与设备驱动

让你的 OS 能够发现和管理 PCI 设备。

| 属性               | 值                  |
| ------------------ | ------------------- |
| **难度**     | ★★★ hard         |
| **前置阶段** | 阶段 4（MMIO 映射） |
| **典型工期** | 2-4 周 (mastery)    |

**建议步骤：**

1. PCI 配置空间访问：通过 device tree 获取 ECAM 基址，`offset = (bus<<20)|(device<<15)|(function<<12)|reg` 寻址
2. 总线枚举：递归扫描 bus/device/function，跳过 Vendor ID = 0xFFFF，检测 Bridge (Class 0x0604) 并递归
3. BAR 解析：写全 1 → 读回 → 恢复 → bit 0 区分 Memory BAR(0)/I/O BAR(1)，掩码得基址和大小
4. 实现至少一个 PCI 设备驱动（virtio-gpu/blk/net）
5. 打印 QEMU 中所有 PCI 设备的 Vendor/Device/Class/BAR 信息

**验证里程碑：**

| 里程碑 | 验证内容     | 判定标准                                      |
| ------ | ------------ | --------------------------------------------- |
| M1     | 配置空间读取 | 正确读取 Vendor ID (virtio = 0x1AF4)          |
| M2     | 总线枚举     | 列举 QEMU`virt` 机器中 ≥3 个 PCI 设备      |
| M3     | BAR 映射     | BAR 读写正确反映大小，MMIO 访问设备寄存器成功 |
| M4     | 设备驱动     | 至少一个 PCI 设备通过 BAR 驱动工作            |

**correctness_guard：** "PCI 故障降级不崩溃" / "BAR 映射不覆盖已有 MMIO" / "multifunction 设备正确检测"

**benchmark_oracle：** QEMU 所有 PCI 设备被发现（对比 `lspci`）/ BAR 读写正确

**常见陷阱：** ECAM 基址不硬编码（用 device tree）、BAR 类型判断时序、Bridge 递归死循环防御、phantom function 避免

**GoalValidationContract 骨架：** `direction_id: "H2"` / baseline: 无 PCI 枚举 → target: 完整枚举 + BAR + 设备驱动

**参考资料：** PCI Local Bus Spec 3.0, PCIe Base Spec (ECAM), Linux `drivers/pci/`, osdev.org PCI, RISC-V DT binding

**H2 深度检查点（用于 breakthrough 深度）：**

- 解释 Type 0 和 Type 1 Configuration Request 的区别——为什么 PCI-to-PCI Bridge 对这两种请求的处理不同？
- 画出 MSI/MSI-X 中断的传递路径：从设备到 CPU 中断引脚的完整链路
- 分析一个真实的 PCIe Capability 链表（如 QEMU virtio-blk 设备的能力链表），解释每个 Capability 的用途
- 讨论：如果两个 PCI 设备的 BAR 地址范围重叠，系统会发生什么？你的枚举器如何防御？

---

#### H3：GPIO 驱动（通用输入输出）

**内容概述**：GPIO (General Purpose Input/Output) 是最简单的硬件接口——每个引脚可以独立配置为输入或输出，通过寄存器读写电平状态。

**H3 特有的深度检查点（用于 breakthrough 深度）：**

- 解释 GPIO 控制器的寄存器模型：数据寄存器（读当前电平/写输出电平）、方向寄存器（配置输入/输出）、中断使能寄存器的设计——为什么这些寄存器需要分开？
- 画出 GPIO 中断的触发路径：引脚电平变化 → GPIO 控制器检测边沿（上升/下降/双沿）→ 中断状态寄存器置位 → 中断控制器（PLIC/APIC）→ CPU trap handler。标注每个环节的延迟。
- 描述 pin multiplexing（引脚复用）：为什么一个物理引脚可以同时是 GPIO、UART TX、SPI CLK？如何在启动时配置 pinmux 以选择功能？
- 分析"去抖动"(debounce)的实现：机械开关在闭合时电平可能抖动 10-50ms——硬件 debounce（RC 滤波器）vs 软件 debounce（定时器 + 状态机）各有什么优缺点？
- 讨论：如果 GPIO 引脚配置为输出，但同时有外部设备在驱动该引脚——硬件短路风险如何避免？（上拉/下拉电阻、开漏输出、推挽输出的区别）

**参考资料：** 树莓派 GPIO 文档（BCM2835/BCM2711）, Linux GPIO 子系统 (`drivers/gpio/`), RISC-V GPIO 设备树 binding

---

#### H4：I2C 总线驱动

**内容概述**：I2C (Inter-Integrated Circuit) 是一种双线制串行总线——SCL（时钟）和 SDA（数据）。广泛用于连接传感器、EEPROM、PMIC 等低速外设。

**H4 特有的深度检查点（用于 breakthrough 深度）：**

- 画出 I2C 的 START / STOP 条件在 SCL/SDA 信号线上的波形——解释为什么 START 是"SDA 下降时 SCL 为高"而 STOP 是"SDA 上升时 SCL 为高"的巧妙设计（在非 START/STOP 时，SDA 只在 SCL 为低时变化）。
- 解释 7 位地址 vs 10 位地址的编码方式——10 位地址如何在不增加 START 条件的前提下保持与 7 位设备的兼容？
- 描述时钟拉伸 (Clock Stretching)：从设备可以拉低 SCL 来告诉主设备"我还没准备好"——主设备驱动如何检测和处理时钟拉伸？（超时处理？无限等待？）
- 画出 I2C 写事务和读事务的完整波形：START → 地址+R/W → ACK → 数据字节 → ACK → ... → STOP。标注每个 ACK/NACK 的含义。
- 分析多主设备场景下的仲裁机制：两个主设备同时发起 START 时，如何通过 SDA 线的"线与"特性检测冲突并仲裁？
- 讨论：I2C 的"重复 START"(Repeated START) vs 独立的 STOP+START 在原子性上有什么区别？（repeated START 防止其他主设备在 STOP 后插入事务）

**参考资料：** I2C 规范 (UM10204, NXP), Linux I2C 子系统 (`drivers/i2c/`), osdev.org I2C 页面, QEMU `-device i2c-echo` 用于测试

---

#### H5：SPI 总线驱动

**内容概述**：SPI (Serial Peripheral Interface) 是一种四线制全双工串行总线——SCLK（时钟）、MOSI（主出从入）、MISO（主入从出）、SS/CS（片选）。速度远超 I2C（MHz 级别），广泛用于 flash 存储器、显示屏、传感器。

**H5 特有的深度检查点（用于 breakthrough 深度）：**

- 解释 SPI 的四种模式 (Mode 0/1/2/3)：CPOL（时钟极性——空闲时 SCLK 为高还是低）和 CPHA（时钟相位——在第一个边沿还是第二个边沿采样数据）的组合。画出每种模式下 SCLK、MOSI、MISO 的时序图。
- 描述片选 (Chip Select) 管理策略：GPIO 手动控制 vs 硬件 CS 自动管理 vs 菊花链 (Daisy Chain) 连接。在多从设备场景下，CS 的切换顺序如何影响总线利用率？
- 分析全双工传输：SPI 的"发送一个字节同时接收一个字节"的特性——如何利用这一特性实现高效的数据交换？（如 flash 的"读命令"发送地址时同时接收 dummy byte，然后连续接收数据。）
- 解释 SPI Flash 的命令集：READ (0x03) vs FAST_READ (0x0B)、WRITE ENABLE (0x06)、SECTOR ERASE (0x20)、READ STATUS (0x05) 等。如何通过状态寄存器的 BUSY 位实现轮询等待？
- 讨论：SPI 的"无应答"特性——与 I2C 不同，SPI 没有 ACK/NACK。如果从设备不响应（如 flash 正在擦除），主设备如何检测故障？（读回全 0xFF 或全 0x00 通常表示异常——但需要与合法数据区分。）

**参考资料：** SPI 规范 (Motorola/Freescale), Linux SPI 子系统 (`drivers/spi/`), JEDEC SFDP 规范（SPI Flash）, osdev.org SPI 页面, QEMU `-device ssi-sd` (SPI SD 卡模拟)

---

### 8.2.5 前沿探索簇 (X)：走向未知领域

这些方向的参考资料更少，需要更多独立研究。适合对某个前沿方向有强烈好奇心的学生。

---

#### X1：Unikernel 形态

将应用和内核编译为单一镜像，取消用户态/内核态边界。

| 属性               | 值                 |
| ------------------ | ------------------ |
| **难度**     | ★★★ hard        |
| **前置阶段** | 阶段 7（完整内核） |
| **典型工期** | 2-4 周 (mastery)   |

**建议探索路径：**

1. 研究阶段：阅读 MirageOS、Unikraft 或 IncludeOS 的架构文档，理解 unikernel 的核心主张："如果只有一个应用，哪些 OS 抽象还需要保留，哪些可以变成库？"
2. 最小 unikernel 原型：创建一个最简单的应用（hello world）+ 你的内核的必要部分（启动、页表、UART 输出）→ 编译为单一 `.bin` 镜像，所有代码运行在 M-mode 或 S-mode 的同一特权级
3. 测量对比：
   - syscall 延迟（传统模式：用户态 `ecall` → 内核 → `sret` 返回）
   - 函数调用延迟（unikernel 模式：直接函数调用）
   - 镜像大小对比
4. 库 OS 模式：将内核功能（FS、网络）变成链接库而非独立服务。应用按需链接 `libfilesystem.a`、`libnetwork.a`

**探索问题（选 2-3 个写进你的 ADR）：**

- 没有用户态/内核态隔离后，"安全"如何保证？（语言级隔离？形式化验证？软件 fault isolation？）
- syscall 变成函数调用后，性能提升多少？代价是什么？（调试能力？多进程支持？）
- unikernel 和库 OS（Library OS）的关系是什么？它们是一个东西吗？

**验证里程碑：**

| 里程碑 | 验证内容         | 判定标准                                               |
| ------ | ---------------- | ------------------------------------------------------ |
| M1     | unikernel 启动   | 单一镜像启动并输出 "Hello"（所有代码运行在同一特权级） |
| M2     | syscall 开销对比 | unikernel 函数调用延迟 < 传统 ecall 延迟的 10%         |

**常见陷阱：**

1. **"用 unikernel 之名行单体内核之实"。** 如果你的"unikernel"只是把用户程序作为内核线程跑——你并没有取消内核/用户边界，你只是换了个说法。真正的 unikernel 是"没有内核，只有库"。
2. **混淆 unikernel 与无 OS。** Unikernel 不是 bare-metal 编程——它仍然提供了抽象（如 TCP 栈、文件系统），只是这些抽象以库而非独立服务的形式存在。

**参考资料：** MirageOS 论文 (ASPLOS 2013), MirageOS 文档, Unikraft 项目, IncludeOS 架构文档, 《Unikernels: The Next Stage of Linux's Dominance》(2019)

---

#### X2：形式化验证子集

选择内核的一个关键模块，用形式化方法证明关键不变量。

| 属性               | 值                             |
| ------------------ | ------------------------------ |
| **难度**     | ★★★★ extreme               |
| **前置阶段** | 阶段 3（页分配器——推荐起点） |
| **典型工期** | 3-6 周 (mastery)               |

**建议探索路径：**

1. 选模块：推荐从**页分配器**开始——状态空间小（freelist + 分配位图）、不变量清晰（"空闲页总数 + 已分配页总数 = 总物理页数"、"同一页不在 freelist 中出现两次"）
2. 写形式化规格（不变量定义）：
   - 用 TLA+（模型检查）或 Coq/Lean（交互式证明）
   - 例：TLA+ 中定义 `FreePages \cap AllocatedPages = {}` 和 `FreePages \cup AllocatedPages = AllPhysicalPages`
3. 模型检查（TLA+）：用 TLC 模型检查器验证所有状态迁移（alloc、free、alloc-alloc、free-free、alloc-free 交叉）下不变量恒成立
4. 代码级对应：将 TLA+ 规格与 C 代码对照，手工标注 C 代码中"这一行对应规格中哪个 transition"
5. 可选：用 Verus、VCC 或 Frama-C 对小段代码做静态验证。优先选状态空间小、边界清晰的函数，不要一开始验证整个模块

**探索问题（选 2-3 个写进你的 ADR）：**

- 什么性质适合形式化验证？（状态空间小、不变量清晰、边界明确的性质）
- 什么性质不适合？（涉及时间、涉及并发 fairness、外部环境假设过多的性质）
- 验证的假设（编译器正确、硬件符合 ISA 规范）在多大程度上是合理的？如果编译器有 bug，你的验证还成立吗？
- seL4 的验证涵盖了从 Haskell 原型到 C 到二进制的全链条——研究了 seL4 的验证方法后，你认为在你的内核上验证一个模块的可行间距有多大？

**验证里程碑：**

| 里程碑 | 验证内容     | 判定标准                                         |
| ------ | ------------ | ------------------------------------------------ |
| M1     | 不变量形式化 | TLA+ 或 Coq 中写出至少 3 条不变量定义            |
| M2     | 模型检查     | TLC 验证所有 transition 不违反不变量             |
| M3     | 代码标注     | 在源码中标注每个关键操作对应哪个 TLA+ transition |

**常见陷阱：**

1. **验证了错误的性质。** "页分配器从不返回 NULL"——这不是不变量，这是性能属性，且只在物理内存充足时成立。好的不变量是：从同一 freelist 分配的页从不重叠。
2. **验证的模型与代码不一致。** TLA+ 规格中 `alloc()` 是原子的，但 C 代码中 `alloc()` 包含多步操作（取 freelist 头、更新 freelist、清零页）。如果验证没有建模中间步骤，代码中的并发 bug 不会被发现。
3. **追求"完全验证"而止步于"部分验证"。** 证明一个模块的所有性质在理论上可能不可行（甚至不可判定）。seL4 的经验：先从最重要的 safety 性质开始，criticality 优先于 completeness。

**参考资料：** seL4 验证论文 (SOSP 2009), Ironclad 验证经验论文, Verus 项目与 Atmosphere 论文, TLA+ 教程 (Lamport 的 "The TLA+ Hyperbook"), Software Foundations (Coq 教材)

---

#### X3：多内核（Multikernel）

每个 CPU 有自己独立的内核实例，通过消息传递协调，而不是共享内存。

| 属性               | 值                                                                           |
| ------------------ | ---------------------------------------------------------------------------- |
| **难度**     | ★★★★ extreme                                                             |
| **前置阶段** | 阶段 5（调度+锁）+ 建议先理解多核同步基础（spinlock、内存序、TLB shootdown） |
| **典型工期** | 3-6 周 (mastery)                                                             |

**建议探索路径：**

1. 研究阶段：阅读 Barrelfish 论文 + Multikernel 论文 (Baumann et al., 2009)，理解核心主张——"共享内存在大规模多核下是性能瓶颈，消息传递更可扩展"
2. 设计消息协议：最小消息格式 `(src_cpu, dst_cpu, type, payload[])`，通过共享内存 ring buffer（过渡方案）或 IPI 实现 CPU 间通信
3. 实现 2-CPU 最小原型：每个 CPU 有独立的进程表、独立的调度器、独立的空闲页池。进程不跨 CPU 迁移。CPU 间通过消息协调（如 "请释放这个页，我需要它"）
4. 测量对比（2/4/8 CPU）：
   - 共享内存内核：全局调度队列 + 单一内核锁（典型的共享内存多核 OS 状态）
   - 消息传递内核：per-CPU 独立内核 + 消息协调
   - 对比：吞吐量、延迟分布、代码复杂度

**探索问题（选 2-3 个写进你的 ADR）：**

- 传统的"所有 CPU 共享内核数据"模型在多大核数下会失效？为什么？（缓存一致性流量？锁竞争？NUMA 延迟？）
- 消息传递的开销如何在设计中分摊？（批量消息？异步处理？pipeline？）
- 如果一个进程需要跨 CPU 访问资源（如两个 CPU 共享一个文件描述符），在 multikernel 模型中如何实现？复杂度与共享内存模型对比如何？

**验证里程碑：**

| 里程碑 | 验证内容        | 判定标准                                                   |
| ------ | --------------- | ---------------------------------------------------------- |
| M1     | 2-CPU 消息传递  | 两个 CPU 独立调度进程，CPU A 可向 CPU B 发送消息并收到回复 |
| M2     | 跨 CPU 资源协调 | CPU A 上的进程使用 CPU B 管理的文件描述符（通过消息转发）  |

**常见陷阱：**

1. **"消息传递变成另一种共享内存"。** 如果消息通过共享内存页传递（ring buffer 在共享内存中），你实际上是在共享内存上做消息传递——而非真正的 multikernel。真正的 multikernel 的消息通道至少在概念上是 point-to-point 的。
2. **性能退化。** 你的 multikernel 原型很可能比共享内存内核慢——这是正常的。教学价值在于理解"为什么慢"和"大规模下的拐点在哪里"，而不是"让 2 核更快"。
3. **过度设计消息协议。** 从最小可用消息格式（CPU ID + type + payload）开始。可以逐步增加功能（请求/响应匹配、超时、流控），但不要一开始就设计"完美的自描述消息格式"。

**参考资料：** Barrelfish 论文 (SOSP 2009), "The Multikernel: A new OS architecture for scalable multicore systems" (Baumann et al., HotOS 2009), Helios 项目论文

---

#### X4：微内核重构

将你的宏内核重构为微内核架构：文件系统、网络栈、设备驱动移到用户态服务进程。内核仅保留 IPC、调度、内存管理。

| 属性               | 值                   |
| ------------------ | -------------------- |
| **难度**     | ★★★★ extreme     |
| **前置阶段** | 阶段 7（完整宏内核） |
| **典型工期** | 3-6 周 (mastery)     |

**建议探索路径：**

1. 设计 IPC 快速路径：定义消息格式（`(sender, reply_port, opcode, payload)`），实现同步 IPC（send → block → reply → unblock）和异步 IPC（send → continue → notify）
2. 提取第一个用户态服务（建议从设备驱动开始——驱动有清晰的 MMIO 接口，容易隔离）：
   - 将 virtio-blk 驱动移到独立用户态进程
   - 内核提供 `map_mmio(va, pa, size)` 调用让驱动访问设备 MMIO
   - 文件系统通过 IPC 向驱动服务发送读写请求
3. 提取文件系统服务：将 ext2/bio/log 层整体移到用户态进程 → 应用通过 IPC 访问 FS 服务
4. 性能对比：IPC 延迟（微内核 IPC round-trip vs 宏内核 syscall round-trip）

**验证里程碑：**

| 里程碑 | 验证内容       | 判定标准                                          |
| ------ | -------------- | ------------------------------------------------- |
| M1     | IPC 基础设施   | 两个用户态进程可通过内核 IPC 通信                 |
| M2     | 驱动移到用户态 | virtio-blk 驱动在用户态运行，FS 通过 IPC 访问磁盘 |
| M3     | 功能完整性     | 所有现有用户程序正常运行（尽管一些服务在用户态）  |

**correctness_guard：**

- "用户态服务崩溃不拖垮内核——内核检测到服务崩溃后重启服务，不影响其他服务"
- "IPC 的消息缓冲区不泄漏——所有消息在接收方读取后正确释放"

**常见陷阱：**

1. **IPC 性能陷阱。** 微内核的 IPC 路径是性能命脉——如果每次 IPC 都需要多次 `ecall` + 上下文切换 + 地址空间切换，你的微内核会比宏内核慢 10-100 倍。优化：共享内存通道、批量消息传递、内核中缓存连接状态。
2. **服务依赖循环。** FS 服务需要磁盘驱动 → 磁盘驱动需要一个配置文件 → 配置文件在 FS 上。启动阶段需要特殊处理（如内核内嵌的最小启动 FS）。
3. **微内核≠"把所有东西移到用户态"。** 调度器和内存管理器仍在内核中——微内核的核心是"最小化内核"，不是"空洞化内核"。

**参考资料：** seL4 论文, MINIX 3 论文, L4 微内核家族论文, GNU Hurd 设计文档

---

#### X5：eBPF 类内核内虚拟机

实现一个小型 in-kernel VM，允许安全执行用户提交的验证/过滤/追踪代码。

| 属性               | 值                 |
| ------------------ | ------------------ |
| **难度**     | ★★★★ extreme   |
| **前置阶段** | 阶段 7（完整内核） |
| **典型工期** | 4-6 周 (mastery)   |

**建议探索路径：**

1. 设计字节码指令集（最小起手势）：
   - RISC 风格：`mov`, `add`, `sub`, `mul`, `div`, `ld`, `st`, `jeq`, `jne`, `jmp`, `call`, `ret`
   - 64 位寄存器（R0-R10），R10 固定为栈帧指针
   - 无浮点、无 SIMD（最小 scope）
2. 实现静态 verifier（这是本方向最难的部分）：
   - 控制流图 (CFG) 构建：探测所有可达指令、拒绝不可达的 dead code
   - DAG 检查（无循环）：对 CFG 做拓扑排序 → 有回边则拒绝
   - 寄存器类型跟踪：每个指令执行后每个寄存器的类型（`PTR_TO_CTX`, `PTR_TO_STACK`, `SCALAR_VALUE`）和边界（`[min, max]`）
   - 内存访问验证：所有 `ld`/`st` 的目标地址在 verifier 阶段确定合法范围
3. 先实现解释执行：
   - 解释器性能较差，但容易审计，也方便把 verifier 的假设和运行时行为对齐
   - JIT 编译作为进阶：将字节码编译为 RISC-V 本机指令，并证明生成代码仍然遵守 verifier 已检查的边界
4. 暴露 hook 点：
   - kprobe 风格：指定内核函数地址，BPF 程序在该函数入口/出口执行
   - syscall tracepoint：每次 `ecall` 时触发 BPF 程序

**验证里程碑：**

| 里程碑 | 验证内容           | 判定标准                                         |
| ------ | ------------------ | ------------------------------------------------ |
| M1     | 字节码解释器       | 手工编写的简单字节码程序正确执行                 |
| M2     | verifier           | 恶意字节码（无限循环、越界访问）被 verifier 拒绝 |
| M3     | syscall tracepoint | BPF 程序统计每种 syscall 的调用次数              |

**correctness_guard：**

- "BPF 程序绝不能导致内核崩溃——verifier 的拒绝（false positive）可以接受，但错误放行（false negative）不可接受"
- "BPF 程序有最大指令数限制——防止 verifier 分析超时或 JIT 生成无限代码"
- "内核内存不通过 BPF 程序泄漏——所有 `PTR_TO_STACK` 类型的读操作不超出栈帧范围"

**常见陷阱：**

1. **verifier 不完整。** 一个字节码程序中看似无害的 `ld [r0 + offset]`，在运行时 `r0` 可能指向任意内核地址。verifier 必须跟踪每个寄存器的值范围和类型——这不是可选的优化，是安全性的基础。
2. **JIT 的隔离性。** JIT 编译的代码运行在内核态——一个越界的 store 指令会直接写坏内核内存。JIT 生成代码前必须在编译时插入边界检查（或在 JIT 时验证所有访问在合法范围）。
3. **Spectre 风格侧信道。** BPF verifier 可以阻止直接的内存越界访问，但无法阻止推测执行中的越界访问。这是 eBPF 社区仍在积极研究的问题——在你的原型中可以忽略，但在 ADR 中记录这个已知局限。

**参考资料：** Linux eBPF verifier 源码 (`kernel/bpf/verifier.c`), eBPF 指令集规范 (IETF draft), "A Thorough Introduction to eBPF" (LWN), "BPF and Spectre: Mitigating Transient Execution Attacks" (LWN)

---

#### X6：持久内存 (PMEM) 支持

让文件系统直接映射到持久内存地址空间，绕过页缓存（Page Cache）。

| 属性               | 值                  |
| ------------------ | ------------------- |
| **难度**     | ★★★ hard         |
| **前置阶段** | 阶段 6（FS/bio 层） |
| **典型工期** | 2-4 周 (mastery)    |

**建议探索路径：**

1. 模拟 PMEM 设备：QEMU 支持 `-object memory-backend-file,id=mem0,share=on,mem-path=pmem.img,size=64M -device nvdimm,id=nvdimm0,memdev=mem0` 创建 NVDIMM 设备
2. 识别 PMEM 区域：通过 ACPI NFIT 表（或 device tree 中的 `pmem` 节点）发现持久内存的物理地址范围和大小
3. 实现 DAX（Direct Access）映射：
   - `mmap()` 文件时，不通过 buffer cache——直接将文件所在的 PMEM 物理页映射到用户地址空间
   - 用户的 store 指令直接变成 PMEM 上的持久写入
4. 崩溃一致性保证：
   - `msync()` / `fsync()` 的实现：在关键写入点后执行 `fence` + cache flush（RISC-V `CBO.clean`/`CBO.flush` 指令或 SBI 调用）
   - 确保 PMEM 上的数据在崩溃重启后一致（至少文件系统元数据一致）

**验证里程碑：**

| 里程碑 | 验证内容  | 判定标准                                                         |
| ------ | --------- | ---------------------------------------------------------------- |
| M1     | PMEM 识别 | 内核启动日志显示检测到的 PMEM 区域                               |
| M2     | DAX 映射  | 用户`mmap` PMEM 文件后，写入的值在重启后仍存在（无 `fsync`） |
| M3     | 性能对比  | DAX 路径吞吐量 > buffer cache 路径的 2×                         |

**correctness_guard：**

- "PMEM 上的文件系统元数据在崩溃后一致——至少满足 fsck 可修复的条件"
- "DAX 映射不绕过文件权限检查——`mmap` PMEM 文件仍受 `open()` 时的权限控制"
- "cache flush 在关键点后必定执行——flush 遗漏是不可接受的正确性 bug"

**常见陷阱：**

1. **cache flush 遗漏。** 对于 PMEM，CPU cache 是 volatile 的——store 到 PMEM 地址会先进 CPU cache，需要显式 flush 才能到达持久介质。遗漏 flush → 崩溃后数据丢失。最隐晦的 bug：看起来"立即读回"是正确的（因为 cache hit），但持久化失败了。
2. **原子性边界误判。** 一个 8 字节的 store 在 x86 上是原子的（对齐时），但在 RISC-V 上不保证。如果崩溃发生在 store 中间，PMEM 上可能有 torn write。解决方案：使用 8 字节的原子操作或实现 redo log。
3. **混淆 fsync vs cache flush。** PMEM 模式下的 `fsync` 语义不同于传统磁盘——传统 `fsync` 保证数据已写到磁盘，PMEM 的 `fsync` 只需要 flush CPU cache。实现不对可能永远不 flush（数据在 cache 中不出去）或过度 flush（每条 store 都 flush，性能极差）。

**参考资料：** Linux DAX/PMEM 子系统 (`fs/dax.c`, `drivers/nvdimm/`), SNIA NVM Programming Model 规范, PMDK (Persistent Memory Development Kit), QEMU NVDIMM 文档

---

### 8.2.6 架构设计簇 (A)：内核代码的组织与抽象

这些方向不增加新功能、不优化性能、不兼容外部生态——它们关注一个更根本的问题：**当内核的复杂度增长时，你用什么设计方法论来管理它？**

架构设计簇是**横切关注点**——你可以在做 F/C/O/X 方向的任何阶段引入 A 簇的设计思想。Linux 内核中大量使用函数指针表（`struct file_operations`、`struct device_driver`、`struct sched_class`）来模拟面向对象的多态——这不是偶然的，是管理复杂度的必然。Windows NT 更进一步，把一个完整的对象管理器做进了内核。A1 方向让你探索：**如果你的内核从一开始就用面向对象的方法组织，它会是什么样子？**

---

#### A1：内核面向对象设计 (Kernel Object-Oriented Design)

为内核设计一个统一的类型系统、对象生命周期管理、和多态操作接口——不是用 C++ 写内核（那会引入异常、RTTI 等不适用于内核的运行时），而是用 C 的结构体和函数指针，系统地实现面向对象的三个核心原则：封装、继承、多态。

| 属性               | 值                                                                  |
| ------------------ | ------------------------------------------------------------------- |
| **难度**     | ★★★ hard                                                         |
| **前置阶段** | 阶段 7（完整内核——你已拥有足够多的内核子系统来理解 OOP 的必要性） |
| **典型工期** | 2-4 周 (mastery)                                                    |

**建议步骤：**

1. **对象类型系统 (Type Descriptor)：**

   - 定义 `struct kobj_type`（内核对象类型描述符）：
     ```c
     struct kobj_type {
         const char *name;           // 类型名（如 "process", "file", "pipe", "socket"）
         size_t instance_size;       // 实例大小
         void (*ctor)(void *obj);   // 构造器
         void (*dtor)(void *obj);   // 析构器
         const struct kobj_ops *ops; // 操作表
     };
     ```
   - 每个内核对象在分配时关联一个 `kobj_type`——运行时可通过 `kobj_type` 判断对象类型（Runtime Type Identification）
   - 验证：创建不同类型的对象，通过类型描述符区分它们
2. **统一对象生命周期管理：**

   - 引用计数基类：每个内核对象的前 N 个字节包含一个 `struct kref`（atomic refcount +  destructor callback）
   - `kobj_get(obj)` / `kobj_put(obj)`：增加/减少引用计数——count 归零时自动调用 `dtor` 释放
   - 所有资源共享同一套引用计数机制（进程、文件、管道、socket、页表——不再各自维护自己的 refcount）
   - 验证：100 次 fork+exit 后，所有通过 `kobj` 分配的对象无泄漏
3. **多态操作接口 (Virtual Function Table)：**

   - 定义 `struct kobj_ops`（通用操作表）：
     ```c
     struct kobj_ops {
         int  (*open)(void *obj, int flags);
         int  (*close)(void *obj);
         ssize_t (*read)(void *obj, char *buf, size_t n, off_t offset);
         ssize_t (*write)(void *obj, const char *buf, size_t n, off_t offset);
         int  (*ioctl)(void *obj, int cmd, void *arg);
         int  (*mmap)(void *obj, struct vm_area *vma);
     };
     ```
   - 每个 `kobj_type` 关联一个 `kobj_ops` 实例
   - `kobj_read(obj, ...)`  → 找到 `obj->type->ops->read` → 调用。调用者不需要知道 `obj` 是文件、管道还是 socket
   - 验证：同一个 `read()` syscall 路径，通过 vtable 分发到文件、管道、socket 的不同实现
4. **统一命名空间 (Object Directory)：**

   - 实现一个内核对象目录树（类似 Windows NT Object Manager 的 `\??\` 命名空间或 Linux 的 `/sys`）：
     ```
     /Objects/
       Process/1/
       Process/2/
       Device/console/
       Device/null/
       Filesystem/root/
       Pipe/0x80123456/
     ```
   - 对象可通过路径查找，也可以通过 capability/fd 直接引用
   - 验证：`kobj_lookup("/Objects/Process/1")` 返回进程 1 的对象指针；删除对象后路径自动移除
5. **安全描述符关联：**

   - 每个 `kobj` 关联一个 ACL（访问控制列表）或 capability 需求
   - 操作前，`kobj_ops` 的每个方法在执行前检查调用者是否有权限
   - 验证：无权限进程调用 `kobj_read()` 返回 `-EACCES`
6. **对象序列化与检查点：** 将内核对象树的状态序列化到磁盘（检查点），供调试或崩溃恢复

**验证里程碑：**

| 里程碑 | 验证内容 | 判定标准                                                                    |
| ------ | -------- | --------------------------------------------------------------------------- |
| M1     | 类型系统 | 根据对象指针可查询其类型名（`kobj_type_name(obj)` 返回字符串）            |
| M2     | 引用计数 | 100 次 fork+exit，`kobj_stats()` 报告 0 个泄漏对象                        |
| M3     | 多态分发 | 同一个`sys_read` 路径正确处理文件/管道/socket（通过各自的 `ops->read`） |
| M4     | 对象目录 | 创建文件对象后，`kobj_lookup("/Objects/File/xxx")` 返回正确对象           |
| M5     | ACL      | 无读权限的进程调用`kobj_read(file_obj)` 返回 `-EACCES`                  |

**correctness_guard：**

- "对象引用计数归零后其内存被释放——不出现 use-after-free"
- "类型转换安全检查：`kobj_cast(obj, KOBJ_TYPE_FILE)` 在类型不匹配时返回 NULL——不静默地将 pipe 当作 file 操作"
- "对象目录与对象生命周期一致——对象销毁时其目录项自动移除，不产生悬空目录项"
- "多态操作表的函数指针在对象生命周期内不变——不出现 vtable 被篡改的情况"

**benchmark_oracle：**

- vtable 分发开销：`kobj_read()` 的额外开销 < 5%（对比直接函数调用）
- 对象创建/销毁：`kobj_alloc()` + `kobj_put()` 的开销 < 100ns（对比原始 `kmalloc`/`kfree`）
- 对象目录查找：`kobj_lookup()` < 1μs（1000 个对象的目录树）

**案例分析：Linux VFS 的 `struct file_operations` —— OOP 的成功先例**

Linux 没有在内核中完整实现 OOP，但它的 VFS 层是一个经典的面向对象设计：

```c
// Linux 源码中的 file_operations（简化）
struct file_operations {
    int (*open)(struct inode *, struct file *);
    ssize_t (*read)(struct file *, char __user *, size_t, loff_t *);
    ssize_t (*write)(struct file *, const char __user *, size_t, loff_t *);
    int (*mmap)(struct file *, struct vm_area_struct *);
    int (*release)(struct inode *, struct file *);
    // ... 20+ more function pointers
};
```

每个文件系统（ext2、tmpfs、procfs）提供自己的 `file_operations` 实现——上层的 `sys_read()` 只需要调用 `file->f_op->read()`，不需要知道文件系统类型。这是一个 vtable 的经典用例。

**案例分析：Windows NT Object Manager —— OOP 的完整实现**

Windows NT 的内核对象管理器是一个完整的 OOP 框架：

- 所有内核资源（进程、线程、文件、事件、互斥量、注册表键）都是对象
- 每个对象有类型描述符（`OBJECT_TYPE`），包含类型名、操作函数表、初始引用计数
- 统一的命名空间（`\??\` 下的对象目录树）
- 统一的安全模型（每个对象关联安全描述符，由安全引用监视器检查）
- 统一的引用计数和句柄管理

Windows NT 的对象管理器代码量远超你的 OS 可能承受的范围——但它的设计哲学是 A1 方向最重要的参考。

**常见陷阱：**

1. **过度设计。** 不是所有内核数据结构都需要成为一个 `kobj`。页表条目、freelist 节点、中断向量条目——这些是内部实现细节，不应该暴露到对象系统中。规则：如果多个子系统需要通过统一接口访问它 → 是对象；如果只有一个子系统使用 → 可能不需要。
2. **vtable 开销被夸大。** 一次额外的指针解引用（`obj->ops->read`）在现代 CPU 上的开销约为 1-2 个 cycle（L1 cache hit 时）。相比之下，syscall 本身的上下文切换开销（cache miss + TLB flush）是数千个 cycle。不要把性能优化的精力放在 vtable 上。
3. **类型系统与 C 语言的张力。** C 没有继承和 RTTI。你需要在结构体的第一个字段放置 `kobj` 基类（"继承"），并手动维护类型 ID。用宏生成样板代码可以减轻痛苦，但不要发明一套完整的预处理器 DSL —— 保持 C 的简洁。
4. **引用计数循环。** 如果对象 A 引用对象 B、B 又引用 A，纯引用计数无法释放。解决方案：要么在设计中避免循环（父引用子、子不引用父——只通过路径查找父），要么引入弱引用（不阻止对象释放的引用）。
5. **把 OOP 当目的而非工具。** "我是面向对象的操作系统"不是设计目标。"我的文件、管道、socket 通过同一套接口操作，代码量减少 30%，bug 率降低 50%"——这才是 A1 方向要达成的目标。

**GoalValidationContract 骨架：**

```yaml
direction_id: "A1"
category: "architecture"
depth: "mastery"
baseline:
  description: "各内核子系统各自管理资源生命周期，无统一对象抽象"
  metrics:
    - { name: "unified_type_system", value: false }
    - { name: "polymorphic_dispatch", value: false }
    - { name: "centralized_refcounting", value: false }
target:
  description: "所有主要内核资源（进程、文件、管道、socket）通过统一的 kobj 类型系统管理，引用计数统一，支持多态操作分发"
  metrics:
    - { name: "unified_type_system", value: true }
    - { name: "polymorphic_dispatch", value: true }
    - { name: "centralized_refcounting", value: true }
    - { name: "object_directory", value: true }
correctness_guard:
  - "引用计数归零后对象内存被正确释放"
  - "类型转换有安全检查"
  - "对象目录与生命周期一致"
  - "vtable 不可篡改"
benchmark_oracle:
  - { name: "vtable_overhead", pass_condition: "< 5% vs 直接调用" }
  - { name: "obj_create_destroy_latency", pass_condition: "< 100ns (对比 kmalloc/kfree)" }
  - { name: "obj_lookup", pass_condition: "< 1μs (1000 对象目录)" }
negative_tradeoff_checks:
  - { name: "kernel_image_size", max_allowed: "增长 < 15%（kobj 基础设施）" }
  - { name: "existing_tests", max_allowed: "100% 通过（迁移到 kobj 后）" }
  - { name: "code_complexity", max_allowed: "核心路径（syscall 分发）的代码行数不增加" }
```

**参考资料：** Windows NT Object Manager（《Windows Internals》第 7 版第 3 章），Linux `struct file_operations` / `kobject` / `kref` 源码，seL4 capability 类型系统，《Design Patterns》（Gamma et al.）——特别是 Composite、Visitor、Observer 模式在内核中的适用性

**案例分析：macOS IOKit —— C++ 内核框架的生产级实践**

macOS 和 iOS 的 IOKit 是内核中大规模使用 C++ 的最著名案例。IOKit 不是"用 C 模拟 OOP"——它直接使用 C++ 实现了驱动框架：

- **受限 C++ 子集**：IOKit 使用 C++ 但禁止异常（`-fno-exceptions`）、禁止 RTTI（`-fno-rtti`）、使用 IOKit 自己的运行时类型系统（`OSMetaClass`）替代 `dynamic_cast`
- **引用计数基类**：`OSObject` 是所有 IOKit 对象的基类，内置 `retain()`/`release()` 引用计数——与 A1 的 `kobj` + `kref` 概念完全一致
- **多态驱动模型**：每个驱动是一个 `IOService` 子类，通过 `probe()`/`start()`/`stop()` 虚函数实现生命周期管理。驱动间通过 `IOService::waitForService()` 自动匹配依赖
- **I/O Kit Registry**：内核对象树（类似 A1 的对象目录）——`ioreg` 命令行工具可以浏览整个内核对象图

**C++ 在内核中的正确用法：** 如果你选择在 A1 中使用 C++（而非 C + 函数指针），需要准备好受限的运行时：

- 全局 `operator new`/`operator delete` 映射到内核内存分配器（`kmalloc`/`kfree`）
- 禁止全局构造函数（或实现 `.init_array` 遍历）——内核启动早期 C 运行时未就绪
- 虚函数表（vtable）就是 A1 的 `kobj_ops`——但 C++ 编译器自动生成，减少手写样板
- 模板（template）谨慎使用——每个实例化增加代码量（与 O2 极小足迹冲突）

IOKit 的教训：C++ 可以写出比 C 更清晰的内核代码（虚函数替代函数指针表、RAII 管理锁/内存），但代价是工具链依赖和调试难度（内核 panic 时的 C++ 栈展开几乎不可行）。

---

#### A2：Plan 9 一切皆文件模型 (Plan 9 Everything-is-a-File)

将你的 OS 的资源模型从"fd-based + 特殊 API（socket/ioctl）"彻底改造为 Plan 9 风格——每个进程拥有独立的命名空间，所有资源（文件、网络连接、设备、UI）通过统一的文件操作（open/read/write/close）访问。这是对"一切皆文件"哲学的最彻底实践，也是架构设计簇的核心方向——它改变了你思考"资源是什么"的方式。

| 属性               | 值                                                   |
| ------------------ | ---------------------------------------------------- |
| **难度**     | ★★★★ extreme                                     |
| **前置阶段** | 阶段 7（完整内核——需要成熟的资源模型作为改造基础） |
| **典型工期** | 3-5 周 (mastery)                                     |

**建议步骤：**

1. **per-process namespace：** 每个进程维护私有挂载表，`bind(path1, path2, flags)` 支持 REPLACE/BEFORE/AFTER 挂载模式。验证：两个进程分别 bind 不同目录到 `/tmp`，互不可见
2. **合成文件系统：** 实现最小 9P 服务器框架（Tversion/Tattach/Twalk/Topen/Tread/Twrite/Tclunk），将内核信息暴露为实时文件而非文本转储。示例：`/net/tcp/clone` 创建连接
3. **网络栈文件化：** TCP 连接 = `/net/tcp/<id>/ctl` + `/net/tcp/<id>/data`——通过 `cat`/`echo` 完成 HTTP 请求
4. **设备文件化：** 串口→`/dev/uart/0/data`，framebuffer→`/dev/fb/data`
5. Union Directory、远程 9P import

**correctness_guard：** "命名空间隔离不可绕过" / "合成文件语义与磁盘文件一致" / "文件服务器崩溃不 panic"

**benchmark_oracle：** 合成文件读取 < 10μs / HTTP 吞吐 ≥ 80% native socket

**常见陷阱：** 文件化性能代价（热路径开销）、命名空间克隆膨胀（CoW 挂载表）、合成文件 `st_size=0` 兼容性

**参考资料：** Plan 9 手册 (intro(1), bind(1), 9p(5)), 9P2000 协议规范, Plan 9 from Bell Labs 论文

---

#### A3：异步运行时 (Async Runtime)

为内核实现一个异步 I/O 运行时——不是简单的"发起 I/O→回调"，而是一个完整的 async/await 风格并发框架，包括任务调度器、唤醒机制、和取消语义。Linux 的 io_uring 证明了异步模式在内核中的价值；A3 探索的是**如果你的内核从 syscall 层开始就原生支持异步，它会是什么样子**。

| 属性               | 值                 |
| ------------------ | ------------------ |
| **难度**     | ★★★★ extreme   |
| **前置阶段** | 阶段 7（完整内核） |
| **典型工期** | 3-5 周 (mastery)   |

**建议步骤：**

1. **Future/Task 抽象：** 定义 `struct future`（表示一个尚未完成的异步操作）和 `struct task`（一个可暂停/恢复的执行上下文）。future 有 `poll()` 方法——返回 `Ready(result)` 或 `Pending`（注册 waker 后返回）
2. **Waker 机制：** 当 future 返回 Pending 时，它向内核注册一个 waker——I/O 完成时调用 waker 唤醒等待的任务。确保唤醒不丢失（edge-triggered vs level-triggered 的选择）
3. **内核执行器：** 实现一个内核态的任务调度器——维护就绪任务队列，循环 poll→Pending→等待 I/O→唤醒→重新入队。支持多核 work-stealing
4. **Syscall 异步化：** 将关键 syscall（`read`、`write`、`accept`）改为异步版本——`async_read(fd, buf, n)` 返回 future，用户态可 await
5. 取消语义：如果异步操作被取消（如进程被 kill），如何通知 I/O 子系统？如何处理已部分完成的操作？

**验证里程碑：**

| 里程碑 | 验证内容     | 判定标准                                              |
| ------ | ------------ | ----------------------------------------------------- |
| M1     | future 轮询  | 异步 sleep future 在指定时间后被唤醒并返回 Ready      |
| M2     | waker 不丢失 | 10000 次并发异步 I/O，每次都被正确唤醒（无悬挂任务）  |
| M3     | 多核调度     | work-stealing 在 4 CPU 下任务分布均衡（标准差 < 20%） |
| M4     | 取消         | 取消正在进行的异步 I/O 后资源正确回收                 |

**correctness_guard：** "唤醒不丢失" / "取消不泄漏资源" / "future 状态转换原子化（Pending→Ready 不可逆）"

**常见陷阱：**

1. **状态机爆炸。** 手动管理异步状态机（当前执行到哪一步、哪些资源已分配）极易出错。结构化并发（structured concurrency）是防御手段
2. **唤醒丢失（lost wakeup）。** 经典的竞态：I/O 完成发生在 future 注册 waker 之前——完成中断触发时 waker 尚未注册，导致任务永久悬挂。解决方案：在注册 waker 后再次检查 I/O 是否已完成
3. **取消的级联效应。** 取消一个 future 可能影响其他依赖它的 future——需要明确定义取消传播语义（cancellation token 或类似机制）

**参考资料：** Rust `std::future` / `async`/`await` 设计文档, Linux io_uring 的 SQPOLL 模式和 IORING_OP_ASYNC_CANCEL, seL4 异步 IPC (Notification), 《Structured Concurrency》 (Lewis Baker)

---

#### A4：机制与策略分离 (Mechanism-Policy Separation)

经典 OS 设计原则："机制提供**怎么做**的能力，策略决定**做什么**的选择"。将这一原则系统地应用到你的内核的每个子系统中——调度器、内存管理、文件系统、设备驱动。

| 属性               | 值                                                       |
| ------------------ | -------------------------------------------------------- |
| **难度**     | ★★★ hard                                              |
| **前置阶段** | 阶段 7（完整内核——需要足够多的子系统来理解分离的价值） |
| **典型工期** | 2-4 周 (mastery)                                         |

**建议步骤：**

1. **调度器分离：** 内核只提供"可抢占的优先级队列"机制，调度策略（RR/FIFO/CFS/EDF）编译为独立模块或在用户态配置。验证：切换调度策略不需要重新编译内核
2. **内存管理分离：** 内核提供"物理页分配 + 虚拟地址映射"机制，页面换出策略（LRU/Clock/WorkSet）在用户态决策（通过 `madvise` 风格的 syscall 或用户态 page fault handler）
3. **文件系统分离：** 内核提供"inode + 块设备 + buffer cache"机制，具体文件系统格式（ext2/FAT/tmpfs）编译为可加载模块（配合 F9）。验证：加载 ext2 模块后挂载 ext2 磁盘，卸载模块后仍能挂载 FAT 磁盘
4. **设备驱动分离：** 内核提供"MMIO 映射 + DMA + 中断路由"机制，设备驱动在用户态运行（配合 X4 微内核）。验证：virtio-blk 驱动在用户态进程运行，内核仅转发中断
5. 编写一份 ADR：记录"在每个子系统中，哪些是机制、哪些是策略？边界为什么画在这里？"

**验证里程碑：**

| 里程碑 | 验证内容   | 判定标准                                       |
| ------ | ---------- | ---------------------------------------------- |
| M1     | 调度器分离 | 更换调度策略后系统正常运行（至少两种策略可用） |
| M2     | FS 分离    | 加载/卸载 FS 模块不影响其他 FS 模块和内核稳定  |
| M3     | 边界文档   | ADR 中清晰定义了每个子系统的机制-策略边界      |

**correctness_guard：** "策略变更不破坏机制的正确性" / "机制的性能不过度退化（分离引入的间接调用开销 < 5%）"

**常见陷阱：**

1. **过度抽象。** 为"可能切换的策略"设计复杂的插件接口，但实际上只有一种策略实现——YAGNI。只在确定存在多种策略时才分离
2. **边界模糊。** "内存不足时 kill 哪个进程"——这是策略还是机制？Linux 的 OOM killer 把策略做进了内核——A4 的理念是把它暴露给用户态决策
3. **性能退化。** 每次策略决策都需要用户态往返（如 page fault 时问用户态"换出哪页"）——延迟不可接受。缓解：机制提供"默认策略"，用户态可覆盖但默认走快速路径
4. **机制不够强大。** 如果机制没有暴露足够的控制点（如调度器只提供"nice 值"而没有"deadline"参数），策略无法表达复杂需求——机制设计需要预见到策略的多样性

**参考资料：** 《The Design and Implementation of the 4.4BSD Operating System》（McKusick）, exokernel 论文 (MIT, 1998), Linux VFS 的 `struct file_operations`（文件系统作为策略）, Linux `sched_class`（调度器作为策略）

---

## 8.4 常见陷阱

### 单方向陷阱

**目标太大。** "完整的 TCP/IP 栈"需要一学期。"能 ping 通"需要一周。选择可验证的里程碑。

**correctness_guard 虚设。** "不破坏已有功能"太笼统。映射到具体的测试套件。

**专项优化牺牲基本正确性。** 为了极速启动跳过 BSS 清零——这不叫优化，叫 bug。

### 多方向陷阱

**方向太多，全是 explore。** 5 个方向各做 20% = 0 个方向学到东西。选择 1-2 个方向做到 mastery 深度，远好于"撒胡椒面"。

**方向冲突未声明。** 同时选 O2（极小足迹）和 F3（GUI），但不在 ADR 中说明这个矛盾。这不是"我都要"——这是"我没想清楚"。

**虚假融合。** 在 ProfileSpec 中声明了"交织"关系，但实际上两个方向的代码互不感知。融合关系需要体现在设计上——共享的数据结构、联合的不变量、交叉的测试用例。

**跨方向不变量遗漏。** C1（Linux ELF）+ O4（安全加固）——如果 C1 的 ELF 加载器没有继承 O4 的 W^X 保护，那么一个恶意 ELF 就能绕过所有安全加固。"兼容"和"安全"在你声明交织的那一刻，就不再是独立的方向。

**忽略依赖顺序。** H2（PCI）→ H1（USB）→ F1（网络）这条链，如果先做 F1 再做 H1，你会发现你的网卡驱动建立在"QEMU 帮你预设好的 virtio-net 地址"上——没有经过 PCI 枚举，移植性为零。先做基础设施方向，再做依赖它的上层方向。

---

## 8.5 本章小结

阶段 8 不是"做一个附加项目"。它是**你 OS 的设计宣言**——通过方向选择、深度承诺、融合关系和不变量定义，你说清楚了"我的 OS 为什么而存在"。

从阶段 1 的 ArchitectureSeed 到这里，你完成了从"我打算做一个 OS"到"我做了一个什么样的 OS"的完整闭环。方向速查表帮你 30 秒初筛，详细的方向指南帮你理解每个维度的深度挑战，ProfileSpec 模板和示例帮你将设计判断落实为可验证的承诺。

进入 Final Lab 前，确认 `vos verify full --target profile` 通过。
