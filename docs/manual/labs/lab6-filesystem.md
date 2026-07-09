# Lab 6: 文件系统 — 持久化存储

> **对应 Book 章节**：[第 6 章：文件系统 — 持久化](../book/ch06-filesystem.md)

## 1. 设计问题

数据如何组织在磁盘上？如何被高效缓存？如何在崩溃后保持一致？设备驱动如何与文件系统层交互？

注意：本 Lab 聚焦于文件系统的**底层机制**（磁盘驱动、buffer cache、inode、目录、日志）。syscall 接口（`open/read/write`）属于阶段 7。

## 2. 设计空间

| 决策 | 你需要回答的问题 |
|------|----------------|
| 存储设备 | 使用什么磁盘设备？（virtio-blk 推荐）驱动接口如何设计？ |
| 磁盘布局 | superblock、inode 区、数据区如何排列？Inode 的结构？目录的组织方式？ |
| Buffer Cache | 缓存多少块？淘汰策略？并发控制？（多核：多个 CPU 同时访问 buffer cache 的锁策略？） |
| 一致性 | 崩溃后文件系统如何恢复？日志？fsck？还是接受损坏？ |
| 空闲空间管理 | 如何追踪空闲 inode 和空闲数据块？ |

## 2a. 设计决策引导

### 决策 1：磁盘布局

你的磁盘布局定义了"磁盘上的哪些扇区属于什么"。三种常见布局：

| 布局 | 结构 | 优点 | 缺点 |
|------|------|------|------|
| **xv6 风格** | boot block → superblock → inode blocks → bitmap → data blocks → log | 简单直观，参考资料丰富 | 文件大小受限于 inode 的间接块层数 |
| **类 ext2** | boot → block groups（每个 group 含 superblock 副本、group desc、bitmap、inode table、data） | 大容量友好，局部性好 | 实现复杂度显著增加 |
| **FAT 风格** | boot → FAT 表（簇链） → 根目录 → 数据区 | 极其简单，互操作性强 | 大文件效率低，碎片严重 |

**零基础建议**：xv6 风格。它的磁盘布局在 xv6 book 第 8 章中有逐字段解释，你可以对照实现。

### 决策 2：Buffer Cache 淘汰策略

| 策略 | 实现难度 | 缓存命中率 | 适合 |
|------|:------:|:------:|------|
| **LRU（最近最少使用）** | 中（需要维护访问顺序） | 高 | 通用场景 |
| **Clock（时钟算法）** | 低（只需一个引用位 + 循环指针） | 中高 | 推荐：实现简单且效果不错 |
| **FIFO（先进先出）** | 最低 | 低（可能有 Belady 异常） | 仅用于原型验证 |

**零基础建议**：Clock 算法。用一个 `ref` 标志位和一个循环扫描指针，是"代码量/命中率"性价比最高的方案。

### 决策 3：崩溃一致性

| 策略 | 实现难度 | 恢复保证 | 适合 |
|------|:------:|:------:|------|
| **不接受损坏（同步写）** | 最低 | 无，不保证一致性 | 原型阶段 |
| **日志（Write-Ahead Logging）** | 中 | 崩溃后可恢复到一致状态 | 推荐首选 |
| **fsck（启动时扫描修复）** | 中 | 恢复慢但可修复多数问题 | FAT 风格常用 |
| **COW（写时复制）** | 高 | 原子更新，天然一致 | ZFS/Btrfs 路线 |

**零基础建议**：日志（WAL）。xv6 的日志实现仅约 150 行。先写日志（log_write），提交（commit），再写实际位置（install_trans）。崩溃后重放日志即可恢复。

## 2b. 逐步操作指引

### 步骤 1：磁盘驱动（预计 1-2 小时）

RISC-V QEMU `virt` 机器推荐使用 virtio-blk。virtio 是一个标准化的半虚拟化设备接口：

```c
// virtio-blk 初始化流程（简化）
// 1. 通过 MMIO 发现 virtio 设备（遍历 0x10001000 - 0x10008000 的 MMIO 区域）
// 2. 读取设备 ID 确认是块设备（Device ID = 2）
// 3. 初始化 virtqueue（描述符表 + 可用环 + 已用环）
// 4. 通过 virtqueue 提交读写请求
```

**自检点**：能通过 virtio-blk 读取磁盘的第 0 号扇区（superblock 所在位置）。

### 步骤 2：Buffer Cache（预计 1-2 小时）

```c
// Buffer cache 核心接口
struct buf* bread(uint32_t dev, uint32_t blockno);  // 读取块（可能命中缓存）
void bwrite(struct buf *b);                           // 标记块为脏，稍后写回
void brelse(struct buf *b);                           // 释放引用
```

**自检点**：连续读写 100 个块，每次 `bread` 能命中缓存（第二次读同一个块不触发磁盘 I/O）。

### 步骤 3：Inode 层 + 目录 + 路径解析（预计 2-3 小时）

这是文件系统的核心逻辑：inode 分配/释放 → 目录项操作 → 路径名解析（`namei`）。

**自检点**：能从根目录 `/` 出发，逐级解析路径 `/foo/bar.txt`，最终找到对应的 inode。

### 步骤 4：日志层（预计 1-2 小时）

```c
// 日志接口
void log_begin_op();     // 开始一个文件系统操作
void log_write(struct buf *b);  // 将此块的修改记入日志
void log_end_op();       // 提交：先写日志头，再写实际位置，最后清除日志
```

**自检点**：在 `log_end_op` 和实际写入之间模拟崩溃（QEMU `quit`），重启后文件系统一致。

## 3. 背景阅读

- 你选择的磁盘设备规范（如 virtio spec）
- [Spec: ConcurrencySpec 编写指南](../specs/concurrency-spec.md)（buffer cache 的并发规则）

## 4. 规格要求

### 4.1 ArchitectureSlice(filesystem)（必做）

`spec/architecture/slices/05-filesystem.yaml`

### 4.2 ModuleSpec（必做）

- `spec/modules/disk/module.yaml`：磁盘驱动
- `spec/modules/cache/module.yaml`：Buffer Cache
- `spec/modules/fs/module.yaml`：文件系统核心

### 4.3 ADR（必做，至少 1 个）

建议：磁盘布局选择或一致性策略选择。

### 4.4 OperationContract（必做）

至少为以下操作编写契约：
- 磁盘块读写
- Buffer 的获取（bread）、写入（bwrite）、释放（brelse）
- Inode 分配/释放、读/写
- 目录项查找和创建
- 路径解析

### 4.5 GoalValidationContract (mini)（可选）

如果你选择非常规的磁盘布局或日志策略。

## 5. 质量门禁

```bash
vos test --suite filesystem
vos verify public
```

- [ ] 文件可被创建、写入、读取、删除
- [ ] 数据在重启后仍然存在
- [ ] 多文件操作间文件系统保持一致
- [ ] 无 inode 或数据块泄漏
- [ ] 多 CPU 并发访问 buffer cache 无竞态崩溃（多核）

## 6. Seed 更新

在 `spec/architecture/seed.yaml` 中补充文件系统相关的设计决策：

```yaml
filesystem:
  layout: "xv6-style"        # 或 ext2-style / FAT-style
  cache_policy: "clock"      # 或 LRU / FIFO
  consistency: "wal-logging" # 或 fsck / cow / none
  max_file_size: "..."       # 你的文件系统支持的最大文件大小
  max_file_count: "..."      # 你的文件系统支持的最大文件数量
```

## 7. 设计理据要求

1. 你的磁盘布局为什么这样设计？最大文件大小和最大文件数量是多少？
2. 你的 buffer cache 的淘汰策略在最坏情况下的行为是什么？
3. 你的文件系统在崩溃后的恢复策略是什么？你验证过它真的能恢复吗？

## 8. AI 使用边界

- 允许 AI 帮助审查 buffer cache 的并发正确性
- 禁止在没有 ModuleSpec 的情况下让 AI 生成文件系统核心代码

## 9. 提交物

- ArchitectureSlice(filesystem)
- ModuleSpec × 3 + OperationContract
- ADR
- 实现源码（磁盘驱动、buffer cache、文件系统核心）
- 制作 `fs.img` 的方法
- 持久化验证日志

（进阶方向：实现 FAT 和自定义格式两种文件系统通过 VFS 统一接口访问；实现启动时 fsck 检查文件系统一致性；实现简易文件系统快照机制。）

## 10. 常见错误与排查

| 症状 | 可能原因 | 排查方法 |
|------|---------|---------|
| `bread` 返回全零 | 磁盘驱动未正确初始化，或读取了错误的扇区号 | 先用已知数据写入扇区 0，再读回来验证驱动正确性 |
| 创建文件后重启，文件消失 | `bwrite` 未真正写回磁盘；或 buffer cache 未刷脏块 | 在每次 `bwrite` 后加日志确认写回；检查 cache 淘汰时是否刷脏 |
| 日志恢复后文件系统损坏 | 日志提交顺序错误，实际块在日志提交前就被写了 | 严格遵循 WAL：先写日志、提交、再写实际位置 |
| inode 泄漏（用完后不释放） | `iput` 未正确减少引用计数，或释放条件写错 | 在 `ialloc`/`ifree` 处添加计数日志，追踪每个 inode 生命周期 |
| 路径解析返回错误的 inode | 目录项字符串比较未处理长度；或 `..` 未正确解析 | 单独测试 `dirlookup`、测试 `namei("/a/b/..")` 应返回 `/a` |
| buffer cache 并发 panic | 多核同时访问同一个 buffer 导致竞态 | 为每个 buffer 加 sleeplock（xv6 方案）；用 `vos test --suite filesystem --smp 4` 复现 |
| 大文件（超过一个 inode 的直接块）读写失败 | 间接块未正确分配或索引 | 先测试刚好超过直接块大小的文件（如 12 个直接块 × 1024 字节），逐步增大 |
