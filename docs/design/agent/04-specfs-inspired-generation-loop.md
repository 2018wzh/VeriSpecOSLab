# 04 SpecFS-Inspired Generation Loop

## 1. 设计目标

本文件把 SYSSPEC / SPECFS 的参考做法转成可在 VeriSpecOSLab 中实现的生成原则。

核心思想不是“按论文写总结”，而是将其落实为 runtime 规则。

## 2. 基本生成单元

默认生成单元不是“整个子系统”，而是：

- 一个 `OperationContract`
- 或一个可放入单次上下文窗口的小型 module slice

推荐约束：

- 单次 codegen 只覆盖一个 operation 或一个明确切片
- 输出路径必须在 `allowed_paths` 内
- 如需跨模块语义变更，先要求 `SpecPatch`

## 3. Rely / Guarantee 映射

将现有 `spec/modules/**/ops/*.yaml` 中字段映射到 prompt：

- `rely.state_assumptions` -> imported assumptions
- `rely.callable_interfaces` -> callable interfaces
- `rely.resource_assumptions` -> resource assumptions
- `rely.lock_assumptions` -> lock assumptions
- `guarantee.returns` -> return semantics
- `guarantee.state_updates` -> state updates
- `guarantee.side_effects` -> side effects
- `guarantee.emitted_events` -> emitted events
- `concurrency.*` -> refine phase only

## 4. 两阶段生成

### Phase A: `logic`

输入：

- `RELY`
- `GUARANTEE`
- `SPECIFICATION`
- `llm_codegen.editable_region`

目标：

- 先得到顺序语义正确的局部实现
- 不在本阶段引入复杂锁顺序或 wait/wakeup 细节

### Phase B: `concurrency_refine`

新增输入：

- `concurrency.atomicity`
- `concurrency.lock_order`
- `concurrency.interrupt_state`
- `concurrency.wait_wakeup_rules`
- 资源释放与“返回前不持锁”类 refine 约束

目标：

- 在不破坏 Phase A 功能语义的前提下补齐并发与收尾语义

## 5. 触发 `SpecPatch` 的情况

以下情况不允许直接进入实现 patch：

- 改变跨模块不变量
- 改变 syscall / IPC / VFS / trap 核心语义
- 改变 ABI、boot、运行 profile
- 引入新的资源模型、权限模型或目标合约

此时由 `SpecAssistant` 先产出 `SpecPatch` 草案，再进入 codegen。

## 6. 示例

### 文件系统风格单操作

SpecFS 的单操作 prompt 风格可映射为：

```text
RELY:
  imported helper contracts
GUARANTEE:
  exported operation contract
SPECIFICATION:
  preconditions / postconditions / invariants / failure semantics
REFINE:
  lock ownership transitions and cleanup obligations
```

### OS 场景示例

`sys_write`:

- Phase A 处理 fd lookup、user buffer check、object write、返回值语义
- Phase B 处理锁顺序、copy_from_user 时序、与 `close` / `dup` 的竞态约束

`page_alloc`:

- Phase A 处理空闲页查找、状态更新、失败返回
- Phase B 处理 allocator lock、interrupt state、wait/wakeup 约束
