# Lab 6：文件系统——从块设备到崩溃一致性

> **对应教材**：[第 6 章：文件系统](../book/ch06-filesystem.md)

> **本 Lab 概览**
>
> - **学完能做什么**：实现一个可写的文件系统，从块设备、buffer cache、inode/目录到日志，四层各自独立可验证，并能在故障注入下证明崩溃一致性。
> - **预计耗时**：16–22 小时，建议安排 2 周。块设备与 buffer cache 约四分之一，inode/目录约四分之一，日志与崩溃注入约占一半。
> - **前置依赖**：已完成 Lab 5（用户程序能通过 syscall 读写），阅读第 6 章。
> - **产出物**：`kernel/virtio`、`kernel/bio`、`kernel/log`、`kernel/inode`、`kernel/file` 五个 ModuleSpec，文件 ABI 更新，实现与崩溃注入矩阵，空间泄漏检查，串口/测试证据。
> - **评分构成**：质量门禁 70% + 设计理据 20% + 挑战/加分 10%（可选）。实际分值以教师公布为准。
> - **实际耗时**：在提交物里记录本次 Lab 实际投入小时数。

## 1. 设计问题

- 磁盘布局如何版本化，超级块损坏时如何失败？
- buffer cache 如何保证同一块只有一个内存副本？
- inode、目录项和路径解析的锁顺序是什么？
- 分配位图与 inode 引用计数如何避免泄漏？
- 掉电发生在一次更新中间时，重启后允许看到什么状态？

Lab 1 只读镜像热身在这里扩展为可写文件系统。实现按块设备、buffer cache、inode/目录和日志四层推进，每层都要有独立错误与一致性证据。

## 2. 设计空间

> **与教材的关系**：设计维度的详细论述见[教材第 6 章](../book/ch06-filesystem.md)。下表只列本 Lab 要决策的问题；两处如有出入，以教材为准。

| 层 | 典型选择 | 必须验证 |
| --- | --- | --- |
| 块设备 | virtio、板卡 SD/eMMC | 超时、短读写、设备错误 |
| cache | LRU、clock、固定池 | 唯一副本、pin、并发淘汰 |
| inode | 直接/间接块、extent | 最大文件、截断、引用计数 |
| 崩溃一致性 | 无日志、redo log、copy-on-write | 提交原子性、恢复幂等 |

真实板卡的 `block device` 不能只写成“SD 卡”：还要标明是原生 SD host/SDIO、eMMC、SPI-NOR 还是 SPI-SD，以及它由 U-Boot 加载、内核自己驱动，还是两者都实现。QEMU 的 virtio-blk 回归与真实存储回归分开记账。

## 3. 分步操作指引

文件系统是"牵一发动全身"的模块，建议按四层推进，每层自检通过后再进入下一层。

### 步骤 1：画出磁盘布局

开始编码前画出磁盘布局，至少标出超级块、日志、inode 区、位图和数据区。所有长度和偏移都明确单位、端序与版本；挂载时先验证范围关系，再读取可变结构。

| 区域 | 挂载时检查 | 运行时不变量 |
| --- | --- | --- |
| 超级块 | magic、版本、总块数、区域不重叠 | 只读或受事务保护 |
| 日志 | header 范围、记录数上限 | 一次只提交定义范围内的块 |
| inode | 数量与块范围 | link/ref 与生命周期一致 |
| 位图 | 覆盖所有数据块 | 已分配对象引用的块均置位 |
| 数据区 | 不越过设备末尾 | 同一块不会被两个活动对象拥有 |

**自检点**：你能凭这张图回答"第 1000 个数据块在哪个区域、偏移多少、属于哪个文件"，不需要看代码。

### 步骤 2：块设备

先完成固定块号的读写回环，记录请求 ID、块号、方向、长度、完成状态和超时。设备错误必须向上返回，不能用全零块替代失败数据。

**自检点**：对每个块号写唯一模式再读回，全部一致；注入设备错误后，错误能传到上层而不是被吞掉。

#### 步骤 2a：把 QEMU virtio-blk 换成真实 SDIO/SPI

如果 Lab 9 的 canonical board 需要从 SD/eMMC/SPI 启动或运行持久化 workload，本 Lab 先定义硬件路径而不是直接改文件系统。记录供电、电平、pinmux、clock/reset、卡检测/片选和分区来源；先用 PIO 完成单块读写，再接 DMA，并明确 buffer 对齐、ownership、cache clean/invalidate、内存屏障和完成 IRQ。

- 原生 SD host/SDIO：验证低速 `CMD0`、`CMD8`、`ACMD41`、RCA、总线宽度、高速切换、CRC、busy、timeout 和拔卡；多功能 SDIO 还验证 CCCR/FBR、function enable、块大小和 IRQ。
- SPI-NOR/SPI-SD：验证 CPOL/CPHA、频率、CS 保持、FIFO、JEDEC ID/WHO_AM_I；SPI-NOR 测试写使能/页写/擦除/busy，SPI-SD 测试命令帧、数据 token、块读写和 CRC/timeout。

U-Boot 的 `mmc`/`fatload` 成功只能标记启动介质为 `bootloader_only`；内核块设备仍需独立读写回环和错误证据。文件系统只依赖稳定的块设备接口，不能直接读取 virtio 或 SDIO/SPI 控制器寄存器。

### 步骤 3：Buffer cache

buffer cache 通常为 L3 ModuleSpec。声明 free、loading、valid、dirty、writing 等状态，以及 acquire/release、pin/unpin、read/writeback 的合法转换。锁顺序必须覆盖全局索引锁和单 buffer 锁。

**自检点**：并发访问同一块，只有一个内存副本；引用计数在压力测试后回到零，没有泄漏或重复 release。

### 步骤 4：Inode、目录与路径

逐步实现块分配、inode 读写、目录查找、路径解析和文件操作。对 `.`、`..`、重复名称、路径过长、目录循环和并发 unlink/open 明确定义行为。

**自检点**：创建、读取、覆盖、追加、截断、删除和重建文件均通过；块与 inode 分配计数在压力测试后回到预期值。

### 步骤 5：日志与崩溃一致性

定义事务开始、写集合、commit record、checkpoint 和恢复顺序。故障注入要覆盖 commit 前、commit record 写入后、checkpoint 中途三类断点。恢复必须幂等。

| 注入点 | 重启后允许结果 | 禁止结果 |
| --- | --- | --- |
| commit record 前 | 旧状态 | 新目录项配旧 inode |
| commit record 持久化后 | 完整新状态 | 只更新部分事务块 |
| checkpoint 中途 | 重放得到完整新状态 | 二次恢复破坏已恢复数据 |

每次注入都从已知磁盘哈希开始，重启后运行结构检查和用户可见操作。只检查"能挂载"不足以证明一致性。

**自检点**：三张注入表逐行成立，且"恢复过程中再次断电"场景下系统仍能启动（幂等性测试）。

## 4. Spec 与 Agent 工作流

virtio、buffer cache、redo log、inode 和文件 ABI 实现分别填写下面的骨架。不要把多个模块的实现路径塞进同一个 `owns`，跨模块锁顺序或事务变化用 SpecPatch 表达。

```yaml
id: TODO_MODULE_ID
module: TODO_MODULE_ID
level: 3
purpose: TODO
owns: [TODO_IMPLEMENTATION_PATH, TODO_TEST_PATH]
interface: [TODO_OPERATION]
properties: [TODO]
errors: [TODO]
state: { TODO_STATE: TODO }
preconditions: [TODO]
postconditions: [TODO]
invariants: [TODO]
dependencies: [TODO]
concurrency: { TODO_CONCURRENCY_FIELD: TODO }
rely: [TODO]
guarantee: [TODO]
algorithm_intent: TODO
```

```sh
vos agent ask "块设备、缓存与文件系统事务的模块边界和锁顺序应如何表达？"
# 学生手写五份 ModuleSpec，并更新必要的 ABI InterfaceSpec
vos spec lint kernel/virtio
vos agent review kernel/virtio
vos spec lint kernel/bio
vos agent review kernel/bio
vos spec lint kernel/log
vos agent review kernel/log
vos spec lint kernel/inode
vos agent review kernel/inode -i
vos spec lint kernel/file
vos agent review kernel/file -i
# 学生修改、再次 lint，并手动提交
vos spec lint all
git add spec/modules spec/interfaces spec/patches
git commit -m "[spec][fs] Define Lab 6 filesystem contracts"
vos agent implement kernel/virtio
vos agent implement kernel/bio
vos agent implement kernel/log
vos agent implement kernel/inode
vos agent implement kernel/file
vos build
vos run qemu
vos verify
```

块设备、buffer cache、redo log、inode/目录和文件对象分别使用 ModuleSpec；`open/read/write/close` 等用户可见 ABI 延续 Lab 5 的 InterfaceSpec。跨模块锁顺序或事务语义变化先写 SpecPatch。测试 target 分别绑定模块与接口稳定 ID。

## 5. 质量门禁

- [ ] 创建、读取、覆盖、追加、截断、删除和重建文件均通过。
- [ ] 重启后已提交数据存在，未提交事务不会留下半更新结构。
- [ ] 块与 inode 分配计数在压力测试后回到预期值。
- [ ] 同一磁盘块不会出现两个可写 cache 实例。
- [ ] 多核并发 open/close/read/write 不死锁、不丢唤醒。
- [ ] 人工破坏超级块、inode 或日志时，系统明确拒绝或进入定义的恢复路径。
- [ ] QEMU 日志和 public/contract evidence 绑定 clean HEAD。

容量边界还应覆盖空文件、单直接块边界、首次间接块、最大文件、目录满、磁盘满和日志写集合满。每个错误都要保持文件系统可继续使用，除非 Spec 明确要求只读降级或停止。

## 5a. 最小成功输出样例

运行 `vos run qemu` 后，文件系统测试应输出稳定的成功标记。示例（以你的测试输出为准）：

```text
[0] virtio-blk: 128 MiB, 32768 sectors
[0] fs: super block ok, inodes=2048
[0] test: create a.txt ok
[0] test: write/read back ok
[0] test: crash-recovery ok (redo log applied)
[0] fs: alloc leak check: 0 blocks leaked
```

对照门禁：

- 创建、写入、回读、删除路径都有明确成功输出（对应"创建/读取/覆盖/追加/删除均通过"）；
- 重启恢复路径输出"日志已应用"类标记（对应崩溃一致性门禁）；
- 分配计数检查行输出 0 泄漏（对应"分配计数回到预期值"）；
- 人工破坏超级块时输出显式失败或恢复标记，而不是静默挂起。

## 6. 设计理据

解释磁盘布局、cache 淘汰策略和一致性方案。每个选择都要能回答：如果去掉日志或换成 copy-on-write，正确性论证会怎么变？

## 7. AI 使用边界

Agent 可以生成磁盘布局可视化、审查状态机和分析恢复日志。学生必须决定持久化顺序与锁策略。不能通过忽略设备错误、跳过 `fsync` 语义或每次启动重建文件系统来掩盖一致性缺陷。

## 8. 提交物

- [ ] 五个职责边界清楚的 ModuleSpec；
- [ ] 文件 ABI 更新（InterfaceSpec）；
- [ ] 实现与公开测试；
- [ ] 崩溃注入矩阵与结果；
- [ ] 空间泄漏检查；
- [ ] 串口/测试证据；
- [ ] 实际耗时（一个整数小时数）；
- [ ] 必要 SpecPatch。

## 9. 常见问题与排查

### 并发访问后 buffer 引用计数为负

记录 acquire/release 的调用点、buffer ID 和持锁状态，检查错误路径是否重复 release。

### 测试运行正常，重启后目录项丢失

检查 inode、目录块、位图和日志提交的持久化顺序；成功返回不能早于契约要求的提交点。

### 恢复过程再次崩溃后无法启动

恢复步骤不幂等。为每条日志记录设计可重复应用的条件，并对恢复中途再次断电做故障注入。

## 10. 参考卡

- [Book 第 6 章：文件系统](../book/ch06-filesystem.md)：块设备、cache、inode 与日志的完整背景。

QEMU 的 virtio-blk、真实板卡的 SD/eMMC、USB 存储和 NVMe 在发现方式、队列、DMA、缓存一致性和错误恢复上都可能不同。文件系统只依赖统一的块读写和持久化语义；设备发现、队列寄存器、DMA 地址和缓存屏障放在设备/HAL 层。镜像布局、链接地址和存储分区必须来自当前平台文档或设备描述，不能照抄 QEMU 默认值。

本 Lab 前文已经给出 ModuleSpec、InterfaceSpec 和 SpecPatch 的字段与边界。调整日志或锁语义时，记录跨模块影响；不要用忽略设备错误或每次启动重建文件系统的方式掩盖根因。
