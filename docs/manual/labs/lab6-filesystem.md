# Lab 6: 文件系统 — 持久化存储

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

## 6. 设计理据要求

1. 你的磁盘布局为什么这样设计？最大文件大小和最大文件数量是多少？
2. 你的 buffer cache 的淘汰策略在最坏情况下的行为是什么？
3. 你的文件系统在崩溃后的恢复策略是什么？你验证过它真的能恢复吗？

## 7. AI 使用边界

- 允许 AI 帮助审查 buffer cache 的并发正确性
- 禁止在没有 ModuleSpec 的情况下让 AI 生成文件系统核心代码

## 8. 提交物

- ArchitectureSlice(filesystem)
- ModuleSpec × 3 + OperationContract
- ADR
- 实现源码（磁盘驱动、buffer cache、文件系统核心）
- 制作 `fs.img` 的方法
- 持久化验证日志

（进阶方向：实现 FAT 和自定义格式两种文件系统通过 VFS 统一接口访问；实现启动时 fsck 检查文件系统一致性；实现简易文件系统快照机制。）
