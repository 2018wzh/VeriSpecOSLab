# Architecture Spec 标准

## 1. 角色

Architecture Spec 用于描述系统的阶段性设计，而不是一次性写完的静态总文档。

它由以下部分组成：

- `ArchitectureSeed`
- `ArchitectureSlice`
- `ArchitectureDecisionRecord`
- `ArchitectureCompositionSpec`
- `FinalArchitectureSynthesis`

## 2. 推荐目录

```text
spec/architecture/
  seed.yaml
  timeline.yaml
  slices/
    01-boot.yaml
    02-memory.yaml
  decisions/
    ADR-001-*.yaml
  composition.yaml
  final-synthesis.yaml
```

## 3. ArchitectureSeed 最小字段

```yaml
id:
project:
domain:
target_platform:
architecture_name:
architecture_summary:

reference_systems:
  - system:
    borrowed_concepts:
    modified_concepts:
    rejected_concepts:
    reason:

goals:
non_goals:
constraints:
initial_validation_binding:
```

## 4. ArchitectureSlice 最小字段

每个阶段切片至少回答：

- 当前阶段引入了哪些机制
- 这些机制依赖哪些历史决定
- 关联哪些模块
- 会派生哪些测试和证据

推荐字段：

```yaml
id:
stage:
title:
summary:

depends_on_slices:
depends_on_adrs:

mechanisms:
affected_modules:
new_operations:
removed_or_replaced_mechanisms:

invariants:
security_boundaries:
concurrency_highlights:
validation_binding:
open_questions:
```

## 5. ADR 最小字段

```yaml
id:
date:
status:
decision:
context:
alternatives:
tradeoffs:
affected_specs:
verification_impact:
```

## 6. Architecture 质量要求

架构层文档必须满足：

1. 不允许只写 `Linux-like`、`L4-like` 之类标签而不说明借鉴内容。
2. 必须说明至少一部分 `rejected_concepts` 或 `non_goals`。
3. 必须把设计绑定到验证，不接受“以后再测”的架构描述。
4. 跨机制设计必须最终落到 `composition.yaml` 或等价组合规格。

## 7. FinalArchitectureSynthesis

课程末期应生成综合视图，用于汇总：

- 整体架构
- 历史切片
- 关键 ADR
- 最终组合不变量
- 个性化目标与验证结果

它不是重写历史，而是对历史 Spec 的可追溯综合。
