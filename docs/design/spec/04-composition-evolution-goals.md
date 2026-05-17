# Composition、Evolution 与 Goals 标准

## 1. CompositionSpec

组合规格用于描述跨模块不变量，防止“把多个概念拼在一起”但没有定义组合语义。

推荐目录：

```text
spec/composition/
  fd-object-cap.yaml
  syscall-mm-trap.yaml
  ipc-scheduler.yaml
```

推荐字段：

```yaml
id:
title:
related_slices:
affected_modules:

cross_component_rules:
  - name:
    description:
    invariant:
    authority_boundary:
    concurrency_boundary:
    failure_boundary:
    tests:
```

## 2. GoalValidationContract

个性化目标必须通过合约表达，不接受只在报告中声明。

推荐目录：

```text
spec/goals/
  compatibility.yaml
  optimization.yaml
  hardware-port.yaml
  formal-verification.yaml
```

推荐字段：

```yaml
goal_id:
category:
summary:

baseline:
target:
correctness_guard:
benchmark_or_oracle:
negative_tradeoff_checks:
evidence_required:
```

## 3. SpecPatch

`SpecPatch` 用于表达设计演化，要求先改 Spec 再改代码。

推荐目录：

```text
spec/evolution/
  patch-001-*.yaml
  patch-002-*.yaml
```

推荐字段：

```yaml
id:
stage:
title:
reason:
kind: architecture_change | module_change | operation_change | toolchain_change

affected_specs:
affected_modules:
affected_operations:

before:
after:
risks:
required_regressions:
approval_notes:
```

## 4. 触发 SpecPatch 的情形

以下变更应强制触发 `SpecPatch`：

1. 引入新的资源模型或权限模型
2. 改变 syscall / IPC / VFS / trap 等核心语义
3. 改变跨模块不变量
4. 改变 boot chain、link layout、ABI 或运行 profile
5. 引入新的个性化目标或替换既有目标

## 5. 组合与演化的质量要求

1. 组合规则必须指出受影响模块，而不只是抽象描述。
2. 演化文档必须列出回归范围。
3. 个性化目标必须带 `correctness_guard`，防止只追求性能或兼容性数字。
