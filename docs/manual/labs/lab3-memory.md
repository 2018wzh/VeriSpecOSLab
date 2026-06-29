# Lab 3: 内存管理 — 物理分配与虚拟映射

## 1. 设计问题

物理内存如何分配和回收？虚拟地址空间如何组织？用户和内核如何隔离在各自的地址空间中？内存管理的正确性由什么不变量保证？

## 2. 设计空间

| 决策 | 你需要回答的问题 |
|------|----------------|
| 物理内存布局 | 如何获取可用物理内存范围？哪些区域需要保留？ |
| 分配器算法 | 用什么数据结构管理空闲页？分配的粒度是多少？ |
| 分页模型 | 使用几级页表？内核地址空间如何映射？ |
| 隔离边界 | 用户地址空间和内核地址空间的隔离线在哪里？ |
| 内核内存管理 | 除了页分配，是否需要小对象分配？引用计数？ |

## 3. 背景阅读

- [附录：RISC-V 参考](../appendices/riscv-reference.md)（Sv39 分页和 CSR 部分）
- [附录：不变量检查器编写指南](../appendices/invariant-checker.md)
- [Spec: ModuleSpec 编写指南](../specs/module-spec.md)
- [Spec: ConcurrencySpec 编写指南](../specs/concurrency-spec.md)
- 你的目标平台的内存映射文档

## 4. 规格要求

### 4.1 ArchitectureSlice(memory)（必做）

创建 `spec/architecture/slices/02-memory.yaml`

### 4.2 ModuleSpec（必做）

- `spec/modules/memory/module.yaml`：物理内存模块的完整 ModuleSpec
- `spec/modules/vm/module.yaml`：虚拟内存模块的 ModuleSpec
- `spec/modules/memory/concurrency.yaml`：分配器的并发规则

### 4.3 ADR（必做，至少 1 个）

至少记录分页模型选择（如 Sv39）的决策理由和替代方案分析。

### 4.4 OperationContract（必做）

至少为以下关键操作编写完整契约：
- 物理页分配
- 物理页释放
- 分配器不变量检查
- 建立内核页表
- 页表映射（map_page）
- 取消页表映射（unmap_page）

每个契约需包含：rely/guarantee、pre/postconditions、failure_semantics、concurrency。

### 4.5 GoalValidationContract (mini)（可选）

如果你选择了非平凡的分配器算法或地址空间布局策略，可以用 mini contract 声明你的选择和验证标准。

## 5. 质量门禁

### 测试门禁

```bash
vos spec lint           # 规格格式检查
vos build               # 构建
vos test --suite memory # 公开测试
vos verify public       # 基础验证
```

### 分配器不变量门禁

你的分配器不变量检查器必须可运行并通过。至少包含：
- [ ] 不重复分配（同一页不被分配两次）
- [ ] 保留区域保护（保留区域的页永不返回）
- [ ] 释放后不可用（释放后的页在下次分配前不可被访问）

### 分页门禁

- [ ] 启用分页后内核可继续正常运行（无立即崩溃）
- [ ] 内核可以访问 MMIO 区域（UART 可正常输出）

### 用户/内核隔离门禁

- [ ] 如果已建立用户页表概念，确认用户页表中不存在指向内核物理内存的 U=1 映射

## 6. 设计理据要求

1. 你选择的分配器算法的最坏情况行为是什么？这影响你在后续阶段的什么设计？
2. 你的地址空间布局为什么是这个结构？有什么设计约束促成了这个选择？
3. 你的不变量检查器覆盖了你分配器的所有关键不变量吗？有没有不变量无法在运行时检查？

## 7. AI 使用边界

**允许**：
- 让 AI 审查你的 ModuleSpec，指出缺失的不变量
- 让 AI 生成不变量检查器的框架代码
- 让 AI 解释页错误日志

**禁止**：
- 在没有 ModuleSpec 的情况下让 AI 生成分配器或页表代码
- 让 AI 移除或弱化不变量检查器

## 8. 提交物

- ArchitectureSlice(memory)
- 两个 ModuleSpec（memory + vm）及关键操作的 OperationContract
- ConcurrencySpec（分配器）
- ADR（至少 1 个：分页模型或分配器算法）
- 实现源码
- 不变量检查器输出日志

（进阶方向：对比多种分配器策略如 freelist vs buddy 的性能；调研 KASLR 在教学 OS 中的可行性；利用 Sv39 的 2 MiB/1 GiB 大页减少 TLB 压力；实现惰性分配——页在首次 page fault 时才分配物理页。）
