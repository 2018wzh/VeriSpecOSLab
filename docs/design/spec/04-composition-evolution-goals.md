# Composition、Evolution 与 Goals 标准

## 1. CompositionSpec

组合规格用于描述跨模块不变量，防止“把多个概念拼在一起”但没有定义组合语义。

关于 generation 语义，“整个系统”不是单独的 spec 字段。
它由 `current_stage` 与该 stage 在 composition / architecture compose 结果中展开出的 `enabled_modules` 共同定义。
因此，默认 whole-system generation 的语义是：生成当前 stage 已纳入系统边界的全部模块，而不是未来阶段的模块。

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

## 3. Commit-backed SpecPatch

`SpecPatch` 用于表达设计演化，要求先改 Spec 再改代码。

SpecPatch 不是裸 diff，也不应被 commit message 完全替代。推荐模型是
commit-backed SpecPatch：

- `SpecPatch` 是语义 envelope，记录演化原因、影响范围、风险和回归要求。
- Git commit 是不可变变更本体和审计锚点，提供 DAG、复现、review、revert
  与 cherry-pick 能力。
- VOS gate 同时读取 SpecPatch metadata 与对应 commit diff，完成影响分析和验证选择。

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

commit_sha:
parent_sha:
spec_commit_sha: optional

affected_specs:
affected_modules:
affected_operations:

before:
after:
risks:
required_regressions:
approval_notes:
```

推荐两段式提交流程：

```text
1. spec commit
   - 更新 spec/evolution/patch-*.yaml
   - 更新 ArchitectureSlice / ADR / CompositionSpec / ModuleSpec / OperationContract
   - 生成可引用的 spec_commit_sha

2. implementation commit
   - 实现代码或工具链变化
   - commit trailer 引用 SpecPatch ID 与 spec_commit_sha
   - 作为验证、提交和审计的 commit_sha
```

兼容情况下，可以使用单个 commit 同时包含 SpecPatch metadata 与实现变更。
但首选流程仍是先形成 spec commit，再进入实现 commit。

推荐 commit trailer：

```text
Spec-Patch-ID: patch-003-cow-fork
Spec-Stage: memory
Spec-Kind: operation_change
Affected-Specs: spec/modules/kernel/memory/ops/uvmcopy.yaml
Required-Regressions: public,memory
Spec-Commit-SHA: <sha>
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
