# Lab 6：文件系统——从块设备到崩溃恢复

> 对应教材：[第 6 章：文件系统](../book/ch06-filesystem.md)

Lab 1 只读镜像热身在这里扩展为可写文件系统。实现按块设备、buffer cache、inode/目录和日志四层推进，每层都要有独立错误与恢复证据。

## 1. 设计问题

- 磁盘布局如何版本化，超级块损坏时如何失败？
- buffer cache 如何保证同一块只有一个内存副本？
- inode、目录项和路径解析的锁顺序是什么？
- 分配位图与 inode 引用计数如何避免泄漏？
- 掉电发生在一次更新中间时，重启后允许看到什么状态？

## 2. 设计空间

| 层 | 典型选择 | 必须验证 |
| --- | --- | --- |
| 块设备 | virtio、板卡 SD/eMMC | 超时、短读写、设备错误 |
| cache | LRU、clock、固定池 | 唯一副本、pin、并发淘汰 |
| inode | 直接/间接块、extent | 最大文件、截断、引用计数 |
| 崩溃一致性 | 无日志、redo log、copy-on-write | 提交原子性、恢复幂等 |

## 3. 分层实施

开始编码前画出磁盘布局，至少标出超级块、日志、inode 区、位图和数据区。所有长度和偏移都明确单位、端序与版本；挂载时先验证范围关系，再读取可变结构。

| 区域 | 挂载时检查 | 运行时不变量 |
| --- | --- | --- |
| 超级块 | magic、版本、总块数、区域不重叠 | 只读或受事务保护 |
| 日志 | header 范围、记录数上限 | 一次只提交定义范围内的块 |
| inode | 数量与块范围 | link/ref 与生命周期一致 |
| 位图 | 覆盖所有数据块 | 已分配对象引用的块均置位 |
| 数据区 | 不越过设备末尾 | 同一块不会被两个活动对象拥有 |

### 3.1 块设备

先完成固定块号的读写回环，记录请求 ID、块号、方向、长度、完成状态和超时。设备错误必须向上返回，不能用全零块替代失败数据。

### 3.2 Buffer cache

buffer cache 通常为 L3 ModuleSpec。声明 free、loading、valid、dirty、writing 等状态，以及 acquire/release、pin/unpin、read/writeback 的合法转换。锁顺序必须覆盖全局索引锁和单 buffer 锁。

### 3.3 Inode、目录与路径

逐步实现块分配、inode 读写、目录查找、路径解析和文件操作。对 `.`、`..`、重复名称、路径过长、目录循环和并发 unlink/open 明确定义行为。

### 3.4 日志与恢复

定义事务开始、写集合、commit record、checkpoint 和恢复顺序。故障注入要覆盖 commit 前、commit record 写入后、checkpoint 中途三类断点。恢复必须幂等。

| 注入点 | 重启后允许结果 | 禁止结果 |
| --- | --- | --- |
| commit record 前 | 旧状态 | 新目录项配旧 inode |
| commit record 持久化后 | 完整新状态 | 只更新部分事务块 |
| checkpoint 中途 | 重放得到完整新状态 | 二次恢复破坏已恢复数据 |

每次注入都从已知磁盘哈希开始，重启后运行结构检查和用户可见操作。只检查“能挂载”不足以证明一致性。

## 4. Spec 与 Agent 工作流

```sh
vos agent spec block
vos agent spec buffer-cache
vos agent spec filesystem
vos spec check
vos agent implement block
vos agent implement buffer-cache
vos agent implement filesystem
```

块设备、buffer cache 和文件系统分别使用 ModuleSpec；`open/read/write/close` 等用户可见 ABI 延续 Lab 5 的 InterfaceSpec。跨模块锁顺序或事务语义变化先写 SpecPatch。测试 target 分别绑定模块与接口稳定 ID。

## 5. 验证门禁

- [ ] 创建、读取、覆盖、追加、截断、删除和重建文件均通过。
- [ ] 重启后已提交数据存在，未提交事务不会留下半更新结构。
- [ ] 块与 inode 分配计数在压力测试后回到预期值。
- [ ] 同一磁盘块不会出现两个可写 cache 实例。
- [ ] 多核并发 open/close/read/write 不死锁、不丢唤醒。
- [ ] 人工破坏超级块、inode 或日志时，系统明确拒绝或进入定义的恢复路径。
- [ ] QEMU 日志和 public/contract evidence 绑定 clean HEAD。

容量边界还应覆盖空文件、单直接块边界、首次间接块、最大文件、目录满、磁盘满和日志写集合满。每个错误都要保持文件系统可继续使用，除非 Spec 明确要求只读降级或停止。

## 6. 设计理据与提交物

解释磁盘布局、cache 淘汰策略和一致性方案。提交三个层次的 ModuleSpec、文件 ABI 更新、实现、崩溃注入矩阵、空间泄漏检查、串口/测试证据及必要 SpecPatch。

## 7. AI 使用边界

Agent 可以生成磁盘布局可视化、审查状态机和分析恢复日志。学生必须决定持久化顺序与锁策略。不能通过忽略设备错误、跳过 `fsync` 语义或每次启动重建文件系统来掩盖一致性缺陷。

## 8. 常见错误

### 并发访问后 buffer 引用计数为负

记录 acquire/release 的调用点、buffer ID 和持锁状态，检查错误路径是否重复 release。

### 测试运行正常，重启后目录项丢失

检查 inode、目录块、位图和日志提交的持久化顺序；成功返回不能早于契约要求的提交点。

### 恢复过程再次崩溃后无法启动

恢复步骤不幂等。为每条日志记录设计可重复应用的条件，并对恢复中途再次断电做故障注入。
