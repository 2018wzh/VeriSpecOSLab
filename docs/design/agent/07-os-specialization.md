# 07 OS Specialization

## 1. 目标

本文件说明如何把通用 runtime 机制映射到 VeriSpecOSLab 的 OS 场景。

重点不是重新定义 OS 架构，而是回答“哪些模块适合直接套用 SpecFS 风格的 operation spec -> single-function generation，哪些模块必须加强约束”。

## 2. 适合直接采用操作级生成的模块

以下模块通常可以优先按单操作生成：

- `syscall`: `sys_write`, `sys_exit`, `sys_open`
- `memory`: `page_alloc`, `page_free`, `map_page`
- `ipc`: `ipc_send`, `ipc_recv`
- `vfs`: `vfs_lookup`, `vfs_read`, `vfs_write`

共同特征：

- 输入输出边界清楚
- 依赖接口可列举
- 失败语义与测试义务可显式表达

## 3. 必须提高约束强度的模块

以下模块不应只依赖 Phase A 顺序逻辑：

### trap / syscall ABI

- 必须显式绑定 ABI、寄存器约定、错误返回和 user pointer policy

### page table / memory safety

- 必须显式绑定隔离边界、映射不变量和地址空间约束

### scheduler / wait-wakeup

- 必须显式绑定 lock order、原子区和阻塞唤醒语义

### VFS / namespace / capability

- 必须显式绑定组合规则和 authority boundary

## 4. `vos` 命令映射

OS 场景的典型调用链：

```text
vos agent context
  -> vos agent plan
  -> vos spec lint
  -> vos verify patch
  -> vos debug explain-log
```

示例：

- `sys_write` 修改前先做 `vos agent context --spec spec/modules/kernel/syscall/ops/sys_write.yaml`
- codegen 后至少跑 `vos verify patch`
- 若 QEMU 或 syscall trace 失败，再跑 `vos debug explain-log`

## 5. 近实现级示例

### `sys_write`

Phase A 输入关注：

- fd 查找
- user buffer 校验
- write 权限
- 返回值与 offset 更新语义

Phase B 输入关注：

- 与 `close` / `dup` 的竞态
- 对象锁与 fd 表锁顺序
- 返回前不持锁

### `page_alloc`

Phase A 输入关注：

- 空闲页选择
- 状态更新
- 失败返回

Phase B 输入关注：

- allocator 锁
- interrupt state
- wait/wakeup 或 refill 规则

### `ipc_send`

Phase A 输入关注：

- endpoint 查找
- 权限检查
- 消息复制与错误语义

Phase B 输入关注：

- send/recv 对队列的并发影响
- 阻塞与唤醒

### `vfs_lookup`

Phase A 输入关注：

- namespace 遍历
- 名称解析结果
- 错误返回

Phase B 输入关注：

- dentry / inode 锁顺序
- capability 与 namespace 组合不变量
