# Module Spec 与 Operation Contract 标准

## 1. 设计原则

模块级 Spec 和操作级 Spec 必须同时存在。

原因：

- `ModuleSpec` 负责表达状态空间、接口族和模块不变量。
- `OperationContract` 负责表达单次操作的精确行为和验证义务。

没有操作级 Spec，LLM 获得的上下文仍然过粗。

## 2. 推荐目录

```text
spec/modules/
  kernel/
    module.yaml            # 聚合父模块，可被 architecture/composition 引用
    memory/
      module.yaml
      concurrency.yaml
      tests.yaml
      ops/
        kalloc.yaml
        kfree.yaml
        kvmmake.yaml
    syscall/
      module.yaml
      ops/
        syscall.yaml
        sys_write.yaml
  user/
    module.yaml            # 聚合父模块
    programs/
      module.yaml
      ops/
        init.yaml
        user_ld.yaml
```

约定：

- `module` 字段必须与 `spec/modules/` 下的相对目录一致，例如 `spec/modules/kernel/memory/module.yaml` 对应 `module: kernel/memory`。
- 父模块是可引用的一等 `ModuleSpec`，但可以只做聚合，不必拥有自己的 `ops/`。
- 当 `affected_modules` 或 `requires_modules` 引用父模块时，会按当前目标 stage 自动展开到活跃子模块。
- 跨模块操作引用应优先写全限定形式，例如 `kernel/syscall.sys_write`。

## 3. ModuleSpec 最小字段

```yaml
id:
module:
stage:
purpose:
related_slices:
related_adrs:

owned_state:
exported_interfaces:
imported_interfaces:

module_invariants:
error_model:
resource_lifetime_rules:
security_boundary:
test_surfaces:
```

## 4. ConcurrencySpec 最小字段

对并发敏感模块，必须显式维护：

```yaml
module:
shared_state:
lock_types:
lock_order:
atomic_sections:
interrupt_rules:
wait_wakeup_rules:
rely:
guarantee:
forbidden_patterns:
```

## 5. OperationContract 最小字段

每个核心操作建议单独一个 YAML。

```yaml
id:
stage:
module:
operation:

purpose:
related_slice:
related_adr:
depends_on:
  requires_modules:
  requires_ops:

rely:
  state_assumptions:
  callable_interfaces:
  resource_assumptions:
  lock_assumptions:

guarantee:
  returns:
  state_updates:
  side_effects:
  emitted_events:

preconditions:
postconditions:
invariants_preserved:
failure_semantics:

concurrency:
  atomicity:
  lock_order:
  interrupt_state:
  wait_wakeup_rules:

security:
  authority_check:
  isolation_boundary:
  user_pointer_policy:

observability:
  traces:
  counters:
  expected_logs:

test_obligations:
  public:
  generated:
  hidden_tags:

codegen:
  targets:
    - kind: file | symbol | module | test | build
      path:
      symbols:
      owner:
      mode: create | modify | replace
  forbidden_changes:
  required_followup_checks:
```

## 6. 哪些操作必须写 OperationContract

建议至少覆盖以下操作：

1. 核心状态变更函数
2. syscall / trap / IPC 入口
3. 内存分配、映射、释放
4. 调度、阻塞、唤醒
5. 权限检查、句柄查找、对象引用计数更新
6. 文件、命名空间、路径解析、资源回收

## 7. 示例

```yaml
id: kernel/syscall.sys_write
stage: syscall-basic
module: kernel/syscall
operation: sys_write

purpose: write bytes from a user buffer to a writable object
related_slice: 05-syscall-basic
depends_on:
  requires_modules: [kernel/syscall, fd, object, kernel/memory]

rely:
  callable_interfaces:
    - fd_lookup
    - copy_from_user
    - object_write
  lock_assumptions:
    - no_global_kernel_lock_held

guarantee:
  returns:
    - bytes_written
    - -EINVAL on bad_fd
    - -EFAULT on invalid_user_buffer
  side_effects:
    - advances file offset iff write succeeds

preconditions:
  - current task is in user context

postconditions:
  - no unchecked user pointer is dereferenced

invariants_preserved:
  - fd_to_object_mapping
  - object_refcount_nonnegative

security:
  authority_check:
    - fd must have write right
  user_pointer_policy:
    - validate user buffer before dereference

test_obligations:
  public:
    - invalid_fd_write
    - invalid_user_pointer_write
    - offset_advance_on_success
  hidden_tags:
    - concurrent_close_write_race
```

## 8. 编写要求

1. `preconditions` 和 `postconditions` 不能只写自然语言目标，必须可映射到测试或检查器。
2. `failure_semantics` 不能省略。
3. 并发字段对并发模块不是可选增强，而是必要约束。
4. `test_obligations` 必须显式列出至少一组公开测试义务。
