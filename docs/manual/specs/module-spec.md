# ModuleSpec 编写指南

ModuleSpec 描述一个模块的**状态、接口和不变量**。它是连接"架构设计"和"操作实现"的中间层。

## 在 Spec 体系中的位置

```text
ArchitectureSlice  ← 引入了什么机制？为什么？
        ↓
ModuleSpec         ← 模块管理什么状态？提供什么接口？维护什么不变量？
        ↓
OperationContract  ← 每个操作的前提条件、后置条件、失败语义？
```

## 推荐目录

```text
spec/modules/
  kernel/
    module.yaml               # 聚合父模块
    memory/
      module.yaml             # 物理内存模块
      concurrency.yaml        # 并发规则
      ops/
        kalloc.yaml
        kfree.yaml
        check_allocator.yaml
    vm/
      module.yaml             # 虚拟内存模块
      ops/
        setup_kernel_pagetable.yaml
        map_page.yaml
        walk.yaml
  user/
    module.yaml               # 聚合父模块
    programs/
      module.yaml
```

## 最小字段

```yaml
id: "spec/modules/kernel/memory"
module: "kernel/memory"
stage: "memory-management"
purpose: "管理物理内存的分配和释放，维护空闲页集合"
related_slices: ["myos-slice-03-memory"]
related_adrs: ["ADR-001-paging-model"]

owned_state:
  - name: "freelist"
    type: "linked list of struct run"
    description: "空闲物理页链表，每个节点位于对应空闲页的开头"
  - name: "allocated_count"
    type: "int"
    description: "已分配页计数，用于泄漏检测"

exported_interfaces:
  - name: "kalloc"
    signature: "void *kalloc(void)"
    description: "分配一个清零的物理页"
  - name: "kfree"
    signature: "void kfree(void *pa)"
    description: "释放一个物理页"
  - name: "kinit"
    signature: "void kinit(void)"
    description: "初始化物理页分配器"
  - name: "check_page_allocator_invariant"
    signature: "void check_page_allocator_invariant(void)"
    description: "检查分配器不变量"

imported_interfaces:
  - module: "kernel/lock"
    interfaces: ["acquire", "release", "initlock"]

module_invariants:
  - name: "freelist_no_duplicate"
    description: "freelist 中每个物理页只出现一次"
  - name: "allocated_not_in_freelist"
    description: "已被 kalloc 返回且尚未 kfree 的页不存在于 freelist 中"
  - name: "reserved_never_allocated"
    description: "保留区域的物理页从未被 kalloc 返回"
  - name: "page_zeroed_on_alloc"
    description: "kalloc 返回的页内容全为零"

error_model:
  - error: "kalloc 被调用但无空闲页"
    behavior: "返回空指针"
  - error: "kfree 被传入空指针"
    behavior: "直接返回，无操作"
  - error: "kfree 被传入非页对齐地址"
    behavior: "panic（这是编程错误，不可恢复）"

resource_lifetime_rules:
  - "kalloc 分配的页在 kfree 之前视为'已分配'"
  - "kfree 后该页不应再被访问"
  - "kfree(NULL) 是合法操作（no-op）"

security_boundary:
  - "此模块不直接暴露给用户态"
  - "物理地址不应泄漏到用户态"

test_surfaces:
  - "kalloc/kfree 循环"
  - "并发 kalloc/kfree"
  - "不变量检查器验证"
```

## 字段说明

### owned_state

模块拥有的状态。这很重要——它明确了模块的**所有权边界**。任何不属于此模块的状态不应该被此模块直接修改。

### exported_interfaces / imported_interfaces

明确模块的接口：它提供什么？它依赖什么？这是模块间解耦的基础。

### module_invariants

模块级不变量——在模块的每个操作完成后（可能短暂违反，但在操作返回前恢复）必须成立的性质。

### error_model

模块的错误处理策略。区分：
- **可恢复错误**（返回错误码）
- **编程错误**（panic）
- **未定义行为**（不允许存在）

### security_boundary

明确安全边界：用户态是否可以访问此模块？哪些数据不能泄漏到用户态？

## 父模块（聚合模块）

父模块是可引用的一等 ModuleSpec，通常只做聚合：

```yaml
id: "spec/modules/kernel"
module: "kernel"
stage: "boot"
purpose: "内核模块的聚合命名空间"
related_slices: ["myos-slice-02-boot"]

exported_interfaces: []
imported_interfaces: []
module_invariants: []
```

它的作用是被 ArchitectureSlice 和 CompositionSpec 引用，然后按当前 stage 自动展开到活跃子模块。
