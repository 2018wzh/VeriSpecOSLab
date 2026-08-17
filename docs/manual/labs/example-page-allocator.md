# 示例 ModuleSpec：物理页分配器（带注释）

这是一份完整的 ModuleSpec 写法示范，供学生对照"字段填到什么程度算合格"。它与任何 Lab 的验收点没有直接对应关系，只示范写法；你的模块按自己的语义填写，不要照抄。

阅读顺序建议：

1. `id`/`module`/`level` 定义模块身份与深度（L1/L2/L3）；
2. `purpose` 一句话说清职责；
3. `owns` 声明实现与测试的仓库相对路径（必须覆盖两者，不能包含 `..` 或绝对路径）；
4. `interface` 列出外部可调用的操作，每个操作给 pre/post/errors；
5. `properties`/`invariants` 把"可验证的性质"显式写出来，`check` 指向能验证它的测试；
6. `state`/`preconditions`/`postconditions` 描述状态机；
7. `dependencies` 声明依赖的其他模块。

```yaml
# ModuleSpec example: physical page allocator
id: kernel/memory
module: kernel/memory
level: 2
purpose: allocate and release owned physical pages
owns:
  - kernel/memory.c
  - tests/memory
interface:
  - name: kalloc
    pre: [allocator_initialized]
    post: [returned_page_is_owned]
    errors: [out_of_memory]
    properties:
      - id: aligned
        text: returned page is page-aligned
        check: memory_alignment
properties:
  - id: no_alias
    text: one physical page has at most one live owner
errors: [out_of_memory]
state:
  free_pages: bitmap
preconditions: [allocator_initialized]
postconditions: [ownership_transferred]
invariants: [no_alias]
dependencies: []
```

对照检查：你的 ModuleSpec 能否回答这几个问题？

- `purpose` 与 Lab 的设计问题一一对应吗？
- 每个操作都有 pre/post/errors 吗？错误语义可测试吗？
- 每条 property/invariant 都能映射到一个可运行的测试吗？
- `owns` 覆盖实现与测试，且没有越界吗？
